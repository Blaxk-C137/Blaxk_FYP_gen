// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import { buildDocx, referencesSection, REFERENCES_LABEL } from './docx'
import { renderChartPng } from './chart'
import type { Chapter, ProjectInfo } from '../state/store'

// jsdom cannot rasterize, so the renderer always returns null there; mocking
// keeps that default and lets specific tests opt into the embedded-image path.
vi.mock('./chart', () => ({ renderChartPng: vi.fn(() => null) }))
const mockedRender = vi.mocked(renderChartPng)

const project: ProjectInfo = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters: Chapter[] = [
  { number: 1, title: 'INTRODUCTION', status: 'done',
    sections: [], text: 'CHAPTER ONE\n1.1 Background of the Study\nNigeria faces theft.' },
  { number: 2, title: 'LITERATURE REVIEW', status: 'done', sections: [], text: 'CHAPTER TWO\n2.1 Review\nPrior work exists.' },
  { number: 6, title: 'QUESTIONNAIRE', status: 'done',
    sections: [], text: 'APPENDIX: QUESTIONNAIRE\nSection A: Demographics' },
]
const references = [
  'Doe, J. (2020). Sensors in Africa. Journal of Things, 5(2), 10–20.',
  'Adeyemi, K. (2018). Campus security. Nigerian Journal of Safety, 3(1), 1–9.',
  'Doe, J. (2020). Sensors in Africa. Journal of Things, 5(2), 10–20.', // duplicate
]

// jsdom's Blob lacks arrayBuffer(); read bytes through FileReader there.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(blob)
  })
}


describe('buildDocx', () => {
  it('produces a valid docx containing title page and chapter content', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('BAYERO UNIVERSITY KANO')
    expect(doc).toContain('IoT-based theft detection')
    expect(doc).toContain('Aisha Musa')
    expect(doc).toContain('Nigeria faces theft.')
    expect(doc).toContain(REFERENCES_LABEL)
  })

  it('has two sections: roman-numeral preliminary footer, then Arabic restart at 1', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    // Two sectPr elements = two sections
    expect((doc.match(/<w:sectPr[ >]/g) ?? []).length).toBe(2)

    // Page-number formats are declared per-section via pgNumType
    const pgNumTypes = doc.match(/<w:pgNumType[^/>]*\/?>/g) ?? []
    expect(pgNumTypes).toContain('<w:pgNumType w:start="1" w:fmt="lowerRoman"/>')
    expect(pgNumTypes).toContain('<w:pgNumType w:start="1" w:fmt="decimal"/>')

    // Both sections carry a footer with a PAGE field
    const footers = Object.keys(zip.files).filter((f) => /^word\/footer\d*\.xml$/.test(f))
    expect(footers.length).toBe(2)
    for (const f of footers) {
      const footerXml = await zip.files[f]!.async('string')
      expect(footerXml).toContain('PAGE')
    }
  })

  it('contains a real TableOfContents field', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    // field instruction over heading levels 1-2 (quotes are XML-escaped)
    expect(doc).toContain('TOC \\h \\o &quot;1-2&quot;')
  })

  it('starts every chapter on a new page', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    // pageBreakBefore on each CHAPTER heading (2 chapters here; questionnaire/refs too)
    expect((doc.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('gives cover page, abstract, TOC, every chapter, appendix, and references their own page', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    // ABSTRACT + TOC (prelim), CHAPTER ONE + CHAPTER TWO + APPENDIX (body),
    // REFERENCES — each forced onto a fresh page.
    expect((doc.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBe(6)
    // each major heading paragraph carries the break
    for (const h of ['ABSTRACT', 'TABLE OF CONTENTS', 'CHAPTER ONE', 'CHAPTER TWO', 'APPENDIX: QUESTIONNAIRE', 'REFERENCES']) {
      const idx = doc.indexOf(`>${h}<`)
      expect(idx).toBeGreaterThan(-1)
      const pPrStart = doc.lastIndexOf('<w:pPr>', idx)
      const pPrEnd = doc.indexOf('</w:pPr>', idx)
      expect(doc.slice(pPrStart, pPrEnd)).toContain('<w:pageBreakBefore/>')
    }
  })

  it('renders a single deduplicated, alphabetized REFERENCES section at the end', async () => {
    const blob = await buildDocx(project, chapters, 'An abstract.', references)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    const lastRefs = doc.lastIndexOf('Adeyemi, K.')
    expect(lastRefs).toBeGreaterThan(-1)
    // Deduplicated: the duplicate Doe entry appears once
    expect((doc.match(/Doe, J\. \(2020\)/g) ?? []).length).toBe(1)
    // Alphabetized: Adeyemi before Doe
    expect(doc.indexOf('Adeyemi, K.')).toBeLessThan(doc.indexOf('Doe, J. (2020)'))
    // References are last (after the questionnaire appendix)
    expect(doc.indexOf('Section A: Demographics')).toBeLessThan(doc.indexOf('REFERENCES'))
  })

  it('shows guidance placeholder text when no references exist', async () => {
    const refs = referencesSection([], [])
    expect(refs).toContain('APA 7')
    expect(refs).toContain(REFERENCES_LABEL)
  })
})

describe('referencesSection', () => {
  it('dedupes and alphabetizes store references and appends the verify label', () => {
    const refs = referencesSection([], references)
    expect((refs.match(/Doe, J\. \(2020\)/g) ?? []).length).toBe(1)
    expect(refs.indexOf('Adeyemi')).toBeLessThan(refs.indexOf('Doe'))
    expect(refs).toContain(REFERENCES_LABEL)
  })
})

describe('buildDocx markdown rendering', () => {
  it('renders inline bold/italic as Word formatting, not literal markdown', async () => {
    const ch: Chapter[] = [{
      number: 1, title: 'INTRODUCTION', status: 'done', sections: [],
      text: 'CHAPTER ONE\nThis is **important** and *key*.',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', [])
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:b/>')
    expect(doc).toContain('<w:i/>')
    expect(doc).toContain('important')
    expect(doc).not.toContain('**important**')
    expect(doc).not.toContain('*key*')
  })

  it('renders a pipe table as a real Word table', async () => {
    const ch: Chapter[] = [{
      number: 4, title: 'RESULTS', status: 'done', sections: [],
      text: 'CHAPTER FOUR\n| Model | F1 |\n| --- | --- |\n| BERT | 0.83 |\n| SVM | 0.70 |',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', [])
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:tbl>')
    expect(doc).toContain('Model')
    expect(doc).toContain('BERT')
    expect(doc).toContain('0.83')
  })

  it('renders bullet and numbered lists with Word numbering', async () => {
    const ch: Chapter[] = [{
      number: 3, title: 'METHODOLOGY', status: 'done', sections: [],
      text: 'CHAPTER THREE\n- first aim\n- second aim\n\n1. collect data\n2. analyze data',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', [])
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:numPr>')
    expect(doc).toContain('collect data')
    expect(doc).not.toContain('- first aim')
    expect(doc).not.toContain('1. collect data')
  })

  it('embeds a chart as a PNG image with a numbered caption when rendering succeeds', async () => {
    mockedRender.mockReturnValueOnce('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    const ch: Chapter[] = [{
      number: 4, title: 'RESULTS', status: 'done', sections: [],
      text: 'CHAPTER FOUR\n```chart\n{"type":"bar","title":"Distribution","data":{"A":3,"B":5}}\n```',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', [])
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:drawing>')
    expect(doc).toContain('Figure 4.1')
    expect(doc).toContain('Distribution')
    const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'))
    expect(media.length).toBeGreaterThanOrEqual(1)
    expect(mockedRender).toHaveBeenCalledWith({ type: 'bar', title: 'Distribution', data: { A: 3, B: 5 } })
  })

  it('falls back to a placeholder when the chart cannot be rendered', async () => {
    const ch: Chapter[] = [{
      number: 4, title: 'RESULTS', status: 'done', sections: [],
      text: 'CHAPTER FOUR\n```chart\n{"type":"bar","title":"Distribution","data":{"A":3,"B":5}}\n```',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', []) // mocked renderer returns null
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).not.toContain('<w:drawing>')
    expect(doc).toContain('INSERT CHART HERE')
    expect(doc).toContain('Figure 4.1')
  })

  it('renders figure blocks as captioned insert-here placeholders', async () => {
    const ch: Chapter[] = [{
      number: 3, title: 'METHODOLOGY', status: 'done', sections: [],
      text: 'CHAPTER THREE\n```figure\nSystem architecture: three tiers connected by REST.\n```',
    }]
    const blob = await buildDocx(project, ch, 'Abs.', [])
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('INSERT FIGURE HERE')
    expect(doc).toContain('System architecture: three tiers connected by REST.')
    expect(doc).toContain('Figure 3.1')
  })
})

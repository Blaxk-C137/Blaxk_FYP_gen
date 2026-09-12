// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptx, slideContentFromChapters, parseQaSlides } from './pptx'
import type { SlideContent } from '../ai/parseSlides'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const,
    sections: [
      { heading: 'Background of the Study', description: 'context' },
      { heading: 'Statement of the Problem', description: 'theft' },
      { heading: 'Objectives of the Study', description: 'goals' },
    ], text: 'CHAPTER ONE\n1.1 Background\nCampus theft is common.' },
  { number: 3, title: 'METHODOLOGY', status: 'done' as const,
    sections: [{ heading: 'Research Design', description: '' }, { heading: 'System Implementation', description: '' }],
    text: 'CHAPTER THREE\nBuilt a system.' },
]
const defenseQa = 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'

const content: SlideContent = {
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['Campus theft is common', 'Labs lose equipment yearly'],
  prob: ['Manual watchmen are unreliable'],
  gen_obj: 'To build an IoT theft detection system for campus laboratories.',
  spec_obj: ['Sense motion reliably', 'Raise alerts in real time', 'Log intrusion events', 'Keep hardware cheap'],
  scope_pts: ['Two campus laboratories', 'PIR and door sensors'],
  sig_pts: ['Protects university assets', 'Cheap enough to scale'],
  method: [
    { title: 'Research Design', detail: 'Experimental prototype.' },
    { title: 'Data Collection', detail: 'Sensor logs over six weeks.' },
    { title: 'Development', detail: 'ESP32 firmware and dashboard.' },
    { title: 'Testing & Evaluation', detail: 'Intrusion drills, 98% detection.' },
  ],
  findings: ['98% detection rate', 'No false alarms at night'],
  discuss: ['Cheaper than hiring guards'],
  conc_pts: ['The system works reliably'],
  recs: ['Deploy across all labs', 'Add camera integration'],
}

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

async function slidesOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
  return { zip, names, xml: (i: number) => zip.file(`ppt/slides/slide${i}.xml`)!.async('string') }
}

describe('buildPptx', () => {
  it('builds 9 themed core slides plus one appendix slide per Q&A chapter', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(names).toHaveLength(11)
    const slide1 = await xml(1)
    expect(slide1).toContain('IoT-based theft detection')
    expect(slide1).toContain('BAYERO UNIVERSITY KANO')
    expect(slide1).toContain('Aisha Musa')
    const outline = await xml(2)
    expect(outline).toContain('Outline')
    const qa = await xml(10)
    expect(qa).toContain('Why this topic?')
  })

  it('applies the chosen theme colors to the deck', async () => {
    const navy = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(await navy.xml(1)).toContain('0A2342')   // title-slide background
    // (outline numbers are plain bullet text — no accent color in slide 2's XML; the
    // accent is covered by slide 1's university-name color, per the brief's note)
    const forest = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'forest'))
    expect(await forest.xml(1)).toContain('1B4332')
    expect(await forest.xml(6)).toContain('1B4332')  // methodology step squares
  })

  it('numbers footers truthfully: n/total includes appendix slides', async () => {
    const withQa = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(await withQa.xml(2)).toContain('2/11')
    expect(await withQa.xml(10)).toContain('10/11')
    const noQa = await slidesOf(await buildPptx(project, chapters, '', content, 'navy'))
    expect(noQa.names).toHaveLength(9)
    expect(await noQa.xml(2)).toContain('2/9')
    expect(await noQa.xml(9)).not.toContain('9/9') // thank-you slide has no footer
  })

  it('renders the methodology grid and grouped content slides', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    const method = await xml(6)
    expect(method).toContain('Research Design')
    expect(method).toContain('ESP32 firmware and dashboard.')
    const objectives = await xml(4)
    expect(objectives).toContain('General Objective')
    expect(objectives).toContain('To build an IoT theft detection system for campus laboratories.')
    expect(objectives).toContain('Specific Objectives')
    const bg = await xml(3)
    expect(bg).toContain('Background of the Study')
    expect(bg).toContain('Statement of the Problem')
  })

  it('skips a content slide whose group is entirely empty', async () => {
    const thin: SlideContent = { ...content, findings: [], discuss: [] }
    const { names } = await slidesOf(await buildPptx(project, chapters, '', thin, 'navy'))
    expect(names).toHaveLength(8) // 9 minus the empty Results slide
    const conc = await slidesOf(await buildPptx(project, chapters, '', thin, 'navy'))
    const slide7 = await conc.xml(7)
    expect(slide7).toContain('Conclusion &amp; Recommendations') // Results skipped, Conclusion moves up (pptxgenjs XML-escapes the ampersand)
  })
})

describe('slideContentFromChapters', () => {
  it('maps chapter sections to slide content mechanically', () => {
    const c = slideContentFromChapters([
      { ...chapters[0], sections: [
        { heading: 'Background of the Study', description: '' },
        { heading: 'Objectives of the Study', description: '' },
      ] },
      chapters[1],
    ])
    expect(c.bg).toEqual(['Background of the Study'])
    expect(c.gen_obj).toBe('Objectives of the Study') // first objective section becomes the general objective
    expect(c.method.map((m) => m.title)).toEqual(['Research Design', 'System Implementation'])
  })

  it('defaults outline to the six standard titles', () => {
    const c = slideContentFromChapters([])
    expect(c.outline).toHaveLength(6)
    expect(c.outline[0]).toBe('Background & Problem Statement')
  })
})

describe('parseQaSlides (unchanged)', () => {
  it('still yields one slide per chapter block', () => {
    expect(parseQaSlides(defenseQa)).toHaveLength(2)
  })
})

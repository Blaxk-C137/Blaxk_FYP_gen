// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptx, slideContentFromChapters, parseQaSlides } from './pptx'
import type { SlideContent } from '../ai/parseSlides'
import type { ReferenceEntry } from '../state/store'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const, sections: [], text: 'CHAPTER ONE\n1.1 Background\nCampus theft is common.' },
  { number: 3, title: 'METHODOLOGY', status: 'done' as const, sections: [], text: 'CHAPTER THREE\nBuilt a system.' },
]
const defenseQa = 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'
const references: ReferenceEntry[] = [
  { key: 'a', apa: 'Musa, A. (2024). Sensors on campus. Journal of Things, 4(2), 10-20.', verified: true },
  { key: 'b', apa: 'Ola, D. (2023). Cheaper hardware. Hardware Letters, 2(1), 5-9.', verified: false },
]
const content: SlideContent = {
  aim: 'Investigate theft reliably.',
  bullets: {
    intro: ['Campus theft is common', 'Labs lose equipment yearly', 'Watchmen are unreliable'],
    problem: ['Manual watchmen are unreliable', 'Alarms are expensive'],
    objectives: ['Sense motion reliably', 'Raise alerts in real time'],
    scope: ['Two campus laboratories'],
    significance: ['Protects university assets'],
    literature: ['IoT sensing is mature'],
    methodology: ['Simulated the sensor mesh', 'Built an ESP32 prototype', 'Ran six weeks of drills', 'Measured detection latency'],
    sysdesign: ['PIR sensors on door frames', 'ESP32 gateway per lab'],
    implementation: ['Firmware in C', 'Dashboard in React'],
    results: ['98% detection rate', 'No false alarms at night'],
    discussion: ['Cheaper than hiring guards'],
    conclusion: ['The system works reliably'],
  },
  notes: { intro: 'Good morning, esteemed panel. This project addresses theft in campus laboratories.' },
  images: [{ slide: 'sysdesign', prompt: 'Diagram of PIR sensors wired to an ESP32 gateway' }],
}

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

describe('buildPptx v2', () => {
  it('builds the core structure: title, 12 content slides, references, thank-you, Q&A appendix', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, references, 'forest'))
    // 1 title + 12 content + 1 references + 1 thank-you + 2 Q&A appendix
    expect(names).toHaveLength(17)
    expect(await xml(1)).toContain('BAYERO UNIVERSITY KANO')
    expect(await xml(2)).toContain('Introduction / Background')
    expect(await xml(8)).toContain('Methodology')
    expect(await xml(14)).toContain('References')
    expect(await xml(14)).toContain('Musa, A. (2024)')
    expect(await xml(15)).toContain('Thank You')
    expect(await xml(16)).toContain('Why this topic?')
  })

  it('applies the example theme: footer strips, dark-green titles, Arial', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))
    const s2 = await xml(2)
    expect(s2).toContain('2F3D32')   // title text color
    expect(s2).toContain('548C2F')   // thick strip
    expect(s2).toContain('9CC85D')   // thin strip
    expect(s2).toContain('typeface="Arial"')
  })

  it('auto-splits overflowing sections into (continued) slides — nothing exceeds the line budget', async () => {
    const long: SlideContent = {
      ...content,
      bullets: { ...content.bullets, methodology: Array.from({ length: 30 }, (_, i) => `Step ${i + 1} of the build process done well`) },
    }
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, '', long, references, 'forest'))
    const titles = await Promise.all(names.map((_, i) => xml(i + 1)))
    const methodSlides = titles.filter((t) => t.includes('Methodology'))
    expect(methodSlides.length).toBeGreaterThanOrEqual(3)
    expect(titles.some((t) => t.includes('Methodology (continued)'))).toBe(true)
  })

  it('numbers pages truthfully including continued and references slides', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, references, 'forest'))
    expect(names).toHaveLength(17)
    expect(await xml(2)).toContain('2/17')
    expect(await xml(14)).toContain('14/17')
  })

  it('attaches speaker notes when provided', async () => {
    const zip = await (await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))).zip
    expect(Object.keys(zip.files).some((n) => /notesSlide\d+\.xml/.test(n))).toBe(true)
    const notes1 = await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string')
    expect(notes1).toContain('Good morning, esteemed panel')
  })

  it('renders the aim with a green lead-in label and [VERIFY] red on references slides', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))
    const aim = await xml(4) // Aim and Objectives
    expect(aim).toContain('Aim and Objectives')
    expect(aim).toContain('Aim:')
    const refs = await xml(14)
    expect(refs).toContain('[VERIFY]')
    expect(refs).toContain('C00000')
  })

  it('embeds the logo on the title slide and section images beside their bullets', async () => {
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const { xml, zip } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest', {
      logo: { base64: png1x1, mime: 'image/png' },
      images: { sysdesign: png1x1 },
    }))
    expect(await xml(1)).toContain('<p:pic>')
    expect(await xml(9)).toContain('<p:pic>') // System Design slide
    expect(Object.keys(zip.files).some((n) => n.startsWith('ppt/media/'))).toBe(true)
  })

  it('splits image sections with the narrowed budget — full-width bullets that overflow the 7.2" body spill to (continued)', async () => {
    // Bullets that fit the 88-char/line full-width budget but overflow the
    // ~53-char/line budget that applies when a section image narrows the body.
    const narrowFit: SlideContent = {
      ...content,
      bullets: {
        ...content.bullets,
        methodology: Array.from({ length: 8 }, () => 'A '.repeat(30).trim()), // 59 chars: 1 line full-width, 2 lines narrowed
        implementation: Array.from({ length: 8 }, () => 'I '.repeat(30).trim()),
      },
    }
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const withoutImage = await slidesOf(await buildPptx(project, chapters, '', narrowFit, references, 'forest'))
    expect(withoutImage.names).toHaveLength(15) // methodology fits on one slide at full width (no Q&A slides)
    const withImage = await slidesOf(await buildPptx(project, chapters, '', narrowFit, references, 'forest', {
      images: { methodology: png1x1 },
    }))
    const titles = await Promise.all(withImage.names.map((_, i) => withImage.xml(i + 1)))
    expect(titles.some((t) => t.includes('Methodology (continued)'))).toBe(true)
    expect(withImage.names.length).toBeGreaterThan(withoutImage.names.length)
  })

  it('skips sections with no bullets and works without logo/images', async () => {
    const thin: SlideContent = { aim: 'One aim.', bullets: { ...content.bullets, scope: [], significance: [], literature: [] }, notes: {}, images: [] }
    const { names } = await slidesOf(await buildPptx(project, chapters, '', thin, [], 'forest'))
    expect(names).toHaveLength(12) // title + 9 content + references (empty placeholder) + thank-you
  })

  it('renders the aim on its own slide when objectives bullets are empty', async () => {
    const aimOnly: SlideContent = {
      ...content,
      bullets: { ...content.bullets, objectives: [] },
    }
    const withAim = await slidesOf(await buildPptx(project, chapters, '', aimOnly, [], 'forest'))
    const titles = await Promise.all(withAim.names.map((_, i) => withAim.xml(i + 1)))
    const aimSlide = titles.find((t) => t.includes('Aim and Objectives'))
    expect(aimSlide).toBeTruthy()
    expect(aimSlide).toContain('Investigate theft reliably.')
    // One more content slide than with objectives bullets present: 12 content
    // sections minus the emptied objectives plus the aim-only slide = same 12.
    expect(withAim.names).toHaveLength(12 + 3) // title + 12 content + references + thank-you
  })
})

describe('slideContentFromChapters v2', () => {
  it('maps chapter sections mechanically into the v2 shape', () => {
    const c = slideContentFromChapters([
      { number: 1, title: 'INTRODUCTION', status: 'done' as const, sections: [
        { heading: 'Background of the Study', description: '' },
        { heading: 'Objectives of the Study', description: '' },
      ], text: '' },
      { number: 3, title: 'METHODOLOGY', status: 'done' as const, sections: [
        { heading: 'Research Design', description: '' },
      ], text: '' },
    ])
    expect(c.bullets.intro).toEqual(['Background of the Study'])
    expect(c.aim).toBe('Objectives of the Study')
    expect(c.bullets.methodology).toEqual(['Research Design'])
  })
})

describe('parseQaSlides (unchanged)', () => {
  it('still yields one slide per chapter block', () => {
    expect(parseQaSlides(defenseQa)).toHaveLength(2)
  })
})

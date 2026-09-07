// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptx } from './pptx'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const,
    sections: [{ heading: 'Background of the Study', description: 'context' }, { heading: 'Statement of the Problem', description: 'theft' }, { heading: 'Objectives of the Study', description: 'goals' }],
    text: 'CHAPTER ONE\n1.1 Background\nCampus theft is common.' },
  { number: 3, title: 'METHODOLOGY', status: 'done' as const, sections: [], text: 'CHAPTER THREE\nBuilt a system.' },
]
const defenseQa = 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'

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

describe('buildPptx', () => {
  it('produces a pptx with title slide, content slides, and Q&A appendix', async () => {
    const blob = await buildPptx(project, chapters, defenseQa)
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    // 8 core slides + 2 Q&A slides (one per chapter)
    expect(slideNames.length).toBeGreaterThanOrEqual(10)
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(slide1).toContain('IoT-based theft detection')
    const qaSlide = await zip
      .file('ppt/slides/slide10.xml')!.async('string') // 1 title + 7 core + 1 thank-you come first
    expect(qaSlide).toContain('Why this topic?')
  })
})

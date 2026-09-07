// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildDocx, referencesSection } from './docx'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const,
    sections: [], text: 'CHAPTER ONE\n1.1 Background of the Study\nNigeria faces theft.\n\nReferences\nDoe, J. (2020). Sensors in Africa. Journal of Things, 5(2), 10–20.' },
  { number: 2, title: 'LITERATURE REVIEW', status: 'done' as const, sections: [], text: 'CHAPTER TWO\nPrior work exists.' },
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
    const blob = await buildDocx(project, chapters, 'An abstract.')
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('BAYERO UNIVERSITY KANO') // title page uppercases the university
    expect(doc).toContain('IoT-based theft detection')
    expect(doc).toContain('Aisha Musa')
    expect(doc).toContain('Nigeria faces theft.')
    expect(doc).toContain('verify before submission')
  })
})

describe('referencesSection', () => {
  it('collects References blocks from chapter texts and appends the verify label', () => {
    const refs = referencesSection(chapters)
    expect(refs).toContain('Doe, J. (2020).')
    expect(refs).toContain('verify before submission')
  })
})

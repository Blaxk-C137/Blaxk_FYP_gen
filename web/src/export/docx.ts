import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun,
} from 'docx'
import type { Chapter, ProjectInfo } from '../state/store'

export const REFERENCES_LABEL = 'AI-generated references — verify before submission.'

/** Extracts any "References" section from chapter texts; synthesizes one if absent. */
export function referencesSection(chapters: Chapter[]): string {
  const collected: string[] = []
  for (const ch of chapters) {
    const idx = ch.text.lastIndexOf('References')
    if (idx !== -1 && idx < ch.text.length) {
      collected.push(ch.text.slice(idx + 'References'.length).trim())
    }
  }
  const body = collected.length
    ? collected.join('\n\n')
    : 'No references were generated. Add your references here in APA 7 format.'
  return `${body}\n\n${REFERENCES_LABEL}`
}

const body = (text: string, opts: { bold?: boolean; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    heading: opts.heading,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { line: 480 }, // double spacing
    children: [new TextRun({ text, bold: opts.bold, font: 'Times New Roman', size: 24 })], // 12pt = 24 half-points
  })

export async function buildDocx(
  project: ProjectInfo,
  chapters: Chapter[],
  abstract: string
): Promise<Blob> {
  const children: Paragraph[] = []

  // Title page
  children.push(body(project.university.toUpperCase(), { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }))
  children.push(body(project.department, { align: AlignmentType.CENTER }))
  children.push(body('', {}))
  children.push(body(project.topic, { bold: true, align: AlignmentType.CENTER }))
  children.push(body('by', { align: AlignmentType.CENTER }))
  children.push(body(`${project.studentName} (${project.matric})`, { align: AlignmentType.CENTER }))
  children.push(body('', {}))
  children.push(body(`A ${project.degree} Final Year Project Report`))
  children.push(body(`Supervisor: ${project.supervisor}`, { align: AlignmentType.CENTER }))
  children.push(body(project.session, { align: AlignmentType.CENTER }))

  // Abstract + TOC heading
  children.push(body('ABSTRACT', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }))
  children.push(body(abstract || 'Abstract pending generation.'))
  children.push(body('TABLE OF CONTENTS', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }))
  for (const ch of chapters) {
    children.push(body(`CHAPTER ${toWord(ch.number)}: ${ch.title}`, { bold: true }))
  }
  children.push(body('REFERENCES', { bold: true }))

  // Chapters
  for (const ch of chapters) {
    if (!ch.text) continue
    for (const line of ch.text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (/^CHAPTER\s+/i.test(t)) children.push(body(t.toUpperCase(), { bold: true, heading: HeadingLevel.HEADING_1, align: AlignmentType.LEFT }))
      else if (/^\d+\.\d+/.test(t)) children.push(body(t, { heading: HeadingLevel.HEADING_2, align: AlignmentType.LEFT }))
      else children.push(body(t))
    }
  }

  // References
  children.push(body('REFERENCES', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }))
  for (const ref of referencesSection(chapters).split('\n')) {
    const t = ref.trim()
    if (t) children.push(body(t, { align: AlignmentType.LEFT }))
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  })
  return Packer.toBlob(doc)
}

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
function toWord(n: number): string {
  return WORDS[n - 1] ?? String(n)
}

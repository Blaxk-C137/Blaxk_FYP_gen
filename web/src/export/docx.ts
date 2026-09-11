import {
  AlignmentType, Document, Footer, HeadingLevel, NumberFormat, PageNumber,
  Packer, Paragraph, TableOfContents, TextRun,
} from 'docx'
import type { Chapter, ProjectInfo } from '../state/store'

export const REFERENCES_LABEL = 'AI-generated references — verify before submission.'
const NO_REFERENCES_PLACEHOLDER =
  'No references were collected. Add your references here in APA 7 format.'

/**
 * Composes the document references section: de-duplicated, alphabetized store
 * references (populated by Layer 2 extraction) plus the verification label.
 */
export function referencesSection(chapters: Chapter[] = [], references: string[] = []): string {
  void chapters // kept for signature stability; references now come from the store
  const unique = Array.from(new Set(references.map((r) => r.trim()))).filter(Boolean)
  unique.sort((a, b) => a.localeCompare(b))
  const body = unique.length ? unique.join('\n\n') : NO_REFERENCES_PLACEHOLDER
  return `${body}\n\n${REFERENCES_LABEL}`
}

const body = (text: string, opts: { bold?: boolean; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; pageBreakBefore?: boolean } = {}) =>
  new Paragraph({
    heading: opts.heading,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    pageBreakBefore: opts.pageBreakBefore,
    spacing: { line: 480 }, // double spacing
    children: [new TextRun({ text, bold: opts.bold, font: 'Times New Roman', size: 24 })], // 12pt = 24 half-points
  })

// 1-inch margins.
const PAGE = { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }

/** Footer with centered page numbers. */
function numberedFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font: 'Times New Roman', size: 24 }),
        ],
      }),
    ],
  })
}

/**
 * Layer 3 of the chapter-guardrails design — deterministic export composition.
 * The model never decides document furniture: code composes the title page,
 * abstract, table of contents, page numbering, page breaks, and the trailing
 * references section (after any questionnaire appendix).
 *
 * Two Word sections: preliminary pages (roman-numeral footer), body
 * (Arabic numerals restarting at 1). The TOC is a real Word field over
 * Heading 1/2 so entries render with page numbers.
 */
export async function buildDocx(
  project: ProjectInfo,
  chapters: Chapter[],
  abstract: string,
  references: string[] = []
): Promise<Blob> {
  // ---- Preliminary section: title page, abstract, TOC (roman numerals) ----
  const prelim: (Paragraph | TableOfContents)[] = []
  prelim.push(body(project.university.toUpperCase(), { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1 }))
  prelim.push(body(project.courseOfStudy ?? project.department, { align: AlignmentType.CENTER }))
  prelim.push(body('', {}))
  prelim.push(body(project.topic, { bold: true, align: AlignmentType.CENTER }))
  prelim.push(body('by', { align: AlignmentType.CENTER }))
  prelim.push(body(`${project.studentName} (${project.matric})`, { align: AlignmentType.CENTER }))
  prelim.push(body('', {}))
  prelim.push(body(`A ${project.degree} Final Year Project Report`, { align: AlignmentType.CENTER }))
  prelim.push(body(`Supervisor: ${project.supervisor}`, { align: AlignmentType.CENTER }))
  prelim.push(body(project.session, { align: AlignmentType.CENTER }))

  prelim.push(body('ABSTRACT', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }))
  prelim.push(body(abstract || 'Abstract pending generation.'))

  prelim.push(body('TABLE OF CONTENTS', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }))
  prelim.push(new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-2',
  }))

  // ---- Body section: chapters (+ appendix), references (Arabic, restart at 1) ----
  const bodyChildren: Paragraph[] = []
  for (const ch of chapters) {
    if (!ch.text) continue
    let firstHeading = true
    for (const line of ch.text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (/^CHAPTER\s+/i.test(t)) {
        bodyChildren.push(body(t.toUpperCase(), { bold: true, heading: HeadingLevel.HEADING_1, align: AlignmentType.LEFT, pageBreakBefore: true }))
        firstHeading = false
      } else if (/^APPENDIX/i.test(t)) {
        bodyChildren.push(body(t.toUpperCase(), { bold: true, heading: HeadingLevel.HEADING_1, align: AlignmentType.LEFT, pageBreakBefore: firstHeading }))
        firstHeading = false
      } else if (/^\d+\.\d+/.test(t)) {
        bodyChildren.push(body(t, { heading: HeadingLevel.HEADING_2, align: AlignmentType.LEFT }))
      } else {
        bodyChildren.push(body(t))
      }
    }
  }

  // References — always last.
  bodyChildren.push(body('REFERENCES', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }))
  for (const ref of referencesSection(chapters, references).split('\n')) {
    const t = ref.trim()
    if (t) bodyChildren.push(body(t, { align: AlignmentType.LEFT }))
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    features: { updateFields: true }, // Word offers to refresh the TOC field on open
    sections: [
      {
        // NB: this docx version reads pageNumbers from inside `page`
        properties: { page: { ...PAGE, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
        footers: { default: numberedFooter() },
        children: prelim,
      },
      {
        properties: { page: { ...PAGE, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
        footers: { default: numberedFooter() },
        children: bodyChildren,
      },
    ],
  })
  return Packer.toBlob(doc)
}

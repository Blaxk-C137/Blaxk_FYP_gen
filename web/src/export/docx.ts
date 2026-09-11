import {
  AlignmentType, Document, Footer, HeadingLevel, ImageRun, LevelFormat,
  NumberFormat, PageNumber, Packer, Paragraph, Table, TableCell, TableRow,
  TableOfContents, TextRun, WidthType,
} from 'docx'
import type { Chapter, ProjectInfo } from '../state/store'
import { parseBlocks, parseInline } from './markdown'
import type { Block, Run } from './markdown'
import { renderChartPng } from './chart'

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

/** Paragraph built from markdown runs (bold/italic become Word formatting). */
const bodyRuns = (runs: Run[]) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 480 },
    children: runs.map((r) =>
      new TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: 'Times New Roman', size: 24 })),
  })

const cell = (text: string, bold = false) =>
  new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold, font: 'Times New Roman', size: 24 })],
    })],
  })

/** Markdown pipe table → real Word table (header row bold). */
function markdownTable(block: Extract<Block, { kind: 'table' }>): Table {
  const width = block.header.length
  const rows = block.rows.map((r) => {
    const padded = [...r]
    while (padded.length < width) padded.push('')
    return new TableRow({ children: padded.slice(0, width).map((c) => cell(c)) })
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: block.header.map((h) => cell(h, true)) }), ...rows],
  })
}

/** Chart PNG canvas is 900×520; scale to a 6.5"-wide friendly size for Word. */
const CHART_W = 550
const CHART_H = Math.round((CHART_W * 520) / 900)

/**
 * Renders one parsed chapter-text block as Word children (paragraphs or a
 * table). Figures are captioned per chapter (Figure 4.1 style).
 */
function chapterBlockChildren(block: Block, chapterNumber: number, figureNo: number): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'chapter':
    case 'section':
    case 'para':
      return [block.kind === 'para'
        ? bodyRuns(block.runs)
        : body(block.text, {
            bold: true,
            heading: block.kind === 'chapter' ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
            align: AlignmentType.LEFT,
          })]
    case 'list':
      return block.items.map((item) =>
        new Paragraph({
          spacing: { line: 480 },
          ...(block.ordered
            ? { numbering: { reference: 'fyp-ordered', level: 0 } }
            : { bullet: { level: 0 } }),
          children: parseInline(item).map((r) =>
            new TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: 'Times New Roman', size: 24 })),
        }))
    case 'table':
      return [markdownTable(block)]
    case 'chart': {
      const out: (Paragraph | Table)[] = []
      const dataUrl = renderChartPng(block.chart)
      if (dataUrl) {
        const base64 = dataUrl.split(',')[1] ?? ''
        out.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: 'png',
            data: base64,
            transformation: { width: CHART_W, height: CHART_H },
          })],
        }))
      } else {
        // No canvas (or bad spec): visible placeholder, never raw JSON.
        out.push(body(
          `[INSERT CHART HERE — create this chart ("${block.chart.title ?? 'chart'}") from your real data]`,
          { align: AlignmentType.CENTER }
        ))
      }
      out.push(body(`Figure ${chapterNumber}.${figureNo}: ${block.chart.title ?? 'Chart'}`, { align: AlignmentType.CENTER }))
      return out
    }
    case 'figure': {
      return [
        body('[INSERT FIGURE HERE]', { bold: true, align: AlignmentType.CENTER }),
        body(`Figure ${chapterNumber}.${figureNo}: ${block.description}`, { align: AlignmentType.CENTER }),
      ]
    }
  }
}

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
  const bodyChildren: (Paragraph | Table)[] = []
  for (const ch of chapters) {
    if (!ch.text) continue
    let figureNo = 0
    for (const block of parseBlocks(ch.text)) {
      if (block.kind === 'chapter') {
        bodyChildren.push(body(block.text, {
          bold: true,
          heading: HeadingLevel.HEADING_1,
          align: AlignmentType.LEFT,
          pageBreakBefore: true,
        }))
        continue
      }
      if (block.kind === 'chart' || block.kind === 'figure') figureNo++
      bodyChildren.push(...chapterBlockChildren(block, ch.number, figureNo))
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
    numbering: {
      config: [{
        reference: 'fyp-ordered',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
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

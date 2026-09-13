import {
  AlignmentType, Document, Footer, HeadingLevel, ImageRun, LevelFormat,
  NumberFormat, PageNumber, Packer, Paragraph, Table, TableCell, TableRow,
  TableOfContents, TextRun, WidthType,
} from 'docx'
import type { Chapter, ProjectInfo, ReferenceEntry } from '../state/store'
import { parseBlocks, parseInline } from './markdown'
import type { Block, Run } from './markdown'
import { renderChartPng } from './chart'
import { estimateTocEntries } from './tocPages'
import { injectTocCache } from './tocInject'

export const REFERENCES_LABEL = 'AI-generated references — verify before submission.'
const NO_REFERENCES_PLACEHOLDER =
  'No references were collected. Add your references here in APA 7 format.'

/**
 * Composes the document references section from typed entries: de-duplicated,
 * alphabetized store references (populated by Layer 2 extraction) plus the
 * verification label. Unverified entries carry a `[VERIFY] ` prefix.
 */
export function referencesSection(_chapters: Chapter[] = [], references: ReferenceEntry[] = []): string {
  void _chapters
  const unique = new Map<string, ReferenceEntry>()
  for (const r of references) if (r.apa.trim()) unique.set(r.apa.trim(), r)
  const sorted = [...unique.values()].sort((a, b) => a.apa.localeCompare(b.apa))
  const body = sorted.length
    ? sorted.map((r) => `${r.verified ? '' : '[VERIFY] '}${r.apa}`).join('\n\n')
    : NO_REFERENCES_PLACEHOLDER
  return `${body}\n\n${REFERENCES_LABEL}`
}

/** Optional behaviours injected by callers (e.g. the Export screen). */
export interface DocxOptions {
  /** Returns a base64 PNG for a figure prompt, or null to keep the placeholder. */
  imageFor?: (prompt: string) => Promise<string | null>
}

const body = (text: string, opts: { bold?: boolean; color?: string; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; pageBreakBefore?: boolean } = {}) =>
  new Paragraph({
    heading: opts.heading,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    pageBreakBefore: opts.pageBreakBefore,
    spacing: { line: 480 }, // double spacing
    children: [new TextRun({ text, bold: opts.bold, color: opts.color, font: 'Times New Roman', size: 24 })], // 12pt = 24 half-points
  })

/** Attention paragraph: red bold — bracketed user-action placeholders. */
const attention = (text: string, opts: Parameters<typeof body>[1] = {}) =>
  body(text, { ...opts, bold: true, color: 'C00000' })

/** Paragraph built from markdown runs (bold/italic become Word formatting). */
const toTextRun = (r: Run) =>
  new TextRun({
    text: r.text, bold: r.bold || r.attention, italics: r.italic,
    color: r.attention ? 'C00000' : undefined,
    font: 'Times New Roman', size: 24,
  })

const bodyRuns = (runs: Run[]) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 480 },
    children: runs.map(toTextRun),
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

/** Shared level definition for ordered-list numbering instances. */
function orderedLevel() {
  return {
    level: 0,
    format: LevelFormat.DECIMAL,
    text: '%1.',
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  } as const
}

/**
 * Renders one parsed chapter-text block as Word children (paragraphs or a
 * table). Figures are captioned per chapter (Figure 4.1 style). Ordered lists
 * take a per-list numbering reference so each list restarts at 1. Figure blocks
 * look up their pre-generated image (keyed `${chapterNumber}:${blockIndex}`)
 * and fall back to the insert-here placeholder when it is missing.
 */
function chapterBlockChildren(
  block: Block, chapterNumber: number, figureNo: number, numRef: string,
  blockIndex: number, figureImages: Map<string, string>
): (Paragraph | Table)[] {
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
            ? { numbering: { reference: numRef, level: 0 } }
            : { bullet: { level: 0 } }),
          children: parseInline(item).map(toTextRun),
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
        out.push(attention(
          `[INSERT CHART HERE — create this chart ("${block.chart.title ?? 'chart'}") from your real data]`,
          { align: AlignmentType.CENTER }
        ))
      }
      out.push(body(`Figure ${chapterNumber}.${figureNo}: ${block.chart.title ?? 'Chart'}`, { align: AlignmentType.CENTER }))
      return out
    }
    case 'figure': {
      const img = figureImages.get(`${chapterNumber}:${blockIndex}`)
      if (img) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({
              type: 'png',
              data: img,
              transformation: { width: CHART_W, height: CHART_H },
            })],
          }),
          body(`Figure ${chapterNumber}.${figureNo}: ${block.description}`, { align: AlignmentType.CENTER }),
        ]
      }
      return [
        attention('[INSERT FIGURE HERE]', { align: AlignmentType.CENTER }),
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
  references: ReferenceEntry[] = [],
  opts: DocxOptions = {}
): Promise<Blob> {
  // ---- Preliminary section: title page, abstract, TOC (roman numerals) ----
  const prelim: (Paragraph | TableOfContents)[] = []
  // Preliminary headings are plain bold paragraphs (not Heading styles) so the
  // live TOC field covers chapters, sections, and REFERENCES only.
  prelim.push(body(project.university.toUpperCase(), { bold: true, align: AlignmentType.CENTER }))
  prelim.push(body(project.courseOfStudy ?? project.department, { align: AlignmentType.CENTER }))
  prelim.push(body('', {}))
  prelim.push(body(project.topic, { bold: true, align: AlignmentType.CENTER }))
  prelim.push(body('by', { align: AlignmentType.CENTER }))
  prelim.push(body(`${project.studentName} (${project.matric})`, { align: AlignmentType.CENTER }))
  prelim.push(body('', {}))
  prelim.push(body(`A ${project.degree} Final Year Project Report`, { align: AlignmentType.CENTER }))
  prelim.push(body(`Supervisor: ${project.supervisor}`, { align: AlignmentType.CENTER }))
  prelim.push(body(project.session, { align: AlignmentType.CENTER }))

  prelim.push(body('ABSTRACT', { bold: true, align: AlignmentType.CENTER, pageBreakBefore: true }))
  prelim.push(body(abstract || 'Abstract pending generation.'))

  prelim.push(body('TABLE OF CONTENTS', { bold: true, align: AlignmentType.CENTER, pageBreakBefore: true }))
  prelim.push(new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-2',
  }))

  // ---- Body section: chapters (+ appendix), references (Arabic, restart at 1) ----
  // Pre-generate figure images in parallel (cap 3) so blocks render with data.
  const figureBlocks: { chapterNumber: number; index: number; prompt: string }[] = []
  for (const ch of chapters) {
    if (!ch.text) continue
    parseBlocks(ch.text).forEach((b, i) => {
      if (b.kind === 'figure') figureBlocks.push({ chapterNumber: ch.number, index: i, prompt: b.description })
    })
  }
  const figureImages = new Map<string, string>()
  if (opts.imageFor) {
    for (let i = 0; i < figureBlocks.length; i += 3) {
      const batch = figureBlocks.slice(i, i + 3)
      const results = await Promise.all(
        batch.map(async (f) => [`${f.chapterNumber}:${f.index}`, await opts.imageFor!(f.prompt)] as const)
      )
      for (const [k, v] of results) if (v) figureImages.set(k, v)
    }
  }

  const bodyChildren: (Paragraph | Table)[] = []
  let listCount = 0
  for (const ch of chapters) {
    if (!ch.text) continue
    let figureNo = 0
    const blocks = parseBlocks(ch.text)
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]
      if (block.kind === 'chapter') {
        bodyChildren.push(body(block.text, {
          bold: true,
          heading: HeadingLevel.HEADING_1,
          align: AlignmentType.LEFT,
          pageBreakBefore: true,
        }))
        continue
      }
      if (block.kind === 'list' && block.ordered) listCount++
      if (block.kind === 'chart' || block.kind === 'figure') figureNo++
      bodyChildren.push(...chapterBlockChildren(
        block, ch.number, figureNo,
        block.kind === 'list' && block.ordered ? `fyp-ordered-${listCount}` : 'fyp-ordered',
        blockIndex, figureImages
      ))
    }
  }

  // References — always last.
  bodyChildren.push(body('REFERENCES', { bold: true, align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }))
  for (const line of referencesSection(chapters, references).split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t === REFERENCES_LABEL) bodyChildren.push(attention(t, { align: AlignmentType.LEFT }))
    else if (t.startsWith('[VERIFY] ')) {
      bodyChildren.push(new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 480 },
        children: [
          new TextRun({ text: '[VERIFY] ', bold: true, color: 'C00000', font: 'Times New Roman', size: 24 }),
          new TextRun({ text: t.slice('[VERIFY] '.length), font: 'Times New Roman', size: 24 }),
        ],
      }))
    } else {
      bodyChildren.push(body(t, { align: AlignmentType.LEFT }))
    }
  }

  // Each ordered list gets its own numbering instance (fyp-ordered-1, -2, …)
  // so Word restarts at 1 per list instead of running one list throughout.
  const numberingConfig = [
    { reference: 'fyp-ordered', levels: [orderedLevel()] },
    ...Array.from({ length: listCount }, (_, i) => ({
      reference: `fyp-ordered-${i + 1}`, levels: [orderedLevel()],
    })),
  ]

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    features: { updateFields: true }, // Word offers to refresh the TOC field on open
    numbering: { config: numberingConfig },
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
  const blob = await Packer.toBlob(doc)
  // Cache estimated TOC entries inside the field so viewers that never update
  // fields (LibreOffice, Google Docs, previews) still show a real TOC.
  const referencesCount = references.filter((r) => r.apa.trim()).length
  return injectTocCache(blob, estimateTocEntries(chapters, referencesCount))
}

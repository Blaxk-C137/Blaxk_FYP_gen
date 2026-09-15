import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo, ReferenceEntry } from '../state/store'
import type { SlideContent, SlideKey } from '../ai/parseSlides'
import { THEMES, type SlideTheme, type ThemeId } from './themes'

// ---------------------------------------------------------------------------
// Q&A appendix — chapter blocks paginated into slide-sized pages
// ---------------------------------------------------------------------------

// Q&A slides render at 18pt across the full 11.93" body (vs 24pt for content):
// ~117 chars/line and ≤ 14 lines fit the 5.2" text box without bleeding.
export const QA_CHARS_PER_LINE = 117
export const QA_MAX_LINES = 14

/** Parses defenseQa text into slide-sized pages. Chapter blocks accept digit
 *  and word forms ("Chapter 3", "CHAPTER THREE"); a block whose Q/A lines
 *  exceed one slide continues onto "(continued)" slides, so a 20-question
 *  appendix can never bleed off the edge. */
export function parseQaSlides(defenseQa: string): { title: string; body: string[] }[] {
  const slides: { title: string; body: string[] }[] = []
  if (!defenseQa.trim()) return slides
  const blocks = defenseQa.split(/\n(?=chapter\s+(?:[1-5]|one|two|three|four|five)\b)/i)
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const questions = lines.filter((l) => /^(Q:|A:)/i.test(l))
    if (!questions.length) continue
    const heading = /^chapter\b/i.test(lines[0]) ? lines[0].slice(0, 40) : ''
    const base = `Q&A Prep${heading ? ` — ${heading}` : ''}`
    let current: string[] = []
    let usedLines = 0
    let page = 0
    const push = () => {
      if (!current.length) return
      slides.push({ title: page > 0 ? `${base} (continued)` : base, body: current })
      current = []
      usedLines = 0
      page++
    }
    for (const q of questions) {
      const itemLines = Math.max(1, Math.ceil(q.length / QA_CHARS_PER_LINE))
      if (current.length && usedLines + itemLines > QA_MAX_LINES) push()
      current.push(q)
      usedLines += itemLines
    }
    push()
  }
  return slides
}

// ---------------------------------------------------------------------------
// Deterministic fallback — section headings mapped into the v2 slide-content shape
// ---------------------------------------------------------------------------

/** Mechanical mapping used when the AI structuring call fails — the deck still
 *  gets the themed layout, just with section headings as bullets. */
export function slideContentFromChapters(chapters: Chapter[]): SlideContent {
  const headings = (n: number, needles: string[]): string[] => {
    const ch = chapters.find((c) => c.number === n)
    if (!ch) return []
    return ch.sections
      .filter((s) => needles.length === 0 || needles.some((p) => s.heading.toLowerCase().includes(p)))
      .map((s) => s.heading)
  }
  const objectives = headings(1, ['objective'])
  return {
    aim: objectives[0] ?? '',
    bullets: {
      intro: headings(1, ['background', 'introduction']),
      problem: headings(1, ['problem']),
      objectives: objectives.slice(1),
      scope: headings(1, ['scope']),
      significance: headings(1, ['significance']),
      literature: headings(2, []).slice(0, 6),
      methodology: headings(3, []).slice(0, 6),
      sysdesign: headings(3, ['design', 'architecture', 'system']),
      implementation: headings(3, ['implement', 'tool']),
      results: headings(4, ['finding', 'result']),
      discussion: headings(4, ['discussion']),
      conclusion: headings(5, ['conclusion', 'summary']),
    },
    notes: {},
    images: [],
  }
}

// ---------------------------------------------------------------------------
// Deck builder — the example deck's methodology (13.33×7.5", footer strips,
// per-section slides with (continued) overflow, speaker notes, references)
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<SlideKey, string> = {
  intro: 'Introduction / Background',
  problem: 'Problem Statement',
  objectives: 'Aim and Objectives',
  scope: 'Scope of the Study',
  significance: 'Significance of the Study',
  literature: 'Literature Review',
  methodology: 'Methodology',
  sysdesign: 'System Design / Architecture',
  implementation: 'Implementation / Tools & Technologies',
  results: 'Results / Findings',
  discussion: 'Discussion of Results',
  conclusion: 'Conclusion & Recommendations',
}

// ---- no-bleed budget: 24pt Arial across ~11.7" ≈ 88 chars/line, ~12 lines ----
const CHARS_PER_LINE = 88
const MAX_LINES = 12

/** Splits bullets into page-sized groups. Pure, deterministic. The per-line
 *  character budget defaults to the full body width; sections narrowed by a
 *  side image pass a proportionally smaller budget so nothing bleeds. An empty
 *  section still yields one (empty) page — an aim-only objectives slide must
 *  render even when there are no objective bullets. */
export function splitBullets(items: string[], charsPerLine: number = CHARS_PER_LINE): string[][] {
  const pages: string[][] = []
  let current: string[] = []
  let lines = 0
  for (const item of items) {
    const itemLines = Math.max(1, Math.ceil(item.length / charsPerLine))
    if (current.length && lines + itemLines > MAX_LINES) {
      pages.push(current)
      current = []
      lines = 0
    }
    current.push(item)
    lines += itemLines
  }
  if (current.length) pages.push(current)
  return pages.length ? pages : [[]]
}

export async function buildPptx(
  project: ProjectInfo,
  _chapters: Chapter[],
  defenseQa: string,
  content: SlideContent,
  references: ReferenceEntry[],
  themeId: ThemeId,
  opts: { logo?: { base64: string; mime: string } | null; images?: Partial<Record<SlideKey, string>> } = {}
): Promise<Blob> {
  const T: SlideTheme = THEMES[themeId]
  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'FYP', width: 13.333, height: 7.5 })
  pptx.layout = 'FYP'

  const W = 13.333, H = 7.5, M = 0.7
  const FONT = 'Arial'

  // Count slides first for truthful footers: title, content (+ continued),
  // references (+ continued), thank-you, Q&A appendix.
  const sections = (Object.keys(SECTION_TITLES) as SlideKey[]).filter(
    (k) => content.bullets[k].length > 0 || (k === 'objectives' && content.aim)
  )
  // Sections with a side image render in a narrowed 7.2" body — their split
  // budget shrinks proportionally so bullets never bleed past the image column.
  const charsFor = (key: SlideKey): number =>
    opts.images?.[key] ? Math.floor(CHARS_PER_LINE * 7.2 / (W - M * 2)) : CHARS_PER_LINE
  const contentPageCount = sections.reduce((n, k) => n + splitBullets(content.bullets[k], charsFor(k)).length, 0)
  const refPages = Math.max(1, Math.ceil(references.length / 5))
  const qaSlides = parseQaSlides(defenseQa)
  const total = 1 + contentPageCount + refPages + 1 + qaSlides.length
  let n = 0

  const footer = (s: ReturnType<pptxgen['addSlide']>) => {
    n += 1
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.36, w: W, h: 0.04, fill: { color: T.accLight }, line: { type: 'none' } })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.32, w: W, h: 0.32, fill: { color: T.acc }, line: { type: 'none' } })
    s.addText(`${n}/${total}`, { x: W - 1.0, y: H - 0.33, w: 0.8, h: 0.3, fontSize: 10, color: 'FFFFFF', align: 'right', fontFace: FONT, isTextBox: true, margin: 0 })
  }

  const contentSlide = (title: string, items: string[], key?: SlideKey) => {
    const s = pptx.addSlide()
    const image = key ? opts.images?.[key] : undefined
    s.background = { color: 'FFFFFF' }
    s.addText(title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const bodyW = image ? 7.2 : W - M * 2
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), {
      x: 0.8, y: 1.9, w: bodyW, h: 5.0, fontSize: 24, color: T.tc, fontFace: FONT,
      isTextBox: true, valign: 'top', margin: 0, lineSpacingMultiple: 1.15,
    })
    if (image) {
      s.addImage({ data: `data:image/png;base64,${image}`, x: 8.3, y: 1.9, w: 4.3, h: 3.2 })
    }
    if (key && content.notes[key]) s.addNotes(content.notes[key]!)
    footer(s)
    return s
  }

  // ── 1: Title ────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    if (opts.logo) {
      s.addImage({ data: `data:${opts.logo.mime};base64,${opts.logo.base64}`, x: 0.8, y: 0.65, w: 1.0, h: 1.0 })
    }
    s.addText(project.university.toUpperCase(), { x: 2.0, y: 0.65, w: W - 2.0 - M, h: 0.5, fontSize: 20, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(`Department of ${project.department}`, { x: 2.0, y: 1.15, w: W - 2.0 - M, h: 0.4, fontSize: 14, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(project.topic, { x: 1.0, y: 2.6, w: W - 2.0, h: 1.8, align: 'center', fontSize: 30, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line1 = [project.studentName, project.matric, project.degree].filter(Boolean).join('   ·   ')
    s.addText(line1, { x: M, y: 4.6, w: W - M * 2, h: 0.5, align: 'center', fontSize: 16, bold: true, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line2 = [project.supervisor ? `Supervisor: ${project.supervisor}` : '', project.session].filter(Boolean).join('   ·   ')
    s.addText(line2, { x: M, y: 5.15, w: W - M * 2, h: 0.4, align: 'center', fontSize: 13, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('A Final Year Project Defense', { x: M, y: 6.4, w: W - M * 2, h: 0.35, align: 'center', fontSize: 12, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    footer(s)
  }

  // ── Content sections, each with (continued) overflow pages ─────────────
  for (const key of sections) {
    const pages = splitBullets(content.bullets[key], charsFor(key))
    pages.forEach((items, i) => {
      const title = SECTION_TITLES[key] + (i > 0 ? ' (continued)' : '')
      if (key === 'objectives') {
        // Aim gets a green lead-in label; objectives are the bullets.
        const s = pptx.addSlide()
        s.background = { color: 'FFFFFF' }
        s.addText(title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
        s.addText([
          { text: 'Aim:  ', options: { bold: true, color: T.acc, fontSize: 24 } },
          { text: content.aim, options: { color: T.tc, fontSize: 24, breakLine: true } },
          ...items.map((t, j) => ({ text: t, options: { bullet: true, color: T.tc, fontSize: 24, breakLine: j < items.length - 1 } })),
        ], { x: 0.8, y: 1.9, w: W - M * 2, h: 5.0, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0, lineSpacingMultiple: 1.15 })
        if (content.notes.objectives) s.addNotes(content.notes.objectives)
        footer(s)
      } else {
        contentSlide(title, items, key)
      }
    })
  }

  // ── References: alphabetized, 5 per slide, [VERIFY] red bold ────────────
  {
    const sorted = [...references].sort((a, b) => a.apa.localeCompare(b.apa))
    const pages = sorted.length
      ? Array.from({ length: Math.ceil(sorted.length / 5) }, (_, i) => sorted.slice(i * 5, i * 5 + 5))
      : [[]]
    pages.forEach((page, i) => {
      const s = pptx.addSlide()
      s.background = { color: 'FFFFFF' }
      s.addText('References' + (i > 0 ? ' (continued)' : ''), { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
      const runs = page.length
        ? page.flatMap((r) => {
            const base = [{ text: r.apa, options: { breakLine: true, fontSize: 18, color: T.tc } }]
            return r.verified
              ? base
              : [{ text: '[VERIFY] ', options: { bold: true, color: T.att, fontSize: 18 } }, ...base]
          })
        : [{ text: 'No references were collected.', options: { fontSize: 18, color: T.muted } }]
      s.addText(runs, { x: 0.8, y: 1.6, w: W - M * 2, h: 5.2, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0, paraSpaceAfter: 10 })
      footer(s)
    })
  }

  // ── Thank You ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    s.addText('Thank You', { x: M, y: 2.6, w: W - M * 2, h: 1.2, align: 'center', fontSize: 54, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Questions & discussion', { x: M, y: 3.9, w: W - M * 2, h: 0.5, align: 'center', fontSize: 18, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const info = [project.studentName, project.department, project.university].filter(Boolean).join('  ·  ')
    if (info) s.addText(info, { x: M, y: 6.6, w: W - M * 2, h: 0.35, align: 'center', fontSize: 12, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    footer(s)
  }

  // ── Q&A appendix (unchanged behavior) ───────────────────────────────────
  for (const qa of qaSlides) {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    s.addText(qa.title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 28, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(qa.body.map((line, i) => ({ text: line, options: { bullet: true, breakLine: i < qa.body.length - 1 } })), {
      x: 0.8, y: 1.6, w: W - M * 2, h: 5.2, fontSize: 18, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0,
    })
    footer(s)
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob
}

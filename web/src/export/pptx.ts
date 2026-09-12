import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo } from '../state/store'
import type { SlideContent } from '../ai/parseSlides'
import { THEMES, type SlideTheme, type ThemeId } from './themes'

// ---------------------------------------------------------------------------
// Q&A appendix (unchanged behavior from the first export version)
// ---------------------------------------------------------------------------

/** Parses defenseQa text into one slide per chapter block. */
export function parseQaSlides(defenseQa: string): { title: string; body: string[] }[] {
  const slides: { title: string; body: string[] }[] = []
  if (!defenseQa.trim()) return slides
  const blocks = defenseQa.split(/\n(?=Chapter \d)/i)
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const questions = lines.filter((l) => /^(Q:|A:)/.test(l))
    if (questions.length) slides.push({ title: `Q&A Prep — ${lines[0]}`, body: questions })
  }
  return slides
}

// ---------------------------------------------------------------------------
// Deterministic fallback — section headings mapped into the slide-content shape
// ---------------------------------------------------------------------------

const DEFAULT_OUTLINE = [
  'Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance',
  'Methodology', 'Results & Analysis', 'Conclusion & Recommendations',
]

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
    outline: DEFAULT_OUTLINE,
    bg: headings(1, ['background']),
    prob: headings(1, ['problem']),
    gen_obj: objectives[0] ?? '',
    spec_obj: objectives.slice(1),
    scope_pts: headings(1, ['scope']),
    sig_pts: headings(1, ['significance']),
    method: headings(3, []).slice(0, 4).map((title) => ({ title, detail: '' })),
    findings: headings(4, ['finding', 'result']),
    discuss: headings(4, ['discussion']),
    conc_pts: headings(5, ['conclusion', 'summary']),
    recs: headings(5, ['recommend']),
  }
}

// ---------------------------------------------------------------------------
// Themed deck builder — layout ported 1:1 from docs/test run/PPTgen.html
// ---------------------------------------------------------------------------

interface Run { text: string; options: Record<string, unknown> }

export async function buildPptx(
  project: ProjectInfo,
  _chapters: Chapter[],
  defenseQa: string,
  content: SlideContent,
  themeId: ThemeId
): Promise<Blob> {
  const T: SlideTheme = THEMES[themeId]
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9'

  const W = 10, H = 5.625, M = 0.5
  const FONT = 'Calibri'

  const qaSlides = parseQaSlides(defenseQa)
  const outline = content.outline.length ? content.outline : DEFAULT_OUTLINE

  // Which content groups have anything to show (empty groups are skipped).
  const has = {
    bgProb: content.bg.length + content.prob.length > 0,
    obj: content.gen_obj !== '' || content.spec_obj.length > 0,
    scopeSig: content.scope_pts.length + content.sig_pts.length > 0,
    method: content.method.some((m) => m.title || m.detail),
    results: content.findings.length + content.discuss.length > 0,
    concRecs: content.conc_pts.length + content.recs.length > 0,
  }
  const coreCount = 3 + Object.values(has).filter(Boolean).length // title + outline + thank-you + content slides
  const total = coreCount + qaSlides.length
  let n = 0

  const footer = (s: ReturnType<pptxgen['addSlide']>) => {
    n += 1
    s.addText(project.topic, { x: M, y: H - 0.33, w: W - 1.1, h: 0.26, fontSize: 7.5, color: T.ft, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(`${n}/${total}`, { x: W - 0.78, y: H - 0.33, w: 0.58, h: 0.26, fontSize: 7.5, color: T.ft, align: 'right', fontFace: FONT, isTextBox: true, margin: 0 })
    return s
  }

  const run = (text: string, isHead: boolean, isLast: boolean, isSpacer = false): Run =>
    isSpacer
      ? { text: ' ', options: { bullet: false, fontSize: 5, breakLine: true, color: T.cbg } }
      : {
          text,
          options: {
            bullet: !isHead, bold: isHead,
            fontSize: isHead ? 15 : 14,
            color: isHead ? T.sec : T.bc,
            paraSpaceAfter: isHead ? 4 : 7,
            breakLine: !isLast,
          },
        }

  const group = (head: string, points: string[], isLastGroup: boolean): Run[] => [
    run(head, true, false),
    ...points.map((p, i) => run(p, false, isLastGroup && i === points.length - 1)),
  ]

  /** Standard content slide: title bar + bullet runs + footer. */
  const contentSlide = (title: string, runs: Run[]) => {
    const s = pptx.addSlide()
    s.background = { color: T.cbg }
    s.addText(title, { x: M, y: 0.26, w: W - M * 2, h: 0.72, fontSize: 23, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    if (runs.length) {
      s.addText(runs, { x: M, y: 1.08, w: W - M * 2, h: H - 1.08 - 0.46, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 })
    }
    footer(s)
    return s
  }

  // ── 1: Title ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: T.sbg }
    n += 1
    if (project.university)
      s.addText(project.university.toUpperCase(), { x: M, y: 0.34, w: W - M * 2, h: 0.34, align: 'center', fontSize: 10.5, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    if (project.department)
      s.addText(`Department of ${project.department}`, { x: M, y: 0.68, w: W - M * 2, h: 0.28, align: 'center', fontSize: 10, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(project.topic, { x: 0.8, y: 1.18, w: W - 1.6, h: 2.1, align: 'center', fontSize: 30, bold: true, color: T.stxt, fontFace: FONT, isTextBox: true, margin: 0 })
    const line1 = [project.studentName, project.matric, project.degree].filter(Boolean).join('   ·   ')
    if (line1)
      s.addText(line1, { x: M, y: 3.42, w: W - M * 2, h: 0.36, align: 'center', fontSize: 13.5, bold: true, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line2 = [project.supervisor ? `Supervisor: ${project.supervisor}` : '', project.session].filter(Boolean).join('   ·   ')
    if (line2)
      s.addText(line2, { x: M, y: 3.86, w: W - M * 2, h: 0.3, align: 'center', fontSize: 11, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Final Year Project Defense', { x: M, y: H - 0.48, w: W - M * 2, h: 0.26, align: 'center', fontSize: 9.5, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
  }

  // ── 2: Outline ─────────────────────────────────────────────────────────
  contentSlide('Outline', outline.map((x, i) => run(`${i + 1}.  ${x}`, false, i === outline.length - 1)))

  // ── 3: Background & Problem ────────────────────────────────────────────
  if (has.bgProb) {
    contentSlide('Background & Problem Statement', [
      ...group('Background of the Study', content.bg, false),
      run(' ', false, false, true),
      ...group('Statement of the Problem', content.prob, true),
    ])
  }

  // ── 4: Objectives ──────────────────────────────────────────────────────
  if (has.obj) {
    contentSlide('Objectives of the Study', [
      ...group('General Objective', content.gen_obj ? [content.gen_obj] : [], false),
      run(' ', false, false, true),
      ...group('Specific Objectives', content.spec_obj, true),
    ])
  }

  // ── 5: Scope & Significance ────────────────────────────────────────────
  if (has.scopeSig) {
    contentSlide('Scope & Significance of the Study', [
      ...group('Scope of the Study', content.scope_pts, false),
      run(' ', false, false, true),
      ...group('Significance of the Study', content.sig_pts, true),
    ])
  }

  // ── 6: Methodology (2×2 grid) ──────────────────────────────────────────
  if (has.method) {
    const s = pptx.addSlide()
    s.background = { color: T.cbg }
    s.addText('Methodology', { x: M, y: 0.26, w: W - M * 2, h: 0.72, fontSize: 23, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const cW = (W - M * 2 - 0.28) / 2
    content.method.slice(0, 4).forEach((step, i) => {
      const col = i % 2, row = Math.floor(i / 2)
      const x = M + col * (cW + 0.28), y = 1.12 + row * 1.92
      s.addText(`${i + 1}`, { x, y, w: 0.38, h: 0.38, fill: { color: T.sf }, fontSize: 13, bold: true, color: T.sx, align: 'center', valign: 'middle', fontFace: FONT, isTextBox: true, margin: 0 })
      s.addText(step.title, { x: x + 0.48, y: y + 0.02, w: cW - 0.58, h: 0.34, fontSize: 13, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'middle', margin: 0 })
      if (step.detail)
        s.addText(step.detail, { x: x + 0.48, y: y + 0.4, w: cW - 0.58, h: 1.35, fontSize: 12, color: T.dt, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 })
    })
    footer(s)
  }

  // ── 7: Results & Analysis ──────────────────────────────────────────────
  if (has.results) {
    contentSlide('Results & Analysis', [
      ...group('Key Findings', content.findings, false),
      run(' ', false, false, true),
      ...group('Discussion of Findings', content.discuss, true),
    ])
  }

  // ── 8: Conclusion & Recommendations ────────────────────────────────────
  if (has.concRecs) {
    contentSlide('Conclusion & Recommendations', [
      ...group('Conclusion', content.conc_pts, false),
      run(' ', false, false, true),
      ...group('Recommendations', content.recs, true),
    ])
  }

  // ── 9: Thank You ───────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: T.sbg }
    n += 1 // no footer drawn, but the slide still occupies a position in n/total
    s.addText('Thank You', { x: M, y: 1.48, w: W - M * 2, h: 1.45, align: 'center', fontSize: 52, bold: true, color: T.stxt, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Questions, corrections and contributions are welcome.', { x: M, y: 3.1, w: W - M * 2, h: 0.44, align: 'center', fontSize: 14, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const info = [project.studentName, project.department, project.university].filter(Boolean).join('  ·  ')
    if (info)
      s.addText(info, { x: M, y: H - 0.46, w: W - M * 2, h: 0.28, align: 'center', fontSize: 9.5, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
  }

  // ── 10+: Q&A appendix ──────────────────────────────────────────────────
  for (const qa of qaSlides) {
    contentSlide(qa.title, qa.body.map((line, i) => run(line, false, i === qa.body.length - 1)))
  }

  const data = (await pptx.write({ outputType: 'blob' })) as Blob
  return data
}

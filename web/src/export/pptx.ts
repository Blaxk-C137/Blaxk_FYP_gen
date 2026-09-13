import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo } from '../state/store'
import type { SlideContent, SlideKey } from '../ai/parseSlides'
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
// Deck builder — transitional v2 mapping; the full example-deck layout
// (footer strips, auto-split, notes, references) lands in the next commit.
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

  const W = 10, M = 0.5
  const FONT = 'Arial'

  const title = pptx.addSlide()
  title.addText(project.topic, { x: M, y: 1.0, w: W - M * 2, h: 2.0, align: 'center', fontSize: 30, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
  title.addText(project.studentName, { x: M, y: 3.2, w: W - M * 2, h: 0.4, align: 'center', fontSize: 16, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })

  const sections = (Object.keys(SECTION_TITLES) as SlideKey[]).filter((k) => content.bullets[k].length > 0)
  for (const key of sections) {
    const s = pptx.addSlide()
    s.addText(SECTION_TITLES[key], { x: M, y: 0.4, w: W - M * 2, h: 0.6, fontSize: 28, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(
      content.bullets[key].map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < content.bullets[key].length - 1 } })),
      { x: 0.8, y: 1.4, w: W - M * 2, h: 3.8, fontSize: 20, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 }
    )
  }

  for (const qa of parseQaSlides(defenseQa)) {
    const s = pptx.addSlide()
    s.addText(qa.title, { x: M, y: 0.4, w: W - M * 2, h: 0.6, fontSize: 24, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(qa.body.join('\n'), { x: 0.8, y: 1.4, w: W - M * 2, h: 3.8, fontSize: 16, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 })
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob
}

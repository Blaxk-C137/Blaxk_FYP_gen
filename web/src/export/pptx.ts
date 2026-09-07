import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo } from '../state/store'

interface SimpleSlide { title: string; body: string[] }

/** Parses defenseQa text into one slide per chapter block. */
export function parseQaSlides(defenseQa: string): SimpleSlide[] {
  const slides: SimpleSlide[] = []
  const blocks = defenseQa.split(/\n(?=Chapter \d)/i)
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const questions = lines.filter((l) => /^(Q:|A:)/.test(l))
    if (questions.length) slides.push({ title: `Q&A Prep — ${lines[0]}`, body: questions })
  }
  return slides
}

function slideText(chapters: Chapter[], chapterNumber: number, sectionPrefixes: string[]): string[] {
  const ch = chapters.find((c) => c.number === chapterNumber)
  if (!ch) return []
  return ch.sections
    .filter((s) => sectionPrefixes.some((p) => s.heading.toLowerCase().startsWith(p)))
    .map((s) => s.heading)
}

export async function buildPptx(
  project: ProjectInfo,
  chapters: Chapter[],
  defenseQa: string
): Promise<Blob> {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9'

  const add = (title: string, body: string[]) => {
    const s = pptx.addSlide()
    s.addText(title, { x: 0.5, y: 0.4, fontSize: 28, bold: true, color: '1a1a2e' })
    s.addText(body.map((t) => ({ text: t, options: { bullet: true } })), {
      x: 0.5, y: 1.4, fontSize: 16, color: '333333',
    })
  }

  // 1. Title slide
  const title = pptx.addSlide()
  title.addText(project.topic, { x: 0.5, y: 1.6, fontSize: 30, bold: true, align: 'center', color: '1a1a2e' })
  title.addText(
    [project.studentName, `${project.department}, ${project.university}`, `Supervisor: ${project.supervisor} · ${project.session}`].join('\n'),
    { x: 0.5, y: 3.2, fontSize: 16, align: 'center', color: '555555' }
  )

  // 2–8. Core slides (each falls back to chapter title bullets when sections don't match)
  const ch = (n: number) => chapters.find((c) => c.number === n)
  add('Background & Problem', slideText(chapters, 1, ['background', 'statement of the problem', 'problem']))
  add('Objectives of the Study', slideText(chapters, 1, ['objective', 'aim', 'purpose']))
  add('Scope of the Study', slideText(chapters, 1, ['scope', 'limitation', 'significance']))
  add('Methodology', ch(3)?.sections.map((s) => s.heading) ?? ['System design', 'Implementation', 'Testing'])
  add('Results & Analysis', ch(4)?.sections.map((s) => s.heading) ?? ['Key findings', 'Performance evaluation'])
  add('Conclusion', ch(5)?.sections.filter((s) => /conclusion|summary/.test(s.heading)).map((s) => s.heading) ?? ['Summary of findings'])
  add('Recommendations', ch(5)?.sections.filter((s) => /recommend/.test(s.heading)).map((s) => s.heading) ?? ['Future work'])

  // 9. Thank you
  add('Thank You', ['Questions, corrections and contributions are welcome.'])

  // 10+. Q&A prep appendix
  for (const qa of parseQaSlides(defenseQa)) add(qa.title, qa.body)

  const data = (await pptx.write({ outputType: 'blob' })) as Blob
  return data
}

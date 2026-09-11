import type { Chapter, ProjectInfo, LengthPreset } from './state/store'
import { trackFor } from './ai/tracks'
import type { Track } from './ai/tracks'

// ---------------------------------------------------------------------------
// Length presets — calibrated to ~250 words per double-spaced page (A4, 12pt).
// budgets[chapterIndex] is the target word count for that chapter.
// ---------------------------------------------------------------------------

export interface LengthBudget { label: string; pages: string; budgets: [number, number, number, number, number] }

export const LENGTH_PRESETS: Record<LengthPreset, LengthBudget> = {
  compact: { label: 'Compact (~35 pages)', pages: '≈35 pages · 8,500 words', budgets: [1500, 2000, 1500, 2000, 1500] },
  standard: { label: 'Standard (~50 pages)', pages: '≈50 pages · 12,500 words', budgets: [2000, 3000, 2500, 3000, 2000] },
  detailed: { label: 'Detailed (~70 pages)', pages: '≈70 pages · 17,500 words', budgets: [2500, 4000, 3500, 4500, 3000] },
}

/** The maximum acceptable length before the overshoot retry fires. */
export const OVERSHOOT_FACTOR = 1.25

export function chapterBudget(preset: LengthPreset, chapterNumber: number): number {
  return LENGTH_PRESETS[preset].budgets[chapterNumber - 1] ?? 3000
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const MARKUP_RULES = [
  'Use markdown for emphasis: **bold** for key terms, *italic* for titles of works and emphasis.',
  'Present tabular data as markdown pipe tables.',
  'Use "-" bullet lists and "1." numbered lists where they aid clarity.',
  'For any data visualization, emit a fenced code block tagged chart containing a single JSON object on one line:',
  '```chart\n{"type": "bar|pie|line", "title": "Figure title", "ylabel": "optional axis label", "data": {"Category": 123, ...}}\n```',
  'Use chart blocks for distributions and comparisons that read better graphically; keep the corresponding values in a table or text as well.',
  'For diagrams and illustrations (architecture, flow, setup), emit a fenced code block tagged figure containing a one-to-two-sentence description of the diagram to generate. Use figures sparingly — at most one per chapter.',
  'Never write HTML, LaTeX, or ASCII-art diagrams.',
]

export function systemPrompt(track: Track): string {
  const titles = track.chapterTitles.map((t, i) => `CHAPTER ${toWord(i + 1)} (${t})`).join(', ')
  return [
    'You are an expert academic supervisor at a Nigerian university writing assistant content for final year projects.',
    `You produce work in the standard Nigerian five-chapter format: ${titles}.`,
    'Write as a strong Nigerian final-year student would: formal academic register, clear, direct — never stilted or padded.',
    'Use APA 7 in-text citations where claims need sources. Include Nigerian context where natural (Nigerian universities, institutions, infrastructure, market data).',
    'Citation integrity: cite only genuinely well-known real works. Never invent authors, years, journals, page numbers, DOIs, or URLs. When unsure of a real source, write [INSERT VERIFIED CITATION HERE] instead of a plausible-looking fake.',
    'Structure: each chapter begins with "CHAPTER <WORD>" on its own line, followed by sections numbered {N}.1, {N}.2, … that follow the chapter number. Never number sections with a different chapter’s number. Do not repeat a heading within a chapter.',
    'Never write a REFERENCES list inside a chapter — cite in-text only; the document’s references section is composed separately.',
    'Never write a table of contents, title page, or preliminary pages — the app composes those.',
    'Formal, objective, technical register. No dramatic or sensational language.',
    ...MARKUP_RULES,
  ].join(' ')
}

export function outlinePrompt(project: ProjectInfo): string {
  const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
  const skeletons = [
    `Chapter 1 — ${track.chapterTitles[0]}: ${track.chapter1Sections.join('; ')}`,
    `Chapter 2 — ${track.chapterTitles[1]}: ${track.chapter2Sections.join('; ')}`,
    `Chapter 3 — ${track.chapterTitles[2]}: ${track.chapter3Sections.join('; ')}`,
    `Chapter 4 — ${track.chapterTitles[3]}: ${track.chapter4Sections.join('; ')}`,
    `Chapter 5 — ${track.chapterTitles[4]}: Summary of Findings; Conclusion; Recommendations`,
  ].join('\n')
  return `Design the complete outline for the following final year project.

Topic: ${project.topic}
University: ${project.university}
Field of study: ${project.fieldOfStudy ?? ''}
Course of study: ${project.courseOfStudy ?? project.department}
Degree: ${project.degree}
Student: ${project.studentName} (${project.matric})
Supervisor: ${project.supervisor}
Session: ${project.session}

This project follows the ${track.label} structure. Use these section skeletons (adapt wording to the topic, keep the order and coverage):

${skeletons}

Produce exactly five chapters matching that structure, each with 4 to 8 sections and a one-line description of what each section will cover. Also write a 150-word draft abstract.

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape:

\`\`\`json
{
  "abstract": "…",
  "chapters": [
    { "title": "${track.chapterTitles[0]}", "sections": [ { "heading": "Background of the Study", "description": "…" } ] }
  ]
}
\`\`\``
}

export function chapterPrompt(
  project: ProjectInfo,
  chapters: Chapter[],
  chapter: Chapter,
  nudge?: string,
  continuation?: string
): string {
  const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
  const preset: LengthPreset = project.lengthPreset ?? 'standard'
  const budget = chapterBudget(preset, chapter.number)
  const outlineContext = chapters
    .map((c) => `Chapter ${c.number} — ${c.title}: ${c.sections.map((s) => s.heading).join('; ')}`)
    .join('\n')
  const sections = chapter.sections
    .map((s) => `- ${s.heading}: ${s.description}`)
    .join('\n')
  const parts = [
    `Write CHAPTER ${chapter.number}: ${chapter.title} in full for this final year project.`,
    '',
    `Topic: ${project.topic}`,
    `University: ${project.university} — ${project.courseOfStudy ?? project.department}`,
    `Degree: ${project.degree} | Student: ${project.studentName} (${project.matric}) | Supervisor: ${project.supervisor}`,
    '',
    `LENGTH: about ${budget.toLocaleString()} words, at most ${Math.round(budget * OVERSHOOT_FACTOR).toLocaleString()}. Do not pad. Do not repeat points. Stop when the section outline is covered.`,
    '',
    'The full document outline (for context — write ONLY the chapter named above):',
    outlineContext,
    '',
    `Sections required in this chapter:`,
    sections,
  ]
  if (chapter.number === 4) parts.push('', `RESULTS INTEGRITY: ${track.chapter4Steering}`)
  if (nudge) parts.push(`\nDirection for this generation: ${nudge}`)
  if (continuation)
    parts.push(`\nThe chapter is already partially written below. Continue exactly where it stops, do not repeat it:\n\n${continuation}`)
  return parts.join('\n')
}

export function questionnairePrompt(project: ProjectInfo, chapters: Chapter[]): string {
  const ch1 = chapters.find((c) => c.number === 1)
  const objectives = ch1?.sections.find((s) => /objectiv/i.test(s.heading))?.heading
  return `Generate the QUESTIONNAIRE appendix for this final year project.

Topic: ${project.topic}
${objectives ? `The study objectives (derive the questionnaire items from these and the research questions, never from chapter text): ${objectives}` : ''}

Sections of the questionnaire (cover page instructions, demographic items, then items grouped per objective, each with response options). Plain text. Do not invent results — only the instrument itself.`
}

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
function toWord(n: number): string {
  return WORDS[n - 1] ?? String(n)
}

export function defenseQuestionsPrompt(project: ProjectInfo, chapters: Chapter[]): string {
  const outlineContext = chapters
    .map((c) => `CHAPTER ${toWord(c.number)} — ${c.title}: ${c.sections.map((s) => s.heading).join('; ')}`)
    .join('\n')
  return `Generate likely defense questions (viva) for this final year project.

Topic: ${project.topic}
University: ${project.university} — Department of ${project.department}

Chapters:
${outlineContext}

For each chapter, write 3 likely questions an examination panel would ask, with a one-paragraph suggested answer each. Format each as:

Chapter N — Chapter title
Q: question
A: suggested answer

Plain text only.`
}

import type { Chapter, ProjectInfo } from './state/store'

export function systemPrompt(): string {
  return [
    'You are an expert academic supervisor at a Nigerian university writing assistant content for final year projects.',
    'You produce work in the standard Nigerian five-chapter format: CHAPTER ONE (Introduction), CHAPTER TWO (Literature Review), CHAPTER THREE (Methodology), CHAPTER FOUR (Results and Analysis), CHAPTER FIVE (Conclusion and Recommendations).',
    'Write as a strong Nigerian final-year student would: formal academic register, clear, direct — never stilted or padded.',
    'Chapter word targets: Chapters 1 and 2 about 2,500 words each; Chapters 3, 4 and 5 about 3,000 to 5,000 words each.',
    'Use APA 7 in-text citations where claims need sources. Include Nigerian context where natural (Nigerian universities, institutions, infrastructure, market data).',
    'Use plain text with markdown-style headings: "CHAPTER ONE" on its own line, section headings on their own lines. No HTML, no LaTeX.',
  ].join(' ')
}

export function outlinePrompt(project: ProjectInfo): string {
  return `Design the complete outline for the following final year project.

Topic: ${project.topic}
University: ${project.university}
Department: ${project.department}
Degree: ${project.degree}
Student: ${project.studentName} (${project.matric})
Supervisor: ${project.supervisor}
Session: ${project.session}

Produce exactly five chapters (Introduction, Literature Review, Methodology, Results and Analysis, Conclusion and Recommendations), each with 4 to 7 sections and a one-line description of what each section will cover. Also write a 150-word draft abstract.

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape:

\`\`\`json
{
  "abstract": "…",
  "chapters": [
    { "title": "INTRODUCTION", "sections": [ { "heading": "Background of the Study", "description": "…" } ] }
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
    `University: ${project.university} — Department of ${project.department}`,
    `Degree: ${project.degree} | Student: ${project.studentName} (${project.matric}) | Supervisor: ${project.supervisor}`,
    '',
    'The full document outline (for context — write ONLY the chapter named above):',
    outlineContext,
    '',
    `Sections required in this chapter:`,
    sections,
  ]
  if (nudge) parts.push(`\nDirection for this generation: ${nudge}`)
  if (continuation)
    parts.push(`\nThe chapter is already partially written below. Continue exactly where it stops, do not repeat it:\n\n${continuation}`)
  return parts.join('\n')
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

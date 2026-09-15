import type { Chapter, ProjectInfo, LengthPreset, PoolEntry } from './state/store'
import { trackFor } from './ai/tracks'
import type { Track } from './ai/tracks'

// ---------------------------------------------------------------------------
// Length presets. Word budgets target prose at ~250 words per double-spaced
// page; the page estimate (estimatePages) additionally counts chapter page
// breaks, headings, figures, and tables, so the budgets land near the preset's
// page target once furniture is included.
// ---------------------------------------------------------------------------

export interface LengthBudget { label: string; pages: string; budgets: [number, number, number, number, number] }

export const LENGTH_PRESETS: Record<LengthPreset, LengthBudget> = {
  compact: { label: 'Compact (~35 pages)', pages: '≈35 pages · 7,000 words', budgets: [1200, 1700, 1200, 1700, 1200] },
  standard: { label: 'Standard (~50 pages)', pages: '≈50 pages · 10,500 words', budgets: [1600, 2600, 2100, 2600, 1600] },
  detailed: { label: 'Detailed (~70 pages)', pages: '≈70 pages · 15,000 words', budgets: [2200, 3500, 3000, 3800, 2500] },
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
  'Use "-" bullet lists and "1." numbered lists where they aid clarity. Never prefix paragraphs or list items with chapter.section numbers like 3.4 — those numbers are reserved for section headings.',
  'For any data visualization, emit a fenced code block tagged chart containing a single JSON object on one line:',
  '```chart\n{"type": "bar|pie|line", "title": "Figure title", "ylabel": "optional axis label", "data": {"Category": 123, ...}}\n```',
  'Never emit fenced blocks tagged json — chart JSON goes only inside a chart-tagged fence, never bare in the text.',
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
    'Citation integrity: cite only works supplied in the ALLOWED SOURCES list of the task, using the exact (Author, Year) key given there. Never invent a citation, and never cite from memory. If the list lacks a source for a claim, state the claim without a citation.',
    'Structure: each chapter begins with "CHAPTER <WORD>" on its own line, followed by sections numbered {N}.1, {N}.2, … that follow the chapter number. Use exactly two levels — a chapter and its numbered sections. Never emit three-level numbers like 3.2.1, and never number a paragraph, list item, or hypothesis with a chapter.section number.',
    'A chapter has 4 to 8 sections. Do not create more.',
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
  continuation?: string,
  referencePool: PoolEntry[] = []
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
  if (referencePool.length) {
    parts.push(
      '',
      'ALLOWED SOURCES — the only works you may cite. Use the exact (Author, Year) key shown at the start of each line:',
      ...referencePool.map((r) => `${r.key} — ${r.authors} (${r.year}). ${r.title}.${r.container ? ` ${r.container}.` : ''}`)
    )
  } else {
    parts.push(
      '',
      'No verified source pool is available for this project. Write the chapter WITHOUT in-text citations — do not invent any.',
    )
  }
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

// ---------------------------------------------------------------------------
// Defense slides — condense chapters into prompt-ready text and demand the
// strict slide-content JSON (spec: docs/superpowers/specs/2026-09-12-defense-slides-design.md)
// ---------------------------------------------------------------------------

/** Chapter bodies condensed for the slides prompt: every section heading plus the
 *  first 200 words of its body (or the outline description when the body is missing). */
export function condenseChapters(chapters: Chapter[]): string {
  return chapters
    .filter((c) => c.text || c.sections.length)
    .map((c) => {
      const parts = [`CHAPTER ${c.number} — ${c.title}`]
      // Split the body into blocks that each start with a "N.M Heading" line.
      const blocks = c.text.split(/\n(?=\d+\.\d+)/)
      for (const s of c.sections) {
        const block = blocks.find((b) => b.toLowerCase().includes(s.heading.toLowerCase())) ?? ''
        const body = block
          .replace(/^[^\n]*\n/, '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 200)
          .join(' ')
        parts.push(`  ${s.heading}: ${body || s.description}`)
      }
      if (!c.sections.length) {
        const body = c.text.trim().split(/\s+/).filter(Boolean).slice(0, 300).join(' ')
        if (body) parts.push(`  ${body}`)
      }
      return parts.join('\n')
    })
    .join('\n\n')
}

export function slidesPrompt(project: ProjectInfo, chapters: Chapter[]): string {
  return `Structure the defense slide content for this final year project.

Topic: ${project.topic}
Student: ${project.studentName} (${project.matric})
University: ${project.university} — Department of ${project.department}
Degree: ${project.degree} | Supervisor: ${project.supervisor} | Session: ${project.session}

CHAPTER CONTENT (condensed):
${condenseChapters(chapters)}

Rules:
- Max 12 words per bullet. Academic Nigerian university tone.
- Use ONLY content present in the chapters — do not invent results, metrics, or citations.
- Every bullet must stand alone when read aloud at a defense.
- "notes" holds the speaker notes: 60–100 words of spoken script per section, first person.
- "images": at most 3, only for sysdesign / methodology / results, each a one-sentence description of a clean technical illustration (no text in the image).

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape (all bullet arrays required, may be empty):

\`\`\`json
{
  "aim": "To design/develop/implement… (one concise sentence)",
  "bullets": {
    "intro": ["…"], "problem": ["…"], "objectives": ["…"], "scope": ["…"],
    "significance": ["…"], "literature": ["…"], "methodology": ["…"],
    "sysdesign": ["…"], "implementation": ["…"], "results": ["…"],
    "discussion": ["…"], "conclusion": ["…"]
  },
  "notes": { "intro": "…", "methodology": "…" },
  "images": [{ "slide": "sysdesign", "prompt": "…" }]
}
\`\`\``
}

// ---------------------------------------------------------------------------
// References — retired recall-based flow. The reference list is now composed
// deterministically at export from the Crossref-verified pool entries that the
// chapters actually cited (see Export.ensureReferences); the model is never
// asked to recall bibliographies from memory.
// ---------------------------------------------------------------------------

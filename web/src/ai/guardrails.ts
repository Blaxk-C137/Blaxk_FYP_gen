// Layer 2 of the chapter-guardrails design — post-generation mechanical fixes.
// Pure functions, no I/O, never throw: unparseable text passes through flagged.
// Spec: docs/superpowers/specs/2026-09-10-chapter-guardrails-design.md

import { parseChartSpec } from '../export/markdown'

export type ViolationRule =
  | 'section-numbering'
  | 'references-in-body'
  | 'heading-format'
  | 'duplicate-heading'
  | 'raw-json'

export interface Violation {
  rule: ViolationRule
  fixed: boolean // true = repaired mechanically, false = needs attention
  detail: string // human-readable; also fed back to the model on regen
}

export interface ChapterFix {
  text: string // repaired chapter text
  references: string[] // reference entries extracted from the body
  violations: Violation[]
}

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
const chapterWord = (n: number) => WORDS[n - 1] ?? String(n)

/** Section heading line: "3.2 Something" or "3.2.1 Deep Something" */
const SECTION_RE = /^(\d+(?:\.\d+)+)\s+(.*)$/
/** A chapter heading line, possibly with a title: "CHAPTER THREE" / "CHAPTER THREE: RESEARCH METHODOLOGY" */
const CHAPTER_RE = /^CHAPTER\s+(\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\b\s*(:)?\s*(.*)$/i

/** True if the line is a chapter heading — the word is a real chapter word and the
 *  remainder (if any) is a short title, not a sentence like "Chapter one examines …". */
function isChapterHeadingLine(line: string): boolean {
  const m = CHAPTER_RE.exec(line.trim())
  if (!m) return false
  const colon = m[2]
  const rest = m[3].trim()
  if (!rest) return true
  // Titles: no terminal punctuation, at most a dozen words, and — unless a colon
  // separates chapter word from title — they don't start with a lowercase word
  // (that's how "Chapter one examines the design." gets told apart from a heading).
  if (/[.?!;,]$/.test(rest)) return false
  if (!colon && /^[a-z]/.test(rest)) return false
  return rest.split(/\s+/).length <= 12
}
/** A references heading, case-insensitive, optional trailing colon */
const REFERENCES_RE = /^REFERENCES?\s*:?\s*$/i

/** Lines that look like reference entries (APA-ish): Author, A. (Year). Title… */
const REFERENCE_ENTRY_RE = /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+,/

/** Normalizes a section heading to Title Case-ish academic form. */
function normalizeHeading(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*$/, '')
}

export function fixChapterText(chapterNumber: number, text: string): ChapterFix {
  const violations: Violation[] = []
  if (!text || !text.trim()) return { text, references: [], violations }

  try {
    let lines = text.split('\n')

    // ---- 1. Reference extraction -------------------------------------
    let references: string[] = []
    const refIdx = lines.findIndex((l) => REFERENCES_RE.test(l.trim()))
    if (refIdx !== -1) {
      const tail = lines.slice(refIdx + 1)
      lines = lines.slice(0, refIdx)
      references = tail
        .map((l) => l.trim())
        .filter((l) => l.length > 3 && REFERENCE_ENTRY_RE.test(l))
      if (references.length) {
        violations.push({
          rule: 'references-in-body',
          fixed: true,
          detail:
            `A REFERENCES list (${references.length} entries) was inside the chapter body; ` +
            'it was moved to the document references section. Cite in-text only — the app composes the list.',
        })
      }
    }

    // ---- 1b. Raw JSON guard --------------------------------------------
    // The model sometimes emits chart specs in json-tagged fences or as bare
    // JSON lines; both would leak raw JSON into the exported document.
    // Chart-shaped content is promoted to a chart fence; anything else
    // JSON-shaped is dropped. More than two fragments means the model is
    // structurally confused — that regenerates.
    let jsonDropped = 0
    let jsonPromoted = 0
    {
      const out: string[] = []
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim()
        const fenceTag = /^```(\w*)\s*$/.exec(t)?.[1]
        if (fenceTag && /^json$/i.test(fenceTag)) {
          let j = i + 1
          const content: string[] = []
          while (j < lines.length && lines[j].trim() !== '```') { content.push(lines[j]); j++ }
          const raw = content.join('\n').trim()
          if (parseChartSpec(raw)) { out.push('```chart', raw, '```'); jsonPromoted++ }
          else jsonDropped++
          i = j // skip past the closing fence (or the end of the text)
          continue
        }
        if (/^\{.*\}$/.test(t)) {
          if (parseChartSpec(t)) { out.push('```chart', t, '```'); jsonPromoted++ }
          else jsonDropped++
          continue
        }
        out.push(lines[i])
      }
      lines = out
      if (jsonDropped + jsonPromoted > 0) {
        violations.push({
          rule: 'raw-json',
          fixed: jsonDropped <= 2,
          detail:
            `Raw JSON in the chapter body (${jsonPromoted} promoted to charts, ${jsonDropped} removed). ` +
            'Emit chart data only inside a fence tagged chart — never json-tagged fences or bare JSON.',
        })
      }
    }

    // ---- 2. Section renumbering --------------------------------------
    let sectionIndex = 0
    let renumbered = 0
    let demoted = 0
    lines = lines.map((line) => {
      const t = line.trim()
      const m = SECTION_RE.exec(t)
      if (!m) return line
      // Single-group numbers ("1. Something") are list items — SECTION_RE
      // already requires two or more groups, so they never reach here.
      const depth = m[1].split('.').length // "3.2" → 2, "3.2.1" → 3
      if (depth > 2) {
        // Nigerian FYP format is two-level; a deeper heading becomes a bold
        // lead-in paragraph instead of a numbered section.
        demoted++
        return `**${normalizeHeading(m[2])}**`
      }
      sectionIndex++
      const expected = `${chapterNumber}.${sectionIndex}`
      if (m[1] !== expected) renumbered++
      return `${expected} ${normalizeHeading(m[2])}`
    })
    if (renumbered > 0 || demoted > 0) {
      violations.push({
        rule: 'section-numbering',
        fixed: true,
        detail:
          `Section numbers did not follow the chapter number (${renumbered} renumbered` +
          `${demoted ? `, ${demoted} three-level heading(s) demoted to bold paragraphs` : ''}). ` +
          `Number sections ${chapterNumber}.1, ${chapterNumber}.2, … in order; never three-level numbers like ${chapterNumber}.2.1.`,
      })
    }
    // Section flood guard — the 2026-09-14 export carried chapter 3 sections
    // 3.1–3.33 because the model had numbered list items like section headings.
    if (sectionIndex > 12) {
      violations.push({
        rule: 'section-numbering',
        fixed: false,
        detail:
          `${sectionIndex} numbered headings in one chapter — the outline calls for 4–8 sections. ` +
          'Number ONLY section headings as {N}.1, {N}.2, …; never number paragraphs, list items, or hypotheses with chapter.section numbers.',
      })
    }

    // ---- 3. Chapter heading normalization -----------------------------
    const firstNonEmpty = lines.findIndex((l) => l.trim())
    const firstLine = firstNonEmpty === -1 ? '' : lines[firstNonEmpty].trim()
    const cm = isChapterHeadingLine(firstLine) ? CHAPTER_RE.exec(firstLine) : null
    if (!cm) {
      // Ensure the text opens with a CHAPTER <WORD> line.
      lines = [`CHAPTER ${chapterWord(chapterNumber)}`, ...lines]
      violations.push({
        rule: 'heading-format',
        fixed: true,
        detail: `The chapter did not open with a "CHAPTER ${chapterWord(chapterNumber)}" line; one was added.`,
      })
    } else {
      // Normalize casing/spacing of the chapter line.
      const normalized = `CHAPTER ${chapterWord(chapterNumber)}${cm[3].trim() ? ': ' + cm[3].trim().replace(/\s+/g, ' ').toUpperCase() : ''}`
      if (lines[firstNonEmpty].trim() !== normalized) {
        lines = lines.map((l, i) => (i === firstNonEmpty ? normalized : l))
        violations.push({ rule: 'heading-format', fixed: true, detail: 'Chapter heading casing/spacing was normalized.' })
      }
    }

    // ---- 4. Duplicate heading collapse --------------------------------
    const seen = new Set<string>()
    let dupes = 0
    lines = lines.filter((line) => {
      const t = line.trim()
      const isHeading = isChapterHeadingLine(t) || SECTION_RE.test(t)
      if (!isHeading) return true
      const key = t.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(key)) {
        dupes++
        return false
      }
      seen.add(key)
      return true
    })
    if (dupes > 0) {
      violations.push({
        rule: 'duplicate-heading',
        fixed: true,
        detail: `${dupes} duplicated heading line(s) removed. Do not repeat a heading within a chapter.`,
      })
    }

    // ---- 5. Guard: no content at all? ---------------------------------
    const bodyLines = lines.filter((l) => l.trim() && !isChapterHeadingLine(l))
    if (bodyLines.length === 0) {
      violations.push({
        rule: 'heading-format',
        fixed: false,
        detail: 'The chapter contains no body text beyond its heading.',
      })
    }

    const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
    return { text: out, references, violations }
  } catch {
    return {
      text,
      references: [],
      violations: [
        { rule: 'heading-format', fixed: false, detail: 'Chapter text could not be parsed; left as generated.' },
      ],
    }
  }
}

/** Violations that couldn't be fixed mechanically — these trigger a regen nudge. */
export function seriousViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => !v.fixed)
}

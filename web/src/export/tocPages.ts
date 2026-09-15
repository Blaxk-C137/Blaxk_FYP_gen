/** Deterministic page estimation for the cached TOC and the length budgets.
 *  Word 12pt Times New Roman, double-spaced, 1" margins: ~27 lines/page at
 *  ~9–10 words/line ≈ 250 words. Figures reserve the image height plus its
 *  caption; tables ~0.5" + rows. Pure code — the AI never decides.
 *
 *  Calibrated 2026-09 against a real export (the cached TOC stopped at page
 *  58 while Word laid the document out at 80 pages — the old 350 words/page
 *  constant was off by exactly the 350/250 ratio). One estimator serves the
 *  TOC cache, the generate-time page budget, and the on-screen page count. */
import type { Chapter } from '../state/store'
import { parseBlocks } from './markdown'
import type { Block } from './markdown'

export interface TocEntry { text: string; level: 1 | 2; page: number }

/** Double-spaced 12pt Times New Roman prose words per page ( Letter/A4, 1" margins). */
export const WORDS_PER_PAGE = 250
const PAGE_INCHES = 9.0 // 11" page − 2" margins
const LINE_INCHES = 0.33 // one double-spaced 12pt line
const FIGURE_INCHES = 4.0 // 5.7"×3.3" image + caption line + spacing
const TABLE_BASE_INCHES = 0.5
const TABLE_ROW_INCHES = 0.35

/** Shared walk over chapters: emits TOC entries and tracks the final page. */
function walk(chapters: Chapter[], withReferences: boolean): { entries: TocEntry[]; pages: number } {
  const entries: TocEntry[] = []
  // Pages count the body section only, which restarts at 1: the first chapter
  // already sits at the top of a fresh page, so start at 0 and pre-increment.
  let page = 0
  let usedInches = 0.0

  const consumeWords = (n: number) => {
    usedInches += (n / WORDS_PER_PAGE) * PAGE_INCHES
    while (usedInches >= PAGE_INCHES) { page++; usedInches -= PAGE_INCHES }
  }
  const consumeInches = (n: number) => {
    usedInches += n
    while (usedInches >= PAGE_INCHES) { page++; usedInches -= PAGE_INCHES }
  }

  for (const ch of chapters) {
    if (!ch.text) continue
    // Chapters start on a fresh page (pageBreakBefore).
    page++
    usedInches = 0
    const blocks = parseBlocks(ch.text)
    // The cached TOC must show the real heading literal ("CHAPTER ONE",
    // "APPENDIX: QUESTIONNAIRE") — viewers that never refresh fields would
    // otherwise freeze a fabricated "CHAPTER n" in place forever.
    const heading =
      blocks.find((b): b is Extract<Block, { kind: 'chapter' }> => b.kind === 'chapter')?.text ??
      `CHAPTER ${ch.number}`
    entries.push({ text: heading, level: 1, page })
    consumeInches(LINE_INCHES) // the chapter heading line itself
    for (const block of blocks) {
      switch (block.kind) {
        case 'section':
          entries.push({ text: block.text, level: 2, page })
          consumeInches(LINE_INCHES) // the heading line itself
          break
        case 'para':
          consumeWords(block.runs.map((r) => r.text).join('').trim().split(/\s+/).filter(Boolean).length)
          break
        case 'chapter':
          break // consumed once above
        case 'list':
          for (const item of block.items) consumeWords(item.split(/\s+/).length)
          break
        case 'table':
          consumeInches(TABLE_BASE_INCHES + block.rows.length * TABLE_ROW_INCHES)
          break
        case 'chart':
        case 'figure':
          consumeInches(FIGURE_INCHES)
          break
      }
    }
  }
  if (withReferences) {
    page++
    entries.push({ text: 'REFERENCES', level: 1, page })
  }
  return { entries, pages: page }
}

export function estimateTocEntries(chapters: Chapter[], referencesCount: number): TocEntry[] {
  const { entries } = walk(chapters, referencesCount >= 0)
  return entries
}

/** Estimated body pages for the generated chapters (fresh-page chapter starts,
 *  prose, headings, figures, tables — the same model the cached TOC uses). */
export function estimatePages(chapters: Chapter[]): number {
  return walk(chapters, false).pages
}

/** Deterministic page estimation for the cached TOC. Word 12pt Times New
 *  Roman, double-spaced, 1" margins: ~27 lines/page at ~13 words/line ≈ 350
 *  words. Figures and charts reserve ~3"; tables ~0.5" + rows. Pure code —
 *  the AI never decides. */
import type { Chapter } from '../state/store'
import { parseBlocks } from './markdown'
import type { Block } from './markdown'

export interface TocEntry { text: string; level: 1 | 2; page: number }

const WORDS_PER_PAGE = 350
const PAGE_INCHES = 9.0 // 11" page − 2" margins
const FIGURE_INCHES = 3.2
const TABLE_BASE_INCHES = 0.5
const TABLE_ROW_INCHES = 0.35

export function estimateTocEntries(chapters: Chapter[], referencesCount: number): TocEntry[] {
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
    for (const block of blocks) {
      switch (block.kind) {
        case 'section':
          entries.push({ text: block.text, level: 2, page })
          consumeWords(8) // the heading line itself
          break
        case 'para':
        case 'chapter':
          consumeWords((block.kind === 'para' ? block.runs.map((r) => r.text).join('') : block.text)
            .trim().split(/\s+/).filter(Boolean).length)
          break
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
  if (referencesCount >= 0) {
    page++
    entries.push({ text: 'REFERENCES', level: 1, page })
  }
  return entries
}

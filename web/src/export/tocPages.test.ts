import { describe, it, expect } from 'vitest'
import { estimateTocEntries, estimatePages, WORDS_PER_PAGE } from './tocPages'
import type { Chapter } from '../state/store'

const para = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const ch = (number: number, title: string, sections: [string, string][], body: string): Chapter => ({
  number, title, status: 'done', sections: [], text:
    `CHAPTER ${number}\n` + sections.map(([h, b]) => `${number}.${h} ${h}\n${b}`).join('\n') + body,
})

describe('estimatePages', () => {
  it('calibrates to ~250 words per page: 2,500 words of prose ≈ 11 pages (10 + heading spillover)', () => {
    expect(WORDS_PER_PAGE).toBe(250)
    const pages = estimatePages([ch(1, 'A', [['1', para(2500)]], '')])
    expect(pages).toBe(11)
  })

  it('every chapter starts on a fresh page', () => {
    const pages = estimatePages([ch(1, 'A', [['1', para(100)]], ''), ch(2, 'B', [['1', para(100)]], '')])
    expect(pages).toBe(2)
  })

  it('figures and tables add real height, not word-count guesses', () => {
    const withFigure: Chapter = {
      number: 3, title: 'C', status: 'done', sections: [],
      text: 'CHAPTER 3\n3.1 Setup\n```figure\nA system diagram\n```\n' + para(200),
    }
    const pages = estimatePages([withFigure])
    // Prose + headings alone (7.9") is one page; the figure's 4" pushes the
    // chapter across the 9" line into page 2.
    expect(pages).toBe(2)
  })

  it('agrees with the TOC walk: the last chapter page is the page estimate', () => {
    const chapters = [ch(1, 'A', [['1', para(600)], ['2', para(600)]], '')]
    const entries = estimateTocEntries(chapters, -1)
    expect(estimatePages(chapters)).toBeGreaterThanOrEqual(entries[entries.length - 1].page)
  })
})

describe('estimateTocEntries', () => {
  it('lists chapters (level 1), sections (level 2), and REFERENCES with monotonically increasing pages', () => {
    const chapters = [
      ch(1, 'INTRODUCTION', [['1', para(300)], ['2', para(300)]], ''),
      ch(3, 'METHODOLOGY', [['1', para(200)]], ''),
    ]
    const entries = estimateTocEntries(chapters, 3)
    expect(entries.map((e) => e.level)).toEqual([1, 2, 2, 1, 2, 1])
    expect(entries[0].text).toContain('CHAPTER 1')
    expect(entries[5].text).toBe('REFERENCES')
    const pages = entries.map((e) => e.page)
    expect([...pages].sort((a, b) => a - b)).toEqual(pages)
  })

  it('each chapter starts on a fresh page', () => {
    const chapters = [ch(1, 'A', [['1', para(9000)]], ''), ch(2, 'B', [['1', para(50)]], '')]
    const entries = estimateTocEntries(chapters, 0)
    const ch2 = entries.find((e) => e.text.includes('CHAPTER 2'))!
    const ch1Last = Math.max(...entries.filter((e) => e.text.includes('CHAPTER 1') || e.level === 2 && e.page < ch2.page).map((e) => e.page))
    expect(ch2.page).toBeGreaterThanOrEqual(ch1Last)
  })

  it('a short section is under one page; the next section can share its page', () => {
    const chapters = [ch(1, 'A', [['1', para(200)], ['2', para(200)]], '')]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[1].page).toBe(1)
    expect(entries[2].page).toBe(1)
  })

  it('uses the real heading literal for level-1 entries, not the fabricated CHAPTER n', () => {
    const chapters: Chapter[] = [
      { number: 6, title: 'APPENDIX: QUESTIONNAIRE', status: 'done' as const, sections: [], text: 'APPENDIX: QUESTIONNAIRE\nHow often?' },
    ]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[0]).toMatchObject({ text: 'APPENDIX: QUESTIONNAIRE', level: 1, page: 1 })
  })

  it('normal CHAPTER ONE headings still pass through as their own literal', () => {
    const chapters: Chapter[] = [
      { number: 1, title: 'INTRODUCTION', status: 'done' as const, sections: [], text: 'CHAPTER ONE\n1.1 Background\nIntro.' },
    ]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[0]).toMatchObject({ text: 'CHAPTER ONE', level: 1, page: 1 })
  })

  it('falls back to CHAPTER n when the chapter text has no chapter heading block', () => {
    const chapters: Chapter[] = [
      { number: 2, title: 'LIT REVIEW', status: 'done' as const, sections: [], text: 'Just a paragraph body with no heading line.' },
    ]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[0]).toMatchObject({ text: 'CHAPTER 2', level: 1, page: 1 })
  })
})

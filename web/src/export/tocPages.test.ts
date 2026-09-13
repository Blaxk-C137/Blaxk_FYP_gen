import { describe, it, expect } from 'vitest'
import { estimateTocEntries } from './tocPages'
import type { Chapter } from '../state/store'

const para = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const ch = (number: number, title: string, sections: [string, string][], body: string): Chapter => ({
  number, title, status: 'done', sections: [], text:
    `CHAPTER ${number}\n` + sections.map(([h, b]) => `${number}.${h} ${h}\n${b}`).join('\n') + body,
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

  it('a 300-word section is under one page; the next section can share its page', () => {
    const chapters = [ch(1, 'A', [['1', para(300)], ['2', para(300)]], '')]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[1].page).toBe(1)
    expect(entries[2].page).toBe(1)
  })
})

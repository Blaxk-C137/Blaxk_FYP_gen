import { describe, it, expect } from 'vitest'
import { systemPrompt, outlinePrompt, chapterPrompt, defenseQuestionsPrompt } from './prompts'
import { EMPTY_PROJECT, initialChapterState } from './state/store'

const project = {
  ...EMPTY_PROJECT,
  topic: 'IoT-based theft detection for campus laboratories',
  studentName: 'Aisha Musa', matric: 'ENG/21/10345', university: 'Bayero University Kano',
  department: 'Telecommunications Engineering', supervisor: 'Dr. O. Adewale',
  degree: 'B.Eng', session: '2026/2027',
}

describe('prompts', () => {
  it('systemPrompt encodes Nigerian FYP conventions', () => {
    const s = systemPrompt()
    expect(s).toContain('five-chapter')
    expect(s).toContain('Nigerian final-year')
    expect(s).toContain('CHAPTER ONE')
    expect(s).toContain('2,500')
  })

  it('outlinePrompt carries project fields and demands JSON', () => {
    const p = outlinePrompt(project)
    expect(p).toContain('IoT-based theft detection')
    expect(p).toContain('Bayero University Kano')
    expect(p).toContain('```json')
    expect(p).toContain('"abstract"')
  })

  it('chapterPrompt includes outline context, sections, nudge, continuation', () => {
    const chapters = initialChapterState()
    chapters[0].sections = [{ heading: 'Background of the Study', description: 'why it matters' }]
    const p = chapterPrompt(project, chapters, chapters[0])
    expect(p).toContain('Background of the Study')
    expect(p).toContain('LITERATURE REVIEW') // outline context includes other chapters
    const nudged = chapterPrompt(project, chapters, chapters[0], 'more quantitative')
    expect(nudged).toContain('more quantitative')
    const cont = chapterPrompt(project, chapters, chapters[0], undefined, 'partial text so far')
    expect(cont).toContain('partial text so far')
  })

  it('defenseQuestionsPrompt asks for per-chapter questions', () => {
    const p = defenseQuestionsPrompt(project, initialChapterState())
    expect(p).toContain('defense questions')
    expect(p).toContain('CHAPTER FIVE')
  })
})

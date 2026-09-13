import { describe, it, expect } from 'vitest'
import { systemPrompt, outlinePrompt, chapterPrompt, defenseQuestionsPrompt, slidesPrompt, referencesPrompt } from './prompts'
import { EMPTY_PROJECT, initialChapterState } from './state/store'
import { TRACKS } from './ai/tracks'

const project = {
  ...EMPTY_PROJECT,
  topic: 'IoT-based theft detection for campus laboratories',
  studentName: 'Aisha Musa', matric: 'ENG/21/10345', university: 'Bayero University Kano',
  department: 'Telecommunications Engineering', supervisor: 'Dr. O. Adewale',
  degree: 'B.Eng', session: '2026/2027',
}

describe('prompts', () => {
  it('systemPrompt encodes Nigerian FYP conventions for the track', () => {
    const s = systemPrompt(TRACKS['computing-engineering'])
    expect(s).toContain('Nigerian')
    expect(s).toContain('CHAPTER ONE')
    expect(s).toContain('five-chapter format')
    // Citation + results integrity steering (spec Layer 1)
    expect(s).toContain('[INSERT VERIFIED CITATION HERE]')
    expect(s).toContain('REFERENCES list inside a chapter')
    // Chapter titles come from the track, not a hardcoded list
    expect(s).toContain(TRACKS['computing-engineering'].chapterTitles[2])
    // Track-independent: chapter 1 is always the introduction
    expect(systemPrompt(TRACKS['social-survey'])).toContain('CHAPTER ONE (INTRODUCTION)')
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

describe('slidesPrompt', () => {
  const project = {
    ...EMPTY_PROJECT,
    topic: 'AI-based news bias detection', studentName: 'Francis Eboh John',
    matric: 'ENG/24/MCT/0029', university: 'Bayero University Kano',
    department: 'MECHATRONICS', supervisor: 'John Syzn', degree: 'B.Eng', session: '2026',
  }

  const longBody = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
  const chapters = [
    {
      number: 1, title: 'INTRODUCTION', status: 'done' as const,
      sections: [
        { heading: 'Background of the Study', description: 'why it matters' },
        { heading: 'Objectives of the Study', description: 'goals' },
      ],
      text: `CHAPTER ONE\n1.1 Background of the Study\n${longBody}\n1.2 Objectives of the Study\nTo detect bias.`,
    },
  ]

  it('carries project fields, chapter sections, and the exact JSON shape', () => {
    const p = slidesPrompt(project, chapters)
    expect(p).toContain('AI-based news bias detection')
    expect(p).toContain('Bayero University Kano')
    expect(p).toContain('Background of the Study')
    expect(p).toContain('word199')          // first 200 words of a section body survive
    expect(p).not.toContain('word350')      // …but the condense cap holds
    expect(p).toContain('"gen_obj"')
    expect(p).toContain('"spec_obj"')
    expect(p).toContain('"method"')
    expect(p).toContain('```json')
    expect(p).toContain('Max 12 words per bullet')
    expect(p).toContain('do not invent')
  })

  it('falls back to the section description when a heading has no body text', () => {
    const thin = [{
      number: 2, title: 'LITERATURE REVIEW', status: 'pending' as const,
      sections: [{ heading: 'Conceptual Framework', description: 'defines the concepts' }],
      text: '',
    }]
    const p = slidesPrompt(project, thin)
    expect(p).toContain('LITERATURE REVIEW')
    expect(p).toContain('defines the concepts')
  })
})

describe('referencesPrompt', () => {
  it('carries the topic and every citation key, demands strict JSON', () => {
    const p = referencesPrompt(
      { ...EMPTY_PROJECT, topic: 'IoT theft detection' },
      ['Okonkwo, 2019', 'Smith & Jones, 2021']
    )
    expect(p).toContain('IoT theft detection')
    expect(p).toContain('Okonkwo, 2019')
    expect(p).toContain('Smith & Jones, 2021')
    expect(p).toContain('```json')
    expect(p).toContain('never invent')
    expect(p).toContain('"authors"')
  })
})

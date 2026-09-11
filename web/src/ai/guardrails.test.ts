import { describe, it, expect } from 'vitest'
import { fixChapterText, seriousViolations } from './guardrails'

describe('fixChapterText — renumbering', () => {
  it('renumbers sections from another chapter (real corpus case: 4.1–7.3 inside chapter 3)', () => {
    const raw = [
      'CHAPTER THREE: RESEARCH METHODOLOGY',
      '4.1 Research Design',
      'The design is descriptive.',
      '7.3 Method of Data Analysis',
      'Analysis used frequencies.',
    ].join('\n')
    const fix = fixChapterText(3, raw)
    expect(fix.text).toContain('3.1 Research Design')
    expect(fix.text).toContain('3.2 Method of Data Analysis')
    expect(fix.text).not.toContain('4.1')
    expect(fix.text).not.toContain('7.3')
    expect(fix.violations).toContainEqual(
      expect.objectContaining({ rule: 'section-numbering', fixed: true })
    )
  })

  it('returns correctly numbered text byte-identical', () => {
    const raw = [
      'CHAPTER TWO: LITERATURE REVIEW',
      '2.1 Conceptual Framework',
      'Text.',
      '2.2 Theoretical Framework',
      'More text.',
    ].join('\n')
    expect(fixChapterText(2, raw).text).toBe(raw + '\n')
  })

  it('leaves single-group numbered list items ("1. Something") alone', () => {
    const raw = 'CHAPTER ONE\nINTRODUCTION\n1. Background of the Study\n'
    const fix = fixChapterText(1, raw)
    expect(fix.text).toContain('1. Background of the Study')
    expect(fix.violations).not.toContainEqual(expect.objectContaining({ rule: 'section-numbering' }))
  })
})

describe('fixChapterText — reference extraction', () => {
  it('moves a REFERENCES block out of the body and returns the entries', () => {
    const raw = [
      'CHAPTER TWO: LITERATURE REVIEW',
      '2.1 Conceptual Framework',
      'Some body text.',
      'References',
      'Adeyemi, T. (2019). Nigerian higher education. Journal of Education.',
      'Okafor, B. (2021). Study habits. Book Press.',
    ].join('\n')
    const fix = fixChapterText(2, raw)
    expect(fix.text).not.toContain('Adeyemi')
    expect(fix.text).not.toMatch(/^References$/m)
    expect(fix.references).toHaveLength(2)
    expect(fix.references[0]).toContain('Adeyemi')
    expect(fix.violations).toContainEqual(
      expect.objectContaining({ rule: 'references-in-body', fixed: true })
    )
  })

  it('is case-insensitive on the heading and tolerates a trailing colon', () => {
    const raw = 'CHAPTER TWO\n2.1 Framework\nText.\nREFERENCES:\nAdeyemi, T. (2019). Title.'
    const fix = fixChapterText(2, raw)
    expect(fix.text).not.toContain('Adeyemi')
    expect(fix.references).toHaveLength(1)
  })

  it('keeps in-text (Author, Year) citations untouched', () => {
    const raw = 'CHAPTER TWO\n2.1 Framework\nEducation matters (Adeyemi, 2019) a great deal.'
    const fix = fixChapterText(2, raw)
    expect(fix.text).toContain('(Adeyemi, 2019)')
    expect(fix.references).toHaveLength(0)
  })

  it('no references heading → nothing extracted', () => {
    const fix = fixChapterText(1, 'CHAPTER ONE\n1.1 Background\nText.')
    expect(fix.references).toHaveLength(0)
  })
})

describe('fixChapterText — heading normalization', () => {
  it('prepends a CHAPTER line when the text does not open with one', () => {
    const fix = fixChapterText(1, 'The study examines theft.\nMore text.')
    expect(fix.text.startsWith('CHAPTER ONE\n')).toBe(true)
    expect(fix.text).toContain('The study examines theft.')
    expect(fix.violations).toContainEqual(
      expect.objectContaining({ rule: 'heading-format', fixed: true })
    )
  })

  it('does NOT treat an opening sentence like "Chapter one text." as a chapter heading', () => {
    // Regression: the old CHAPTER_RE matched any "Chapter <word> ..." sentence
    // and uppercased it into a heading, destroying the opening sentence.
    const fix = fixChapterText(1, 'Chapter one text.')
    expect(fix.text).toBe('CHAPTER ONE\nChapter one text.\n')
  })

  it('normalizes casing/spacing of a real chapter heading line', () => {
    const fix = fixChapterText(3, 'chapter three: research   methodology')
    expect(fix.text).toContain('CHAPTER THREE: RESEARCH METHODOLOGY')
  })

  it('collapses consecutive duplicate heading lines', () => {
    const raw = 'CHAPTER TWO\nCHAPTER TWO\n2.1 Framework\nBody text.'
    const fix = fixChapterText(2, raw)
    expect(fix.text.match(/^CHAPTER TWO$/gm)).toHaveLength(1)
    expect(fix.violations).toContainEqual(
      expect.objectContaining({ rule: 'duplicate-heading', fixed: true })
    )
  })

  it('flags a chapter with no body text as unfixed', () => {
    const fix = fixChapterText(1, 'CHAPTER ONE')
    expect(fix.text).toBe('CHAPTER ONE\n')
    expect(seriousViolations(fix.violations)).toHaveLength(1)
    expect(seriousViolations(fix.violations)[0].fixed).toBe(false)
  })
})

describe('fixChapterText — robustness', () => {
  it('clean, well-formed text passes through with no violations', () => {
    const raw = [
      'CHAPTER ONE: INTRODUCTION',
      '1.1 Background of the Study',
      'Nigerian universities face theft risks.',
      '1.2 Statement of the Problem',
      'The problem is unresolved.',
    ].join('\n')
    const fix = fixChapterText(1, raw)
    expect(fix.text).toBe(raw + '\n')
    expect(fix.violations).toHaveLength(0)
    expect(fix.references).toHaveLength(0)
  })

  it('empty text passes through', () => {
    const fix = fixChapterText(1, '')
    expect(fix.text).toBe('')
    expect(fix.violations).toHaveLength(0)
  })
})

describe('seriousViolations', () => {
  it('returns only unfixed violations', () => {
    const fix = fixChapterText(1, 'CHAPTER ONE') // no body → unfixed
    expect(seriousViolations(fix.violations).every((v) => !v.fixed)).toBe(true)
  })
})

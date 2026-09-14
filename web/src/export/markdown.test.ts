import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInline } from './markdown'

describe('parseInline', () => {
  it('splits bold and italic markers into runs', () => {
    expect(parseInline('a **bold** and *italic* end')).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' end' },
    ])
  })

  it('leaves plain text as a single unstyled run', () => {
    expect(parseInline('just text 1 < 2')).toEqual([{ text: 'just text 1 < 2' }])
  })

  it('does not treat a lone * as italic (e.g. footnote or multiplication)', () => {
    expect(parseInline('3 * 4')).toEqual([{ text: '3 * 4' }])
  })
})

describe('attention spans', () => {
  it('marks bracketed INSERT/VERIFY/ADD/TODO spans, keeping surrounding text plain', () => {
    const runs = parseInline('As noted (Smith, 2020) see [INSERT VERIFIED CITATION HERE] for details.')
    const att = runs.filter((r) => r.attention)
    expect(att).toHaveLength(1)
    expect(att[0].text).toBe('[INSERT VERIFIED CITATION HERE]')
    expect(runs[0].text).toContain('As noted')
  })

  it('handles multiple placeholders in one paragraph', () => {
    const runs = parseInline('[VERIFY] both [ADD SAMPLE SIZE] please')
    expect(runs.filter((r) => r.attention).map((r) => r.text))
      .toEqual(['[VERIFY]', '[ADD SAMPLE SIZE]'])
  })

  it('leaves ordinary bracketed text untouched', () => {
    expect(parseInline('The result [see figure] was clear.').every((r) => !r.attention)).toBe(true)
  })

  it('does not style lowercase bracketed prose like [address], but uppercase placeholders still match', () => {
    const runs = parseInline('Ship to [address] by Friday. See [INSERT FIGURE HERE] for the setup.')
    const att = runs.filter((r) => r.attention)
    expect(att).toHaveLength(1)
    expect(att[0].text).toBe('[INSERT FIGURE HERE]')
    const plain = runs.filter((r) => !r.attention).map((r) => r.text).join('')
    expect(plain).toContain('[address]')
  })
})

describe('parseBlocks', () => {
  it('classifies chapter and section headings', () => {
    const blocks = parseBlocks('CHAPTER ONE\n1.1 Background of the Study\nBody text.')
    expect(blocks).toEqual([
      { kind: 'chapter', text: 'CHAPTER ONE' },
      { kind: 'section', text: '1.1 Background of the Study' },
      { kind: 'para', runs: [{ text: 'Body text.' }] },
    ])
  })

  it('groups consecutive non-heading lines into paragraphs (blank-line separated)', () => {
    const blocks = parseBlocks('First para.\ncontinues here.\n\nSecond para.')
    expect(blocks).toEqual([
      { kind: 'para', runs: [{ text: 'First para. continues here.' }] },
      { kind: 'para', runs: [{ text: 'Second para.' }] },
    ])
  })

  it('parses a markdown pipe table with header row', () => {
    const blocks = parseBlocks('| Model | F1 |\n| --- | --- |\n| BERT | 0.83 |\n| SVM | 0.70 |')
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: ['Model', 'F1'],
        rows: [['BERT', '0.83'], ['SVM', '0.70']],
      },
    ])
  })

  it('parses bullet and numbered lists', () => {
    const blocks = parseBlocks('- first\n- second\n\n1. step one\n2. step two')
    expect(blocks).toEqual([
      { kind: 'list', ordered: false, items: ['first', 'second'] },
      { kind: 'list', ordered: true, items: ['step one', 'step two'] },
    ])
  })

  it('extracts a chart block as parsed JSON', () => {
    const text = 'Intro.\n\n```chart\n{"type":"bar","title":"Distribution","data":{"A":3,"B":5}}\n```\n\nAfter.'
    const blocks = parseBlocks(text)
    expect(blocks).toEqual([
      { kind: 'para', runs: [{ text: 'Intro.' }] },
      { kind: 'chart', chart: { type: 'bar', title: 'Distribution', data: { A: 3, B: 5 } } },
      { kind: 'para', runs: [{ text: 'After.' }] },
    ])
  })

  it('extracts a figure block as a description', () => {
    const blocks = parseBlocks('```figure\nSystem architecture: three tiers connected by REST.\n```')
    expect(blocks).toEqual([
      { kind: 'figure', description: 'System architecture: three tiers connected by REST.' },
    ])
  })

  it('flags a malformed chart block as a figure-style placeholder, not raw JSON', () => {
    const blocks = parseBlocks('```chart\n{not json\n```')
    expect(blocks[0].kind).toBe('figure')
    expect(JSON.stringify(blocks[0])).not.toContain('{not json')
  })

  it('keeps inline styling inside paragraphs', () => {
    const blocks = parseBlocks('This is **important**.')
    expect(blocks).toEqual([{ kind: 'para', runs: [{ text: 'This is ' }, { text: 'important', bold: true }, { text: '.' }] }])
  })

  it('ignores unknown fenced code blocks (passes content through as paragraph)', () => {
    const blocks = parseBlocks('```\nsome code\n```')
    expect(blocks).toEqual([{ kind: 'para', runs: [{ text: 'some code' }] }])
  })

  it('recognizes an appendix heading', () => {
    const blocks = parseBlocks('APPENDIX: QUESTIONNAIRE\nSection A')
    expect(blocks[0]).toEqual({ kind: 'chapter', text: 'APPENDIX: QUESTIONNAIRE' })
  })
})

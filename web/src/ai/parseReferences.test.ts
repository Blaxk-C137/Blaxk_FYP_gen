import { describe, it, expect } from 'vitest'
import { parseReferences } from './parseReferences'

const full = JSON.stringify({ entries: [
  { key: 'Okonkwo, 2019', authors: 'Okonkwo, C.', year: '2019', title: 'Campus security in Nigeria', container: 'Safety Journal', volume: '4', issue: '2', pages: '10-20', doi: '' },
  { key: 'Smith & Jones, 2021', authors: 'Smith, A. & Jones, B.', year: '2021', title: 'Sensor networks', container: '', volume: '', issue: '', pages: '', doi: '10.1/x' },
] })

describe('parseReferences', () => {
  it('parses clean JSON', () => {
    const r = parseReferences(full)
    expect(r).toHaveLength(2)
    expect(r[0].title).toBe('Campus security in Nigeria')
    expect(r[1].doi).toBe('10.1/x')
  })

  it('extracts from a fenced block with prose around it', () => {
    const r = parseReferences(`Sure!\n\`\`\`json\n${full}\n\`\`\`\nDone.`)
    expect(r).toHaveLength(2)
  })

  it('drops entries without a title or authors and defaults optional fields', () => {
    const r = parseReferences(JSON.stringify({ entries: [
      { key: 'a', authors: '', year: '2020', title: '' },
      { key: 'b', authors: 'X, Y.', year: '2021', title: 'Good title' },
    ] }))
    expect(r).toHaveLength(1)
    expect(r[0].container).toBe('')
  })

  it('coerces JSON numbers to strings for year and volume', () => {
    const r = parseReferences(JSON.stringify({ entries: [
      { key: 'Okonkwo, 2019', authors: 'Okonkwo, C.', year: 2019, title: 'Campus security in Nigeria', container: 'Safety Journal', volume: 4, issue: 2, pages: '10-20', doi: '' },
    ] }))
    expect(r).toHaveLength(1)
    expect(r[0].year).toBe('2019')
    expect(r[0].volume).toBe('4')
    expect(r[0].issue).toBe('2')
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseReferences('I could not do that.')).toThrow('Model did not return valid JSON')
  })
})

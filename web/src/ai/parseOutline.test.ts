import { describe, it, expect } from 'vitest'
import { parseOutline } from './parseOutline'

const modelJson = JSON.stringify({
  abstract: 'This study examines campus power monitoring…',
  chapters: [
    { title: 'INTRODUCTION', sections: [{ heading: 'Background of the Study', description: 'Context of the problem' }] },
    { title: 'LITERATURE REVIEW', sections: [] },
    { title: 'METHODOLOGY', sections: [] },
    { title: 'RESULTS AND ANALYSIS', sections: [] },
    { title: 'CONCLUSION AND RECOMMENDATIONS', sections: [] },
  ],
})

describe('parseOutline', () => {
  it('parses clean JSON', () => {
    const r = parseOutline(modelJson)
    expect(r.abstract).toContain('power monitoring')
    expect(r.chapters).toHaveLength(5)
    expect(r.chapters[0].number).toBe(1)
    expect(r.chapters[0].status).toBe('pending')
  })

  it('extracts JSON from a fenced code block with prose around it', () => {
    const r = parseOutline(`Here is your outline:\n\n\`\`\`json\n${modelJson}\n\`\`\`\n\nGood luck!`)
    expect(r.chapters).toHaveLength(5)
  })

  it('throws on garbage', () => {
    expect(() => parseOutline('I could not do that')).toThrow('Model did not return valid JSON')
  })
})

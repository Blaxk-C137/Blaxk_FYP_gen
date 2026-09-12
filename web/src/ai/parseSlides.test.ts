import { describe, it, expect } from 'vitest'
import { parseSlides, EMPTY_SLIDE_CONTENT } from './parseSlides'

const full = JSON.stringify({
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['News volume has grown', 'Bias fuels tension'],
  prob: ['Western-trained tools miss Nigerian context'],
  gen_obj: 'To develop an AI model for detecting bias in Nigerian online news.',
  spec_obj: ['Collect and annotate a dataset', 'Compare ML and deep learning models', 'Evaluate with accuracy and F1', 'Recommend deployment improvements', 'Document the pipeline'],
  scope_pts: ['English-language Nigerian news', '2020–2024 data'],
  sig_pts: ['Empowers citizens', 'Aids journalists'],
  method: [
    { title: 'Research Design', detail: 'Descriptive and experimental design.' },
    { title: 'Data Collection', detail: 'Web-scraped 10,000 articles.' },
  ],
  findings: ['BERT achieved best accuracy', 'SVM baseline weaker'],
  discuss: ['Domain data matters'],
  conc_pts: ['Detection is feasible'],
  recs: ['Adopt AI auditing', 'Extend to Hausa news'],
})

describe('parseSlides', () => {
  it('parses clean JSON into SlideContent', () => {
    const r = parseSlides(full)
    expect(r.gen_obj).toContain('AI model')
    expect(r.bg).toHaveLength(2)
    expect(r.method).toEqual([
      { title: 'Research Design', detail: 'Descriptive and experimental design.' },
      { title: 'Data Collection', detail: 'Web-scraped 10,000 articles.' },
    ])
  })

  it('extracts JSON from a fenced block with prose around it', () => {
    const r = parseSlides(`Here you go:\n\n\`\`\`json\n${full}\n\`\`\`\n\nGood luck!`)
    expect(r.spec_obj).toHaveLength(5)
  })

  it('defaults missing fields instead of throwing (partial JSON)', () => {
    const r = parseSlides('{"gen_obj": "One objective only."}')
    expect(r.gen_obj).toBe('One objective only.')
    expect(r.bg).toEqual([])
    expect(r.method).toEqual(EMPTY_SLIDE_CONTENT.method)
  })

  it('ignores non-string junk inside arrays', () => {
    const r = parseSlides('{"bg": ["ok", 5, null, "  "], "prob": []}')
    expect(r.bg).toEqual(['ok'])
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseSlides('I could not do that.')).toThrow('Model did not return valid JSON')
    expect(() => parseSlides('{"unrelated": true}')).toThrow('Model did not return valid JSON')
  })
})

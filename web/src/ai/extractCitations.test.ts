// web/src/ai/extractCitations.test.ts
import { describe, it, expect } from 'vitest'
import { extractCitations } from './extractCitations'

describe('extractCitations', () => {
  it('pulls simple parenthetical citations', () => {
    expect(extractCitations('Security is a concern (Okonkwo, 2019).'))
      .toEqual(['Okonkwo, 2019'])
  })

  it('splits multi-citation parentheticals and keeps first-appearance order', () => {
    const keys = extractCitations('One view (Smith & Jones, 2021; Adeyemi et al., 2020) differs from another (Smith & Jones, 2021).')
    expect(keys).toEqual(['Smith & Jones, 2021', 'Adeyemi et al., 2020'])
  })

  it('captures narrative citations and normalizes "and" to "&"', () => {
    expect(extractCitations('Bello and Musa (2022) found that growth slowed.'))
      .toEqual(['Bello & Musa, 2022'])
    expect(extractCitations('NCC et al. (2023) reported a rise.'))
      .toEqual(['NCC et al., 2023'])
  })

  it('strips page-pinpoint suffixes', () => {
    expect(extractCitations('As shown (Ibrahim, 2018, p. 45), yields fell.'))
      .toEqual(['Ibrahim, 2018'])
  })

  it('ignores bare years, acronyms and non-citations', () => {
    expect(extractCitations('In 2020 the market grew (see Appendix). Data (NBS, 2021) says otherwise.'))
      .toEqual(['NBS, 2021'])
  })
})

import { describe, it, expect } from 'vitest'
import { parseSlides, EMPTY_SLIDE_CONTENT } from './parseSlides'

const full = JSON.stringify({
  aim: 'To design a compact MIMO antenna for 5G.',
  bullets: {
    intro: ['5G uses sub-6 GHz spectrum', 'MIMO improves capacity'],
    problem: ['Compactness degrades isolation'],
    objectives: ['Target isolation ≥ 15 dB', 'Keep the form compact'],
    scope: ['Sub-6 GHz band only'],
    significance: ['Reference for local engineers'],
    literature: ['MIMO exploits multipath'],
    methodology: ['Simulation in CST', 'Parametric optimisation', 'Fabrication', 'Measurement'],
    sysdesign: ['Rectangular patch with inset feed'],
    implementation: ['FR-4 substrate', 'Digital calliper verification'],
    results: ['Isolation achieved across the band'],
    discussion: ['DGS improved isolation'],
    conclusion: ['The design meets its targets'],
  },
  notes: { intro: 'Good morning. This work addresses…', methodology: 'We followed a four-step cycle…' },
  images: [{ slide: 'sysdesign', prompt: 'Technical diagram of a two-element MIMO patch antenna, top view, minimal style' }],
})

describe('parseSlides v2', () => {
  it('parses the full shape', () => {
    const r = parseSlides(full)
    expect(r.aim).toContain('MIMO antenna')
    expect(r.bullets.intro).toHaveLength(2)
    expect(r.bullets.methodology).toHaveLength(4)
    expect(r.notes.intro).toContain('Good morning')
    expect(r.images[0].slide).toBe('sysdesign')
  })

  it('extracts JSON from a fenced block with prose around it', () => {
    const r = parseSlides(`Here:\n\`\`\`json\n${full}\n\`\`\`\nThanks`)
    expect(r.bullets.problem).toHaveLength(1)
  })

  it('defaults missing sections, notes, and images; caps images at 3', () => {
    const r = parseSlides(JSON.stringify({ aim: 'One aim.', bullets: { intro: ['x'] }, images: [
      { slide: 'intro', prompt: 'a' }, { slide: 'scope', prompt: 'b' }, { slide: 'results', prompt: 'c' }, { slide: 'lit', prompt: 'd' },
    ] }))
    expect(r.aim).toBe('One aim.')
    expect(r.bullets.scope).toEqual([])
    expect(r.notes).toEqual({})
    expect(r.images).toHaveLength(3)
  })

  it('ignores junk inside arrays and unknown slide keys', () => {
    const r = parseSlides(JSON.stringify({ aim: '', bullets: { intro: ['ok', 5, '  '] }, images: [{ slide: 'nonsense', prompt: 'x' }] }))
    expect(r.bullets.intro).toEqual(['ok'])
    expect(r.images).toEqual([])
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseSlides('No JSON here.')).toThrow('Model did not return valid JSON')
  })
})

describe('EMPTY_SLIDE_CONTENT', () => {
  it('has every slide key with empty bullets and no notes/images', () => {
    expect(Object.keys(EMPTY_SLIDE_CONTENT.bullets)).toHaveLength(12)
    expect(Object.values(EMPTY_SLIDE_CONTENT.bullets).every((a) => a.length === 0)).toBe(true)
    expect(EMPTY_SLIDE_CONTENT.notes).toEqual({})
    expect(EMPTY_SLIDE_CONTENT.images).toEqual([])
    expect(EMPTY_SLIDE_CONTENT.aim).toBe('')
  })
})

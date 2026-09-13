import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApa, resolveCitations } from './citations.js'
import type { ReferenceInput } from '../shared/constants.js'

const entry: ReferenceInput = {
  key: 'Alibakhshikenari et al., 2020',
  authors: 'Alibakhshikenari, M. & Virdee, B. S.',
  year: '2020', title: 'Mutual coupling suppression of MIMO antenna arrays',
  container: 'IEEE Access', volume: '8', issue: '', pages: '139-182', doi: '',
}

afterEach(() => vi.unstubAllGlobals())

describe('buildApa', () => {
  it('formats a structured entry as an APA reference line', () => {
    const apa = buildApa(entry)
    expect(apa).toContain('Alibakhshikenari')
    expect(apa).toContain('(2020)')
    expect(apa).toContain('Mutual coupling suppression')
    expect(apa).toMatch(/\.\s*$/)
  })

  it('is deterministic — same input, same output', () => {
    expect(buildApa(entry)).toBe(buildApa(entry))
  })
})

describe('resolveCitations', () => {
  it('marks verified when Crossref returns a matching title, with the authoritative DOI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: { items: [{ DOI: '10.1109/access.2020.123', title: ['Mutual coupling suppression of MIMO antenna arrays'] }] },
    }), { headers: { 'content-type': 'application/json' } })))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(true)
    expect(r.doi).toBe('10.1109/access.2020.123')
  })

  it('marks unverified when Crossref titles do not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: { items: [{ DOI: '10.x/y', title: ['Completely different paper about birds'] }] },
    }), { headers: { 'content-type': 'application/json' } })))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(false)
    expect(r.doi).toBeUndefined()
  })

  it('Crossref/network failure degrades to unverified, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(false)
    expect(r.apa).toContain('Mutual coupling suppression')
  })

  it('entries without a title pass through unverified', async () => {
    const [r] = await resolveCitations([{ key: 'k', authors: 'A, B.', year: '2020', title: '' }])
    expect(r.verified).toBe(false)
  })
})

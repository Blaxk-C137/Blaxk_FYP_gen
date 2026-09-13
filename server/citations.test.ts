import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApa, resolveCitations } from './citations.js'
import type { ReferenceInput } from '../shared/constants.js'

/** Test seam: force citation-js's constructor to throw, exercising the manual fallback. */
const cite = vi.hoisted(() => ({ shouldThrow: false }))
vi.mock('citation-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('citation-js')>()
  return {
    default: class extends actual.default {
      constructor(...args: ConstructorParameters<typeof actual.default>) {
        if (cite.shouldThrow) throw new Error('citeproc rejected the entry')
        super(...args)
      }
    },
  }
})

const entry: ReferenceInput = {
  key: 'Alibakhshikenari et al., 2020',
  authors: 'Alibakhshikenari, M. & Virdee, B. S.',
  year: '2020', title: 'Mutual coupling suppression of MIMO antenna arrays',
  container: 'IEEE Access', volume: '8', issue: '', pages: '139-182', doi: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
  cite.shouldThrow = false
})

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

describe('buildApa manual fallback (citeproc rejection)', () => {
  it('renders volume-without-issue as "8," and ends with a period', () => {
    cite.shouldThrow = true
    const apa = buildApa(entry)
    expect(apa).toContain('Alibakhshikenari')
    expect(apa).toMatch(/IEEE Access\*? 8, 139-182\./)
    expect(apa).not.toContain('8)')
    expect(apa).toMatch(/\.\s*$/)
  })

  it('composes volume and issue as "8(7),"', () => {
    cite.shouldThrow = true
    const apa = buildApa({ ...entry, issue: '7' })
    expect(apa).toMatch(/8\(7\), 139-182\./)
  })

  it('never leaks "undefined" for sparse entries', () => {
    const sparse = { key: 'k', title: 'Only a title here' } as ReferenceInput
    expect(buildApa(sparse)).not.toContain('undefined')
    cite.shouldThrow = true
    const apa = buildApa(sparse)
    expect(apa).not.toContain('undefined')
    expect(apa).toMatch(/\.\s*$/)
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

  it('rebuilds the APA from authoritative Crossref metadata on a match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: { items: [{
        DOI: '10.1109/access.2020.999',
        title: ['Mutual coupling suppression of MIMO antenna arrays'],
        author: [{ family: 'Crossref', given: 'A.' }],
        issued: { 'date-parts': [[2019]] },
        'container-title': ['IEEE Transactions on Antennas and Propagation'],
        volume: '12', issue: '3', page: '50-60',
      }] },
    }), { headers: { 'content-type': 'application/json' } })))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(true)
    expect(r.doi).toBe('10.1109/access.2020.999')
    expect(r.apa).toContain('Crossref')
    expect(r.apa).toContain('(2019)')
    expect(r.apa).toContain('IEEE Transactions on Antennas')
    expect(r.apa).not.toContain('Virdee')
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

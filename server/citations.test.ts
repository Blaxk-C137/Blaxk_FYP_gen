import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApa, resolveCitations, searchReferencePool } from './citations.js'
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

describe('searchReferencePool', () => {
  const crossrefItems = (n: number) => ({
    message: { items: Array.from({ length: n }, (_, i) => ({
      DOI: `10.1000/pool-${i}`,
      title: [`Study ${i} on MIMO antenna design for 5G applications`],
      author: [{ family: 'Author', given: String.fromCharCode(65 + (i % 26)) }],
      issued: { 'date-parts': [[2020 + (i % 5)]] },
      'container-title': ['IEEE Access'],
      volume: '8', issue: '', page: `${100 + i}-${200 + i}`,
    })) },
  })

  it('builds a pool of Crossref results with keys, APA lines, and DOIs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(crossrefItems(5)), { headers: { 'content-type': 'application/json' } })))
    const pool = await searchReferencePool('MIMO antenna for 5G', 5)
    expect(pool).toHaveLength(5)
    expect(pool[0].key).toMatch(/^\(Author, 20\d\d\)$/)
    expect(pool[0].apa).toContain('Study 0 on MIMO antenna')
    expect(pool[0].doi).toBe('10.1000/pool-0')
    expect(pool[0].title).toContain('MIMO antenna')
  })

  it('dedupes by DOI', async () => {
    const raw = crossrefItems(3)
    raw.message.items[2].DOI = raw.message.items[0].DOI
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } })))
    const pool = await searchReferencePool('MIMO', 5)
    expect(pool).toHaveLength(2)
  })

  it('skips items without authors or titles', async () => {
    const raw = crossrefItems(2)
    delete raw.message.items[1].author
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } })))
    const pool = await searchReferencePool('MIMO', 5)
    expect(pool).toHaveLength(1)
  })

  it('network failure returns an empty pool, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const pool = await searchReferencePool('MIMO', 5)
    expect(pool).toEqual([])
  })

  it('searches multiple queries (topic + keywords) and merges the results', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls++
      expect(String(url)).toContain('api.crossref.org/works')
      return new Response(JSON.stringify(crossrefItems(2)), { headers: { 'content-type': 'application/json' } })
    }))
    const pool = await searchReferencePool('MIMO antenna', 10, ['array mutual coupling', '5G sub-6 GHz'])
    expect(calls).toBe(3) // topic + 2 keyword queries
    expect(pool.length).toBeGreaterThanOrEqual(2)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findUniversityLogo, resetLogoCache } from './logo.js'

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })

beforeEach(() => resetLogoCache())
afterEach(() => vi.unstubAllGlobals())

describe('findUniversityLogo', () => {
  it('resolves search → homepage → apple-touch-icon to base64 png', async () => {
    const search = html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbuk.edu.ng%2F">Bayero University Kano</a>')
    const home = html('<link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>BUK</title>')
    const icon = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return search
      if (url === 'https://buk.edu.ng/') return home
      if (url === 'https://buk.edu.ng/apple-touch-icon.png') return icon
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await findUniversityLogo('Bayero University Kano')
    expect(r.logo?.base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(r.logo?.mime).toBe('image/png')
  })

  it('caches per university — second call makes no network requests', async () => {
    const icon = new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/png' } })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.edu%2F">X</a>')
      if (url === 'https://x.edu/') return html('<link rel="icon" href="/favicon.ico">')
      return icon
    })
    vi.stubGlobal('fetch', fetchMock)
    await findUniversityLogo('X University')
    await findUniversityLogo('X University')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects svg icons and returns null when nothing usable exists', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.edu%2F">X</a>')
      if (url === 'https://x.edu/') return html('<link rel="icon" href="/icon.svg">')
      return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect((await findUniversityLogo('X University')).logo).toBeNull()
  })

  it('network failure degrades to null, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect((await findUniversityLogo('Y University')).logo).toBeNull()
  })
})

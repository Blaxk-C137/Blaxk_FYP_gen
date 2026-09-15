// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pollinationsImage } from './pollinationsImages'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('pollinationsImages', () => {
  it('calls the local proxy route and returns its base64', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ base64: 'aGk=' }), { status: 200 })
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(await pollinationsImage('a bar chart of results')).toBe('aGk=')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generate-image-free')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).prompt).toBe('a bar chart of results')
  })

  it('returns null on a non-200 response (e.g. Pollinations 502)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 502 })) as unknown as typeof fetch
    expect(await pollinationsImage('x')).toBeNull()
  })

  it('returns null when fetch rejects (network, timeout, server down)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('blocked')) as unknown as typeof fetch
    expect(await pollinationsImage('x')).toBeNull()
  })

  it('returns null when the body has no base64', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    ) as unknown as typeof fetch
    expect(await pollinationsImage('x')).toBeNull()
  })
})

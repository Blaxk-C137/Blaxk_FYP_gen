import { describe, it, expect, vi, afterEach } from 'vitest'
import { testKey, generateStream, resolveReferences, generateImage, fetchLogo } from './api'

afterEach(() => vi.unstubAllGlobals())

function streamResponse(text: string, status = 200) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode(text)); c.close() },
  })
  return new Response(stream, { status, headers: { 'content-type': 'application/json' } })
}

describe('api client', () => {
  const settings = { provider: 'gemini' as const, apiKey: 'k' }

  it('testKey returns ok on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })))
    expect(await testKey(settings)).toEqual({ ok: true })
  })

  it('testKey surfaces provider error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"ok":false,"error":"API key not valid"}', { status: 401 })
    ))
    expect(await testKey(settings)).toEqual({ ok: false, error: 'API key not valid' })
  })

  it('generateStream yields chunks and resolves full text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('Hello world')))
    const chunks: string[] = []
    const full = await generateStream(settings, 'sys', 'p', (c) => chunks.push(c))
    expect(chunks.join('')).toBe('Hello world')
    expect(full).toBe('Hello world')
  })

  it('generateStream throws ApiError with provider message on 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"error":"quota exceeded"}', { status: 502 })
    ))
    await expect(generateStream(settings, 's', 'p', () => {})).rejects.toMatchObject({
      status: 502, message: 'quota exceeded',
    })
  })
})

describe('reference/image/logo clients', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolveReferences posts entries and maps results', async () => {
    const mock = vi.fn(async (_url: unknown, _init: { body: string }) => new Response(JSON.stringify({
      results: [{ input: {}, apa: 'A (2020). T.', verified: true, doi: '10.1/x' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', mock)
    const out = await resolveReferences([{ key: 'A, 2020', authors: 'A, B.', year: '2020', title: 'T' }])
    expect(out).toEqual([{ apa: 'A (2020). T.', verified: true, doi: '10.1/x' }])
    const [, init] = mock.mock.calls[0]!
    expect(JSON.parse(init.body).entries[0].title).toBe('T')
  })

  it('generateImage returns base64 or null on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ base64: 'aGk=' }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await generateImage({ provider: 'gemini', apiKey: 'k' }, 'a prompt')).toBe('aGk=')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 501 })))
    expect(await generateImage({ provider: 'gemini', apiKey: 'k' }, 'a prompt')).toBeNull()
  })

  it('fetchLogo maps the route payload, null on any failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ logo: { base64: 'Yg==', mime: 'image/png' } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await fetchLogo('Bayero University Kano')).toEqual({ base64: 'Yg==', mime: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await fetchLogo('X')).toBeNull()
  })
})

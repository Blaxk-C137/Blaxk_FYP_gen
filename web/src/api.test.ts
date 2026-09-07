import { describe, it, expect, vi, afterEach } from 'vitest'
import { testKey, generateStream } from './api'

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

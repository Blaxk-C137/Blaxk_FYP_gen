import { describe, it, expect, vi } from 'vitest'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
import { anthropic } from './anthropic.js'

function anthropicStream(texts: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const t of texts)
        c.enqueue(
          enc.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`)
        )
      c.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('anthropic adapter', () => {
  it('streams text_delta events', async () => {
    fetchMock.mockResolvedValueOnce(anthropicStream(['An ', 'outline']))
    const out: string[] = []
    for await (const t of anthropic.stream({ apiKey: 'k', system: 'sys', prompt: 'p' })) out.push(t)
    expect(out.join('')).toBe('An outline')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('k')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.system).toBe('sys')
    expect(body.messages).toEqual([{ role: 'user', content: 'p' }])
    expect(body.stream).toBe(true)
  })
  it('testKey reports error message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })
    )
    const r = await anthropic.testKey('bad')
    expect(r).toEqual({ ok: false, error: 'invalid x-api-key' })
  })
})

describe('anthropic adapter temperature', () => {
  it('sends temperature when provided and omits it when not', async () => {
    fetchMock.mockResolvedValueOnce(anthropicStream(['ok']))
    for await (const t of anthropic.stream({ apiKey: 'k', system: 's', prompt: 'p', temperature: 0.5 })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).temperature).toBe(0.5)

    fetchMock.mockResolvedValueOnce(anthropicStream(['ok']))
    for await (const t of anthropic.stream({ apiKey: 'k', system: 's', prompt: 'p' })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).temperature).toBeUndefined()
  })
})

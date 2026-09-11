import { describe, it, expect, vi } from 'vitest'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
import { openai } from './openai.js'

function oaiStream(texts: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const t of texts)
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`))
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('openai adapter', () => {
  it('streams delta content and sends system+user messages', async () => {
    fetchMock.mockResolvedValueOnce(oaiStream(['Ch ', '3']))
    const out: string[] = []
    for await (const t of openai.stream({ apiKey: 'k', system: 'sys', prompt: 'p' })) out.push(t)
    expect(out.join('')).toBe('Ch 3')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer k')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'p' })
    expect(body.stream).toBe(true)
  })
  it('testKey reports error message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 })
    )
    const r = await openai.testKey('bad')
    expect(r).toEqual({ ok: false, error: 'Incorrect API key' })
  })
})

describe('openai adapter temperature', () => {
  it('sends temperature when provided and omits it when not', async () => {
    fetchMock.mockResolvedValueOnce(oaiStream(['ok']))
    for await (const t of openai.stream({ apiKey: 'k', system: 's', prompt: 'p', temperature: 0.5 })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).temperature).toBe(0.5)

    fetchMock.mockResolvedValueOnce(oaiStream(['ok']))
    for await (const t of openai.stream({ apiKey: 'k', system: 's', prompt: 'p' })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).temperature).toBeUndefined()
  })
})

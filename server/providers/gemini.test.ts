import { describe, it, expect, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { gemini } from './gemini.js'

function geminiStream(texts: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const t of texts)
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('gemini adapter', () => {
  it('streams chapter text chunks', async () => {
    fetchMock.mockResolvedValueOnce(geminiStream(['Chapter ', 'one text']))
    const chunks: string[] = []
    for await (const t of gemini.stream({ apiKey: 'k', system: 's', prompt: 'p' }))
      chunks.push(t)
    expect(chunks.join('')).toBe('Chapter one text')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect(init.headers['x-goog-api-key']).toBe('k')
    expect(JSON.parse(init.body).systemInstruction.parts[0].text).toBe('s')
  })

  it('testKey surfaces API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })
    )
    const r = await gemini.testKey('bad')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('API key not valid')
  })

  it('testKey ok on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    expect((await gemini.testKey('good')).ok).toBe(true)
  })

  it('testKey fetch carries a timeout signal so it cannot hang forever', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await gemini.testKey('k')
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { signal?: AbortSignal }]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

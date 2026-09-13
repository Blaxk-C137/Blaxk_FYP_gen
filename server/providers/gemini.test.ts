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

/** Real-world Gemini framing: Google emits SSE with CRLF line endings. */
function geminiCrlfStream(texts: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const t of texts)
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`))
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

  it('streams text from CRLF-framed SSE events (Google line endings)', async () => {
    fetchMock.mockResolvedValueOnce(geminiCrlfStream(['Chapter ', 'one text']))
    const chunks: string[] = []
    for await (const t of gemini.stream({ apiKey: 'k', system: 's', prompt: 'p' }))
      chunks.push(t)
    expect(chunks.join('')).toBe('Chapter one text')
  })

  it('throws with the last event when the stream completes with no text (e.g. safety block)', async () => {
    const blocked = JSON.stringify({
      candidates: [{ finishReason: 'SAFETY' }],
      promptFeedback: { blockReason: 'SAFETY' },
    })
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${blocked}\r\n\r\n`))
        c.close()
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }))
    await expect(
      (async () => {
        for await (const _ of gemini.stream({ apiKey: 'k', system: 's', prompt: 'p' }));
      })()
    ).rejects.toThrow(/SAFETY/)
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

describe('gemini adapter temperature', () => {
  it('sends generationConfig.temperature when provided and omits it when not', async () => {
    fetchMock.mockResolvedValueOnce(geminiStream(['ok']))
    for await (const t of gemini.stream({ apiKey: 'k', system: 's', prompt: 'p', temperature: 0.5 })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).generationConfig.temperature).toBe(0.5)

    fetchMock.mockResolvedValueOnce(geminiStream(['ok']))
    for await (const t of gemini.stream({ apiKey: 'k', system: 's', prompt: 'p' })) void t
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).generationConfig).toBeUndefined()
  })
})

describe('gemini adapter generateImage', () => {
  function imageResponse(base64: string): Response {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { data: base64 } }] } }],
      }),
      { status: 200 }
    )
  }

  it('returns the inlineData part as base64', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse('aGk='))
    expect(await gemini.generateImage({ apiKey: 'k', prompt: 'a diagram' })).toEqual({ base64: 'aGk=' })
  })

  it('requests TEXT+IMAGE modalities — the live API rejects image-only', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse('aGk='))
    await gemini.generateImage({ apiKey: 'k', prompt: 'a diagram' })
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }]
    expect(url).toContain('gemini-2.5-flash-image:generateContent')
    expect(JSON.parse(init.body).generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE'])
  })

  it('degrades gracefully when a 200 body is not JSON, instead of surfacing a raw SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>gateway says hi</html>', { status: 200 }))
    await expect(gemini.generateImage({ apiKey: 'k', prompt: 'x' })).rejects.toThrow(
      'Gemini returned no image'
    )
  })
})

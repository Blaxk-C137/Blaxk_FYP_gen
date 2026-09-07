import { describe, it, expect } from 'vitest'
import { parseSSE } from './sse.js'

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('parseSSE', () => {
  it('yields extracted text from data events', async () => {
    const res = sseResponse([
      'data: {"t":"Hello"}\n\n',
      'data: {"t":" world"}\n\ndata: {"t":"!"}\n\n',
    ])
    const out: string[] = []
    for await (const t of parseSSE(res, (d) => JSON.parse(d).t)) out.push(t)
    expect(out).toEqual(['Hello', ' world', '!'])
  })
  it('skips events the extractor returns undefined for', async () => {
    const res = sseResponse(['data: {"skip":true}\n\n', 'data: {"t":"ok"}\n\n'])
    const out: string[] = []
    for await (const t of parseSSE(res, (d) => (JSON.parse(d).t ?? undefined))) out.push(t)
    expect(out).toEqual(['ok'])
  })
})

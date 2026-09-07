import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { registerAIRoutes } from './routes.js'
import { gemini } from './providers/gemini.js'

vi.spyOn(gemini, 'testKey').mockResolvedValue({ ok: true })
vi.spyOn(gemini, 'stream').mockImplementation(async function* () {
  yield 'Hello '
  yield 'world'
})

function app() {
  const a = new Hono()
  registerAIRoutes(a)
  return a
}

describe('AI routes', () => {
  it('POST /api/test-key proxies to the adapter', async () => {
    const res = await app().request('/api/test-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('POST /api/generate streams chunks as plain text', async () => {
    const res = await app().request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', system: 's', prompt: 'p' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('Hello world')
  })

  it('rejects unknown providers', async () => {
    const res = await app().request('/api/test-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'nope', apiKey: 'k' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Unknown provider')
  })

  it('provider failure becomes 502 with the provider message', async () => {
    vi.spyOn(gemini, 'stream').mockImplementationOnce(async function* () {
      throw new Error('quota exceeded')
    })
    const res = await app().request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', system: 's', prompt: 'p' }),
    })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('quota exceeded')
  })
})

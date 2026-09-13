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

  it('network failure during test-key becomes 502 with a connection hint, not a 500', async () => {
    vi.spyOn(gemini, 'testKey').mockImplementationOnce(() => {
      throw new TypeError('fetch failed')
    })
    const res = await app().request('/api/test-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k' }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/internet connection/i)
  })

  it('test-key surfaces the underlying DNS cause, not just a generic hint', async () => {
    const e = new TypeError('fetch failed') as TypeError & { cause?: { code: string; message: string } }
    e.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com' }
    vi.spyOn(gemini, 'testKey').mockImplementationOnce(() => {
      throw e
    })
    const res = await app().request('/api/test-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k' }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/DNS/)
    expect(body.error).toContain('ENOTFOUND')
  })

  it('test-key hints at antivirus/firewall interception on certificate failures', async () => {
    const e = new TypeError('fetch failed') as TypeError & { cause?: { code: string; message: string } }
    e.cause = { code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self-signed certificate in certificate chain' }
    vi.spyOn(gemini, 'testKey').mockImplementationOnce(() => {
      throw e
    })
    const res = await app().request('/api/test-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k' }),
    })
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/certificate/)
    expect(body.error).toContain('SELF_SIGNED_CERT_IN_CHAIN')
  })

  it('generate surfaces the classified network cause on stream failure', async () => {
    const e = new TypeError('fetch failed') as TypeError & { cause?: { code: string; message: string } }
    e.cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout' }
    vi.spyOn(gemini, 'stream').mockImplementationOnce(async function* () {
      throw e
    })
    const res = await app().request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', system: 's', prompt: 'p' }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/proxy|VPN/i)
    expect(body.error).toContain('UND_ERR_CONNECT_TIMEOUT')
  })
})

describe('POST /api/generate-image', () => {
  it('returns base64 image data from the provider', async () => {
    vi.spyOn(gemini, 'generateImage').mockResolvedValueOnce({ base64: 'aGk=' })
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', prompt: 'a diagram' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ base64: 'aGk=' })
  })

  it('501 when the provider has no image capability', async () => {
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'k', prompt: 'x' }),
    })
    expect(res.status).toBe(501)
    expect((await res.json()).error).toContain('does not support image generation')
  })

  it('provider failure becomes 502 with the message', async () => {
    vi.spyOn(gemini, 'generateImage').mockRejectedValueOnce(new Error('safety block'))
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', prompt: 'x' }),
    })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('safety block')
  })
})

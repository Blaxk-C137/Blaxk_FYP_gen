import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { REGISTRY } from './providers/registry.js'
import { PROVIDERS } from '../shared/constants.js'
import type { ProviderId } from '../shared/constants.js'

interface GenerateBody {
  provider?: string
  apiKey?: string
  model?: string
  system?: string
  prompt?: string
}

export function registerAIRoutes(app: Hono) {
  app.post('/api/test-key', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ ok: false, error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ ok: false, error: 'Missing API key' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    const result = await provider.testKey(body.apiKey)
    return c.json(result, result.ok ? 200 : 401)
  })

  app.post('/api/generate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ error: 'Missing API key' }, 400)
    if (!body.system || !body.prompt) return c.json({ error: 'Missing system or prompt' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    const gen = provider.stream({
      apiKey: body.apiKey,
      model: body.model,
      system: body.system,
      prompt: body.prompt,
    })
    try {
      // Pull the first chunk before committing to a 200, so an immediate
      // provider failure (bad key, quota) surfaces as 502 JSON.
      const first = await gen.next()
      return stream(c, async (s) => {
        if (!first.done) await s.write(first.value)
        while (true) {
          const { done, value } = await gen.next()
          if (done) break
          await s.write(value)
        }
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Generation failed' }, 502)
    }
  })
}

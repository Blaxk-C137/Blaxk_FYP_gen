import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { REGISTRY } from './providers/registry.js'
import { PROVIDERS } from '../shared/constants.js'
import type { ProviderId } from '../shared/constants.js'
import { configureNetworking, describeNetworkError, hasNetworkCause, logNetworkError } from './net.js'

interface GenerateBody {
  provider?: string
  apiKey?: string
  model?: string
  system?: string
  prompt?: string
  temperature?: number
}

/** `Could not reach gemini: <classified hint> (CODE: message)` */
function networkError(providerId: string, err: unknown): string {
  const { hint, detail } = describeNetworkError(err)
  return `Could not reach ${providerId}: ${hint}${detail}`
}

export function registerAIRoutes(app: Hono) {
  configureNetworking()

  app.post('/api/test-key', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ ok: false, error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ ok: false, error: 'Missing API key' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    console.log(`[fypgen] /api/test-key: ${provider.id} key check starting`)
    try {
      const result = await provider.testKey(body.apiKey)
      console.log(
        `[fypgen] /api/test-key: ${provider.id} ${result.ok ? 'key OK' : `key rejected: ${result.error}`}`
      )
      return c.json(result, result.ok ? 200 : 401)
    } catch (err) {
      // Network-level failure (offline, DNS, proxy, firewall) — not a key problem.
      logNetworkError('/api/test-key', provider.id, err)
      return c.json({ ok: false, error: networkError(provider.id, err) }, 502)
    }
  })

  app.post('/api/generate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ error: 'Missing API key' }, 400)
    if (!body.system || !body.prompt) return c.json({ error: 'Missing system or prompt' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    const started = Date.now()
    console.log(
      `[fypgen] /api/generate: ${provider.id} model=${body.model ?? provider.defaultModel} ` +
        `system=${body.system?.length ?? 0} chars prompt=${body.prompt?.length ?? 0} chars`
    )
    const gen = provider.stream({
      apiKey: body.apiKey,
      model: body.model,
      system: body.system,
      prompt: body.prompt,
      temperature: body.temperature,
    })
    try {
      // Pull the first chunk before committing to a 200, so an immediate
      // provider failure (bad key, quota) surfaces as 502 JSON.
      const first = await gen.next()
      return stream(c, async (s) => {
        let chars = 0
        try {
          if (!first.done) {
            chars += first.value.length
            await s.write(first.value)
          }
          while (true) {
            const { done, value } = await gen.next()
            if (done) break
            chars += value.length
            await s.write(value)
          }
          console.log(
            `[fypgen] /api/generate: ${provider.id} done, ${chars} chars in ${(
              (Date.now() - started) /
              1000
            ).toFixed(1)}s`
          )
        } catch (err) {
          // The response has already started, so the client just sees the
          // stream cut short — log what happened and how far it got.
          console.error(
            `[fypgen] /api/generate: ${provider.id} stream failed after ${chars} chars`,
            err
          )
        }
      })
    } catch (err) {
      logNetworkError('/api/generate', provider.id, err)
      if (!hasNetworkCause(err))
        console.error(`[fypgen] /api/generate: ${provider.id} error:`, err)
      const message = hasNetworkCause(err)
        ? networkError(provider.id, err)
        : err instanceof Error
          ? err.message
          : 'Generation failed'
      return c.json({ error: message }, 502)
    }
  })

  app.post('/api/generate-image', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ error: 'Missing API key' }, 400)
    if (!body.prompt) return c.json({ error: 'Missing prompt' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    if (!provider.generateImage) {
      return c.json({ error: `${provider.id} does not support image generation` }, 501)
    }
    try {
      const { base64 } = await provider.generateImage({ apiKey: body.apiKey, prompt: body.prompt })
      return c.json({ base64 })
    } catch (err) {
      logNetworkError('/api/generate-image', provider.id, err)
      return c.json(
        { error: hasNetworkCause(err) ? networkError(provider.id, err) : err instanceof Error ? err.message : 'Image generation failed' },
        502
      )
    }
  })
}

import type { AIProvider } from './types.js'
import { parseSSE } from './sse.js'
import { DEFAULT_MODELS } from '../../shared/constants.js'

export const anthropic: AIProvider = {
  id: 'anthropic',
  defaultModel: DEFAULT_MODELS.anthropic,

  async testKey(apiKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: this.defaultModel, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` }
  },

  async *stream({ apiKey, model, system, prompt }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model ?? this.defaultModel,
        system,
        stream: true,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Anthropic error HTTP ${res.status}`)
    }
    yield* parseSSE(res, (data) => {
      const j = JSON.parse(data) as { type?: string; delta?: { text?: string } }
      if (j.type === 'content_block_delta') return j.delta?.text
      return undefined
    })
  },
}

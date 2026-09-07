import type { AIProvider } from './types.js'
import { parseSSE } from './sse.js'
import { DEFAULT_MODELS } from '../../shared/constants.js'

export const openai: AIProvider = {
  id: 'openai',
  defaultModel: DEFAULT_MODELS.openai,

  async testKey(apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: this.defaultModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` }
  },

  async *stream({ apiKey, model, system, prompt }) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model ?? this.defaultModel,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `OpenAI error HTTP ${res.status}`)
    }
    yield* parseSSE(res, (data) => {
      if (data === '[DONE]') return undefined
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
      return j.choices?.[0]?.delta?.content
    })
  },
}

import type { AIProvider } from './types.js'
import { parseSSE } from './sse.js'
import { DEFAULT_MODELS } from '../../shared/constants.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const gemini: AIProvider = {
  id: 'gemini',
  defaultModel: DEFAULT_MODELS.gemini,

  async testKey(apiKey) {
    const res = await fetch(`${BASE}/${this.defaultModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` }
  },

  async *stream({ apiKey, model, system, prompt }) {
    const m = model ?? this.defaultModel
    const res = await fetch(`${BASE}/${m}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Gemini error HTTP ${res.status}`)
    }
    yield* parseSSE(res, (data) => {
      const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      return j.candidates?.[0]?.content?.parts?.[0]?.text
    })
  },
}

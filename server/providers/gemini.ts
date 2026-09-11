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
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` }
  },

  async *stream({ apiKey, model, system, prompt, temperature }) {
    const m = model ?? this.defaultModel
    const res = await fetch(`${BASE}/${m}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(temperature !== undefined ? { generationConfig: { temperature } } : {}),
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Gemini error HTTP ${res.status}`)
    }
    // Keep the last raw event so a textless stream (safety block, empty
    // candidates) can be reported with its actual reason instead of silence.
    let lastEvent = ''
    let textChunks = 0
    for await (const text of parseSSE(res, (data) => {
      lastEvent = data
      const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      return j.candidates?.[0]?.content?.parts?.[0]?.text
    })) {
      textChunks++
      yield text
    }
    if (textChunks === 0)
      throw new Error(
        `Gemini returned no text. Last event: ${lastEvent.slice(0, 300) || '(empty stream)'}`
      )
  },
}

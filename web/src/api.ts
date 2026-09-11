import type { Settings } from './state/store'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function testKey(settings: Settings): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/test-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: settings.provider, apiKey: settings.apiKey, model: settings.model }),
  })
  return res.json()
}

export async function generateStream(
  settings: Settings,
  system: string,
  prompt: string,
  onChunk: (chunk: string) => void,
  temperature?: number
): Promise<string> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: settings.provider, apiKey: settings.apiKey, model: settings.model,
      system, prompt, temperature,
    }),
  })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    full += chunk
    onChunk(chunk)
  }
  return full
}

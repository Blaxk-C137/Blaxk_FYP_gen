import type { Settings, ReferenceEntry } from './state/store'
import type { ReferenceInput } from '@shared/constants'

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

/** Verifies + formats reference entries server-side. Never throws for a single
 *  bad entry — the server degrades those to verified: false. */
export async function resolveReferences(entries: ReferenceInput[]): Promise<ReferenceEntry[]> {
  const res = await fetch('/api/citations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }
  const j = (await res.json()) as { results: { input: ReferenceInput; apa: string; verified: boolean; doi?: string }[] }
  return j.results.map((r) => ({ key: r.input.key, apa: r.apa, verified: r.verified, doi: r.doi }))
}

/** Generates one image; null on any failure (images are always optional). */
export async function generateImage(settings: Settings, prompt: string): Promise<string | null> {
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: settings.provider, apiKey: settings.apiKey, prompt }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { base64?: string }
    return j.base64 ?? null
  } catch {
    return null
  }
}

/** Fetches the university logo; null on any failure. */
export async function fetchLogo(university: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(`/api/logo?university=${encodeURIComponent(university)}`)
    if (!res.ok) return null
    const j = (await res.json()) as { logo: { base64: string; mime: string } | null }
    return j.logo
  } catch {
    return null
  }
}

// server/freeImage.ts
import { configureNetworking } from './net.js'

/** Keyless figure generation via Pollinations, proxied server-side.
 *  Pollinations rejects browser-originated requests ("Missing Turnstile
 *  token"), so this fetch must run on the server — the client calls
 *  /api/generate-image-free instead of talking to Pollinations directly. */

const URL_BASE = 'https://image.pollinations.ai/prompt/'
const FETCH_TIMEOUT_MS = 30_000

export async function freeImage(prompt: string): Promise<string> {
  configureNetworking()
  const url = `${URL_BASE}${encodeURIComponent(prompt)}?width=1024&height=576&nologo=true`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Pollinations error HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (!buf.length) throw new Error('Pollinations returned no image')
  return Buffer.from(buf).toString('base64')
}

// web/src/ai/pollinationsImages.ts
/** Free keyless figure generation via Pollinations, proxied through the local
 *  server (/api/generate-image-free) — Pollinations rejects direct browser
 *  requests with "Missing Turnstile token", so the fetch must be server-side.
 *  Never throws: every failure is null and the caller falls through to the
 *  next image source in the export chain. */

/** Pollinations is slow-ish (5-15s per image) but not *that* slow — anything
 *  past this is a stall and the export should move on, not wait. */
const FETCH_TIMEOUT_MS = 45_000

export async function pollinationsImage(prompt: string): Promise<string | null> {
  try {
    const res = await fetch('/api/generate-image-free', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { base64?: string }
    return j.base64 ?? null
  } catch {
    // Server down, timeout, network — images are optional; degrade to null.
    return null
  }
}

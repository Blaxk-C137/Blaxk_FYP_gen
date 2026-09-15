// web/src/ai/puterImages.ts
/** Free figure generation via Puter.js (User-Pays: the student signs in once
 *  and spends their own free credits — no developer API cost). Browser-side
 *  only; the script is loaded in index.html. Never throws: every failure is
 *  null and the caller falls back to the key-based image path. */

interface PuterAI {
  txt2img: (prompt: string) => Promise<unknown>
}
interface PuterGlobal {
  ai?: PuterAI
}

declare global {
  interface Window {
    puter?: PuterGlobal
  }
}

export function puterAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.puter?.ai?.txt2img === 'function'
}

/** A returned image that never loads (broken blob URL, network stall) must not
 *  hang the export — give up after this long. */
const LOAD_TIMEOUT_MS = 10_000

/** The txt2img result is an <img> element (or an object with a .src). Whatever
 *  the src is — data URI or blob URL — normalize it to raw base64 PNG. */
async function toBase64(result: unknown): Promise<string | null> {
  const src =
    result instanceof HTMLImageElement
      ? result.src
      : result && typeof result === 'object' && typeof (result as HTMLImageElement).src === 'string'
        ? (result as HTMLImageElement).src
        : null
  if (!src) return null
  if (src.startsWith('data:image/')) {
    const b64 = src.slice(src.indexOf(',') + 1)
    return b64 || null
  }
  // blob:/remote URL — decode through a canvas so the export gets plain base64.
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT_MS)
    img.onload = () => { clearTimeout(timer); resolve(true) }
    img.onerror = () => { clearTimeout(timer); resolve(false) }
  })
  img.src = src
  if (!(await loaded)) return null
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  if (!canvas.width || !canvas.height) return null
  canvas.getContext('2d')?.drawImage(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  return url.slice(url.indexOf(',') + 1) || null
}

export async function puterImage(prompt: string): Promise<string | null> {
  try {
    if (!puterAvailable()) return null
    const result = await window.puter!.ai!.txt2img(prompt)
    return await toBase64(result)
  } catch {
    // Absent/blocked script, cancelled sign-in, generation failure — images
    // are optional, so every failure degrades to the fallback path.
    return null
  }
}

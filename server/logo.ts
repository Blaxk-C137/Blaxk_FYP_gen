/** University logo scraper: DuckDuckGo → homepage → best icon. Degrades to
 *  null on any failure; never throws (a logo is always optional). */

export interface LogoResult { logo: { base64: string; mime: string } | null; source?: string }

const cache = new Map<string, LogoResult>()
export function resetLogoCache() { cache.clear() }

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; fypgen/1.0; +https://github.com)' }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

/** First external result URL from a DuckDuckGo HTML results page. */
function firstResultUrl(searchHtml: string): string | null {
  const m = /uddg=([^&"]+)/.exec(searchHtml)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

/** Icon candidates from a homepage, best first. */
function iconCandidates(pageHtml: string, origin: string): string[] {
  const out: string[] = []
  for (const tag of pageHtml.match(/<link[^>]+>/gi) ?? []) {
    const href = /href="([^"]+)"/i.exec(tag)?.[1]
    if (!href) continue
    if (/apple-touch-icon/i.test(tag)) out.push(href)
    else if (/rel="[^"]*icon[^"]*"/i.test(tag)) out.push(href)
  }
  const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(pageHtml)?.[1]
    ?? /<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i.exec(pageHtml)?.[1]
  if (og) out.splice(1, 0, og) // apple-touch-icon first, then og:image, then icons
  out.push('/favicon.ico')
  return out
}

async function scrape(university: string): Promise<LogoResult> {
  const q = encodeURIComponent(`${university} official website`)
  const search = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, { headers: UA, signal: AbortSignal.timeout(5_000) })
  const site = firstResultUrl(await search.text())
  if (!site) return { logo: null }
  const origin = new URL(site).origin
  const page = await fetch(`${origin}/`, { headers: UA, signal: AbortSignal.timeout(5_000) })
  const pageHtml = await page.text()
  for (const href of iconCandidates(pageHtml, origin)) {
    try {
      const url = new URL(href, origin).toString()
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(5_000) })
      const mime = (res.headers.get('content-type') ?? '').toLowerCase()
      if (!res.ok || !(mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg'))) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > 2_000_000) continue
      return { logo: { base64: buf.toString('base64'), mime: mime.includes('png') ? 'image/png' : 'image/jpeg' }, source: url }
    } catch { /* try the next candidate */ }
  }
  return { logo: null }
}

export async function findUniversityLogo(university: string): Promise<LogoResult> {
  const key = university.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const result = await withTimeout(scrape(university), 10_000).catch(() => ({ logo: null }) as LogoResult)
  cache.set(key, result)
  return result
}

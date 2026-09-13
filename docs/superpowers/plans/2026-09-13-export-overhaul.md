# Export Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix DOCX numbering/TOC/figures, build a verified citation pipeline (Citation.js + Crossref + citeproc), and rebuild the PPTX on the reference deck's methodology.

**Architecture:** Three new Hono routes (image generation via Gemini, university-logo scraper, citation resolution) feed two export reworks. Citations become structured AI output → server-side CSL formatting + Crossref verification → typed store entries. The deck builder ports the example deck's layout (13.33×7.5, Arial, footer strips, continued-slides auto-split, notes, references slides) with deterministic, code-owned layout decisions.

**Tech Stack:** TypeScript, Hono, citation-js, JSZip, docx, pptxgenjs, zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-export-overhaul-design.md`

## Global Constraints

- Web tests run from `web/`: `npx vitest run <path>` (jsdom via `// @vitest-environment jsdom` pragma for screen/export tests).
- Root (server) tests run from the repo root: `npx vitest run <path>`.
- TDD: failing test first, minimal implementation, green, commit — every task.
- The AI decides **content only**; layout, colors, ordering, splitting, page estimation are code.
- No invented results/metrics/citations (prompt rule + Crossref verification).
- Example-deck colors verbatim: dark green `2F3D32`, accent `548C2F`, light `9CC85D`, muted `637369`, attention red `C00000`.
- UI copy matches the paper-toned register (`web/src/styles.css`).
- **Commit messages carry NO Claude/Anthropic attribution lines** (user's global CLAUDE.md overrides defaults).
- Graceful degradation: an enrichment failure (image, logo, citation) never fails an export.

**Documented judgment call (deviation from spec wording, same intent):** `citation-js` cannot parse raw APA *text* (its input formats are BibTeX/CSL-JSON/DOI/Wikidata). So the AI returns **structured fields** (`authors/year/title/container/volume/issue/pages/doi`) in strict JSON; the server builds CSL-JSON from them and uses citation-js's bundled citeproc to *format* APA output, then verifies against Crossref. The spec's pipeline shape (AI entries → verify → citeproc format) is unchanged.

---

### Task 1: Gemini `generateImage` + `POST /api/generate-image`

**Files:**
- Modify: `server/providers/gemini.ts` (add `generateImage` to the provider object)
- Modify: `server/routes.ts` (add route inside `registerAIRoutes`)
- Test: `server/routes.test.ts` (append)

**Interfaces:**
- Consumes: `ImageRequest` from `server/providers/types.ts` (already declared: `{ apiKey: string; model?: string; prompt: string }` → `Promise<{ base64: string }>`).
- Produces: `POST /api/generate-image` body `{ provider, apiKey, prompt }` → `{ base64 }` (200) | `{ error }` (400/501/502). Task 10 and Task 16 call it via a client helper.

- [ ] **Step 1: Write the failing tests**

Append to `server/routes.test.ts`:

```ts
describe('POST /api/generate-image', () => {
  it('returns base64 image data from the provider', async () => {
    vi.spyOn(gemini, 'generateImage').mockResolvedValueOnce({ base64: 'aGk=' })
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', prompt: 'a diagram' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ base64: 'aGk=' })
  })

  it('501 when the provider has no image capability', async () => {
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'k', prompt: 'x' }),
    })
    expect(res.status).toBe(501)
    expect((await res.json()).error).toContain('does not support image generation')
  })

  it('provider failure becomes 502 with the message', async () => {
    vi.spyOn(gemini, 'generateImage').mockRejectedValueOnce(new Error('safety block'))
    const res = await app().request('/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: 'k', prompt: 'x' }),
    })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('safety block')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/routes.test.ts`
Expected: FAIL — 404s (`generateImage` does not exist yet; route missing).

- [ ] **Step 3: Implement**

In `server/providers/gemini.ts`, add to the `gemini` provider object (after `stream`):

```ts
  async generateImage({ apiKey, model, prompt }) {
    const m = model ?? 'gemini-2.5-flash-image'
    const res = await fetch(`${BASE}/${m}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Gemini error HTTP ${res.status}`)
    }
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
    }
    const base64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
    if (!base64) throw new Error('Gemini returned no image')
    return { base64 }
  },
```

In `server/routes.ts`, extend the `GenerateBody` interface with `prompt` (already present) and append inside `registerAIRoutes` (after `/api/generate`):

```ts
  app.post('/api/generate-image', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as GenerateBody
    if (!body.provider || !PROVIDERS.includes(body.provider as never)) {
      return c.json({ error: 'Unknown provider' }, 400)
    }
    if (!body.apiKey) return c.json({ error: 'Missing API key' }, 400)
    if (!body.prompt) return c.json({ error: 'Missing prompt' }, 400)
    const provider = REGISTRY[body.provider as ProviderId]
    if (!provider.generateImage) {
      return c.json({ error: `${provider.id} does not support image generation` }, 501)
    }
    try {
      const { base64 } = await provider.generateImage({ apiKey: body.apiKey, prompt: body.prompt })
      return c.json({ base64 })
    } catch (err) {
      logNetworkError('/api/generate-image', provider.id, err)
      return c.json(
        { error: hasNetworkCause(err) ? networkError(provider.id, err) : err instanceof Error ? err.message : 'Image generation failed' },
        502
      )
    }
  })
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run server/routes.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add server/providers/gemini.ts server/routes.ts server/routes.test.ts
git commit -m "feat: gemini image generation provider and /api/generate-image route"
```

---

### Task 2: University logo scraper — `GET /api/logo`

**Files:**
- Create: `server/logo.ts`
- Modify: `server/routes.ts` (route; needs a new export or goes in `registerAIRoutes` — put it there)
- Test: `server/logo.test.ts` (new)

**Interfaces:**
- Consumes: nothing (platform `fetch`).
- Produces:

```ts
// server/logo.ts
export interface LogoResult { logo: { base64: string; mime: string } | null; source?: string }
export function resetLogoCache(): void  // test isolation
export async function findUniversityLogo(university: string): Promise<LogoResult>
```

Route: `GET /api/logo?university=<name>` → always 200 `{ logo: { base64, mime } | null }`.

- [ ] **Step 1: Write the failing tests**

Create `server/logo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findUniversityLogo, resetLogoCache } from './logo.js'

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })

beforeEach(() => resetLogoCache())
afterEach(() => vi.unstubAllGlobals())

describe('findUniversityLogo', () => {
  it('resolves search → homepage → apple-touch-icon to base64 png', async () => {
    const search = html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbuk.edu.ng%2F">Bayero University Kano</a>')
    const home = html('<link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>BUK</title>')
    const icon = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return search
      if (url === 'https://buk.edu.ng/') return home
      if (url === 'https://buk.edu.ng/apple-touch-icon.png') return icon
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await findUniversityLogo('Bayero University Kano')
    expect(r.logo?.base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(r.logo?.mime).toBe('image/png')
  })

  it('caches per university — second call makes no network requests', async () => {
    const icon = new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/png' } })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.edu%2F">X</a>')
      if (url === 'https://x.edu/') return html('<link rel="icon" href="/favicon.ico">')
      return icon
    })
    vi.stubGlobal('fetch', fetchMock)
    await findUniversityLogo('X University')
    await findUniversityLogo('X University')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects svg icons and returns null when nothing usable exists', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo')) return html('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.edu%2F">X</a>')
      if (url === 'https://x.edu/') return html('<link rel="icon" href="/icon.svg">')
      return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect((await findUniversityLogo('X University')).logo).toBeNull()
  })

  it('network failure degrades to null, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect((await findUniversityLogo('Y University')).logo).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/logo.test.ts`
Expected: FAIL — cannot resolve `./logo.js`.

- [ ] **Step 3: Implement**

Create `server/logo.ts`:

```ts
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
  const page = await fetch(origin, { headers: UA, signal: AbortSignal.timeout(5_000) })
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
```

In `server/routes.ts`, append inside `registerAIRoutes`:

```ts
  app.get('/api/logo', async (c) => {
    const university = c.req.query('university')?.trim()
    if (!university) return c.json({ logo: null })
    try {
      return c.json(await findUniversityLogo(university))
    } catch {
      return c.json({ logo: null })
    }
  })
```

(Import `findUniversityLogo` from `./logo.js` at the top.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run server/logo.test.ts server/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/logo.ts server/logo.test.ts server/routes.ts
git commit -m "feat: university logo scraper with caching and /api/logo route"
```

---

### Task 3: Citation resolver — `POST /api/citations`

**Files:**
- Create: `server/citations.ts`
- Modify: `shared/constants.ts` (shared `ReferenceInput` type)
- Modify: `server/routes.ts` (route)
- Test: `server/citations.test.ts` (new)

**Interfaces:**
- Consumes: `citation-js` (new root dependency: `npm i citation-js`).
- Produces:

```ts
// shared/constants.ts — add:
/** One structured citation from the AI; the server formats + verifies it. */
export interface ReferenceInput {
  key: string; authors: string; year: string; title: string
  container?: string; volume?: string; issue?: string; pages?: string; doi?: string
}

// server/citations.ts
export interface CitationResult { input: ReferenceInput; apa: string; verified: boolean; doi?: string }
export function buildApa(e: ReferenceInput): string   // pure — CSL via citation-js
export async function resolveCitations(entries: ReferenceInput[]): Promise<CitationResult[]>
```

Route: `POST /api/citations` body `{ entries: ReferenceInput[] }` → `{ results: CitationResult[] }`; 400 on non-array/empty-items; max 100 entries.

- [ ] **Step 1: Install dependency**

Run (repo root): `npm i citation-js`

- [ ] **Step 2: Write the failing tests**

Create `server/citations.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApa, resolveCitations } from './citations.js'
import type { ReferenceInput } from '../shared/constants.js'

const entry: ReferenceInput = {
  key: 'Alibakhshikenari et al., 2020',
  authors: 'Alibakhshikenari, M. & Virdee, B. S.',
  year: '2020', title: 'Mutual coupling suppression of MIMO antenna arrays',
  container: 'IEEE Access', volume: '8', issue: '', pages: '139-182', doi: '',
}

afterEach(() => vi.unstubAllGlobals())

describe('buildApa', () => {
  it('formats a structured entry as an APA reference line', () => {
    const apa = buildApa(entry)
    expect(apa).toContain('Alibakhshikenari')
    expect(apa).toContain('(2020)')
    expect(apa).toContain('Mutual coupling suppression')
    expect(apa).toMatch(/\.\s*$/)
  })

  it('is deterministic — same input, same output', () => {
    expect(buildApa(entry)).toBe(buildApa(entry))
  })
})

describe('resolveCitations', () => {
  it('marks verified when Crossref returns a matching title, with the authoritative DOI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: { items: [{ DOI: '10.1109/access.2020.123', title: ['Mutual coupling suppression of MIMO antenna arrays'] }] },
    }), { headers: { 'content-type': 'application/json' } })))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(true)
    expect(r.doi).toBe('10.1109/access.2020.123')
  })

  it('marks unverified when Crossref titles do not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: { items: [{ DOI: '10.x/y', title: ['Completely different paper about birds'] }] },
    }), { headers: { 'content-type': 'application/json' } })))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(false)
    expect(r.doi).toBeUndefined()
  })

  it('Crossref/network failure degrades to unverified, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const [r] = await resolveCitations([entry])
    expect(r.verified).toBe(false)
    expect(r.apa).toContain('Mutual coupling suppression')
  })

  it('entries without a title pass through unverified', async () => {
    const [r] = await resolveCitations([{ key: 'k', authors: 'A, B.', year: '2020', title: '' }])
    expect(r.verified).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run server/citations.test.ts`
Expected: FAIL — cannot resolve `./citations.js`.

- [ ] **Step 4: Implement**

Add to `shared/constants.ts`:

```ts
/** One structured citation from the AI; the server formats + verifies it. */
export interface ReferenceInput {
  key: string; authors: string; year: string; title: string
  container?: string; volume?: string; issue?: string; pages?: string; doi?: string
}
```

Create `server/citations.ts`:

```ts
import { Cite } from 'citation-js'
import type { ReferenceInput } from '../shared/constants.js'

export interface CitationResult { input: ReferenceInput; apa: string; verified: boolean; doi?: string }

/** "Family, F. & Family, F." → CSL author objects. Tolerates ', '-separated lists. */
function parseAuthors(s: string): { family: string; given?: string }[] {
  return s
    .split(/\s*(?:&|;|,?\s+and\s+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p && !/et\s+al/i.test(p))
    .map((p) => {
      const m = /^(.+?),\s*(.+)$/.exec(p)
      return m ? { family: m[1].trim(), given: m[2].trim() } : { family: p }
    })
}

function toCsl(e: ReferenceInput) {
  return {
    type: e.container ? 'article-journal' : 'report',
    author: parseAuthors(e.authors),
    issued: e.year ? { 'date-parts': [[Number(e.year) || e.year]] } : undefined,
    title: e.title,
    'container-title': e.container || undefined,
    volume: e.volume || undefined,
    issue: e.issue || undefined,
    page: e.pages || undefined,
    DOI: e.doi || undefined,
  }
}

/** Deterministic APA rendering via citation-js's bundled citeproc. */
export function buildApa(e: ReferenceInput): string {
  if (!e.title) return [e.authors, `(${e.year}).`, e.title].filter(Boolean).join(' ')
  try {
    const out = new Cite(toCsl(e) as never).format('bibliography', { format: 'text', template: 'apa' })
    return out.trim()
  } catch {
    // citeproc rejection (bare minimum fields): assemble manually
    return [`${e.authors} (${e.year}).`, e.title, e.container ? `*${e.container}*` : '', [e.volume, e.issue].filter(Boolean).join('(') + (e.volume || e.issue ? '),' : ''), e.pages, e.doi ? `https://doi.org/${e.doi}` : '']
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }
}

/** Token-containment similarity: what fraction of a's words appear in b. */
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const A = norm(a), B = new Set(norm(b))
  if (!A.length || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / A.length
}

async function resolveOne(e: ReferenceInput): Promise<CitationResult> {
  const apa = buildApa(e)
  if (!e.title) return { input: e, apa, verified: false }
  try {
    const url =
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(e.title)}` +
      `&rows=3&mailto=fypgen-app@users.noreply.github.com`
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const j = (await res.json()) as { message?: { items?: { DOI: string; title?: string[] }[] } }
      const best = j.message?.items?.find((i) => similarity(e.title, i.title?.[0] ?? '') >= 0.85)
      if (best) return { input: e, apa, verified: true, doi: best.DOI }
    }
  } catch { /* offline / crossref down → unverified */ }
  return { input: e, apa, verified: false }
}

export async function resolveCitations(entries: ReferenceInput[]): Promise<CitationResult[]> {
  return Promise.all(entries.slice(0, 100).map(resolveOne))
}
```

In `server/routes.ts`, append inside `registerAIRoutes`:

```ts
  app.post('/api/citations', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { entries?: unknown }
    if (!Array.isArray(body.entries)) return c.json({ error: 'entries must be an array' }, 400)
    const entries = body.entries as ReferenceInput[]
    if (entries.length === 0 || entries.length > 100) return c.json({ error: 'entries must contain 1–100 items' }, 400)
    if (entries.some((e) => !e || typeof e !== 'object' || typeof e.title !== 'string')) {
      return c.json({ error: 'each entry needs at least a title' }, 400)
    }
    try {
      return c.json({ results: await resolveCitations(entries) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Citation resolution failed' }, 502)
    }
  })
```

(Import `resolveCitations` from `./citations.js` and `ReferenceInput` from `../shared/constants.js`.)

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run server/citations.test.ts server/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/citations.ts server/citations.test.ts server/routes.ts shared/constants.ts package.json package-lock.json
git commit -m "feat: citation resolver — CSL formatting, Crossref verification, /api/citations"
```

---

### Task 4: `extractCitations` — in-text citation key extraction

**Files:**
- Create: `web/src/ai/extractCitations.ts`
- Test: `web/src/ai/extractCitations.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `extractCitations(text: string): string[]` — canonical, deduplicated keys in order of first appearance. Task 7 calls it over all chapter texts.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/ai/extractCitations.test.ts
import { describe, it, expect } from 'vitest'
import { extractCitations } from './extractCitations'

describe('extractCitations', () => {
  it('pulls simple parenthetical citations', () => {
    expect(extractCitations('Security is a concern (Okonkwo, 2019).'))
      .toEqual(['Okonkwo, 2019'])
  })

  it('splits multi-citation parentheticals and keeps first-appearance order', () => {
    const keys = extractCitations('One view (Smith & Jones, 2021; Adeyemi et al., 2020) differs from another (Smith & Jones, 2021).')
    expect(keys).toEqual(['Smith & Jones, 2021', 'Adeyemi et al., 2020'])
  })

  it('captures narrative citations and normalizes "and" to "&"', () => {
    expect(extractCitations('Bello and Musa (2022) found that growth slowed.'))
      .toEqual(['Bello & Musa, 2022'])
    expect(extractCitations('NCC et al. (2023) reported a rise.'))
      .toEqual(['NCC et al., 2023'])
  })

  it('strips page-pinpoint suffixes', () => {
    expect(extractCitations('As shown (Ibrahim, 2018, p. 45), yields fell.'))
      .toEqual(['Ibrahim, 2018'])
  })

  it('ignores bare years, acronyms and non-citations', () => {
    expect(extractCitations('In 2020 the market grew (see Appendix). Data (NBS, 2021) says otherwise.'))
      .toEqual(['NBS, 2021'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/ai/extractCitations.test.ts`
Expected: FAIL — cannot resolve `./extractCitations`.

- [ ] **Step 3: Implement**

```ts
// web/src/ai/extractCitations.ts
/** Canonical APA citation keys from chapter text: parenthetical and narrative
 *  forms, deduplicated in first-appearance order. Pure, never throws. */

function canonical(raw: string): string | null {
  let t = raw.trim()
  // Drop page pinpoints: ", p. 45" / ", pp. 12-20" at the end.
  t = t.replace(/,?\s*p{1,2}\.\s*\d+(?:\s*[–-]\s*\d+)?\s*$/i, '').trim()
  const m = /^(.+?),\s*(\d{4}[a-z]?)$/.exec(t)
  if (!m) return null
  let authors = m[1].trim()
  if (!/^[A-Z]/.test(authors)) return null
  if (/^(see|also|cf|e\.g|i\.e)$/i.test(authors)) return null
  authors = authors.replace(/\s+and\s+/gi, ' & ').replace(/\s+/g, ' ')
  return `${authors}, ${m[2]}`
}

export function extractCitations(text: string): string[] {
  const keys: string[] = []
  const add = (k: string | null) => {
    if (k && !keys.includes(k)) keys.push(k)
  }
  // Parenthetical: (Author, 2020; Author & Author, 2021) — must contain a year.
  for (const m of text.matchAll(/\(([^()]*\b\d{4}[^()]*)\)/g)) {
    for (const part of m[1].split(';')) add(canonical(part))
  }
  // Narrative: Author (2020) / Author et al. (2020) / Author and Author (2020)
  for (const m of text.matchAll(
    /([A-Z][A-Za-z'’-]+(?:\s+(?:et al\.|and\s+[A-Z][A-Za-z'’-]+))?)\s+\((\d{4})\)/g
  )) {
    add(canonical(`${m[1]}, ${m[2]}`))
  }
  return keys
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/ai/extractCitations.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/ai/extractCitations.ts web/src/ai/extractCitations.test.ts
git commit -m "feat: in-text citation key extraction"
```

---

### Task 5: `referencesPrompt` + `parseReferences`

**Files:**
- Modify: `web/src/prompts.ts` (append `referencesPrompt`)
- Create: `web/src/ai/parseReferences.ts`
- Test: `web/src/prompts.test.ts` (append) + `web/src/ai/parseReferences.test.ts` (new)

**Interfaces:**
- Consumes: `ReferenceInput` from `@shared/constants` (Task 3), `ProjectInfo` from `../state/store`.
- Produces:

```ts
// web/src/ai/parseReferences.ts
export function parseReferences(raw: string): ReferenceInput[]  // throws Error('Model did not return valid JSON') when nothing usable
```

`referencesPrompt(project: ProjectInfo, keys: string[]): string`. Task 7 calls both.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/prompts.test.ts`:

```ts
import { referencesPrompt } from './prompts' // extend the existing import

describe('referencesPrompt', () => {
  it('carries the topic and every citation key, demands strict JSON', () => {
    const p = referencesPrompt(
      { ...EMPTY_PROJECT, topic: 'IoT theft detection' },
      ['Okonkwo, 2019', 'Smith & Jones, 2021']
    )
    expect(p).toContain('IoT theft detection')
    expect(p).toContain('Okonkwo, 2019')
    expect(p).toContain('Smith & Jones, 2021')
    expect(p).toContain('```json')
    expect(p).toContain('never invent')
    expect(p).toContain('"authors"')
  })
})
```

Create `web/src/ai/parseReferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseReferences } from './parseReferences'

const full = JSON.stringify({ entries: [
  { key: 'Okonkwo, 2019', authors: 'Okonkwo, C.', year: '2019', title: 'Campus security in Nigeria', container: 'Safety Journal', volume: '4', issue: '2', pages: '10-20', doi: '' },
  { key: 'Smith & Jones, 2021', authors: 'Smith, A. & Jones, B.', year: '2021', title: 'Sensor networks', container: '', volume: '', issue: '', pages: '', doi: '10.1/x' },
] })

describe('parseReferences', () => {
  it('parses clean JSON', () => {
    const r = parseReferences(full)
    expect(r).toHaveLength(2)
    expect(r[0].title).toBe('Campus security in Nigeria')
    expect(r[1].doi).toBe('10.1/x')
  })

  it('extracts from a fenced block with prose around it', () => {
    const r = parseReferences(`Sure!\n\`\`\`json\n${full}\n\`\`\`\nDone.`)
    expect(r).toHaveLength(2)
  })

  it('drops entries without a title or authors and defaults optional fields', () => {
    const r = parseReferences(JSON.stringify({ entries: [
      { key: 'a', authors: '', year: '2020', title: '' },
      { key: 'b', authors: 'X, Y.', year: '2021', title: 'Good title' },
    ] }))
    expect(r).toHaveLength(1)
    expect(r[0].container).toBe('')
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseReferences('I could not do that.')).toThrow('Model did not return valid JSON')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/ai/parseReferences.test.ts src/prompts.test.ts`
Expected: FAIL — `referencesPrompt` not exported; `./parseReferences` unresolvable.

- [ ] **Step 3: Implement**

Append to `web/src/prompts.ts`:

```ts
// ---------------------------------------------------------------------------
// References — turn extracted citation keys into structured entries
// ---------------------------------------------------------------------------

export function referencesPrompt(project: ProjectInfo, keys: string[]): string {
  return `Produce full bibliographic details for every citation used in this final year project.

Topic: ${project.topic}

Citation keys found in the chapters (author, year):
${keys.map((k) => `- ${k}`).join('\n')}

Rules:
- Use ONLY real published works you are genuinely certain about. Never invent authors, years, journals, volumes, or DOIs — an empty field is always better than a fake one.
- Join multiple authors with " & " like: Family, F. & Family, F.
- If you cannot identify a real work for a key, omit that key from the response entirely.
- "container" is the journal or book title; leave it empty for standalone works.

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape:

\`\`\`json
{ "entries": [ { "key": "Author, 2020", "authors": "Family, F. & Family, F.", "year": "2020", "title": "Full article or book title", "container": "Journal Name", "volume": "8", "issue": "2", "pages": "139-182", "doi": "" } ] }
\`\`\``
}
```

Create `web/src/ai/parseReferences.ts`:

```ts
/** Tolerant parser for the references JSON contract (same pattern as
 *  parseOutline/parseSlides): fenced blocks, per-field defaults, throws only
 *  when nothing usable returns. */
import type { ReferenceInput } from '@shared/constants'

function entry(v: unknown): ReferenceInput | null {
  if (typeof v !== 'object' || v === null) return null
  const e = v as Record<string, unknown>
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const title = str(e.title)
  const authors = str(e.authors)
  if (!title || !authors) return null
  return {
    key: str(e.key), authors, year: str(e.year), title,
    container: str(e.container), volume: str(e.volume), issue: str(e.issue),
    pages: str(e.pages), doi: str(e.doi),
  }
}

export function parseReferences(raw: string): ReferenceInput[] {
  const candidates: string[] = []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) candidates.push(fenced[1])
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1))
  candidates.push(raw)

  for (const candidate of candidates) {
    let parsed: unknown
    try { parsed = JSON.parse(candidate.trim()) } catch { continue }
    const entries = (parsed as { entries?: unknown })?.entries
    if (!Array.isArray(entries)) continue
    const out = entries.map(entry).filter((e): e is ReferenceInput => e !== null)
    if (out.length) return out
  }
  throw new Error('Model did not return valid JSON')
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/ai/parseReferences.test.ts src/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/prompts.ts web/src/prompts.test.ts web/src/ai/parseReferences.ts web/src/ai/parseReferences.test.ts
git commit -m "feat: references prompt and tolerant structured parser"
```

---

### Task 6: Store migration — `ReferenceEntry[]` + API clients

**Files:**
- Modify: `web/src/state/store.ts`
- Modify: `web/src/api.ts` (append clients)
- Test: `web/src/state/store.test.ts` (append) + `web/src/api.test.ts` (append)

**Interfaces:**
- Consumes: `ReferenceInput` from `@shared/constants`; `/api/citations`, `/api/generate-image`, `/api/logo` (Tasks 1–3).
- Produces:

```ts
// web/src/state/store.ts
export interface ReferenceEntry { key: string; apa: string; verified: boolean; doi?: string }
// state field: references: ReferenceEntry[]  (persist version 2, migrated)
setReferences: (refs: ReferenceEntry[]) => void

// web/src/api.ts
export async function resolveReferences(entries: ReferenceInput[]): Promise<ReferenceEntry[]>
export async function generateImage(settings: Settings, prompt: string): Promise<string | null>
export async function fetchLogo(university: string): Promise<{ base64: string; mime: string } | null>
```

Tasks 7, 10, 12, 15, 16 consume these.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/state/store.test.ts`:

```ts
describe('references entries (v2 persist migration)', () => {
  it('setReferences stores typed entries', () => {
    useAppStore.getState().setReferences([
      { key: 'A, 2020', apa: 'A (2020). Title.', verified: true, doi: '10.1/x' },
      { key: 'B, 2021', apa: 'B (2021). Other.', verified: false },
    ])
    expect(useAppStore.getState().references[0]).toMatchObject({ verified: true, doi: '10.1/x' })
    useAppStore.getState().setReferences([])
  })

  it('reset clears references', () => {
    useAppStore.getState().setReferences([{ key: 'k', apa: 'a', verified: false }])
    useAppStore.getState().reset()
    expect(useAppStore.getState().references).toEqual([])
  })
})
```

Append to `web/src/api.test.ts` (follow that file's existing fetch-mock style; if it stubs `global.fetch`, match it — otherwise):

```ts
import { resolveReferences, generateImage, fetchLogo } from './api'

describe('reference/image/logo clients', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolveReferences posts entries and maps results', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ input: {}, apa: 'A (2020). T.', verified: true, doi: '10.1/x' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', mock)
    const out = await resolveReferences([{ key: 'A, 2020', authors: 'A, B.', year: '2020', title: 'T' }])
    expect(out).toEqual([{ apa: 'A (2020). T.', verified: true, doi: '10.1/x' }])
    const [, init] = mock.mock.calls[0]
    expect(JSON.parse(init.body).entries[0].title).toBe('T')
  })

  it('generateImage returns base64 or null on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ base64: 'aGk=' }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await generateImage({ provider: 'gemini', apiKey: 'k' }, 'a prompt')).toBe('aGk=')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 501 })))
    expect(await generateImage({ provider: 'gemini', apiKey: 'k' }, 'a prompt')).toBeNull()
  })

  it('fetchLogo maps the route payload, null on any failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ logo: { base64: 'Yg==', mime: 'image/png' } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await fetchLogo('Bayero University Kano')).toEqual({ base64: 'Yg==', mime: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await fetchLogo('X')).toBeNull()
  })
})
```

(If `web/src/api.test.ts` already imports `describe/it/expect/vi/afterEach`, reuse them; adjust the import line accordingly.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/state/store.test.ts src/api.test.ts`
Expected: FAIL — `ReferenceEntry[]` mismatch, missing exports.

- [ ] **Step 3: Implement**

In `web/src/state/store.ts`:

1. Add the interface near the other types:

```ts
export interface ReferenceEntry { key: string; apa: string; verified: boolean; doi?: string }
```

2. Change the state field and action types: `references: ReferenceEntry[]` and `setReferences: (refs: ReferenceEntry[]) => void`. Body unchanged (`setReferences: (refs) => set({ references: refs })`, initial `references: []`, reset still clears it).

3. Persist migration (old persisted state has `references: string[]`):

```ts
    {
      name: 'fypgen-state',
      version: 2,
      migrate: (persisted: Record<string, unknown>) => ({
        ...persisted,
        references: Array.isArray(persisted.references)
          ? (persisted.references as unknown[]).map((r) =>
              typeof r === 'string' ? { key: '', apa: r, verified: false } : r)
          : [],
      }),
    }
```

In `web/src/api.ts`, append:

```ts
import type { Settings, ReferenceEntry } from './state/store'
import type { ReferenceInput } from '@shared/constants'

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
```

- [ ] **Step 4: Fix downstream compile errors mechanically**

`web/src/screens/Export.tsx` passes `references` (now `ReferenceEntry[]`) to `buildDocx` — for now, in `docx()`, map it back: `references.map((r) => (typeof r === 'string' ? r : r.apa))` so the old `buildDocx(project, chapters, abstract, string[])` still type-checks. Task 12 replaces this properly. `web/src/export/docx.ts` `referencesSection` unchanged this task. `useChapterGeneration.ts` merges `fixed.references` (strings harvested by guardrails) — change that merge to store them as `{ key: '', apa: r, verified: false }` entries:

```ts
    if (fixed.references.length) {
      const { references, setReferences } = useAppStore.getState()
      const existing = new Set(references.map((r) => r.apa))
      const merged = [...references, ...fixed.references
        .map((r) => r.trim())
        .filter(Boolean)
        .filter((r) => !existing.has(r))
        .map((r) => ({ key: '', apa: r, verified: false }))]
      setReferences(merged)
    }
```

Run: `cd web && npx vitest run` (full web suite) + `cd web && npm run build`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/store.ts web/src/state/store.test.ts web/src/api.ts web/src/api.test.ts web/src/useChapterGeneration.ts web/src/screens/Export.tsx
git commit -m "feat: typed reference entries with persist migration and api clients"
```

---

### Task 7: Reference resolution flow + Review screen badges

**Files:**
- Modify: `web/src/screens/Export.tsx` (`ensureReferences`)
- Modify: `web/src/screens/Review.tsx` (references panel)
- Modify: `web/src/styles.css` (badge styles)
- Test: `web/src/screens/Export.test.tsx` (append) — extend the `../api` mock with `resolveReferences`

**Interfaces:**
- Consumes: `extractCitations` (Task 4), `referencesPrompt`/`parseReferences` (Task 5), `resolveReferences` (Task 6), store `references`.
- Produces: Export behavior — first export resolves references once and caches in the store; a `[VERIFY]` badge surface on Review.

- [ ] **Step 1: Write the failing tests**

In `web/src/screens/Export.test.tsx`, extend the `../api` mock factory:

```ts
vi.mock('../api', () => ({
  generateStream: vi.fn(),
  resolveReferences: vi.fn(),
}))
```

and extend the import: `import { generateStream, resolveReferences } from '../api'`. Append:

```ts
describe('Export screen — reference resolution', () => {
  function seedChapters() {
    useAppStore.getState().setOutline([{
      number: 1, title: 'INTRODUCTION', status: 'done' as const,
      sections: [], text: 'CHAPTER ONE\nSecurity matters (Okonkwo, 2019) on campus.',
    }], 'abstract')
  }

  it('resolves references on DOCX export: AI entries → verified store entries, cached', async () => {
    seedChapters()
    useAppStore.getState().setReferences([])
    ;(generateStream as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify({
      entries: [{ key: 'Okonkwo, 2019', authors: 'Okonkwo, C.', year: '2019', title: 'Campus security', container: 'J' }],
    }))
    ;(resolveReferences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { key: 'Okonkwo, 2019', apa: 'Okonkwo, C. (2019). Campus security. J.', verified: true, doi: '10.1/x' },
    ])
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect((resolveReferences as ReturnType<typeof vi.fn>).mock.calls[0][0][0]).toMatchObject({ key: 'Okonkwo, 2019' })
    expect(useAppStore.getState().references[0]).toMatchObject({ verified: true })
  })

  it('second export reuses cached references — no repeat AI call', async () => {
    seedChapters()
    useAppStore.getState().setReferences([{ key: 'k', apa: 'a', verified: false }])
    ;(generateStream as ReturnType<typeof vi.fn>).mockClear()
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(generateStream).not.toHaveBeenCalled()
    expect(resolveReferences).not.toHaveBeenCalled()
  })

  it('resolution failure shows the error but never blocks a retry', async () => {
    seedChapters()
    useAppStore.getState().setReferences([])
    ;(generateStream as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify({ entries: [{ key: 'k', authors: 'A, B.', year: '2020', title: 'T' }] }))
    ;(resolveReferences as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('crossref down'))
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    expect(await screen.findByText(/crossref down/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/screens/Export.test.tsx`
Expected: FAIL — no resolution behavior yet.

- [ ] **Step 3: Implement**

In `web/src/screens/Export.tsx`:

1. Imports: add `referencesPrompt` to the prompts import; add `resolveReferences, generateImage, fetchLogo` to the api import; add `import { extractCitations } from '../ai/extractCitations'` and `import { parseReferences } from '../ai/parseReferences'`.
2. Add state + function (after `ensureSlideContent`):

```ts
  async function ensureReferences(): Promise<ReferenceEntry[]> {
    const current = useAppStore.getState().references
    const keys = extractCitations(chapters.map((c) => c.text).join('\n'))
    // Cached: we already have entries and no new keys appeared.
    const known = new Set(current.map((r) => r.key))
    if (current.length && keys.every((k) => known.has(k))) return current
    setPhase('Verifying references…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const raw = await generateStream(settings, systemPrompt(track), referencesPrompt(project, keys), () => {})
    const drafts = parseReferences(raw)
    const entries = await resolveReferences(drafts)
    // Keep any previously verified entries not covered this round.
    const merged = [...current.filter((r) => r.verified && !entries.some((e) => e.key === r.key)), ...entries]
    useAppStore.getState().setReferences(merged)
    return merged
  }
```

3. In `docx()`:

```ts
  async function docx() {
    setBusy('docx')
    setError('')
    try {
      let refs = useAppStore.getState().references
      if (!refs.length) refs = await ensureReferences().catch((e) => {
        setError(e instanceof Error ? e.message : 'Reference verification failed')
        return useAppStore.getState().references
      })
      downloadBlob(await buildDocx(project, chapters, abstract, refs.map((r) => r.apa)), `${slug(project.topic)}.docx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }
```

(The map to `apa` strings is temporary — Task 12 switches `buildDocx` to typed entries.)

4. In `pptx()` and `pptxFallback()`, call `await ensureReferences().catch(() => useAppStore.getState().references)` before building (result unused until Task 15/16 wire references slides — this satisfies "first export of either format resolves once").

In `web/src/screens/Review.tsx`, add a references panel before the actions row:

```tsx
import { useAppStore } from '../state/store'

// inside Review(), after the chapters map:
      {references.length > 0 && (
        <section className="chapter" aria-label="References">
          <div className="chapter-head">
            <span className="chapter-title">REFERENCES</span>
            <span className="chapter-meta">{verifiedCount} of {references.length} verified</span>
          </div>
          <ul className="ref-list">
            {references.map((r, i) => (
              <li key={i} className={r.verified ? 'ref-ok' : 'ref-check'}>
                <span className="ref-text">{r.apa}</span>
                <span className={`ref-badge${r.verified ? '' : ' bad'}`}>{r.verified ? 'verified' : 'verify'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
```

with `const references = useAppStore((s) => s.references)` and `const verifiedCount = references.filter((r) => r.verified).length` at the top of the component.

Append to `web/src/styles.css`:

```css
/* ---------- review: references panel ---------- */

.ref-list { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 0.4rem; }

.ref-list li {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem;
  padding-bottom: 0.4rem; border-bottom: 1px solid var(--line);
}

.ref-text { font-size: 0.9rem; }

.ref-badge {
  flex-shrink: 0; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--green-ink); border: 1px solid var(--green); border-radius: 999px; padding: 0.1rem 0.5rem;
}

.ref-badge.bad { color: #b91c1c; border-color: #dc8181; }

.ref-check .ref-text { color: var(--muted); }
```

(If `--green-ink`/`--green`/`--line`/`--muted` differ, use the tokens actually defined in `styles.css`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/screens/Export.test.tsx src/screens/Review.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/Export.tsx web/src/screens/Export.test.tsx web/src/screens/Review.tsx web/src/styles.css
git commit -m "feat: resolve-on-export reference verification with review badges"
```

---

### Task 8: DOCX — ordered lists restart at 1

**Files:**
- Modify: `web/src/export/docx.ts`
- Test: `web/src/export/docx.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change; behavior only — each ordered list gets a distinct numbering reference.

- [ ] **Step 1: Write the failing test**

Append to `web/src/export/docx.test.ts` (reuse the file's existing project/chapters fixtures and its unzip helper — match whatever it is named; the snippet assumes `docxXml(blob)` returning `word/document.xml` and `numberingXml(blob)` returning `word/numbering.xml`; if helpers don't exist, build them with JSZip the same way the file already reads document.xml):

```ts
describe('ordered list numbering', () => {
  it('two ordered lists in different chapters restart at 1 (distinct numIds)', async () => {
    const ch1 = { ...chapters[0], text: 'CHAPTER ONE\n1.1 A\nFirst list:\n\n1. one\n2. two\n3. three\n' }
    const ch2 = { ...chapters[1], text: 'CHAPTER THREE\n3.1 B\nSecond list:\n\n1. alpha\n2. beta\n' }
    const blob = await buildDocx(project, [ch1, ch2], 'abstract text')
    const doc = await docxXml(blob)
    const num = await numberingXml(blob)
    const ids = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1])
    const distinct = new Set(ids)
    expect(distinct.size).toBe(2)          // one numbering instance per list
    expect(num).toMatch(/<w:start w:val="1"\/>/) // each instance starts at 1
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/docx.test.ts`
Expected: FAIL — currently all lists share `numId 1`, so `distinct.size` is 1.

- [ ] **Step 3: Implement**

In `web/src/export/docx.ts`:

1. Change `chapterBlockChildren` to take the numbering reference:

```ts
function chapterBlockChildren(block: Block, chapterNumber: number, figureNo: number, numRef: string): (Paragraph | Table)[] {
```

and in the `list` case:

```ts
          ...(block.ordered
            ? { numbering: { reference: numRef, level: 0 } }
            : { bullet: { level: 0 } }),
```

2. In `buildDocx`'s chapter loop, maintain a counter and build the config list:

```ts
  const bodyChildren: (Paragraph | Table)[] = []
  let listCount = 0
  for (const ch of chapters) {
    if (!ch.text) continue
    let figureNo = 0
    for (const block of parseBlocks(ch.text)) {
      if (block.kind === 'chapter') { /* unchanged */ }
      if (block.kind === 'list' && block.ordered) listCount++
      if (block.kind === 'chart' || block.kind === 'figure') figureNo++
      bodyChildren.push(...chapterBlockChildren(
        block, ch.number, figureNo,
        block.kind === 'list' && block.ordered ? `fyp-ordered-${listCount}` : 'fyp-ordered'
      ))
    }
  }
```

3. Replace the static numbering config with generated instances:

```ts
  const numberingConfig = [
    { reference: 'fyp-ordered', levels: [orderedLevel()] },
    ...Array.from({ length: listCount }, (_, i) => ({
      reference: `fyp-ordered-${i + 1}`, levels: [orderedLevel()],
    })),
  ]
```

with the shared level factory (extract the existing level object):

```ts
function orderedLevel() {
  return {
    level: 0,
    format: LevelFormat.DECIMAL,
    text: '%1.',
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  } as const
}
```

Use `numbering: { config: numberingConfig }` in the Document.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/docx.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add web/src/export/docx.ts web/src/export/docx.test.ts
git commit -m "fix: ordered lists restart numbering per list instead of running through the document"
```

---

### Task 9: DOCX — red bold attention placeholders

**Files:**
- Modify: `web/src/export/markdown.ts` (Run gains `attention`; `parseInline` splits)
- Modify: `web/src/export/docx.ts` (red bold runs; label styling)
- Test: `web/src/export/markdown.test.ts` (append) + `web/src/export/docx.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Run.attention?: boolean` — consumed by `docx.ts` run builders (and Task 15's pptx uses its own attention splitting on plain strings).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/export/markdown.test.ts`:

```ts
import { parseInline } from './markdown' // extend existing import

describe('attention spans', () => {
  it('marks bracketed INSERT/VERIFY/ADD/TODO spans, keeping surrounding text plain', () => {
    const runs = parseInline('As noted (Smith, 2020) see [INSERT VERIFIED CITATION HERE] for details.')
    const att = runs.filter((r) => r.attention)
    expect(att).toHaveLength(1)
    expect(att[0].text).toBe('[INSERT VERIFIED CITATION HERE]')
    expect(runs[0].text).toContain('As noted')
  })

  it('handles multiple placeholders in one paragraph', () => {
    const runs = parseInline('[VERIFY] both [ADD SAMPLE SIZE] please')
    expect(runs.filter((r) => r.attention).map((r) => r.text))
      .toEqual(['[VERIFY]', '[ADD SAMPLE SIZE]'])
  })

  it('leaves ordinary bracketed text untouched', () => {
    expect(parseInline('The result [see figure] was clear.').every((r) => !r.attention)).toBe(true)
  })
})
```

Append to `web/src/export/docx.test.ts`:

```ts
describe('attention styling', () => {
  it('renders placeholders red and bold; the references label too', async () => {
    const ch = { ...chapters[0], text: 'CHAPTER ONE\n1.1 A\nA claim [INSERT VERIFIED CITATION HERE] follows.\n' }
    const blob = await buildDocx(project, [ch], 'abstract', [])
    const doc = await docxXml(blob)
    expect(doc).toContain('[INSERT VERIFIED CITATION HERE]')
    expect(doc).toMatch(/<w:r><w:rPr>(?:(?!
<\/w:r>).)*?<w:b\/>(?:(?!<\/w:r>).)*?C00000.*?\[INSERT VERIFIED CITATION HERE\]/s)
    expect(doc).toMatch(/C00000[^<]*AI-generated references/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/markdown.test.ts src/export/docx.test.ts`
Expected: FAIL — `attention` doesn't exist; no `C00000` in output.

- [ ] **Step 3: Implement**

In `web/src/export/markdown.ts`:

```ts
export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  attention?: boolean
}

/** Bracketed action placeholders the user must not miss. */
const ATTENTION_RE = /\[(?:INSERT[^\]]*?|VERIFY|ADD[^\]]*?|TODO[^\]]*?)\]/gi

function splitAttention(run: Run): Run[] {
  const out: Run[] = []
  let last = 0
  for (const m of run.text.matchAll(ATTENTION_RE)) {
    if (m.index! > last) out.push({ ...run, text: run.text.slice(last, m.index) })
    out.push({ ...run, text: m[0], attention: true })
    last = m.index! + m[0].length
  }
  if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) })
  return out
}
```

At the end of `parseInline`, before returning: `return runs.flatMap(splitAttention).length ? runs.flatMap(splitAttention) : [{ text }]` — implement as:

```ts
  const split = runs.flatMap(splitAttention)
  return split.length ? split : [{ text }]
```

(replacing the current final `return runs.length ? runs : [{ text }]`).

In `web/src/export/docx.ts`:

1. The run builders — every place a `TextRun` is built from a `Run`, add attention handling:

```ts
const toTextRun = (r: Run) =>
  new TextRun({
    text: r.text, bold: r.bold || r.attention, italics: r.italic,
    color: r.attention ? 'C00000' : undefined,
    font: 'Times New Roman', size: 24,
  })
```

Use `toTextRun` in `bodyRuns` and in the list-item children (`parseInline(item).map(toTextRun)`).

2. Placeholder paragraphs — `[INSERT FIGURE HERE]`, the chart fallback `[INSERT CHART HERE — …]`, and the `REFERENCES_LABEL` paragraph get `color: 'C00000'` + `bold: true` in their `body(...)` calls (add a small `attention(text, opts?)` helper that wraps `body` with those two options).

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/markdown.test.ts src/export/docx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/export/markdown.ts web/src/export/markdown.test.ts web/src/export/docx.ts web/src/export/docx.test.ts
git commit -m "feat: red bold attention placeholders in docx"
```

---

### Task 10: DOCX — real figure images via Gemini

**Files:**
- Modify: `web/src/export/docx.ts`
- Modify: `web/src/screens/Export.tsx` (inject the image fn)
- Test: `web/src/export/docx.test.ts` (append)

**Interfaces:**
- Consumes: nothing new internally.
- Produces: `buildDocx(project, chapters, abstract, references, opts?: DocxOptions)` where

```ts
export interface DocxOptions {
  imageFor?: (prompt: string) => Promise<string | null>  // → base64 PNG, null = placeholder
}
```

- [ ] **Step 1: Write the failing test**

Append to `web/src/export/docx.test.ts`:

```ts
describe('figure images', () => {
  it('embeds a generated image for figure blocks when imageFor resolves', async () => {
    const ch = { ...chapters[0], text: 'CHAPTER ONE\n1.1 A\nText before.\n\n```figure\nBlock diagram of the system architecture\n```\n' }
    const blob = await buildDocx(project, [ch], 'abstract', [], {
      imageFor: async () => 'aGVsbG8=',
    })
    const doc = await docxXml(blob)
    expect(doc).toContain('<w:drawing>')
    expect(doc).toContain('Figure 1.1')
  })

  it('keeps the placeholder when imageFor returns null', async () => {
    const ch = { ...chapters[0], text: 'CHAPTER ONE\n1.1 A\n\n```figure\nA flow diagram\n```\n' }
    const blob = await buildDocx(project, [ch], 'abstract', [], { imageFor: async () => null })
    const doc = await docxXml(blob)
    expect(doc).toContain('[INSERT FIGURE HERE]')
    expect(doc).not.toContain('<w:drawing>')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/docx.test.ts`
Expected: FAIL — `buildDocx` takes no options (arity error).

- [ ] **Step 3: Implement**

In `web/src/export/docx.ts`:

```ts
export interface DocxOptions {
  imageFor?: (prompt: string) => Promise<string | null>
}
```

Change the signature:

```ts
export async function buildDocx(
  project: ProjectInfo, chapters: Chapter[], abstract: string,
  references: string[] = [], opts: DocxOptions = {}
): Promise<Blob> {
```

Inside, before composing `bodyChildren`:

```ts
  // Pre-generate figure images in parallel (cap 3) so blocks render with data.
  const figureBlocks: { chapterNumber: number; index: number; prompt: string }[] = []
  for (const ch of chapters) {
    if (!ch.text) continue
    parseBlocks(ch.text).forEach((b, i) => {
      if (b.kind === 'figure') figureBlocks.push({ chapterNumber: ch.number, index: i, prompt: b.description })
    })
  }
  const figureImages = new Map<string, string>()
  if (opts.imageFor) {
    for (let i = 0; i < figureBlocks.length; i += 3) {
      const batch = figureBlocks.slice(i, i + 3)
      const results = await Promise.all(
        batch.map(async (f) => [`${f.chapterNumber}:${f.index}`, await opts.imageFor!(f.prompt)] as const)
      )
      for (const [k, v] of results) if (v) figureImages.set(k, v)
    }
  }
```

Pass `figureImages` (keyed `${chapterNumber}:${blockIndex}`) into the chapter loop and `chapterBlockChildren` — compute the key where blocks are iterated (the loop already has `ch.number` and needs the block's index; use `blocks.indexOf(block)` or convert to an indexed `for` loop). In the `figure` case of `chapterBlockChildren`:

```ts
    case 'figure': {
      const img = figureImages.get(`${chapterNumber}:${blockIndex}`)
      if (img) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: 'png', data: img, transformation: { width: CHART_W, height: CHART_H } })],
          }),
          body(`Figure ${chapterNumber}.${figureNo}: ${block.description}`, { align: AlignmentType.CENTER }),
        ]
      }
      return [
        attention('[INSERT FIGURE HERE]', { align: AlignmentType.CENTER }),
        body(`Figure ${chapterNumber}.${figureNo}: ${block.description}`, { align: AlignmentType.CENTER }),
      ]
    }
```

(Adjust `chapterBlockChildren`'s signature to also receive `blockIndex: number` and `figureImages: Map<string, string>`.)

In `web/src/screens/Export.tsx`, `docx()` passes the option:

```ts
      downloadBlob(
        await buildDocx(project, chapters, abstract, refs.map((r) => r.apa), {
          imageFor: (prompt) => generateImage(settings, prompt),
        }),
        `${slug(project.topic)}.docx`
      )
```

(`generateImage` already imported in Task 7.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/docx.test.ts src/screens/Export.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/export/docx.ts web/src/export/docx.test.ts web/src/screens/Export.tsx
git commit -m "feat: gemini-generated figures in docx with placeholder fallback"
```

---

### Task 11: DOCX — TOC that renders everywhere (page estimator + cached field)

**Files:**
- Create: `web/src/export/tocPages.ts`
- Create: `web/src/export/tocInject.ts`
- Modify: `web/src/export/docx.ts` (demote prelim headings; call injection)
- Test: `web/src/export/tocPages.test.ts` (new) + `web/src/export/docx.test.ts` (append)

**Interfaces:**
- Consumes: `parseBlocks` from `./markdown`; `Chapter` from `../state/store`.
- Produces:

```ts
// web/src/export/tocPages.ts
export interface TocEntry { text: string; level: 1 | 2; page: number }
export function estimateTocEntries(chapters: Chapter[], referencesCount: number): TocEntry[]

// web/src/export/tocInject.ts
export async function injectTocCache(blob: Blob, entries: TocEntry[]): Promise<Blob>
```

`buildDocx` calls `injectTocCache` before returning.

- [ ] **Step 0: Add jszip as a web prod dependency**

Run: `cd web && npm i jszip` (it is currently a dev dependency of the export tests only; the runtime now needs it).

- [ ] **Step 1: Write the failing tests**

Create `web/src/export/tocPages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimateTocEntries } from './tocPages'
import type { Chapter } from '../state/store'

const para = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const ch = (number: number, title: string, sections: [string, string][], body: string): Chapter => ({
  number, title, status: 'done', sections: [], text:
    `CHAPTER ${number}\n` + sections.map(([h, b]) => `${number}.${h} ${h}\n${b}`).join('\n') + body,
})

describe('estimateTocEntries', () => {
  it('lists chapters (level 1), sections (level 2), and REFERENCES with monotonically increasing pages', () => {
    const chapters = [
      ch(1, 'INTRODUCTION', [['1', para(300)], ['2', para(300)]], ''),
      ch(3, 'METHODOLOGY', [['1', para(200)]], ''),
    ]
    const entries = estimateTocEntries(chapters, 3)
    expect(entries.map((e) => e.level)).toEqual([1, 2, 2, 1, 2, 1])
    expect(entries[0].text).toContain('CHAPTER 1')
    expect(entries[5].text).toBe('REFERENCES')
    const pages = entries.map((e) => e.page)
    expect([...pages].sort((a, b) => a - b)).toEqual(pages)
  })

  it('each chapter starts on a fresh page', () => {
    const chapters = [ch(1, 'A', [['1', para(9000)]], ''), ch(2, 'B', [['1', para(50)]], '')]
    const entries = estimateTocEntries(chapters, 0)
    const ch2 = entries.find((e) => e.text.includes('CHAPTER 2'))!
    const ch1Last = Math.max(...entries.filter((e) => e.text.includes('CHAPTER 1') || e.level === 2 && e.page < ch2.page).map((e) => e.page))
    expect(ch2.page).toBeGreaterThanOrEqual(ch1Last)
  })

  it('a 300-word section is under one page; the next section can share its page', () => {
    const chapters = [ch(1, 'A', [['1', para(300)], ['2', para(300)]], '')]
    const entries = estimateTocEntries(chapters, 0)
    expect(entries[1].page).toBe(1)
    expect(entries[2].page).toBe(1)
  })
})
```

Append to `web/src/export/docx.test.ts`:

```ts
describe('table of contents', () => {
  it('emits cached TOC entries inside the live field — renders without a field update', async () => {
    const ch1 = { ...chapters[0], text: 'CHAPTER ONE\n1.1 Background\nSome text here.\n1.2 Objectives\nMore text.\n' }
    const blob = await buildDocx(project, [ch1], 'abstract text')
    const doc = await docxXml(blob)
    expect(doc).toContain('TOC \\o')                 // live field instruction intact
    expect(doc).toContain('CHAPTER ONE')             // cached entry text
    expect(doc).toMatch(/<w:tab\/>.*?<w:t[^>]*>\d+<\/w:t>/s) // dotted-leader + page number run
  })

  it('preliminary headings are not Heading styles — the TOC covers chapters only', async () => {
    const blob = await buildDocx(project, chapters, 'abstract text')
    const doc = await docxXml(blob)
    // ABSTRACT must be a plain bold paragraph, not a pStyle heading
    const abs = doc.indexOf('>ABSTRACT<')
    const before = doc.slice(Math.max(0, abs - 400), abs)
    expect(before).not.toContain('Heading1')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/tocPages.test.ts src/export/docx.test.ts`
Expected: FAIL — modules missing; cached entries absent.

- [ ] **Step 3: Implement**

Create `web/src/export/tocPages.ts`:

```ts
/** Deterministic page estimation for the cached TOC. Word 12pt Times New
 *  Roman, double-spaced, 1" margins: ~27 lines/page ≈ 270 words. Figures and
 *  charts reserve ~3"; tables ~0.5" + rows. Pure code — the AI never decides. */
import type { Chapter } from '../state/store'
import { parseBlocks } from './markdown'

export interface TocEntry { text: string; level: 1 | 2; page: number }

const WORDS_PER_PAGE = 270
const PAGE_INCHES = 9.0 // 11" page − 2" margins
const FIGURE_INCHES = 3.2
const TABLE_BASE_INCHES = 0.5
const TABLE_ROW_INCHES = 0.35

export function estimateTocEntries(chapters: Chapter[], referencesCount: number): TocEntry[] {
  const entries: TocEntry[] = []
  let page = 1
  let usedInches = 0.0

  const consumeWords = (n: number) => {
    usedInches += (n / WORDS_PER_PAGE) * PAGE_INCHES
    while (usedInches >= PAGE_INCHES) { page++; usedInches -= PAGE_INCHES }
  }
  const consumeInches = (n: number) => {
    usedInches += n
    while (usedInches >= PAGE_INCHES) { page++; usedInches -= PAGE_INCHES }
  }

  for (const ch of chapters) {
    if (!ch.text) continue
    // Chapters start on a fresh page (pageBreakBefore).
    page++
    usedInches = 0
    entries.push({ text: `CHAPTER ${ch.number}`, level: 1, page })
    for (const block of parseBlocks(ch.text)) {
      switch (block.kind) {
        case 'section':
          entries.push({ text: block.text, level: 2, page })
          consumeWords(8) // the heading line itself
          break
        case 'para':
        case 'chapter':
          consumeWords((block.kind === 'para' ? block.runs.map((r) => r.text).join('') : block.text)
            .trim().split(/\s+/).filter(Boolean).length)
          break
        case 'list':
          for (const item of block.items) consumeWords(item.split(/\s+/).length)
          break
        case 'table':
          consumeInches(TABLE_BASE_INCHES + block.rows.length * TABLE_ROW_INCHES)
          break
        case 'chart':
        case 'figure':
          consumeInches(FIGURE_INCHES)
          break
      }
    }
  }
  if (referencesCount >= 0) {
    page++
    entries.push({ text: 'REFERENCES', level: 1, page })
  }
  return entries
}
```

Create `web/src/export/tocInject.ts`:

```ts
/** Post-processes the packed DOCX: injects cached result paragraphs into the
 *  TOC field (between its separate and end markers), the way Word caches a
 *  TOC. Viewers that never update fields (LibreOffice, Google Docs, previews)
 *  then show a real TOC; Word still refreshes to exact numbers on open. */
import JSZip from 'jszip'
import type { TocEntry } from './tocPages'

// jsdom's Blob lacks arrayBuffer(); read bytes through FileReader there.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(blob)
  })
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function tocParagraphXml(e: TocEntry): string {
  return (
    `<w:p><w:pPr>` +
    (e.level === 2 ? `<w:ind w:left="240"/>` : '') +
    `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs>` +
    `<w:spacing w:line="360" w:lineRule="auto"/>` +
    `</w:pPr>` +
    `<w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r>` +
    `<w:r><w:tab/></w:r>` +
    `<w:r><w:t>${e.page}</w:t></w:r>` +
    `</w:p>`
  )
}

export async function injectTocCache(blob: Blob, entries: TocEntry[]): Promise<Blob> {
  if (!entries.length) return blob
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
  const file = zip.file('word/document.xml')
  if (!file) return blob
  const doc = await file.async('string')
  const injected = entries.map(tocParagraphXml).join('')
  const patched = doc.replace(
    /(<w:fldChar w:fldCharType="separate"[^/]*\/>)([\s\S]*?)(<w:fldChar w:fldCharType="end"\/>)/,
    `$1${injected}$2$3`
  )
  if (patched === doc) return blob // no TOC field found — leave untouched
  zip.file('word/document.xml', patched)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
```

In `web/src/export/docx.ts`:

1. Demote preliminary headings so the live TOC field covers only chapters + REFERENCES: in the prelim composition, change the `heading: HeadingLevel.HEADING_1` option to nothing for the university name, `ABSTRACT`, and `TABLE OF CONTENTS` paragraphs (keep `bold: true`, `align: CENTER`, `pageBreakBefore`).
2. In `buildDocx`, right before `return Packer.toBlob(doc)`:

```ts
  const blob = await Packer.toBlob(doc)
  const referencesCount = references.filter(Boolean).length
  return injectTocCache(blob, estimateTocEntries(chapters, referencesCount))
```

(Import both from the new modules.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/tocPages.test.ts src/export/docx.test.ts`
Expected: PASS. If the `separate`/`end` regex does not match docx's serialization, dump the XML around `TOC \o` (`console.log(doc.slice(idx - 200, idx + 600))` in a scratch run) and adjust the pattern — the markers are stable in OOXML, only their attributes vary.

- [ ] **Step 5: Commit**

```bash
git add web/src/export/tocPages.ts web/src/export/tocPages.test.ts web/src/export/tocInject.ts web/src/export/docx.ts web/src/export/docx.test.ts web/package.json web/package-lock.json
git commit -m "fix: cached TOC entries with estimated pages render in every viewer"
```

---

### Task 12: DOCX — references from typed entries

**Files:**
- Modify: `web/src/export/docx.ts` (`referencesSection` + signature)
- Modify: `web/src/screens/Export.tsx` (pass typed entries)
- Test: `web/src/export/docx.test.ts` (append + adjust existing references tests)

**Interfaces:**
- Consumes: `ReferenceEntry` from `../state/store` (Task 6).
- Produces: `buildDocx(project, chapters, abstract, references: ReferenceEntry[], opts?: DocxOptions)` — final signature. `referencesSection(chapters, references: ReferenceEntry[]): string` becomes an entry formatter (kept exported for tests).

- [ ] **Step 1: Write the failing test**

Append to `web/src/export/docx.test.ts` (and update any existing `referencesSection` tests to the new shape):

```ts
describe('references section from typed entries', () => {
  it('renders APA entries alphabetized with a red [VERIFY] prefix on unverified ones', async () => {
    const refs = [
      { key: 'b', apa: 'Beta, B. (2021). Second.', verified: true },
      { key: 'a', apa: 'Alpha, A. (2020). First.', verified: false },
    ]
    const blob = await buildDocx(project, chapters, 'abstract', refs)
    const doc = await docxXml(blob)
    const aIdx = doc.indexOf('Alpha, A. (2020). First.')
    const bIdx = doc.indexOf('Beta, B. (2021). Second.')
    expect(aIdx).toBeGreaterThan(-1)
    expect(bIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(bIdx) // alphabetized
    expect(doc).toContain('[VERIFY] Alpha, A. (2020). First.')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/docx.test.ts`
Expected: FAIL — signature still `string[]`.

- [ ] **Step 3: Implement**

In `web/src/export/docx.ts`:

```ts
import type { Chapter, ProjectInfo, ReferenceEntry } from '../state/store'

export function referencesSection(_chapters: Chapter[] = [], references: ReferenceEntry[] = []): string {
  void _chapters
  const unique = new Map<string, ReferenceEntry>()
  for (const r of references) if (r.apa.trim()) unique.set(r.apa.trim(), r)
  const sorted = [...unique.values()].sort((a, b) => a.apa.localeCompare(b.apa))
  const body = sorted.length
    ? sorted.map((r) => `${r.verified ? '' : '[VERIFY] '}${r.apa}`).join('\n\n')
    : 'No references were collected. Add your references here in APA 7 format.'
  return `${body}\n\n${REFERENCES_LABEL}`
}
```

Change `buildDocx`'s `references` parameter type to `ReferenceEntry[]` (default `[]`). In the REFERENCES rendering loop, use the attention styling: split each formatted line into `[VERIFY]` (red bold run) + the rest, e.g.:

```ts
  for (const line of referencesSection(chapters, references).split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('[VERIFY] ')) {
      bodyChildren.push(new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 480 },
        children: [
          new TextRun({ text: '[VERIFY] ', bold: true, color: 'C00000', font: 'Times New Roman', size: 24 }),
          new TextRun({ text: t.slice('[VERIFY] '.length), font: 'Times New Roman', size: 24 }),
        ],
      }))
    } else {
      bodyChildren.push(body(t, { align: AlignmentType.LEFT }))
    }
  }
```

In `web/src/screens/Export.tsx`, `docx()` drops the `.map((r) => r.apa)` — pass `refs` directly. Update the Export screen test's `buildDocx` mock to resolve a Blob regardless (it already does).

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/docx.test.ts src/screens/Export.test.tsx && npm run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/export/docx.ts web/src/export/docx.test.ts web/src/screens/Export.tsx
git commit -m "feat: docx references render verified typed entries with verify flags"
```

---

### Task 13: Themes re-tokened for the example layout

**Files:**
- Modify: `web/src/export/themes.ts` (full rewrite)
- Modify: `web/src/state/store.ts` (default `'forest'`)
- Test: `web/src/state/store.test.ts` (adjust default expectation) — themes have no dedicated test file; assertions land in Task 15's deck tests

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type ThemeId = 'forest' | 'navy' | 'night' | 'slate'
export interface SlideTheme {
  tc: string        // content title + body text (dark theme color)
  acc: string       // accent: lead-in labels, thick footer strip
  accLight: string  // thin footer strip
  muted: string     // secondary text (title slide department/session)
  att: string       // attention red for [VERIFY]
}
export const THEMES: Record<ThemeId, SlideTheme>
export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[]
```

The `forest` colors are the example deck's verbatim: `2F3D32 / 548C2F / 9CC85D / 637369 / C00000`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/state/store.test.ts`:

```ts
describe('slideTheme default', () => {
  it('defaults to forest (the example deck green)', () => {
    expect(useAppStore.getState().slideTheme).toBe('forest')
  })
})
```

(Update the older `defaults to navy` assertion — merged into this one.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/state/store.test.ts`
Expected: FAIL — default is still `'navy'`.

- [ ] **Step 3: Implement**

Replace `web/src/export/themes.ts`:

```ts
/** Slide themes as plain data — no pptxgenjs import here so the store can
 *  reference ThemeId cheaply. Token structure and the forest colors are taken
 *  verbatim from the reference deck (docs/test run/…Defense_Slides.pptx). */

export type ThemeId = 'forest' | 'navy' | 'night' | 'slate'

export interface SlideTheme {
  tc: string        // content slide title + body text
  acc: string       // accent: lead-in labels, thick footer strip
  accLight: string  // thin footer strip
  muted: string     // secondary text on the title slide
  att: string       // attention red ([VERIFY] on references slides)
}

export const THEMES: Record<ThemeId, SlideTheme> = {
  forest: { tc: '2F3D32', acc: '548C2F', accLight: '9CC85D', muted: '637369', att: 'C00000' },
  navy:   { tc: '0A2342', acc: '1F6F8B', accLight: '9CC3D5', muted: '5A6B7F', att: 'C00000' },
  night:  { tc: '1a1a2e', acc: 'e94560', accLight: 'F2A0B0', muted: '637369', att: 'C00000' },
  slate:  { tc: '1e293b', acc: '0E7490', accLight: '9DD3E0', muted: '64748B', att: 'C00000' },
}

export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[] = [
  { id: 'forest', name: 'Forest Green', preview: { primary: '#2F3D32', accent: '#548C2F' } },
  { id: 'navy',   name: 'Deep Navy',    preview: { primary: '#0A2342', accent: '#1F6F8B' } },
  { id: 'night',  name: 'Midnight Red', preview: { primary: '#1a1a2e', accent: '#e94560' } },
  { id: 'slate',  name: 'Slate & Teal', preview: { primary: '#1e293b', accent: '#0E7490' } },
]
```

In `web/src/state/store.ts`: change `slideTheme: 'navy'` to `slideTheme: 'forest'`. (Persisted users who chose a theme keep it; those on the old default `'navy'` also keep navy — acceptable.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/state/store.test.ts && npm run build`
Expected: PASS — note any compile errors from old token names (`sbg`, `acc`, `stxt`, …) in `pptx.ts`; they are expected and are rewritten in Task 15. If `npm run build` fails on `pptx.ts`, that is fine *this task* only if tests pass — otherwise park the default flip and fold it into Task 15's commit. Prefer: run the web suite; if `pptx.test.ts` fails on colors, leave it failing until Task 15 (documented).

- [ ] **Step 5: Commit**

```bash
git add web/src/export/themes.ts web/src/state/store.ts web/src/state/store.test.ts
git commit -m "feat: example-deck theme tokens with forest green default"
```

---

### Task 14: Slide content v2 — schema, prompt, parsers

**Files:**
- Modify: `web/src/ai/parseSlides.ts` (full rewrite — new schema)
- Modify: `web/src/prompts.ts` (`slidesPrompt` rewrite; `condenseChapters` unchanged)
- Modify: `web/src/export/pptx.ts` (`slideContentFromChapters` rewrite — only this function this task)
- Test: `web/src/ai/parseSlides.test.ts` (rewrite), `web/src/prompts.test.ts` (adjust slidesPrompt block)

**Interfaces:**
- Consumes: `condenseChapters` (prompts.ts, unchanged).
- Produces:

```ts
// web/src/ai/parseSlides.ts
export type SlideKey =
  'intro' | 'problem' | 'objectives' | 'scope' | 'significance' | 'literature'
  | 'methodology' | 'sysdesign' | 'implementation' | 'results' | 'discussion'
  | 'conclusion'

export interface SlideContent {
  aim: string
  bullets: Record<SlideKey, string[]>
  notes: Partial<Record<SlideKey, string>>
  images: { slide: SlideKey; prompt: string }[]
}
export const EMPTY_SLIDE_CONTENT: SlideContent
export function parseSlides(raw: string): SlideContent   // throws 'Model did not return valid JSON'

// web/src/export/pptx.ts (kept export, new mapping)
export function slideContentFromChapters(chapters: Chapter[]): SlideContent
```

- [ ] **Step 1: Write the failing tests**

Replace `web/src/ai/parseSlides.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSlides, EMPTY_SLIDE_CONTENT } from './parseSlides'

const full = JSON.stringify({
  aim: 'To design a compact MIMO antenna for 5G.',
  bullets: {
    intro: ['5G uses sub-6 GHz spectrum', 'MIMO improves capacity'],
    problem: ['Compactness degrades isolation'],
    objectives: ['Target isolation ≥ 15 dB', 'Keep the form compact'],
    scope: ['Sub-6 GHz band only'],
    significance: ['Reference for local engineers'],
    literature: ['MIMO exploits multipath'],
    methodology: ['Simulation in CST', 'Parametric optimisation', 'Fabrication', 'Measurement'],
    sysdesign: ['Rectangular patch with inset feed'],
    implementation: ['FR-4 substrate', 'Digital calliper verification'],
    results: ['Isolation achieved across the band'],
    discussion: ['DGS improved isolation'],
    conclusion: ['The design meets its targets'],
  },
  notes: { intro: 'Good morning. This work addresses…', methodology: 'We followed a four-step cycle…' },
  images: [{ slide: 'sysdesign', prompt: 'Technical diagram of a two-element MIMO patch antenna, top view, minimal style' }],
})

describe('parseSlides v2', () => {
  it('parses the full shape', () => {
    const r = parseSlides(full)
    expect(r.aim).toContain('MIMO antenna')
    expect(r.bullets.intro).toHaveLength(2)
    expect(r.bullets.methodology).toHaveLength(4)
    expect(r.notes.intro).toContain('Good morning')
    expect(r.images[0].slide).toBe('sysdesign')
  })

  it('extracts JSON from a fenced block with prose around it', () => {
    const r = parseSlides(`Here:\n\`\`\`json\n${full}\n\`\`\`\nThanks`)
    expect(r.bullets.problem).toHaveLength(1)
  })

  it('defaults missing sections, notes, and images; caps images at 3', () => {
    const r = parseSlides(JSON.stringify({ aim: 'One aim.', bullets: { intro: ['x'] }, images: [
      { slide: 'intro', prompt: 'a' }, { slide: 'scope', prompt: 'b' }, { slide: 'results', prompt: 'c' }, { slide: 'lit', prompt: 'd' },
    ] }))
    expect(r.aim).toBe('One aim.')
    expect(r.bullets.scope).toEqual([])
    expect(r.notes).toEqual({})
    expect(r.images).toHaveLength(3)
  })

  it('ignores junk inside arrays and unknown slide keys', () => {
    const r = parseSlides(JSON.stringify({ aim: '', bullets: { intro: ['ok', 5, '  '] }, images: [{ slide: 'nonsense', prompt: 'x' }] }))
    expect(r.bullets.intro).toEqual(['ok'])
    expect(r.images).toEqual([])
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseSlides('No JSON here.')).toThrow('Model did not return valid JSON')
  })
})
```

Adjust the `slidesPrompt` describe block in `web/src/prompts.test.ts` to the new contract:

```ts
describe('slidesPrompt v2', () => {
  const project = {
    ...EMPTY_PROJECT,
    topic: 'AI-based news bias detection', studentName: 'Francis Eboh John',
    matric: 'ENG/24/MCT/0029', university: 'Bayero University Kano',
    department: 'MECHATRONICS', supervisor: 'John Syzn', degree: 'B.Eng', session: '2026',
  }
  const chapters = [{
    number: 1, title: 'INTRODUCTION', status: 'done' as const,
    sections: [{ heading: 'Background of the Study', description: 'why it matters' }],
    text: `CHAPTER ONE\n1.1 Background of the Study\n${Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')}`,
  }]

  it('carries project fields, condensed chapters, and the v2 JSON contract', () => {
    const p = slidesPrompt(project, chapters)
    expect(p).toContain('AI-based news bias detection')
    expect(p).toContain('word199')
    expect(p).not.toContain('word350')
    expect(p).toContain('"aim"')
    expect(p).toContain('"bullets"')
    expect(p).toContain('"notes"')
    expect(p).toContain('"images"')
    expect(p).toContain('speaker notes')
    expect(p).toContain('do not invent')
    expect(p).toContain('Max 12 words per bullet')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/ai/parseSlides.test.ts src/prompts.test.ts`
Expected: FAIL — schema mismatch.

- [ ] **Step 3: Implement**

Replace `web/src/ai/parseSlides.ts`:

```ts
/** Slide-content v2 contract — the example deck's structure. Bullets per
 *  section, one aim, per-slide speaker notes, and up to three image prompts.
 *  Mirrors the JSON demanded by slidesPrompt (prompts.ts). */

export type SlideKey =
  | 'intro' | 'problem' | 'objectives' | 'scope' | 'significance' | 'literature'
  | 'methodology' | 'sysdesign' | 'implementation' | 'results' | 'discussion'
  | 'conclusion'

export const SLIDE_KEYS: SlideKey[] = [
  'intro', 'problem', 'objectives', 'scope', 'significance', 'literature',
  'methodology', 'sysdesign', 'implementation', 'results', 'discussion', 'conclusion',
]

export interface SlideContent {
  aim: string
  bullets: Record<SlideKey, string[]>
  notes: Partial<Record<SlideKey, string>>
  images: { slide: SlideKey; prompt: string }[]
}

export const EMPTY_SLIDE_CONTENT: SlideContent = {
  aim: '',
  bullets: Object.fromEntries(SLIDE_KEYS.map((k) => [k, []])) as Record<SlideKey, string[]>,
  notes: {},
  images: [],
}

const BULLET_CAP = 6 // per section — more spills to (continued) slides anyway

function strs(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

export function parseSlides(raw: string): SlideContent {
  const candidates: string[] = []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) candidates.push(fenced[1])
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1))
  candidates.push(raw)

  for (const candidate of candidates) {
    let parsed: unknown
    try { parsed = JSON.parse(candidate.trim()) } catch { continue }
    if (typeof parsed !== 'object' || parsed === null) continue
    const p = parsed as Record<string, unknown>

    const bullets = Object.fromEntries(
      SLIDE_KEYS.map((k) => [k, strs((p.bullets as Record<string, unknown> | undefined)?.[k]).slice(0, BULLET_CAP)])
    ) as Record<SlideKey, string[]>

    const notes: Partial<Record<SlideKey, string>> = {}
    if (p.notes && typeof p.notes === 'object') {
      for (const k of SLIDE_KEYS) {
        const v = (p.notes as Record<string, unknown>)[k]
        if (typeof v === 'string' && v.trim()) notes[k] = v.trim()
      }
    }

    const images = (Array.isArray(p.images) ? p.images : [])
      .filter((i): i is { slide: SlideKey; prompt: string } =>
        !!i && typeof i === 'object' && typeof (i as Record<string, unknown>).prompt === 'string'
        && SLIDE_KEYS.includes((i as Record<string, unknown>).slide as SlideKey))
      .slice(0, 3)
      .map((i) => ({ slide: i.slide, prompt: i.prompt.trim() }))

    const aim = typeof p.aim === 'string' ? p.aim.trim() : ''
    const hasAnything = aim !== '' || SLIDE_KEYS.some((k) => bullets[k].length > 0)
    if (hasAnything) return { aim, bullets, notes, images }
  }
  throw new Error('Model did not return valid JSON')
}
```

Rewrite `slidesPrompt` in `web/src/prompts.ts` (keep `condenseChapters` exactly as is):

```ts
export function slidesPrompt(project: ProjectInfo, chapters: Chapter[]): string {
  return `Structure the defense slide content for this final year project.

Topic: ${project.topic}
Student: ${project.studentName} (${project.matric})
University: ${project.university} — Department of ${project.department}
Degree: ${project.degree} | Supervisor: ${project.supervisor} | Session: ${project.session}

CHAPTER CONTENT (condensed):
${condenseChapters(chapters)}

Rules:
- Max 12 words per bullet. Academic Nigerian university tone.
- Use ONLY content present in the chapters — do not invent results, metrics, or citations.
- Every bullet must stand alone when read aloud at a defense.
- "notes" holds the speaker notes: 60–100 words of spoken script per section, first person.
- "images": at most 3, only for sysdesign / methodology / results, each a one-sentence description of a clean technical illustration (no text in the image).

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape (all bullet arrays required, may be empty):

\`\`\`json
{
  "aim": "To design/develop/implement… (one concise sentence)",
  "bullets": {
    "intro": ["…"], "problem": ["…"], "objectives": ["…"], "scope": ["…"],
    "significance": ["…"], "literature": ["…"], "methodology": ["…"],
    "sysdesign": ["…"], "implementation": ["…"], "results": ["…"],
    "discussion": ["…"], "conclusion": ["…"]
  },
  "notes": { "intro": "…", "methodology": "…" },
  "images": [{ "slide": "sysdesign", "prompt": "…" }]
}
\`\`\``
}
```

Rewrite `slideContentFromChapters` in `web/src/export/pptx.ts` (the deterministic fallback):

```ts
export function slideContentFromChapters(chapters: Chapter[]): SlideContent {
  const headings = (n: number, needles: string[]): string[] => {
    const ch = chapters.find((c) => c.number === n)
    if (!ch) return []
    return ch.sections
      .filter((s) => needles.length === 0 || needles.some((p) => s.heading.toLowerCase().includes(p)))
      .map((s) => s.heading)
  }
  const objectives = headings(1, ['objective'])
  return {
    aim: objectives[0] ?? '',
    bullets: {
      intro: headings(1, ['background', 'introduction']),
      problem: headings(1, ['problem']),
      objectives: objectives.slice(1),
      scope: headings(1, ['scope']),
      significance: headings(1, ['significance']),
      literature: headings(2, []).slice(0, 6),
      methodology: headings(3, []).slice(0, 6),
      sysdesign: headings(3, ['design', 'architecture', 'system']),
      implementation: headings(3, ['implement', 'tool']),
      results: headings(4, ['finding', 'result']),
      discussion: headings(4, ['discussion']),
      conclusion: headings(5, ['conclusion', 'summary']),
    },
    notes: {},
    images: [],
  }
}
```

(Import the new types; keep `parseQaSlides` and `buildPptx` compiling by rewriting `buildPptx`'s body minimally — it is fully replaced in Task 15, so this task may leave `pptx.test.ts` failing if the old assertions break; the commit message notes that Task 15 restores it. Prefer instead: implement Task 14 and Task 15 back-to-back before running the pptx suite, committing Task 14 first with only the parser/prompt tests green.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/ai/parseSlides.test.ts src/prompts.test.ts src/screens/Export.test.tsx`
Expected: parser/prompt PASS. Export screen tests that touch buildPptx may need the Task 16 mock updates — if they fail here, fold those mock edits in (they are mechanical: `slideContentFromChapters` mock now returns the v2 shape).

- [ ] **Step 5: Commit**

```bash
git add web/src/ai/parseSlides.ts web/src/ai/parseSlides.test.ts web/src/prompts.ts web/src/prompts.test.ts web/src/export/pptx.ts
git commit -m "feat: slide content v2 — per-section bullets, notes, image prompts"
```

---

### Task 15: Deck builder rebuild — the example's methodology

**Files:**
- Modify: `web/src/export/pptx.ts` (full rewrite of everything except `parseQaSlides` and `slideContentFromChapters` from Task 14)
- Test: `web/src/export/pptx.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `SlideContent`/`SlideKey` (Task 14), `THEMES`/`SlideTheme`/`ThemeId` (Task 13), `ReferenceEntry` (Task 6), `Chapter`/`ProjectInfo`.
- Produces:

```ts
export async function buildPptx(
  project: ProjectInfo, chapters: Chapter[], defenseQa: string,
  content: SlideContent, references: ReferenceEntry[], themeId: ThemeId,
  opts: { logo?: { base64: string; mime: string } | null; images?: Partial<Record<SlideKey, string>> } = {}
): Promise<Blob>
```

- [ ] **Step 1: Write the failing test**

Replace `web/src/export/pptx.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptx, slideContentFromChapters, parseQaSlides } from './pptx'
import type { SlideContent } from '../ai/parseSlides'
import type { ReferenceEntry } from '../state/store'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const, sections: [], text: 'CHAPTER ONE\n1.1 Background\nCampus theft is common.' },
  { number: 3, title: 'METHODOLOGY', status: 'done' as const, sections: [], text: 'CHAPTER THREE\nBuilt a system.' },
]
const defenseQa = 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'
const references: ReferenceEntry[] = [
  { key: 'a', apa: 'Musa, A. (2024). Sensors on campus. Journal of Things, 4(2), 10-20.', verified: true },
  { key: 'b', apa: 'Ola, D. (2023). Cheaper hardware. Hardware Letters, 2(1), 5-9.', verified: false },
]
const content: SlideContent = {
  aim: 'To build an IoT theft detection system for campus laboratories.',
  bullets: {
    intro: ['Campus theft is common', 'Labs lose equipment yearly', 'Watchmen are unreliable'],
    problem: ['Manual watchmen are unreliable', 'Alarms are expensive'],
    objectives: ['Sense motion reliably', 'Raise alerts in real time'],
    scope: ['Two campus laboratories'],
    significance: ['Protects university assets'],
    literature: ['IoT sensing is mature'],
    methodology: ['Simulated the sensor mesh', 'Built an ESP32 prototype', 'Ran six weeks of drills', 'Measured detection latency'],
    sysdesign: ['PIR sensors on door frames', 'ESP32 gateway per lab'],
    implementation: ['Firmware in C', 'Dashboard in React'],
    results: ['98% detection rate', 'No false alarms at night'],
    discussion: ['Cheaper than hiring guards'],
    conclusion: ['The system works reliably'],
  },
  notes: { intro: 'Good morning, esteemed panel. This project addresses theft in campus laboratories.' },
  images: [{ slide: 'sysdesign', prompt: 'Diagram of PIR sensors wired to an ESP32 gateway' }],
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(blob)
  })
}

async function slidesOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
  return { zip, names, xml: (i: number) => zip.file(`ppt/slides/slide${i}.xml`)!.async('string') }
}

describe('buildPptx v2', () => {
  it('builds the core structure: title, 12 content slides, references, thank-you, Q&A appendix', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, references, 'forest'))
    // 1 title + 12 content + 1 references + 1 thank-you + 2 Q&A appendix
    expect(names).toHaveLength(17)
    expect(await xml(1)).toContain('BAYERO UNIVERSITY KANO')
    expect(await xml(2)).toContain('Introduction / Background')
    expect(await xml(8)).toContain('Methodology')
    expect(await xml(14)).toContain('References')
    expect(await xml(14)).toContain('Musa, A. (2024)')
    expect(await xml(15)).toContain('Thank You')
    expect(await xml(16)).toContain('Why this topic?')
  })

  it('applies the example theme: footer strips, dark-green titles, Arial', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))
    const s2 = await xml(2)
    expect(s2).toContain('2F3D32')   // title text color
    expect(s2).toContain('548C2F')   // thick strip
    expect(s2).toContain('9CC85D')   // thin strip
    expect(s2).toContain('typeface="Arial"')
  })

  it('auto-splits overflowing sections into (continued) slides — nothing exceeds the line budget', async () => {
    const long: SlideContent = {
      ...content,
      bullets: { ...content.bullets, methodology: Array.from({ length: 30 }, (_, i) => `Step ${i + 1} of the build process done well`) },
    }
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, '', long, references, 'forest'))
    const titles = await Promise.all(names.map((_, i) => xml(i + 1)))
    const methodSlides = titles.filter((t) => t.includes('Methodology'))
    expect(methodSlides.length).toBeGreaterThanOrEqual(3)
    expect(titles.some((t) => t.includes('Methodology (continued)'))).toBe(true)
  })

  it('numbers pages truthfully including continued and references slides', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, references, 'forest'))
    expect(names).toHaveLength(17)
    expect(await xml(2)).toContain('2/17')
    expect(await xml(14)).toContain('14/17')
  })

  it('attaches speaker notes when provided', async () => {
    const zip = await (await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))).zip
    expect(Object.keys(zip.files).some((n) => /notesSlide\d+\.xml/.test(n))).toBe(true)
    const notes1 = await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string')
    expect(notes1).toContain('Good morning, esteemed panel')
  })

  it('renders the aim with a green lead-in label and [VERIFY] red on references slides', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest'))
    const aim = await xml(4) // Aim and Objectives
    expect(aim).toContain('Aim and Objectives')
    expect(aim).toContain('Aim:')
    const refs = await xml(14)
    expect(refs).toContain('[VERIFY]')
    expect(refs).toContain('C00000')
  })

  it('embeds the logo on the title slide and section images beside their bullets', async () => {
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const { xml, zip } = await slidesOf(await buildPptx(project, chapters, '', content, references, 'forest', {
      logo: { base64: png1x1, mime: 'image/png' },
      images: { sysdesign: png1x1 },
    }))
    expect(await xml(1)).toContain('<p:pic>')
    expect(await xml(9)).toContain('<p:pic>') // System Design slide
    expect(Object.keys(zip.files).some((n) => n.startsWith('ppt/media/'))).toBe(true)
  })

  it('skips sections with no bullets and works without logo/images', async () => {
    const thin: SlideContent = { aim: 'One aim.', bullets: { ...content.bullets, scope: [], significance: [], literature: [] }, notes: {}, images: [] }
    const { names } = await slidesOf(await buildPptx(project, chapters, '', thin, [], 'forest'))
    expect(names).toHaveLength(12) // title + 9 content + references (empty placeholder) + thank-you
  })
})

describe('slideContentFromChapters v2', () => {
  it('maps chapter sections mechanically into the v2 shape', () => {
    const c = slideContentFromChapters([
      { number: 1, title: 'INTRODUCTION', status: 'done' as const, sections: [
        { heading: 'Background of the Study', description: '' },
        { heading: 'Objectives of the Study', description: '' },
      ], text: '' },
      { number: 3, title: 'METHODOLOGY', status: 'done' as const, sections: [
        { heading: 'Research Design', description: '' },
      ], text: '' },
    ])
    expect(c.bullets.intro).toEqual(['Background of the Study'])
    expect(c.aim).toBe('Objectives of the Study')
    expect(c.bullets.methodology).toEqual(['Research Design'])
  })
})

describe('parseQaSlides (unchanged)', () => {
  it('still yields one slide per chapter block', () => {
    expect(parseQaSlides(defenseQa)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/export/pptx.test.ts`
Expected: FAIL — old builder (old signature, old layout).

- [ ] **Step 3: Implement**

Replace everything above `parseQaSlides` in `web/src/export/pptx.ts` with (keep `parseQaSlides` and Task 14's `slideContentFromChapters` verbatim):

```ts
import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo, ReferenceEntry } from '../state/store'
import type { SlideContent, SlideKey } from '../ai/parseSlides'
import { THEMES, type SlideTheme, type ThemeId } from './themes'

const SECTION_TITLES: Record<SlideKey, string> = {
  intro: 'Introduction / Background',
  problem: 'Problem Statement',
  objectives: 'Aim and Objectives',
  scope: 'Scope of the Study',
  significance: 'Significance of the Study',
  literature: 'Literature Review',
  methodology: 'Methodology',
  sysdesign: 'System Design / Architecture',
  implementation: 'Implementation / Tools & Technologies',
  results: 'Results / Findings',
  discussion: 'Discussion of Results',
  conclusion: 'Conclusion & Recommendations',
}

// ---- no-bleed budget: 24pt Arial across ~11.7" ≈ 88 chars/line, ~12 lines ----
const CHARS_PER_LINE = 88
const MAX_LINES = 12

/** Splits bullets into page-sized groups. Pure, deterministic. */
export function splitBullets(items: string[]): string[][] {
  const pages: string[][] = []
  let current: string[] = []
  let lines = 0
  for (const item of items) {
    const itemLines = Math.max(1, Math.ceil(item.length / CHARS_PER_LINE))
    if (current.length && lines + itemLines > MAX_LINES) {
      pages.push(current)
      current = []
      lines = 0
    }
    current.push(item)
    lines += itemLines
  }
  if (current.length) pages.push(current)
  return pages
}

export async function buildPptx(
  project: ProjectInfo,
  _chapters: Chapter[],
  defenseQa: string,
  content: SlideContent,
  references: ReferenceEntry[],
  themeId: ThemeId,
  opts: { logo?: { base64: string; mime: string } | null; images?: Partial<Record<SlideKey, string>> } = {}
): Promise<Blob> {
  const T: SlideTheme = THEMES[themeId]
  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'FYP', width: 13.333, height: 7.5 })
  pptx.layout = 'FYP'

  const W = 13.333, H = 7.5, M = 0.7
  const FONT = 'Arial'

  // Count slides first for truthful footers: title, content (+ continued),
  // references (+ continued), thank-you, Q&A appendix.
  const sections = (Object.keys(SECTION_TITLES) as SlideKey[]).filter((k) => content.bullets[k].length > 0)
  const contentPageCount = sections.reduce((n, k) => n + splitBullets(content.bullets[k]).length, 0)
  const refPages = Math.max(1, Math.ceil(references.length / 5))
  const qaSlides = parseQaSlides(defenseQa)
  const total = 1 + contentPageCount + refPages + 1 + qaSlides.length
  let n = 0

  const footer = (s: ReturnType<pptxgen['addSlide']>) => {
    n += 1
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.36, w: W, h: 0.04, fill: { color: T.accLight }, line: { type: 'none' } })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.32, w: W, h: 0.32, fill: { color: T.acc }, line: { type: 'none' } })
    s.addText(`${n}/${total}`, { x: W - 1.0, y: H - 0.33, w: 0.8, h: 0.3, fontSize: 10, color: 'FFFFFF', align: 'right', fontFace: FONT, isTextBox: true, margin: 0 })
  }

  const contentSlide = (title: string, items: string[], key?: SlideKey) => {
    const s = pptx.addSlide()
    const image = key ? opts.images?.[key] : undefined
    s.background = { color: 'FFFFFF' }
    s.addText(title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const bodyW = image ? 7.2 : W - M * 2
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), {
      x: 0.8, y: 1.9, w: bodyW, h: 5.0, fontSize: 24, color: T.tc, fontFace: FONT,
      isTextBox: true, valign: 'top', margin: 0, lineSpacingMultiple: 1.15,
    })
    if (image) {
      s.addImage({ data: `data:image/png;base64,${image}`, x: 8.3, y: 1.9, w: 4.3, h: 3.2 })
    }
    if (key && content.notes[key]) s.addNotes(content.notes[key]!)
    footer(s)
    return s
  }

  // ── 1: Title ────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    n += 1
    s.background = { color: 'FFFFFF' }
    if (opts.logo) {
      s.addImage({ data: `data:${opts.logo.mime};base64,${opts.logo.base64}`, x: 0.8, y: 0.65, w: 1.0, h: 1.0 })
    }
    s.addText(project.university.toUpperCase(), { x: 2.0, y: 0.65, w: W - 2.0 - M, h: 0.5, fontSize: 20, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(`Department of ${project.department}`, { x: 2.0, y: 1.15, w: W - 2.0 - M, h: 0.4, fontSize: 14, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(project.topic, { x: 1.0, y: 2.6, w: W - 2.0, h: 1.8, align: 'center', fontSize: 30, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line1 = [project.studentName, project.matric, project.degree].filter(Boolean).join('   ·   ')
    s.addText(line1, { x: M, y: 4.6, w: W - M * 2, h: 0.5, align: 'center', fontSize: 16, bold: true, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line2 = [project.supervisor ? `Supervisor: ${project.supervisor}` : '', project.session].filter(Boolean).join('   ·   ')
    s.addText(line2, { x: M, y: 5.15, w: W - M * 2, h: 0.4, align: 'center', fontSize: 13, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('A Final Year Project Defense', { x: M, y: 6.4, w: W - M * 2, h: 0.35, align: 'center', fontSize: 12, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    footer(s)
  }

  // ── Content sections, each with (continued) overflow pages ─────────────
  for (const key of sections) {
    const pages = splitBullets(content.bullets[key])
    pages.forEach((items, i) => {
      const title = SECTION_TITLES[key] + (i > 0 ? ' (continued)' : '')
      if (key === 'objectives') {
        // Aim gets a green lead-in label; objectives are the bullets.
        const s = pptx.addSlide()
        s.background = { color: 'FFFFFF' }
        s.addText(title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
        s.addText([
          { text: 'Aim:  ', options: { bold: true, color: T.acc, fontSize: 24 } },
          { text: content.aim, options: { color: T.tc, fontSize: 24, breakLine: true } },
          ...items.map((t, j) => ({ text: t, options: { bullet: true, color: T.tc, fontSize: 24, breakLine: j < items.length - 1 } })),
        ], { x: 0.8, y: 1.9, w: W - M * 2, h: 5.0, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0, lineSpacingMultiple: 1.15 })
        if (content.notes.objectives) s.addNotes(content.notes.objectives)
        footer(s)
      } else {
        contentSlide(title, items, key)
      }
    })
  }

  // ── References: alphabetized, 5 per slide, [VERIFY] red bold ────────────
  {
    const sorted = [...references].sort((a, b) => a.apa.localeCompare(b.apa))
    const pages = sorted.length
      ? Array.from({ length: Math.ceil(sorted.length / 5) }, (_, i) => sorted.slice(i * 5, i * 5 + 5))
      : [[]]
    pages.forEach((page, i) => {
      const s = pptx.addSlide()
      s.background = { color: 'FFFFFF' }
      s.addText('References' + (i > 0 ? ' (continued)' : ''), { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 32, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
      const runs = page.length
        ? page.flatMap((r, j) => {
            const base = [{ text: r.apa, options: { breakLine: true, fontSize: 18, color: T.tc } }]
            return r.verified
              ? base
              : [{ text: '[VERIFY] ', options: { bold: true, color: T.att, fontSize: 18 } }, ...base]
          })
        : [{ text: 'No references were collected.', options: { fontSize: 18, color: T.muted } }]
      s.addText(runs, { x: 0.8, y: 1.6, w: W - M * 2, h: 5.2, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0, paraSpaceAfter: 10 })
      footer(s)
    })
  }

  // ── Thank You ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    s.addText('Thank You', { x: M, y: 2.6, w: W - M * 2, h: 1.2, align: 'center', fontSize: 54, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Questions & discussion', { x: M, y: 3.9, w: W - M * 2, h: 0.5, align: 'center', fontSize: 18, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const info = [project.studentName, project.department, project.university].filter(Boolean).join('  ·  ')
    if (info) s.addText(info, { x: M, y: 6.6, w: W - M * 2, h: 0.35, align: 'center', fontSize: 12, color: T.muted, fontFace: FONT, isTextBox: true, margin: 0 })
    footer(s)
  }

  // ── Q&A appendix (unchanged behavior) ───────────────────────────────────
  for (const qa of qaSlides) {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    s.addText(qa.title, { x: M, y: 0.65, w: W - M * 2, h: 0.6, fontSize: 28, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(qa.body.map((line, i) => ({ text: line, options: { bullet: true, breakLine: i < qa.body.length - 1 } })), {
      x: 0.8, y: 1.6, w: W - M * 2, h: 5.2, fontSize: 18, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0,
    })
    footer(s)
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/export/pptx.test.ts`
Expected: PASS. If `splitBullets` counting makes `2/17`-style assertions off by one, fix the *expected* numbers to the real structure (the truthfulness requirement is that the printed total matches the actual slide count — assert `n/total` equals the actual `names.length`).

- [ ] **Step 5: Commit**

```bash
git add web/src/export/pptx.ts web/src/export/pptx.test.ts
git commit -m "feat: example-deck pptx builder — footer strips, auto-split, notes, references"
```

---

### Task 16: Export flow — logo, slide images, references wiring

**Files:**
- Modify: `web/src/screens/Export.tsx` (pptx flow)
- Test: `web/src/screens/Export.test.tsx` (append + update mocks)

**Interfaces:**
- Consumes: `fetchLogo`, `generateImage` (Task 6), `buildPptx` v2 (Task 15), `ensureReferences` (Task 7).
- Produces: the final Export screen behavior.

- [ ] **Step 1: Write the failing tests**

In `web/src/screens/Export.test.tsx`: extend the `../api` mock to include `fetchLogo: vi.fn()` and `generateImage: vi.fn()`; extend the `../export/pptx` mock's `buildPptx` (still resolves a Blob) — its assertions move to call-args. Import `fetchLogo, generateImage`. Append:

```ts
describe('Export screen — pptx flow v2', () => {
  function seedProject() {
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'body' }],
      'abstract'
    )
    useAppStore.getState().setReferences([{ key: 'k', apa: 'A (2020). T.', verified: true }])
  }

  it('fetches the logo, generates slide images, and builds with all of them', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(JSON.stringify({ aim: 'Aim.', bullets: { intro: ['x'] }, notes: {}, images: [{ slide: 'sysdesign', prompt: 'a diagram' }] }))
    ;(fetchLogo as ReturnType<typeof vi.fn>).mockResolvedValue({ base64: 'bG9nbw==', mime: 'image/png' })
    ;(generateImage as ReturnType<typeof vi.fn>).mockResolvedValue('aW1n')
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(fetchLogo).toHaveBeenCalledWith('Bayero University Kano')
    expect(generateImage).toHaveBeenCalledWith(expect.anything(), 'a diagram')
    const args = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[5]).toBe('forest')                       // default theme
    expect(args[6].logo).toEqual({ base64: 'bG9nbw==', mime: 'image/png' })
    expect(args[6].images.sysdesign).toBe('aW1n')
    expect(args[4][0]).toMatchObject({ verified: true }) // typed references
  })

  it('logo and image failures degrade to null — export still succeeds', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(JSON.stringify({ aim: 'Aim.', bullets: { intro: ['x'] }, notes: {}, images: [{ slide: 'results', prompt: 'chart' }] }))
    ;(fetchLogo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(generateImage as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const args = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[6].logo).toBeNull()
    expect(args[6].images.results).toBeUndefined()
  })
})
```

(Seed the project's `university` field via `useAppStore.getState().setProject({ university: 'Bayero University Kano' })` in `seedProject` — add it if the fixture lacks it. Update the older pptx-flow tests from the defense-slides round to the v2 argument order.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/screens/Export.test.tsx`
Expected: FAIL — no logo/image calls, old buildPptx args.

- [ ] **Step 3: Implement**

In `web/src/screens/Export.tsx`, replace `pptx()`:

```ts
  async function pptx() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const qa = await ensureDefenseQa()
      const content = await ensureSlideContent()
      const refs = await ensureReferences().catch(() => useAppStore.getState().references)
      setPhase('Preparing slide assets…')
      const [logo, images] = await Promise.all([
        project.university ? fetchLogo(project.university) : Promise.resolve(null),
        (async () => {
          const out: Partial<Record<SlideKey, string>> = {}
          for (const img of content.images) {
            const data = await generateImage(settings, img.prompt)
            if (data) out[img.slide] = data
          }
          return out
        })(),
      ])
      setPhase('Building slides…')
      downloadBlob(
        await buildPptx(project, chapters, qa, content, refs, slideTheme, { logo, images }),
        `${slug(project.topic)}-defense.pptx`
      )
    } catch (e) {
      setPptxFailed(true)
      setError(e instanceof Error ? e.message : 'Slide generation failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }
```

and `pptxFallback()` analogously (no images, `logo: null`, references from the store):

```ts
  async function pptxFallback() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const content = slideContentFromChapters(chapters)
      setSlideContent(content)
      const refs = useAppStore.getState().references
      downloadBlob(
        await buildPptx(project, chapters, defenseQa, content, refs, slideTheme, { logo: null }),
        `${slug(project.topic)}-defense.pptx`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slide generation failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }
```

Import `SlideKey` type from `../ai/parseSlides`.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/screens/Export.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/Export.tsx web/src/screens/Export.test.tsx
git commit -m "feat: export flow — logo, slide images, verified references in the deck"
```

---

### Task 17: Full verification

**Files:** none (verification only; `git add -A` catches strays).

- [ ] **Step 1: Run both full suites**

Run: `cd web && npx vitest run`
Expected: PASS — all files, zero failures.

Run (repo root): `npx vitest run`
Expected: PASS — all server/shared tests, zero failures.

- [ ] **Step 2: Build the web bundle (type-check gate)**

Run: `cd web && npm run build`
Expected: completes with no TypeScript errors (chunk-size warning is pre-existing and acceptable).

- [ ] **Step 3: Commit any strays**

```bash
git add -A
git commit -m "chore: export overhaul verification pass"
```

(Skip the commit if the tree is clean.)

---

## Self-Review (completed during planning)

- **Spec coverage:** server routes (Tasks 1–3), citation pipeline extraction/prompt/parse (4–5), store + clients (6), resolution flow + badges (7), DOCX numbering (8), attention styling (9), figure images (10), TOC estimator + cached field (11), typed references in DOCX (12), theme re-token (13), schema/prompt/fallback v2 (14), deck rebuild with strips/auto-split/notes/references (15), logo + slide images flow (16), verification (17). Crossref-verification trigger = `ensureReferences` on first export of either format (Task 7). Preliminary-heading demotion (so the live TOC field covers chapters only) folded into Task 11.
- **Placeholder scan:** two authoring artifacts (Task 4 stray line, Task 11 defensive line) were found and removed from the plan document itself. No TBDs remain; every step carries code or an exact command.
- **Type consistency:** `ReferenceInput` defined in `shared/constants.ts` (Task 3), consumed by Task 5's parser and Task 6's client; `ReferenceEntry` defined in `store.ts` (Task 6), consumed by Tasks 7, 12, 15, 16; `SlideContent`/`SlideKey` (Task 14) consumed identically in Tasks 15–16; `buildPptx(project, chapters, defenseQa, content, references, themeId, opts)` arity identical in Tasks 15–16; `SlideTheme` tokens (`tc/acc/accLight/muted/att`) defined in Task 13 and used verbatim in Task 15.
- **Known judgment calls (documented, not placeholders):** (1) citation-js formats but does not parse raw APA text — the AI supplies structured fields (see the header note); (2) persisted users keep their previously chosen theme, including the old navy default; (3) the TOC's estimated page numbers are approximate by design — Word's field update corrects them on open; (4) slide-image generation is sequential per image (max 3) inside a `Promise.all` with the logo fetch — parallel enough at this scale.

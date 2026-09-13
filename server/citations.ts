import Cite from 'citation-js'
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

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

/** CSL author objects → the "Family, G. & Family, G." string form parseAuthors consumes. */
function formatAuthors(authors: { family?: string; given?: string }[] | undefined): string {
  return (authors ?? [])
    .filter((a) => a?.family)
    .map((a) => [a.family, a.given].filter(Boolean).join(', '))
    .join(' & ')
}

function toCsl(e: ReferenceInput) {
  return {
    type: e.container ? 'article-journal' : 'report',
    author: parseAuthors(e.authors ?? ''),
    issued: e.year ? { 'date-parts': [[Number(e.year) || e.year]] } : undefined,
    title: e.title,
    'container-title': e.container || undefined,
    volume: e.volume || undefined,
    issue: e.issue || undefined,
    page: e.pages || undefined,
    DOI: e.doi || undefined,
  }
}

/** "8(7)," / "8," / "7," / "" — correct APA volume/issue composition. */
function volumeIssue(volume: string, issue: string): string {
  if (volume && issue) return `${volume}(${issue}),`
  if (volume) return `${volume},`
  if (issue) return `${issue},`
  return ''
}

/** Deterministic APA rendering via citation-js's bundled citeproc. */
export function buildApa(e: ReferenceInput): string {
  if (!e.title) return [e.authors ?? '', e.year ? `(${e.year}).` : '', ''].filter(Boolean).join(' ')
  try {
    const out = new Cite(toCsl(e) as never).format('bibliography', { format: 'text', template: 'apa' })
    return out.trim()
  } catch {
    // citeproc rejection (bare minimum fields): assemble manually
    const parts = [
      e.authors && e.year ? `${e.authors} (${e.year}).` : e.authors || e.year ? [e.authors, e.year && `(${e.year})`].filter(Boolean).join(' ') + '.' : '',
      e.title,
      e.container ? `*${e.container}*` : '',
      volumeIssue(e.volume ?? '', e.issue ?? ''),
      e.pages ?? '',
      e.doi ? `https://doi.org/${e.doi}` : '',
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    return /\.\s*$/.test(parts) ? parts : `${parts}.`
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

/** A matching Crossref item, in its raw API shape. */
interface CrossrefItem {
  DOI: string
  title?: string[]
  author?: { family?: string; given?: string }[]
  issued?: { 'date-parts'?: (number | string)[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
}

/** Rebuild a ReferenceInput-shaped entry from authoritative Crossref metadata. */
function fromCrossref(item: CrossrefItem, e: ReferenceInput): ReferenceInput {
  const year = item.issued?.['date-parts']?.[0]?.[0]
  const container = item['container-title']?.[0]
  return {
    key: e.key,
    authors: formatAuthors(item.author),
    year: year !== undefined ? String(year) : '',
    title: item.title?.[0] ?? e.title,
    container: container || '',
    volume: item.volume ?? '',
    issue: item.issue ?? '',
    pages: item.page ?? '',
    doi: item.DOI,
  }
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
      const j = (await res.json()) as { message?: { items?: CrossrefItem[] } }
      const best = j.message?.items?.find((i) => similarity(e.title, i.title?.[0] ?? '') >= 0.85)
      if (best) {
        // Adopt the authoritative metadata, not just the DOI.
        try {
          return { input: e, apa: buildApa(fromCrossref(best, e)), verified: true, doi: best.DOI }
        } catch {
          return { input: e, apa, verified: true, doi: best.DOI }
        }
      }
    }
  } catch { /* offline / crossref down → unverified */ }
  return { input: e, apa, verified: false }
}

export async function resolveCitations(entries: ReferenceInput[]): Promise<CitationResult[]> {
  return Promise.all(entries.slice(0, 100).map(resolveOne))
}

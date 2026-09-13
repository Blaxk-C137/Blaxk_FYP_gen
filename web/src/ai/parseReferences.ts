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

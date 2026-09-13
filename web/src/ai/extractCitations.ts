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
  // Collect raw citation fragments with their match index, so both forms can be
  // merged in true first-appearance order regardless of which pass finds them.
  const hits: { index: number; raw: string }[] = []
  // Parenthetical: (Author, 2020; Author & Author, 2021) — must contain a year.
  for (const m of text.matchAll(/\(([^()]*\b\d{4}[^()]*)\)/g)) {
    for (const part of m[1].split(';')) hits.push({ index: m.index, raw: part })
  }
  // Narrative: Author (2020) / Author et al. (2020) / Author and Author (2020)
  for (const m of text.matchAll(
    /([A-Z][A-Za-z'’-]+(?:\s+(?:et al\.|and\s+[A-Z][A-Za-z'’-]+))?)\s+\((\d{4})\)/g
  )) {
    hits.push({ index: m.index, raw: `${m[1]}, ${m[2]}` })
  }
  hits.sort((a, b) => a.index - b.index)

  const keys: string[] = []
  for (const hit of hits) {
    const k = canonical(hit.raw)
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

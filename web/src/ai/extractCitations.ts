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

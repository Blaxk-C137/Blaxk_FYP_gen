import type { Chapter, ChapterStatus } from '../state/store'

interface RawOutline {
  abstract?: string
  chapters?: { title?: string; sections?: { heading?: string; description?: string }[] }[]
}

/** Parses the model's outline JSON, tolerating fenced code blocks and surrounding prose. */
export function parseOutline(raw: string): { chapters: Chapter[]; abstract: string } {
  const candidates: string[] = []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) candidates.push(fenced[1])
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1))
  candidates.push(raw)

  let lastParseError = ''
  let validJsonWithoutChapters = false
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as RawOutline
      if (!parsed.chapters?.length) {
        validJsonWithoutChapters = true
        continue
      }
      const chapters: Chapter[] = parsed.chapters.slice(0, 5).map((c, i) => ({
        number: i + 1,
        title: (c.title ?? `Chapter ${i + 1}`).toUpperCase(),
        sections: (c.sections ?? [])
          .filter((s) => s.heading)
          .map((s) => ({ heading: s.heading!, description: s.description ?? '' })),
        status: 'pending' as ChapterStatus,
        text: '',
      }))
      return { chapters, abstract: parsed.abstract ?? '' }
    } catch (e) {
      lastParseError = e instanceof Error ? e.message : String(e)
    }
  }
  // Name the actual failure mode and show what the model really said —
  // "did not return valid JSON" alone hides which of the three cases happened.
  const preview = raw.trim().slice(0, 300)
  if (validJsonWithoutChapters)
    throw new Error(`Model returned JSON without a "chapters" array. Model said: "${preview}"`)
  if (!raw.trim()) throw new Error('Model returned an empty response')
  throw new Error(
    `Model did not return valid JSON (${lastParseError}). Model said: "${preview}"`
  )
}

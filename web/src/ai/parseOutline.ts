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

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as RawOutline
      if (!parsed.chapters?.length) continue
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
    } catch {
      // try next candidate
    }
  }
  throw new Error('Model did not return valid JSON')
}

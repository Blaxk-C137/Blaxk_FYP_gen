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
  bullets: Object.fromEntries(SLIDE_KEYS.map((k): [SlideKey, string[]] => [k, []])) as Record<SlideKey, string[]>,
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

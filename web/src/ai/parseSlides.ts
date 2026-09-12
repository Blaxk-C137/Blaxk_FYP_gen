/** Slide-content JSON contract for the themed defense deck.
 *  Mirrors the AI response shape demanded by slidesPrompt (prompts.ts). */

export interface MethodStep { title: string; detail: string }

export interface SlideContent {
  outline: string[]
  bg: string[]
  prob: string[]
  gen_obj: string
  spec_obj: string[]
  scope_pts: string[]
  sig_pts: string[]
  method: MethodStep[]
  findings: string[]
  discuss: string[]
  conc_pts: string[]
  recs: string[]
}

const DEFAULT_METHOD: MethodStep[] = [
  { title: 'Research Design', detail: '' },
  { title: 'Data Collection', detail: '' },
  { title: 'Development', detail: '' },
  { title: 'Testing & Evaluation', detail: '' },
]

export const EMPTY_SLIDE_CONTENT: SlideContent = {
  outline: [], bg: [], prob: [], gen_obj: '', spec_obj: [],
  scope_pts: [], sig_pts: [], method: DEFAULT_METHOD,
  findings: [], discuss: [], conc_pts: [], recs: [],
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strs(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Parses the model's slide-content JSON, tolerating fenced code blocks and
 *  surrounding prose. Missing fields default rather than throw (a partial
 *  response still yields a deck); throws only when no candidate is usable. */
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
    try {
      parsed = JSON.parse(candidate.trim())
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const p = parsed as Record<string, unknown>

    const method = Array.isArray(p.method)
      ? p.method
          .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof m.title === 'string')
          .slice(0, 4)
          .map((m) => ({ title: str(m.title), detail: str(m.detail) }))
      : []

    const content: SlideContent = {
      outline: strs(p.outline),
      bg: strs(p.bg),
      prob: strs(p.prob),
      gen_obj: str(p.gen_obj),
      spec_obj: strs(p.spec_obj),
      scope_pts: strs(p.scope_pts),
      sig_pts: strs(p.sig_pts),
      method: method.length ? method : DEFAULT_METHOD,
      findings: strs(p.findings),
      discuss: strs(p.discuss),
      conc_pts: strs(p.conc_pts),
      recs: strs(p.recs),
    }

    // Usable only if at least one field carried content — otherwise try the
    // next candidate (mirrors parseOutline's chapters?.length check).
    const hasAnything =
      content.gen_obj !== '' ||
      [content.outline, content.bg, content.prob, content.spec_obj, content.scope_pts,
        content.sig_pts, content.findings, content.discuss, content.conc_pts, content.recs]
        .some((a) => a.length > 0)
    if (hasAnything) return content
  }
  throw new Error('Model did not return valid JSON')
}

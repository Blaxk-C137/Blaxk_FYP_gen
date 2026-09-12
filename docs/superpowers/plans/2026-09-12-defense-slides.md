# Themed Defense Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain PPTX export with the themed 9-slide defense deck prototyped in `docs/test run/PPTgen.html`, with AI-structured slide content from the generated chapters, a 4-theme picker on the Export screen, and a deterministic fallback.

**Architecture:** One non-streamed AI call returns a strict slide-content JSON (tolerant parser, per-field defaults — the proven `parseOutline` pattern). Themes are plain data in a dependency-free `themes.ts`; the deck builder in `pptx.ts` is theme-parameterized and deterministic (the AI decides content only, never formatting). The Export screen orchestrates: defense Q&A (existing) → slide structuring → themed build, with Retry + section-headings fallback on failure.

**Tech Stack:** TypeScript, React, pptxgenjs (already installed), zustand, vitest + JSZip for pptx inspection.

**Spec:** `docs/superpowers/specs/2026-09-12-defense-slides-design.md`

## Global Constraints

- Web tests run from `web/`: `npx vitest run <path>` (jsdom environment for export/screen tests, via `// @vitest-environment jsdom` pragma).
- Root tests run from the repo root: `npx vitest run <path>`.
- TDD: every task writes the failing test first, runs it to see it fail, implements minimally, verifies green, commits.
- The AI decides slide **content only** — layout, colors, ordering, footers are composed in code.
- No invented results or metrics in slide content (prompt states this; consistent with the citation-integrity policy in `systemPrompt`).
- Theme color values are copied verbatim from the prototype (`docs/test run/PPTgen.html`).
- All UI copy matches the app's register (see `web/src/styles.css` header: "manuscript design system" — calm, paper-toned).
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---

### Task 1: `slidesPrompt` — condensed chapter content → strict slide JSON

**Files:**
- Modify: `web/src/prompts.ts` (append `condenseChapters` + `slidesPrompt` at the end)
- Test: `web/src/prompts.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Chapter`, `ProjectInfo` from `./state/store` (already imported in the file).
- Produces: `condenseChapters(chapters: Chapter[]): string` and `slidesPrompt(project: ProjectInfo, chapters: Chapter[]): string`. Task 5 calls `slidesPrompt`; nothing else consumes `condenseChapters` (it is exported for testing).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/prompts.test.ts` (inside the existing top-level imports — `slidesPrompt` joins the existing import from `./prompts`; `initialChapterState` is already imported there):

```ts
describe('slidesPrompt', () => {
  const project = {
    ...EMPTY_PROJECT,
    topic: 'AI-based news bias detection', studentName: 'Francis Eboh John',
    matric: 'ENG/24/MCT/0029', university: 'Bayero University Kano',
    department: 'MECHATRONICS', supervisor: 'John Syzn', degree: 'B.Eng', session: '2026',
  }

  const longBody = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
  const chapters = [
    {
      number: 1, title: 'INTRODUCTION', status: 'done' as const,
      sections: [
        { heading: 'Background of the Study', description: 'why it matters' },
        { heading: 'Objectives of the Study', description: 'goals' },
      ],
      text: `CHAPTER ONE\n1.1 Background of the Study\n${longBody}\n1.2 Objectives of the Study\nTo detect bias.`,
    },
  ]

  it('carries project fields, chapter sections, and the exact JSON shape', () => {
    const p = slidesPrompt(project, chapters)
    expect(p).toContain('AI-based news bias detection')
    expect(p).toContain('Bayero University Kano')
    expect(p).toContain('Background of the Study')
    expect(p).toContain('word199')          // first 200 words of a section body survive
    expect(p).not.toContain('word350')      // …but the condense cap holds
    expect(p).toContain('"gen_obj"')
    expect(p).toContain('"spec_obj"')
    expect(p).toContain('"method"')
    expect(p).toContain('```json')
    expect(p).toContain('Max 12 words per bullet')
    expect(p).toContain('do not invent')
  })

  it('falls back to the section description when a heading has no body text', () => {
    const thin = [{
      number: 2, title: 'LITERATURE REVIEW', status: 'pending' as const,
      sections: [{ heading: 'Conceptual Framework', description: 'defines the concepts' }],
      text: '',
    }]
    const p = slidesPrompt(project, thin)
    expect(p).toContain('LITERATURE REVIEW')
    expect(p).toContain('defines the concepts')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/prompts.test.ts`
Expected: FAIL — `slidesPrompt` is not exported from `./prompts`.

- [ ] **Step 3: Write the implementation**

Append to `web/src/prompts.ts`:

```ts
// ---------------------------------------------------------------------------
// Defense slides — condense chapters into prompt-ready text and demand the
// strict slide-content JSON (spec: docs/superpowers/specs/2026-09-12-defense-slides-design.md)
// ---------------------------------------------------------------------------

/** Chapter bodies condensed for the slides prompt: every section heading plus the
 *  first 200 words of its body (or the outline description when the body is missing). */
export function condenseChapters(chapters: Chapter[]): string {
  return chapters
    .filter((c) => c.text || c.sections.length)
    .map((c) => {
      const parts = [`CHAPTER ${c.number} — ${c.title}`]
      // Split the body into blocks that each start with a "N.M Heading" line.
      const blocks = c.text.split(/\n(?=\d+\.\d+)/)
      for (const s of c.sections) {
        const block = blocks.find((b) => b.toLowerCase().includes(s.heading.toLowerCase())) ?? ''
        const body = block
          .replace(/^[^\n]*\n/, '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 200)
          .join(' ')
        parts.push(`  ${s.heading}: ${body || s.description}`)
      }
      if (!c.sections.length) {
        const body = c.text.trim().split(/\s+/).filter(Boolean).slice(0, 300).join(' ')
        if (body) parts.push(`  ${body}`)
      }
      return parts.join('\n')
    })
    .join('\n\n')
}

export function slidesPrompt(project: ProjectInfo, chapters: Chapter[]): string {
  return `Structure the defense slide content for this final year project. Condense the chapters into presentation bullets.

Topic: ${project.topic}
Student: ${project.studentName} (${project.matric})
University: ${project.university} — Department of ${project.department}
Degree: ${project.degree} | Supervisor: ${project.supervisor} | Session: ${project.session}

CHAPTER CONTENT (condensed):
${condenseChapters(chapters)}

Rules:
- Max 12 words per bullet. Academic Nigerian university tone.
- Use ONLY content present in the chapters — do not invent results, metrics, or citations.
- "outline" lists the six content-slide titles in this order: Background & Problem Statement, Objectives of the Study, Scope & Significance, Methodology, Results & Analysis, Conclusion & Recommendations.

Respond with ONLY a JSON object in a fenced json code block, no other prose, in this exact shape (all fields required):

\`\`\`json
{
  "outline": ["Background & Problem Statement", "Objectives of the Study", "Scope & Significance", "Methodology", "Results & Analysis", "Conclusion & Recommendations"],
  "bg": ["point 1", "point 2", "point 3", "point 4"],
  "prob": ["problem 1", "problem 2", "problem 3"],
  "gen_obj": "To develop/design/implement... (one concise sentence)",
  "spec_obj": ["specific obj 1", "specific obj 2", "specific obj 3", "specific obj 4", "specific obj 5"],
  "scope_pts": ["scope 1", "scope 2", "scope 3"],
  "sig_pts": ["sig 1", "sig 2", "sig 3", "sig 4"],
  "method": [
    { "title": "Research Design", "detail": "one brief line" },
    { "title": "Data Collection", "detail": "one brief line" },
    { "title": "Development", "detail": "one brief line" },
    { "title": "Testing & Evaluation", "detail": "one brief line" }
  ],
  "findings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "discuss": ["discussion point 1", "discussion point 2", "discussion point 3"],
  "conc_pts": ["conclusion 1", "conclusion 2", "conclusion 3"],
  "recs": ["rec 1", "rec 2", "rec 3", "rec 4"]
}
\`\`\``
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/prompts.test.ts`
Expected: PASS (existing prompt tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/prompts.ts web/src/prompts.test.ts
git commit -m "feat: slides prompt — condense chapters, demand strict slide JSON"
```

---

### Task 2: `parseSlides` — tolerant slide-content parser

**Files:**
- Create: `web/src/ai/parseSlides.ts`
- Test: `web/src/ai/parseSlides.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces (used by Task 4's `slideContentFromChapters` return type, Task 5's Export screen, and the pptx builder):

```ts
export interface MethodStep { title: string; detail: string }
export interface SlideContent {
  outline: string[]; bg: string[]; prob: string[]; gen_obj: string
  spec_obj: string[]; scope_pts: string[]; sig_pts: string[]
  method: MethodStep[]; findings: string[]; discuss: string[]
  conc_pts: string[]; recs: string[]
}
export const EMPTY_SLIDE_CONTENT: SlideContent
export function parseSlides(raw: string): SlideContent
// throws Error('Model did not return valid JSON') when no candidate is usable
```

- [ ] **Step 1: Write the failing test**

```ts
// web/src/ai/parseSlides.test.ts
import { describe, it, expect } from 'vitest'
import { parseSlides, EMPTY_SLIDE_CONTENT } from './parseSlides'

const full = JSON.stringify({
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['News volume has grown', 'Bias fuels tension'],
  prob: ['Western-trained tools miss Nigerian context'],
  gen_obj: 'To develop an AI model for detecting bias in Nigerian online news.',
  spec_obj: ['Collect and annotate a dataset', 'Compare ML and deep learning models', 'Evaluate with accuracy and F1', 'Recommend deployment improvements', 'Document the pipeline'],
  scope_pts: ['English-language Nigerian news', '2020–2024 data'],
  sig_pts: ['Empowers citizens', 'Aids journalists'],
  method: [
    { title: 'Research Design', detail: 'Descriptive and experimental design.' },
    { title: 'Data Collection', detail: 'Web-scraped 10,000 articles.' },
  ],
  findings: ['BERT achieved best accuracy', 'SVM baseline weaker'],
  discuss: ['Domain data matters'],
  conc_pts: ['Detection is feasible'],
  recs: ['Adopt AI auditing', 'Extend to Hausa news'],
})

describe('parseSlides', () => {
  it('parses clean JSON into SlideContent', () => {
    const r = parseSlides(full)
    expect(r.gen_obj).toContain('AI model')
    expect(r.bg).toHaveLength(2)
    expect(r.method).toEqual([
      { title: 'Research Design', detail: 'Descriptive and experimental design.' },
      { title: 'Data Collection', detail: 'Web-scraped 10,000 articles.' },
    ])
  })

  it('extracts JSON from a fenced block with prose around it', () => {
    const r = parseSlides(`Here you go:\n\n\`\`\`json\n${full}\n\`\`\`\n\nGood luck!`)
    expect(r.spec_obj).toHaveLength(5)
  })

  it('defaults missing fields instead of throwing (partial JSON)', () => {
    const r = parseSlides('{"gen_obj": "One objective only."}')
    expect(r.gen_obj).toBe('One objective only.')
    expect(r.bg).toEqual([])
    expect(r.method).toEqual(EMPTY_SLIDE_CONTENT.method)
  })

  it('ignores non-string junk inside arrays', () => {
    const r = parseSlides('{"bg": ["ok", 5, null, "  "], "prob": []}')
    expect(r.bg).toEqual(['ok'])
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseSlides('I could not do that.')).toThrow('Model did not return valid JSON')
    expect(() => parseSlides('{"unrelated": true}')).toThrow('Model did not return valid JSON')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/ai/parseSlides.test.ts`
Expected: FAIL — cannot resolve `./parseSlides`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/ai/parseSlides.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/ai/parseSlides.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/ai/parseSlides.ts web/src/ai/parseSlides.test.ts
git commit -m "feat: tolerant slide-content parser with per-field defaults"
```

---

### Task 3: Theme data + `slideTheme` store field

**Files:**
- Create: `web/src/export/themes.ts` (dependency-free so the store can import `ThemeId` without pulling in pptxgenjs)
- Modify: `web/src/state/store.ts` (add `slideTheme` + `setSlideTheme`)
- Test: `web/src/state/store.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces (Task 4 imports `THEMES`/`SlideTheme`/`ThemeId`; Task 5 imports `THEME_OPTIONS`; the store persists `slideTheme`):

```ts
// web/src/export/themes.ts
export type ThemeId = 'navy' | 'night' | 'forest' | 'slate'
export interface SlideTheme {
  sbg: string; acc: string; stxt: string; ssub: string; cbg: string; tc: string
  bc: string; sec: string; ft: string; sf: string; sx: string; dt: string
}
export const THEMES: Record<ThemeId, SlideTheme>
export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[]
```

Store additions: state field `slideTheme: ThemeId` (default `'navy'`, persisted, **survives `reset()`** — it is a preference, not project data) and action `setSlideTheme(t: ThemeId): void`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/state/store.test.ts` (add `THEME_OPTIONS` import not needed here; only store):

```ts
describe('slideTheme', () => {
  it('defaults to navy and setSlideTheme updates it', () => {
    expect(useAppStore.getState().slideTheme).toBe('navy')
    useAppStore.getState().setSlideTheme('forest')
    expect(useAppStore.getState().slideTheme).toBe('forest')
  })

  it('survives reset — theme is a preference, not project data', () => {
    useAppStore.getState().setSlideTheme('slate')
    useAppStore.getState().reset()
    expect(useAppStore.getState().slideTheme).toBe('slate')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/state/store.test.ts`
Expected: FAIL — `slideTheme` does not exist on state (`undefined` ≠ `'navy'`).

- [ ] **Step 3: Write the implementation**

Create `web/src/export/themes.ts` — color values copied verbatim from the prototype's `T_MAP`:

```ts
// web/src/export/themes.ts
/** Slide themes as plain data — no pptxgenjs import here so the store can
 *  reference ThemeId cheaply. Colors copied from docs/test run/PPTgen.html. */

export type ThemeId = 'navy' | 'night' | 'forest' | 'slate'

export interface SlideTheme {
  sbg: string   // title/thank-you slide background
  acc: string   // accent
  stxt: string  // title-slide heading text
  ssub: string  // title-slide secondary text
  cbg: string   // content slide background
  tc: string    // content slide title color
  bc: string    // bullet color
  sec: string   // section-head color inside bullet groups
  ft: string    // footer text
  sf: string    // methodology step number square fill
  sx: string    // methodology step number text
  dt: string    // methodology detail text
}

export const THEMES: Record<ThemeId, SlideTheme> = {
  navy:   { sbg: '0A2342', acc: 'C9A227', stxt: 'FFFFFF', ssub: 'A0B4C8', cbg: 'FFFFFF', tc: '0A2342', bc: '1A2E4A', sec: '0A2342', ft: '94A3B8', sf: '0A2342', sx: 'FFFFFF', dt: '475569' },
  night:  { sbg: '1a1a2e', acc: 'e94560', stxt: 'FFFFFF', ssub: 'CCBBDD', cbg: 'FFFFFF', tc: '1a1a2e', bc: '2D2040', sec: '1a1a2e', ft: '94A3B8', sf: '1a1a2e', sx: 'FFFFFF', dt: '475569' },
  forest: { sbg: '1B4332', acc: '52B788', stxt: 'FFFFFF', ssub: 'AACCBB', cbg: 'FFFFFF', tc: '1B4332', bc: '2D6A4F', sec: '1B4332', ft: '94A3B8', sf: '1B4332', sx: 'FFFFFF', dt: '475569' },
  slate:  { sbg: '1e293b', acc: '38bdf8', stxt: 'FFFFFF', ssub: 'AABBCC', cbg: 'FFFFFF', tc: '1e293b', bc: '334155', sec: '1e293b', ft: '94A3B8', sf: '1e293b', sx: 'FFFFFF', dt: '475569' },
}

export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[] = [
  { id: 'navy',   name: 'Navy & Gold',  preview: { primary: '#0A2342', accent: '#C9A227' } },
  { id: 'night',  name: 'Midnight Red', preview: { primary: '#1a1a2e', accent: '#e94560' } },
  { id: 'forest', name: 'Forest Green', preview: { primary: '#1B4332', accent: '#52B788' } },
  { id: 'slate',  name: 'Slate & Sky',  preview: { primary: '#1e293b', accent: '#38bdf8' } },
]
```

In `web/src/state/store.ts`:

1. Add the import (top, next to the tracks import): `import type { ThemeId } from '../export/themes'`
2. Extend the `AppState` interface:

```ts
  slideTheme: ThemeId
  // …with the actions:
  setSlideTheme: (t: ThemeId) => void
```

3. In the store body (after `references: []`): `slideTheme: 'navy',`
4. Action (next to `setReferences`): `setSlideTheme: (t) => set({ slideTheme: t }),`
5. **Leave `reset()` untouched** — it sets only project fields, so `slideTheme` persists across reset by omission.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/state/store.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/export/themes.ts web/src/state/store.ts web/src/state/store.test.ts
git commit -m "feat: slide theme data and persisted slideTheme preference"
```

---

### Task 4: Themed deck builder — rewrite `pptx.ts`

**Files:**
- Modify: `web/src/export/pptx.ts` (full rewrite)
- Modify: `web/src/screens/Export.tsx` (mechanical rewiring only — pass new args)
- Modify: `web/src/screens/Export.test.tsx` (mock factory must export the new symbols)
- Test: `web/src/export/pptx.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `SlideContent`, `MethodStep` from `../ai/parseSlides` (Task 2); `THEMES`, `SlideTheme`, `ThemeId` from `./themes` (Task 3); `Chapter`, `ProjectInfo` from `../state/store`.
- Produces (Task 5 relies on these exact signatures):

```ts
export function slideContentFromChapters(chapters: Chapter[]): SlideContent
export async function buildPptx(
  project: ProjectInfo, chapters: Chapter[], defenseQa: string,
  content: SlideContent, theme: ThemeId
): Promise<Blob>
export function parseQaSlides(defenseQa: string): { title: string; body: string[] }[]  // unchanged
```

`chapters` stays on `buildPptx` (footer needs `project.title`; chapters are kept for future appendix headings — the Q&A slide titles already come from `parseQaSlides`, which parses chapter titles out of the Q&A text itself).

- [ ] **Step 1: Write the failing test**

Replace the whole of `web/src/export/pptx.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptx, slideContentFromChapters, parseQaSlides } from './pptx'
import type { SlideContent } from '../ai/parseSlides'

const project = {
  topic: 'IoT-based theft detection', studentName: 'Aisha Musa', matric: 'ENG/21/10345',
  university: 'Bayero University Kano', department: 'Telecommunications Engineering',
  supervisor: 'Dr. O. Adewale', degree: 'B.Eng', session: '2026/2027',
}
const chapters = [
  { number: 1, title: 'INTRODUCTION', status: 'done' as const,
    sections: [
      { heading: 'Background of the Study', description: 'context' },
      { heading: 'Statement of the Problem', description: 'theft' },
      { heading: 'Objectives of the Study', description: 'goals' },
    ], text: 'CHAPTER ONE\n1.1 Background\nCampus theft is common.' },
  { number: 3, title: 'METHODOLOGY', status: 'done' as const,
    sections: [{ heading: 'Research Design', description: '' }, { heading: 'System Implementation', description: '' }],
    text: 'CHAPTER THREE\nBuilt a system.' },
]
const defenseQa = 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'

const content: SlideContent = {
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['Campus theft is common', 'Labs lose equipment yearly'],
  prob: ['Manual watchmen are unreliable'],
  gen_obj: 'To build an IoT theft detection system for campus laboratories.',
  spec_obj: ['Sense motion reliably', 'Raise alerts in real time', 'Log intrusion events', 'Keep hardware cheap'],
  scope_pts: ['Two campus laboratories', 'PIR and door sensors'],
  sig_pts: ['Protects university assets', 'Cheap enough to scale'],
  method: [
    { title: 'Research Design', detail: 'Experimental prototype.' },
    { title: 'Data Collection', detail: 'Sensor logs over six weeks.' },
    { title: 'Development', detail: 'ESP32 firmware and dashboard.' },
    { title: 'Testing & Evaluation', detail: 'Intrusion drills, 98% detection.' },
  ],
  findings: ['98% detection rate', 'No false alarms at night'],
  discuss: ['Cheaper than hiring guards'],
  conc_pts: ['The system works reliably'],
  recs: ['Deploy across all labs', 'Add camera integration'],
}

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

async function slidesOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
  return { zip, names, xml: (i: number) => zip.file(`ppt/slides/slide${i}.xml`)!.async('string') }
}

describe('buildPptx', () => {
  it('builds 9 themed core slides plus one appendix slide per Q&A chapter', async () => {
    const { names, xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(names).toHaveLength(11)
    const slide1 = await xml(1)
    expect(slide1).toContain('IoT-based theft detection')
    expect(slide1).toContain('BAYERO UNIVERSITY KANO')
    expect(slide1).toContain('Aisha Musa')
    const outline = await xml(2)
    expect(outline).toContain('Outline')
    const qa = await xml(10)
    expect(qa).toContain('Why this topic?')
  })

  it('applies the chosen theme colors to the deck', async () => {
    const navy = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(await navy.xml(1)).toContain('0A2342')   // title-slide background
    expect(await navy.xml(2)).toContain('C9A227')   // accent (outline numbers come later; bullet/section colors carry it) — see note
    const forest = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'forest'))
    expect(await forest.xml(1)).toContain('1B4332')
    expect(await forest.xml(6)).toContain('1B4332')  // methodology step squares
  })

  it('numbers footers truthfully: n/total includes appendix slides', async () => {
    const withQa = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    expect(await withQa.xml(2)).toContain('2/11')
    expect(await withQa.xml(10)).toContain('10/11')
    const noQa = await slidesOf(await buildPptx(project, chapters, '', content, 'navy'))
    expect(noQa.names).toHaveLength(9)
    expect(await noQa.xml(2)).toContain('2/9')
    expect(await noQa.xml(9)).not.toContain('9/9') // thank-you slide has no footer
  })

  it('renders the methodology grid and grouped content slides', async () => {
    const { xml } = await slidesOf(await buildPptx(project, chapters, defenseQa, content, 'navy'))
    const method = await xml(6)
    expect(method).toContain('Research Design')
    expect(method).toContain('ESP32 firmware and dashboard.')
    const objectives = await xml(4)
    expect(objectives).toContain('General Objective')
    expect(objectives).toContain('To build an IoT theft detection system for campus laboratories.')
    expect(objectives).toContain('Specific Objectives')
    const bg = await xml(3)
    expect(bg).toContain('Background of the Study')
    expect(bg).toContain('Statement of the Problem')
  })

  it('skips a content slide whose group is entirely empty', async () => {
    const thin: SlideContent = { ...content, findings: [], discuss: [] }
    const { names } = await slidesOf(await buildPptx(project, chapters, '', thin, 'navy'))
    expect(names).toHaveLength(8) // 9 minus the empty Results slide
    const conc = await slidesOf(await buildPptx(project, chapters, '', thin, 'navy'))
    const slide7 = await conc.xml(7)
    expect(slide7).toContain('Conclusion & Recommendations') // Results skipped, Conclusion moves up
  })
})

describe('slideContentFromChapters', () => {
  it('maps chapter sections to slide content mechanically', () => {
    const c = slideContentFromChapters([
      { ...chapters[0], sections: [
        { heading: 'Background of the Study', description: '' },
        { heading: 'Objectives of the Study', description: '' },
      ] },
      chapters[1],
    ])
    expect(c.bg).toEqual(['Background of the Study'])
    expect(c.gen_obj).toBe('Objectives of the Study') // first objective section becomes the general objective
    expect(c.method.map((m) => m.title)).toEqual(['Research Design', 'System Implementation'])
  })

  it('defaults outline to the six standard titles', () => {
    const c = slideContentFromChapters([])
    expect(c.outline).toHaveLength(6)
    expect(c.outline[0]).toBe('Background & Problem Statement')
  })
})

describe('parseQaSlides (unchanged)', () => {
  it('still yields one slide per chapter block', () => {
    expect(parseQaSlides(defenseQa)).toHaveLength(2)
  })
})
```

Note on the `C9A227` assertion for slide 2: the outline slide numbers are rendered as part of the bullet text (`"1.  Background & Problem Statement"`), not separately colored — if the navy accent does not appear in slide 2's XML, drop that single line and keep the slide-1/6 assertions (the accent presence is already covered by slide 1's university-name color).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/export/pptx.test.ts`
Expected: FAIL — `slideContentFromChapters` not exported; `buildPptx` arity mismatch.

- [ ] **Step 3: Write the implementation**

Replace the whole of `web/src/export/pptx.ts`:

```ts
import pptxgen from 'pptxgenjs'
import type { Chapter, ProjectInfo } from '../state/store'
import type { SlideContent } from '../ai/parseSlides'
import { THEMES, type SlideTheme, type ThemeId } from './themes'

// ---------------------------------------------------------------------------
// Q&A appendix (unchanged behavior from the first export version)
// ---------------------------------------------------------------------------

/** Parses defenseQa text into one slide per chapter block. */
export function parseQaSlides(defenseQa: string): { title: string; body: string[] }[] {
  const slides: { title: string; body: string[] }[] = []
  if (!defenseQa.trim()) return slides
  const blocks = defenseQa.split(/\n(?=Chapter \d)/i)
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const questions = lines.filter((l) => /^(Q:|A:)/.test(l))
    if (questions.length) slides.push({ title: `Q&A Prep — ${lines[0]}`, body: questions })
  }
  return slides
}

// ---------------------------------------------------------------------------
// Deterministic fallback — section headings mapped into the slide-content shape
// ---------------------------------------------------------------------------

const DEFAULT_OUTLINE = [
  'Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance',
  'Methodology', 'Results & Analysis', 'Conclusion & Recommendations',
]

/** Mechanical mapping used when the AI structuring call fails — the deck still
 *  gets the themed layout, just with section headings as bullets. */
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
    outline: DEFAULT_OUTLINE,
    bg: headings(1, ['background']),
    prob: headings(1, ['problem']),
    gen_obj: objectives[0] ?? '',
    spec_obj: objectives.slice(1),
    scope_pts: headings(1, ['scope']),
    sig_pts: headings(1, ['significance']),
    method: headings(3, []).slice(0, 4).map((title) => ({ title, detail: '' })),
    findings: headings(4, ['finding', 'result']),
    discuss: headings(4, ['discussion']),
    conc_pts: headings(5, ['conclusion', 'summary']),
    recs: headings(5, ['recommend']),
  }
}

// ---------------------------------------------------------------------------
// Themed deck builder — layout ported 1:1 from docs/test run/PPTgen.html
// ---------------------------------------------------------------------------

interface Run { text: string; options: Record<string, unknown> }

export async function buildPptx(
  project: ProjectInfo,
  _chapters: Chapter[],
  defenseQa: string,
  content: SlideContent,
  themeId: ThemeId
): Promise<Blob> {
  const T: SlideTheme = THEMES[themeId]
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9'

  const W = 10, H = 5.625, M = 0.5
  const FONT = 'Calibri'

  const qaSlides = parseQaSlides(defenseQa)
  const outline = content.outline.length ? content.outline : DEFAULT_OUTLINE

  // Which content groups have anything to show (empty groups are skipped).
  const has = {
    bgProb: content.bg.length + content.prob.length > 0,
    obj: content.gen_obj !== '' || content.spec_obj.length > 0,
    scopeSig: content.scope_pts.length + content.sig_pts.length > 0,
    method: content.method.some((m) => m.title || m.detail),
    results: content.findings.length + content.discuss.length > 0,
    concRecs: content.conc_pts.length + content.recs.length > 0,
  }
  const coreCount = 2 + Object.values(has).filter(Boolean).length // title + thank-you + content slides
  const total = coreCount + qaSlides.length
  let n = 0

  const footer = (s: ReturnType<pptxgen['addSlide']>) => {
    n += 1
    s.addText(project.topic, { x: M, y: H - 0.33, w: W - 1.1, h: 0.26, fontSize: 7.5, color: T.ft, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(`${n}/${total}`, { x: W - 0.78, y: H - 0.33, w: 0.58, h: 0.26, fontSize: 7.5, color: T.ft, align: 'right', fontFace: FONT, isTextBox: true, margin: 0 })
    return s
  }

  const run = (text: string, isHead: boolean, isLast: boolean, isSpacer = false): Run =>
    isSpacer
      ? { text: ' ', options: { bullet: false, fontSize: 5, breakLine: true, color: T.cbg } }
      : {
          text,
          options: {
            bullet: !isHead, bold: isHead,
            fontSize: isHead ? 15 : 14,
            color: isHead ? T.sec : T.bc,
            paraSpaceAfter: isHead ? 4 : 7,
            breakLine: !isLast,
          },
        }

  const group = (head: string, points: string[], isLastGroup: boolean): Run[] => [
    run(head, true, false),
    ...points.map((p, i) => run(p, false, isLastGroup && i === points.length - 1)),
  ]

  /** Standard content slide: title bar + bullet runs + footer. */
  const contentSlide = (title: string, runs: Run[]) => {
    const s = pptx.addSlide()
    s.background = { color: T.cbg }
    s.addText(title, { x: M, y: 0.26, w: W - M * 2, h: 0.72, fontSize: 23, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    if (runs.length) {
      s.addText(runs, { x: M, y: 1.08, w: W - M * 2, h: H - 1.08 - 0.46, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 })
    }
    footer(s)
    return s
  }

  // ── 1: Title ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: T.sbg }
    n += 1
    if (project.university)
      s.addText(project.university.toUpperCase(), { x: M, y: 0.34, w: W - M * 2, h: 0.34, align: 'center', fontSize: 10.5, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    if (project.department)
      s.addText(`Department of ${project.department}`, { x: M, y: 0.68, w: W - M * 2, h: 0.28, align: 'center', fontSize: 10, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText(project.topic, { x: 0.8, y: 1.18, w: W - 1.6, h: 2.1, align: 'center', fontSize: 30, bold: true, color: T.stxt, fontFace: FONT, isTextBox: true, margin: 0 })
    const line1 = [project.studentName, project.matric, project.degree].filter(Boolean).join('   ·   ')
    if (line1)
      s.addText(line1, { x: M, y: 3.42, w: W - M * 2, h: 0.36, align: 'center', fontSize: 13.5, bold: true, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const line2 = [project.supervisor ? `Supervisor: ${project.supervisor}` : '', project.session].filter(Boolean).join('   ·   ')
    if (line2)
      s.addText(line2, { x: M, y: 3.86, w: W - M * 2, h: 0.3, align: 'center', fontSize: 11, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Final Year Project Defense', { x: M, y: H - 0.48, w: W - M * 2, h: 0.26, align: 'center', fontSize: 9.5, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
  }

  // ── 2: Outline ─────────────────────────────────────────────────────────
  contentSlide('Outline', outline.map((x, i) => run(`${i + 1}.  ${x}`, false, i === outline.length - 1)))

  // ── 3: Background & Problem ────────────────────────────────────────────
  if (has.bgProb) {
    contentSlide('Background & Problem Statement', [
      ...group('Background of the Study', content.bg, false),
      run(' ', false, false, true),
      ...group('Statement of the Problem', content.prob, true),
    ])
  }

  // ── 4: Objectives ──────────────────────────────────────────────────────
  if (has.obj) {
    contentSlide('Objectives of the Study', [
      ...group('General Objective', content.gen_obj ? [content.gen_obj] : [], false),
      run(' ', false, false, true),
      ...group('Specific Objectives', content.spec_obj, true),
    ])
  }

  // ── 5: Scope & Significance ────────────────────────────────────────────
  if (has.scopeSig) {
    contentSlide('Scope & Significance of the Study', [
      ...group('Scope of the Study', content.scope_pts, false),
      run(' ', false, false, true),
      ...group('Significance of the Study', content.sig_pts, true),
    ])
  }

  // ── 6: Methodology (2×2 grid) ──────────────────────────────────────────
  if (has.method) {
    const s = pptx.addSlide()
    s.background = { color: T.cbg }
    s.addText('Methodology', { x: M, y: 0.26, w: W - M * 2, h: 0.72, fontSize: 23, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, margin: 0 })
    const cW = (W - M * 2 - 0.28) / 2
    content.method.slice(0, 4).forEach((step, i) => {
      const col = i % 2, row = Math.floor(i / 2)
      const x = M + col * (cW + 0.28), y = 1.12 + row * 1.92
      s.addText(`${i + 1}`, { x, y, w: 0.38, h: 0.38, fill: { color: T.sf }, fontSize: 13, bold: true, color: T.sx, align: 'center', valign: 'middle', fontFace: FONT, isTextBox: true, margin: 0 })
      s.addText(step.title, { x: x + 0.48, y: y + 0.02, w: cW - 0.58, h: 0.34, fontSize: 13, bold: true, color: T.tc, fontFace: FONT, isTextBox: true, valign: 'middle', margin: 0 })
      if (step.detail)
        s.addText(step.detail, { x: x + 0.48, y: y + 0.4, w: cW - 0.58, h: 1.35, fontSize: 12, color: T.dt, fontFace: FONT, isTextBox: true, valign: 'top', margin: 0 })
    })
    footer(s)
  }

  // ── 7: Results & Analysis ──────────────────────────────────────────────
  if (has.results) {
    contentSlide('Results & Analysis', [
      ...group('Key Findings', content.findings, false),
      run(' ', false, false, true),
      ...group('Discussion of Findings', content.discuss, true),
    ])
  }

  // ── 8: Conclusion & Recommendations ────────────────────────────────────
  if (has.concRecs) {
    contentSlide('Conclusion & Recommendations', [
      ...group('Conclusion', content.conc_pts, false),
      run(' ', false, false, true),
      ...group('Recommendations', content.recs, true),
    ])
  }

  // ── 9: Thank You ───────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.background = { color: T.sbg }
    s.addText('Thank You', { x: M, y: 1.48, w: W - M * 2, h: 1.45, align: 'center', fontSize: 52, bold: true, color: T.stxt, fontFace: FONT, isTextBox: true, margin: 0 })
    s.addText('Questions, corrections and contributions are welcome.', { x: M, y: 3.1, w: W - M * 2, h: 0.44, align: 'center', fontSize: 14, color: T.acc, fontFace: FONT, isTextBox: true, margin: 0 })
    const info = [project.studentName, project.department, project.university].filter(Boolean).join('  ·  ')
    if (info)
      s.addText(info, { x: M, y: H - 0.46, w: W - M * 2, h: 0.28, align: 'center', fontSize: 9.5, color: T.ssub, fontFace: FONT, isTextBox: true, margin: 0 })
  }

  // ── 10+: Q&A appendix ──────────────────────────────────────────────────
  for (const qa of qaSlides) {
    contentSlide(qa.title, qa.body.map((line, i) => run(line, false, i === qa.body.length - 1)))
  }

  const data = (await pptx.write({ outputType: 'blob' })) as Blob
  return data
}
```

Then the mechanical rewiring in `web/src/screens/Export.tsx` (full UX lands in Task 5 — this task only keeps the app compiling against the new signature):

- Import change: `import { buildPptx, slideContentFromChapters } from '../export/pptx'`
- In `pptx()`, both `buildPptx(...)` call sites become:

```ts
buildPptx(project, chapters, qa, slideContentFromChapters(chapters), useAppStore.getState().slideTheme)
```

And in `web/src/screens/Export.test.tsx`, the pptx mock factory must expose the new symbols:

```ts
vi.mock('../export/pptx', () => ({
  buildPptx: vi.fn().mockResolvedValue(new Blob(['y'])),
  slideContentFromChapters: vi.fn().mockReturnValue({ outline: [], bg: [], prob: [], gen_obj: '', spec_obj: [], scope_pts: [], sig_pts: [], method: [], findings: [], discuss: [], conc_pts: [], recs: [] }),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/export/pptx.test.ts src/screens/Export.test.tsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add web/src/export/pptx.ts web/src/export/pptx.test.ts web/src/screens/Export.tsx web/src/screens/Export.test.tsx
git commit -m "feat: themed 9-slide defense deck with truthful footers and fallback content"
```

---

### Task 5: Export screen — theme picker, AI structuring flow, retry + fallback

**Files:**
- Modify: `web/src/screens/Export.tsx` (full pptx flow)
- Modify: `web/src/styles.css` (theme picker styles)
- Test: `web/src/screens/Export.test.tsx` (append tests)

**Interfaces:**
- Consumes: `slidesPrompt` (Task 1), `parseSlides`/`SlideContent` (Task 2), `THEME_OPTIONS` (Task 3), `buildPptx`/`slideContentFromChapters` (Task 4), `useAppStore` state `slideTheme`/`setSlideTheme` (Task 3), existing `generateStream`, `defenseQuestionsPrompt`, `systemPrompt`, `trackFor`.
- Produces: the final Export screen. No downstream consumers.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/screens/Export.test.tsx` (this file already mocks `../api`, `../export/download`, `../export/docx`, `../export/pptx`; `../export/themes` stays real — it is dependency-free). Extend the mocks and imports:

```ts
// extend the api mock at the top of the file:
vi.mock('../api', () => ({ generateStream: vi.fn() }))
// …and import the mocked functions:
import { generateStream } from '../api'
import { buildPptx, slideContentFromChapters } from '../export/pptx'
import { useAppStore } from '../state/store'

const slideJson = JSON.stringify({
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['Theft is common'], prob: ['Watchmen unreliable'],
  gen_obj: 'To detect theft.', spec_obj: ['Sense motion'],
  scope_pts: ['Two labs'], sig_pts: ['Protects assets'],
  method: [{ title: 'Research Design', detail: 'Prototype.' }],
  findings: ['98% detection'], discuss: ['Cheap'],
  conc_pts: ['It works'], recs: ['Scale up'],
})
```

Update the existing DOCX test's beforeEach if needed (it already resets store state; add `slideTheme` reset is unnecessary — default 'navy' persists, that's fine). Then append:

```ts
describe('Export screen — defense slides', () => {
  function seedProject() {
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'body' }],
      'abstract'
    )
  }

  it('theme picker updates the persisted preference', async () => {
    render(<Export />)
    const forest = screen.getByRole('radio', { name: /forest green/i })
    expect(forest.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(forest)
    expect(useAppStore.getState().slideTheme).toBe('forest')
    expect(forest.getAttribute('aria-checked')).toBe('true')
  })

  it('PPTX click: generates Q&A then slide content, builds with both', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')   // defense Q&A
      .mockResolvedValueOnce(`\`\`\`json\n${slideJson}\n\`\`\``)                    // slide content
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect((downloadBlob as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/-defense\.pptx$/)
    const [proj, chapters, qa, content, theme] = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(qa).toContain('Q: Why?')
    expect(content.gen_obj).toBe('To detect theft.')
    expect(theme).toBe('navy')
  })

  it('reuses cached Q&A and slide content on a second click (one AI call each)', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(slideJson)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2))
    expect(generateStream).toHaveBeenCalledTimes(2) // not 4
  })

  it('structuring failure offers retry and the section-headings fallback', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockRejectedValueOnce(new Error('quota exceeded'))
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    expect(await screen.findByText(/quota exceeded/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    const fallback = screen.getByRole('button', { name: /use section headings/i })

    ;(generateStream as ReturnType<typeof vi.fn>).mockClear()
    await userEvent.click(fallback)
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(generateStream).not.toHaveBeenCalled()      // fallback makes no AI call
    const [, , , content] = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(content).toBe((slideContentFromChapters as ReturnType<typeof vi.fn>).mock.results[0].value)
  })

  it('retry re-runs the structuring call', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(slideJson)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/screens/Export.test.tsx`
Expected: FAIL — no `radio` role elements (theme picker missing); missing flow behavior.

- [ ] **Step 3: Write the implementation**

Rewrite `web/src/screens/Export.tsx`:

```tsx
import { useState } from 'react'
import { useAppStore, useProject, useChapters, useSettings } from '../state/store'
import { generateStream } from '../api'
import { systemPrompt, defenseQuestionsPrompt, slidesPrompt } from '../prompts'
import { trackFor } from '../ai/tracks'
import { parseSlides } from '../ai/parseSlides'
import type { SlideContent } from '../ai/parseSlides'
import { buildDocx } from '../export/docx'
import { buildPptx, slideContentFromChapters } from '../export/pptx'
import { THEME_OPTIONS } from '../export/themes'
import { downloadBlob } from '../export/download'

function slug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fyp-project'
}

export function Export() {
  const project = useProject()
  const chapters = useChapters()
  const settings = useSettings()
  const abstract = useAppStore((s) => s.abstract)
  const references = useAppStore((s) => s.references)
  const slideTheme = useAppStore((s) => s.slideTheme)
  const setSlideTheme = useAppStore((s) => s.setSlideTheme)
  const [defenseQa, setDefenseQa] = useState('')
  const [slideContent, setSlideContent] = useState<SlideContent | null>(null)
  const [busy, setBusy] = useState('')
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [pptxFailed, setPptxFailed] = useState(false)

  async function docx() {
    setBusy('docx')
    setError('')
    try {
      downloadBlob(await buildDocx(project, chapters, abstract, references), `${slug(project.topic)}.docx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  async function ensureDefenseQa(): Promise<string> {
    if (defenseQa) return defenseQa
    setPhase('Generating defense Q&A…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const qa = await generateStream(
      settings, systemPrompt(track), defenseQuestionsPrompt(project, chapters), () => {}
    )
    setDefenseQa(qa)
    return qa
  }

  async function ensureSlideContent(): Promise<SlideContent> {
    if (slideContent) return slideContent
    setPhase('Structuring slide content with AI…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const raw = await generateStream(settings, systemPrompt(track), slidesPrompt(project, chapters), () => {})
    const content = parseSlides(raw)
    setSlideContent(content)
    return content
  }

  async function pptx() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const qa = await ensureDefenseQa()
      const content = await ensureSlideContent()
      setPhase('Building slides…')
      downloadBlob(
        await buildPptx(project, chapters, qa, content, slideTheme),
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

  async function pptxFallback() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const content = slideContentFromChapters(chapters)
      setSlideContent(content)
      downloadBlob(
        await buildPptx(project, chapters, defenseQa, content, slideTheme),
        `${slug(project.topic)}-defense.pptx`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slide generation failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }

  const done = chapters.filter((c) => c.text).length
  return (
    <main className="container">
      <h1>Export</h1>
      <p className="lede">
        {done} of {chapters.length} chapters have content. Verify every reference before you
        submit — they are AI-generated.
      </p>
      <div className="export-actions">
        <div className="download-card">
          <span className="fmt">Word document</span>
          <span className="desc">
            Full report — title page, abstract, all chapters, references. Times New Roman 12,
            double-spaced, justified.
          </span>
          <button className="primary" disabled={done === 0 || busy !== ''} onClick={() => void docx()}>
            {busy === 'docx' ? 'Building…' : 'Download DOCX'}
          </button>
        </div>
        <div className="download-card">
          <span className="fmt">Defense slides</span>
          <span className="desc">
            Themed PowerPoint deck for your defense, with a Q&A prep appendix generated from your
            project.
          </span>
          <div className="theme-picker" role="radiogroup" aria-label="Slide theme">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={slideTheme === t.id}
                className={`theme-opt${slideTheme === t.id ? ' on' : ''}`}
                onClick={() => setSlideTheme(t.id)}
              >
                <span className="tswatch">
                  <span style={{ background: t.preview.primary }} />
                  <span style={{ background: t.preview.accent }} />
                </span>
                <span className="tname">{t.name}</span>
              </button>
            ))}
          </div>
          <button className="secondary" disabled={done === 0 || busy !== ''} onClick={() => void pptx()}>
            {busy === 'pptx' ? phase || 'Generating slides…' : 'Download PPTX'}
          </button>
          {pptxFailed && (
            <span className="fallback-row">
              <button className="link" disabled={busy !== ''} onClick={() => void pptx()}>
                Try again
              </button>
              <button className="link" disabled={busy !== ''} onClick={() => void pptxFallback()}>
                Use section headings instead
              </button>
            </span>
          )}
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {defenseQa && (
        <details>
          <summary>Defense Q&amp;A prep</summary>
          <pre className="qa">{defenseQa}</pre>
        </details>
      )}
      <p className="note" style={{ marginTop: '2.5rem' }}>
        Starting a new project?{' '}
        <button className="link" onClick={() => useAppStore.getState().reset()}>
          Reset everything
        </button>{' '}
        — your API key stays.
      </p>
    </main>
  )
}
```

Append to `web/src/styles.css` (matches the existing paper-toned idiom — calm borders, `--line-strong`, `--radius`):

```css
/* ---------- export: slide theme picker ---------- */

.theme-picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.45rem;
  margin: 0.5rem 0 0.75rem;
}

@media (max-width: 520px) {
  .theme-picker { grid-template-columns: repeat(2, 1fr); }
}

.theme-opt {
  display: grid;
  gap: 0.3rem;
  padding: 0.35rem;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  cursor: pointer;
  font-family: inherit;
}

.theme-opt.on { border-color: var(--green); }

.tswatch {
  display: flex;
  height: 34px;
  border-radius: 5px;
  overflow: hidden;
}

.tswatch span:first-child { flex: 2; }
.tswatch span:last-child { flex: 1; }

.tname {
  font-size: 0.72rem;
  color: var(--muted);
  text-align: center;
}

.theme-opt.on .tname { color: var(--green-ink); }

.fallback-row { display: flex; gap: 1rem; margin-top: 0.4rem; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/screens/Export.test.tsx`
Expected: PASS (existing DOCX test + 5 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/Export.tsx web/src/screens/Export.test.tsx web/src/styles.css
git commit -m "feat: export screen — theme picker, AI slide structuring, retry + fallback"
```

---

### Task 6: Cleanup + full verification

**Files:**
- Delete: `web/src/export/__repro__/` (DOCX numbering/TOC debugging scratch — the fixes it probed landed in commits `e5e5c63` and `3ac19e3`)

**Interfaces:** none — housekeeping.

- [ ] **Step 1: Delete the scratch test**

```bash
git rm -r web/src/export/__repro__/
```

- [ ] **Step 2: Run both full suites**

Run: `cd web && npx vitest run`
Expected: PASS — all files, zero failures.

Run (repo root): `npx vitest run`
Expected: PASS — 42 server/shared tests, zero failures.

- [ ] **Step 3: Build the web bundle (type-check gate)**

Run: `cd web && npm run build`
Expected: completes with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove docx __repro__ scratch after defense-slides feature"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** slides prompt+condense (Task 1), parseSlides + defaults + throw (Task 2), themes + store field (Task 3), themed deck + footers + skip-empty + fallback extractor (Task 4), Export UX: picker/flow/retry/fallback + CSS (Task 5), `__repro__` deletion + prototype committed (committed with the spec; Task 6). Filename slug rule already existed in Export.tsx and is kept.
- **Type consistency:** `SlideContent`/`MethodStep` defined in Task 2, consumed identically in Tasks 4–5; `ThemeId`/`SlideTheme`/`THEMES`/`THEME_OPTIONS` defined in Task 3, consumed in Tasks 4–5; `buildPptx(project, chapters, defenseQa, content, theme)` arity is identical in Task 4's definition, Task 4's Export wiring, and Task 5's rewrite.
- **Placeholders:** none — every step carries full code or an exact command.
- **Known judgment calls (documented, not placeholders):** (1) themes live in a dependency-free `themes.ts` rather than `pptx.ts` (spec said pptx.ts) so the store can import `ThemeId` without loading pptxgenjs; (2) `parseSlides` requires at least one usable field per candidate (mirrors `parseOutline`'s `chapters?.length` guard) — the spec's "throws only when no candidate parses" is honored in spirit for all realistic responses; (3) the navy-accent assertion on slide 2 may need the documented single-line drop if the outline numbers don't carry the accent color in XML.

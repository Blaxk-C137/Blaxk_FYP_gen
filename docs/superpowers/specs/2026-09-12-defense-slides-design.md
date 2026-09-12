# Themed Defense Slides — Design

**Date:** 2026-09-12
**Status:** Approved
**Scope:** Replace the plain PPTX export with the themed 9-slide defense deck prototyped in `docs/test run/PPTgen.html`, driven by AI-structured content from the generated chapters. Q&A prep appendix slides are kept.

## Problem

The current `web/src/export/pptx.ts` produces an unthemed deck whose content slides are just lists of chapter section headings:

- No visual identity — default white slides, no title slide design, no footers or page numbers.
- No real content — a "Methodology" slide that says "Research Design; Data Collection" tells the panel nothing.
- The Q&A appendix (the one strong part) is bolted onto a deck nobody would present.

A standalone prototype (`docs/test run/PPTgen.html`) was built and manually tested to validate the fix: a themed 9-slide defense deck with AI-structured bullet content (max 12 words per bullet), 2×2 methodology grid, footers with project title + page numbers, and 4 selectable color themes. This spec ports that prototype into fypgen, sourcing content from the project's generated chapters instead of a hand-filled form.

## Decision summary

- **AI-structured content, one call:** a single non-streamed AI call (via the existing `/api/generate`) returns the strict slide-content JSON; tolerant parsing with per-field defaults, exactly the pattern proven by outline generation (`parseOutline`).
- **Theme as data:** the 4 prototype themes are a plain record; the deck builder is theme-parameterized and deterministic.
- **Never a dead end:** if the structuring call fails or returns unparseable content, the Export screen offers Retry plus a deterministic fallback (section-headings deck) that still uses the themed layout.
- **Q&A appendix kept:** existing defense-Q&A flow and `parseQaSlides` stay; appendix slides are restyled to match the chosen theme and appended after slide 9.
- **Deterministic rendering:** the AI decides *content only*. Slide layout, colors, and ordering are composed in code — same principle as the DOCX export guardrails (never delegate formatting to the model).

## Content pipeline

### `slidesPrompt(project, chapters)` — `web/src/prompts.ts`

Sends project info plus a *condensed* view of the chapters — every section heading with the first ~200 words of its body text, not the full 20,000-word document (keeps the prompt within cheap-model context and forces brevity). Demands ONLY a JSON object (fenced `json` block) in this exact shape, all fields required:

```json
{
  "outline": ["Background & Problem Statement", "…", "Conclusion & Recommendations"],
  "bg": ["…", "…", "…", "…"],
  "prob": ["…", "…", "…"],
  "gen_obj": "To develop/design/implement… (one concise sentence)",
  "spec_obj": ["…", "…", "…", "…", "…"],
  "scope_pts": ["…", "…", "…"],
  "sig_pts": ["…", "…", "…", "…"],
  "method": [
    { "title": "Research Design", "detail": "one brief line" },
    { "title": "Data Collection & Annotation", "detail": "one brief line" },
    { "title": "Model / System Development", "detail": "one brief line" },
    { "title": "Testing & Evaluation", "detail": "one brief line" }
  ],
  "findings": ["…", "…", "…", "…"],
  "discuss": ["…", "…", "…"],
  "conc_pts": ["…", "…", "…"],
  "recs": ["…", "…", "…", "…"]
}
```

Constraints carried in the prompt: max 12 words per bullet; `outline` is the 6 content-slide titles in order; academic Nigerian university tone; content must come from the supplied chapters, not invented; where a chapter is thin, condense honestly rather than fabricate metrics (consistent with the chapter-guardrails placeholder policy — no invented accuracy figures).

### `parseSlides(raw)` — `web/src/ai/parseSlides.ts`

Tolerant parser, same candidate strategy as `parseOutline`:

1. First fenced `json` block, else first `{`…last `}` brace slice, else raw.
2. Validates each array field; missing or empty fields fall back to per-field defaults (empty arrays / empty strings), never to a thrown error.
3. Throws `Error('Model did not return valid JSON')` only when no candidate parses as JSON at all.

Exported `SlideContent` interface matches the JSON shape; `method` defaults to a 4-step generic pipeline when absent.

## Theme system + deck builder

### Themes — `web/src/export/pptx.ts`

```ts
export type ThemeId = 'navy' | 'night' | 'forest' | 'slate'
export interface SlideTheme { sbg, acc, stxt, ssub, cbg, tc, bc, sec, ft, sf, sx, dt: string }
export const THEMES: Record<ThemeId, SlideTheme>
export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary, accent } }[]
```

Four themes, colors 1:1 from the prototype:

| id | name | slide bg | title-slide bg | accent |
|---|---|---|---|---|
| `navy` | Navy & Gold | white | `0A2342` | `C9A227` |
| `night` | Midnight Red | white | `1a1a2e` | `e94560` |
| `forest` | Forest Green | white | `1B4332` | `52B788` |
| `slate` | Slate & Sky | white | `1e293b` | `38bdf8` |

### `buildPptx(project, chapters, defenseQa, content, theme)` 

Signature change is app-internal (only Export.tsx calls it). Renders the prototype's deck exactly:

- **16:9 layout**, Calibri, margins M=0.5, footer on every content slide (including appendix): project title (left, 7.5pt) + `n/total` page number (right), where `total` = 9 + appendix slide count (so the footer stays truthful when Q&A slides are present).
- **Slide 1 — Title** (accent-dark `sbg`): university uppercase + department, topic 30pt bold, student · matric · level in accent, supervisor · session, "Final Year Project Defense".
- **Slide 2 — Outline**: numbered content-slide titles from `content.outline`.
- **Slide 3 — Background & Problem**: two headed groups (`Background of the Study`, `Statement of the Problem`), bold non-bulleted heads, bulleted points.
- **Slide 4 — Objectives**: `General Objective` head + sentence, then `Specific Objectives` head + bullets.
- **Slide 5 — Scope & Significance**: two headed groups.
- **Slide 6 — Methodology**: 2×2 grid of numbered steps — accent square with step number, bold title, detail text.
- **Slide 7 — Results & Analysis**: `Key Findings` + `Discussion of Findings` groups.
- **Slide 8 — Conclusion & Recommendations**: `Conclusion` + `Recommendations` groups.
- **Slide 9 — Thank You** (dark `sbg`): 52pt heading, invitation line, student · department · university.
- **Slides 10+ — Q&A appendix**: one slide per chapter block from the existing `parseQaSlides(defenseQa)`, rendered as a standard content slide in the chosen theme, headed `Q&A Prep — Chapter N — TITLE`.
- A slide group is skipped when its content arrays are all empty (e.g. no defense Q&A generated), rather than rendering an empty slide.

### Deterministic fallback — `slideContentFromChapters(chapters)` (in `pptx.ts`)

Maps chapter sections to `SlideContent` mechanically (objectives sections → `gen_obj`/`spec_obj`, method sections → `method` steps, etc.; unmatched groups left empty). Used when the AI structuring call fails so the fallback deck still gets the themed layout.

## Export screen

`web/src/screens/Export.tsx` changes:

- **Theme picker** above the PPTX button: 4 swatch cards (two-tone preview + name, like the prototype), selected card highlighted; choice persisted via a `slideTheme: ThemeId` field on the app store (default `navy`).
- **PPTX button flow** (status line, no blocking modal): `Structuring slide content with AI…` → `Building slides…` → download via existing `downloadBlob`. Filename: `<slugified topic>-defense.pptx` (prototype's slugify rules).
- **Failure handling:** status shows the error with two actions — *Retry* (re-runs the AI call) and *Use section headings instead* (builds via `slideContentFromChapters`). The DOCX button is unaffected.
- The structuring call uses the non-streaming `generateStream` (no `onChunk` updates needed; one status line suffices).

## Error handling

- AI call network/provider failure → ApiError surfaced in the status line; Retry + fallback offered.
- JSON parse failure → same treatment (parse errors are user-retryable; model nondeterminism).
- Partial JSON (some fields empty) → no error; `parseSlides` defaults fill gaps, deck renders with the groups it has.
- Empty `defenseQa` → no appendix slides; core 9 still produced.

## Testing

TDD, existing patterns (`npx vitest run` from `web/`, jsdom for export tests, JSZip inspection):

- `web/src/prompts.test.ts` — `slidesPrompt` carries project fields, chapter content, the exact JSON shape, and the 12-word bullet constraint.
- `web/src/ai/parseSlides.test.ts` — clean JSON; fenced block with prose; partial fields default; non-JSON garbage throws.
- `web/src/export/pptx.test.ts` (rewrite) — unzip result: ≥9 slides; slide1 contains topic + university; theme accent color appears in slide1 XML (per-theme case); methodology grid slide contains step numbers/titles; content slide contains the footer page number `2/` followed by the exact total for that case; appendix slide contains a Q&A question; empty defenseQa → exactly 9 slides; `slideContentFromChapters` maps objectives/method sections.
- `web/src/screens/Export.test.tsx` — theme picker click updates store and selection; PPTX click with mocked `generateStream` + `buildPptx` downloads once with `.pptx` filename; AI failure shows Retry + fallback, fallback path still downloads.

## File inventory

- Create: `web/src/ai/parseSlides.ts`, `web/src/ai/parseSlides.test.ts`
- Modify: `web/src/prompts.ts` (+`slidesPrompt`), `web/src/prompts.test.ts`, `web/src/export/pptx.ts` (rewrite), `web/src/export/pptx.test.ts` (rewrite), `web/src/screens/Export.tsx`, `web/src/screens/Export.test.tsx`, `web/src/state/store.ts` (+`slideTheme`), `web/src/state/store.test.ts`
- Delete: `web/src/export/__repro__/` (DOCX debugging scratch — served its purpose)
- Commit the prototype `docs/test run/PPTgen.html` as reference documentation

## Non-goals (v1)

- No streaming per-slide progress chips, no in-app slide preview, no custom theme editor, no separate Q&A deck download, no image/chart slides.

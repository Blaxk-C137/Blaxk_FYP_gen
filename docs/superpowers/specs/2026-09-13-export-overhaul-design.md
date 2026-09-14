# Export Overhaul — Citations, Images, and Deck Rebuild

**Date:** 2026-09-13
**Status:** approved design (brainstorming complete)

**Goal:** Fix the DOCX export's continuous list numbering, blank TOC, and missing images; replace LLM-formatted references with a verified citation pipeline (Citation.js + Crossref + citeproc); rebuild the PPTX export on the methodology of the reference deck (`docs/test run/Design_and_Performance_Evaluation_of_a_Sub_6_Ghz_MIMO_Antenna_for_5g_Applications_Defense_Slides.pptx`); add Gemini image generation and a university-logo scraper; make every user-action placeholder red and bold.

**Reference deck anatomy** (dissected from the example):
- 13.33×7.5" canvas, Arial; title 32pt bold; body 24pt; page number 10pt white
- White content backgrounds; two full-width footer strips (0.04" light-green 9CC85D over 0.32" green 548C2F); page number right-aligned on the thick strip
- 21 slides: title, background, problem, aim/objectives, scope, significance, literature review, methodology ×2, system design ×2, implementation ×2, results, discussion, references ×5, thank-you
- "(continued)" slides absorb overflow — content never bleeds off the page
- Speaker notes on every slide (full spoken script)
- Green lead-in labels inside body text (e.g. "Aim:" in 548C2F)
- One image on the title slide (1×1" university logo at 0.8, 0.65)

## Non-goals

- No changes to chapter generation, guardrails (beyond citation extraction), or store persistence beyond the references field type.
- No new themes beyond the existing four (re-skinned, one renamed/defaulted to the example's green).
- Charts in DOCX stay canvas-rendered; no chart changes.
- No PDF export.

## Architecture

```
┌─ Server (Hono, Node) ────────────────────────────────────────┐
│  POST /api/generate-image   Gemini image gen → { base64 }    │
│  GET  /api/logo?university=  website scraper → { base64 }    │
│  POST /api/citations        parse + verify + format          │
│         citation-js  ·  Crossref API  ·  citeproc (APA 7)    │
└──────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─ DOCX export ─┐   ┌─ Citation pipeline ─┐   ┌─ PPTX export ─┐
│ numbering fix │   │ extract in-text     │   │ example-style │
│ Gemini        │◄──┤ citations → AI full │──►│ 20-slide deck │
│ figures w/    │   │ entries → Crossref  │   │ notes, refs,  │
│ captions      │   │ verify → APA format │   │ images, logo  │
└───────────────┘   └─────────────────────┘   └───────────────┘
```

**Error philosophy:** every network enrichment (image, logo, citation resolution) degrades gracefully — placeholder text, no logo, flagged reference. An export never fails because an optional enrichment failed.

## 1. Server infrastructure

### `POST /api/generate-image`

- Body: `{ provider, apiKey, prompt }` — same settings shape as `/api/generate`.
- `generateImage(req)` implemented in `server/providers/gemini.ts` (the optional slot in `types.ts` already declares it): POST `${BASE}/gemini-2.5-flash-image:generateContent` with `x-goog-api-key`, `generationConfig: { responseModalities: ["IMAGE"] }`; extracts `inlineData.data` (base64 PNG) from the first candidate. 60s timeout.
- Providers without `generateImage` → route returns 501 `{ error: '<provider> does not support image generation' }`; the client skips images.
- Route test: mocked global fetch → asserts request shape and base64 passthrough.

### `GET /api/logo?university=<name>`

- Resolution chain: DuckDuckGo HTML search (`https://html.duckduckgo.com/html/?q=<name>`) → first result on a university-looking domain → fetch homepage → scrape in priority order `apple-touch-icon` → `og:image` → `<link rel="icon">` → `/favicon.ico` → download → `{ logo: { base64, mime }, source }`.
- PNG/JPEG only (SVG cannot embed in PPTX/DOCX); anything else → `{ logo: null }`.
- In-memory cache keyed by normalized university name.
- Hard 10s overall timeout; all failures → `{ logo: null }` (200, not an error).
- Route test: mocked fetch chain (search → page → icon) + SVG rejection + timeout path.

### `POST /api/citations`

- Body: `{ citations: string[] }` — full APA entries from the AI step.
- Per entry: `citation-js` parses to CSL-JSON → Crossref query (`https://api.crossref.org/works?query.bibliographic=<title>&mailto=<app contact>`) → a result whose normalized title similarity ≥ 0.85 counts as verified, adopting the authoritative metadata; else `verified: false`.
- Response: `{ results: [{ input, apa, verified, doi? }] }` — `apa` is citeproc's formatted APA output either way (Citation.js bundles citeproc; load the APA 7 CSL style).
- Entries that fail parsing entirely → `{ input, apa: input, verified: false }`.
- Route test: mocked Crossref (match and no-match), parse failure path.

All routes follow the existing `server/routes.ts` patterns: body validation, provider registry lookup, network-error classification via `net.ts`, same error envelope as `/api/generate`.

## 2. Citation pipeline (reference generation model)

**Extraction** — new pure function `extractCitations(text: string): string[]` in `web/src/ai/`:
- Matches APA parenthetical `(Author, 2020; Author & Author, 2021)` and narrative `Author (2020)` forms.
- Canonicalizes to `First-author et al., year` / `Author & Author, year` keys; deduplicated, order of first appearance.
- Wired into the finalize step of `useChapterGeneration` (Layer 2), storing keys per chapter in the store.

**Full-entry generation** — new `referencesPrompt(project, citationKeys)` in `prompts.ts`:
- One non-streamed AI call (after chapters complete, on first export): given the keys, return one full APA 7 entry per key, from the model's knowledge, with the citation-integrity rule (no invented DOIs; unknown → omit the DOI).
- Strict fenced-JSON response parsed by a tolerant parser in the established `parseOutline`/`parseSlides` pattern, with per-field defaults and a hard error only when nothing usable returns.

**Verification + formatting:**
- Entries → `POST /api/citations` → `{ apa, verified, doi? }` per entry.
- Store: `references: string[]` becomes `references: ReferenceEntry[]` where `ReferenceEntry = { apa: string; verified: boolean; doi?: string }` (persisted; migration: existing string entries import as `{ apa, verified: false }`).

**Trigger point:** the Export screen. First export of either format resolves unresolved references once, caches in the store. Retry + partial-failure handling mirrors the existing slides flow. Concurrent exports share one in-flight promise.

**UI:** the Review screen's references panel and the export preview show verified (calm check) / unverified (`[VERIFY]` red bold) badges, styled per `styles.css` paper-toned idioms.

**DOCX/PPTX rendering:** references sections render from `ReferenceEntry[]` — alphabetized by `apa`, unverified entries prefixed `[VERIFY] `.

## 3. DOCX export

### Numbering restart per list

- Root cause: every ordered list shares the single `fyp-ordered` numbering reference, so Word continues one list through the document.
- Fix: `buildDocx` assigns each ordered list its own instance — `fyp-ordered-1`, `fyp-ordered-2`, … — each with its own entry in the Document numbering config. Every list restarts at 1.
- Test: two ordered lists in different chapters → unzip → assert distinct `numId`s and each starts at 1.

### Figures become real images

- The `figure` block kind (architecture/flow descriptions the chapter prompt already emits, ≤1 per chapter) calls `/api/generate-image` with the block's description as prompt.
- Flow: collect all figure blocks → generate in parallel (max 3 concurrent, 30s timeout each) → success: centered `ImageRun` (~5.5" wide) + existing `Figure N.M` caption → failure/timeout/no capability: existing `[INSERT FIGURE HERE]` placeholder survives.
- `buildDocx` gains an options object `{ images?: (prompt: string) => Promise<string | null> }` — injected by the Export screen, defaulting to "no images," so tests stay network-free.

### TOC actually generates

- Root cause: `TableOfContents` emits a field with no cached result; viewers that don't run field updates (LibreOffice, Google Docs, preview panes, or clicking "No" in Word) render blank.
- Fix, three parts:
  1. **Page estimator** (pure, unit-tested): walk document blocks — double-spaced 12pt TNR ≈ 27 lines/page (~270 words); figure/chart ≈ 3"; table by rows; `pageBreakBefore` resets — producing each H1/H2's start page in body-Arabic numbering.
  2. **Cached field injection:** after `Packer.toBlob`, post-process the zip (JSZip, added to web deps): locate the TOC field in `word/document.xml`, insert cached entry paragraphs (heading text, dotted tab leader, right-aligned page number) between the field's `separate` and `end` markers — exactly how Word caches a TOC.
  3. **Live field kept:** `updateFields: true` stays; Word still offers to refresh to exact numbers.
- Tests: TOC field instruction intact + cached entries present with estimated numbers; estimator math pinned on known-length content.

### Attention styling (red bold placeholders)

- A deterministic scanner marks bracketed action placeholders — `[INSERT FIGURE HERE]`, `[INSERT CHART HERE — …]`, `[INSERT VERIFIED CITATION HERE]`, `[VERIFY]` — styling **only the bracketed span** red bold (C00000), never the surrounding paragraph. The "AI-generated references — verify before submission" label is styled the same way.
- Applied at run-construction time in `markdown.ts` inline parsing (splits runs at placeholder boundaries) and in the references/figure placeholder emitters.
- Same treatment on PPTX references slides (`[VERIFY]` red bold).
- Tests: placeholder mid-sentence, multiple per paragraph, none present.

**Unchanged:** title page, two-section roman/Arabic page numbering, page-break pinning, charts.

## 4. PPTX rebuild

### Layout system

- Custom pptxgenjs layout: 13.33×7.5". Arial. Title 32pt bold (dark theme color); body 24pt; page number 10pt white. White content backgrounds.
- Footer strips on every slide (the reference deck carries strips on the title slide too — verified in its slide-1 OOXML): 0.04" light-accent rect over 0.32" main-accent rect, full width, at the bottom; page number right-aligned on the thick strip. Truthful `n/total` counting continued + references slides.
- Green lead-in labels: runs like "Aim:" / "Background:" in accent color, bold, inline before body text.

### Slide structure (follows the example)

1. Title — scraped logo (1×1" at 0.8, 0.65), university, department, topic, student/matric/degree line, supervisor/session line, "Final Year Project Defense"
2. Introduction / Background
3. Problem Statement
4. Aim and Objectives
5. Scope of the Study
6. Significance of the Study
7. Literature Review
8. Methodology *(+ continued)*
9. System Design / Architecture *(+ continued)*
10. Implementation / Tools & Technologies *(+ continued)*
11. Results / Findings
12. Discussion of Results
13. Conclusion & Recommendations *(deliberate addition — defense panels expect it)*
14. References *(auto-split, ~5 entries/slide)*
15. Thank You

### No-bleed guarantee — deterministic auto-split

- The builder computes a line budget per slide: 24pt Arial across ~11.7" ≈ 88 chars/line; body area ≈ 5.2" ≈ 12 lines.
- Content exceeding the budget splits at a bullet boundary onto "`Title (continued)`" slides — pure code, never an AI decision.
- Tests pin the math: N bullets of known length → exactly K slides; no text box exceeds its declared height budget.

### Speaker notes

- `slidesPrompt` schema grows `notes: Record<slideKey, string>` — 60–100 word spoken script per content slide.
- Builder attaches via `slide.addNotes()`. Missing field → no notes; deck still builds.

### Images

- Schema grows `images: [{ slide, prompt }]` — at most 3, suggested for System Design / Methodology / Results.
- Export flow generates via Gemini in parallel; each embeds right-side (~4.5" wide) with bullets flowing in the remaining width. Failure → text-only, full width.
- Title-slide logo from `/api/logo`; failure → clean text-only title.

### Themes

- `THEMES` re-tokened: `accent` (main strip + lead-in labels), `accentLight` (thin strip), `title` (dark heading), `body` (body text), plus existing title-slide tokens.
- The example's exact green (2F3D32 / 548C2F / 9CC85D) becomes the **default** theme; the other three re-skinned to the same token structure. Theme picker stays; `slideTheme` default changes to the green theme.

### Export flow (Export screen)

PPTX click → defense Q&A (existing) → slide-content AI call (new schema) → parallel [logo + slide images + reference verification] → build. Progress phases in the button label; Retry + section-headings fallback preserved; `slideContentFromChapters` fallback updated to the new schema.

## 5. Dependencies

- `citation-js` (server) — parsing, Crossref, citeproc APA 7.
- `jszip` (web, prod) — DOCX post-processing for TOC injection (already a dev dep for tests; promoted).
- No other new dependencies. Image generation and logo scraping use platform `fetch`.

## 6. Testing strategy

- **Unit (web):** citation extraction edge cases; references parser defaults; page estimator; auto-split math; attention-span splitting; theme tokens; new SlideContent schema mapping.
- **Route (server):** `/api/generate-image`, `/api/logo`, `/api/citations` — all external fetches mocked; timeout and failure paths pinned.
- **Structural (web, JSZip):** DOCX numbering `numId` restart; TOC cached entries; figure ImageRun presence; PPTX slide count/footers/notes/theme colors/no-bleed budgets.
- **Flow (web, jsdom):** Export screen — citation resolution trigger + caching, image failure fallbacks, retry/fallback paths.
- Full suites (`web/` + root) green; `npm run build` type-check gate.

## 7. Implementation phases

1. **Server infra:** generate-image + logo + citations routes (with tests).
2. **Citation pipeline:** extraction, referencesPrompt + parser, store migration, Review/export UI.
3. **DOCX:** numbering restart, figures via images, TOC caching, attention styling.
4. **PPTX:** layout system, expanded schema + prompt, auto-split, notes, references slides, images + logo, theme re-skin, export flow.

Each phase lands as its own commit series (TDD, failing test first), on a worktree branch.

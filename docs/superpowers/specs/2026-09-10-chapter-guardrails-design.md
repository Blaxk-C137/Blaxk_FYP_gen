# Chapter Guardrails — Design

**Date:** 2026-09-10 (revised same day — unified with external model suggestions)
**Status:** Approved (Approach A — client-side guardrails + export-time composition)
**Scope:** v1 is structural rules, citation/results integrity steering, and deterministic export formatting. Real-project few-shot examples are deferred to v2.

## Problem

Generated documents violate the Nigerian FYP structural and academic contract in five observed ways:

1. **References inside chapter bodies** — the model writes a full `REFERENCES` list inside Chapter 2 instead of citing in-text and leaving the list for the document end.
2. **Wrong section numbering** — Chapter 3 contains sections numbered 4.1–7.3; numbers must follow the chapter (3.1, 3.2, …).
3. **Inconsistent formatting** — missing `CHAPTER N` headers, drifting heading casing/spacing, duplicated heading titles.
4. **No page numbering** — the exported DOCX has no page numbers at all; Nigerian format requires roman numerals for preliminary pages and Arabic numerals from Chapter One.
5. **Fake table of contents** — the export lists chapter titles as plain bold lines with no page numbers and no section-level entries.

Plus one academic-integrity gap observed in both external reviews:

6. **Fabricated sources and results** — the model invents references (authors, years, DOIs) and experimental metrics (accuracy, F1, confusion matrices) that the student cannot defend at viva.

## Decision summary

- **Steer + enforce:** rules go into the prompts (reduce violations) AND output is validated/fixed after generation (catch what slips through) AND export formatting is composed deterministically in code (never delegated to the model).
- **Auto-fix first, regenerate as fallback:** mechanical violations are fixed deterministically; content violations trigger at most one regeneration with the violations fed back to the model.
- **Client-side:** generation guardrails live in the web app as pure functions. The server remains a thin proxy (it holds no document state).
- **Truth over polish** (from both external suggestions): a truthful incomplete document is preferable to a complete-looking fabricated one. Applies to citations and results via the placeholder policies below.
- **Chapter 4 results:** the model writes the full results narrative, tables, and analysis structure, but every empirical value is a visible placeholder (`[INSERT ACTUAL ACCURACY]`) for the student to fill from real experiments.

## Unified guardrail policy (three enforcement layers)

Distilled from the internal design plus the Gemini and ChatGPT suggestions. The bulk of the ChatGPT "Academic Research Integrity Agent" config describes a *review* agent; fypgen is a *generator*, so its review-time machinery (evidence levels, contradiction protocol, taxonomy integrity, change control, viva checks, submission-readiness statuses) is deferred to a possible v2 review pass. What survives the filter:

### Layer 1 — Prompt steering (`web/src/prompts.ts`)

| Rule | Source |
|---|---|
| Structural contract per chapter: sections numbered `{N}.1, {N}.2, …`; begin with `CHAPTER <WORD>`; no references list in the body; cite in-text APA 7 only | internal |
| **Citation integrity:** cite only genuinely well-known real works; never invent authors, years, journals, page numbers, DOIs, or URLs; when unsure, write `[INSERT VERIFIED CITATION HERE]` instead of a plausible-looking fake | Gemini §1, ChatGPT `reference_integrity` |
| **Results integrity (Chapter 4):** write the results narrative, tables and analysis with placeholder values (`[INSERT ACTUAL ACCURACY]`, `[INSERT N]`); never present invented metrics as findings | ChatGPT `research_results_integrity` |
| No duplicated or repeated heading titles within a chapter | Gemini §3 |
| Formal, objective, technical register; no dramatic or sensational language; no LaTeX/HTML — plain text with plain headings (equations in plain text) | internal + Gemini §2,§4 |
| The model never writes a table of contents, title page, or preliminary pages — the app composes those | internal |

### Layer 2 — Post-generation mechanical fixes (`web/src/ai/guardrails.ts`, new)

Pure functions, no side effects, no I/O.

```ts
interface ChapterFix {
  text: string            // repaired chapter text
  references: string[]    // reference entries extracted from the body
  violations: Violation[] // what was wrong and what was done
}
interface Violation {
  rule: 'section-numbering' | 'references-in-body' | 'heading-format' | 'duplicate-heading'
  fixed: boolean          // true = repaired mechanically, false = needs attention
  detail: string          // human-readable, also fed back to the model on regen
}

function fixChapterText(chapterNumber: number, text: string): ChapterFix
function seriousViolations(violations: Violation[]): Violation[]  // unfixed + content-level
```

Rules:

- **Renumbering:** heading lines matching `^(\d+)(\.\d+)*\s` whose leading number ≠ chapter number are renumbered sequentially in order of appearance (`4.1`, `7.3` in chapter 3 → `3.1`, `3.2`). A chapter with correct numbering is returned byte-identical.
- **Reference extraction:** a `REFERENCES` (case-insensitive, optional trailing colon) heading inside chapter text ends the narrative; everything after it that looks like reference entries is stripped and returned in `references`. In-text `(Author, Year)` citations are untouched.
- **Heading normalization:** ensure the text opens with a `CHAPTER <WORD>` line; normalize section-heading casing and spacing; collapse consecutive duplicate heading lines to one.
- Guardrail functions never throw; unparseable text passes through with a `heading-format` violation flagged unfixed.

### Layer 3 — Deterministic export composition (`web/src/export/docx.ts`, rewritten)

The model never decides document furniture; code composes it from document state:

- **Sections & page numbering:** two Word sections — preliminary pages (title, abstract, TOC) with lowercase roman numerals in the footer; body (chapters + references) with Arabic numerals restarting at 1.
- **Real table of contents:** a Word `TableOfContents` field over Heading 1/2 (chapter + section levels) so Word renders entries with page numbers; chapters and sections must therefore map to real Heading styles (already the case).
- **Chapter page breaks:** every chapter begins on a new page (`pageBreakBefore`).
- **Preliminary pages (v1):** title page (from project metadata), abstract, table of contents. Declaration/Certification/Dedication/Acknowledgements/Lists of Figures/Tables/Abbreviations are v2 — they need per-student content.
- **References:** single aggregated, de-duplicated, alphabetized `REFERENCES` section at the document end, built from the store's `references` (populated by Layer 2 extraction) — replacing the current `lastIndexOf('References')` hack. Retain the "AI-generated — verify before submission" warning label.
- **Typography (unchanged/confirmed):** A4, Times New Roman 12pt, double-spaced body, justified, 1-inch margins.

## Components

### Enforcement wiring — `web/src/screens/Generate.tsx` (modified)

After each chapter's stream completes:

1. `fixChapterText(n, rawText)` — apply mechanical fixes, collect references into the store.
2. If `seriousViolations(...)` is non-empty → **one** regeneration using the existing nudge mechanism, with the violation details in the nudge (e.g. "Your sections were numbered 4.1–7.3; number them 3.1, 3.2, …"). Cap: one retry. "Better" is defined as fewer unfixed violations after re-running `fixChapterText`; on a tie the second attempt wins. Remaining violations are flagged in the UI.
3. Every attempt is visible in the server logs added earlier (`[fypgen] /api/generate: …`).

### References flow — store + `Export.tsx` (modified)

- `store.ts`: new document-level `references: string[]` with a setter; chapters no longer hold reference lists.
- `Export.tsx` / `docx.ts`: consume the store references per Layer 3.

### Sampling parameters — providers (modified, small)

External suggestion (Gemini): lower temperature improves structural compliance. Add an optional `temperature` to the provider stream request, sent by all three adapters, defaulting to **0.5** for chapter generation (low enough for structure, high enough to avoid dead prose). The provider interfaces (`server/providers/types.ts`, `gemini.ts`, `openai.ts`, `anthropic.ts`) gain one optional field each; the route passes it through.

## Data flow

```
Generate.tsx
  → generateStream(system, chapterPrompt(n, contract), temperature=0.5)  # steer
  → fixChapterText(n, raw)                                              # enforce (L2)
      ├─ text → chapter.text (fixed)
      ├─ references → store.references
      └─ seriousViolations?
            ├─ none → done
            └─ some → one regen with nudge=violations → fix again → accept better
Export.tsx
  → docx.ts: title/abstract/TOC section (roman) + body section (Arabic, page breaks)
  → chapters + store.references → document with trailing REFERENCES
```

## Error handling

- Guardrail functions never throw; unparseable text passes through flagged.
- Regen failures (network etc.) surface through the existing error path; the first (fixed) attempt is kept.
- The retry cap prevents quota burn and infinite loops.
- If the store has no references at export time, the references section shows the existing guidance placeholder text.

## Testing

- `web/src/ai/guardrails.test.ts` — table-driven: renumber (incl. the real 4.1–7.3-in-chapter-3 case as a regression fixture), references extraction (block present / absent / mid-chapter / case-insensitive heading), heading normalization, duplicate-heading collapse, clean text returned untouched, garbled text flagged not thrown.
- `web/src/screens/Generate.test.tsx` — mock stream returns a violating chapter; assert one regen fires with a nudge containing the violation detail; assert second attempt is accepted; assert references land in the store.
- `web/src/export/docx.test.ts` — the docx contains two sections with roman/Arabic footers, a `TableOfContents` field, `pageBreakBefore` on chapter headings, and the references section at the end, alphabetized and de-duplicated.
- Provider tests — temperature is sent in each adapter's request body when provided.

## Out of scope (v2)

- Few-shot excerpts from real project reports (pending rights-cleared sample collection).
- Review-agent features from the external suggestions: evidence-level labeling, contradiction detection, taxonomy consistency checks, viva-defensibility checks, submission-readiness scoring.
- Additional preliminary pages (Declaration, Certification, Dedication, Acknowledgements, Lists of Figures/Tables/Abbreviations).
- Department-specific rule profiles (formatting contract explicitly yields to a real departmental guideline when one exists).
- Numbered tables/figures with in-text referencing (needs table extraction from generated text; revisit with few-shot work).

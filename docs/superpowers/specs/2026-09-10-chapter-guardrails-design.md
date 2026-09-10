# Chapter Guardrails — Design

**Date:** 2026-09-10
**Status:** Approved (Approach A — client-side guardrails)
**Scope:** v1 is structural rules only. Real-project few-shot examples are deferred to v2.

## Problem

Generated chapters violate the Nigerian FYP structural contract in three observed ways:

1. **References inside chapter bodies** — the model writes a full `REFERENCES` list inside Chapter 2 instead of citing in-text and leaving the list for the document end.
2. **Wrong section numbering** — Chapter 3 contains sections numbered 4.1–7.3; numbers must follow the chapter (3.1, 3.2, …).
3. **Inconsistent formatting** — missing `CHAPTER N` headers, drifting heading casing/spacing.

These are mechanical, well-known conventions — enforceable in code without any external source material.

## Decision summary

- **Steer + enforce:** rules go into the prompts (reduce violations) AND output is validated/fixed after generation (catch what slips through).
- **Auto-fix first, regenerate as fallback:** mechanical violations are fixed deterministically; content violations trigger at most one regeneration with the violations fed back to the model.
- **Client-side:** all guardrail logic lives in the web app as pure functions. The server remains a thin proxy (it holds no document state).

## Components

### 1. Rulebook — `web/src/ai/guardrails.ts` (new)

Pure functions, no side effects, no I/O.

```ts
interface ChapterFix {
  text: string            // repaired chapter text
  references: string[]    // reference entries extracted from the body
  violations: Violation[] // what was wrong and what was done
}
interface Violation {
  rule: 'section-numbering' | 'references-in-body' | 'heading-format'
  fixed: boolean          // true = repaired mechanically, false = needs attention
  detail: string          // human-readable, also fed back to the model on regen
}

function fixChapterText(chapterNumber: number, text: string): ChapterFix
function seriousViolations(violations: Violation[]): Violation[]  // unfixed + content-level
```

Rules:

- **Renumbering:** heading lines matching `^(\d+)(\.\d+)*\s` whose leading number ≠ chapter number are renumbered sequentially in order of appearance (`4.1`, `7.3` in chapter 3 → `3.1`, `3.2`). A chapter with correct numbering is returned byte-identical.
- **Reference extraction:** a `REFERENCES` (case-insensitive, optional trailing colon) heading inside chapter text ends the narrative; everything after it that looks like reference entries is stripped and returned in `references`. In-text `(Author, Year)` citations are untouched.
- **Heading normalization:** ensure the text opens with a `CHAPTER <WORD>` line; normalize section-heading casing and spacing to the existing plain-heading convention.

### 2. Steering — `web/src/prompts.ts` (modified)

`chapterPrompt` gains an explicit structural contract:

- "Number your sections {N}.1, {N}.2, … matching this chapter number."
- "Do NOT include a references list. Cite in-text (APA 7) only."
- "Begin with the line `CHAPTER <WORD>`."

`systemPrompt` already covers register and word targets; no changes there.

### 3. Enforcement — `web/src/screens/Generate.tsx` (modified)

After each chapter's stream completes:

1. `fixChapterText(n, rawText)` — apply mechanical fixes, collect references into the store.
2. If `seriousViolations(...)` is non-empty → **one** regeneration using the existing nudge mechanism, with the violation details in the nudge (e.g. "Your sections were numbered 4.1–7.3; number them 3.1, 3.2, …"). Cap: one retry. "Better" is defined as fewer unfixed violations after re-running `fixChapterText`; on a tie the second attempt wins. Remaining violations are flagged in the UI.
3. Every attempt is visible in the server logs added earlier (`[fypgen] /api/generate: …`).

### 4. References flow — store + `web/src/screens/Export.tsx` (modified)

- `store.ts`: new document-level `references: string[]` with a setter; chapters no longer hold reference lists.
- `Export.tsx`: appends one aggregated, de-duplicated, alphabetized `REFERENCES` section at the very end of the exported document.

## Data flow

```
Generate.tsx
  → generateStream(system, chapterPrompt(n, contract))     # steer
  → fixChapterText(n, raw)                                  # enforce
      ├─ text → chapter.text (fixed)
      ├─ references → store.references
      └─ seriousViolations?
            ├─ none → done
            └─ some → one regen with nudge=violations → fix again → accept better
Export.tsx
  → chapters + store.references → document with trailing REFERENCES
```

## Error handling

- Guardrail functions never throw; unparseable text passes through with a `heading-format` violation flagged unfixed.
- Regen failures (network etc.) surface through the existing error path; the first (fixed) attempt is kept.
- The retry cap prevents quota burn and infinite loops.

## Testing

- `web/src/ai/guardrails.test.ts` — table-driven: renumber (incl. the real 4.1–7.3-in-chapter-3 case as a regression fixture), references extraction (block present / absent / mid-chapter), heading normalization, clean text returned untouched, garbled text flagged not thrown.
- `web/src/screens/Generate.test.tsx` — mock stream returns a violating chapter; assert one regen fires with a nudge containing the violation detail; assert second attempt is accepted; assert references land in the store.
- `web/src/screens/Export.test.tsx` — references section appears once, at the end, alphabetized and de-duplicated.

## Out of scope (v2)

- Few-shot excerpts from real project reports (pending rights-cleared sample collection).
- Content-level quality checks beyond structure (argument quality, citation accuracy).
- Supervisor/department-specific rule profiles.

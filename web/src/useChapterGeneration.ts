import { useCallback, useState } from 'react'
import { useAppStore } from './state/store'
import type { ReferenceEntry } from './state/store'
import { generateStream } from './api'
import { systemPrompt, chapterPrompt, chapterBudget, LENGTH_PRESETS, questionnairePrompt } from './prompts'
import { trackFor } from './ai/tracks'
import { fixChapterText, seriousViolations } from './ai/guardrails'
import { wordCount } from './ai/wordCount'
import { estimatePages } from './export/tocPages'

/** Target body pages for a preset — what estimatePages is checked against. */
function targetPages(preset: NonNullable<ReturnType<typeof useAppStore.getState>['project']['lengthPreset']>): number {
  return { compact: 35, standard: 50, detailed: 70 }[preset]
}

export function useChapterGeneration() {
  const [busy, setBusy] = useState(false)
  const [continuing, setContinuing] = useState<number | null>(null)

  const streamOnce = useCallback(
    async (number: number, nudge?: string, continuation?: string) => {
      const { settings, project, chapters, referencePool } = useAppStore.getState()
      const chapter = chapters.find((c) => c.number === number)
      if (!chapter) return ''
      const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
      await generateStream(
        settings,
        systemPrompt(track),
        chapterPrompt(project, chapters, chapter, nudge, continuation, referencePool),
        (chunk) => useAppStore.getState().appendChapterText(number, chunk),
        0.5
      )
      return useAppStore.getState().chapters.find((c) => c.number === number)?.text ?? ''
    },
    []
  )

  const finalize = useCallback((number: number, rawText: string) => {
    // Layer 2: mechanical fixes + reference extraction into the store.
    const fixed = fixChapterText(number, rawText)
    useAppStore.getState().updateChapter(number, { text: fixed.text })
    if (fixed.references.length) {
      const { references, setReferences } = useAppStore.getState()
      const seen = new Set(references.map((r) => r.apa))
      const appended: ReferenceEntry[] = []
      for (const r of fixed.references) {
        const apa = r.trim()
        if (!apa || seen.has(apa)) continue
        seen.add(apa)
        appended.push({ key: '', apa, verified: false })
      }
      setReferences([...references, ...appended])
    }
    return fixed
  }, [])

  const generate = useCallback(
    async (number: number, nudge?: string, continuation?: string) => {
      const { project, updateChapter } = useAppStore.getState()
      const chapter = useAppStore.getState().chapters.find((c) => c.number === number)
      if (!chapter) return
      updateChapter(number, { status: 'streaming', ...(continuation ? {} : { text: '' }) })
      setBusy(true)
      try {
        let raw = await streamOnce(number, nudge, continuation)
        let fixed = finalize(number, raw)

        // Length is enforced in estimated PAGES (the estimator counts prose,
        // headings, figures, and tables), not raw words. One regen slot is
        // shared with guardrail violations; a still-overflowing retry earns a
        // final condense pass instead of being accepted as-is.
        const preset = project.lengthPreset ?? 'standard'
        const budget = chapterBudget(preset, number)
        const pages = (generated: string): number => {
          const chapters = useAppStore.getState().chapters
            .map((c) => (c.number === number ? { ...c, text: generated } : c))
          return estimatePages(chapters)
        }
        const target = targetPages(preset)
        const over = (text: string) => pages(text) > target * 1.15
        const serious = seriousViolations(fixed.violations)
        if (!continuation && (over(fixed.text) || serious.length)) {
          const reasons = [
            ...serious.map((v) => v.detail),
            ...(over(fixed.text)
              ? [
                  `The document would exceed the ${LENGTH_PRESETS[preset].label} target. ` +
                    `Rewrite this chapter at about ${budget.toLocaleString()} words: cut padding and repetition, keep every required section.`,
                ]
              : []),
          ]
          updateChapter(number, { status: 'streaming', text: '' })
          const retryRaw = await streamOnce(number, reasons.join(' '))
          const retry = finalize(number, retryRaw)
          // Accept the retry only if it is not worse.
          const score = (f: typeof fixed) =>
            seriousViolations(f.violations).length * 1e6 + Math.abs(wordCount(f.text) - budget)
          if (score(retry) <= score(fixed)) fixed = retry
          // Still over the page budget after the retry → one condense pass.
          if (over(useAppStore.getState().chapters.find((c) => c.number === number)?.text ?? fixed.text)) {
            const current = useAppStore.getState().chapters.find((c) => c.number === number)?.text ?? fixed.text
            const factor = Math.max(0.5, budget / Math.max(1, wordCount(current)))
            updateChapter(number, { status: 'streaming', text: '' })
            const condensedRaw = await streamOnce(
              number,
              `This chapter is ${wordCount(current).toLocaleString()} words — too long for the ${LENGTH_PRESETS[preset].label} page budget. ` +
                `Condense it to about ${budget.toLocaleString()} words (${Math.round(factor * 100)}% of its length): ` +
                'keep every section heading and every key point, remove repetition and padding. Do not add new content.'
            )
            const condensed = finalize(number, condensedRaw)
            if (wordCount(condensed.text) < wordCount(current)) fixed = condensed
          }
        }

        updateChapter(number, { status: 'done' })
        setContinuing(null)
      } catch (err) {
        // partial text is already in the store; keep status 'streaming' so Continue shows
        if (!useAppStore.getState().chapters.find((c) => c.number === number)?.text) {
          updateChapter(number, { status: 'pending' })
        } else {
          setContinuing(number)
        }
        throw err
      } finally {
        setBusy(false)
      }
    },
    [streamOnce, finalize]
  )

  const continueChapter = useCallback(
    async (number: number) => {
      const chapter = useAppStore.getState().chapters.find((c) => c.number === number)
      if (!chapter?.text) return
      await generate(number, undefined, chapter.text)
    },
    [generate]
  )

  const generateAll = useCallback(async () => {
    setBusy(true)
    try {
      const pending = useAppStore.getState().chapters.filter((c) => c.status !== 'done')
      for (const ch of pending) {
        await generate(ch.number)
      }
      // Social-survey track: questionnaire appendix after Chapter 5.
      const { project, chapters, setChapters } = useAppStore.getState()
      const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
      if (track.questionnaireAppendix && !chapters.some((c) => c.number === 6)) {
        const { settings } = useAppStore.getState()
        await generateStream(
          settings,
          'You are writing a research-instrument appendix for a Nigerian final year project. Plain text only.',
          questionnairePrompt(project, chapters),
          () => {},
          0.5
        ).then((text) => {
          setChapters([
            ...useAppStore.getState().chapters,
            {
              number: 6, title: 'QUESTIONNAIRE', sections: [],
              status: 'done' as const, text: 'APPENDIX: QUESTIONNAIRE\n\n' + text,
            },
          ])
        })
      }
    } finally {
      setBusy(false)
    }
  }, [generate])

  return { generate, generateAll, busy, continuing, continueChapter }
}

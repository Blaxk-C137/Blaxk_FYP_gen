import { useCallback, useState } from 'react'
import { useAppStore } from './state/store'
import type { ReferenceEntry } from './state/store'
import { generateStream } from './api'
import { systemPrompt, chapterPrompt, chapterBudget, OVERSHOOT_FACTOR, questionnairePrompt } from './prompts'
import { trackFor } from './ai/tracks'
import { fixChapterText, seriousViolations } from './ai/guardrails'
import { wordCount } from './ai/wordCount'

export function useChapterGeneration() {
  const [busy, setBusy] = useState(false)
  const [continuing, setContinuing] = useState<number | null>(null)

  const streamOnce = useCallback(
    async (number: number, nudge?: string, continuation?: string) => {
      const { settings, project, chapters } = useAppStore.getState()
      const chapter = chapters.find((c) => c.number === number)
      if (!chapter) return ''
      const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
      await generateStream(
        settings,
        systemPrompt(track),
        chapterPrompt(project, chapters, chapter, nudge, continuation),
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

        // One retry max — shared slot between guardrail violations and
        // length overshoot. Better attempt (fewer unfixed violations, else
        // closer to budget) wins.
        const budget = chapterBudget(project.lengthPreset ?? 'standard', number)
        const over = wordCount(fixed.text) > budget * OVERSHOOT_FACTOR
        const serious = seriousViolations(fixed.violations)
        if (!continuation && (over || serious.length)) {
          const reasons = [
            ...serious.map((v) => v.detail),
            ...(over
              ? [
                  `This chapter is ${wordCount(fixed.text)} words against a budget of ${budget}. ` +
                    `Rewrite at about ${budget} words: cut padding and repetition, keep every required section.`,
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

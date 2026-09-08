import { useCallback, useState } from 'react'
import { useAppStore } from './state/store'
import { generateStream } from './api'
import { systemPrompt, chapterPrompt } from './prompts'

export function useChapterGeneration() {
  const [busy, setBusy] = useState(false)
  const [continuing, setContinuing] = useState<number | null>(null)

  const generate = useCallback(
    async (number: number, nudge?: string, continuation?: string) => {
      const { settings, project, chapters, updateChapter } = useAppStore.getState()
      const chapter = chapters.find((c) => c.number === number)
      if (!chapter) return
      updateChapter(number, { status: 'streaming', ...(continuation ? {} : { text: '' }) })
      setBusy(true)
      try {
        await generateStream(
          settings,
          systemPrompt(),
          chapterPrompt(project, chapters, chapter, nudge, continuation),
          (chunk) => useAppStore.getState().appendChapterText(number, chunk)
        )
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
    []
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
    } finally {
      setBusy(false)
    }
  }, [generate])

  return { generate, generateAll, busy, continuing, continueChapter }
}

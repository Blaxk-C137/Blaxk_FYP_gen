import { useState } from 'react'
import { useChapters, useAppStore } from '../state/store'
import { useChapterGeneration } from '../useChapterGeneration'

const STATUS_LABEL = { pending: 'Pending', streaming: 'Generating…', done: 'Done ✓' } as const

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
const toWord = (n: number) => WORDS[n - 1] ?? String(n)

export function Generate({ onNextScreen }: { onNextScreen?: () => void } = {}) {
  const chapters = useChapters()
  const { generate, generateAll, busy, continuing, continueChapter } = useChapterGeneration()
  const [error, setError] = useState('')

  function run(fn: () => Promise<void>) {
    setError('')
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Generation failed'))
  }

  const anyDone = chapters.some((c) => c.status === 'done')

  return (
    <main className="container">
      <h1>Chapters</h1>
      <button disabled={busy} onClick={() => run(generateAll)}>Generate all sequentially</button>
      {error && <p role="alert" className="error">{error}</p>}
      {chapters.map((ch) => (
        <section key={ch.number} style={{ marginTop: '1.5rem' }}>
          <h2>CHAPTER {toWord(ch.number)} — {ch.title}</h2>
          <p className="note">{STATUS_LABEL[ch.status]} · {ch.text ? ch.text.split(/\s+/).length : 0} words</p>
          {ch.status !== 'done' && (
            <button
              disabled={busy}
              onClick={() => run(() => generate(ch.number))}
            >
              {ch.status === 'streaming' ? 'Generating…' : 'Generate'}
            </button>
          )}
          {continuing === ch.number && (
            <button onClick={() => run(() => continueChapter(ch.number))}>Continue</button>
          )}
          {ch.status === 'done' && (
            <details>
              <summary>Read / edit chapter text</summary>
              <textarea
                aria-label={`Chapter ${ch.number} text`}
                value={ch.text}
                rows={20}
                style={{ width: '100%' }}
                onChange={(e) =>
                  useAppStore.getState().updateChapter(ch.number, { text: e.target.value })
                }
              />
              <button
                onClick={() => {
                  const nudge = window.prompt('Direction for regeneration (leave blank for none)') ?? undefined
                  run(() => generate(ch.number, nudge))
                }}
              >
                Regenerate
              </button>
            </details>
          )}
        </section>
      ))}
      {onNextScreen && (
        <button disabled={!anyDone} onClick={onNextScreen}>Review →</button>
      )}
    </main>
  )
}

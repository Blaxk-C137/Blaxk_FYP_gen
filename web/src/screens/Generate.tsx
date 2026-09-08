import { useState } from 'react'
import { useChapters, useAppStore } from '../state/store'
import { useChapterGeneration } from '../useChapterGeneration'

const STATUS_LABEL = { pending: 'Pending', streaming: 'Generating', done: 'Done' } as const

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
      <p className="lede">
        Generate each chapter — one at a time, or all five in sequence. If a stream drops, your
        partial text is kept and you can continue where it stopped.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {chapters.map((ch) => (
        <section key={ch.number} className="chapter">
          <div className="chapter-head">
            <span className="chapter-title">
              CHAPTER {toWord(ch.number)} — {ch.title}
            </span>
            <span className="chapter-meta">
              <span className={`chip ${ch.status}`}>{STATUS_LABEL[ch.status]}</span>
              {ch.text ? `${ch.text.split(/\s+/).length} words` : ''}
            </span>
          </div>
          {ch.status !== 'done' && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(() => generate(ch.number))}
            >
              {ch.status === 'streaming' ? 'Generating…' : 'Generate'}
            </button>
          )}
          {continuing === ch.number && (
            <button className="primary" onClick={() => run(() => continueChapter(ch.number))}>
              Continue
            </button>
          )}
          {ch.status === 'done' && (
            <details>
              <summary>Read / edit chapter text</summary>
              <textarea
                aria-label={`Chapter ${ch.number} text`}
                value={ch.text}
                rows={20}
                onChange={(e) =>
                  useAppStore.getState().updateChapter(ch.number, { text: e.target.value })
                }
              />
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  className="secondary"
                  onClick={() => {
                    const nudge =
                      window.prompt('Direction for regeneration (leave blank for none)') ??
                      undefined
                    run(() => generate(ch.number, nudge))
                  }}
                >
                  Regenerate
                </button>
              </div>
            </details>
          )}
        </section>
      ))}
      <div className="actions-row">
        {onNextScreen && (
          <button className="primary" disabled={!anyDone} onClick={onNextScreen}>
            Review your project
          </button>
        )}
        <button className="secondary" disabled={busy} onClick={() => run(generateAll)}>
          Generate all chapters
        </button>
      </div>
    </main>
  )
}

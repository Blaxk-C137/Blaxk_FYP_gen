import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { generateStream } from '../api'
import { systemPrompt, outlinePrompt } from '../prompts'
import { parseOutline } from '../ai/parseOutline'

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
const toWord = (n: number) => WORDS[n - 1] ?? String(n)

export function Outline({ onNext }: { onNext: () => void }) {
  const project = useAppStore((s) => s.project)
  const chapters = useAppStore((s) => s.chapters)
  const abstract = useAppStore((s) => s.abstract)
  const setOutline = useAppStore((s) => s.setOutline)
  const updateChapter = useAppStore((s) => s.updateChapter)
  const settings = useAppStore((s) => s.settings)
  const [state, setState] = useState<'generating' | 'ready' | 'error'>('generating')
  const [error, setError] = useState('')

  async function generate() {
    setState('generating')
    let raw = ''
    try {
      raw = await generateStream(settings, systemPrompt(), outlinePrompt(project), () => {})
      const parsed = parseOutline(raw)
      setOutline(parsed.chapters, parsed.abstract)
      setState('ready')
    } catch (e) {
      // Keep the full raw model output reachable from the browser console —
      // it is the only way to see what the model actually said when parsing fails.
      console.error('[fypgen] outline generation failed. Raw model output:', raw || '(empty)')
      setError(e instanceof Error ? e.message : 'Generation failed')
      setState('error')
    }
  }

  useEffect(() => {
    if (chapters.every((c) => c.sections.length === 0)) void generate()
    else setState('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'generating')
    return (
      <main className="container">
        <h1>Outline</h1>
        <div className="generating">
          <p className="pulse">Drafting your outline</p>
          <p>This usually takes under a minute.</p>
        </div>
      </main>
    )
  if (state === 'error')
    return (
      <main className="container">
        <h1>Outline</h1>
        <p role="alert" className="error">
          {error}
        </p>
        <div className="actions-row">
          <button className="primary" onClick={() => void generate()}>
            Try again
          </button>
        </div>
      </main>
    )

  return (
    <main className="container">
      <h1>Outline</h1>
      <p className="lede">
        This decides your project's quality. Edit any heading, drop weak sections, add what your
        department expects — before generating chapters.
      </p>
      {chapters.map((ch) => (
        <section key={ch.number} className="chapter">
          <div className="chapter-head">
            <span className="chapter-title">CHAPTER {toWord(ch.number)}</span>
            <span className="chapter-meta">{ch.sections.length} sections</span>
          </div>
          <input
            className="input-bare"
            aria-label={`Chapter ${ch.number} title`}
            value={ch.title}
            onChange={(e) => updateChapter(ch.number, { title: e.target.value.toUpperCase() })}
          />
          {ch.sections.map((s, i) => (
            <div key={i} className="section-row">
              <input
                aria-label={`Chapter ${ch.number} section ${i + 1} heading`}
                value={s.heading}
                placeholder="Section heading"
                onChange={(e) => {
                  const sections = ch.sections.map((sec, j) =>
                    j === i ? { ...sec, heading: e.target.value } : sec
                  )
                  updateChapter(ch.number, { sections })
                }}
              />
              <button
                className="remove-btn"
                aria-label={`Remove chapter ${ch.number} section ${i + 1}`}
                title="Remove section"
                onClick={() =>
                  updateChapter(ch.number, { sections: ch.sections.filter((_, j) => j !== i) })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="ghost"
            onClick={() =>
              updateChapter(ch.number, {
                sections: [...ch.sections, { heading: 'New section', description: '' }],
              })
            }
          >
            + Add section
          </button>
        </section>
      ))}
      {abstract && (
        <details>
          <summary>Draft abstract</summary>
          <p className="note">{abstract}</p>
        </details>
      )}
      <div className="actions-row">
        <button className="primary" onClick={onNext}>
          Approve outline & generate chapters
        </button>
        <button className="secondary" onClick={() => void generate()}>
          Regenerate outline
        </button>
      </div>
    </main>
  )
}

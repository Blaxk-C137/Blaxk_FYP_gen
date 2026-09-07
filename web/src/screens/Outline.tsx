import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import { generateStream } from '../api'
import { systemPrompt, outlinePrompt } from '../prompts'
import { parseOutline } from '../ai/parseOutline'

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
    try {
      const raw = await generateStream(settings, systemPrompt(), outlinePrompt(project), () => {})
      const parsed = parseOutline(raw)
      setOutline(parsed.chapters, parsed.abstract)
      setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
      setState('error')
    }
  }

  useEffect(() => {
    if (chapters.every((c) => c.sections.length === 0)) void generate()
    else setState('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'generating') return <main className="container"><p>Drafting your outline…</p></main>
  if (state === 'error')
    return (
      <main className="container">
        <p role="alert" className="error">{error}</p>
        <button onClick={() => void generate()}>Try again</button>
      </main>
    )

  return (
    <main className="container">
      <h1>Outline</h1>
      <p className="note">This decides your project's quality — edit freely before generating chapters.</p>
      {chapters.map((ch) => (
        <section key={ch.number} style={{ marginBottom: '1.5rem' }}>
          <h2>
            <input
              aria-label={`Chapter ${ch.number} title`}
              value={ch.title}
              onChange={(e) => updateChapter(ch.number, { title: e.target.value.toUpperCase() })}
              style={{ fontSize: '1.1rem', fontWeight: 700, width: '100%' }}
            />
          </h2>
          {ch.sections.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <input
                aria-label={`Chapter ${ch.number} section ${i + 1} heading`}
                value={s.heading}
                onChange={(e) => {
                  const sections = ch.sections.map((sec, j) =>
                    j === i ? { ...sec, heading: e.target.value } : sec
                  )
                  updateChapter(ch.number, { sections })
                }}
              />
              <button
                aria-label={`Remove chapter ${ch.number} section ${i + 1}`}
                onClick={() =>
                  updateChapter(ch.number, { sections: ch.sections.filter((_, j) => j !== i) })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
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
          <p>{abstract}</p>
        </details>
      )}
      <button onClick={() => void generate()}>Regenerate outline</button>{' '}
      <button onClick={onNext}>Approve outline → Generate chapters</button>
    </main>
  )
}

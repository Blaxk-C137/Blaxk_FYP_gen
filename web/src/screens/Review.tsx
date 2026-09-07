import { useChapters, useAppStore } from '../state/store'

const words = (t: string) => (t ? t.trim().split(/\s+/).length : 0)

export function Review({ onNext }: { onNext: () => void }) {
  const chapters = useChapters()
  const updateChapter = useAppStore((s) => s.updateChapter)
  const total = chapters.reduce((n, c) => n + words(c.text), 0)

  return (
    <main className="container">
      <h1>Review your project</h1>
      <p className="note">Total: {total} words · edit any chapter inline — changes save automatically.</p>
      {chapters.map((ch) => (
        <section key={ch.number} style={{ marginTop: '1.5rem' }}>
          <h2>CHAPTER {ch.number} — {ch.title} <small>({words(ch.text)} words)</small></h2>
          <textarea
            aria-label={`Chapter ${ch.number} text`}
            value={ch.text}
            rows={16}
            style={{ width: '100%' }}
            onChange={(e) => updateChapter(ch.number, { text: e.target.value })}
          />
        </section>
      ))}
      <button disabled={total === 0} onClick={onNext}>Continue to export →</button>
    </main>
  )
}

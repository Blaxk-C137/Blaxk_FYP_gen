import { useChapters, useAppStore } from '../state/store'

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
const toWord = (n: number) => WORDS[n - 1] ?? String(n)

const words = (t: string) => (t ? t.trim().split(/\s+/).length : 0)

export function Review({ onNext }: { onNext: () => void }) {
  const chapters = useChapters()
  const updateChapter = useAppStore((s) => s.updateChapter)
  const references = useAppStore((s) => s.references)
  const total = chapters.reduce((n, c) => n + words(c.text), 0)
  const verifiedCount = references.filter((r) => r.verified).length

  return (
    <main className="container">
      <h1>Review your project</h1>
      <p className="lede">
        Total: {total} words · edit any chapter inline — changes save automatically as you type.
      </p>
      {chapters.map((ch) => (
        <section key={ch.number} className="chapter">
          <div className="chapter-head">
            <span className="chapter-title">
              CHAPTER {toWord(ch.number)} — {ch.title}
            </span>
            <span className="chapter-meta">{words(ch.text)} words</span>
          </div>
          <textarea
            aria-label={`Chapter ${ch.number} text`}
            value={ch.text}
            rows={16}
            onChange={(e) => updateChapter(ch.number, { text: e.target.value })}
          />
        </section>
      ))}
      {references.length > 0 && (
        <section className="chapter" aria-label="References">
          <div className="chapter-head">
            <span className="chapter-title">REFERENCES</span>
            <span className="chapter-meta">{verifiedCount} of {references.length} verified</span>
          </div>
          <ul className="ref-list">
            {references.map((r, i) => (
              <li key={i} className={r.verified ? 'ref-ok' : 'ref-check'}>
                <span className="ref-text">{r.apa}</span>
                <span className={`ref-badge${r.verified ? '' : ' bad'}`}>{r.verified ? 'verified' : 'verify'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="actions-row">
        <button className="primary" disabled={total === 0} onClick={onNext}>
          Continue to export
        </button>
      </div>
    </main>
  )
}

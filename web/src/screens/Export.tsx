import { useState } from 'react'
import { useAppStore, useProject, useChapters, useSettings } from '../state/store'
import type { ReferenceEntry, PoolEntry } from '../state/store'
import { generateStream, generateImage, fetchLogo } from '../api'
import { systemPrompt, defenseQuestionsPrompt, slidesPrompt } from '../prompts'
import { trackFor } from '../ai/tracks'
import { parseSlides } from '../ai/parseSlides'
import type { SlideContent, SlideKey } from '../ai/parseSlides'
import { extractCitations } from '../ai/extractCitations'
import { puterImage } from '../ai/puterImages'
import { buildDocx } from '../export/docx'
import { buildPptx, slideContentFromChapters } from '../export/pptx'
import { THEME_OPTIONS } from '../export/themes'
import { downloadBlob } from '../export/download'

function slug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fyp-project'
}

/** Manual upload wins over the scrape; absence degrades to null. */
async function resolveLogo(
  project: ReturnType<typeof useProject>
): Promise<{ base64: string; mime: string } | null> {
  const dataUrl = project.logoDataUrl
  if (dataUrl?.startsWith('data:image/')) {
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (mime && base64) return { base64, mime }
  }
  return project.university ? fetchLogo(project.university) : null
}

export function Export() {
  const project = useProject()
  const chapters = useChapters()
  const settings = useSettings()
  const abstract = useAppStore((s) => s.abstract)
  const slideTheme = useAppStore((s) => s.slideTheme)
  const setSlideTheme = useAppStore((s) => s.setSlideTheme)
  const [defenseQa, setDefenseQa] = useState('')
  const [slideContent, setSlideContent] = useState<SlideContent | null>(null)
  const [busy, setBusy] = useState('')
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [pptxFailed, setPptxFailed] = useState(false)

  /** Free Puter image first; the API-key path is the fallback. */
  const imageChain = async (prompt: string): Promise<string | null> =>
    (await puterImage(prompt)) ?? (await generateImage(settings, prompt))

  async function docx() {
    setBusy('docx')
    setError('')
    try {
      const refs = ensureReferences()
      const logo = await resolveLogo(project)
      downloadBlob(
        await buildDocx(project, chapters, abstract, refs, {
          imageFor: imageChain,
          logo,
        }),
        `${slug(project.topic)}.docx`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }

  async function ensureDefenseQa(): Promise<string> {
    if (defenseQa) return defenseQa
    setPhase('Generating defense Q&A…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const qa = await generateStream(
      settings, systemPrompt(track), defenseQuestionsPrompt(project, chapters), () => {}
    )
    setDefenseQa(qa)
    return qa
  }

  async function ensureSlideContent(): Promise<SlideContent> {
    if (slideContent) return slideContent
    setPhase('Structuring slide content with AI…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const raw = await generateStream(settings, systemPrompt(track), slidesPrompt(project, chapters), () => {})
    const content = parseSlides(raw)
    setSlideContent(content)
    return content
  }

  /** References = pool entries the chapters actually cited. Pool entries come
   *  from Crossref, so a match is verified by construction — no AI recall, no
   *  re-verification round-trip. Citations missing from the pool (the model
   *  disobeyed, or the student edited text by hand) are simply not listed. */
  function ensureReferences(): ReferenceEntry[] {
    const current = useAppStore.getState().references
    const pool = useAppStore.getState().referencePool
    const keys = extractCitations(chapters.map((c) => c.text).join('\n'))
    if (!keys.length || !pool.length) return current
    // Pool keys are "(Author, 2020)"; extractCitations yields "Author, 2020".
    const byKey = new Map(pool.map((p) => [p.key.replace(/^\(|\)$/g, ''), p]))
    const cited = keys
      .map((k) => byKey.get(k))
      .filter((p): p is PoolEntry => Boolean(p))
    if (!cited.length) return current
    const entries: ReferenceEntry[] = cited.map((p) => ({
      key: p.key, apa: p.apa, verified: true, doi: p.doi,
    }))
    // Keep manual/Layer-2 entries that don't duplicate a pool entry.
    const merged = [...current.filter((r) => !entries.some((e) => e.apa === r.apa)), ...entries]
    useAppStore.getState().setReferences(merged)
    return merged
  }

  async function pptx() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const qa = await ensureDefenseQa()
      const content = await ensureSlideContent()
      const refs = ensureReferences()
      setPhase('Preparing slide assets…')
      const [logo, images] = await Promise.all([
        resolveLogo(project),
        (async () => {
          const out: Partial<Record<SlideKey, string>> = {}
          for (const img of content.images) {
            const data = await imageChain(img.prompt)
            if (data) out[img.slide] = data
          }
          return out
        })(),
      ])
      setPhase('Building slides…')
      downloadBlob(
        await buildPptx(project, chapters, qa, content, refs, slideTheme, { logo, images }),
        `${slug(project.topic)}-defense.pptx`
      )
    } catch (e) {
      setPptxFailed(true)
      setError(e instanceof Error ? e.message : 'Slide generation failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }

  async function pptxFallback() {
    setBusy('pptx')
    setError('')
    setPptxFailed(false)
    try {
      const content = slideContentFromChapters(chapters)
      setSlideContent(content)
      const refs = useAppStore.getState().references
      downloadBlob(
        await buildPptx(project, chapters, defenseQa, content, refs, slideTheme, { logo: null }),
        `${slug(project.topic)}-defense.pptx`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slide generation failed')
    } finally {
      setBusy('')
      setPhase('')
    }
  }

  const done = chapters.filter((c) => c.text).length
  return (
    <main className="container">
      <h1>Export</h1>
      <p className="lede">
        {done} of {chapters.length} chapters have content. Verify every reference before you
        submit — they are AI-generated.
      </p>
      <div className="export-actions">
        <div className="download-card">
          <span className="fmt">Word document</span>
          <span className="desc">
            Full report — title page, abstract, all chapters, references. Times New Roman 12,
            double-spaced, justified.
          </span>
          <button className="primary" disabled={done === 0 || busy !== ''} onClick={() => void docx()}>
            {busy === 'docx' ? 'Building…' : 'Download DOCX'}
          </button>
        </div>
        <div className="download-card">
          <span className="fmt">Defense slides</span>
          <span className="desc">
            Themed PowerPoint deck for your defense, with a Q&A prep appendix generated from your
            project.
          </span>
          <div className="theme-picker" role="radiogroup" aria-label="Slide theme">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={slideTheme === t.id}
                className={`theme-opt${slideTheme === t.id ? ' on' : ''}`}
                onClick={() => setSlideTheme(t.id)}
              >
                <span className="tswatch">
                  <span style={{ background: t.preview.primary }} />
                  <span style={{ background: t.preview.accent }} />
                </span>
                <span className="tname">{t.name}</span>
              </button>
            ))}
          </div>
          <button className="secondary" disabled={done === 0 || busy !== ''} onClick={() => void pptx()}>
            {busy === 'pptx' ? phase || 'Generating slides…' : 'Download PPTX'}
          </button>
          {pptxFailed && (
            <span className="fallback-row">
              <button className="link" disabled={busy !== ''} onClick={() => void pptx()}>
                Try again
              </button>
              <button className="link" disabled={busy !== ''} onClick={() => void pptxFallback()}>
                Use section headings instead
              </button>
            </span>
          )}
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="note">
        Figures are generated free via Puter — a sign-in window opens the first time (your own
        free credits). If Puter is unavailable, your API key is used as a fallback.
      </p>
      {defenseQa && (
        <details>
          <summary>Defense Q&amp;A prep</summary>
          <pre className="qa">{defenseQa}</pre>
        </details>
      )}
      <p className="note" style={{ marginTop: '2.5rem' }}>
        Starting a new project?{' '}
        <button className="link" onClick={() => useAppStore.getState().reset()}>
          Reset everything
        </button>{' '}
        — your API key stays.
      </p>
    </main>
  )
}

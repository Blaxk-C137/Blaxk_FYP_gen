import { useState } from 'react'
import { useAppStore, useProject, useChapters, useSettings } from '../state/store'
import type { ReferenceEntry } from '../state/store'
import { generateStream, generateImage, resolveReferences } from '../api'
import { systemPrompt, defenseQuestionsPrompt, slidesPrompt, referencesPrompt } from '../prompts'
import { trackFor } from '../ai/tracks'
import { parseSlides } from '../ai/parseSlides'
import type { SlideContent } from '../ai/parseSlides'
import { extractCitations } from '../ai/extractCitations'
import { parseReferences } from '../ai/parseReferences'
import { buildDocx } from '../export/docx'
import { buildPptx, slideContentFromChapters } from '../export/pptx'
import { THEME_OPTIONS } from '../export/themes'
import { downloadBlob } from '../export/download'

function slug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fyp-project'
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

  async function docx() {
    setBusy('docx')
    setError('')
    try {
      let refs = useAppStore.getState().references
      if (!refs.length) refs = await ensureReferences().catch((e) => {
        setError(e instanceof Error ? e.message : 'Reference verification failed')
        return useAppStore.getState().references
      })
      downloadBlob(
        await buildDocx(project, chapters, abstract, refs.map((r) => r.apa), {
          imageFor: (prompt) => generateImage(settings, prompt),
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

  async function ensureReferences(): Promise<ReferenceEntry[]> {
    const current = useAppStore.getState().references
    const keys = extractCitations(chapters.map((c) => c.text).join('\n'))
    if (!keys.length) return current
    // Cached: we already have entries and no new keys appeared.
    const known = new Set(current.map((r) => r.key))
    if (current.length && keys.every((k) => known.has(k))) return current
    setPhase('Verifying references…')
    const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
    const raw = await generateStream(settings, systemPrompt(track), referencesPrompt(project, keys), () => {})
    const drafts = parseReferences(raw)
    const entries = await resolveReferences(drafts)
    // Keep any previously verified entries not covered this round.
    const merged = [...current.filter((r) => r.verified && !entries.some((e) => e.key === r.key)), ...entries]
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
      await ensureReferences().catch(() => useAppStore.getState().references)
      setPhase('Building slides…')
      downloadBlob(
        await buildPptx(project, chapters, qa, content, slideTheme),
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
      await ensureReferences().catch(() => useAppStore.getState().references)
      const content = slideContentFromChapters(chapters)
      setSlideContent(content)
      downloadBlob(
        await buildPptx(project, chapters, defenseQa, content, slideTheme),
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

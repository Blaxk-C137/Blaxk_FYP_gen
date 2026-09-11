import { useState } from 'react'
import { useAppStore, useProject, useChapters, useSettings } from '../state/store'
import { generateStream } from '../api'
import { systemPrompt, defenseQuestionsPrompt } from '../prompts'
import { trackFor } from '../ai/tracks'
import { buildDocx } from '../export/docx'
import { buildPptx } from '../export/pptx'
import { downloadBlob } from '../export/download'

function slug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fyp-project'
}

export function Export() {
  const project = useProject()
  const chapters = useChapters()
  const settings = useSettings()
  const abstract = useAppStore((s) => s.abstract)
  const references = useAppStore((s) => s.references)
  const [defenseQa, setDefenseQa] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function docx() {
    setBusy('docx')
    setError('')
    try {
      downloadBlob(await buildDocx(project, chapters, abstract, references), `${slug(project.topic)}.docx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  async function pptx() {
    setBusy('pptx')
    setError('')
    try {
      if (!defenseQa) {
        const track = trackFor(project.track, project.courseOfStudy, project.fieldOfStudy)
        const qa = await generateStream(
          settings, systemPrompt(track), defenseQuestionsPrompt(project, chapters), () => {}
        )
        setDefenseQa(qa)
        downloadBlob(await buildPptx(project, chapters, qa), `${slug(project.topic)}-defense.pptx`)
      } else {
        downloadBlob(await buildPptx(project, chapters, defenseQa), `${slug(project.topic)}-defense.pptx`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
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
            PowerPoint deck for your defense, with a Q&A prep appendix generated from your project.
          </span>
          <button className="secondary" disabled={done === 0 || busy !== ''} onClick={() => void pptx()}>
            {busy === 'pptx' ? 'Generating slides…' : 'Download PPTX'}
          </button>
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

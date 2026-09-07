import { useState } from 'react'
import { useAppStore, useProject, useChapters, useSettings } from '../state/store'
import { generateStream } from '../api'
import { systemPrompt, defenseQuestionsPrompt } from '../prompts'
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
  const [defenseQa, setDefenseQa] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function docx() {
    setBusy('docx')
    setError('')
    try {
      downloadBlob(await buildDocx(project, chapters, abstract), `${slug(project.topic)}.docx`)
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
        const qa = await generateStream(
          settings, systemPrompt(), defenseQuestionsPrompt(project, chapters), () => {}
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
      <p className="note">{done} of {chapters.length} chapters have content.</p>
      <button disabled={done === 0 || busy !== ''} onClick={() => void docx()}>
        {busy === 'docx' ? 'Building…' : 'Download DOCX'}
      </button>{' '}
      <button disabled={done === 0 || busy !== ''} onClick={() => void pptx()}>
        {busy === 'pptx' ? 'Generating slides…' : 'Download Defense Slides (PPTX)'}
      </button>
      {error && <p role="alert" className="error">{error}</p>}
      {defenseQa && (
        <details style={{ marginTop: '1.5rem' }}>
          <summary>Defense Q&A prep</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{defenseQa}</pre>
        </details>
      )}
      <p className="note">Start a new project: <button className="link" onClick={() => useAppStore.getState().reset()}>reset</button></p>
    </main>
  )
}

import { useMemo, useState } from 'react'
import { useAppStore } from '../state/store'
import type { LengthPreset } from '../state/store'
import { LENGTH_PRESETS } from '../prompts'
import { fieldsOfStudy, coursesForField, trackForCourse, TRACKS } from '../ai/tracks'
import type { TrackId } from '../ai/tracks'

const FIELDS = [
  ['topic', 'Topic', 'e.g. Design and construction of an IoT-based theft detection system for campus laboratories', true],
  ['studentName', 'Student name', 'Your full name', false],
  ['matric', 'Matric number', 'e.g. ENG/21/10345', false],
  ['university', 'University', 'e.g. Bayero University Kano', false],
  ['department', 'Department', 'e.g. Telecommunications Engineering', false],
  ['supervisor', 'Supervisor', 'e.g. Dr. O. Adewale', false],
  ['degree', 'Degree', 'e.g. B.Eng', false],
  ['session', 'Session', 'e.g. 2026/2027', false],
] as const

const TRACK_IDS: TrackId[] = ['science-lab', 'social-survey', 'computing-engineering']

export function ProjectSetup({ onNext }: { onNext: () => void }) {
  const project = useAppStore((s) => s.project)
  const setProject = useAppStore((s) => s.setProject)
  const [touched, setTouched] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')

  const field = project.fieldOfStudy ?? ''
  const course = project.courseOfStudy ?? ''
  const fieldCourses = useMemo(() => coursesForField(field), [field])
  const suggestions = useMemo(() => {
    const q = courseQuery.trim().toLowerCase()
    if (!q) return []
    return fieldCourses
      .filter((c) => c.course.toLowerCase().includes(q))
      .filter((c) => c.course.toLowerCase() !== q)
      .slice(0, 6)
  }, [courseQuery, fieldCourses])

  // Resolved track: explicit choice wins; otherwise inferred from course+field.
  const resolvedTrack: TrackId =
    project.track ?? trackForCourse(course || courseQuery, field)

  return (
    <main className="container">
      <h1>Your project</h1>
      <p className="lede">
        These details go on your title page and shape how the AI writes — fill them in carefully.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!project.topic) return setTouched(true)
          onNext()
        }}
      >
        {FIELDS.map(([key, label, placeholder, required]) => (
          <div key={key} className="field">
            <label htmlFor={key}>
              {label}
              {required ? ' *' : ''}
            </label>
            <input
              id={key}
              value={project[key]}
              placeholder={placeholder}
              onChange={(e) => setProject({ [key]: e.target.value })}
            />
            {key === 'topic' && (
              <p className="hint">One clear sentence — what you built or studied, and for what.</p>
            )}
          </div>
        ))}

        <div className="field">
          <label htmlFor="fieldOfStudy">Field of study</label>
          <select
            id="fieldOfStudy"
            value={field}
            onChange={(e) => setProject({ fieldOfStudy: e.target.value, track: undefined })}
          >
            <option value="">Select field…</option>
            {fieldsOfStudy().map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="courseOfStudy">Course of study</label>
          <input
            id="courseOfStudy"
            list="course-suggestions"
            value={courseQuery || course}
            placeholder="Start typing — e.g. Psychology"
            onChange={(e) => {
              setCourseQuery(e.target.value)
              setProject({ courseOfStudy: e.target.value, track: undefined })
            }}
          />
          <datalist id="course-suggestions">
            {suggestions.map((c) => (
              <option key={c.course} value={c.course} />
            ))}
          </datalist>
          <p className="hint">
            Drives the chapter structure. Custom courses not in the list are fine.
          </p>
        </div>

        <div className="field">
          <label htmlFor="logoUpload">University logo (optional)</label>
          <input
            id="logoUpload"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => setProject({ logoDataUrl: String(reader.result) })
              reader.readAsDataURL(file)
            }}
          />
          <p className="hint">
            {project.logoDataUrl ? (
              <>
                <img
                  src={project.logoDataUrl}
                  alt="Uploaded logo preview"
                  style={{ height: 36, verticalAlign: 'middle', marginRight: '0.5rem' }}
                />
                <button
                  type="button"
                  className="link"
                  onClick={() => setProject({ logoDataUrl: undefined })}
                >
                  Remove
                </button>
                {' — used on the title page.'}
              </>
            ) : (
              'Used on the title page. If you skip this, fypgen tries to fetch the logo automatically.'
            )}
          </p>
        </div>

        <div className="field">
          <span className="label">Document structure</span>
          <div className="chips" role="radiogroup" aria-label="Discipline track">
            {TRACK_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={resolvedTrack === id}
                className={`chip${resolvedTrack === id ? ' selected' : ''}`}
                onClick={() => setProject({ track: id })}
                title={
                  resolvedTrack === id && !project.track
                    ? 'Inferred from your course — click a different one to override'
                    : undefined
                }
              >
                {TRACKS[id].label}
              </button>
            ))}
          </div>
          <p className="hint">
            Pre-selected from your course; click another to override. This sets chapter
            titles and section structure.
          </p>
        </div>

        <div className="field">
          <label htmlFor="lengthPreset">Document length</label>
          <select
            id="lengthPreset"
            value={project.lengthPreset ?? 'standard'}
            onChange={(e) => setProject({ lengthPreset: e.target.value as LengthPreset })}
          >
            {(Object.keys(LENGTH_PRESETS) as LengthPreset[]).map((p) => (
              <option key={p} value={p}>{LENGTH_PRESETS[p].pages}</option>
            ))}
          </select>
          <p className="hint">
            Word budgets per chapter — the generator trims and retries if a chapter
            runs over.
          </p>
        </div>

        {touched && !project.topic && (
          <p role="alert" className="error" style={{ marginTop: 0 }}>
            Enter a topic first — everything else builds on it.
          </p>
        )}
        <div className="actions-row">
          <button className="primary" type="submit">
            Continue
          </button>
        </div>
      </form>
    </main>
  )
}

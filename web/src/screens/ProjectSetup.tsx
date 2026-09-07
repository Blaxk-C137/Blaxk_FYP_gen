import { useState } from 'react'
import { useAppStore } from '../state/store'

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

export function ProjectSetup({ onNext }: { onNext: () => void }) {
  const project = useAppStore((s) => s.project)
  const setProject = useAppStore((s) => s.setProject)
  const [touched, setTouched] = useState(false)

  return (
    <main className="container">
      <h1>Your project</h1>
      {FIELDS.map(([key, label, placeholder, required]) => (
        <div key={key} style={{ marginBottom: '0.75rem' }}>
          <label htmlFor={key}>{label}{required ? ' *' : ''}</label>
          <input
            id={key}
            value={project[key]}
            placeholder={placeholder}
            style={{ width: '100%' }}
            onChange={(e) => setProject({ [key]: e.target.value })}
          />
        </div>
      ))}
      {touched && !project.topic && <p role="alert" className="error">Please enter a topic first.</p>}
      <button
        onClick={() => {
          if (!project.topic) return setTouched(true)
          onNext()
        }}
      >
        Continue
      </button>
    </main>
  )
}

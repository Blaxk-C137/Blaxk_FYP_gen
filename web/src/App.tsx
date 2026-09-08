import { useState } from 'react'
import { Onboarding } from './screens/Onboarding'
import { ProjectSetup } from './screens/ProjectSetup'
import { Outline } from './screens/Outline'
import { Generate } from './screens/Generate'
import { Review } from './screens/Review'
import { Export } from './screens/Export'
import { useSettings, useProject } from './state/store'

type Screen = 'onboarding' | 'setup' | 'outline' | 'generate' | 'review' | 'export'

const STEPS: { id: Screen; label: string }[] = [
  { id: 'setup', label: 'Project' },
  { id: 'outline', label: 'Outline' },
  { id: 'generate', label: 'Chapters' },
  { id: 'review', label: 'Review' },
  { id: 'export', label: 'Export' },
]

export default function App() {
  const settings = useSettings()
  const project = useProject()
  const initial: Screen = !settings.apiKey ? 'onboarding' : !project.topic ? 'setup' : 'generate'
  const [screen, setScreen] = useState<Screen>(initial)

  return (
    <>
      {settings.apiKey && screen !== 'onboarding' && (
        <header className="topbar">
          <span className="brand">
            fyp<span>gen</span>
          </span>
          <nav className="steps" aria-label="Progress">
            {STEPS.map((s, i) => (
              <span key={s.id} className={screen === s.id ? 'step current' : 'step'}>
                {i + 1}. {s.label}
              </span>
            ))}
          </nav>
        </header>
      )}
      {screen === 'onboarding' && <Onboarding onDone={() => setScreen('setup')} />}
      {screen === 'setup' && <ProjectSetup onNext={() => setScreen('outline')} />}
      {screen === 'outline' && <Outline onNext={() => setScreen('generate')} />}
      {screen === 'generate' && <Generate onNextScreen={() => setScreen('review')} />}
      {screen === 'review' && <Review onNext={() => setScreen('export')} />}
      {screen === 'export' && <Export />}
    </>
  )
}

import { useState } from 'react'
import { Onboarding } from './screens/Onboarding'
import { ProjectSetup } from './screens/ProjectSetup'
import { Outline } from './screens/Outline'
import { Generate } from './screens/Generate'
import { Review } from './screens/Review'
import { Export } from './screens/Export'
import { useSettings, useProject } from './state/store'

type Screen = 'onboarding' | 'setup' | 'outline' | 'generate' | 'review' | 'export'

export default function App() {
  const settings = useSettings()
  const project = useProject()
  const initial: Screen = !settings.apiKey ? 'onboarding' : !project.topic ? 'setup' : 'generate'
  const [screen, setScreen] = useState<Screen>(initial)

  return (
    <main className="container">
      {settings.apiKey && screen !== 'onboarding' && (
        <nav className="steps" aria-label="Progress">
          {(['setup', 'outline', 'generate', 'review', 'export'] as Screen[]).map((s, i) => (
            <span key={s} className={screen === s ? 'step active' : 'step'}>{i + 1}. {s}</span>
          ))}
        </nav>
      )}
      {screen === 'onboarding' && <Onboarding onDone={() => setScreen('setup')} />}
      {screen === 'setup' && <ProjectSetup onNext={() => setScreen('outline')} />}
      {screen === 'outline' && <Outline onNext={() => setScreen('generate')} />}
      {screen === 'generate' && <Generate onNextScreen={() => setScreen('review')} />}
      {screen === 'review' && <Review onNext={() => setScreen('export')} />}
      {screen === 'export' && <Export />}
    </main>
  )
}

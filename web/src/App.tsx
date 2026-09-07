import { useState } from 'react'
import { Onboarding } from './screens/Onboarding'
import { ProjectSetup } from './screens/ProjectSetup'
import { Outline } from './screens/Outline'
import { Generate } from './screens/Generate'
import { useSettings, useProject } from './state/store'
type Screen = 'onboarding' | 'setup' | 'outline' | 'generate'

export default function App() {
  const settings = useSettings()
  const project = useProject()
  const initial: Screen = !settings.apiKey ? 'onboarding' : !project.topic ? 'setup' : 'generate'
  const [screen, setScreen] = useState<Screen>(initial)

  return (
    <main className="container">
      {screen === 'onboarding' && <Onboarding onDone={() => setScreen('setup')} />}
      {screen === 'setup' && <ProjectSetup onNext={() => setScreen('outline')} />}
      {screen === 'outline' && <Outline onNext={() => setScreen('generate')} />}
      {screen === 'generate' && <Generate />}
    </main>
  )
}

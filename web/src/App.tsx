import { Onboarding } from './screens/Onboarding'
import { useSettings } from './state/store'

export default function App() {
  const settings = useSettings()
  return (
    <main className="container">
      {settings.apiKey ? (
        <h1>fypgen — project workspace (next screens land in Tasks 11–13)</h1>
      ) : (
        <Onboarding onDone={() => {}} />
      )}
    </main>
  )
}

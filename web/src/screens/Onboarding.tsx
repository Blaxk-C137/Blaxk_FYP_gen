import { useState } from 'react'
import { PROVIDERS, PROVIDER_INFO } from '@shared/constants'
import type { ProviderId } from '@shared/constants'
import { useAppStore } from '../state/store'
import { testKey } from '../api'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const setSettings = useAppStore((s) => s.setSettings)
  const [provider, setProvider] = useState<ProviderId>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<{ state: 'idle' | 'testing' | 'error'; message?: string }>({ state: 'idle' })

  async function handleTest() {
    setStatus({ state: 'testing' })
    const result = await testKey({ provider, apiKey })
    if (result.ok) {
      setSettings({ provider, apiKey })
      setStatus({ state: 'idle' })
      onDone()
    } else {
      setStatus({ state: 'error', message: result.error ?? 'Key test failed' })
    }
  }

  const info = PROVIDER_INFO[provider]

  return (
    <main className="container">
      <h1>fypgen</h1>
      <p>
        Generate your complete final year project — five chapters plus defense slides — free,
        on your own machine. No account, no payment.
      </p>
      <h2>1. Connect your AI</h2>
      <p className="note">{PROVIDER_INFO.gemini.freeTierNote}</p>
      <div role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((p) => (
          <label key={p} style={{ display: 'block', margin: '0.25rem 0' }}>
            <input
              type="radio" name="provider" value={p}
              checked={provider === p} onChange={() => setProvider(p)}
            />{' '}
            {PROVIDER_INFO[p].label}
          </label>
        ))}
      </div>
      <p>
        Get a key: <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl}</a>
      </p>
      <h2>2. Paste your API key</h2>
      <input
        aria-label="API key"
        type="password" value={apiKey} style={{ width: '100%' }}
        placeholder="Paste your key here"
        onChange={(e) => setApiKey(e.target.value)}
      />
      <button disabled={apiKey.length < 10 || status.state === 'testing'} onClick={() => void handleTest()}>
        {status.state === 'testing' ? 'Testing…' : 'Test key & start'}
      </button>
      {status.state === 'error' && (
        <p role="alert" className="error">{status.message}</p>
      )}
      <p className="note">Your key is stored only in this browser (localStorage) and sent only to your own machine's server.</p>
    </main>
  )
}

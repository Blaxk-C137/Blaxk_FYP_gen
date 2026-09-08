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
      <div className="hero">
        <h1>
          fyp<span style={{ color: 'var(--green)' }}>gen</span>
        </h1>
        <p className="lede">
          Your complete final year project — five chapters plus defense slides — written on your
          own machine. Free, forever. No account, no payment.
        </p>
      </div>

      <h2>Choose your AI</h2>
      <p className="note" style={{ marginBottom: '1rem' }}>
        {info.freeTierNote}
      </p>
      <div role="radiogroup" aria-label="AI provider" className="provider-group">
        {PROVIDERS.map((p) => (
          <label key={p} className={provider === p ? 'provider selected' : 'provider'}>
            <input
              type="radio"
              name="provider"
              value={p}
              checked={provider === p}
              onChange={() => setProvider(p)}
            />
            <span className="name">{PROVIDER_INFO[p].label}</span>
            <span className="tier">{PROVIDER_INFO[p].freeTierNote}</span>
          </label>
        ))}
      </div>

      <h2>Paste your API key</h2>
      <p className="note">
        Get a key:{' '}
        <a href={info.keyUrl} target="_blank" rel="noreferrer">
          {info.keyUrl.replace(/^https:\/\//, '')}
        </a>
      </p>
      <div className="field" style={{ margin: '0.75rem 0 1.25rem' }}>
        <input
          aria-label="API key"
          type="password"
          value={apiKey}
          placeholder="Paste your key here"
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <button
        className="primary"
        disabled={apiKey.length < 10 || status.state === 'testing'}
        onClick={() => void handleTest()}
      >
        {status.state === 'testing' ? 'Testing key…' : 'Test key & start'}
      </button>
      {status.state === 'error' && (
        <p role="alert" className="error" style={{ marginTop: '1rem' }}>
          {status.message}
        </p>
      )}
      <p className="note" style={{ marginTop: '2rem' }}>
        Your key is stored only in this browser (localStorage) and sent only to the server running
        on your own machine.
      </p>
    </main>
  )
}

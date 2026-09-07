// server/index.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './index.js'

function makeWebRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fypgen-'))
  writeFileSync(join(root, 'index.html'), '<html><body>fypgen</body></html>')
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
  return root
}

describe('server', () => {
  it('health endpoint returns ok', async () => {
    const app = createApp({ webRoot: makeWebRoot() })
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('serves static assets', async () => {
    const app = createApp({ webRoot: makeWebRoot() })
    const res = await app.request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('console.log')
  })

  it('falls back to index.html for SPA routes', async () => {
    const app = createApp({ webRoot: makeWebRoot() })
    const res = await app.request('/outline')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('fypgen')
  })
})

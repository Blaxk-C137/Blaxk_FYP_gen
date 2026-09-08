import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootServer } from './boot.js'

describe('bootServer', () => {
  it('serves the SPA on a free port', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'fypgen-web-'))
    writeFileSync(join(webRoot, 'index.html'), '<html>fypgen</html>')
    const { port, close } = await bootServer({ webRoot, port: 0 })
    const res = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await close()
  })

  it('rejects when the requested port is already taken', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'fypgen-web-'))
    writeFileSync(join(webRoot, 'index.html'), '<html>fypgen</html>')
    const first = await bootServer({ webRoot, port: 0 })
    await expect(bootServer({ webRoot, port: first.port })).rejects.toThrow(/EADDRINUSE/)
    await first.close()
  })
})

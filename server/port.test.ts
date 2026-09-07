import { describe, it, expect } from 'vitest'
import { getFreePort } from './port.js'
import { createServer } from 'node:net'

describe('getFreePort', () => {
  it('returns a usable port number', async () => {
    const port = await getFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
    // binding to it succeeds
    await new Promise<void>((resolve, reject) => {
      const srv = createServer()
      srv.once('error', reject)
      srv.listen(port, () => srv.close(() => resolve()))
    })
  })
})

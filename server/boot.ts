import { serve } from '@hono/node-server'
import { createApp } from './index.js'
import { getFreePort } from './port.js'
import type { Hono } from 'hono'

export interface BootOptions {
  webRoot: string
  port?: number
  routes?: (app: Hono) => void
}

export async function bootServer(opts: BootOptions) {
  const port = opts.port ?? (await getFreePort())
  const app = createApp({ webRoot: opts.webRoot })
  opts.routes?.(app)
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
  // listen() is async: resolve on listening (port 0 = ephemeral), reject on error (e.g. EADDRINUSE)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

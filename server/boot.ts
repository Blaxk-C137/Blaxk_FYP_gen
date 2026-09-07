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
  // listen() is async: wait for it, and report the actual bound port (port 0 = ephemeral)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

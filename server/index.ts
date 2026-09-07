// server/index.ts
import { Hono } from 'hono'
import { spaStatic } from './static.js'

export function createApp({ webRoot }: { webRoot: string }) {
  const app = new Hono()
  app.get('/api/health', (c) => c.json({ ok: true }))
  // AI proxy routes are registered in Task 5.
  app.use('*', spaStatic(webRoot))
  return app
}

// server/static.ts
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'hono'

/** Serves webRoot assets; falls back to index.html so client-side routes resolve. */
export function spaStatic(webRoot: string) {
  const asset = serveStatic({ root: webRoot })
  return async (c: Context, next: () => Promise<void>) => {
    // serveStatic's c.body() only creates the Response — it must be returned,
    // or Hono leaves c.res as the default 404.
    const res = await asset(c, next)
    if (res && res.status !== 404) return res
    const index = join(webRoot, 'index.html')
    if (existsSync(index)) {
      return c.html(readFileSync(index, 'utf-8'))
    }
    return res
  }
}

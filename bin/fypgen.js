#!/usr/bin/env node
import { bootServer } from '../dist-server/server/boot.js'
import { openBrowser } from '../dist-server/server/openBrowser.js'
import { registerAIRoutes } from '../dist-server/server/routes.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..', 'web', 'dist')

// PORT pins the server to a fixed port (vite's dev proxy expects 5199);
// FYPGEN_NO_OPEN=1 skips opening a browser (used by the dev:api script).
const port = process.env.PORT ? Number(process.env.PORT) : undefined

const { port: actual } = await bootServer({ webRoot, port, routes: registerAIRoutes })
console.log(`fypgen running at http://127.0.0.1:${actual} — press Ctrl+C to stop`)
if (process.env.FYPGEN_NO_OPEN !== '1') {
  await openBrowser(`http://127.0.0.1:${actual}`)
}

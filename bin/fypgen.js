#!/usr/bin/env node
import { bootServer } from '../dist-server/server/boot.js'
import { openBrowser } from '../dist-server/server/openBrowser.js'
import { registerAIRoutes } from '../dist-server/server/routes.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..', 'web', 'dist')

// Default to port 3000; fall back to a free port if something else has it.
// PORT pins the server to a specific port (vite's dev proxy expects 3000);
// FYPGEN_NO_OPEN=1 skips opening a browser (used by the dev:api script).
const preferred = process.env.PORT ? Number(process.env.PORT) : 3000
let booted
try {
  booted = await bootServer({ webRoot, port: preferred, routes: registerAIRoutes })
} catch {
  if (process.env.PORT) {
    console.error(`fypgen: port ${preferred} is already in use — close what's using it or set PORT`)
    process.exit(1)
  }
  booted = await bootServer({ webRoot, routes: registerAIRoutes })
  console.log(`port 3000 was busy — using a free port instead`)
}
const { port: actual } = booted
console.log(`fypgen running at http://127.0.0.1:${actual} — press Ctrl+C to stop`)
if (process.env.FYPGEN_NO_OPEN !== '1') {
  await openBrowser(`http://127.0.0.1:${actual}`)
}

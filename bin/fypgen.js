#!/usr/bin/env node
import { bootServer } from '../dist-server/server/boot.js'
import { openBrowser } from '../dist-server/server/openBrowser.js'
import { registerAIRoutes } from '../dist-server/server/routes.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..', 'web', 'dist')

const { port } = await bootServer({ webRoot, routes: registerAIRoutes })
console.log(`fypgen running at http://127.0.0.1:${port} — press Ctrl+C to stop`)
await openBrowser(`http://127.0.0.1:${port}`)

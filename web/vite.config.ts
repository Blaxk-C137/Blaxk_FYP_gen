/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  server: {
    proxy: { '/api': 'http://127.0.0.1:5199' }, // dev: forward API to a local bootServer
  },
  test: { environment: 'jsdom' },
})

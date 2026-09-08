import { test, expect } from '@playwright/test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let port: number
let close: () => Promise<void>

test.beforeAll(async () => {
  // Set before importing the server so REGISTRY registers the mock provider
  process.env.FYPGEN_MOCK = '1'
  const { bootServer } = await import('../dist-server/server/boot.js')
  const { registerAIRoutes } = await import('../dist-server/server/routes.js')
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
  const booted = await bootServer({ webRoot, port: 0, routes: registerAIRoutes })
  port = booted.port
  close = booted.close
})
test.afterAll(async () => { await close() })

test('topic → outline → chapter → docx download', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  // Onboarding
  await page.getByLabel('API key').fill('mock-key-123456')
  await page.getByRole('button', { name: /test key/i }).click()
  // Project setup
  await page.getByLabel(/^Topic/i).fill('IoT-based theft detection for campus laboratories')
  await page.getByRole('button', { name: /continue/i }).click()
  // Outline (titles render as editable textboxes)
  await expect(page.getByLabel('Chapter 1 title')).toHaveValue('INTRODUCTION')
  await page.getByRole('button', { name: /approve outline/i }).click()
  // Generate chapter one
  await page.getByRole('button', { name: 'Generate', exact: true }).first().click()
  await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 10_000 })
  // Review + export
  await page.getByRole('button', { name: /review your project/i }).click()
  await page.getByRole('button', { name: /continue to export/i }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /download docx/i }).click()
  const dl = await download
  expect(dl.suggestedFilename()).toMatch(/\.docx$/)
})

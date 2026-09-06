// shared/constants.test.ts
import { describe, it, expect } from 'vitest'
import { PROVIDERS, DEFAULT_MODELS, PROVIDER_INFO } from './constants.js'

describe('constants', () => {
  it('lists three providers with default models', () => {
    expect(PROVIDERS).toEqual(['gemini', 'openai', 'anthropic'])
    expect(DEFAULT_MODELS.gemini).toBe('gemini-2.5-flash')
    expect(DEFAULT_MODELS.openai).toBe('gpt-4o-mini')
    expect(DEFAULT_MODELS.anthropic).toBe('claude-haiku-4-5-20251001')
  })
  it('gives each provider a keyUrl and label for onboarding', () => {
    for (const id of PROVIDERS) {
      expect(PROVIDER_INFO[id].label).toBeTruthy()
      expect(PROVIDER_INFO[id].keyUrl).toMatch(/^https:\/\//)
      expect(PROVIDER_INFO[id].freeTierNote).toBeTruthy()
    }
  })
})

import type { AIProvider } from './types.js'
import type { ProviderId } from '../../shared/constants.js'
import { gemini } from './gemini.js'
import { openai } from './openai.js'
import { anthropic } from './anthropic.js'
import { mock } from './mock.js'

export const REGISTRY: Record<ProviderId, AIProvider> = {
  gemini: process.env.FYPGEN_MOCK === '1' ? mock : gemini,
  openai,
  anthropic,
}

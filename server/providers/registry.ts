import type { AIProvider } from './types.js'
import type { ProviderId } from '../../shared/constants.js'
import { gemini } from './gemini.js'
import { openai } from './openai.js'
import { anthropic } from './anthropic.js'

export const REGISTRY: Record<ProviderId, AIProvider> = {
  gemini,
  openai,
  anthropic,
}

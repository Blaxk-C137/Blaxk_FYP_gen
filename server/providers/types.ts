import type { ProviderId } from '../../shared/constants.js'

export interface ChatRequest {
  apiKey: string
  model?: string
  system: string
  prompt: string
}

export interface AIProvider {
  id: ProviderId
  defaultModel: string
  testKey(apiKey: string): Promise<{ ok: boolean; error?: string }>
  stream(req: ChatRequest): AsyncGenerator<string>
}

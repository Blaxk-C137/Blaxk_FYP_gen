import type { ProviderId } from '../../shared/constants.js'

export interface ChatRequest {
  apiKey: string
  model?: string
  system: string
  prompt: string
  temperature?: number
}

/** Optional image-generation capability (providers without it simply omit it). */
export interface ImageRequest {
  apiKey: string
  model?: string
  prompt: string
}

export interface AIProvider {
  id: ProviderId
  defaultModel: string
  testKey(apiKey: string): Promise<{ ok: boolean; error?: string }>
  stream(req: ChatRequest): AsyncGenerator<string>
  generateImage?(req: ImageRequest): Promise<{ base64: string }>
}

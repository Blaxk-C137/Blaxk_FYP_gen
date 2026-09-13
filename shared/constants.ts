// shared/constants.ts
export type ProviderId = 'gemini' | 'openai' | 'anthropic'

export const PROVIDERS: ProviderId[] = ['gemini', 'openai', 'anthropic']

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
}

/** One structured citation from the AI; the server formats + verifies it. */
export interface ReferenceInput {
  key: string; authors: string; year: string; title: string
  container?: string; volume?: string; issue?: string; pages?: string; doi?: string
}

export interface ProviderInfo {
  label: string
  keyUrl: string
  freeTierNote: string
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    freeTierNote: 'Recommended — the free tier is generous. A full project uses about 4% of your daily free allowance.',
  },
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    freeTierNote: 'Requires a paid balance (a few cents per project).',
  },
  anthropic: {
    label: 'Anthropic Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    freeTierNote: 'Requires a paid balance (a few cents per project).',
  },
}

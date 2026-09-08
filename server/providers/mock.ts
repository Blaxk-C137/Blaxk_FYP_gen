import type { AIProvider } from './types.js'

const OUTLINE_JSON = JSON.stringify({
  abstract: 'This study designs a campus theft detection system.',
  chapters: [
    { title: 'INTRODUCTION', sections: [{ heading: 'Background of the Study', description: 'context' }] },
    { title: 'LITERATURE REVIEW', sections: [{ heading: 'Conceptual Framework', description: 'theory' }] },
    { title: 'METHODOLOGY', sections: [{ heading: 'System Design', description: 'design' }] },
    { title: 'RESULTS AND ANALYSIS', sections: [{ heading: 'Testing Results', description: 'results' }] },
    { title: 'CONCLUSION AND RECOMMENDATIONS', sections: [{ heading: 'Summary', description: 'summary' }] },
  ],
})

const textFor = (prompt: string): string => {
  if (prompt.includes('JSON object')) return '```json\n' + OUTLINE_JSON + '\n```'
  if (prompt.includes('defense questions'))
    return 'Chapter 1 — INTRODUCTION\nQ: Why this topic?\nA: Campus theft is common.\n\nChapter 3 — METHODOLOGY\nQ: Which sensors?\nA: PIR motion sensors.'
  const chapter = prompt.match(/Write CHAPTER (\w+)/)?.[1] ?? 'ONE'
  return `CHAPTER ${chapter}\n1.1 Background of the Study\nMock body text for testing chapter ${chapter}.\n\nReferences\nDoe, J. (2020). Sensors. Journal of Things, 5(2), 10-20.`
}

export const mock: AIProvider = {
  id: 'gemini', // masquerades as the default provider so the client needs no special-casing
  defaultModel: 'mock',

  async testKey() {
    return { ok: true }
  },

  async *stream({ prompt }) {
    for (const chunk of textFor(prompt).match(/.{1,20}/gs) ?? []) {
      yield chunk
    }
  },
}

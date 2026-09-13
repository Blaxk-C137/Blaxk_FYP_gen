import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from './store'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ settings: { provider: 'gemini', apiKey: '' }, project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '' })
})

describe('store', () => {
  it('setSettings stores provider and key', () => {
    useAppStore.getState().setSettings({ provider: 'openai', apiKey: 'sk-x' })
    expect(useAppStore.getState().settings).toEqual({ provider: 'openai', apiKey: 'sk-x' })
  })

  it('setOutline replaces chapters and abstract', () => {
    const ch = [{ number: 1, title: 'INTRODUCTION', sections: [{ heading: 'Background', description: 'd' }], status: 'pending' as const, text: '' }]
    useAppStore.getState().setOutline(ch, 'An abstract')
    expect(useAppStore.getState().chapters).toHaveLength(1)
    expect(useAppStore.getState().abstract).toBe('An abstract')
  })

  it('appendChapterText accumulates and updateChapter patches', () => {
    useAppStore.getState().appendChapterText(1, 'Hello ')
    useAppStore.getState().appendChapterText(1, 'world')
    expect(useAppStore.getState().chapters[0].text).toBe('Hello world')
    useAppStore.getState().updateChapter(1, { status: 'done' })
    expect(useAppStore.getState().chapters[0].status).toBe('done')
  })

  it('persists to localStorage', () => {
    useAppStore.getState().setSettings({ provider: 'gemini', apiKey: 'k' })
    expect(localStorage.getItem('fypgen-state')).toContain('gemini')
  })
})

describe('slideTheme default', () => {
  it('defaults to forest (the example deck green)', () => {
    expect(useAppStore.getState().slideTheme).toBe('forest')
  })

  it('survives reset — theme is a preference, not project data', () => {
    useAppStore.getState().setSlideTheme('slate')
    useAppStore.getState().reset()
    expect(useAppStore.getState().slideTheme).toBe('slate')
  })
})

describe('references entries (v2 persist migration)', () => {
  it('setReferences stores typed entries', () => {
    useAppStore.getState().setReferences([
      { key: 'A, 2020', apa: 'A (2020). Title.', verified: true, doi: '10.1/x' },
      { key: 'B, 2021', apa: 'B (2021). Other.', verified: false },
    ])
    expect(useAppStore.getState().references[0]).toMatchObject({ verified: true, doi: '10.1/x' })
    useAppStore.getState().setReferences([])
  })

  it('reset clears references', () => {
    useAppStore.getState().setReferences([{ key: 'k', apa: 'a', verified: false }])
    useAppStore.getState().reset()
    expect(useAppStore.getState().references).toEqual([])
  })
})

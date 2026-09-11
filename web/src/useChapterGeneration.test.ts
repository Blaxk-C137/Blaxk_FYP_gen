// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChapterGeneration } from './useChapterGeneration'
import { useAppStore, initialChapterState, EMPTY_PROJECT } from './state/store'

const streamFn = vi.fn()
vi.mock('./api', () => ({ generateStream: (...args: unknown[]) => streamFn(...args) }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    settings: { provider: 'gemini', apiKey: 'k' },
    project: { ...EMPTY_PROJECT, topic: 'IoT' },
    chapters: initialChapterState(),
    abstract: '',
  })
})

describe('useChapterGeneration', () => {
  it('streams a chapter: pending → streaming → done, text accumulated', async () => {
    streamFn.mockImplementation(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        onChunk('Chapter one ')
        onChunk('text.')
        return 'Chapter one text.'
      }
    )
    const { result } = renderHook(() => useChapterGeneration())
    await act(() => result.current.generate(1))
    const ch = useAppStore.getState().chapters[0]
    expect(ch.status).toBe('done')
    // fixChapterText (Layer 2) ensures the chapter opens with a CHAPTER heading
    expect(ch.text).toBe('CHAPTER ONE\nChapter one text.\n')
  })

  it('mid-stream failure keeps partial text and exposes Continue', async () => {
    streamFn.mockImplementation(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        onChunk('partial ')
        throw new Error('network died')
      }
    )
    const { result } = renderHook(() => useChapterGeneration())
    await act(() => result.current.generate(1).catch(() => {}))
    const ch = useAppStore.getState().chapters[0]
    expect(ch.text).toBe('partial ')
    expect(result.current.continuing).toBe(1)

    // Continue resumes with the partial text as continuation; streamed chunks append
    streamFn.mockImplementation(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        onChunk('continued')
        return 'partial continued'
      }
    )
    await act(() => result.current.continueChapter(1))
    expect(useAppStore.getState().chapters[0].text).toBe('CHAPTER ONE\npartial continued\n')
    expect(result.current.continuing).toBeNull()
  })

  it('generateAll skips done chapters', async () => {
    // computing-engineering: no questionnaire appendix, so exactly 4 streams
    useAppStore.setState({
      chapters: initialChapterState().map((c) =>
        c.number === 1 ? { ...c, status: 'done' as const, text: 'existing' } : c
      ),
      project: { ...EMPTY_PROJECT, topic: 'IoT', track: 'computing-engineering' },
    })
    streamFn.mockResolvedValue('generated')
    const { result } = renderHook(() => useChapterGeneration())
    await act(() => result.current.generateAll())
    expect(streamFn).toHaveBeenCalledTimes(4)
    expect(useAppStore.getState().chapters[0].text).toBe('existing')
  })

  it('generateAll adds a questionnaire appendix for social-survey projects', async () => {
    useAppStore.setState({
      project: { ...EMPTY_PROJECT, topic: 'Broken homes and academic performance', track: 'social-survey' },
    })
    let questionnairePromptArg = ''
    streamFn.mockImplementation(
      async (_s, _sys, prompt: string, _onChunk: (c: string) => void) => {
        if (prompt.includes('QUESTIONNAIRE')) {
          questionnairePromptArg = prompt
          return 'APPENDIX I: QUESTIONNAIRE\nSection A: Demographics…'
        }
        return 'chapter body'
      }
    )
    const { result } = renderHook(() => useChapterGeneration())
    await act(() => result.current.generateAll())
    // 5 chapters + 1 questionnaire
    expect(streamFn).toHaveBeenCalledTimes(6)
    expect(questionnairePromptArg).toContain('Broken homes')
    const appendix = useAppStore.getState().chapters.find((c) => c.number === 6)
    expect(appendix?.title).toBe('QUESTIONNAIRE')
    expect(appendix?.text).toContain('APPENDIX: QUESTIONNAIRE')
    expect(appendix?.text).toContain('Demographics')
  })
})

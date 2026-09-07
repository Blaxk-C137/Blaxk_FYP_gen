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
    expect(ch.text).toBe('Chapter one text.')
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
    expect(useAppStore.getState().chapters[0].text).toBe('partial continued')
    expect(result.current.continuing).toBeNull()
  })

  it('generateAll skips done chapters', async () => {
    useAppStore.setState({
      chapters: initialChapterState().map((c) =>
        c.number === 1 ? { ...c, status: 'done' as const, text: 'existing' } : c
      ),
    })
    streamFn.mockResolvedValue('generated')
    const { result } = renderHook(() => useChapterGeneration())
    await act(() => result.current.generateAll())
    expect(streamFn).toHaveBeenCalledTimes(4)
    expect(useAppStore.getState().chapters[0].text).toBe('existing')
  })
})

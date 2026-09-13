// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Generate } from './Generate'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'
import { generateStream } from '../api'

vi.mock('../api', () => ({
  generateStream: vi.fn(async (_s, _sys, _p, onChunk: (c: string) => void) => {
    onChunk('CHAPTER ONE body text')
    return 'CHAPTER ONE body text'
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    settings: { provider: 'gemini', apiKey: 'k' },
    project: { ...EMPTY_PROJECT, topic: 'IoT' },
    chapters: initialChapterState(),
    abstract: '',
    references: [],
  })
})

describe('Generate screen', () => {
  it('renders chapter cards and streams one chapter on click', async () => {
    render(<Generate />)
    expect(screen.getByText(/CHAPTER ONE/)).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: /generate/i })[0])
    await waitFor(() =>
      expect(useAppStore.getState().chapters[0].status).toBe('done')
    )
    expect(useAppStore.getState().chapters[0].text).toContain('body text')
  })

  it('regenerates once with a violation nudge when a chapter is unfixable', async () => {
    const streamMock = vi.mocked(generateStream)
    streamMock.mockReset()
    // First attempt: heading + a REFERENCES list and nothing else — the body is
    // empty, which guardrails cannot fix mechanically (unfixed violation).
    streamMock.mockImplementationOnce(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        const text = 'CHAPTER ONE\n\nREFERENCES\nDoe, J. (2020). A study. Journal, 1(1), 1–2.'
        onChunk(text)
        return text
      }
    )
    // Second attempt (the regen): clean
    streamMock.mockImplementationOnce(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        const text = 'CHAPTER ONE\n1.1 Background\nA study.'
        onChunk(text)
        return text
      }
    )

    render(<Generate />)
    await userEvent.click(screen.getAllByRole('button', { name: /generate/i })[0])
    await waitFor(() =>
      expect(useAppStore.getState().chapters[0].status).toBe('done')
    )

    // Exactly one retry fired, with the violation detail in the nudge
    expect(streamMock).toHaveBeenCalledTimes(2)
    const retryPrompt = streamMock.mock.calls[1][2]
    expect(retryPrompt).toContain('body text')

    // The clean second attempt is accepted
    expect(useAppStore.getState().chapters[0].text).toBe('CHAPTER ONE\n1.1 Background\nA study.\n')

    // References extracted from the first attempt landed in the store
    expect(useAppStore.getState().references).toContainEqual(
      expect.objectContaining({ apa: 'Doe, J. (2020). A study. Journal, 1(1), 1–2.', verified: false })
    )
  })

  it('dedupes repeated APA lines within a single extracted batch', async () => {
    const streamMock = vi.mocked(generateStream)
    streamMock.mockReset()
    // A chapter whose REFERENCES list repeats the same line — the merge
    // must keep it exactly once.
    streamMock.mockImplementationOnce(
      async (_s, _sys, _p, onChunk: (c: string) => void) => {
        const line = 'Doe, J. (2020). A study. Journal, 1(1), 1–2.'
        const text = `CHAPTER ONE\n1.1 Background\nA study.\n\nREFERENCES\n${line}\n${line}`
        onChunk(text)
        return text
      }
    )

    render(<Generate />)
    await userEvent.click(screen.getAllByRole('button', { name: /generate/i })[0])
    await waitFor(() =>
      expect(useAppStore.getState().chapters[0].status).toBe('done')
    )

    const apas = useAppStore.getState().references.map((r) => r.apa)
    expect(apas).toEqual(['Doe, J. (2020). A study. Journal, 1(1), 1–2.'])
  })
})

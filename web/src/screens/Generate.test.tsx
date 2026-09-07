// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Generate } from './Generate'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

vi.mock('../api', () => ({
  generateStream: vi.fn(async (_s, _sys, _p, onChunk: (c: string) => void) => {
    onChunk('CHAPTER ONE body text')
    return 'CHAPTER ONE body text'
  }),
}))

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({
    settings: { provider: 'gemini', apiKey: 'k' },
    project: { ...EMPTY_PROJECT, topic: 'IoT' },
    chapters: initialChapterState(),
    abstract: '',
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
})

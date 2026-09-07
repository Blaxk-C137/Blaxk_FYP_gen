// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Review } from './Review'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ settings: { provider: 'gemini', apiKey: 'k' }, project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '' })
})

describe('Review', () => {
  it('shows all generated chapters with word counts and a total', () => {
    useAppStore.getState().setOutline(
      [
        { number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'one two three four five' },
        { number: 2, title: 'LITERATURE REVIEW', sections: [], status: 'done', text: 'six seven' },
      ],
      'abs'
    )
    render(<Review onNext={() => {}} />)
    expect(screen.getByText(/INTRODUCTION/)).toBeTruthy()
    expect(screen.getByText(/5 words/)).toBeTruthy()
    expect(screen.getByText(/Total: 7 words/)).toBeTruthy()
  })

  it('edits chapter text inline', async () => {
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'original' }],
      'abs'
    )
    render(<Review onNext={() => {}} />)
    const ta = screen.getByLabelText(/Chapter 1 text/i) as HTMLTextAreaElement
    await userEvent.clear(ta)
    await userEvent.type(ta, 'edited')
    expect(useAppStore.getState().chapters[0].text).toBe('edited')
  })
})

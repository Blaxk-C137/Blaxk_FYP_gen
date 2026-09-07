// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSetup } from './ProjectSetup'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ settings: { provider: 'gemini', apiKey: '' }, project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '' })
})

describe('ProjectSetup', () => {
  it('persists form fields and advances when topic is filled', async () => {
    const onNext = vi.fn()
    render(<ProjectSetup onNext={onNext} />)
    await userEvent.type(screen.getByLabelText(/^Topic/i), 'IoT theft detection')
    await userEvent.type(screen.getByLabelText(/Student name/i), 'Aisha Musa')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onNext).toHaveBeenCalled()
    expect(useAppStore.getState().project.topic).toBe('IoT theft detection')
  })

  it('blocks advance with an empty topic', async () => {
    render(<ProjectSetup onNext={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/enter a topic/i)).toBeTruthy()
  })
})

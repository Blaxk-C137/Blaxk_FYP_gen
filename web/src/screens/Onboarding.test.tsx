// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Onboarding } from './Onboarding'
import { useAppStore } from '../state/store'

vi.mock('../api', () => ({
  testKey: vi.fn().mockResolvedValue({ ok: false, error: 'bad key' }),
}))
import { testKey } from '../api'

describe('Onboarding', () => {
  it('saves settings when the key tests ok and calls onDone', async () => {
    ;(testKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true })
    render(<Onboarding onDone={() => {}} />)
    await userEvent.type(screen.getByLabelText(/API key/i), 'AIza-test-key')
    await userEvent.click(screen.getByRole('button', { name: /test key/i }))
    await waitFor(() =>
      expect(useAppStore.getState().settings).toEqual({ provider: 'gemini', apiKey: 'AIza-test-key' })
    )
  })

  it('shows the provider error when the key fails', async () => {
    render(<Onboarding onDone={() => {}} />)
    await userEvent.type(screen.getByLabelText(/API key/i), 'bad-key-123456')
    await userEvent.click(screen.getByRole('button', { name: /test key/i }))
    expect(await screen.findByText('bad key')).toBeTruthy()
  })
})

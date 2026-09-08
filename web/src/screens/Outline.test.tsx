// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outline } from './Outline'
import { useAppStore, EMPTY_PROJECT } from '../state/store'

vi.mock('../api', () => ({
  // vi.mock factories are hoisted — keep all data inline, no top-level refs
  generateStream: vi.fn().mockResolvedValue(
    '```json\n' +
      JSON.stringify({
        abstract: 'A study.',
        chapters: [
          { title: 'INTRODUCTION', sections: [{ heading: 'Background of the Study', description: 'd' }] },
          { title: 'LITERATURE REVIEW', sections: [] },
          { title: 'METHODOLOGY', sections: [] },
          { title: 'RESULTS AND ANALYSIS', sections: [] },
          { title: 'CONCLUSION AND RECOMMENDATIONS', sections: [] },
        ],
      }) +
      '\n```'
  ),
}))

describe('Outline', () => {
  it('generates an outline on mount, stores it, and lets you approve it', async () => {
    useAppStore.getState().setProject({ ...EMPTY_PROJECT, topic: 'IoT' })
    const onNext = vi.fn()
    render(<Outline onNext={onNext} />)
    expect(await screen.findByDisplayValue('INTRODUCTION')).toBeTruthy()
    expect(useAppStore.getState().chapters[0].sections[0].heading).toBe('Background of the Study')
    await userEvent.click(screen.getByRole('button', { name: /approve outline/i }))
    expect(onNext).toHaveBeenCalled()
  })
})

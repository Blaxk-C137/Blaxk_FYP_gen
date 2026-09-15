// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outline } from './Outline'
import { useAppStore, EMPTY_PROJECT } from '../state/store'

const searchRefs = vi.fn()
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
  searchReferences: (...args: unknown[]) => searchRefs(...args),
}))

const POOL = [
  { key: '(Okonkwo, 2019)', authors: 'Okonkwo, C.', year: '2019', title: 'Campus security', apa: 'Okonkwo, C. (2019). Campus security. J.', doi: '10.1/x' },
]

beforeEach(() => {
  vi.clearAllMocks()
  searchRefs.mockResolvedValue(POOL)
  useAppStore.getState().setProject({ ...EMPTY_PROJECT, topic: 'IoT' })
  useAppStore.getState().setReferencePool([])
})

describe('Outline', () => {
  it('generates an outline on mount, stores it, and lets you approve it', async () => {
    const onNext = vi.fn()
    render(<Outline onNext={onNext} />)
    expect(await screen.findByDisplayValue('INTRODUCTION')).toBeTruthy()
    expect(useAppStore.getState().chapters[0].sections[0].heading).toBe('Background of the Study')
    await userEvent.click(screen.getByRole('button', { name: /approve outline/i }))
    // Pool lands in the store before the wizard advances
    await vi.waitFor(() => expect(onNext).toHaveBeenCalled())
    expect(useAppStore.getState().referencePool).toEqual(POOL)
    expect(useAppStore.getState().poolLoaded).toBe(true)
  })

  it('searches Crossref with the topic and outline section headings as keywords', async () => {
    render(<Outline onNext={vi.fn()} />)
    await screen.findByDisplayValue('INTRODUCTION')
    await userEvent.click(screen.getByRole('button', { name: /approve outline/i }))
    await vi.waitFor(() => expect(searchRefs).toHaveBeenCalled())
    const [topic, keywords] = searchRefs.mock.calls[0]
    expect(topic).toBe('IoT')
    expect(keywords).toContain('Background of the Study')
  })

  it('empty pool offers retry and an explicit continue-without-citations path', async () => {
    searchRefs.mockResolvedValue([])
    const onNext = vi.fn()
    render(<Outline onNext={onNext} />)
    await screen.findByDisplayValue('INTRODUCTION')
    await userEvent.click(screen.getByRole('button', { name: /approve outline/i }))
    expect(await screen.findByText(/couldn't load a verified source pool/i)).toBeTruthy()
    expect(onNext).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /continue without citations/i }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().poolLoaded).toBe(true)
  })
})

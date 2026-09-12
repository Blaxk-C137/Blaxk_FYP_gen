// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Export } from './Export'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

vi.mock('../api', () => ({ generateStream: vi.fn() }))
vi.mock('../export/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('../export/docx', async (orig) => ({
  ...(await orig<typeof import('../export/docx')>()),
  buildDocx: vi.fn().mockResolvedValue(new Blob(['x'])),
}))
vi.mock('../export/pptx', () => ({
  buildPptx: vi.fn().mockResolvedValue(new Blob(['y'])),
  slideContentFromChapters: vi.fn().mockReturnValue({ outline: [], bg: [], prob: [], gen_obj: '', spec_obj: [], scope_pts: [], sig_pts: [], method: [], findings: [], discuss: [], conc_pts: [], recs: [] }),
}))

import { downloadBlob } from '../export/download'
import { generateStream } from '../api'
import { buildPptx, slideContentFromChapters } from '../export/pptx'

const slideJson = JSON.stringify({
  outline: ['Background & Problem Statement', 'Objectives of the Study', 'Scope & Significance', 'Methodology', 'Results & Analysis', 'Conclusion & Recommendations'],
  bg: ['Theft is common'], prob: ['Watchmen unreliable'],
  gen_obj: 'To detect theft.', spec_obj: ['Sense motion'],
  scope_pts: ['Two labs'], sig_pts: ['Protects assets'],
  method: [{ title: 'Research Design', detail: 'Prototype.' }],
  findings: ['98% detection'], discuss: ['Cheap'],
  conc_pts: ['It works'], recs: ['Scale up'],
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({ settings: { provider: 'gemini', apiKey: 'k' }, project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '', slideTheme: 'navy' })
})

describe('Export screen', () => {
  it('downloads a DOCX on click', async () => {
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'body' }],
      'abstract'
    )
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect((downloadBlob as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/\.docx$/)
  })
})

describe('Export screen — defense slides', () => {
  function seedProject() {
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'body' }],
      'abstract'
    )
  }

  it('theme picker updates the persisted preference', async () => {
    render(<Export />)
    const forest = screen.getByRole('radio', { name: /forest green/i })
    expect(forest.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(forest)
    expect(useAppStore.getState().slideTheme).toBe('forest')
    expect(forest.getAttribute('aria-checked')).toBe('true')
  })

  it('PPTX click: generates Q&A then slide content, builds with both', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')   // defense Q&A
      .mockResolvedValueOnce(`\`\`\`json\n${slideJson}\n\`\`\``)                    // slide content
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect((downloadBlob as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/-defense\.pptx$/)
    const [, , qa, content, theme] = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(qa).toContain('Q: Why?')
    expect(content.gen_obj).toBe('To detect theft.')
    expect(theme).toBe('navy')
  })

  it('reuses cached Q&A and slide content on a second click (one AI call each)', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(slideJson)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2))
    expect(generateStream).toHaveBeenCalledTimes(2) // not 4
  })

  it('structuring failure offers retry and the section-headings fallback', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockRejectedValueOnce(new Error('quota exceeded'))
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    expect(await screen.findByText(/quota exceeded/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    const fallback = screen.getByRole('button', { name: /use section headings/i })

    ;(generateStream as ReturnType<typeof vi.fn>).mockClear()
    await userEvent.click(fallback)
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(generateStream).not.toHaveBeenCalled()      // fallback makes no AI call
    const [, , , content] = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(content).toBe((slideContentFromChapters as ReturnType<typeof vi.fn>).mock.results[0].value)
  })

  it('retry re-runs the structuring call', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(slideJson)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  })
})

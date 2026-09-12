// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Export } from './Export'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

vi.mock('../api', () => ({ generateStream: vi.fn().mockResolvedValue('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.') }))
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

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({ settings: { provider: 'gemini', apiKey: 'k' }, project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '' })
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

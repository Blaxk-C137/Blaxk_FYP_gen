// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Export } from './Export'
import { useAppStore, EMPTY_PROJECT, initialChapterState } from '../state/store'

vi.mock('../api', () => ({ generateStream: vi.fn(), resolveReferences: vi.fn(), fetchLogo: vi.fn(), generateImage: vi.fn() }))
vi.mock('../export/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('../export/docx', async (orig) => ({
  ...(await orig<typeof import('../export/docx')>()),
  buildDocx: vi.fn().mockResolvedValue(new Blob(['x'])),
}))
vi.mock('../export/pptx', () => ({
  buildPptx: vi.fn().mockResolvedValue(new Blob(['y'])),
  slideContentFromChapters: vi.fn().mockReturnValue({
    aim: 'Objectives of the Study',
    bullets: {
      intro: [], problem: [], objectives: [], scope: [], significance: [], literature: [],
      methodology: [], sysdesign: [], implementation: [], results: [], discussion: [], conclusion: [],
    },
    notes: {},
    images: [],
  }),
}))

import { downloadBlob } from '../export/download'
import { generateStream, fetchLogo, generateImage } from '../api'
import { buildPptx, slideContentFromChapters } from '../export/pptx'
import { buildDocx } from '../export/docx'

const slideJson = JSON.stringify({
  aim: 'To detect theft.',
  bullets: {
    intro: ['Theft is common'], problem: ['Watchmen unreliable'], objectives: ['Sense motion'],
    scope: ['Two labs'], significance: ['Protects assets'], literature: ['IoT sensing is mature'],
    methodology: ['Prototype it'], sysdesign: ['PIR sensors'], implementation: ['Firmware'],
    results: ['98% detection'], discussion: ['Cheap'], conclusion: ['It works'],
  },
  notes: {},
  images: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    settings: { provider: 'gemini', apiKey: 'k' }, project: EMPTY_PROJECT,
    chapters: initialChapterState(), abstract: '', slideTheme: 'forest',
    references: [], referencePool: [], poolLoaded: false,
  })
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
    expect(forest.getAttribute('aria-checked')).toBe('true') // store default rides
    await userEvent.click(screen.getByRole('radio', { name: /deep navy/i }))
    expect(useAppStore.getState().slideTheme).toBe('navy')
    expect(forest.getAttribute('aria-checked')).toBe('false')
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
    const [, , qa, content, refs, theme, opts] = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(qa).toContain('Q: Why?')
    expect(content.aim).toBe('To detect theft.')
    expect(refs).toEqual([])
    expect(theme).toBe('forest')
    expect(opts).toEqual({ logo: null, images: {} }) // no university, no image prompts
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

describe('Export screen — pool-based references', () => {
  function seedChapters() {
    useAppStore.getState().setOutline([{
      number: 1, title: 'INTRODUCTION', status: 'done' as const,
      sections: [], text: 'CHAPTER ONE\nSecurity matters (Okonkwo, 2019) on campus.',
    }], 'abstract')
  }

  const POOL = [
    { key: '(Okonkwo, 2019)', authors: 'Okonkwo, C.', year: '2019', title: 'Campus security', container: 'J', apa: 'Okonkwo, C. (2019). Campus security. J.', doi: '10.1/x' },
    { key: '(Smith, 2021)', authors: 'Smith, J.', year: '2021', title: 'Unrelated work', apa: 'Smith, J. (2021). Unrelated work. K.', doi: '10.2/y' },
  ]

  it('DOCX export turns cited pool entries into verified references — no AI call, no recall', async () => {
    seedChapters()
    useAppStore.getState().setReferences([])
    useAppStore.getState().setReferencePool(POOL)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(generateStream).not.toHaveBeenCalled()
    const refs = (buildDocx as ReturnType<typeof vi.fn>).mock.calls[0][3]
    // Only the cited entry, verified by construction (Crossref metadata)
    expect(refs).toEqual([expect.objectContaining({ key: '(Okonkwo, 2019)', verified: true, doi: '10.1/x' })])
    expect(useAppStore.getState().references[0]).toMatchObject({ verified: true })
  })

  it('a second export is a cache hit — no new calls, store unchanged', async () => {
    seedChapters()
    useAppStore.getState().setReferencePool(POOL)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2))
    expect(generateStream).not.toHaveBeenCalled()
    expect((buildDocx as ReturnType<typeof vi.fn>).mock.calls[1][3].length).toBe(1)
  })

  it('unverified Layer-2 entries survive alongside the pool match (different APA)', async () => {
    seedChapters()
    useAppStore.getState().setReferences([{ key: '', apa: 'Okonkwo, C. (2019). Campus security.', verified: false }])
    useAppStore.getState().setReferencePool(POOL)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const refs = (buildDocx as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(refs.some((r: { verified: boolean }) => r.verified)).toBe(true)
    expect(refs.some((r: { apa: string; verified: boolean }) => r.apa === 'Okonkwo, C. (2019). Campus security.' && !r.verified)).toBe(true)
  })

  it('empty pool (offline) degrades to the store as-is — export still succeeds', async () => {
    seedChapters()
    const manual = [{ key: '', apa: 'Okonkwo, C. (2019). Campus security.', verified: false }]
    useAppStore.getState().setReferences(manual)
    useAppStore.getState().setReferencePool([])
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download docx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const refs = (buildDocx as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(refs).toEqual(manual)
  })
})

describe('Export screen — pptx flow v2', () => {
  function seedProject() {
    useAppStore.getState().setProject({ university: 'Bayero University Kano' })
    useAppStore.getState().setOutline(
      [{ number: 1, title: 'INTRODUCTION', sections: [], status: 'done', text: 'body' }],
      'abstract'
    )
    useAppStore.getState().setReferences([{ key: 'k', apa: 'A (2020). T.', verified: true }])
  }

  it('fetches the logo, generates slide images, and builds with all of them', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(JSON.stringify({ aim: 'Aim.', bullets: { intro: ['x'] }, notes: {}, images: [{ slide: 'sysdesign', prompt: 'a diagram' }] }))
    ;(fetchLogo as ReturnType<typeof vi.fn>).mockResolvedValue({ base64: 'bG9nbw==', mime: 'image/png' })
    ;(generateImage as ReturnType<typeof vi.fn>).mockResolvedValue('aW1n')
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(fetchLogo).toHaveBeenCalledWith('Bayero University Kano')
    expect(generateImage).toHaveBeenCalledWith(expect.anything(), 'a diagram')
    const args = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[5]).toBe('forest')                       // default theme
    expect(args[6].logo).toEqual({ base64: 'bG9nbw==', mime: 'image/png' })
    expect(args[6].images.sysdesign).toBe('aW1n')
    expect(args[4][0]).toMatchObject({ verified: true }) // typed references
  })

  it('logo and image failures degrade to null — export still succeeds', async () => {
    seedProject()
    ;(generateStream as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Chapter 1 — INTRODUCTION\nQ: Why?\nA: Because.')
      .mockResolvedValueOnce(JSON.stringify({ aim: 'Aim.', bullets: { intro: ['x'] }, notes: {}, images: [{ slide: 'results', prompt: 'chart' }] }))
    ;(fetchLogo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(generateImage as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(<Export />)
    await userEvent.click(screen.getByRole('button', { name: /download pptx/i }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const args = (buildPptx as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[6].logo).toBeNull()
    expect(args[6].images.results).toBeUndefined()
  })
})

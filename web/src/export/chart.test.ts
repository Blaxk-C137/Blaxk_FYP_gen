import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeSpec, renderChartPng, PALETTE } from './chart'

describe('normalizeSpec', () => {
  const bar = { type: 'bar', title: 'T', data: { A: 3, B: 5 } } as const

  it('passes a valid bar spec through with entries', () => {
    expect(normalizeSpec(bar)).toEqual({
      type: 'bar', title: 'T', ylabel: undefined, entries: [['A', 3], ['B', 5]],
    })
  })

  it('rejects null/undefined specs', () => {
    expect(normalizeSpec(null)).toBeNull()
    expect(normalizeSpec(undefined)).toBeNull()
  })

  it('rejects unknown chart types', () => {
    expect(normalizeSpec({ type: 'scatter', data: { A: 1 } })).toBeNull()
    expect(normalizeSpec({ data: { A: 1 } })).toBeNull()
  })

  it('rejects missing, empty, or non-numeric data', () => {
    expect(normalizeSpec({ type: 'bar' })).toBeNull()
    expect(normalizeSpec({ type: 'bar', data: {} })).toBeNull()
    expect(normalizeSpec({ type: 'bar', data: { A: 'x', B: null } })).toBeNull()
  })

  it('keeps only finite numeric values', () => {
    const out = normalizeSpec({ type: 'bar', data: { A: 1, B: NaN, C: 2, D: Infinity } })
    expect(out?.entries).toEqual([['A', 1], ['C', 2]])
  })

  it('folds more than 8 categories into Other (sum of the rest)', () => {
    const data: Record<string, number> = {}
    for (let i = 1; i <= 10; i++) data[`c${i}`] = i
    const out = normalizeSpec({ type: 'bar', data })
    expect(out?.entries).toHaveLength(8)
    expect(out?.entries.at(-1)).toEqual(['Other', 6]) // 1+2+3 folded
  })

  it('converts a 2-slice pie to a bar chart', () => {
    const out = normalizeSpec({ type: 'pie', data: { Yes: 60, No: 40 } })
    expect(out?.type).toBe('bar')
  })

  it('keeps a 3-slice pie a pie', () => {
    const out = normalizeSpec({ type: 'pie', data: { A: 1, B: 2, C: 3 } })
    expect(out?.type).toBe('pie')
  })

  it('keeps entry order for line charts', () => {
    const out = normalizeSpec({ type: 'line', data: { Jan: 2, Feb: 1, Mar: 3 } })
    expect(out?.entries).toEqual([['Jan', 2], ['Feb', 1], ['Mar', 3]])
  })
})

describe('renderChartPng', () => {
  // jsdom has no canvas implementation — the renderer must return null, not throw.
  it('returns null when 2D context is unavailable (jsdom)', () => {
    expect(renderChartPng({ type: 'bar', data: { A: 1, B: 2 } })).toBeNull()
  })

  it('returns null for an invalid spec before touching the canvas', () => {
    expect(renderChartPng({ type: 'nope', data: {} })).toBeNull()
  })
})

// ---- drawing tests against a recording canvas context -----------------------
//
// jsdom cannot rasterize, so we swap in a recording context and assert the
// mark specs: palette colors, line widths, hairline grid, direct labels.

interface Recorded {
  calls: Array<[string, unknown[]]>
}

function withFakeCanvas(fn: (rec: Recorded) => void) {
  const calls: Array<[string, unknown[]]> = []
  const ctx: Record<string, unknown> = {
    canvas: { width: 0, height: 0 },
    measureText: () => ({ width: 12 }),
  }
  const ctxProxy = new Proxy(ctx, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (...args: unknown[]) => { calls.push([prop, args]) }
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value
      calls.push([`set:${prop}`, [value]])
      return true
    },
  })
  const el = {
    width: 0,
    height: 0,
    getContext: () => ctxProxy,
    toDataURL: () => 'data:image/png;base64,FAKE',
  }
  const orig = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return el as unknown as HTMLCanvasElement
    return orig(tag)
  }) as typeof document.createElement)
  try {
    fn({ calls })
  } finally {
    spy.mockRestore()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderChartPng (drawing)', () => {
  it('returns the canvas dataURL for a valid bar chart', () => {
    withFakeCanvas(() => {
      const url = renderChartPng({ type: 'bar', title: 'Distribution', data: { A: 3, B: 5 } })
      expect(url).toBe('data:image/png;base64,FAKE')
    })
  })

  it('draws bars in the first palette slot with the title and value labels', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'bar', title: 'Distribution', data: { A: 3, B: 5 } })
      const fills = calls.filter(([k]) => k === 'set:fillStyle').map(([, a]) => a[0])
      expect(fills).toContain(PALETTE[0]) // fixed slot order, never cycled
      const texts = calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]))
      expect(texts).toContain('Distribution') // title
      expect(texts).toContain('5') // direct value label (relief rule: print has no hover)
      expect(texts).toContain('A') // category label
    })
  })

  it('uses a 1px hairline grid and a visible baseline for bar charts', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'bar', data: { A: 3, B: 5 } })
      const pairs = calls.map(([k, a]) => [k, a[0]] as const)
      expect(pairs).toContainEqual(['set:strokeStyle', '#e1e0d9']) // hairline grid color
      expect(pairs).toContainEqual(['set:lineWidth', 1]) // hairline width
      expect(pairs).toContainEqual(['set:strokeStyle', '#c3c2b7']) // baseline/axis
    })
  })

  it('draws line charts with a 2px series stroke', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'line', data: { Jan: 2, Feb: 4, Mar: 3 } })
      const widths = calls.filter(([k]) => k === 'set:lineWidth').map(([, a]) => a[0])
      expect(widths).toContain(2)
      expect(calls.some(([k]) => k === 'stroke')).toBe(true)
    })
  })

  it('draws pie slices with percentage labels and a legend', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'pie', title: 'Usage', data: { A: 1, B: 2, C: 1 } })
      expect(calls.some(([k]) => k === 'arc')).toBe(true)
      const texts = calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]))
      expect(texts.some((t) => t.endsWith('%'))).toBe(true)
      expect(texts).toContain('Usage')
      expect(texts).toContain('A') // legend entry
    })
  })

  it('assigns distinct palette slots per pie slice, in fixed order', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'pie', data: { A: 1, B: 2, C: 3, D: 4 } })
      const fills = calls.filter(([k]) => k === 'set:fillStyle').map(([, a]) => a[0])
      for (let i = 0; i < 4; i++) expect(fills).toContain(PALETTE[i])
    })
  })

  it('skips the title text when no title is given', () => {
    withFakeCanvas(({ calls }) => {
      renderChartPng({ type: 'bar', data: { A: 1 } })
      const texts = calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]))
      expect(texts).not.toContain('undefined')
      expect(texts).not.toContain('')
    })
  })
})

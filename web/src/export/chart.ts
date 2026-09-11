// Canvas chart renderer for DOCX export — renders the ```chart spec blocks the
// prompts request into PNG data URLs for embedding in Word documents.
//
// Print-context rules (from the dataviz skill, adapted for static export):
// - validated categorical palette in fixed slot order, never cycled; >8
//   categories fold into "Other"
// - direct value labels (print has no hover — the relief rule)
// - bars ≤24px with 4px rounded data-ends, square at the baseline; ≥2px gaps
// - 2px lines with ≥8px markers; 1px hairline grid; recessive baseline
// - no 2-slice pies (converted to bars)
//
// jsdom has no canvas implementation, so this returns null (never throws) when
// a 2D context is unavailable; the DOCX layer then falls back to a placeholder.

export const PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
] as const

const INK = '#0b0b0b'
const MUTED = '#898781'
const GRID = '#e1e0d9'
const BASELINE = '#c3c2b7'
const SURFACE = '#ffffff'

export interface NormalizedChart {
  type: 'bar' | 'pie' | 'line'
  title?: string
  ylabel?: string
  entries: Array<[string, number]>
}

const TYPES = new Set(['bar', 'pie', 'line'])

/**
 * Validates and normalizes a chart spec: filters non-numeric values, folds
 * categories beyond the 8 palette slots into "Other", and converts 2-slice
 * pies to bars. Returns null when the spec cannot produce a chart.
 * Accepts unknown — model output is never trusted.
 */
export function normalizeSpec(spec: unknown): NormalizedChart | null {
  if (!spec || typeof spec !== 'object') return null
  const s = spec as { type?: unknown; data?: unknown; title?: unknown; ylabel?: unknown }
  if (typeof s.type !== 'string' || !TYPES.has(s.type)) return null
  const data = s.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  let entries = Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v)) as Array<[string, number]>

  if (entries.length === 0) return null

  if (entries.length > PALETTE.length) {
    // Fold the smallest categories into "Other": keep top 7 by value.
    const sorted = [...entries].sort((a, b) => b[1] - a[1])
    const kept = sorted.slice(0, PALETTE.length - 1)
    const otherTotal = sorted.slice(PALETTE.length - 1).reduce((s, [, v]) => s + v, 0)
    // Restore original relative order among the kept entries.
    const keptSet = new Set(kept.map(([k]) => k))
    entries = entries.filter(([k]) => keptSet.has(k))
    entries.push(['Other', otherTotal])
  }

  const type = (s.type === 'pie' && entries.length === 2 ? 'bar' : s.type) as NormalizedChart['type']
  return {
    type,
    title: typeof s.title === 'string' ? s.title : undefined,
    ylabel: typeof s.ylabel === 'string' ? s.ylabel : undefined,
    entries,
  }
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 100) / 100)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Ticks from 0 up to a padded max, 4 gridlines + baseline. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4]
  const step = niceStep(max / 4)
  const out: number[] = []
  for (let v = 0; v < max || out.length === 0; v += step) out.push(v)
  if (out.length < 2) out.push(step)
  return out.slice(0, 6)
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw) return m * pow
  }
  return 10 * pow
}

const W = 900
const H = 520

/**
 * Renders a chart spec to a PNG data URL. Returns null when the spec is
 * invalid or no 2D canvas context is available (e.g. jsdom) — callers must
 * fall back to a placeholder.
 */
export function renderChartPng(spec: unknown): string | null {
  const chart = normalizeSpec(spec)
  if (!chart) return null

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  canvas.width = W
  canvas.height = H

  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, W, H)

  if (chart.type === 'pie') drawPie(ctx, chart)
  else drawXY(ctx, chart)

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

interface Plot {
  left: number
  right: number
  top: number
  base: number
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string | undefined, top: number): number {
  if (!title) return top
  ctx.fillStyle = INK
  ctx.font = 'bold 22px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title, W / 2, top)
  return top + 34
}

/** Grid, ticks, baseline, and category labels shared by bar and line charts. */
function drawFrame(ctx: CanvasRenderingContext2D, chart: NormalizedChart, plot: Plot, max: number): void {
  const tickVals = ticks(max)
  ctx.font = '12px serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const v of tickVals) {
    const y = plot.base - ((v - tickVals[0]) / (tickVals.at(-1)! - tickVals[0] || 1)) * (plot.base - plot.top)
    // hairline grid
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(plot.left, y)
    ctx.lineTo(plot.right, y)
    ctx.stroke()
    // tick value (muted ink — text never wears the series color)
    ctx.fillStyle = MUTED
    ctx.fillText(fmt(v), plot.left - 8, y)
  }
  // baseline / axis
  ctx.strokeStyle = BASELINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plot.left, plot.base)
  ctx.lineTo(plot.right, plot.base)
  ctx.stroke()

  // category labels
  const slot = (plot.right - plot.left) / chart.entries.length
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  chart.entries.forEach(([label], i) => {
    const label2 = truncate(label, Math.max(4, Math.floor(slot / 7)))
    ctx.fillText(label2, plot.left + slot * (i + 0.5), plot.base + 8)
  })

  // y-axis title
  if (chart.ylabel) {
    ctx.save()
    ctx.translate(20, (plot.top + plot.base) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillStyle = MUTED
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(truncate(chart.ylabel, 40), 0, 0)
    ctx.restore()
  }
}

function drawXY(ctx: CanvasRenderingContext2D, chart: NormalizedChart): void {
  const top = drawTitle(ctx, chart.title, 36)
  const plot: Plot = { left: 70, right: W - 30, top: top + 16, base: H - 60 }
  const values = chart.entries.map(([, v]) => v)
  const max = Math.max(...values, 0)
  drawFrame(ctx, chart, plot, max)

  const slot = (plot.right - plot.left) / chart.entries.length
  const yOf = (v: number) => {
    const span = max || 1
    return plot.base - (v / span) * (plot.base - plot.top)
  }

  if (chart.type === 'bar') {
    // ≤24px bars, 4px rounded data-ends, square at the baseline; ≥2px gap
    const barW = Math.min(24, slot - 2)
    const r = Math.min(4, barW / 2)
    ctx.fillStyle = PALETTE[0] // single series: fixed slot 1, never cycled
    chart.entries.forEach(([, v], i) => {
      const bx = plot.left + slot * (i + 0.5) - barW / 2
      const y = yOf(Math.max(v, 0))
      ctx.beginPath()
      ctx.moveTo(bx, plot.base)
      ctx.lineTo(bx, y + r)
      ctx.quadraticCurveTo(bx, y, bx + r, y)
      ctx.lineTo(bx + barW - r, y)
      ctx.quadraticCurveTo(bx + barW, y, bx + barW, y + r)
      ctx.lineTo(bx + barW, plot.base)
      ctx.closePath()
      ctx.fill()
    })
    // direct value labels above each bar (relief rule: print has no hover)
    ctx.fillStyle = INK
    ctx.font = 'bold 13px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    chart.entries.forEach(([, v], i) => {
      const cx = plot.left + slot * (i + 0.5)
      ctx.fillText(fmt(v), cx, yOf(Math.max(v, 0)) - 6)
    })
  } else {
    // line: 2px stroke, ≥8px markers with a 2px surface ring
    const pts = chart.entries.map(([, v], i) => ({
      x: plot.left + slot * (i + 0.5),
      y: yOf(v),
      v,
    }))
    ctx.strokeStyle = PALETTE[0]
    ctx.lineWidth = 2
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    for (const p of pts) {
      ctx.beginPath()
      ctx.fillStyle = PALETTE[0]
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2) // 8px marker
      ctx.fill()
      ctx.strokeStyle = SURFACE
      ctx.lineWidth = 2 // surface ring
      ctx.stroke()
    }
    // selective direct labels: endpoints only, never every point
    ctx.fillStyle = INK
    ctx.font = 'bold 13px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (const p of [pts[0], pts.at(-1)!]) {
      ctx.fillText(fmt(p.v), p.x, p.y - 8)
    }
  }
}

function drawPie(ctx: CanvasRenderingContext2D, chart: NormalizedChart): void {
  const top = drawTitle(ctx, chart.title, 36)
  const total = chart.entries.reduce((s, [, v]) => s + v, 0) || 1
  const cx = W / 2
  const cy = top + 30 + 150
  const R = 150

  let angle = -Math.PI / 2
  const labelAnchors: Array<{ text: string; x: number; y: number; inside: boolean }> = []
  chart.entries.forEach(([, v], i) => {
    const sweep = (v / total) * Math.PI * 2
    ctx.fillStyle = PALETTE[i] // fixed slot order
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, R, angle, angle + sweep)
    ctx.closePath()
    ctx.fill()
    // 2px surface gap between slices
    ctx.strokeStyle = SURFACE
    ctx.lineWidth = 2
    ctx.stroke()

    const pct = Math.round((v / total) * 100)
    const mid = angle + sweep / 2
    const big = v / total >= 0.06
    labelAnchors.push({
      text: `${pct}%`,
      x: cx + Math.cos(mid) * (big ? R * 0.65 : R + 24),
      y: cy + Math.sin(mid) * (big ? R * 0.65 : R + 24),
      inside: big,
    })
    angle += sweep
  })

  // percentage labels: white inside big slices, ink outside small ones
  ctx.font = 'bold 14px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const a of labelAnchors) {
    ctx.fillStyle = a.inside ? SURFACE : INK
    ctx.fillText(a.text, a.x, a.y)
  }

  // legend (≥2 slices always gets one — identity is never color-alone)
  const perRow = 4
  const colW = (W - 120) / perRow
  const legendY = cy + R + 36
  ctx.font = '13px serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  chart.entries.forEach(([label], i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const x = 60 + col * colW
    const y = legendY + row * 24
    ctx.fillStyle = PALETTE[i]
    ctx.fillRect(x, y - 6, 12, 12)
    ctx.fillStyle = INK
    ctx.fillText(truncate(label, 18), x + 18, y)
  })
}

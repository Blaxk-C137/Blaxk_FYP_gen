// Parses chapter text (markdown-ish, per the prompt markup rules in prompts.ts)
// into structured blocks for export rendering. Pure functions, never throw:
// malformed fenced blocks degrade to placeholders, everything else passes through.

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  attention?: boolean
}

export type Block =
  | { kind: 'chapter'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'para'; runs: Run[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'chart'; chart: ChartSpec }
  | { kind: 'figure'; description: string }

export interface ChartSpec {
  type: 'bar' | 'pie' | 'line'
  title?: string
  ylabel?: string
  data: Record<string, number>
}

/** Splits text into runs on **bold** and *italic* markers. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = []
  // Bold first (**…**), then italic (*…*). Lone asterisks never match.
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true })
    else runs.push({ text: m[2], italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  const split = runs.flatMap(splitAttention)
  return split.length ? split : [{ text }]
}

/** Bracketed action placeholders the user must not miss. The prompts only
 *  ever emit uppercase placeholders ([INSERT …], [VERIFY], [ADD …], [TODO …]),
 *  so the match is case-sensitive — lowercase bracketed prose like "[address]"
 *  or "[additional comments]" stays plain. */
const ATTENTION_RE = /\[(?:INSERT[^\]]*?|VERIFY|ADD[^\]]*?|TODO[^\]]*?)\]/g

function splitAttention(run: Run): Run[] {
  const out: Run[] = []
  let last = 0
  for (const m of run.text.matchAll(ATTENTION_RE)) {
    if (m.index! > last) out.push({ ...run, text: run.text.slice(last, m.index) })
    out.push({ ...run, text: m[0], attention: true })
    last = m.index! + m[0].length
  }
  if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) })
  return out
}

const CHAPTER_RE = /^(CHAPTER\s+\S+|APPENDIX\b.*)$/i
const SECTION_RE = /^\d+(?:\.\d+)+\s+/
const TABLE_ROW_RE = /^\|(.+)\|$/
const TABLE_SEP_RE = /^\|?[\s:-]+\|[\s:|-]*$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^\d+\.\s+(.*)$/
const FENCE_RE = /^```(\w*)\s*$/

/** True if the line is a table separator row like | --- | --- | */
function isTableSep(line: string): boolean {
  const t = line.trim()
  return TABLE_SEP_RE.test(t) && t.includes('-')
}

function splitRow(line: string): string[] {
  return line.trim().slice(1, -1).split('|').map((c) => c.trim())
}

function toFigureFromChart(raw: string): Block {
  // Malformed chart JSON: keep the (stripped) content as a visible placeholder,
  // never raw JSON in the final document.
  const description = raw.replace(/[{}"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  return { kind: 'figure', description: description || 'chart (malformed data — regenerate this chapter)' }
}

/** Tolerant chart-spec parse for model output: requires a non-empty numeric
 *  `data` object; defaults `type` to bar; accepts multi-line JSON. Null when
 *  the content is not chart-shaped — callers then degrade to a placeholder. */
export function parseChartSpec(raw: string): ChartSpec | null {
  let j: unknown
  try { j = JSON.parse(raw) } catch { return null }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null
  const o = j as Record<string, unknown>
  if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) return null
  const data = o.data as Record<string, unknown>
  const values = Object.values(data)
  if (!values.length || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const type = o.type === 'pie' || o.type === 'line' ? o.type : 'bar'
  return {
    type,
    title: typeof o.title === 'string' ? o.title : undefined,
    ylabel: typeof o.ylabel === 'string' ? o.ylabel : undefined,
    data: data as Record<string, number>,
  }
}

/**
 * Parses chapter text into blocks. Headings keep their raw text; fenced
 * chart/figure blocks are extracted; pipe tables and lists are structured;
 * everything else becomes paragraphs with inline-styled runs.
 */
export function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let fence: { tag: string; lines: string[] } | null = null

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'para', runs: parseInline(para.join(' ')) })
      para = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    // ---- fenced blocks ------------------------------------------------
    if (fence) {
      if (/^```\s*$/.test(t)) {
        const raw = fence.lines.join('\n').trim()
        // Charts arrive in `chart` fences — but the model often mislabels
        // them `json`; chart-shaped content in either tag becomes a chart.
        // Anything else degrades to a visible placeholder, never raw JSON.
        if (fence.tag === 'chart' || /^json$/i.test(fence.tag)) {
          const spec = parseChartSpec(raw)
          if (spec) blocks.push({ kind: 'chart', chart: spec })
          else blocks.push(toFigureFromChart(raw))
        } else if (fence.tag === 'figure') {
          blocks.push({ kind: 'figure', description: raw.replace(/\s+/g, ' ').slice(0, 300) })
        } else {
          // Unknown fence: keep the content as a plain paragraph
          if (raw) blocks.push({ kind: 'para', runs: parseInline(raw) })
        }
        fence = null
      } else {
        fence.lines.push(line)
      }
      continue
    }
    const fenceOpen = FENCE_RE.exec(t)
    if (fenceOpen) {
      flushPara()
      fence = { tag: fenceOpen[1], lines: [] }
      continue
    }

    if (!t) {
      flushPara()
      continue
    }

    // ---- bare chart JSON (the model sometimes skips the fence) --------
    if (/^\{.*\}$/.test(t)) {
      const spec = parseChartSpec(t)
      if (spec) {
        flushPara()
        blocks.push({ kind: 'chart', chart: spec })
        continue
      }
      // Not chart-shaped: falls through to the paragraph below.
    }

    // ---- headings -----------------------------------------------------
    if (CHAPTER_RE.test(t) && !/[.?!]$/.test(t)) {
      flushPara()
      blocks.push({ kind: 'chapter', text: t.toUpperCase() })
      continue
    }
    if (SECTION_RE.test(t)) {
      flushPara()
      blocks.push({ kind: 'section', text: t })
      continue
    }

    // ---- tables --------------------------------------------------------
    const row = TABLE_ROW_RE.exec(t)
    if (row && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara()
      const header = splitRow(t)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        rows.push(splitRow(lines[j]))
        j++
      }
      blocks.push({ kind: 'table', header, rows })
      i = j - 1
      continue
    }

    // ---- lists ----------------------------------------------------------
    const bullet = BULLET_RE.exec(t)
    const ordered = ORDERED_RE.exec(t)
    if (bullet || ordered) {
      flushPara()
      const isOrdered = Boolean(ordered)
      const items: string[] = [(bullet ?? ordered)![1]]
      let j = i + 1
      while (j < lines.length) {
        const nt = lines[j].trim()
        const nb = BULLET_RE.exec(nt)
        const no = ORDERED_RE.exec(nt)
        if (isOrdered ? no : nb) {
          items.push((nb ?? no)![1])
          j++
        } else break
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      i = j - 1
      continue
    }

    para.push(t)
  }
  // unterminated fence: treat its content as a figure placeholder
  if (fence) {
    const raw = fence.lines.join('\n').trim()
    if (raw) {
      blocks.push(
        fence.tag === 'figure'
          ? { kind: 'figure', description: raw.slice(0, 300) }
          : toFigureFromChart(raw)
      )
    }
  }
  flushPara()
  return blocks
}

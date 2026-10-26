/**
 * cortico-world-token-cost — a Cortico / Coopanion World that reads the deployment's own
 * `data/usage.jsonl` (one record per model request, written by Coopanion core) and turns it into
 * a scrollable table: time, model, tokens in/out, and what that call cost.
 *
 * The record already carries the cost Coopanion charged it (`attempt.charges[0].amount`, priced
 * from DeepSeek's published table, peak/off-peak windows included), so the World only reports it.
 * When a record has no charge (older versions), a small built-in DeepSeek price table is used and
 * the row says so.
 */
import fs from 'node:fs'
import path from 'node:path'

const WORLD_ID = 'token-cost'
const MAX_ROWS = 5000
const DEFAULT_LIMIT = 300

/** DeepSeek, USD per 1M tokens: [off-peak, peak]. Peak = 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri. */
const PRICING = {
  'deepseek-flash': { cached: [0.003, 0.006], input: [0.15, 0.3], output: [0.6, 1.2] },
  'deepseek-v4-flash': { cached: [0.003, 0.006], input: [0.15, 0.3], output: [0.6, 1.2] },
  'deepseek-v4-pro': { cached: [0.022, 0.044], input: [0.66, 1.32], output: [1.98, 3.96] },
}

function isPeak(date) {
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

function fallbackCost(model, cached, miss, output, at) {
  const rates = PRICING[model]
  if (!rates) return null
  const peak = isPeak(at) ? 1 : 0
  return (
    (cached * rates.cached[peak] + miss * rates.input[peak] + output * rates.output[peak]) / 1_000_000
  )
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function rowOf(record) {
  const attempt = record?.attempt ?? {}
  const meters = attempt.meters ?? {}
  const model = String(record?.model ?? attempt?.origin?.model ?? 'unknown')
  const cached = number(record?.cacheHitTokens ?? meters.cachedInput)
  const output = number(record?.completionTokens ?? meters.output)
  const input = number(record?.promptTokens ?? meters.input)
  const miss = number(record?.cacheMissTokens ?? Math.max(0, input - cached))
  const at = new Date(record?.ts ?? attempt?.startedAt ?? Date.now())
  const charge = Array.isArray(attempt.charges) ? attempt.charges[0] : undefined
  const charged = number(charge?.knownAmount ?? charge?.amount, NaN)
  const known = Number.isFinite(charged)
  const cost = known ? charged : fallbackCost(model, cached, miss, output, at)
  return {
    at: at.toISOString(),
    model,
    input,
    cached,
    miss,
    output,
    reasoning: number(record?.reasoningTokens ?? meters.reasoning),
    cost: cost === null ? null : cost,
    estimated: !known,
    currency: charge?.quote?.currency ?? 'USD',
    session: String(record?.sessionId ?? record?.session ?? ''),
    round: Number.isFinite(record?.round) ? record.round : null,
    status: number(record?.status ?? attempt?.status, 200),
    elapsedMs: number(attempt?.elapsedMs, 0),
  }
}

class TokenCostWorld {
  constructor(options = {}) {
    this.id = WORLD_ID
    this.ctx = options.ctx ?? {}
    this.host = null
    this.state = 'offline'
    this.hint = ''
    this.file = null
    this.offset = 0
    this.rows = []
    this.totals = { calls: 0, input: 0, cached: 0, miss: 0, output: 0, cost: 0, estimated: 0 }
  }

  findUsageFile() {
    const candidates = []
    for (const dir of [this.ctx?.dataDir, this.ctx?.botDir && path.join(this.ctx.botDir, 'data')]) {
      if (typeof dir === 'string' && dir) candidates.push(path.join(dir, 'usage.jsonl'))
    }
    for (const file of candidates) {
      try {
        if (fs.statSync(file).isFile()) return file
      } catch {
        // try the next one
      }
    }
    return null
  }

  async start(host) {
    this.host = host
    this.file = this.findUsageFile()
    if (!this.file) {
      this.state = 'error'
      this.hint = '找不到 usage.jsonl'
      host.log.error('token-cost: 找不到 usage.jsonl，不会记录任何东西')
      return
    }
    this.state = 'online'
    this.hint = this.file
    this.refresh()
    host.log.info(`token-cost: 读取 ${this.file}，已载入 ${this.rows.length} 条记录`)
  }

  async stop() {
    this.host = null
    this.state = 'offline'
    this.hint = ''
  }

  /** Reads whatever was appended since the last call; a shrunk or replaced file starts over. */
  refresh() {
    if (!this.file) return
    let stat
    try {
      stat = fs.statSync(this.file)
    } catch {
      return
    }
    if (stat.size < this.offset) {
      this.offset = 0
      this.rows = []
    }
    if (stat.size === this.offset) return

    let chunk = ''
    try {
      const fd = fs.openSync(this.file, 'r')
      try {
        const length = stat.size - this.offset
        const buffer = Buffer.alloc(length)
        fs.readSync(fd, buffer, 0, length, this.offset)
        chunk = buffer.toString('utf8')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return
    }

    const lastNewline = chunk.lastIndexOf('\n')
    if (lastNewline < 0) return
    const complete = chunk.slice(0, lastNewline + 1)
    this.offset += Buffer.byteLength(complete, 'utf8')

    for (const line of complete.split('\n')) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record?.version !== 2 && !record?.attempt) continue
      const row = rowOf(record)
      this.rows.push(row)
      this.totals.calls += 1
      this.totals.input += row.input
      this.totals.cached += row.cached
      this.totals.miss += row.miss
      this.totals.output += row.output
      if (typeof row.cost === 'number') this.totals.cost += row.cost
      if (row.estimated) this.totals.estimated += 1
    }
    if (this.rows.length > MAX_ROWS) this.rows = this.rows.slice(-MAX_ROWS)
  }

  async invoke(panel, method, args) {
    if (method !== 'rows') return null
    this.refresh()
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(args?.[0]?.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
    return {
      rows: this.rows.slice(-limit).reverse(),
      totals: { ...this.totals },
      file: this.file,
      updatedAt: new Date().toISOString(),
    }
  }

  tools() {
    return []
  }

  envPromptVars() {
    return {}
  }

  webUi() {
    return {
      label: 'Token 用量',
      lamps: [
        {
          label: '记录',
          state: this.state === 'online' ? 'online' : this.state === 'error' ? 'error' : 'offline',
          hint: this.hint || undefined,
        },
      ],
      badges: [
        { label: '调用', value: this.totals.calls, tone: 'plain' },
        { label: '花费', value: `$${this.totals.cost.toFixed(4)}`, tone: 'plain' },
      ],
      panels: [
        {
          id: 'usage',
          title: '每次模型调用',
          description: '时间、模型、输入 / 输出 tokens 与这一条的费用；表头固定，列表可上下滚动。',
          getMethods: ['rows'],
        },
      ],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
    }
  }
}

export const definition = {
  id: WORLD_ID,
  label: 'Token 用量',
  defaults: () => ({ enabled: true }),
  describe: { tools: [], events: [] },
  create: (ctx) => new TokenCostWorld({ ctx }),
}

export default definition

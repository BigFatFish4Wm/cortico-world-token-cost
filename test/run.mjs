/**
 * Standalone test: a fake usage.jsonl + a fake Host, then the real World.
 *
 * `node test/run.mjs`
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { definition } from '../index.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-cost-'))
const usage = path.join(dir, 'usage.jsonl')

const charged = {
  version: 2,
  attempt: {
    id: 'a1',
    generationId: 'g1',
    origin: { instance: 'deepseek', model: 'deepseek-flash' },
    startedAt: '2026-10-26T03:43:28.670Z',
    elapsedMs: 920,
    outcome: 'completed',
    status: 200,
    meters: { input: 71586, output: 23, cachedInput: 71424, reasoning: 0 },
    charges: [{ amount: 0.000504744, knownAmount: 0.000504744, quote: { currency: 'USD' } }],
  },
  ts: '2026-10-26T11:43:28.670+08:00',
  sessionId: 'main',
  model: 'deepseek-flash',
  promptTokens: 71586,
  completionTokens: 23,
  cacheHitTokens: 71424,
  cacheMissTokens: 162,
  reasoningTokens: 0,
  status: 200,
  round: 56,
}

const uncharged = {
  version: 2,
  attempt: {
    id: 'a2',
    origin: { instance: 'deepseek', model: 'deepseek-flash' },
    startedAt: '2026-10-26T06:30:00.000Z',
    status: 200,
    meters: { input: 1000, output: 100, cachedInput: 0, reasoning: 0 },
  },
  ts: '2026-10-26T14:30:00.000+08:00',
  model: 'deepseek-flash',
  promptTokens: 1000,
  completionTokens: 100,
  cacheHitTokens: 0,
  cacheMissTokens: 1000,
  reasoningTokens: 0,
  status: 200,
  round: 57,
}

fs.writeFileSync(usage, `${JSON.stringify(charged)}\n${JSON.stringify(uncharged)}\n`)

const events = []
const host = {
  log: {
    info: (line) => process.env.DEBUG && console.log('[info]', line),
    warn: (line) => process.env.DEBUG && console.warn('[warn]', line),
    error: (line) => console.error('[error]', line),
    debug: () => {},
  },
  store: { range: () => [], latestCursor: () => 0 },
  modelFacts: {},
  async pushEvent(event) {
    events.push(event)
    return { cursor: events.length, ...event }
  },
}

const world = definition.create({ dataDir: dir, cfg: { cnyRate: 7.2 } })
await world.start(host)
assert.equal(world.state, 'online')

let result = await world.invoke('usage', 'rows', [{ limit: 10 }])
assert.equal(result.rows.length, 2)
assert.equal(result.rows[0].model, 'deepseek-flash')
assert.equal(result.rows[0].round, 57)
assert.equal(result.rows[0].estimated, true)
assert.equal(result.rows[1].round, 56)
assert.equal(result.rows[1].estimated, false)
assert.ok(Math.abs(result.rows[1].cost - 0.000504744) < 1e-12)
assert.ok(result.rows[0].cost > 0, 'fallback pricing produced a cost')
assert.equal(result.totals.calls, 2)

// appended records show up on the next read
fs.appendFileSync(usage, `${JSON.stringify(charged)}\n`)
result = await world.invoke('usage', 'rows', [{ limit: 10 }])
assert.equal(result.rows.length, 3)
assert.equal(result.totals.calls, 3)

// the daily panel groups by local date and converts USD to CNY at the configured rate
const daily = await world.invoke('daily', 'daily', [{ limit: 30 }])
assert.equal(daily.rate, 7.2)
assert.equal(daily.days.length, 1)
const day = daily.days[0]
assert.equal(day.date, '2026-10-26')
assert.equal(day.calls, 3)
assert.ok(Math.abs(day.usd - 0.001429488) < 1e-12)
assert.ok(Math.abs(day.cny - day.usd * 7.2) < 1e-9)
assert.ok(daily.total.cny > 0)
assert.equal(daily.today, null, 'the fixture day is not today')

// a missing file is an error state, not a crash
const emptyWorld = definition.create({ dataDir: path.join(dir, 'missing') })
await emptyWorld.start(host)
assert.equal(emptyWorld.state, 'error')

await world.stop()
fs.rmSync(dir, { recursive: true, force: true })
console.log('ok: 读取 usage.jsonl、计价回退、增量追加、按天 CNY 汇总、缺文件报错')

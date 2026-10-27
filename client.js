/**
 * The WebUI half: one panel with a scrollable table of every model call the deployment made.
 * Everything numeric comes from the Host through `invoke('rows', [{ limit }])`.
 */
const TEXT = {
  zh: {
    title: 'Token 用量',
    desc: '每次模型调用的时间、模型、tokens 与费用；表头固定，列表可上下滚动。',
    time: '时间',
    model: '模型',
    input: '输入',
    output: '输出',
    cost: '费用',
    calls: '调用',
    spent: '花费',
    tokens: 'tokens',
    empty: '还没有记录',
    cached: '缓存',
    estimated: '按内置单价估算',
    total: '总计',
    dailyTitle: '每天花费',
    dailyDesc: '按本地日期汇总每天的调用次数、美元与人民币花费；表头固定，列表可上下滚动。',
    date: '日期',
    usd: 'USD',
    cny: 'CNY',
    days: '天数',
    rate: '汇率',
    today: '今日',
  },
  en: {
    title: 'Token usage',
    desc: 'Time, model, tokens and cost of every model call; the header stays and the list scrolls.',
    time: 'Time',
    model: 'Model',
    input: 'Input',
    output: 'Output',
    cost: 'Cost',
    calls: 'Calls',
    spent: 'Spent',
    tokens: 'tokens',
    empty: 'Nothing recorded yet',
    cached: 'cached',
    estimated: 'estimated from the built-in price table',
    total: 'Total',
    dailyTitle: 'Spend per day',
    dailyDesc: 'Every local day: calls, USD and CNY; the header stays and the list scrolls.',
    date: 'Date',
    usd: 'USD',
    cny: 'CNY',
    days: 'days',
    rate: 'rate',
    today: 'Today',
  },
}

const pick = (language) => (String(language || '').toLowerCase().startsWith('en') ? TEXT.en : TEXT.zh)

function fmt(number) {
  return Number(number || 0).toLocaleString('en-US')
}

function money(value) {
  if (value === null || value === undefined) return '—'
  if (value === 0) return '$0'
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`
}

function clock(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false })
  } catch {
    return String(iso)
  }
}

function cell(tag, text, align) {
  const el = document.createElement(tag)
  el.textContent = text
  el.style.padding = '5px 8px'
  el.style.whiteSpace = 'nowrap'
  el.style.fontVariantNumeric = 'tabular-nums'
  if (align) el.style.textAlign = align
  return el
}

const panel = {
  async mount(ctx) {
    const t = pick(ctx.language)
    const sheet = ctx.ui.sheet({ title: t.title, desc: t.desc })
    const bar = ctx.ui.rowbar()

    const wrap = document.createElement('div')
    wrap.style.maxHeight = '420px'
    wrap.style.overflowY = 'auto'
    wrap.style.border = '1px solid rgba(127,127,127,.25)'
    wrap.style.borderRadius = '8px'

    const table = document.createElement('table')
    table.style.width = '100%'
    table.style.borderCollapse = 'collapse'
    table.style.fontSize = '12px'

    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const [label, align] of [
      [t.time, 'left'],
      [t.model, 'left'],
      [t.input, 'right'],
      [t.output, 'right'],
      [t.cost, 'right'],
    ]) {
      const th = cell('th', label, align)
      th.style.position = 'sticky'
      th.style.top = '0'
      th.style.zIndex = '1'
      th.style.background = 'var(--dsw-alias-bg-layer-2, #f4f4f5)'
      th.style.borderBottom = '1px solid rgba(127,127,127,.3)'
      headRow.append(th)
    }
    head.append(headRow)
    table.append(head)

    const body = document.createElement('tbody')
    table.append(body)
    wrap.append(table)

    const empty = document.createElement('div')
    empty.textContent = t.empty
    empty.style.padding = '12px'
    empty.style.opacity = '.6'

    sheet.body.append(bar, wrap)
    ctx.root.appendChild(sheet.el)

    const render = (data) => {
      const rows = Array.isArray(data?.rows) ? data.rows : []
      const totals = data?.totals ?? {}
      bar.replaceChildren(
        ctx.ui.chip(`${t.calls} ${fmt(totals.calls)}`),
        ctx.ui.chip(`${t.spent} ${money(totals.cost)}`),
        ctx.ui.chip(`${fmt(totals.cached)} ${t.cached}`, 'muted'),
      )

      body.replaceChildren()
      if (!rows.length) {
        wrap.style.display = 'none'
        if (!empty.isConnected) sheet.body.append(empty)
        return
      }
      wrap.style.display = ''
      empty.remove()

      for (const row of rows) {
        const tr = document.createElement('tr')
        tr.style.borderTop = '1px solid rgba(127,127,127,.12)'
        tr.append(
          cell('td', clock(row.at), 'left'),
          cell('td', String(row.model ?? '—'), 'left'),
          cell(
            'td',
            `${fmt(row.input)}${row.cached ? `（${t.cached} ${fmt(row.cached)}）` : ''}`,
            'right',
          ),
          cell('td', fmt(row.output), 'right'),
          cell('td', `${money(row.cost)}${row.estimated ? ' ≈' : ''}`, 'right'),
        )
        body.append(tr)
      }
    }

    const load = async () => {
      try {
        render(await ctx.invoke('rows', [{ limit: 400 }]))
      } catch {
        // the host may be reloading; the next tick tries again
      }
    }

    await load()
    ctx.interval(load, 3000)
  },
}

const yuan = (value) => `¥${Number(value || 0).toFixed(2)}`

function cnyCell(value) {
  const el = cell('td', yuan(value), 'right')
  return el
}

/** One row per local day: calls, USD and CNY, with the totals on top. */
const dailyPanel = {
  async mount(ctx) {
    const t = pick(ctx.language)
    const sheet = ctx.ui.sheet({ title: t.dailyTitle, desc: t.dailyDesc })
    const bar = ctx.ui.rowbar()

    const wrap = document.createElement('div')
    wrap.style.maxHeight = '420px'
    wrap.style.overflowY = 'auto'
    wrap.style.border = '1px solid rgba(127,127,127,.25)'
    wrap.style.borderRadius = '8px'

    const table = document.createElement('table')
    table.style.width = '100%'
    table.style.borderCollapse = 'collapse'
    table.style.fontSize = '12px'

    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const [label, align] of [
      [t.date, 'left'],
      [t.calls, 'right'],
      [t.usd, 'right'],
      [t.cny, 'right'],
    ]) {
      const th = cell('th', label, align)
      th.style.position = 'sticky'
      th.style.top = '0'
      th.style.zIndex = '1'
      th.style.background = 'var(--dsw-alias-bg-layer-2, #f4f4f5)'
      th.style.borderBottom = '1px solid rgba(127,127,127,.3)'
      headRow.append(th)
    }
    head.append(headRow)
    table.append(head)

    const body = document.createElement('tbody')
    table.append(body)
    wrap.append(table)

    const empty = document.createElement('div')
    empty.textContent = t.empty
    empty.style.padding = '12px'
    empty.style.opacity = '.6'

    sheet.body.append(bar, wrap)
    ctx.root.appendChild(sheet.el)

    const render = (data) => {
      const days = Array.isArray(data?.days) ? data.days : []
      const total = data?.total ?? {}
      const today = data?.today
      bar.replaceChildren(
        ctx.ui.chip(`${t.total} ${yuan(total.cny)}`),
        ctx.ui.chip(`${t.today} ${yuan(today?.cny ?? 0)}`),
        ctx.ui.chip(`${t.rate} 1 USD = ${Number(data?.rate ?? 7.2).toFixed(2)} CNY`, 'muted'),
      )

      body.replaceChildren()
      if (!days.length) {
        wrap.style.display = 'none'
        if (!empty.isConnected) sheet.body.append(empty)
        return
      }
      wrap.style.display = ''
      empty.remove()

      for (const day of days) {
        const tr = document.createElement('tr')
        tr.style.borderTop = '1px solid rgba(127,127,127,.12)'
        tr.append(
          cell('td', String(day.date ?? '—'), 'left'),
          cell('td', fmt(day.calls), 'right'),
          cell('td', money(day.usd), 'right'),
          cnyCell(day.cny),
        )
        body.append(tr)
      }
    }

    const load = async () => {
      try {
        render(await ctx.invoke('daily', [{ limit: 120 }]))
      } catch {
        // the host may be reloading; the next tick tries again
      }
    }

    await load()
    ctx.interval(load, 5000)
  },
}

export default { panels: { daily: dailyPanel, usage: panel } }

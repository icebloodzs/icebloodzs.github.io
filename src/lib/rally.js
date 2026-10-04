/**
 * 集结分配：纯逻辑，不依赖小程序 API，方便单测。
 *
 * 攻城：每组 1 辆主车 + n 辆副车；每辆车 = 车头 + 车身。
 * 守城：每组 1 个车头 + 车身；第一组车身固定人数（默认 5），其余人分给后面几组。
 *
 * 成员字段：name、maxBonus（最高集结值）、attrsSum（六维总和）、strength（实力，兜底排序用）。
 */

const GROUP_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八']

/** 每组的主色 + 行底色（跟参考表一致：红、蓝、青、紫，往后顺延） */
const GROUP_COLORS = [
  { main: '#c8202f', light: '#fbdde1' },
  { main: '#2e4f9e', light: '#b4c6ea' },
  { main: '#1f8a80', light: '#cdf3f0' },
  { main: '#6b2fa0', light: '#e3d6f5' },
  { main: '#e07b1a', light: '#fdebd3' },
  { main: '#3a8a3a', light: '#d9f0d9' },
  { main: '#c2185b', light: '#f8d7e5' },
  { main: '#6d4c41', light: '#eadfdb' }
]

const METRICS = {
  rally: {
    label: '集结',
    get: (m) => (m && m.maxBonus !== null && m.maxBonus !== undefined ? Number(m.maxBonus) : null),
    fmt: (v) => (v === null ? '-' : Number(v).toFixed(2))
  },
  attrs: {
    label: '六维',
    get: (m) => (m && m.attrsSum !== null && m.attrsSum !== undefined ? Number(m.attrsSum) : null),
    fmt: (v) => (v === null ? '-' : String(Math.round(v)))
  }
}

const BODY_MODES = [
  { key: 'rally', label: '按集结值', desc: '集结从高到低依次填车，强车在前' },
  { key: 'attrs', label: '按六维', desc: '六维总和从高到低依次填车，强车在前' },
  { key: 'balanced', label: '均衡', desc: '按集结蛇形分配，各车实力尽量平均' },
  { key: 'random', label: '随机', desc: '打乱顺序后依次填车' }
]

/**
 * 从高到低排，没数据的排最后。
 * 同分、或者都没填时，按成员实力（名单导入的「实力」）从高到低兜底，
 * 免得大家都没填集结时车头按名字顺序选出来。
 */
function sortDesc(list, metricKey) {
  const get = METRICS[metricKey].get
  const strength = (m) => (m && Number.isFinite(Number(m.strength)) ? Number(m.strength) : 0)
  return list
    .map((m, i) => ({ m, i, v: get(m), s: strength(m) }))
    .sort((a, b) => {
      if (a.v === null && b.v !== null) return 1
      if (a.v !== null && b.v === null) return -1
      if (a.v !== null && b.v !== null && b.v !== a.v) return b.v - a.v
      return b.s - a.s || a.i - b.i
    })
    .map((x) => x.m)
}

/** Fisher–Yates；rand 可注入，测试时用固定种子 */
function shuffle(list, rand) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

/** 车身的排序：随机打乱，均衡和按集结都先按集结排 */
function orderBodies(list, bodyBy, rand) {
  if (bodyBy === 'random') return shuffle(list, rand || Math.random)
  return sortDesc(list, bodyBy === 'attrs' ? 'attrs' : 'rally')
}

/**
 * 把车身分进各辆车。
 * 依次填：第一辆车装满再装第二辆（强车在前）。
 * 蛇形：一轮正着发、一轮倒着发，各车拿到的实力尽量接近；车身人数不同也能处理。
 * 返回装不下的人（进替补）。
 */
function distribute(cars, bodies, snake) {
  const pickOrder = []
  if (snake) {
    const maxCap = Math.max(0, ...cars.map((c) => c.capacity))
    for (let r = 0; r < maxCap; r += 1) {
      const idx = cars.map((_, i) => i)
      if (r % 2 === 1) idx.reverse()
      idx.forEach((i) => { if (cars[i].capacity > r) pickOrder.push(i) })
    }
  } else {
    cars.forEach((c, i) => { for (let k = 0; k < c.capacity; k += 1) pickOrder.push(i) })
  }
  bodies.forEach((m, k) => {
    if (k < pickOrder.length) cars[pickOrder[k]].bodies.push(m)
  })
  return bodies.slice(pickOrder.length)
}

/** 车内按展示指标从高到低排，看着整齐；空位补 null 到满员 */
function finalizeCars(cars, displayKey) {
  cars.forEach((c) => {
    c.bodies = sortDesc(c.bodies, displayKey)
    while (c.bodies.length < c.capacity) c.bodies.push(null)
  })
}

const displayKeyOf = (bodyBy) => (bodyBy === 'attrs' ? 'attrs' : 'rally')

/**
 * 攻城。
 * 主车头：按车头依据取最高的 G 人，一组一个。
 * 副车头：从剩下的人里继续取最高的，第一轮给各组副车一，第二轮给副车二……
 */
function generateAttack(members, opts) {
  const G = opts.groups
  const n = opts.subs
  const byHead = sortDesc(members, opts.headBy)
  const heads = byHead.slice(0, G * (n + 1))
  const rest = byHead.slice(heads.length)

  const cars = []
  for (let g = 0; g < G; g += 1) {
    cars.push({ group: g, tier: 'main', sub: 0, ratio: opts.mainRatio, capacity: opts.mainBody, head: heads[g] || null, bodies: [] })
  }
  for (let j = 0; j < n; j += 1) {
    for (let g = 0; g < G; g += 1) {
      cars.push({ group: g, tier: 'sub', sub: j + 1, ratio: opts.subRatio, capacity: opts.subBody, head: heads[G + j * G + g] || null, bodies: [] })
    }
  }

  const bodies = orderBodies(rest, opts.bodyBy, opts.rand)
  let bench = distribute(cars, bodies, opts.bodyBy === 'balanced')

  // 剩下的人编成概率车：每组一辆，车头取剩余里最高的，车身平均分（参考表第二张的做法）
  if (opts.probability && bench.length) {
    const left = sortDesc(bench, opts.headBy)
    const probHeads = left.slice(0, Math.min(G, left.length))
    const probBodies = orderBodies(left.slice(probHeads.length), opts.bodyBy, opts.rand)
    const probCars = probHeads.map((h, g) => {
      const base = Math.floor(probBodies.length / probHeads.length)
      const extra = g < probBodies.length % probHeads.length ? 1 : 0
      return { group: g, tier: 'prob', sub: 99, ratio: opts.mainRatio, capacity: base + extra, head: h, bodies: [] }
    })
    bench = distribute(probCars, probBodies, opts.bodyBy === 'balanced')
    cars.push(...probCars)
  }

  finalizeCars(cars, displayKeyOf(opts.bodyBy))
  // 展示顺序：按组排，组内主车 → 副车按轮次 → 概率车
  cars.sort((a, b) => a.group - b.group || a.sub - b.sub)
  return { mode: 'attack', cars, bench: sortDesc(bench, displayKeyOf(opts.bodyBy)) }
}

/**
 * 守城。
 * 车头：取最高的 G 人。第一组车身固定 firstBody 人，其余人平均分给后面几组（能整除就一样多，不能整除前面的组多一个）。
 */
function generateDefense(members, opts) {
  const G = opts.groups
  const byHead = sortDesc(members, opts.headBy)
  const heads = byHead.slice(0, G)
  const rest = byHead.slice(G)

  const first = Math.min(opts.firstBody, rest.length)
  const others = rest.length - first
  const cars = []
  for (let g = 0; g < G; g += 1) {
    let capacity
    if (G === 1) capacity = rest.length
    else if (g === 0) capacity = first
    else {
      const base = Math.floor(others / (G - 1))
      const extra = g - 1 < others % (G - 1) ? 1 : 0
      capacity = base + extra
    }
    cars.push({ group: g, tier: 'def', sub: 0, ratio: '', capacity, head: heads[g] || null, bodies: [] })
  }

  const bodies = orderBodies(rest, opts.bodyBy, opts.rand)
  const bench = distribute(cars, bodies, opts.bodyBy === 'balanced')
  finalizeCars(cars, displayKeyOf(opts.bodyBy))
  return { mode: 'defense', cars, bench }
}

/** 车名：攻城 "一组5:2:3" / "一组副5:2:3"；守城用车头名 */
function carTitle(car) {
  const gn = `${GROUP_NAMES[car.group] || car.group + 1}组`
  if (car.tier === 'main') return `${gn}${car.ratio}`
  if (car.tier === 'sub') return `${gn}副${car.ratio}`
  if (car.tier === 'prob') return `概率车${car.ratio}`
  return car.head ? car.head.name : `${gn}（待定）`
}

/** 位置读写：key 形如 "3:h"（第 3 辆车车头）、"3:2"（车身第 2 位）、"b:5"（替补第 5 个） */
function getSeat(plan, key) {
  const [a, b] = key.split(':')
  if (a === 'b') return plan.bench[Number(b)] || null
  const car = plan.cars[Number(a)]
  if (!car) return null
  return b === 'h' ? car.head : car.bodies[Number(b)] || null
}

function setSeat(plan, key, member) {
  const [a, b] = key.split(':')
  if (a === 'b') {
    plan.bench[Number(b)] = member
    return
  }
  const car = plan.cars[Number(a)]
  if (b === 'h') car.head = member
  else car.bodies[Number(b)] = member
}

/** 两个位置互换；替补里换出空位就把空位去掉 */
function swapSeats(plan, keyA, keyB) {
  if (keyA === keyB) return plan
  const next = {
    mode: plan.mode,
    cars: plan.cars.map((c) => Object.assign({}, c, { bodies: c.bodies.slice() })),
    bench: plan.bench.slice()
  }
  const a = getSeat(next, keyA)
  const b = getSeat(next, keyB)
  setSeat(next, keyA, b)
  setSeat(next, keyB, a)
  next.bench = next.bench.filter(Boolean)
  return next
}

/** 把一个人加进替补尾部（点空位时用不上，这里给「移到替补」用） */
function toBench(plan, key) {
  const m = getSeat(plan, key)
  if (!m) return plan
  const next = swapSeats(plan, key, `b:${plan.bench.length}`)
  return next
}

/**
 * 把方案排成表格：每组一列，列里自上而下堆这一组的车。导出图片和 Excel 共用这一份排版。
 * 每行 { kind, text, value }：
 *   title 车名行（组色底白字）  head 车头行（浅底红字）  body 车身行  empty 空位  label 守城的「车身」小标题
 */
function buildLayout(plan, opts) {
  const metric = METRICS[displayKeyOf(opts.bodyBy)]
  const groupCount = Math.max(1, ...plan.cars.map((c) => c.group + 1))
  const columns = []
  for (let g = 0; g < groupCount; g += 1) {
    const color = GROUP_COLORS[g % GROUP_COLORS.length]
    const rows = []
    plan.cars.filter((c) => c.group === g).forEach((car) => {
      const val = (m) => metric.fmt(metric.get(m))
      if (plan.mode === 'defense') {
        rows.push({ kind: 'title', text: car.head ? car.head.name : '（车头待定）', value: car.head ? val(car.head) : '' })
        rows.push({ kind: 'label', text: '车身', value: metric.label })
      } else {
        rows.push({ kind: 'title', text: carTitle(car), value: metric.label, prob: car.tier === 'prob' })
        rows.push({ kind: 'head', text: car.head ? car.head.name : '（车头待定）', value: car.head ? val(car.head) : '' })
      }
      car.bodies.forEach((m) => rows.push(m ? { kind: 'body', text: m.name, value: val(m) } : { kind: 'empty', text: '', value: '' }))
    })
    columns.push({ color, rows })
  }
  return {
    title: opts.title,
    note: opts.note || '',
    metricLabel: metric.label,
    columns,
    bench: plan.bench.map((m) => m.name)
  }
}

/**
 * 表格排版 → Excel 的二维数组（每组占两列：名字、数值）。
 * 第一行是合并的标题，末尾追加替补和备注。
 * 颜色规则和导出图片（pages/rally drawTable）保持一致：
 * styles 是样式表，cellStyles 和 aoa 同形，存每格的样式编号（-1 = 无样式）。
 */
const SHEET_STYLES = {
  title: { fill: 'd9d9d9', color: 'e0203a', bold: true, size: 16, border: false },
  empty: { fill: 'ffffff' },
  bench: { color: '6b7280', align: 'left', border: false },
  note: { color: 'b45309', bold: true, align: 'left', border: false }
}

function layoutToSheet(layout) {
  const width = layout.columns.length * 2
  const height = Math.max(0, ...layout.columns.map((c) => c.rows.length))
  const styles = []
  const styleIds = {}
  const styleOf = (spec) => {
    const k = JSON.stringify(spec)
    if (!(k in styleIds)) {
      styleIds[k] = styles.length
      styles.push(spec)
    }
    return styleIds[k]
  }
  const hex = (c) => String(c).replace('#', '')
  const cellStyle = (row, col) => {
    if (!row) return -1
    if (row.kind === 'title') return styleOf({ fill: row.prob ? 'f08a24' : hex(col.color.main), color: 'ffffff', bold: true })
    if (row.kind === 'head') return styleOf({ fill: hex(col.color.light), color: 'e0203a', bold: true })
    if (row.kind === 'label') return styleOf({ fill: hex(col.color.light), color: '8a6d3b', size: 10 })
    if (row.kind === 'empty') return styleOf(SHEET_STYLES.empty)
    return styleOf({ fill: hex(col.color.light), color: '222222' })
  }

  const aoa = [[layout.title].concat(Array(width - 1).fill(''))]
  const cellStyles = [Array(width).fill(styleOf(SHEET_STYLES.title))]
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } }]
  for (let r = 0; r < height; r += 1) {
    const row = []
    const st = []
    layout.columns.forEach((col) => {
      const cell = col.rows[r]
      row.push(cell ? cell.text : '', cell ? cell.value : '')
      const id = cellStyle(cell, col)
      st.push(id, id)
    })
    aoa.push(row)
    cellStyles.push(st)
  }
  const pushBlank = () => {
    aoa.push(Array(width).fill(''))
    cellStyles.push(Array(width).fill(-1))
  }
  const pushWide = (text, spec) => {
    aoa.push([text].concat(Array(width - 1).fill('')))
    cellStyles.push(Array(width).fill(styleOf(spec)))
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: width - 1 } })
  }
  if (layout.bench.length) {
    pushBlank()
    pushWide(`替补（${layout.bench.length}人）：${layout.bench.join('、')}`, SHEET_STYLES.bench)
  }
  if (layout.note) {
    pushBlank()
    String(layout.note).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => pushWide(l.trim(), SHEET_STYLES.note))
  }
  const cols = []
  layout.columns.forEach(() => cols.push({ wch: 18 }, { wch: 8 }))
  const rows = aoa.map((_, i) => ({ hpt: i === 0 ? 30 : 20 }))
  return { aoa, merges, cols, rows, styles, cellStyles }
}

export {
  buildLayout,
  layoutToSheet,
  GROUP_NAMES,
  GROUP_COLORS,
  METRICS,
  BODY_MODES,
  sortDesc,
  shuffle,
  orderBodies,
  distribute,
  generateAttack,
  generateDefense,
  carTitle,
  displayKeyOf,
  getSeat,
  swapSeats,
  toBench
}

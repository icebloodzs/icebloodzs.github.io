/**
 * 集结分配：纯逻辑，不依赖小程序 API，方便单测。
 *
 * 攻城：每组 1 辆主车 + n 辆副车；每辆车 = 车头 + 车身。
 * 守城：每组 1 个车头 + 车身；第一组车身固定人数（默认 5），其余人分给后面几组。
 * 霹雳车（可选）：占正常队伍，上了霹雳车的人不再进别的车。攻城取常规车坐满后接下来的人，守城取排在最后的人。
 * 冲车（可选，只有攻城）：独立队伍，和常规车互不影响（同一个人可以既在组里又在冲车上）。
 *   六维最高的当车头，接着 N 个满兵车身（默认 6），其余 1 兵车身凑满 16 个，再加几个候补车身。
 *
 * 名字右边一律显示集结值；「按六维」只影响谁进哪辆车，不影响显示。
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

/** 冲车橙、霹雳车蓝（跟参考攻城表一致） */
const RAM_COLOR = { main: '#e8731a', light: '#fde4cc' }
const CAT_COLOR = { main: '#4472c4', light: '#d9e2f5' }
/** 冲车：车头 + 车身固定最多 16 个 */
const RAM_TOTAL = 16

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

/** 显示永远用集结值（参数留着兼容老调用） */
const displayKeyOf = () => 'rally'

/** 冲车排序：六维 → 集结 → 实力，都没填的排最后 */
function sortForRam(list) {
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
  const cmp = (x, y) => (x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : y - x)
  return list
    .map((m, i) => ({ m, i, a: num(m.attrsSum), r: num(m.maxBonus), s: num(m.strength) }))
    .sort((p, q) => cmp(p.a, q.a) || cmp(p.r, q.r) || cmp(p.s, q.s) || p.i - q.i)
    .map((x) => x.m)
}

/**
 * 冲车：从全部参与者里挑，不占常规车。
 * full 满兵车身（5~8），single 1 兵车身 = 16 − 1 − full，reserve 候补车身。人不够就留空位。
 */
function generateRam(members, opts) {
  const fullN = Math.max(0, Math.min(RAM_TOTAL - 1, opts.ramFull || 0))
  const singleN = RAM_TOTAL - 1 - fullN
  const reserveN = Math.max(0, opts.ramReserve || 0)
  const order = sortForRam(members)
  // 谁上哪一段按六维挑，段内按集结值排，看着整齐
  const take = (from, n) => {
    const out = sortDesc(order.slice(from, from + n), 'rally')
    while (out.length < n) out.push(null)
    return out
  }
  return {
    head: order[0] || null,
    full: take(1, fullN),
    single: take(1 + fullN, singleN),
    reserve: take(1 + fullN + singleN, reserveN)
  }
}

/** 霹雳车：从 pool（已按车身排法排好）里取，车头取其中车头依据最高的 */
function buildCatapults(pool, opts, group) {
  const n = opts.catapults || 0
  const per = 1 + (opts.catBody || 0)
  const picked = pool.slice(0, n * per)
  const heads = sortDesc(picked, opts.headBy).slice(0, n)
  const bodies = picked.filter((m) => heads.indexOf(m) < 0)
  const cars = []
  for (let k = 0; k < n; k += 1) {
    cars.push({ group, tier: 'cat', sub: 50 + k, ratio: opts.catRatio || '', capacity: opts.catBody || 0, head: heads[k] || null, bodies: [] })
  }
  distribute(cars, bodies, false)
  return { cars, rest: pool.slice(picked.length) }
}

/** 常规组数（霹雳车单独成一列，不算组） */
function groupCountOf(plan) {
  return Math.max(1, ...plan.cars.filter((c) => c.tier !== 'cat').map((c) => c.group + 1))
}

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

  // 霹雳车占正常队伍：常规车坐满后，接下来的人上霹雳车
  let catCars = []
  if (opts.catapult) {
    const cat = buildCatapults(bench, opts, G)
    catCars = cat.cars
    bench = cat.rest
  }

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
  cars.push(...catCars)

  finalizeCars(cars, displayKeyOf(opts.bodyBy))
  // 展示顺序：按组排，组内主车 → 副车按轮次 → 概率车；霹雳车 group = G 排最后
  cars.sort((a, b) => a.group - b.group || a.sub - b.sub)
  return { mode: 'attack', cars, bench: sortDesc(bench, displayKeyOf(opts.bodyBy)), ram: opts.ram ? generateRam(members, opts) : null }
}

/**
 * 守城。
 * 车头：取最高的 G 人。第一组车身固定 firstBody 人，其余人平均分给后面几组（能整除就一样多，不能整除前面的组多一个）。
 */
function generateDefense(members, opts) {
  const G = opts.groups
  const byHead = sortDesc(members, opts.headBy)
  const heads = byHead.slice(0, G)
  let rest = byHead.slice(G)

  // 霹雳车占正常队伍：守城所有人都会分进组里，霹雳车就从排在最后的人里取
  let catCars = []
  if (opts.catapult) {
    const ordered = orderBodies(rest, opts.bodyBy, opts.rand)
    const need = (opts.catapults || 0) * (1 + (opts.catBody || 0))
    const tail = ordered.slice(Math.max(0, ordered.length - need))
    catCars = buildCatapults(tail, opts, G).cars
    rest = rest.filter((m) => tail.indexOf(m) < 0)
  }

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
  cars.push(...catCars)
  finalizeCars(cars, displayKeyOf(opts.bodyBy))
  return { mode: 'defense', cars, bench, ram: null }
}

/** 车名：攻城 "一组5:2:3" / "一组副5:2:3"；守城用车头名 */
function carTitle(car) {
  const gn = `${GROUP_NAMES[car.group] || car.group + 1}组`
  if (car.tier === 'main') return `${gn}${car.ratio}`
  if (car.tier === 'sub') return `${gn}副${car.ratio}`
  if (car.tier === 'prob') return `概率车${car.ratio}`
  if (car.tier === 'cat') return `霹雳车${car.ratio}`
  return car.head ? car.head.name : `${gn}（待定）`
}

/**
 * 位置读写：key 形如 "3:h"（第 3 辆车车头）、"3:2"（车身第 2 位）、"b:5"（替补第 5 个），
 * 冲车用 "r:h"（车头）、"r:full:2" / "r:single:0" / "r:reserve:1"（满兵 / 1 兵 / 候补车身）。
 */
const RAM_PARTS = ['full', 'single', 'reserve']
const isRamKey = (key) => String(key).split(':')[0] === 'r'

function getSeat(plan, key) {
  const [a, b, c] = key.split(':')
  if (a === 'r') {
    if (!plan.ram) return null
    return b === 'h' ? plan.ram.head : (plan.ram[b] || [])[Number(c)] || null
  }
  if (a === 'b') return plan.bench[Number(b)] || null
  const car = plan.cars[Number(a)]
  if (!car) return null
  return b === 'h' ? car.head : car.bodies[Number(b)] || null
}

function setSeat(plan, key, member) {
  const [a, b, c] = key.split(':')
  if (a === 'r') {
    if (b === 'h') plan.ram.head = member
    else plan.ram[b][Number(c)] = member
    return
  }
  if (a === 'b') {
    plan.bench[Number(b)] = member
    return
  }
  const car = plan.cars[Number(a)]
  if (b === 'h') car.head = member
  else car.bodies[Number(b)] = member
}

const sameMember = (x, m) => Boolean(x && m && (x === m || x.name === m.name))

/** 这个人在冲车上的位置，不在就返回空串 */
function ramKeyOf(plan, member) {
  const ram = plan.ram
  if (!ram || !member) return ''
  if (sameMember(ram.head, member)) return 'r:h'
  for (const part of RAM_PARTS) {
    const i = ram[part].findIndex((x) => sameMember(x, member))
    if (i >= 0) return `r:${part}:${i}`
  }
  return ''
}

function clonePlan(plan) {
  const ram = plan.ram
  return {
    mode: plan.mode,
    cars: plan.cars.map((c) => Object.assign({}, c, { bodies: c.bodies.slice() })),
    bench: plan.bench.slice(),
    ram: ram ? { head: ram.head, full: ram.full.slice(), single: ram.single.slice(), reserve: ram.reserve.slice() } : null
  }
}

/**
 * 两个位置互换；替补里换出空位就把空位去掉。
 * 冲车是独立队伍：冲车位置和常规位置互点 = 把常规位置上那个人放上冲车（常规位置不动，
 * 冲车上原来那个人下来）；这个人本来就在冲车上，就是冲车里两个位置互换。
 */
function swapSeats(plan, keyA, keyB) {
  if (keyA === keyB) return plan
  if (isRamKey(keyA) !== isRamKey(keyB)) {
    const ramKey = isRamKey(keyA) ? keyA : keyB
    const m = getSeat(plan, isRamKey(keyA) ? keyB : keyA)
    if (!m) return plan
    const already = ramKeyOf(plan, m)
    if (already) return swapSeats(plan, ramKey, already)
    const next = clonePlan(plan)
    setSeat(next, ramKey, m)
    return next
  }
  const next = clonePlan(plan)
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
 * 把方案排成表格：每组一列，列里自上而下堆这一组的车；霹雳车、冲车各占一列排在后面。
 * 导出图片、Excel、浏览器版页面共用这一份排版。名字右边一律是集结值。
 * 每行 { kind, key, text, value }：
 *   title 车名行（组色底白字）  head 车头行（浅底红字）  body 车身行  empty 空位
 *   label 小标题（守城的「车身」、冲车的「满兵车身」等）  dim 冲车候补（灰底）
 * key 是位置（见 getSeat），没有 key 的行不能点。
 */
function buildLayout(plan, opts) {
  const metric = METRICS.rally
  const val = (m) => metric.fmt(metric.get(m))
  const seat = (kind, key, m) => (m ? { kind, key, text: m.name, value: val(m) } : { kind: 'empty', key, text: '', value: '' })
  const headRow = (key, m) => (m ? seat('head', key, m) : { kind: 'head', key, text: '（车头待定）', value: '' })

  const carRows = (car, ci) => {
    const rows = []
    if (plan.mode === 'defense' && car.tier !== 'cat') {
      rows.push({ kind: 'title', key: `${ci}:h`, text: car.head ? car.head.name : '（车头待定）', value: car.head ? val(car.head) : '' })
      rows.push({ kind: 'label', text: '车身', value: metric.label })
    } else {
      rows.push({ kind: 'title', text: carTitle(car), value: metric.label, prob: car.tier === 'prob' })
      rows.push(headRow(`${ci}:h`, car.head))
    }
    car.bodies.forEach((m, bi) => rows.push(seat('body', `${ci}:${bi}`, m)))
    return rows
  }

  const columns = []
  const groupCount = groupCountOf(plan)
  for (let g = 0; g < groupCount; g += 1) {
    const rows = []
    plan.cars.forEach((car, ci) => {
      if (car.group === g && car.tier !== 'cat') rows.push(...carRows(car, ci))
    })
    columns.push({ name: `${GROUP_NAMES[g] || g + 1}组`, color: GROUP_COLORS[g % GROUP_COLORS.length], rows })
  }

  const catRows = []
  plan.cars.forEach((car, ci) => {
    if (car.tier === 'cat') catRows.push(...carRows(car, ci))
  })
  if (catRows.length) columns.push({ name: '霹雳车', color: CAT_COLOR, special: 'cat', rows: catRows })

  const ram = plan.ram
  if (ram) {
    const rows = [{ kind: 'title', text: '冲车', value: metric.label }, headRow('r:h', ram.head)]
    const part = (name, label, kind) => {
      if (!ram[name].length) return
      rows.push({ kind: 'label', text: label, value: `${ram[name].length}人` })
      ram[name].forEach((m, i) => rows.push(seat(kind, `r:${name}:${i}`, m)))
    }
    part('full', '满兵车身', 'body')
    part('single', '1兵车身', 'body')
    part('reserve', '候补车身', 'dim')
    columns.push({ name: '冲车', color: RAM_COLOR, special: 'ram', rows })
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
 * 导出图片的尺寸：列宽固定，所有列共用一套行高，同一行在各列对齐。
 * 霹雳车 / 冲车列前面多留一道缝，跟分组区分开。
 */
const IMG = { colW: 340, rowH: 44, margin: 24, titleH: 80, gap: 8, specialGap: 28, lineH: 40 }

function imageColumnsX(layout) {
  const xs = []
  let x = IMG.margin
  layout.columns.forEach((col, i) => {
    if (i > 0) x += col.special && !layout.columns[i - 1].special ? IMG.specialGap : IMG.gap
    xs.push(x)
    x += IMG.colW
  })
  return { xs, right: x }
}

/** 替补 + 备注折成若干行（按字数粗估宽度） */
function imageExtraLines(layout, width) {
  const perLine = Math.max(10, Math.floor(width / 24))
  const lines = []
  const push = (text, kind) => {
    for (let i = 0; i < text.length; i += perLine) lines.push({ text: text.slice(i, i + perLine), kind })
  }
  if (layout.bench.length) push(`替补（${layout.bench.length}人）：${layout.bench.join('、')}`, 'bench')
  String(layout.note || '').split(/\r?\n/).filter((l) => l.trim()).forEach((l) => push(l.trim(), 'note'))
  return lines
}

function imageSize(layout) {
  const { right } = imageColumnsX(layout)
  const W = right + IMG.margin
  const maxRows = Math.max(0, ...layout.columns.map((c) => c.rows.length))
  const extraLines = imageExtraLines(layout, W - IMG.margin * 2)
  const H = IMG.margin * 2 + IMG.titleH + 12 + maxRows * IMG.rowH + (extraLines.length ? 20 + extraLines.length * IMG.lineH : 0)
  return { W, H, extraLines }
}

/** 画表：小程序 canvas 2d 和浏览器 canvas 是同一套 API，两边共用 */
function drawImage(ctx, layout, size) {
  const { W, H, extraLines } = size
  const { colW, rowH, margin, titleH, lineH } = IMG
  const nameW = Math.round(colW * 0.7)
  const font = (px, bold) => `${bold ? 'bold ' : ''}${px}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const fit = (text, maxW, px, bold) => {
    let s = px
    ctx.font = font(s, bold)
    while (s > 14 && ctx.measureText(text).width > maxW - 16) {
      s -= 1
      ctx.font = font(s, bold)
    }
    let t = text
    while (t.length > 1 && ctx.measureText(t).width > maxW - 16) t = t.slice(0, -1)
    return t === text ? t : `${t.slice(0, -1)}…`
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 标题条
  ctx.fillStyle = '#d9d9d9'
  ctx.fillRect(margin, margin, W - margin * 2, titleH)
  ctx.fillStyle = '#e0203a'
  ctx.fillText(fit(layout.title || '', W - margin * 2, 34, true), W / 2, margin + titleH / 2)

  const top = margin + titleH + 12
  const { xs } = imageColumnsX(layout)
  layout.columns.forEach((col, ci) => {
    const x = xs[ci]
    col.rows.forEach((row, ri) => {
      const y = top + ri * rowH
      let bg = col.color.light
      let fg = '#222222'
      let valFg = '#4b5563'
      let bold = false
      let px = 22
      let split = true
      if (row.kind === 'title') {
        bg = row.prob ? '#f08a24' : col.color.main
        fg = '#ffffff'
        valFg = '#ffffff'
        bold = true
      } else if (row.kind === 'head') {
        fg = '#e0203a'
        valFg = '#e0203a'
        bold = true
      } else if (row.kind === 'label') {
        bg = '#ffffff'
        fg = col.color.main
        valFg = col.color.main
        bold = true
        px = 19
        split = false
      } else if (row.kind === 'dim') {
        bg = '#f3f4f6'
        fg = '#6b7280'
      } else if (row.kind === 'empty') {
        bg = '#ffffff'
      }
      ctx.fillStyle = bg
      ctx.fillRect(x, y, colW, rowH)
      ctx.strokeStyle = row.kind === 'title' ? col.color.main : '#c4c9d0'
      ctx.lineWidth = 1
      if (split) {
        ctx.strokeRect(x + 0.5, y + 0.5, nameW, rowH)
        ctx.strokeRect(x + nameW + 0.5, y + 0.5, colW - nameW - 1, rowH)
      } else {
        ctx.strokeRect(x + 0.5, y + 0.5, colW - 1, rowH)
      }

      const name = fit(row.text || '', nameW, px, bold)
      ctx.fillStyle = fg
      ctx.font = font(px, bold)
      ctx.fillText(name, x + nameW / 2, y + rowH / 2 + 1)
      ctx.fillStyle = valFg
      ctx.font = font(px, bold && row.kind !== 'label')
      ctx.fillText(row.value || '', x + nameW + (colW - nameW) / 2, y + rowH / 2 + 1)
    })
  })

  // 替补 + 备注
  if (extraLines.length) {
    const maxRows = Math.max(0, ...layout.columns.map((c) => c.rows.length))
    let y = top + maxRows * rowH + 20 + lineH / 2
    ctx.textAlign = 'left'
    extraLines.forEach((ln) => {
      ctx.fillStyle = ln.kind === 'bench' ? '#6b7280' : '#b45309'
      ctx.font = font(22, ln.kind === 'note')
      ctx.fillText(ln.text, margin + 8, y)
      y += lineH
    })
    ctx.textAlign = 'center'
  }
}

/**
 * 表格排版 → Excel 的二维数组（每组占两列：名字、数值）。
 * 第一行是合并的标题，末尾追加替补和备注。
 * 颜色规则和导出图片（drawImage）保持一致：
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
    if (row.kind === 'label') return styleOf({ fill: 'ffffff', color: hex(col.color.main), bold: true, size: 10 })
    if (row.kind === 'dim') return styleOf({ fill: 'f3f4f6', color: '6b7280' })
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
  RAM_COLOR,
  CAT_COLOR,
  RAM_TOTAL,
  METRICS,
  BODY_MODES,
  sortDesc,
  shuffle,
  orderBodies,
  distribute,
  generateAttack,
  generateDefense,
  generateRam,
  sortForRam,
  groupCountOf,
  carTitle,
  displayKeyOf,
  getSeat,
  swapSeats,
  toBench,
  imageSize,
  drawImage
}

/**
 * 黑土落位：纯逻辑，不依赖小程序 API，方便单测。
 *
 * 几何约定：N×N 方格旋转 45° 成菱形。格子 (r, c)，r 为行、c 为列，
 * 菱形上角是 (0,0)，右角 (0,N-1)，下角 (N-1,N-1)，左角 (N-1,0)。
 * 屏幕坐标：x ∝ c − r，y ∝ c + r。
 *
 * 地块由内到外：城池 k×k → 黑土若干圈 → 白土固定一圈。
 * 黑土圈数可以上下不对称：
 *   up   = 菱形上方两条斜边方向（行号更小、列号更小）的黑土圈数
 *   down = 菱形下方两条斜边方向（行号更大、列号更大）的黑土圈数
 * 网格边长 N = up + k + down + 2（两侧白土各一圈）。
 */

const PRESETS = [
  { key: 'lv3', label: '3级城池', city: 3, up: 2, down: 2 },
  { key: 'lv4', label: '4级城池（普通）', city: 3, up: 2, down: 2 },
  { key: 'lv4k', label: '4级小王城', city: 3, up: 4, down: 4 },
  { key: 'lv5', label: '5级城池', city: 4, up: 2, down: 3 },
  { key: 'lv6', label: '6级城池', city: 4, up: 2, down: 3 },
  { key: 'lv7', label: '7级城池', city: 9, up: 11, down: 11 }
]

/** 黑土各圈的填充色 / 描边色（由内到外，超出循环使用） */
const BLACK_COLORS = [
  { fill: '#dbeafe', stroke: '#60a5fa' },
  { fill: '#fef9c3', stroke: '#eab308' },
  { fill: '#ede9fe', stroke: '#a78bfa' },
  { fill: '#dcfce7', stroke: '#4ade80' },
  { fill: '#ffedd5', stroke: '#fb923c' },
  { fill: '#e0f2fe', stroke: '#38bdf8' }
]
/** 白土一圈：粉色，和黑土的任何一圈都不撞色 */
const WHITE_COLOR = { fill: '#fce7f3', stroke: '#f472b6' }

/** 格子颜色：白土固定粉色，黑土按圈号循环 */
function ringColor(ring, soil) {
  if (soil === 'white') return WHITE_COLOR
  return BLACK_COLORS[(ring - 1) % BLACK_COLORS.length]
}

const cellId = (r, c) => `${r}_${c}`

const MAX_CITY = 12
const MAX_RINGS = 14

function validShape(city, up, down) {
  return city >= 1 && city <= MAX_CITY && up >= 1 && down >= 1 && up <= MAX_RINGS && down <= MAX_RINGS
}

/** 斗阵：左右两个角、黑土最外圈的 2×2（紧挨着白土） */
function battleBlocks(size) {
  const n = size
  return {
    left: [[n - 2, 1], [n - 3, 1], [n - 2, 2], [n - 3, 2]],
    right: [[1, n - 2], [2, n - 2], [1, n - 3], [2, n - 3]]
  }
}

/**
 * 建网格。
 * cells：每格的类型（city / slot / battleL / battleR）、土质（black / white）、黑土圈号。
 * order：可分配格子的填充顺序——先黑土由内到外、每圈从上角顺时针，再白土一圈。
 * blackRect：黑土区域的外框（画分割线用）。
 */
function buildGrid({ city, up, down, battle }) {
  if (!validShape(city, up, down)) throw new Error('城池或黑土圈数不合法')
  const size = up + city + down + 2
  const lo = up + 1
  const hi = lo + city - 1
  const last = size - 1

  const dist = (r, c) => {
    const dr = r < lo ? lo - r : r > hi ? r - hi : 0
    const dc = c < lo ? lo - c : c > hi ? c - hi : 0
    return Math.max(dr, dc)
  }
  const isWhite = (r, c) => r === 0 || c === 0 || r === last || c === last

  const kinds = {}
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      kinds[cellId(r, c)] = dist(r, c) === 0 ? 'city' : 'slot'
    }
  }

  // 斗阵只能落在黑土上；尺寸太小、压到城池或白土就不启用
  let battleOn = false
  if (battle) {
    const { left, right } = battleBlocks(size)
    const all = left.concat(right)
    const fits = all.every(([r, c]) => r > 0 && c > 0 && r < last && c < last && dist(r, c) >= 1)
    if (fits) {
      left.forEach(([r, c]) => { kinds[cellId(r, c)] = 'battleL' })
      right.forEach(([r, c]) => { kinds[cellId(r, c)] = 'battleR' })
      battleOn = true
    }
  }

  const cells = []
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const id = cellId(r, c)
      const white = isWhite(r, c)
      cells.push({ id, r, c, ring: white ? 0 : dist(r, c), soil: white ? 'white' : 'black', kind: kinds[id] })
    }
  }

  // 沿着以城池为中心、外扩 d 格的方框顺时针走一圈（上→右→下→左）
  const walk = (t, b) => {
    const out = []
    for (let c = t; c < b; c += 1) out.push([t, c])
    for (let r = t; r < b; r += 1) out.push([r, b])
    for (let c = b; c > t; c -= 1) out.push([b, c])
    for (let r = b; r > t; r -= 1) out.push([r, t])
    return out
  }

  const order = []
  const seen = new Set()
  const push = ([r, c]) => {
    if (r < 0 || c < 0 || r > last || c > last) return
    const id = cellId(r, c)
    if (seen.has(id) || kinds[id] !== 'slot') return
    seen.add(id)
    order.push(id)
  }
  // 黑土：上下圈数不同时，外圈只剩较厚那一侧的半圈，照样按顺时针走
  const blackRings = Math.max(up, down)
  for (let d = 1; d <= blackRings; d += 1) {
    walk(lo - d, hi + d).forEach(([r, c]) => { if (!isWhite(r, c)) push([r, c]) })
  }
  const blackCount = order.length
  // 白土：网格最外一圈
  walk(0, last).forEach(push)

  return {
    size,
    city,
    up,
    down,
    lo,
    hi,
    blackRings,
    battleOn,
    cells,
    order,
    blackCount,
    whiteCount: order.length - blackCount,
    blackRect: { r0: 1, c0: 1, r1: last - 1, c1: last - 1 }
  }
}

/**
 * 按实力生成排布单元。
 * 成员 ≤ 格子数：一人一格。
 * 成员 > 格子数：前 slotCount 名一人一格；多出来的人按"强带弱"并进内环——
 * 最强的格子配最弱的多余成员（与参考图内环 "草莓招了 / 大功率" 的做法一致）。
 * 再多就进待分配。
 */
function autoUnits(names, slotCount) {
  const primary = names.slice(0, slotCount)
  const overflow = names.slice(slotCount)
  const pairCount = Math.min(overflow.length, primary.length)
  const weakest = overflow.slice().reverse()
  const units = primary.map((n, i) => (i < pairCount ? [n, weakest[i]] : [n]))
  const tray = weakest.slice(pairCount).reverse()
  return { units, tray }
}

/** 把若干单元按填充顺序放进格子 */
function fill(order, units) {
  const assign = {}
  const rest = []
  units.forEach((u, i) => {
    if (i < order.length) assign[order[i]] = u.slice(0, 2)
    else rest.push(...u)
  })
  return { assign, rest }
}

/** 按当前填充顺序收集所有已放的名字（换尺寸/斗阵时用来重新排） */
function collectUnits(order, assign) {
  return order.filter((id) => assign[id] && assign[id].length).map((id) => assign[id].slice())
}

/** 拖放：交换或合并。返回新的 assign，或 { error } */
function drop(assign, fromId, toId, mode) {
  if (fromId === toId) return { assign }
  const from = assign[fromId] || []
  const to = assign[toId] || []
  if (!from.length) return { assign }
  const next = Object.assign({}, assign)

  if (!to.length) {
    next[toId] = from
    delete next[fromId]
    return { assign: next }
  }
  if (mode === 'merge') {
    if (from.length + to.length > 2) return { error: '一格最多两个名字' }
    next[toId] = to.concat(from)
    delete next[fromId]
    return { assign: next }
  }
  next[toId] = from
  next[fromId] = to
  return { assign: next }
}

/** 拆开：第二个人挪到填充顺序上离得最近的空格，没有空格就进待分配 */
function split(order, assign, id) {
  const names = assign[id] || []
  if (names.length < 2) return { assign, moved: null, toTray: null }
  const next = Object.assign({}, assign)
  next[id] = [names[0]]
  const idx = order.indexOf(id)
  let target = null
  for (let step = 1; step < order.length && !target; step += 1) {
    for (const j of [idx + step, idx - step]) {
      if (j >= 0 && j < order.length && !(next[order[j]] && next[order[j]].length)) {
        target = order[j]
        break
      }
    }
  }
  if (target) {
    next[target] = [names[1]]
    return { assign: next, moved: target, toTray: null }
  }
  return { assign: next, moved: null, toTray: names[1] }
}

/** 解析手输："张三 / 李四"，最多两个 */
function parseNames(text) {
  return String(text || '')
    .split(/[/／、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 名字的视觉宽度：汉字按 1，ASCII 按 0.55 */
function visualWidth(s) {
  let w = 0
  for (const ch of Array.from(s)) w += /[\x00-\xff]/.test(ch) ? 0.55 : 1
  return w
}

/** 按视觉宽度截断，超出加省略号 */
function clip(name, maxWidth) {
  if (visualWidth(name) <= maxWidth) return name
  let w = 0
  let out = ''
  for (const ch of Array.from(name)) {
    const cw = /[\x00-\xff]/.test(ch) ? 0.55 : 1
    if (w + cw > maxWidth - 0.6) break
    out += ch
    w += cw
  }
  return out + '…'
}

/** 屏幕坐标：格子中心（D 为菱形对角线长度） */
function cellCenter(r, c, size, D) {
  const half = D / 2
  return { x: (c - r) * half + (size - 1) * half + half, y: (c + r) * half + half }
}

/** 反算：点 (x, y) 落在哪个格子上；不在菱形内返回 null */
function hitCell(x, y, size, D) {
  const half = D / 2
  const u = (x - (size - 1) * half - half) / half
  const v = (y - half) / half
  const c = Math.round((u + v) / 2)
  const r = Math.round((v - u) / 2)
  if (r < 0 || c < 0 || r >= size || c >= size) return null
  const ctr = cellCenter(r, c, size, D)
  if (Math.abs(x - ctr.x) + Math.abs(y - ctr.y) > half + 0.5) return null
  return cellId(r, c)
}

module.exports = {
  PRESETS,
  BLACK_COLORS,
  WHITE_COLOR,
  ringColor,
  cellId,
  validShape,
  MAX_CITY,
  MAX_RINGS,
  buildGrid,
  autoUnits,
  fill,
  collectUnits,
  drop,
  split,
  parseNames,
  visualWidth,
  clip,
  cellCenter,
  hitCell
}

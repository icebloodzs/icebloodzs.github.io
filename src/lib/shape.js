/**
 * 黑土摆图形（独立于「黑土落位」的成员排布）。
 *
 * 和落位页最大的不同：这里的字是沿**游戏的 X/Y 网格**画的，格子边对边紧挨着，
 * 游戏里看是正的；把地图旋转 45° 画成菱形时，字看起来才是斜的。
 * 所以位图直接落到 (r, c) 上：px → c、py → r，不做菱形方向的换算。
 *
 * 坐标：菱形顶角是 (r=0, c=0)。沿左上边往上 X 递增、沿右上边往右 Y 递减，即
 *   X = originX − r，Y = originY − c
 * originX / originY 就是顶角那一格的游戏坐标，由用户报一个已知格子的实际坐标反推。
 */

/** 5×9 点阵。参考图里一个字约 5 格宽、10 格高，这里按同样的比例做 */
const FONT = {
  '0': ['11111', '11011', '11011', '11011', '11011', '11011', '11011', '11011', '11111'],
  '1': ['00110', '01110', '11110', '00110', '00110', '00110', '00110', '00110', '11111'],
  '2': ['11111', '00011', '00011', '00011', '11111', '11000', '11000', '11000', '11111'],
  '3': ['11111', '00011', '00011', '00011', '11111', '00011', '00011', '00011', '11111'],
  '4': ['11011', '11011', '11011', '11011', '11111', '00011', '00011', '00011', '00011'],
  '5': ['11111', '11000', '11000', '11000', '11111', '00011', '00011', '00011', '11111'],
  '6': ['11111', '11000', '11000', '11000', '11111', '11011', '11011', '11011', '11111'],
  '7': ['11111', '00011', '00011', '00011', '00011', '00011', '00011', '00011', '00011'],
  '8': ['11111', '11011', '11011', '11011', '11111', '11011', '11011', '11011', '11111'],
  '9': ['11111', '11011', '11011', '11011', '11111', '00011', '00011', '00011', '11111'],

  A: ['11111', '11011', '11011', '11011', '11111', '11011', '11011', '11011', '11011'],
  B: ['11110', '11011', '11011', '11011', '11110', '11011', '11011', '11011', '11110'],
  C: ['11111', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11111'],
  D: ['11110', '11011', '11011', '11011', '11011', '11011', '11011', '11011', '11110'],
  E: ['11111', '11000', '11000', '11000', '11111', '11000', '11000', '11000', '11111'],
  F: ['11111', '11000', '11000', '11000', '11111', '11000', '11000', '11000', '11000'],
  G: ['11111', '11000', '11000', '11000', '11011', '11011', '11011', '11011', '11111'],
  H: ['11011', '11011', '11011', '11011', '11111', '11011', '11011', '11011', '11011'],
  I: ['11111', '00110', '00110', '00110', '00110', '00110', '00110', '00110', '11111'],
  L: ['11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11111'],
  N: ['11011', '11111', '11111', '11111', '11011', '11011', '11011', '11011', '11011'],
  O: ['11111', '11011', '11011', '11011', '11011', '11011', '11011', '11011', '11111'],
  P: ['11111', '11011', '11011', '11011', '11111', '11000', '11000', '11000', '11000'],
  R: ['11111', '11011', '11011', '11011', '11111', '11100', '11110', '11011', '11011'],
  S: ['11111', '11000', '11000', '11000', '11111', '00011', '00011', '00011', '11111'],
  T: ['11111', '00110', '00110', '00110', '00110', '00110', '00110', '00110', '00110'],
  U: ['11011', '11011', '11011', '11011', '11011', '11011', '11011', '11011', '11111'],
  V: ['11011', '11011', '11011', '11011', '11011', '11011', '01110', '01110', '00100'],
  W: ['11011', '11011', '11011', '11011', '11111', '11111', '11111', '11111', '01010'],
  X: ['11011', '11011', '01110', '00100', '00100', '00100', '01110', '11011', '11011'],
  Y: ['11011', '11011', '01110', '00100', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00011', '00011', '00110', '01100', '11000', '11000', '11000', '11111'],

  '=': ['00000', '00000', '11111', '11111', '00000', '11111', '11111', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '11111', '00000', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '11111', '00100', '00100', '00000', '00000'],
  '!': ['00110', '00110', '00110', '00110', '00110', '00110', '00000', '00110', '00110'],
  '?': ['11111', '00011', '00011', '00111', '01100', '01100', '00000', '01100', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000', '00000', '00000']
}

/**
 * 整块图案。按**屏幕坐标**画（菱形视角下正立），摆在上 / 下两个方向。
 *
 * 菱形格子只有 ±45° 方向的边是齐的：水平或竖直的边上，格子只能一个挨一个地错开，
 * 边缘一定是锯齿（看着就像缺了角、不圆润）。所以这几个图案的轮廓全部走 45°，
 * 也就是只沿 `p = v + u`、`q = v − u`（正好是游戏网格的两个方向）切，拼出来才是干净的一整块。
 *
 * mask(uMax, vMin, vMax, inside)：u 是屏幕横向、v 是屏幕纵向，inside 给出图形范围。
 */
function mask(uMax, vMin, vMax, inside) {
  const rows = []
  for (let v = vMin; v <= vMax; v += 1) {
    let line = ''
    for (let u = -uMax; u <= uMax; u += 1) line += inside(u, v) ? '1' : '0'
    rows.push(line)
  }
  return rows
}

/**
 * 爱心：两个菱形耳朵搭在 45° 的 V 形下半上。a = 心口深浅（耳朵中心离中线多远），R = 耳朵大小，
 * 整体半宽 a + R、心口深 a。再大一圈（a6 R6 起）上方那片就放不下了，上下两颗心会不一样大。
 */
function heartShape(a, R) {
  const w = a + R
  return (u, v) => Math.abs(Math.abs(u) - a) + Math.abs(v) <= R || (v >= 0 && Math.abs(u) <= w - v)
}

/** 十字：两条互相垂直的 45° 长条。T = 粗细，L = 长度 */
function crossShape(T, L) {
  return (u, v) => {
    const p = v + u
    const q = v - u
    return (Math.abs(q) <= T && Math.abs(p) <= L) || (Math.abs(p) <= T && Math.abs(q) <= L)
  }
}

/** 箭头：朝上的两道 45° 臂（尖朝上）。T = 粗细，L = 臂长 */
function arrowShape(T, L) {
  return (u, v) => {
    const p = v + u
    const q = v - u
    return (q >= 0 && q <= T && p >= 0 && p <= L) || (p >= 0 && p <= T && q >= 0 && q <= L)
  }
}

const PATTERNS = {
  爱心: mask(10, -5, 10, heartShape(5, 5)),
  箭头: mask(7, 0, 10, arrowShape(6, 14)),
  十字: mask(8, -8, 8, crossShape(4, 12))
}

const GLYPH_W = 5
const GLYPH_H = 9
/** 字与字之间空几列 */
const LETTER_GAP = 1

const PATTERN_NAMES = Object.keys(PATTERNS)
const CHARS = Object.keys(FONT).filter((c) => c !== ' ')

/** 摆放区域。左下和右下优先，是主看板；上、下用来放对称的图案 */
const AREAS = [
  { key: 'leftBottom', label: '左下' },
  { key: 'rightBottom', label: '右下' },
  { key: 'top', label: '上方' },
  { key: 'bottom', label: '下方' }
]

/**
 * 网格：内圈城池 city×city + 外面 rings 圈，边长 size = city + 2×rings。
 * 参考图的 7 级就是 9 + 11×2 = 31。
 */
function buildBoard(city, rings) {
  const size = city + 2 * rings
  const lo = rings
  const hi = rings + city - 1
  const cells = []
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const inCity = r >= lo && r <= hi && c >= lo && c <= hi
      const dr = r < lo ? lo - r : r > hi ? r - hi : 0
      const dc = c < lo ? lo - c : c > hi ? c - hi : 0
      cells.push({ id: `${r}_${c}`, r, c, city: inCity, ring: inCity ? 0 : Math.max(dr, dc) })
    }
  }
  return { size, city, rings, lo, hi, cells, free: cells.filter((x) => !x.city) }
}

/** 顶角 (0,0) 的游戏坐标；由某个已知格子的坐标反推 */
function originFrom(knownR, knownC, knownX, knownY) {
  return { x: knownX + knownR, y: knownY + knownC }
}

/** 格子 → 游戏坐标 */
function coordOf(r, c, origin) {
  return { x: origin.x - r, y: origin.y - c }
}

/** 游戏坐标 → 格子 */
function cellOf(x, y, origin) {
  return { r: origin.x - x, c: origin.y - y }
}

/** 文字 / 图案 → 位图（每行一个字符串，'1' 要站人） */
function bitmapOf(text) {
  const raw = String(text || '').trim()
  if (PATTERNS[raw]) return { rows: PATTERNS[raw].slice(), name: raw }

  const chars = Array.from(raw.toUpperCase()).filter((ch) => FONT[ch])
  if (!chars.length) return null
  const rows = []
  for (let y = 0; y < GLYPH_H; y += 1) {
    let line = ''
    chars.forEach((ch, i) => {
      line += FONT[ch][y]
      if (i < chars.length - 1) line += '0'.repeat(LETTER_GAP)
    })
    rows.push(line)
  }
  return { rows, name: chars.join('') }
}

/** 把位图转置：右下那组字要沿 r 方向排，才能贴着菱形的右下边 */
function transpose(rows) {
  const h = rows.length
  const w = rows[0].length
  const out = []
  for (let x = 0; x < w; x += 1) {
    let line = ''
    for (let y = 0; y < h; y += 1) line += rows[y][x]
    out.push(line)
  }
  return out
}

/** 输入里有没有摆不了的字符 */
function unsupported(text) {
  const raw = String(text || '').trim()
  if (PATTERNS[raw]) return []
  const out = []
  Array.from(raw.toUpperCase()).forEach((ch) => {
    if (!FONT[ch] && out.indexOf(ch) < 0) out.push(ch)
  })
  return out
}

/**
 * 把一块位图放到指定区域。
 * 区域按 (r, c) 划分：城池把棋盘分成四片，左下 = 行大列小、右下 = 行大列大……
 * 从里到外找第一个放得下的位置（贴着城池最近的那处）。
 */
function placeBitmap(board, rawRows, area, occupied, target) {
  // 右边贴的是菱形另一条边：先转 90° 顺着边排，再上下翻一次，
  // 让第一个字符落在靠下那一端 —— 读的时候就是「从下到右下」
  const rows = area === 'rightBottom' ? transpose(rawRows).reverse() : rawRows
  const H = rows.length
  const W = rows[0].length
  const taken = occupied || new Set()
  const free = new Set(board.free.map((x) => x.id))
  const { lo, hi, size } = board

  // 区域按菱形上的方位分成四个扇区（u = c−r 横向、v = c+r 纵向，城池在正中）：
  // 左 / 右两块贴着下面两条边，是主看板；上 / 下两块放对称的图案。四块各占一个方向，互不挤占。
  const centerV = size - 1
  const inArea = (r0, c0, h, w) => {
    const rc = r0 + (h - 1) / 2
    const cc = c0 + (w - 1) / 2
    const u = cc - rc
    const dv = cc + rc - centerV
    if (area === 'leftBottom') return u < 0 && Math.abs(dv) <= -u
    if (area === 'rightBottom') return u > 0 && Math.abs(dv) <= u
    if (area === 'top') return dv < 0 && Math.abs(u) <= -dv
    if (area === 'bottom') return dv > 0 && Math.abs(u) <= dv
    return false
  }

  const candidates = []
  for (let r0 = 0; r0 + H <= size; r0 += 1) {
    for (let c0 = 0; c0 + W <= size; c0 += 1) {
      if (!inArea(r0, c0, H, W)) continue
      let fits = true
      const cells = []
      for (let y = 0; y < H && fits; y += 1) {
        for (let x = 0; x < W; x += 1) {
          if (rows[y][x] !== '1') continue
          const r = r0 + y
          const c = c0 + x
          const id = `${r}_${c}`
          if (!free.has(id) || taken.has(id)) {
            fits = false
            break
          }
          cells.push({ id, r, c })
        }
      }
      if (!fits || !cells.length) continue
      // 离城池越近越好（「从里到外」）
      const dist = cells.reduce((s, cell) => {
        const dr = cell.r < lo ? lo - cell.r : cell.r > hi ? cell.r - hi : 0
        const dc = cell.c < lo ? lo - cell.c : cell.c > hi ? cell.c - hi : 0
        return s + Math.max(dr, dc)
      }, 0) / cells.length
      // 偏离本方向中心线多远：先摆正，再谈靠里，免得几块都挤到城池正下方、把别的方向堵死
      const rc = r0 + (H - 1) / 2
      const cc = c0 + (W - 1) / 2
      const off = area === 'top' || area === 'bottom' ? Math.abs(cc - rc) : Math.abs(cc + rc - centerV)
      // 对面已经摆过的话，这块就照着镜像位置摆，两边才对称
      const away = target ? Math.abs(rc - target.r) + Math.abs(cc - target.c) : 0
      candidates.push({ r0, c0, cells, dist, off, away })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => (target ? a.away - b.away : 0) || a.off - b.off || a.dist - b.dist)
  return candidates[0]
}

/** 菱形格子在屏幕上只和斜对角的四个格子共边 */
const SCREEN_NB = [[-1, -1], [1, -1], [-1, 1], [1, 1]]

/**
 * 补缝。
 * 菱形格子的中心在屏幕上是棋盘排列（u + v 必须是偶数），位图按格子中心采样时会漏掉一半位置：
 * 同一行相邻的两格（u 差 2）只在角上碰一下，中间看着就是个白洞；位图里 1 格宽的缝正好落在被丢掉的
 * 位置上时，图形中间也会缺一格。这里把这两种情况补上，图形才是实心的。
 *
 * @param set 已选中的格子集合，键是 'u,v'（会被就地补齐）
 * @param usable (u, v) => 这个位置能不能用
 * @returns 补不上的地方还剩几处
 */
function solidify(set, usable) {
  const has = (u, v) => set.has(u + ',' + v)
  const around = (u, v) => SCREEN_NB.reduce((n, d) => n + (has(u + d[0], v + d[1]) ? 1 : 0), 0)
  let stuck = 0
  for (let pass = 0; pass < 6; pass += 1) {
    const want = []
    stuck = 0
    Array.from(set).forEach((key) => {
      const parts = key.split(',')
      const u = Number(parts[0])
      const v = Number(parts[1])
      // 只在角上相碰：中间那两个位置都空着，补一个把角补严
      const pinches = [
        [u + 2, v, u + 1, v - 1, u + 1, v + 1],
        [u, v + 2, u - 1, v + 1, u + 1, v + 1]
      ]
      pinches.forEach((p) => {
        if (!has(p[0], p[1]) || has(p[2], p[3]) || has(p[4], p[5])) return
        const opts = [{ u: p[2], v: p[3] }, { u: p[4], v: p[5] }].filter((o) => usable(o.u, o.v))
        if (!opts.length) {
          stuck += 1
          return
        }
        // 往图形里面那侧补（周围格子多的一侧）；两侧一样就都补，免得左右不对称
        const best = Math.max.apply(null, opts.map((o) => around(o.u, o.v)))
        opts.filter((o) => around(o.u, o.v) === best).forEach((o) => want.push(o.u + ',' + o.v))
      })
      // 四面都被围住的空洞
      ;[[2, 0], [-2, 0], [0, 2], [0, -2]].forEach((d) => {
        const hu = u + d[0]
        const hv = v + d[1]
        if (has(hu, hv) || around(hu, hv) < 4) return
        if (usable(hu, hv)) want.push(hu + ',' + hv)
        else stuck += 1
      })
    })
    if (!want.length) break
    want.forEach((key) => set.add(key))
  }
  return stuck
}

/**
 * 上 / 下两块：按**屏幕坐标**摆，图案在菱形视角里是正立的。
 * 采样完还要补一次缝（见 solidify），不然图形里会出现白洞。
 */
function placeScreen(board, rows, area, occupied, target) {
  const H = rows.length
  const W = rows[0].length
  const taken = occupied || new Set()
  const free = new Set(board.free.map((x) => x.id))
  const { size, lo, hi } = board
  const centerV = size - 1
  const idOf = (u, v) => `${(v - u) / 2}_${(u + v) / 2}`
  const usable = (u, v) => {
    if (((u + v) % 2 + 2) % 2 !== 0) return false
    const id = idOf(u, v)
    return free.has(id) && !taken.has(id)
  }

  const candidates = []
  for (let v0 = -H; v0 <= 2 * size; v0 += 1) {
    for (let u0 = -size - W; u0 <= size; u0 += 1) {
      const uc = u0 + (W - 1) / 2
      const dv = v0 + (H - 1) / 2 - centerV
      if (area === 'top' && !(dv < 0 && Math.abs(uc) <= -dv)) continue
      if (area === 'bottom' && !(dv > 0 && Math.abs(uc) <= dv)) continue

      const set = new Set()
      let fits = true
      for (let py = 0; py < H && fits; py += 1) {
        for (let px = 0; px < W; px += 1) {
          if (rows[py][px] !== '1') continue
          const u = u0 + px
          const v = v0 + py
          if (((u + v) % 2 + 2) % 2 !== 0) continue // 这个位置没有格子中心
          if (!usable(u, v)) {
            fits = false
            break
          }
          set.add(u + ',' + v)
        }
      }
      if (!fits || !set.size) continue
      const holes = solidify(set, usable)

      const cells = Array.from(set).map((key) => {
        const parts = key.split(',')
        const u = Number(parts[0])
        const v = Number(parts[1])
        const c = (u + v) / 2
        const r = (v - u) / 2
        return { id: `${r}_${c}`, r, c }
      })
      const dist = cells.reduce((acc, cell) => {
        const dr = cell.r < lo ? lo - cell.r : cell.r > hi ? cell.r - hi : 0
        const dc = cell.c < lo ? lo - cell.c : cell.c > hi ? cell.c - hi : 0
        return acc + Math.max(dr, dc)
      }, 0) / cells.length
      const rc = cells.reduce((acc, x) => acc + x.r, 0) / cells.length
      const cc = cells.reduce((acc, x) => acc + x.c, 0) / cells.length
      const away = target ? Math.abs(rc - target.r) + Math.abs(cc - target.c) : 0
      candidates.push({ cells, holes, dist, off: Math.abs(uc), away, rc, cc })
    }
  }
  if (!candidates.length) return null
  // 先要图形完整（没有补不上的缝），再谈对称、摆正、靠里
  candidates.sort(
    (a, b) =>
      a.holes - b.holes ||
      b.cells.length - a.cells.length ||
      (target ? a.away - b.away : 0) ||
      a.off - b.off ||
      a.dist - b.dist
  )
  return candidates[0]
}

/**
 * 一次摆多块。
 * @param board buildBoard 的结果
 * @param items [{ area, text }]，按数组顺序编号
 * @param origin 顶角坐标，用来给每格标游戏坐标
 * @returns { blocks: [{area, text, ok, reason, cells:[{id,r,c,seq,x,y}], total}], cells, total }
 */
function placeAll(board, items, origin) {
  const taken = new Set()
  const blocks = []
  const placed = {}
  let seq = 0
  items.forEach((item) => {
    const text = String(item.text || '').trim()
    if (!text) return
    const bad = unsupported(text)
    if (bad.length) {
      blocks.push({ area: item.area, text, ok: false, reason: `摆不了：${bad.join(' ')}`, cells: [], total: 0 })
      return
    }
    const bmp = bitmapOf(text)
    if (!bmp) {
      blocks.push({ area: item.area, text, ok: false, reason: '这个内容摆不了', cells: [], total: 0 })
      return
    }
    // 对面那块已经摆好的话，这块就按镜像位置摆：
    //   左 ↔ 右 是沿垂直中线镜像，(r, c) → (c, r)
    //   上 ↔ 下 是沿水平中线镜像，(r, c) → (size−1−r, size−1−c)
    const mirrorOf = { leftBottom: 'rightBottom', rightBottom: 'leftBottom', top: 'bottom', bottom: 'top' }
    const done = placed[mirrorOf[item.area]]
    let target = null
    if (done) {
      target =
        item.area === 'top' || item.area === 'bottom'
          ? { r: board.size - 1 - done.r, c: board.size - 1 - done.c }
          : { r: done.c, c: done.r }
    }

    const screenArea = item.area === 'top' || item.area === 'bottom'
    const hit = screenArea
      ? placeScreen(board, bmp.rows, item.area, taken, target)
      : placeBitmap(board, bmp.rows, item.area, taken, target)
    if (!hit) {
      blocks.push({ area: item.area, text, ok: false, reason: '这一片放不下，换短一点的内容', cells: [], total: 0 })
      return
    }
    // 序号按各块自己的读法编：
    //   左块贴左下边，一行行往下读（行内从左到右）
    //   右块贴右下边，一列列往右读（列内从下往上）——就是「从下到右下」
    //   上 / 下的图案是正立的，按屏幕从上到下、从左到右读
    const order = {
      leftBottom: (a, b) => a.r - b.r || a.c - b.c,
      rightBottom: (a, b) => a.c - b.c || b.r - a.r,
      top: (a, b) => a.r + a.c - (b.r + b.c) || a.c - a.r - (b.c - b.r),
      bottom: (a, b) => a.r + a.c - (b.r + b.c) || a.c - a.r - (b.c - b.r)
    }
    const cells = hit.cells
      .slice()
      .sort(order[item.area] || order.leftBottom)
      .map((cell) => {
        seq += 1
        const xy = coordOf(cell.r, cell.c, origin)
        return { ...cell, seq, x: xy.x, y: xy.y }
      })
    cells.forEach((cell) => taken.add(cell.id))
    placed[item.area] = {
      r: cells.reduce((acc, x) => acc + x.r, 0) / cells.length,
      c: cells.reduce((acc, x) => acc + x.c, 0) / cells.length
    }
    blocks.push({ area: item.area, text: bmp.name, ok: true, reason: '', cells, total: cells.length })
  })

  const all = []
  blocks.forEach((b) => all.push(...b.cells))
  return { blocks, cells: all, total: all.length }
}

export {
  FONT,
  placeScreen,
  solidify,
  PATTERNS,
  PATTERN_NAMES,
  CHARS,
  AREAS,
  GLYPH_W,
  GLYPH_H,
  buildBoard,
  originFrom,
  coordOf,
  cellOf,
  bitmapOf,
  unsupported,
  placeBitmap,
  placeAll
}

<script setup>
/**
 * 黑土摆图形。算法直接用小程序那份 lib/shape.js，一个字没改，两端结果一致。
 *
 * 和「黑土落位」的区别：这里的字是沿**游戏的 X/Y 网格**画的，格子边对边紧挨着，
 * 在菱形视角下看才是正的。这里只算「哪些格子要站人、每格的序号和坐标」，不排成员。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import * as S from '../lib/shape'
import * as P from '../lib/placement'
import { download } from '../xlsx'

const message = useMessage()

/** 摆图形只在 7 级城池上摆：内 9×9 + 外 11 圈，边长 31 */
const LEVEL = { label: '7级城池', city: 9, rings: 11 }
/** 四个区域各一种底色，和小程序保持一致 */
const BLOCK_COLORS = [
  { fill: '#4a90d9', text: '#fff' },
  { fill: '#5cb85c', text: '#fff' },
  { fill: '#d9534f', text: '#fff' },
  { fill: '#f0ad4e', text: '#5a3a00' },
  { fill: '#8e6bd8', text: '#fff' },
  { fill: '#20a8a0', text: '#fff' }
]
const AREAS = S.AREAS
/** 快捷键：图案名一点就填进对应区域；示例一键把四块都填上，和小程序的快捷按钮同一套图案 */
const PATTERNS = S.PATTERN_NAMES
const CHAR_HINT = S.CHARS.join(' ')
function fill(area, v) { texts.value[area] = texts.value[area] === v ? '' : v }
/**
 * 默认示例：开发者在「满屏截图」上手动摆的一套（左 N、右 B、上 V、下「不」，共 159 格；N 沿用原来那套示例的 N），参照坐标 660,647，序号照他摆的顺序。
 * 都是自定义块、不靠填字生成；前两块空着，N、B、V+不 放在自定义 3~5，颜色就是红、橙、紫。
 */
const EXAMPLE = [[], []].concat([["17_6", "17_7", "18_6", "18_7", "18_8", "19_7", "19_8", "19_9", "20_8", "20_9", "21_9", "21_10", "22_1", "22_2", "22_3", "22_4", "22_5", "22_6", "22_7", "22_8", "22_9", "22_10", "22_11", "22_12", "23_1", "23_2", "23_3", "23_4", "23_5", "23_6", "23_7", "23_8", "23_9", "23_10", "23_11", "23_12", "24_2", "24_3", "25_3", "25_4", "26_3", "26_4", "26_5", "27_4", "27_5", "27_6", "28_5", "28_6", "28_7", "29_6", "29_7"], ["1_21", "1_22", "1_23", "2_20", "2_21", "2_22", "2_23", "2_24", "3_19", "3_20", "3_24", "3_25", "4_18", "4_19", "4_24", "4_25", "5_17", "5_18", "5_24", "5_25", "5_26", "5_27", "5_28", "6_17", "6_18", "6_23", "6_24", "6_25", "6_27", "6_28", "6_29", "7_18", "7_19", "7_22", "7_23", "7_24", "7_28", "7_29", "8_19", "8_20", "8_21", "8_22", "8_23", "8_29", "9_20", "9_21", "9_22", "9_29", "10_21", "10_22", "10_28", "10_29", "11_22", "11_23", "11_27", "11_28", "12_23", "12_24", "12_26", "12_27", "12_28", "13_24", "13_25", "13_26", "13_27", "14_24", "14_25"], ["21_21", "20_21", "22_22", "23_23", "24_24", "20_20", "20_19", "21_19", "19_20", "19_21", "22_18", "23_17", "18_22", "17_23", "21_20", "22_20", "23_20", "24_20", "20_22", "20_23", "20_24", "20_25", "10_10", "10_8", "10_9", "9_9", "9_10", "8_10", "8_9", "9_8", "9_7", "8_6", "9_6", "8_5", "7_5", "8_4", "7_9", "6_9", "5_8", "4_8", "5_9"]])
/**
 * 满屏特例：一颗实心大爱心把 7 级城裹在里面（159 格）。
 * 心形只走 45° 边：两个菱形弧 + 下面的 ∨，城池四周第一圈都在心里；城池本身的格子不站人。
 * 序号按屏幕从上到下、从左到右。
 */
const EXAMPLE_HEART = ["10_6", "6_10", "11_6", "10_7", "7_10", "6_11", "12_6", "11_7", "10_8", "8_10", "7_11", "6_12", "13_6", "12_7", "11_8", "10_9", "9_10", "8_11", "7_12", "6_13", "14_6", "13_7", "12_8", "11_9", "10_10", "9_11", "8_12", "7_13", "6_14", "15_6", "14_7", "13_8", "12_9", "11_10", "10_11", "9_12", "8_13", "7_14", "6_15", "16_6", "15_7", "14_8", "13_9", "12_10", "10_12", "9_13", "8_14", "7_15", "6_16", "17_6", "16_7", "15_8", "14_9", "13_10", "10_13", "9_14", "8_15", "7_16", "6_17", "18_6", "17_7", "16_8", "15_9", "14_10", "10_14", "9_15", "8_16", "7_17", "6_18", "19_6", "18_7", "17_8", "16_9", "15_10", "10_15", "9_16", "8_17", "7_18", "6_19", "20_6", "19_7", "18_8", "17_9", "16_10", "10_16", "9_17", "8_18", "7_19", "6_20", "21_6", "20_7", "19_8", "18_9", "17_10", "10_17", "9_18", "8_19", "7_20", "6_21", "21_7", "20_8", "19_9", "18_10", "10_18", "9_19", "8_20", "7_21", "21_8", "20_9", "19_10", "10_19", "9_20", "8_21", "21_9", "20_10", "10_20", "9_21", "21_10", "20_11", "11_20", "10_21", "21_11", "20_12", "12_20", "11_21", "21_12", "20_13", "13_20", "12_21", "21_13", "20_14", "14_20", "13_21", "21_14", "20_15", "15_20", "14_21", "21_15", "20_16", "16_20", "15_21", "21_16", "20_17", "17_20", "16_21", "21_17", "20_18", "18_20", "17_21", "21_18", "20_19", "19_20", "18_21", "21_19", "20_20", "19_21", "21_20", "20_21", "21_21"]
function fillExample(which) {
  texts.value = { leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' }
  scope.value = 'screen'
  baseX.value = '660'
  baseY.value = '647'
  const blocks = which === 'heart' ? [EXAMPLE_HEART] : EXAMPLE
  // 等改字的 watch 先清完旧的手动修改，再铺示例
  setTimeout(() => { snapshot(); custom.value = blocks.map((b) => b.slice()).concat(Array.from({ length: CUSTOM_N }, () => [])).slice(0, CUSTOM_N) }, 0)
}
function clearAll() {
  texts.value = { leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' }
  setTimeout(() => { custom.value = Array.from({ length: CUSTOM_N }, () => []) }, 0)
}

const baseX = ref('660')
const baseY = ref('647')
const texts = ref({ leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' })
const D = ref(56)

/**
 * 范围：整块黑土（原来的），或者「满屏截图」—— 游戏缩到最小、城池居中截一张图能看到的那些格子（S.VIEW），
 * 只往这些格子里摆，图上也只画这些、裁成截图的样子。记在本机。
 */
const SCOPE_KEY = 'shape_scope'
const scope = ref('full')
try { if (localStorage.getItem(SCOPE_KEY) === 'screen') scope.value = 'screen' } catch (e) {}
watch(scope, (v) => { try { localStorage.setItem(SCOPE_KEY, v) } catch (e) {} })
const board = computed(() => S.buildBoard(LEVEL.city, LEVEL.rings, scope.value === 'screen'))

/**
 * 顶角 (0,0) 那一格的游戏坐标 —— 填的就是黑土最上面那一格，不用换算。
 * 没填就返回 null，图上只标序号、不标坐标。
 */
const origin = computed(() => {
  const x = Number(baseX.value)
  const y = Number(baseY.value)
  if (!baseX.value || !baseY.value || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
})

/** 按填的字算出来的原样（还没手动改过） */
const auto = computed(() => {
  const items = S.AREAS.map((a) => ({ area: a.key, text: texts.value[a.key] })).filter((x) => x.text)
  return S.placeAll(board.value, items, origin.value || { x: 0, y: 0 })
})

/*
 * 自定义：在摆好的图上手动擦掉格子、或者往某一块里补格子。
 *   erased：擦掉的原有格子 id；added：补上的格子 id → 补进第几块（auto.blocks 的下标）
 * 改字后图会重新摆，手动改的就作废清空；只改参照坐标不影响格子，保留。
 * 序号照原来那块的读法重新编（左块逐行、右块逐列、上下按屏幕），报点顺序不会乱。
 */
const editing = ref(false)
const brush = ref('erase') // 'erase'、块下标（数字）、或者 'c0'~'c3'（自定义块）
/*
 * 按住 E 或 Alt（Mac 是 Option）临时变橡皮擦，松开回到原来的画笔；鼠标也跟着变成橡皮擦。
 * 焦点在输入框里时按 E 是打字，不算。
 */
const holdErase = ref(false)
const curBrush = computed(() => (holdErase.value ? 'erase' : brush.value))
const typing = (ev) => { const t = ev.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) }
function onKey(ev) {
  if (!editing.value) { holdErase.value = false; return }
  const down = ev.type === 'keydown'
  if (ev.key === 'Alt') { holdErase.value = down; if (down) ev.preventDefault(); return }
  if ((ev.key === 'e' || ev.key === 'E') && !typing(ev) && !ev.metaKey && !ev.ctrlKey) holdErase.value = down
}
const releaseErase = () => { holdErase.value = false }
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', releaseErase) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', releaseErase) })
const erased = ref(new Set())
const added = ref(new Map())
const history = ref([])
/*
 * 自定义块：不靠填字，直接在格子上画出来的块（没填任何字也能画）。每块是一串格子 id，序号按画的先后编。
 * 改字不会清掉它们，只有「清空」「恢复原样」会。
 */
const CUSTOM_N = 5
const custom = ref(Array.from({ length: CUSTOM_N }, () => []))
const customCount = computed(() => custom.value.reduce((a, b) => a + b.length, 0))
watch(texts, () => { erased.value = new Set(); added.value = new Map(); history.value = [] }, { deep: true })

const ORDER = {
  leftBottom: (a, b) => a.r - b.r || a.c - b.c,
  rightBottom: (a, b) => a.c - b.c || b.r - a.r,
  top: (a, b) => a.r + a.c - (b.r + b.c) || a.c - a.r - (b.c - b.r),
  bottom: (a, b) => a.r + a.c - (b.r + b.c) || a.c - a.r - (b.c - b.r)
}

const result = computed(() => {
  const base = auto.value
  const nAuto = base.blocks.length
  // ci：块的颜色下标（自定义块排在填字的块后面）
  if (!erased.value.size && !added.value.size && !customCount.value) return { ...base, blocks: base.blocks.map((b, bi) => ({ ...b, ci: bi })) }
  const o = origin.value || { x: 0, y: 0 }
  const byId = new Map(board.value.cells.map((c) => [c.id, c]))
  let seq = 0
  const blocks = base.blocks.map((b, bi) => {
    if (!b.ok) return b
    const kept = b.cells.filter((c) => !erased.value.has(c.id)).map((c) => ({ id: c.id, r: c.r, c: c.c, city: c.city, ring: c.ring }))
    added.value.forEach((to, id) => { if (to === bi) { const c = byId.get(id); if (c) kept.push({ id, r: c.r, c: c.c, city: c.city, ring: c.ring }) } })
    const cells = kept.sort(ORDER[b.area] || ORDER.leftBottom).map((c) => {
      seq += 1
      const xy = S.coordOf(c.r, c.c, o)
      return { ...c, seq, x: xy.x, y: xy.y }
    })
    return { ...b, cells, total: cells.length, ci: bi }
  })
  const free = new Set(board.value.free.map((c) => c.id))
  custom.value.forEach((ids, k) => {
    const cells = ids.filter((id) => free.has(id)).map((id) => {
      const c = byId.get(id)
      seq += 1
      const xy = S.coordOf(c.r, c.c, o)
      return { id, r: c.r, c: c.c, seq, x: xy.x, y: xy.y }
    })
    if (cells.length) blocks.push({ area: 'custom', label: `自定义${k + 1}`, text: '', ok: true, reason: '', cells, total: cells.length, ci: nAuto + k })
  })
  const all = []
  blocks.forEach((b) => all.push(...b.cells))
  return { blocks, cells: all, total: all.length }
})
const edited = computed(() => erased.value.size + added.value.size + customCount.value)

/** 画笔可选：擦除 + 每个摆成功的块 */
const brushes = computed(() => [{ key: 'erase', label: '橡皮擦', color: '#6b7280' }].concat(
  auto.value.blocks.map((b, bi) => ({ key: bi, ok: b.ok, label: `补到${(S.AREAS.find((a) => a.key === b.area) || {}).label || b.area}「${b.text}」`, color: BLOCK_COLORS[bi % BLOCK_COLORS.length].fill }))
    .filter((x) => x.ok))
  .concat(custom.value.map((_ids, k) => ({ key: 'c' + k, label: `画到自定义${k + 1}`, color: BLOCK_COLORS[(auto.value.blocks.length + k) % BLOCK_COLORS.length].fill }))))

/** 点一格（或按住拖过去）：橡皮擦掉、画笔补进选中的那块 */
let painting = false
function snapshot() { history.value.push({ e: new Set(erased.value), a: new Map(added.value), c: custom.value.map((b) => b.slice()) }); if (history.value.length > 50) history.value.shift() }
function paint(id) {
  if (!editing.value) return
  const hit = hitMap.value.get(id)
  const e = new Set(erased.value), a = new Map(added.value)
  const cu = custom.value.map((b) => b.slice())
  const inCustom = cu.findIndex((b) => b.includes(id))
  const dropCustom = () => { if (inCustom >= 0) cu[inCustom] = cu[inCustom].filter((x) => x !== id) }
  const original = auto.value.blocks.findIndex((b) => b.ok && b.cells.some((c) => c.id === id))
  const b = curBrush.value
  if (b === 'erase') {
    if (!hit) return
    if (inCustom >= 0) dropCustom()
    else {
      if (a.has(id)) a.delete(id)
      if (original >= 0) e.add(id)
    }
  } else if (String(b).startsWith('c')) {
    // 画进自定义块：从别的块里拿出来，接到这一块最后（序号按画的先后）
    const k = Number(String(b).slice(1))
    if (inCustom === k) return
    dropCustom()
    a.delete(id)
    if (original >= 0) e.add(id)
    cu[k].push(id)
  } else {
    dropCustom()
    const to = Number(b)
    if (hit && hit.block === to) return
    a.delete(id); e.delete(id)
    if (original === to) { /* 原来就是这块的，取消擦除就行 */ } else {
      if (original >= 0) e.add(id)
      a.set(id, to)
    }
  }
  erased.value = e; added.value = a; custom.value = cu
}
/*
 * 只有鼠标真的挪了位置才接着画：画第一格后上方会多出一行（自定义块的统计、按钮状态），格子图往下挪，
 * 鼠标没动也会「进入」旁边那格 —— 第一下总是出来两格就是这个（11-17 修）。
 */
let lastXY = null
function startPaint(id, ev) { if (!editing.value) return; snapshot(); painting = true; lastXY = ev ? [ev.clientX, ev.clientY] : null; paint(id) }
function overPaint(id, ev) {
  if (!painting) return
  if (ev) {
    if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) { painting = false; return }
    if (lastXY && ev.clientX === lastXY[0] && ev.clientY === lastXY[1]) return
    lastXY = [ev.clientX, ev.clientY]
  }
  paint(id)
}
function endPaint() { painting = false; lastXY = null }
function undo() { const h = history.value.pop(); if (h) { erased.value = h.e; added.value = h.a; custom.value = h.c } }
function resetEdits() { snapshot(); erased.value = new Set(); added.value = new Map(); custom.value = Array.from({ length: CUSTOM_N }, () => []) }

/** 格子 id → 它属于哪一块、序号、坐标 */
const hitMap = computed(() => {
  const m = new Map()
  result.value.blocks.forEach((b, bi) => b.cells.forEach((c) => m.set(c.id, { ...c, block: b.ci ?? bi })))
  return m
})

const span = computed(() => board.value.size * D.value)
/** svg 的可视范围：整块黑土就是整张；满屏截图只框住截图里那些格子 */
const box = computed(() => {
  if (!board.value.screen || !cells.value.length) return { x: 0, y: 0, w: span.value, h: span.value }
  const h = D.value / 2
  const xs = cells.value.map((c) => c.x), ys = cells.value.map((c) => c.y)
  const x = Math.min(...xs) - h, y = Math.min(...ys) - h
  return { x, y, w: Math.max(...xs) + h - x, h: Math.max(...ys) + h - y }
})

/**
 * 格子是个菱形，离中心越远能写字的地方越窄，所以字号得按放字的高度算出来。
 * dy 是文字中心离格子中心的距离，chars 是要写几个字符。
 * 推导：菱形在偏移 t 处的半宽是 D/2 - |t|，文字占 dy±fs/2 这一段，取最窄处。
 */
function fitFont(dy, chars) {
  const room = D.value / 2 - Math.abs(dy) * D.value
  return Math.max(5, Math.floor(room / (chars * 0.6 / 2 + 0.5)))
}
/**
 * 一格里上下两行：上面序号、下面坐标。
 * 坐标是 7 个字符，又在格子偏下、菱形最窄的地方，字号只能压得很小；
 * 嫌看不清就把「格子大小」往右拖，或者直接看下面的点位清单。
 * 没填参照坐标时就只有序号，那它独占一行、可以放大些。
 */
const label = computed(() => {
  if (!origin.value) return { seq: { dy: 0, fs: fitFont(0, 3) } }
  return {
    seq: { dy: -0.13 * D.value, fs: fitFont(0.13, 3) },
    coord: { dy: 0.15 * D.value, fs: fitFont(0.15, 7) }
  }
})

const cells = computed(() => {
  const b = board.value
  const out = []
  b.cells.forEach((cell) => {
    if (cell.city || !cell.inView) return
    const hit = hitMap.value.get(cell.id)
    const ctr = P.cellCenter(cell.r, cell.c, b.size, D.value)
    const color = hit ? BLOCK_COLORS[hit.block % BLOCK_COLORS.length] : null
    out.push({
      id: cell.id,
      x: ctr.x,
      y: ctr.y,
      // 图形格子用自己的底色描边，几格拼起来才是实心的，不会有白缝
      fill: color ? color.fill : '#f3f4f6',
      stroke: color ? color.fill : '#e2e4e8',
      text: color ? color.text : '',
      seq: hit ? String(hit.seq).padStart(3, '0') : '',
      coord: hit ? `${hit.x},${hit.y}` : ''
    })
  })
  return out
})

const city = computed(() => {
  const b = board.value
  const mid = (b.size - 1) / 2
  const ctr = P.cellCenter(mid, mid, b.size, D.value)
  return { x: ctr.x, y: ctr.y, d: b.city * D.value, label: LEVEL.label }
})

const corner = computed(() => {
  if (!origin.value) return null
  const n = board.value.size - 1
  return { top: `${origin.value.x},${origin.value.y}`, bottom: `${origin.value.x - n},${origin.value.y - n}` }
})

/** 序号 → 坐标 的清单，方便直接复制到群里报点 */
const list = computed(() => {
  const out = []
  result.value.blocks.forEach((b, bi) => {
    if (!b.ok) return
    const area = b.label || (S.AREAS.find((a) => a.key === b.area) || {}).label || b.area
    b.cells.forEach((c) => out.push({ seq: String(c.seq).padStart(3, '0'), area, text: b.text, coord: `${c.x},${c.y}`, _i: bi }))
  })
  return out
})

const blocks = computed(() =>
  result.value.blocks.filter((b) => !b.ok || b.cells.length).map((b, bi) => ({
    area: b.label || (S.AREAS.find((a) => a.key === b.area) || {}).label || b.area,
    text: b.text,
    ok: b.ok,
    reason: b.reason,
    total: b.total,
    from: b.ok ? String(b.cells[0].seq).padStart(3, '0') : '',
    to: b.ok ? String(b.cells[b.cells.length - 1].seq).padStart(3, '0') : '',
    color: b.ok ? BLOCK_COLORS[(b.ci ?? bi) % BLOCK_COLORS.length].fill : '#b9bec6'
  }))
)

const listCols = [
  { title: '序号', key: 'seq', width: 80 },
  { title: '区域', key: 'area', width: 80 },
  { title: '内容', key: 'text', width: 100 },
  { title: '坐标', key: 'coord' }
]

async function copyList() {
  const txt = list.value.map((r) => `${r.seq} ${r.area}${r.text} ${r.coord}`).join('\n')
  try {
    await navigator.clipboard.writeText(txt)
    message.success(`已复制 ${list.value.length} 个点位`)
  } catch {
    message.error('复制失败，可以手动选中表格')
  }
}

function savePng() {
  const svg = document.getElementById('shape-map')
  if (!svg) return
  const blob = new Blob(['<?xml version="1.0"?>' + new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width * 2
    canvas.height = img.height * 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob((b) => download(b, '摆图形.png'))
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    message.error('导出失败，可以直接截图')
  }
  img.src = url
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="摆图形" :bordered="false">
      <template #header-extra>
        <n-button :disabled="!result.total" @click="savePng">下载图片</n-button>
      </template>

      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        用 7 级城池的黑土格子拼字或图案，整幅图摆在城池下方：左下、右下各一块贴着下边，
        正下方再放个图案，中间留出缝、左右对称；城池正左、正右也能各放一个图案。填了参照坐标之后每格都会标出实际坐标，照着报点位不会错。
      </n-alert>

      <n-form label-placement="left" :label-width="90" size="small">
        <n-grid cols="1 s:2 l:3" responsive="screen" :x-gap="16">
          <n-gi span="1 s:2 l:3">
            <n-form-item label="参照坐标">
              <n-space :size="8" align="center">
                <n-input v-model:value="baseX" placeholder="X 如 521" style="width: 120px" />
                <n-input v-model:value="baseY" placeholder="Y 如 1314" style="width: 120px" />
                <span class="lab">填黑土最上面那一格的坐标，游戏里点一下那格就能看到</span>
              </n-space>
            </n-form-item>
          </n-gi>
          <n-gi v-for="a in AREAS" :key="a.key">
            <n-form-item :label="a.label" :show-feedback="false" style="margin-bottom: 4px">
              <n-input v-model:value="texts[a.key]" placeholder="字或图案名" clearable />
            </n-form-item>
            <!-- 快捷键：点一下填进这一块，再点一下清掉 -->
            <div class="quick">
              <n-tag v-for="p in PATTERNS" :key="p" size="small" round checkable :checked="texts[a.key] === p" @update:checked="fill(a.key, p)">{{ p }}</n-tag>
            </div>
          </n-gi>
        </n-grid>
      </n-form>
      <n-space align="center" :size="10" style="margin: 2px 0 12px">
        <n-button size="small" @click="fillExample()">填示例（满屏 · V + N + B + 不）</n-button>
        <n-button size="small" @click="fillExample('heart')">满屏特例：爱心围城</n-button>
        <n-button size="small" @click="clearAll">清空</n-button>
        <span class="lab">字能写：{{ CHAR_HINT }}</span>
        <span class="lab">图案：{{ PATTERNS.join('、') }}</span>
      </n-space>

      <n-space align="center" :size="14" style="margin-bottom: 10px">
        <span class="lab">范围</span>
        <n-radio-group v-model:value="scope" size="small">
          <n-radio-button value="full">整块黑土</n-radio-button>
          <n-radio-button value="screen">满屏截图（含 7 级城）</n-radio-button>
        </n-radio-group>
        <span class="lab">{{ scope === 'screen' ? '只用游戏缩到最小、城池居中截一张图能看到的格子' : '整块黑土都能摆，截图可能拍不全' }}</span>
      </n-space>
      <n-space align="center" :size="14">
        <span class="lab">格子大小</span>
        <n-slider v-model:value="D" :min="20" :max="80" :step="2" style="width: 160px" />
        <span v-if="corner" class="lab">
          顶角 {{ corner.top }} · 底角 {{ corner.bottom }}
        </span>
        <span v-else class="lab">没填参照坐标，图上只有序号</span>
      </n-space>

      <n-space v-if="blocks.length" :size="10" style="margin-top: 14px">
        <n-tag v-for="b in blocks" :key="b.area" :bordered="false" :color="{ color: b.color, textColor: '#fff' }">
          {{ b.area }}{{ b.text ? `「${b.text}」` : "" }} {{ b.ok ? `${b.total} 格 · ${b.from}–${b.to}` : b.reason || '摆不下' }}
        </n-tag>
        <n-tag :bordered="false">共 {{ result.total }} 格</n-tag>
      </n-space>
    </n-card>

    <n-card v-if="cells.length" :bordered="false">
      <!-- 自定义：摆好后手动擦掉 / 补上 -->
      <div class="edit-bar">
        <n-switch v-model:value="editing" size="small" />
        <span class="lab" style="color:#4b5563">自定义（擦掉 / 补上）</span>
        <template v-if="editing">
          <n-radio-group v-model:value="brush" size="small">
            <n-radio-button v-for="b in brushes" :key="b.key" :value="b.key">
              <span class="sw" :style="{ background: b.color }"></span>{{ b.label }}
            </n-radio-button>
          </n-radio-group>
          <n-button size="small" :disabled="!history.length" @click="undo">撤销</n-button>
          <n-button size="small" :disabled="!edited" @click="resetEdits">恢复原样</n-button>
          <span class="lab">点格子或按住拖过去；按住 E 或 Alt（Option）临时变橡皮擦；不填字也能用「画到自定义」直接画，序号按画的先后编；改了字会重新摆，擦补填字块的会清掉，自定义块保留</span>
        </template>
        <span v-else-if="edited" class="lab">已手动改 {{ edited }} 格</span>
      </div>
      <div class="wrap">
        <svg id="shape-map" :class="{ editing, erasing: editing && curBrush === 'erase' }" :width="box.w" :height="box.h" @pointerup="endPaint" @pointerleave="endPaint" :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`" xmlns="http://www.w3.org/2000/svg">
          <g v-for="c in cells" :key="c.id" :class="{ paintable: editing }" @pointerdown.prevent="startPaint(c.id, $event)" @pointerenter="overPaint(c.id, $event)">
            <g :transform="`translate(${c.x},${c.y}) rotate(45)`">
              <rect
                :x="-D / 2.83" :y="-D / 2.83" :width="D / 1.414" :height="D / 1.414" rx="2"
                :fill="c.fill" :stroke="c.stroke" stroke-width="1"
              />
            </g>
            <template v-if="c.seq">
              <text
                :x="c.x" :y="c.y + label.seq.dy + label.seq.fs * 0.35" text-anchor="middle"
                :font-size="label.seq.fs" font-weight="700" :fill="c.text"
              >{{ c.seq }}</text>
              <text
                v-if="label.coord" :x="c.x" :y="c.y + label.coord.dy + label.coord.fs * 0.35"
                text-anchor="middle" :font-size="label.coord.fs" font-weight="600" :fill="c.text"
              >{{ c.coord }}</text>
            </template>
          </g>
          <g :transform="`translate(${city.x},${city.y}) rotate(45)`">
            <rect :x="-city.d / 2.83" :y="-city.d / 2.83" :width="city.d / 1.414" :height="city.d / 1.414"
              rx="6" fill="#e8a33d" stroke="#b5651d" stroke-width="3" />
          </g>
          <text :x="city.x" :y="city.y + 8" text-anchor="middle"
            :font-size="Math.max(10, Math.round(city.d * 0.16))" font-weight="700" fill="#7c2d12">{{ city.label }}</text>
        </svg>
      </div>
    </n-card>

    <n-card v-if="list.length && origin" :bordered="false" title="点位清单">
      <template #header-extra>
        <n-button size="small" @click="copyList">复制清单</n-button>
      </template>
      <n-data-table :columns="listCols" :data="list" :max-height="360" size="small" :row-key="(r) => r.seq" virtual-scroll />
    </n-card>
  </n-space>
</template>

<style scoped>
.wrap { overflow: auto; text-align: center; }
.lab { font-size: 13px; color: #8a9099; }
.edit-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 12px; }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
#shape-map.editing { touch-action: none; cursor: crosshair; user-select: none; }
#shape-map.editing.erasing { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(-45 12 12)'><rect x='3' y='8' width='18' height='9' rx='2' fill='%23f9a8d4' stroke='%23374151' stroke-width='1.5'/><rect x='3' y='8' width='7' height='9' rx='2' fill='%23e5e7eb' stroke='%23374151' stroke-width='1.5'/></g></svg>") 5 19, cell; }
.paintable:hover rect { opacity: 0.75; }
.quick { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px 90px; }
@media (max-width: 639px) { .edit-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 12px; }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
#shape-map.editing { touch-action: none; cursor: crosshair; user-select: none; }
#shape-map.editing.erasing { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(-45 12 12)'><rect x='3' y='8' width='18' height='9' rx='2' fill='%23f9a8d4' stroke='%23374151' stroke-width='1.5'/><rect x='3' y='8' width='7' height='9' rx='2' fill='%23e5e7eb' stroke='%23374151' stroke-width='1.5'/></g></svg>") 5 19, cell; }
.paintable:hover rect { opacity: 0.75; }
.quick { margin-left: 0; } }
/* 手机：整张图缩到屏幕宽度（要看细节双指放大）；下载图片读的是 svg 自身尺寸，不受影响 */
@media (max-width: 767px) {
  #shape-map { width: 100%; height: auto; }
}
</style>

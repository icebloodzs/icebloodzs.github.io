<script setup>
/**
 * 黑土摆图形。算法直接用小程序那份 lib/shape.js，一个字没改，两端结果一致。
 *
 * 和「黑土落位」的区别：这里的字是沿**游戏的 X/Y 网格**画的，格子边对边紧挨着，
 * 在菱形视角下看才是正的。这里只算「哪些格子要站人、每格的序号和坐标」，不排成员。
 */
import { ref, computed, watch, inject, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'
import * as S from '../lib/shape'
import * as P from '../lib/placement'
import { download, buildExcel } from '../xlsx'

const message = useMessage()
const dialog = useDialog()
const { me } = inject('app')

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
/**
 * 整块黑土特例：左下「183」、右下「I ♥ U」（爱心穿一支箭），照用户 11-19 给的参考图逐格搬过来，共 200 格。
 * 位图按游戏网格画（行 → r、列 → c），和左下 / 右下填字的摆法一致：
 *   左下：r = 21 + 行、c = 9 + 列，字头朝城池；
 *   右下：先转 90° 顺着右下边排（第一个字 I 在靠下那一端），c = 21 + 行、r = 29 − 列。
 * 序号也照这两块的读法：左块逐行、右块逐列从下往上。
 */
const LOVE_183 = [
  '10111101111',
  '10100100001',
  '10100100001',
  '10100100001',
  '10111101111',
  '10100100001',
  '10100100001',
  '10100100001',
  '10111101111'
]
const LOVE_IU = [
  '111100000100000100000001100011',
  '111100001110001110000001100011',
  '011000011111011111010001100011',
  '011000011111111111001001100011',
  '011001111111111111111101100011',
  '011000001111111110001001100011',
  '011000000111111100010001100011',
  '011000000011111000000001100011',
  '111100000001110000000001111111',
  '111100000000100000000001111111'
]
const EXAMPLE_LOVE = (() => {
  const left = []
  LOVE_183.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] === '1') left.push({ r: 21 + y, c: 9 + x }) })
  left.sort((a, b) => a.r - b.r || a.c - b.c)
  const right = []
  LOVE_IU.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] === '1') right.push({ r: 29 - x, c: 21 + y }) })
  right.sort((a, b) => a.c - b.c || b.r - a.r)
  return left.concat(right).map((x) => `${x.r}_${x.c}`)
})()
function clearAll() {
  texts.value = { leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' }
  pick(null)
  setTimeout(() => { custom.value = Array.from({ length: CUSTOM_N }, () => []); loadedSnap.value = '' }, 0)
}

const baseX = ref('660')
const baseY = ref('647')
const texts = ref({ leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' })
const D = ref(32)

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
// 打开就是编辑状态（11-20 用户要的）；默认画笔用「选区」，随手点一下只是选中、不会把格子擦掉
const editing = ref(true)
const brush = ref('select') // 'erase'、'select'、块下标（数字）、或者 'c0'~'c5'（自定义块）
/*
 * 按住 E 或 Alt（Mac 是 Option）临时变橡皮擦，松开回到原来的画笔；鼠标也跟着变成橡皮擦。
 * 焦点在输入框里时按 E 是打字，不算。
 */
const holdErase = ref(false)
const curBrush = computed(() => (holdErase.value ? 'erase' : brush.value))
// 只有能打字的框才算：点过画笔（单选按钮）后焦点在 radio 上，以前也被当成打字，按 E 没反应（11-20 修）
const TEXT_INPUT = /^(text|search|number|email|password|tel|url|)$/
const typing = (ev) => { const t = ev.target; return Boolean(t && ((t.tagName === 'INPUT' && TEXT_INPUT.test(t.type || '')) || t.tagName === 'TEXTAREA' || t.isContentEditable)) }
function onKey(ev) {
  if (!editing.value) { holdErase.value = false; return }
  const down = ev.type === 'keydown'
  if (down && selIds.value.size && !typing(ev) && selKey(ev)) return
  if (ev.key === 'Alt') { holdErase.value = down && brush.value !== 'select'; if (down) ev.preventDefault(); return }
  // 认物理键位（ev.code）：开着中文输入法时按 E，ev.key 是 'Process' 不是 'e'，以前就是这样「有时按 E 没反应」（11-20 修）
  const isE = ev.code === 'KeyE' || ev.key === 'e' || ev.key === 'E'
  if (isE && !ev.metaKey && !ev.ctrlKey && (!down || !typing(ev))) {
    holdErase.value = down
    if (down) ev.preventDefault()
  }
}
/** 焦点还停在输入框 / 下拉的搜索框里时按 E 会被当成打字：开始画、打开自定义时先把焦点拿走 */
function dropFocus() {
  const a = document.activeElement
  if (a && a !== document.body && typing({ target: a })) a.blur()
}
watch(editing, (on) => { if (on) dropFocus() })
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
/** 6 块，和 6 种颜色一一对应：特例按颜色存（见 currentSlots），加载回来颜色不变 */
const CUSTOM_N = 6
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
const brushes = computed(() => [{ key: 'erase', label: '橡皮擦', color: '#6b7280' }, { key: 'select', label: '选区', color: '#0ea5e9' }].concat(
  auto.value.blocks.map((b, bi) => ({ key: bi, ok: b.ok, label: `补到${(S.AREAS.find((a) => a.key === b.area) || {}).label || b.area}「${b.text}」`, color: BLOCK_COLORS[bi % BLOCK_COLORS.length].fill }))
    .filter((x) => x.ok))
  .concat(custom.value.map((_ids, k) => ({ key: 'c' + k, label: `画到自定义${k + 1}`, color: BLOCK_COLORS[(auto.value.blocks.length + k) % BLOCK_COLORS.length].fill }))))

/** 点一格（或按住拖过去）：橡皮擦掉、画笔补进选中的那块 */
let painting = false
function snapshot() { history.value.push({ e: new Set(erased.value), a: new Map(added.value), c: custom.value.map((b) => b.slice()), s: new Set(selIds.value) }); if (history.value.length > 50) history.value.shift() }
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
function startPaint(id, ev) { if (!editing.value || curBrush.value === 'select') return; dropFocus(); snapshot(); painting = true; lastXY = ev ? [ev.clientX, ev.clientY] : null; paint(id) }
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
function undo() { const h = history.value.pop(); if (h) { erased.value = h.e; added.value = h.a; custom.value = h.c; if (h.s) selIds.value = h.s } }
function resetEdits() { snapshot(); erased.value = new Set(); added.value = new Map(); custom.value = Array.from({ length: CUSTOM_N }, () => []) }

/** 格子 id → 它属于哪一块、序号、坐标 */
const hitMap = computed(() => {
  const m = new Map()
  result.value.blocks.forEach((b, bi) => b.cells.forEach((c) => m.set(c.id, { ...c, block: b.ci ?? bi })))
  return m
})

/* ---------------- 选区：框选格子，拖动 / 方向键挪、复制、旋转、翻转 ----------------
 * 屏幕上 x = (c − r)·D/2、y = (c + r)·D/2，拖了 (dx, dy) 就是 dr = (dy − dx)/D、dc = (dx + dy)/D，取整对齐格子。
 * 拖的时候格子先不动，只画一个虚影跟着鼠标（蓝 = 放得下、橙 = 和原有格子融合、红 = 出界 / 压到城池会去掉），松手才落下。
 * 松手时放不下的：压到原有格子的算融合（两格并成一格），出界 / 压城池的去掉；会提示几格，能撤销。
 * 方向键、旋转、翻转要整块都放得下才动，放不下就提示，不丢格子。
 * 自定义块里的格子原地换 id（序号不变）；填字块里的格子是「擦掉原位 + 补到新位」，序号照那块的读法重排。
 */
const selIds = ref(new Set())
const marquee = ref(null)
const selMode = ref('new')
/** 拖动时的虚影：[{ id, x, y, s }]，s = 'ok' | 'merge' | 'drop' */
const ghost = ref(null)
let selDrag = null
const cellId = (r, c) => `${r}_${c}`
const rcOf = (id) => id.split('_').map(Number)

/**
 * 把选中的格子按 f（id → 新 id）变过去。copy = 原来的留着、新的接在同一块后面；
 * partial = 放不下的不整体作废：融合（压到别的格子）/ 去掉（出界、压城池），否则有一格放不下就返回 null。
 */
function transformState(base, ids, occ, origOf, f, { copy = false, partial = false } = {}) {
  const free = new Set(board.value.free.map((x) => x.id))
  const sel = new Set(ids)
  const fate = new Map()
  let dropped = 0, merged = 0
  ids.forEach((id) => {
    const t = f(id)
    if (!free.has(t)) { fate.set(id, null); dropped += 1 } else if (occ.has(t) && (copy || !sel.has(t))) { fate.set(id, null); merged += 1 } else fate.set(id, t)
  })
  if (!partial && (dropped || merged)) return null
  const e = new Set(base.e), a = new Map(base.a)
  const inCustom = new Set(base.c.flat())
  const blockOf = (id) => (a.has(id) ? a.get(id) : origOf.get(id))
  const put = (t, bi) => { if (origOf.get(t) === bi) e.delete(t); else a.set(t, bi) }
  let c
  if (copy) {
    c = base.c.map((arr) => arr.slice())
    ids.forEach((id) => {
      const t = fate.get(id)
      if (!t) return
      const k = base.c.findIndex((arr) => arr.includes(id))
      if (k >= 0) c[k].push(t)
      else put(t, blockOf(id))
    })
  } else {
    const src = new Map()
    ids.forEach((id) => {
      if (inCustom.has(id)) return
      src.set(id, blockOf(id))
      if (a.has(id)) a.delete(id); else e.add(id)
    })
    src.forEach((bi, id) => { const t = fate.get(id); if (t) put(t, bi) })
    c = base.c.map((arr) => arr.map((x) => (sel.has(x) ? fate.get(x) : x)).filter(Boolean))
  }
  return { e, a, c, ids: ids.map((id) => fate.get(id)).filter(Boolean), dropped, merged }
}
/** 当前的状态快照：挪动都从这里重算 */
function selBase() {
  const origOf = new Map()
  auto.value.blocks.forEach((b, bi) => { if (b.ok) b.cells.forEach((c) => origOf.set(c.id, bi)) })
  return { base: { e: new Set(erased.value), a: new Map(added.value), c: custom.value.map((b) => b.slice()) }, occ: new Set(hitMap.value.keys()), origOf, ids: Array.from(selIds.value) }
}
function applyMove(st) {
  erased.value = st.e; added.value = st.a; custom.value = st.c; selIds.value = new Set(st.ids)
}
const shiftBy = (dr, dc) => (id) => { const [r, c] = rcOf(id); return cellId(r + dr, c + dc) }
/** 整块变一下（方向键、旋转、翻转）：放不下就不动，返回 false */
function transformSel(f, what) {
  if (!selIds.value.size) return false
  const { base, occ, origOf, ids } = selBase()
  const st = transformState(base, ids, occ, origOf, f)
  if (!st) { if (what) message.warning(`${what}放不下：会出界、压到城池或别的格子，先挪开一点再试`); return false }
  snapshot(); applyMove(st)
  return true
}
/**
 * 旋转 / 翻转：绕选区外框的中心 (rc, cc)，屏幕上转 90° 或翻转。记 S = rc + cc、Dd = rc − cc，
 *   右转 (r, c) → (c + Dd, S − r)，左转 → (S − c, r − Dd)，左右翻 → (c + Dd, r − Dd)，上下翻 → (S − c, S − r)。
 * S、Dd 是整数时正好落在格子上、外框中心不动（转四次、翻两次都回原样）；是半格时只能偏半格，四种偏法挑放得下的。
 * 靠边转不开的，再把结果整体错开 1~2 格找个放得下的位置。
 */
const TURNS = {
  cw: (r, c, S, Dd) => [c + Dd, S - r],
  ccw: (r, c, S, Dd) => [S - c, r - Dd],
  // 斜翻（沿游戏网格的两个方向）：↗ 斜翻 = c 镜像（轴是右上—左下那条斜线，左下那块的字等于左右反过来），
  // ↖ 斜翻 = r 镜像（轴是左上—右下那条斜线，等于上下倒过来）。S − Dd = 2·cc、S + Dd = 2·rc，见 flipPivots
  flipA: (r, c, S, Dd) => [r, S - Dd - c],
  flipB: (r, c, S, Dd) => [S + Dd - r, c]
}
const TURN_NAME = { cw: '右转', ccw: '左转', flipA: '↗ 斜翻', flipB: '↖ 斜翻' }
/** 斜翻用外框中心精确翻（2·rc、2·cc 总是整数），翻两下一定回原样；不和旋转共用记住的轴 */
function flipPivots(rcs) {
  const rc2 = Math.min(...rcs.map((x) => x[0])) + Math.max(...rcs.map((x) => x[0]))
  const cc2 = Math.min(...rcs.map((x) => x[1])) + Math.max(...rcs.map((x) => x[1]))
  return [[(rc2 + cc2) / 2, (rc2 - cc2) / 2]]
}
const isFlip = (kind) => kind === 'flipA' || kind === 'flipB'
/** 连着转 / 翻同一个选区时一直用第一次的中心，转四下、翻两下才会分毫不差地回到原样 */
let turnPivot = null
const selKeyOf = () => Array.from(selIds.value).sort().join(',')
/** 一组 [r, c] 的外框中心 → 能用的转轴（整数 S、Dd；半格时给四种偏法） */
function pivotsOf(rcs) {
  const rc = (Math.min(...rcs.map((x) => x[0])) + Math.max(...rcs.map((x) => x[0]))) / 2
  const cc = (Math.min(...rcs.map((x) => x[1])) + Math.max(...rcs.map((x) => x[1]))) / 2
  const S0 = rc + cc, D0 = rc - cc
  return Number.isInteger(S0) ? [[S0, D0]] : [[S0 + 0.5, D0 + 0.5], [S0 - 0.5, D0 - 0.5], [S0 + 0.5, D0 - 0.5], [S0 - 0.5, D0 + 0.5]]
}
/** 拖动中按了 R / H / V：只转虚影，松手按转好的样子落下（drag.map：原格子 → 转完的格子，还没加上拖动的位移） */
function turnGhost(kind) {
  const d = selDrag
  const now = d.ids.map((id) => rcOf(d.map.get(id)))
  // 同一次拖动里连着转，一直绕第一次的轴，转四下回原样
  const [S, Dd] = isFlip(kind) ? flipPivots(now)[0] : d.pivot || pivotsOf(now)[0]
  if (!isFlip(kind)) d.pivot = [S, Dd]
  const t = TURNS[kind]
  d.ids.forEach((id, i) => { const [nr, nc] = t(now[i][0], now[i][1], S, Dd); d.map.set(id, cellId(nr, nc)) })
  d.turned = true
  ghost.value = ghostOf(d)
}
function selTurn(kind) {
  if (selDrag && selDrag.mode === 'move') return turnGhost(kind)
  const rcs = Array.from(selIds.value).map(rcOf)
  if (!rcs.length) return
  const rc = (Math.min(...rcs.map((x) => x[0])) + Math.max(...rcs.map((x) => x[0]))) / 2
  const cc = (Math.min(...rcs.map((x) => x[1])) + Math.max(...rcs.map((x) => x[1]))) / 2
  const S0 = rc + cc, D0 = rc - cc
  const fresh = isFlip(kind) ? flipPivots(rcs) : Number.isInteger(S0) ? [[S0, D0]] : [[S0 + 0.5, D0 + 0.5], [S0 - 0.5, D0 - 0.5], [S0 + 0.5, D0 - 0.5], [S0 - 0.5, D0 + 0.5]]
  const pivots = !isFlip(kind) && turnPivot && turnPivot.key === selKeyOf() ? [turnPivot.p].concat(fresh) : fresh
  const shifts = [[0, 0]]
  for (const k of [1, 2]) for (const [a, b] of [[-k, -k], [k, k], [k, -k], [-k, k], [-k, 0], [k, 0], [0, -k], [0, k]]) shifts.push([a, b])
  const { base, occ, origOf, ids } = selBase()
  const t = TURNS[kind]
  for (const [sr, sc] of shifts) {
    for (const [S, Dd] of pivots) {
      const st = transformState(base, ids, occ, origOf, (id) => { const [r, c] = rcOf(id); const [nr, nc] = t(r, c, S, Dd); return cellId(nr + sr, nc + sc) })
      if (st) {
        snapshot(); applyMove(st)
        // 没错开位置才记住中心；错开过说明靠边了，下次重新算
        if (!isFlip(kind)) turnPivot = sr || sc ? null : { p: [S, Dd], key: selKeyOf() }
        return
      }
    }
  }
  message.warning(`${TURN_NAME[kind]}放不下：会出界、压到城池或别的格子，先挪开一点再试`)
}
/*
 * 按比例缩放：每次 ±25%，按游戏网格逐格取样（格子边对边，笔画不会散），外框中心不动。
 * 连着缩放同一个选区时一直从第一次的原样算，不会越缩越糊；新格子归原来那格所在的块（颜色不变），
 * 自定义块里的序号照原来的先后排。放不下（出界、压城池、压别的格子）就错开 1~2 格再试，还不行就提示。
 */
let scaleSrc = null
const scalePct = ref(100)
function selScale(dir) {
  if (!selIds.value.size) return
  const { base, occ, origOf, ids } = selBase()
  const key = selKeyOf()
  if (!scaleSrc || scaleSrc.key !== key) {
    const cells = ids.map((id) => {
      const [r, c] = rcOf(id)
      const k = base.c.findIndex((arr) => arr.includes(id))
      return { r, c, k, idx: k >= 0 ? base.c[k].indexOf(id) : 0, bi: k >= 0 ? null : base.a.has(id) ? base.a.get(id) : origOf.get(id) }
    })
    const minR = Math.min(...cells.map((x) => x.r)), maxR = Math.max(...cells.map((x) => x.r))
    const minC = Math.min(...cells.map((x) => x.c)), maxC = Math.max(...cells.map((x) => x.c))
    const at = new Map(cells.map((x) => [cellId(x.r - minR, x.c - minC), x]))
    scaleSrc = { at, h: maxR - minR + 1, w: maxC - minC + 1, cr: (minR + maxR) / 2, ccen: (minC + maxC) / 2, n: 0, key }
  }
  const n = scaleSrc.n + dir
  const f = 1 + 0.25 * n
  const nh = Math.round(scaleSrc.h * f), nw = Math.round(scaleSrc.w * f)
  if (f <= 0 || nh < 1 || nw < 1) return message.warning('不能再小了')
  if (nh > board.value.size || nw > board.value.size) return message.warning('不能再大了')
  /*
   * 新外框里每一格按面积取样：它在原样里盖住的那一片，有一半以上是格子就填上，颜色 / 序号跟盖得最多的那格走。
   * 以前是取左上角那一格，缩小时一律偏向左上，对称的图案（右下爱心）会明显歪掉（11-20 修）。按面积取样左右上下都对称。
   */
  const gen = []
  const sy = scaleSrc.h / nh, sx = scaleSrc.w / nw
  for (let i = 0; i < nh; i += 1) for (let j = 0; j < nw; j += 1) {
    let area = 0, best = null, bestA = 0
    for (let r = Math.floor(i * sy); r < Math.min(scaleSrc.h, Math.ceil((i + 1) * sy - 1e-9)); r += 1) {
      for (let c = Math.floor(j * sx); c < Math.min(scaleSrc.w, Math.ceil((j + 1) * sx - 1e-9)); c += 1) {
        const src = scaleSrc.at.get(cellId(r, c))
        if (!src) continue
        const ov = (Math.min(r + 1, (i + 1) * sy) - Math.max(r, i * sy)) * (Math.min(c + 1, (j + 1) * sx) - Math.max(c, j * sx))
        if (ov <= 0) continue
        area += ov
        if (ov > bestA) { bestA = ov; best = src }
      }
    }
    if (best && area / (sy * sx) >= 0.5 - 1e-9) gen.push({ i, j, src: best })
  }
  if (!gen.length) return message.warning('不能再小了')
  const free = new Set(board.value.free.map((x) => x.id))
  const sel = new Set(ids)
  const r0 = Math.round(scaleSrc.cr - (nh - 1) / 2), c0 = Math.round(scaleSrc.ccen - (nw - 1) / 2)
  const shifts = [[0, 0]]
  for (const k of [1, 2]) for (const [a, b] of [[-k, -k], [k, k], [k, -k], [-k, k], [-k, 0], [k, 0], [0, -k], [0, k]]) shifts.push([a, b])
  for (const [sr, sc] of shifts) {
    const out = gen.map((g) => ({ ...g, id: cellId(r0 + g.i + sr, c0 + g.j + sc) }))
    if (out.some((g) => !free.has(g.id) || (occ.has(g.id) && !sel.has(g.id)))) continue
    // 先把选中的拿掉，再按新形状放回去
    const e = new Set(base.e), a = new Map(base.a)
    ids.forEach((id) => { if (base.c.some((arr) => arr.includes(id))) return; if (a.has(id)) a.delete(id); else e.add(id) })
    out.forEach((g) => { if (g.src.k >= 0) return; if (origOf.get(g.id) === g.src.bi) e.delete(g.id); else a.set(g.id, g.src.bi) })
    const c = base.c.map((arr, k) => {
      const mine = out.filter((g) => g.src.k === k).sort((x, y) => x.src.idx - y.src.idx || x.i - y.i || x.j - y.j).map((g) => g.id)
      const res = []
      let done = false
      arr.forEach((x) => { if (!sel.has(x)) res.push(x); else if (!done) { res.push(...mine); done = true } })
      return res
    })
    snapshot()
    applyMove({ e, a, c, ids: out.map((g) => g.id) })
    scaleSrc.n = n
    scaleSrc.key = selKeyOf()
    scalePct.value = Math.round(f * 100)
    return
  }
  message.warning(`${dir > 0 ? '放大' : '缩小'}放不下：会出界、压到城池或别的格子，先挪开一点再试`)
}
watch(selIds, () => { if (!scaleSrc || scaleSrc.key !== selKeyOf()) scalePct.value = 100 })
function svgPoint(ev) {
  const svg = document.getElementById('shape-map')
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  return pt.matrixTransform(svg.getScreenCTM().inverse())
}
function selDown(ev) {
  if (!editing.value || curBrush.value !== 'select') return
  dropFocus()
  const p = svgPoint(ev)
  const g = ev.target.closest && ev.target.closest('[data-id]')
  const id = g ? g.dataset.id : null
  try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch (e) {}
  const how = ev.shiftKey ? 'add' : ev.altKey ? 'sub' : selMode.value
  // 按住选中的格子拖 = 挪；按着 Alt 拖 = 复制一份。减选模式下点选中的格子是去掉它，不拖
  if (id && selIds.value.has(id) && (selMode.value !== 'sub' || ev.altKey)) {
    const b0 = selBase()
    selDrag = { mode: 'move', x0: p.x, y0: p.y, key: '0,0', dr: 0, dc: 0, copy: ev.altKey, id, map: new Map(b0.ids.map((x) => [x, x])), ...b0 }
  } else {
    selDrag = { mode: 'box', x0: p.x, y0: p.y, id, how, keep: how === 'new' ? new Set() : new Set(selIds.value) }
    if (how === 'new') selIds.value = new Set()
  }
}
/** 拖动中每个格子最后落到哪：先按 R / H / V 转过的样子，再加上拖动的位移 */
const dragFn = (drag) => { const sh = shiftBy(drag.dr, drag.dc); return (id) => sh(drag.map.get(id) || id) }
/** 虚影：每个选中的格子挪到哪、放不放得下 */
function ghostOf(drag) {
  const free = new Set(board.value.free.map((x) => x.id))
  const sel = new Set(drag.ids)
  const f = dragFn(drag)
  return drag.ids.map((id) => {
    const t = f(id)
    const [r, c] = rcOf(t)
    const ctr = P.cellCenter(r, c, board.value.size, D.value)
    const s = !free.has(t) ? 'drop' : drag.occ.has(t) && (drag.copy || !sel.has(t)) ? 'merge' : 'ok'
    return { id: t, x: ctr.x, y: ctr.y, s }
  })
}
function selMove(ev) {
  if (!selDrag) return
  const p = svgPoint(ev)
  const dx = p.x - selDrag.x0, dy = p.y - selDrag.y0
  if (Math.abs(dx) + Math.abs(dy) > 4) selDrag.moved = true
  if (selDrag.mode === 'box') {
    const box = { x: Math.min(p.x, selDrag.x0), y: Math.min(p.y, selDrag.y0), w: Math.abs(dx), h: Math.abs(dy) }
    marquee.value = box
    const s = new Set(selDrag.keep)
    cells.value.forEach((c) => {
      if (!c.seq || c.x < box.x || c.x > box.x + box.w || c.y < box.y || c.y > box.y + box.h) return
      if (selDrag.how === 'sub') s.delete(c.id); else s.add(c.id)
    })
    selIds.value = s
    return
  }
  const dr = Math.round((dy - dx) / D.value), dc = Math.round((dx + dy) / D.value)
  const key = dr + ',' + dc
  if (key === selDrag.key) return
  Object.assign(selDrag, { key, dr, dc })
  ghost.value = key === '0,0' && !selDrag.turned ? null : ghostOf(selDrag)
}
function selUp() {
  if (!selDrag) return
  const d = selDrag
  selDrag = null
  marquee.value = null
  ghost.value = null
  // 没怎么拖 = 点了一下：点格子选它（Shift 是加选 / 取消，减选模式是去掉）
  if (d.mode === 'box') {
    if (!d.moved && d.id && hitMap.value.has(d.id)) {
      const s = new Set(d.keep)
      if (d.how === 'sub') s.delete(d.id)
      else if (d.how === 'add' && d.keep.has(d.id) && selMode.value !== 'add') s.delete(d.id)
      else s.add(d.id)
      selIds.value = s
    }
    return
  }
  // 按着 Alt 点了一下选中的格子、鼠标没动：当减选用，把它去掉
  if (d.key === '0,0' && !d.turned) {
    if (d.copy && !d.moved) { const s = new Set(selIds.value); s.delete(d.id); selIds.value = s }
    return
  }
  const st = transformState(d.base, d.ids, d.occ, d.origOf, dragFn(d), { copy: d.copy, partial: true })
  snapshot()
  applyMove(st)
  if (st.dropped || st.merged) {
    const bits = []
    if (st.merged) bits.push(`${st.merged} 格和原有格子融合`)
    if (st.dropped) bits.push(`${st.dropped} 格出界或压到城池，去掉了`)
    message.info(bits.join('，') + '（不想要可以点「撤销」）')
  }
}
/** 方向键挪一格（屏幕上的上下左右），R 右转（Shift+R 左转）、H 左右翻、V 上下翻，Delete 删掉，Esc 取消；处理了返回 true */
const ARROWS = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [1, -1], ArrowRight: [-1, 1] }
function selKey(ev) {
  if (ev.key === 'Escape') { selIds.value = new Set(); return true }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault()
    snapshot()
    const { base, origOf, ids } = selBase()
    const sel = new Set(ids)
    ids.forEach((id) => { if (base.a.has(id)) base.a.delete(id); else if (origOf.has(id)) base.e.add(id) })
    erased.value = base.e; added.value = base.a; custom.value = base.c.map((arr) => arr.filter((x) => !sel.has(x)))
    selIds.value = new Set()
    return true
  }
  if (!ev.metaKey && !ev.ctrlKey && (!ev.altKey || selDrag)) {
    const turn = ev.code === 'KeyR' ? (ev.shiftKey ? 'ccw' : 'cw') : ev.code === 'KeyH' ? 'flipA' : ev.code === 'KeyV' ? 'flipB' : ''
    if (turn) { ev.preventDefault(); selTurn(turn); return true }
    if (!selDrag && (ev.code === 'Minus' || ev.code === 'Equal' || ev.code === 'NumpadSubtract' || ev.code === 'NumpadAdd')) {
      ev.preventDefault(); selScale(ev.code === 'Minus' || ev.code === 'NumpadSubtract' ? -1 : 1); return true
    }
  }
  const d = ARROWS[ev.key]
  if (!d) return false
  ev.preventDefault()
  transformSel(shiftBy(d[0], d[1]))
  return true
}
/**
 * 选区外轮廓：每格是个菱形，四条边各对着一个邻格（右上 r−1、右下 c+1、左下 r+1、左上 c−1），
 * 邻格也选中了那条边就是内部的、不画，只剩最外面一圈。画在所有格子上面，不会被后画的格子盖住。
 */
const selOutline = computed(() => {
  if (!selIds.value.size) return ''
  const b = board.value
  const h = D.value / 2
  const has = (r, c) => selIds.value.has(cellId(r, c))
  let d = ''
  selIds.value.forEach((id) => {
    const [r, c] = rcOf(id)
    const { x, y } = P.cellCenter(r, c, b.size, D.value)
    const T = `${x} ${y - h}`, R = `${x + h} ${y}`, B = `${x} ${y + h}`, L = `${x - h} ${y}`
    if (!has(r - 1, c)) d += `M${T}L${R}`
    if (!has(r, c + 1)) d += `M${R}L${B}`
    if (!has(r + 1, c)) d += `M${B}L${L}`
    if (!has(r, c - 1)) d += `M${L}L${T}`
  })
  return d
})
const GHOST_FILL = { ok: 'rgba(14,165,233,0.45)', merge: 'rgba(245,158,11,0.6)', drop: 'rgba(239,68,68,0.5)' }
// 换了画笔、关了自定义：选中的作废；图变了（撤销、改字）只留还在图上的
watch([brush, editing], () => { if (brush.value !== 'select' || !editing.value) selIds.value = new Set() })
watch(hitMap, (m) => { if (selIds.value.size && Array.from(selIds.value).some((id) => !m.has(id))) selIds.value = new Set(Array.from(selIds.value).filter((id) => m.has(id))) })

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
      sel: selIds.value.has(cell.id),
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

/** 点位清单下载成 Excel（序号 / 区域 / 内容 / 坐标），文件名跟下载图片一样：画着特例就用特例名 */
const xlsxBusy = ref(false)
async function saveXlsx() {
  if (xlsxBusy.value) return
  xlsxBusy.value = true
  try {
    const aoa = [['序号', '区域', '内容', '坐标']].concat(list.value.map((r) => [r.seq, r.area, r.text, r.coord]))
    const base = current.value ? current.value.name.replace(/[\\/:*?"<>|\s]+/g, '') || '摆图形' : '摆图形'
    await buildExcel({ aoa, sheetName: '点位清单', name: base + '点位清单.xlsx' })
    message.success(`已下载 ${list.value.length} 个点位`)
  } catch (e) {
    message.error(e.message || '下载失败')
  } finally {
    xlsxBusy.value = false
  }
}

/** 下载用最大的格子画（字最清楚），文件名：画着特例就用特例名 */
const D_MAX = 80
async function savePng() {
  const keep = D.value
  D.value = D_MAX
  await nextTick()
  const svg = document.getElementById('shape-map')
  // 选区的蚂蚁线、框选框不进图片
  let xml = ''
  if (svg) {
    const copy = svg.cloneNode(true)
    copy.querySelectorAll('.no-export').forEach((n) => n.remove())
    xml = new XMLSerializer().serializeToString(copy)
  }
  D.value = keep
  if (!xml) return
  // 空格去掉：有的浏览器会把文件名里的空格换成下划线（11-20 用户碰到的）
  const fileName = (current.value ? current.value.name.replace(/[\\/:*?"<>|\s]+/g, '') || '摆图形' : '摆图形') + '.png'
  const blob = new Blob(['<?xml version="1.0"?>' + xml], { type: 'image/svg+xml;charset=utf-8' })
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
    canvas.toBlob((b) => download(b, fileName))
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    message.error('导出失败，可以直接截图')
  }
  img.src = url
}
/* ---------------- 图案特例 ----------------
 * 下拉里是开发者审核通过的图案（按范围分开），选一个整份铺进自定义块；谁都能把当前的图「保存为特例」，
 * 开发者确认后所有人都能看到。开发者还能改名、用当前图覆盖（微调）、删除。
 * 打开页面直接画上次选的（没选过就第一个），列表先用本机缓存，云端回来再换新。
 * 云端还没有数据（或拉不到）时用下面三套内置的，和以前的「填示例」按钮一样。
 */
const pad = (slots) => Array.from({ length: CUSTOM_N }, (_v, i) => (Array.isArray(slots && slots[i]) ? slots[i].slice() : []))
const BUILTIN = [
  { _id: 'builtin-vnb', name: 'V + N + B + 不', scope: 'screen', slots: pad(EXAMPLE), status: 'ok', builtin: true },
  { _id: 'builtin-heart', name: '爱心围城', scope: 'screen', slots: pad([EXAMPLE_HEART]), status: 'ok', builtin: true },
  { _id: 'builtin-love', name: '183 + I♥U', scope: 'full', slots: pad([[], [], EXAMPLE_LOVE]), status: 'ok', builtin: true }
].map((p) => ({ ...p, total: p.slots.reduce((n, x) => n + x.length, 0) }))

const PRESET_CACHE = 'shape_presets_v1'
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch (e) { return null } }
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }

const cached = readJSON(PRESET_CACHE)
const presetRows = ref(Array.isArray(cached) && cached.length ? cached : BUILTIN)
const serverDev = ref(false)
const isDev = computed(() => serverDev.value || Boolean(me && me.value && me.value.isDev))
/** 图上现在画着的是哪个特例（{ id, name, scope }）；下拉只显示它，切范围不会自动换 */
const drawn = ref(null)
const loadedSnap = ref('')

const scopePresets = computed(() => presetRows.value.filter((p) => p.scope === scope.value))
/** 按 id 找，找不到再按名字（本机缓存的内置特例换成云端那份时 id 会变） */
const findPreset = (want, list) => (want ? list.find((p) => p._id === want.id) || list.find((p) => p.name === want.name) || null : null)
const current = computed(() => (drawn.value && drawn.value.scope === scope.value ? findPreset(drawn.value, scopePresets.value) : null))
const presetOptions = computed(() => {
  const opt = (p) => ({ label: `${p.name}（${p.total} 格）`, value: p._id })
  const ok = scopePresets.value.filter((p) => p.status === 'ok').map(opt)
  const wait = scopePresets.value.filter((p) => p.status === 'pending').map((p) => ({ ...opt(p), label: `【待审】${p.name}（${p.total} 格）${isDev.value && p.by ? ' · ' + p.by.serverNo + '区' + p.by.alliance : ''}` }))
  return wait.length ? [{ type: 'group', label: '审核通过', key: 'ok', children: ok }, { type: 'group', label: isDev.value ? '等你审核' : '我提交的（等开发者确认）', key: 'wait', children: wait }] : ok
})
/** 当前的图和加载进来的特例不一样了（填了字、擦补过、画过） */
const dirty = computed(() => Object.values(texts.value).some(Boolean) || erased.value.size > 0 || added.value.size > 0 || JSON.stringify(custom.value) !== loadedSnap.value)

function pick(p) {
  drawn.value = p ? { id: p._id, name: p.name, scope: scope.value } : null
}
function applyPreset(p) {
  texts.value = { leftBottom: '', rightBottom: '', top: '', bottom: '', left: '', right: '' }
  pick(p)
  // 等改字的 watch 先清完旧的手动修改，再铺进来
  setTimeout(() => { snapshot(); custom.value = pad(p.slots); loadedSnap.value = JSON.stringify(custom.value) }, 0)
}
function onPick(id) {
  const p = scopePresets.value.find((x) => x._id === id)
  if (!p) return
  if (!dirty.value || !result.value.total) return applyPreset(p)
  dialog.warning({ title: '换成这个特例？', content: '现在图上摆的会被替换掉（可以先「保存为特例」留着）。', positiveText: '换', negativeText: '不换', onPositiveClick: () => applyPreset(p) })
}
/** 打开页面是空的，不自动加载特例；切换范围时把图清空（两个范围的特例不通用） */
watch(scope, () => clearAll())

async function fetchPresets() {
  try {
    const res = await call('shape.presets')
    serverDev.value = Boolean(res.isDev)
    const rows = res.rows && res.rows.length ? res.rows : BUILTIN
    const before = current.value
    presetRows.value = rows
    writeJSON(PRESET_CACHE, rows)
    // 画着的特例在云端被改过（开发者微调了），而且自己没动过：换成新版
    const now = current.value
    if (now && before && !dirty.value && JSON.stringify(now.slots) !== JSON.stringify(before.slots)) applyPreset(now)
  } catch (e) {
    // 拉不到就用缓存 / 内置的，不打扰
  }
}
onMounted(fetchPresets)

/** 当前图的最终格子，按颜色分成 6 串（顺序就是序号顺序） */
function currentSlots() {
  const slots = Array.from({ length: CUSTOM_N }, () => [])
  result.value.blocks.forEach((b) => { if (b.ok) b.cells.forEach((c) => slots[(b.ci ?? 0) % CUSTOM_N].push(c.id)) })
  return slots
}
function upsert(p) {
  const rows = presetRows.value.filter((x) => !x.builtin && x._id !== p._id)
  presetRows.value = rows.concat([p])
  writeJSON(PRESET_CACHE, presetRows.value)
}

const nameBox = ref({ show: false, mode: 'new', name: '', busy: false })
function openSave(mode) {
  nameBox.value = { show: true, mode, name: mode === 'rename' && current.value ? current.value.name : '', busy: false }
}
async function confirmName() {
  const box = nameBox.value
  const name = box.name.trim()
  if (!name) return message.warning('起个名字')
  box.busy = true
  try {
    if (box.mode === 'rename') {
      const res = await call('shape.presetEdit', { id: current.value._id, op: 'rename', name })
      upsert(res.preset); pick(res.preset)
      message.success('改好了')
    } else {
      const res = await call('shape.submit', { name, scope: scope.value, slots: currentSlots() })
      upsert(res.preset)
      applyPreset(res.preset)
      message.success(res.preset.status === 'ok' ? '已保存，所有人的下拉里都有了' : '已提交，开发者确认后所有人都能看到')
    }
    box.show = false
  } catch (e) {
    message.error(e.message || '没保存上')
  } finally {
    box.busy = false
  }
}
async function devOp(op) {
  const p = current.value
  if (!p) return
  const run = async () => {
    try {
      const res = await call('shape.presetEdit', op === 'save' ? { id: p._id, op, scope: scope.value, slots: currentSlots() } : { id: p._id, op })
      if (res.removed) {
        presetRows.value = presetRows.value.filter((x) => x._id !== p._id)
        writeJSON(PRESET_CACHE, presetRows.value)
        pick(null)
        message.success('已删除')
      } else {
        upsert(res.preset)
        if (op === 'save') applyPreset(res.preset)
        else pick(res.preset)
        message.success(op === 'approve' ? '已通过，所有人都能看到了' : '已覆盖成现在的图')
      }
    } catch (e) {
      message.error(e.message || '没成功')
    }
  }
  if (op === 'remove') {
    dialog.warning({ title: `${p.status === 'pending' ? '退回' : '删除'}「${p.name}」？`, content: '删了所有人的下拉里都没有了，恢复不了。', positiveText: '删除', negativeText: '取消', onPositiveClick: run })
  } else run()
}
/** 按字摆：输入框下拉里给图案名，打了字就只留含这个字的 */
const patternOpts = (v) => PATTERNS.filter((p) => !v || p.includes(v)).map((p) => ({ label: p, value: p }))
const textOpen = ref([])
</script>


<template>
  <n-space vertical :size="16">
    <n-card title="摆图形" :bordered="false">
      <template #header-extra>
        <n-button :disabled="!result.total" @click="savePng">下载图片</n-button>
      </template>

      <!-- 第一行：范围 + 图案特例（打开页面就直接画上次选的那个） -->
      <div class="bar">
        <n-radio-group v-model:value="scope" size="small">
          <n-radio-button value="full">整块黑土</n-radio-button>
          <n-radio-button value="screen">满屏截图（含 7 级城）</n-radio-button>
        </n-radio-group>
        <n-select :value="current ? current._id : null" :options="presetOptions" placeholder="选一个图案特例" size="small"
          filterable style="width: 260px" @update:value="onPick" />
        <n-button size="small" :disabled="!result.total" @click="openSave('new')">保存为特例</n-button>
        <template v-if="isDev && current && !current.builtin">
          <n-button v-if="current.status === 'pending'" size="small" type="success" @click="devOp('approve')">通过</n-button>
          <n-button size="small" :disabled="!dirty" @click="devOp('save')">用当前图覆盖</n-button>
          <n-button size="small" @click="openSave('rename')">改名</n-button>
          <n-button size="small" type="error" ghost @click="devOp('remove')">{{ current.status === 'pending' ? '退回' : '删除' }}</n-button>
        </template>
        <n-button size="small" @click="clearAll">清空</n-button>
      </div>
      <div class="lab" style="margin: 6px 0 12px">
        {{ scope === 'screen' ? '只用游戏缩到最小、城池居中截一张图能看到的格子' : '整块黑土都能摆，截图可能拍不全' }}
        <template v-if="current && current.status === 'pending'">
          · <span style="color:#d97706">{{ isDev ? `待审核${current.by ? '：' + current.by.serverNo + '区' + current.by.alliance + (current.by.name ? ' · ' + current.by.name : '') : ''}，确认没问题点「通过」，可以先擦补再「用当前图覆盖」` : '你提交的，等开发者确认后所有人都能看到' }}</span>
        </template>
        <template v-else-if="isDev && current && !current.builtin && dirty"> · 改过了，点「用当前图覆盖」存回这个特例</template>
      </div>

      <!-- 第二行：参照坐标、格子大小 -->
      <div class="bar">
        <span class="lab">参照坐标</span>
        <n-input v-model:value="baseX" placeholder="X 如 521" size="small" style="width: 100px" />
        <n-input v-model:value="baseY" placeholder="Y 如 1314" size="small" style="width: 100px" />
        <span class="lab">黑土最上面那一格的坐标</span>
        <span class="lab" style="margin-left: 12px">格子大小</span>
        <n-slider v-model:value="D" :min="20" :max="80" :step="2" style="width: 140px" />
        <span class="lab">{{ corner ? `顶角 ${corner.top} · 底角 ${corner.bottom}` : '没填参照坐标，图上只有序号' }}</span>
      </div>

      <!-- 按字摆：收起来，要用再展开；6 个位置一套输入框，图案名在输入框的下拉里 -->
      <n-collapse v-model:expanded-names="textOpen" style="margin-top: 12px">
        <n-collapse-item name="text" :title="Object.values(texts).some(Boolean) ? '按字摆（已填）' : '按字摆：左下、右下、上、下、左、右各写字或选图案'">
          <div class="areas">
            <label v-for="a in AREAS" :key="a.key" class="area">
              <span class="lab">{{ a.label }}</span>
              <n-auto-complete v-model:value="texts[a.key]" :options="patternOpts(texts[a.key])" :get-show="() => true"
                placeholder="字或图案" size="small" clearable />
            </label>
          </div>
          <div class="lab" style="margin-top: 8px">字能写：{{ CHAR_HINT }}　图案：{{ PATTERNS.join('、') }}　左下、右下贴着下边，上下左右放图案；改字会清掉擦补，自定义块保留</div>
        </n-collapse-item>
      </n-collapse>

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
        <span class="lab" style="color:#4b5563">自定义</span>
        <template v-if="editing">
          <n-radio-group v-model:value="brush" size="small">
            <n-radio-button v-for="b in brushes" :key="b.key" :value="b.key">
              <span class="sw" :style="{ background: b.color }"></span>{{ b.label }}
            </n-radio-button>
          </n-radio-group>
          <n-radio-group v-if="curBrush === 'select' || brush === 'select'" v-model:value="selMode" size="small">
            <n-radio-button value="new">新选</n-radio-button>
            <n-radio-button value="add">加选</n-radio-button>
            <n-radio-button value="sub">减选</n-radio-button>
          </n-radio-group>
          <n-button-group v-if="brush === 'select'" size="small">
            <n-button :disabled="!selIds.size" title="左转 90°（Shift+R）" @click="selTurn('ccw')">⟲ 左转</n-button>
            <n-button :disabled="!selIds.size" title="右转 90°（R）" @click="selTurn('cw')">⟳ 右转</n-button>
            <n-button :disabled="!selIds.size" title="沿右上—左下的斜线翻（H）：左下那块的字等于左右反过来" @click="selTurn('flipA')">↗ 斜翻</n-button>
            <n-button :disabled="!selIds.size" title="沿左上—右下的斜线翻（V）：等于上下倒过来" @click="selTurn('flipB')">↖ 斜翻</n-button>
          </n-button-group>
          <n-button-group v-if="brush === 'select'" size="small">
            <n-button :disabled="!selIds.size" title="按比例缩小 25%（-）" @click="selScale(-1)">－ 缩小</n-button>
            <n-button disabled style="min-width: 58px">{{ scalePct }}%</n-button>
            <n-button :disabled="!selIds.size" title="按比例放大 25%（=）" @click="selScale(1)">＋ 放大</n-button>
          </n-button-group>
          <n-button size="small" :disabled="!history.length" @click="undo">撤销</n-button>
          <n-button size="small" :disabled="!edited" @click="resetEdits">恢复原样</n-button>
          <span v-if="curBrush === 'select'" class="lab">拖框或点格子来选（按住 Shift 加选、Alt 拖框减选）；按住选中的格子拖（跟着虚影走，蓝 = 放得下、橙 = 和原有格子融合、红 = 会去掉），按住 Alt 拖是复制；拖的时候按 R / H / V 转虚影；方向键挪一格，R / Shift+R 转、H / V 斜翻、- / = 缩放；Delete 删掉，Esc 取消{{ selIds.size ? `　已选 ${selIds.size} 格` : '' }}</span>
          <span v-else class="lab">点格子或按住拖过去；按住 E 或 Alt（Option）临时变橡皮擦；不填字也能用「画到自定义」直接画，序号按画的先后编；改了字会重新摆，擦补填字块的会清掉，自定义块保留</span>
        </template>
        <span v-else-if="edited && dirty" class="lab">{{ current ? `在「${current.name}」上改过` : `已手动改 ${edited} 格` }}</span>
      </div>
      <div class="wrap">
        <svg id="shape-map" :class="{ editing, erasing: editing && curBrush === 'erase', selecting: editing && curBrush === 'select' }" :width="box.w" :height="box.h" @pointerdown="selDown" @pointermove="selMove" @pointerup="endPaint(); selUp()" @pointerleave="endPaint" :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`" xmlns="http://www.w3.org/2000/svg">
          <g v-for="c in cells" :key="c.id" :data-id="c.id" :class="{ paintable: editing, picked: c.sel }" @pointerdown.prevent="startPaint(c.id, $event)" @pointerenter="overPaint(c.id, $event)">
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
          <g v-if="selOutline" class="no-export" pointer-events="none" fill="none" stroke-linecap="round">
            <path :d="selOutline" stroke="#ffffff" stroke-width="2.2" />
            <path :d="selOutline" class="ants" stroke="#0ea5e9" stroke-width="1.6" stroke-dasharray="5 4" />
          </g>
          <g v-if="ghost" class="no-export" pointer-events="none">
            <g v-for="g in ghost" :key="g.id" :transform="`translate(${g.x},${g.y}) rotate(45)`">
              <rect :x="-D / 2.83" :y="-D / 2.83" :width="D / 1.414" :height="D / 1.414" rx="2"
                :fill="GHOST_FILL[g.s]" stroke="#ffffff" stroke-width="1" />
            </g>
          </g>
          <rect v-if="marquee" class="no-export" :x="marquee.x" :y="marquee.y" :width="marquee.w" :height="marquee.h"
            fill="rgba(14,165,233,0.12)" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none" />
        </svg>
      </div>
    </n-card>

    <n-modal v-model:show="nameBox.show" preset="dialog" :title="nameBox.mode === 'rename' ? '改名' : '保存为特例'"
      positive-text="保存" negative-text="取消" :loading="nameBox.busy" @positive-click="() => { confirmName(); return false }">
      <n-input v-model:value="nameBox.name" maxlength="20" show-count placeholder="给这个图案起个名字，比如「183 + I♥U」" />
      <div v-if="nameBox.mode === 'new'" class="lab" style="margin-top: 8px">
        存的是现在图上的 {{ result.total }} 格（{{ scope === 'screen' ? '满屏截图' : '整块黑土' }}）。{{ isDev ? '你是开发者，保存后直接给所有人。' : '开发者确认后，所有人都能在下拉里加载。' }}
      </div>
    </n-modal>

    <n-card v-if="list.length && origin" :bordered="false" title="点位清单">
      <template #header-extra>
        <n-space :size="8">
          <n-button size="small" @click="copyList">复制清单</n-button>
          <n-button size="small" type="primary" secondary :loading="xlsxBusy" @click="saveXlsx">下载 Excel</n-button>
        </n-space>
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
#shape-map.selecting { cursor: default; }
#shape-map .ants { animation: ants 0.9s linear infinite; }
@keyframes ants { to { stroke-dashoffset: -18; } }
#shape-map.selecting .picked { cursor: move; }
#shape-map.selecting .paintable:hover rect { opacity: 1; }
#shape-map.editing.erasing { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(-45 12 12)'><rect x='3' y='8' width='18' height='9' rx='2' fill='%23f9a8d4' stroke='%23374151' stroke-width='1.5'/><rect x='3' y='8' width='7' height='9' rx='2' fill='%23e5e7eb' stroke='%23374151' stroke-width='1.5'/></g></svg>") 5 19, cell; }
.paintable:hover rect { opacity: 0.75; }
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; }
.areas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; }
.area { display: flex; align-items: center; gap: 8px; }
.area .lab { width: 32px; flex: none; }
@media (max-width: 639px) { .edit-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 12px; }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
#shape-map.editing { touch-action: none; cursor: crosshair; user-select: none; }
#shape-map.editing.erasing { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(-45 12 12)'><rect x='3' y='8' width='18' height='9' rx='2' fill='%23f9a8d4' stroke='%23374151' stroke-width='1.5'/><rect x='3' y='8' width='7' height='9' rx='2' fill='%23e5e7eb' stroke='%23374151' stroke-width='1.5'/></g></svg>") 5 19, cell; }
.paintable:hover rect { opacity: 0.75; }
.areas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
/* 手机：整张图缩到屏幕宽度（要看细节双指放大）；下载图片读的是 svg 自身尺寸，不受影响 */
@media (max-width: 767px) {
  #shape-map { width: 100%; height: auto; }
}
</style>

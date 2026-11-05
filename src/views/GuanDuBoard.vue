<script setup>
/**
 * 官渡排表沙盘（全屏层）。原型在 三冰/小帮手/官渡之战/原型/沙盘.html，这里接真实数据。
 *
 * - 数据：admin.guanduOverview({ withPlans }) 一次给齐（两个团的报名、排表、模板），由外层页面传进来
 * - 拖地图上的分组棋子 = 这一阶段该组 1 队去哪；左边拖名字换组、双击设车头；右边改 2/3 队、4-6 队、要点
 * - 排表改动 0.8 秒后自动存（admin.guanduSavePlan）；频道、指挥、每组要点存模板（admin.guanduSaveTpl），下周自动带上
 * - 画布和侧栏都是手写 DOM（照搬原型），样式不加 scoped，统一挂在 .gdb 下面
 */
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { call } from '../api'
import { download } from '../xlsx'
import * as GD from '../lib/guandu'

const props = defineProps({ data: { type: Object, required: true }, legion: { type: Number, default: 1 } })
const emit = defineEmits(['close', 'saved'])
const message = useMessage()
const root = ref(null)
const saveState = ref('')

const { BUILDINGS, BM, BASE_US, BASE_THEM, PHASES, fullName, shortName, isOpen, colorOf, rankOf, RANK_COLOR, T456 } = GD

// ===================== 数据 =====================
const res = props.data
const MEMBERS = {}
res.rows.forEach((r) => { MEMBERS[r.memberId] = { id: r.memberId, name: r.name, rally: r.rally, role: r.role === 'main' ? '主力' : '替补', legion: r.legion } })
const tpl = res.tpl
const DATA = {}
;[1, 2].forEach((l) => {
  const plan = JSON.parse(JSON.stringify(res.plans[l]))
  const signed = res.rows.filter((r) => r.legion === l)
  const inLegion = new Set(signed.map((r) => r.memberId))
  plan.groups.forEach((g) => { g.members = g.members.filter((id) => inLegion.has(id)) })
  const grouped = new Set(plan.groups.flatMap((g) => g.members))
  // 没进组的：主力放「未分组」，替补放「替补」，都按集结值从高到低
  const byRally = (a, b) => (MEMBERS[b].rally ?? -1) - (MEMBERS[a].rally ?? -1)
  const pool = signed.filter((r) => r.role === 'main' && !grouped.has(r.memberId)).map((r) => r.memberId).sort(byRally)
  const subs = signed.filter((r) => r.role === 'sub' && !grouped.has(r.memberId)).map((r) => r.memberId).sort(byRally)
  // 要点模板按组名存
  const notes = {}
  plan.groups.forEach((g) => { const t = tpl.notes && tpl.notes[l] && tpl.notes[l][g.name]; if (t) notes[g.id] = t })
  DATA[l] = { groups: plan.groups, pool, subs, assign: plan.assign, tasks: plan.tasks, notes, fromLastWeek: plan.fromLastWeek }
})
const INFO = { channel: tpl.channel || '', commander: { 1: (tpl.commander && tpl.commander[1]) || '', 2: (tpl.commander && tpl.commander[2]) || '' } }

const S = { legion: String(props.legion), phase: 0, sel: null, drag: null, playing: false, playT: 0, playStart: 0, t0: performance.now() }
const L = () => DATA[S.legion]
const groupOf = (gid) => L().groups.find((g) => g.id === gid)
S.sel = (L().groups[0] || {}).id || null

// ===================== 保存 =====================
const timers = {}
const pending = new Map() // key → 待执行的保存函数
function debounce(key, fn, ms = 800) {
  clearTimeout(timers[key])
  pending.set(key, fn)
  saveState.value = '保存中…'
  timers[key] = setTimeout(() => flush(key), ms)
}
async function flush(key) {
  const fn = pending.get(key)
  if (!fn) return
  pending.delete(key)
  try {
    await fn()
    if (!pending.size) saveState.value = '已保存'
    emit('saved')
  } catch (e) {
    saveState.value = '保存失败'
    message.error('保存失败：' + e.message)
  }
}
function savePlan() {
  const l = Number(S.legion)
  const D = DATA[l]
  debounce('plan' + l, () => call('admin.guanduSavePlan', { legion: l, plan: { groups: D.groups, assign: D.assign, tasks: D.tasks } }))
}
function saveTpl(key, payload) { debounce('tpl' + key, () => call('admin.guanduSaveTpl', payload), 1000) }

// ===================== 画布 =====================
let cv, ctx, tip, raf = 0, ro = null
let W = 0, H = 0, M = { x: 0, y: 0, w: 0, h: 0 }
function resize() {
  const r = cv.parentElement.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  W = r.width; H = r.height
  cv.width = W * dpr; cv.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const h = Math.min(H - 30, (W - 40) / 0.8)
  M = { x: 0, y: 0, w: Math.min(W - 40, h * 1.12), h }
  M.x = (W - M.w) / 2; M.y = (H - M.h) / 2
}
const P = (o) => ({ x: M.x + o.x * M.w, y: M.y + o.y * M.h })
const sc = () => M.h / 820
function radiusOf(id, phase) {
  const base = { fort: 34, nest: 28, forge: 27, hammer: 27, big: 24, catapult: 23, granary: 18 }[BM[id].kind]
  const r = rankOf(id, phase)
  return base * (r === 1 ? 1.2 : r === 2 ? 1.08 : 1) * sc()
}
function tokenPos(phase, gid) {
  const A = L().assign[phase]
  const b = A[gid]
  if (b) {
    const here = L().groups.filter((g) => A[g.id] === b).map((g) => g.id)
    const k = here.indexOf(gid)
    const ANG = [200, 340, 160, 20, 245, 295]
    const a = ANG[k % ANG.length] * Math.PI / 180
    const c = P(BM[b])
    const r = radiusOf(b, phase) + 24 * sc()
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }
  }
  const idle = L().groups.filter((g) => !A[g.id]).map((g) => g.id)
  return { x: 40 + idle.indexOf(gid) * 46, y: H - 40 }
}
const prevPos = (phase, gid) => (phase === 0 || !L().assign[phase - 1][gid] ? P(BASE_US) : tokenPos(phase - 1, gid))
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
function ctrl(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1, bend = Math.min(80, len * 0.25)
  return { x: mx - dy / len * bend, y: my + dx / len * bend }
}
function curvePt(a, b, p) { const c = ctrl(a, b), q = 1 - p; return { x: q * q * a.x + 2 * q * p * c.x + p * p * b.x, y: q * q * a.y + 2 * q * p * c.y + p * p * b.y } }

function render(now) {
  const t = (now - S.t0) / 1000
  ctx.clearRect(0, 0, W, H)
  let phase = S.phase, pp = 1
  if (S.playing) {
    S.playT = Math.min(3, (now - S.playStart) / 2600)
    phase = Math.min(2, Math.floor(S.playT))
    pp = S.playT >= 3 ? 1 : S.playT - phase
    if (phase !== S.phase) { S.phase = phase; renderSide() }
    if (S.playT >= 3) { S.playing = false; renderTimeline() }
    updateClock(phase, pp)
  }
  drawField(t); drawRoads(); drawCarts(t, phase)
  drawBase(BASE_US, '#3b82f6', '我方大本营', t); drawBase(BASE_THEM, '#ef4444', '敌方大本营', t)
  BUILDINGS.forEach((b) => drawBuilding(b, phase, t, S.playing ? pp : 1))
  drawTray()
  const move = S.playing ? ease(Math.min(1, pp / 0.55)) : 1
  L().groups.forEach((g) => {
    if (!L().assign[phase][g.id]) return
    const a = prevPos(phase, g.id), b = tokenPos(phase, g.id)
    if (Math.hypot(a.x - b.x, a.y - b.y) > 4) drawArrow(a, b, g.color, t, move)
  })
  if (S.sel && !S.playing && !S.drag) drawRoute(S.sel)
  L().groups.forEach((g) => {
    if (S.drag && S.drag.gid === g.id) return
    let p = tokenPos(phase, g.id)
    if (S.playing && L().assign[phase][g.id]) p = curvePt(prevPos(phase, g.id), p, move)
    drawToken(g, p, g.id === S.sel, t)
  })
  if (S.drag) {
    const g = groupOf(S.drag.gid)
    const hit = dropTarget(S.drag.x, S.drag.y)
    if (hit) {
      const c = P(BM[hit])
      ctx.save(); ctx.strokeStyle = g.color; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 30
      ctx.beginPath(); ctx.arc(c.x, c.y, radiusOf(hit, phase) + 14 * sc(), 0, Math.PI * 2); ctx.stroke(); ctx.restore()
    }
    drawToken(g, S.drag, true, t, 1.15)
  }
  raf = requestAnimationFrame(render)
}
function drawField(t) {
  const c = { x: M.x + M.w / 2, y: M.y + M.h * 0.54 }
  const top = { x: c.x, y: M.y }, bot = { x: c.x, y: M.y + M.h }, lf = { x: M.x, y: c.y }, rt = { x: M.x + M.w, y: c.y }
  const dia = () => { ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rt.x, rt.y); ctx.lineTo(bot.x, bot.y); ctx.lineTo(lf.x, lf.y); ctx.closePath() }
  ctx.save(); ctx.strokeStyle = 'rgba(80,110,170,.07)'; ctx.lineWidth = 1
  const step = 28 * sc()
  for (let x = M.x % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = M.y % step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  ctx.restore()
  ctx.save(); dia()
  const g = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, M.h * 0.6)
  g.addColorStop(0, '#1b2948'); g.addColorStop(1, '#0f182c'); ctx.fillStyle = g; ctx.fill(); ctx.clip()
  const gl = ctx.createLinearGradient(M.x, 0, M.x + M.w, 0)
  gl.addColorStop(0, 'rgba(59,130,246,.16)'); gl.addColorStop(0.46, 'rgba(59,130,246,0)'); gl.addColorStop(0.54, 'rgba(239,68,68,0)'); gl.addColorStop(1, 'rgba(239,68,68,.16)')
  ctx.fillStyle = gl; ctx.fillRect(M.x, M.y, M.w, M.h)
  ctx.strokeStyle = 'rgba(148,180,240,.06)'; ctx.lineWidth = 1
  for (let i = 1; i < 9; i++) {
    ctx.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.08) {
      const r = i * M.h * 0.065 * (1 + 0.08 * Math.sin(a * 3 + i) + 0.05 * Math.sin(a * 5 - i * 2))
      const x = c.x + Math.cos(a) * r * 0.82, y = c.y + Math.sin(a) * r
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const sy = M.y + ((t * 60) % (M.h + 200)) - 100
  const sg = ctx.createLinearGradient(0, sy - 60, 0, sy + 60)
  sg.addColorStop(0, 'rgba(56,189,248,0)'); sg.addColorStop(0.5, 'rgba(56,189,248,.05)'); sg.addColorStop(1, 'rgba(56,189,248,0)')
  ctx.fillStyle = sg; ctx.fillRect(M.x, sy - 60, M.w, 120)
  ctx.restore()
  ctx.save(); dia(); ctx.strokeStyle = 'rgba(125,211,252,.5)'; ctx.lineWidth = 2; ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 14; ctx.stroke(); ctx.restore()
  ctx.save(); ctx.font = `900 ${46 * sc()}px "PingFang SC"`; ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(59,130,246,.12)'; ctx.fillText('我方', M.x + M.w * 0.2, M.y + M.h * 0.25)
  ctx.fillStyle = 'rgba(239,68,68,.12)'; ctx.fillText('敌方', M.x + M.w * 0.8, M.y + M.h * 0.25)
  ctx.restore()
}
function drawRoads() {
  const links = [['wuchao', 'bqf'], ['bqf', 'upL'], ['bqf', 'upR'], ['upL', 'aocang'], ['upR', 'liyang'], ['aocang', 'guandu'], ['liyang', 'guandu'], ['midL', 'guandu'], ['midR', 'guandu'],
    ['guandu', 'pili'], ['pili', 'lowL'], ['pili', 'lowR'], ['pili', 'gjf'], ['lowL', 'gjf'], ['lowR', 'gjf'], ['midL', 'upL'], ['midL', 'lowL'], ['midR', 'upR'], ['midR', 'lowR']]
  ctx.save(); ctx.strokeStyle = 'rgba(148,180,240,.13)'; ctx.lineWidth = 2; ctx.setLineDash([2, 6])
  links.forEach(([a, b]) => { const p = P(BM[a]), q = P(BM[b]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke() })
  ;[['midL', P(BASE_US)], ['midR', P(BASE_THEM)]].forEach(([a, q]) => { const p = P(BM[a]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke() })
  ctx.restore()
}
function drawCarts(t, phase) {
  if (phase < 1) return
  ;[[0.4, 0.3], [0.6, 0.3], [0.4, 0.63], [0.6, 0.63]].forEach(([x, y], i) => {
    const p = P({ x, y }), s = 6 * sc() * (1 + 0.15 * Math.sin(t * 3 + i))
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#fde68a'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 12
    ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore()
  })
}
function drawBase(o, color, label, t) {
  const p = P(o), s = sc()
  ctx.save()
  const pulse = 1 + 0.08 * Math.sin(t * 2)
  const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 60 * s * pulse)
  g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00')
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 60 * s * pulse, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#0d1528'; ctx.strokeStyle = color; ctx.lineWidth = 2
  const w = 34 * s, h = 26 * s
  ctx.beginPath(); ctx.rect(p.x - w / 2, p.y - h / 2, w, h); ctx.fill(); ctx.stroke()
  for (let i = 0; i < 4; i++) { ctx.fillStyle = color; ctx.fillRect(p.x - w / 2 + i * w / 3.5, p.y - h / 2 - 6 * s, 5 * s, 6 * s) }
  ctx.beginPath(); ctx.moveTo(p.x, p.y - h / 2 - 6 * s); ctx.lineTo(p.x, p.y - h / 2 - 22 * s); ctx.stroke()
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(p.x, p.y - h / 2 - 22 * s); ctx.lineTo(p.x + 12 * s, p.y - h / 2 - 18 * s); ctx.lineTo(p.x, p.y - h / 2 - 14 * s); ctx.fill()
  pill(label, p.x, p.y + h / 2 + 14 * s, color)
  ctx.restore()
}
function pill(text, x, y, color, bg = 'rgba(10,16,32,.85)', size = 12) {
  const s = sc()
  ctx.save(); ctx.font = `600 ${size * Math.max(0.85, s)}px "PingFang SC"`
  const w = ctx.measureText(text).width + 14, h = 20 * Math.max(0.85, s)
  ctx.fillStyle = bg; ctx.strokeStyle = color; ctx.lineWidth = 1
  roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5)
  ctx.restore()
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
function drawBuilding(b, phase, t, pp) {
  const p = P(b), r = radiusOf(b.id, phase), s = sc()
  const open = isOpen(b.id, phase)
  const rank = open ? rankOf(b.id, phase) : 0
  const col = open ? colorOf(b.id, phase) : '#3a4560'
  const special = open && col !== RANK_COLOR[rank]
  const justOpened = open && b.open === phase + 1 && phase > 0 && S.playing && pp < 0.7
  ctx.save()
  if (!open) ctx.globalAlpha = 0.38
  if (open && ((rank && rank < 3) || special)) {
    const k = 1 + 0.12 * Math.sin(t * 3 + p.x)
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.2 * k)
    g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2 * k, 0, Math.PI * 2); ctx.fill()
  }
  if (justOpened) {
    const q = pp / 0.7
    ctx.save(); ctx.strokeStyle = `rgba(253,230,138,${1 - q})`; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(p.x, p.y, r + q * 60 * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
  }
  ctx.fillStyle = '#0c1426'; ctx.strokeStyle = col; ctx.lineWidth = rank === 1 ? 3 : 2
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.strokeStyle = col + '55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r - 4 * s, 0, Math.PI * 2); ctx.stroke()
  icon(b.kind, p.x, p.y, r * 0.55, open ? '#e6ecf7' : '#6b7a99')
  const label = b.side ? (b.side === '我方' ? '我·' : '敌·') + b.name.replace('小粮仓', '仓') : b.name
  pill(label, p.x, p.y + r + 13 * s, open ? '#dbe6ff' : '#6b7a99', 'rgba(10,16,32,.85)', b.kind === 'granary' ? 11 : 12)
  if (!open) pill(`第${b.open}阶段开放`, p.x, p.y - r - 12 * s, '#6b7a99', 'rgba(10,16,32,.85)', 10)
  if (open && rank === 1 && !S.playing && !Object.values(L().assign[phase]).includes(b.id)) {
    const k = 0.5 + 0.5 * Math.sin(t * 6)
    ctx.strokeStyle = `rgba(239,68,68,${0.4 + 0.6 * k})`; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 8 * s, 0, Math.PI * 2); ctx.stroke()
    pill('无人', p.x + r + 18 * s, p.y, '#fff', '#ef4444', 10)
  }
  ctx.restore()
}
function icon(kind, x, y, s, c) {
  ctx.save(); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1.5, s * 0.14); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const B = () => ctx.beginPath()
  if (kind === 'granary' || kind === 'big') {
    const dome = (dx, k) => { B(); ctx.arc(x + dx, y + s * 0.15, s * 0.55 * k, Math.PI, 0); ctx.lineTo(x + dx + s * 0.55 * k, y + s * 0.6); ctx.lineTo(x + dx - s * 0.55 * k, y + s * 0.6); ctx.closePath(); ctx.stroke(); B(); ctx.moveTo(x + dx, y - s * 0.4 * k); ctx.lineTo(x + dx, y - s * 0.7 * k); ctx.stroke() }
    if (kind === 'big') { dome(-s * 0.38, 0.8); dome(s * 0.38, 0.8) } else dome(0, 1)
  } else if (kind === 'forge') {
    ;[1, -1].forEach((d) => { B(); ctx.moveTo(x - d * s * 0.7, y + s * 0.7); ctx.lineTo(x + d * s * 0.6, y - s * 0.6); ctx.stroke() })
    ;[1, -1].forEach((d) => { B(); ctx.moveTo(x - d * s * 0.45, y + s * 0.25); ctx.lineTo(x - d * s * 0.2, y + s * 0.5); ctx.stroke() })
  } else if (kind === 'hammer') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 4); ctx.fillRect(-s * 0.55, -s * 0.7, s * 1.1, s * 0.42)
    B(); ctx.moveTo(0, -s * 0.3); ctx.lineTo(0, s * 0.8); ctx.stroke(); ctx.restore()
  } else if (kind === 'nest') {
    B(); ctx.moveTo(x - s * 0.75, y + s * 0.6); ctx.lineTo(x, y - s * 0.3); ctx.lineTo(x + s * 0.75, y + s * 0.6); ctx.closePath(); ctx.stroke()
    B(); ctx.moveTo(x, y - s * 0.3); ctx.lineTo(x, y - s * 0.85); ctx.stroke()
    B(); ctx.moveTo(x, y - s * 0.85); ctx.lineTo(x + s * 0.45, y - s * 0.7); ctx.lineTo(x, y - s * 0.55); ctx.fill()
  } else if (kind === 'fort') {
    const w = s * 1.5, h = s
    B(); ctx.moveTo(x - w / 2, y + h / 2); ctx.lineTo(x - w / 2, y - h / 3)
    for (let i = 0; i < 5; i++) { const xx = x - w / 2 + i * w / 5; ctx.lineTo(xx, y - h / 2); ctx.lineTo(xx + w / 10, y - h / 2); ctx.lineTo(xx + w / 10, y - h / 3); ctx.lineTo(xx + w / 5, y - h / 3) }
    ctx.lineTo(x + w / 2, y + h / 2); ctx.closePath(); ctx.stroke()
    B(); ctx.arc(x, y + h / 2, s * 0.28, Math.PI, 0); ctx.stroke()
  } else if (kind === 'catapult') {
    B(); ctx.arc(x - s * 0.4, y + s * 0.5, s * 0.22, 0, Math.PI * 2); ctx.stroke()
    B(); ctx.arc(x + s * 0.4, y + s * 0.5, s * 0.22, 0, Math.PI * 2); ctx.stroke()
    B(); ctx.moveTo(x - s * 0.7, y + s * 0.25); ctx.lineTo(x + s * 0.7, y + s * 0.25); ctx.stroke()
    B(); ctx.moveTo(x - s * 0.1, y + s * 0.25); ctx.lineTo(x + s * 0.55, y - s * 0.65); ctx.stroke()
    B(); ctx.arc(x + s * 0.55, y - s * 0.65, s * 0.16, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}
function drawTray() {
  const idle = L().groups.filter((g) => !L().assign[S.phase][g.id]).length
  ctx.save(); ctx.fillStyle = 'rgba(17,26,46,.8)'; ctx.strokeStyle = '#24324f'
  roundRect(14, H - 72, Math.max(160, 30 + Math.max(1, idle) * 46), 60, 12); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#8a9bbd'; ctx.font = '12px "PingFang SC"'; ctx.fillText('待命区（拖到这里 = 本阶段不派）', 22, H - 78)
  ctx.restore()
}
function drawArrow(a, b, color, t, upto = 1) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3 * sc(); ctx.shadowColor = color; ctx.shadowBlur = 10
  ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 40
  ctx.beginPath(); ctx.moveTo(a.x, a.y)
  for (let i = 1; i <= 30 * upto; i++) { const q = curvePt(a, b, i / 30); ctx.lineTo(q.x, q.y) }
  ctx.stroke()
  if (upto >= 0.98) {
    const e = curvePt(a, b, 0.9), ang = Math.atan2(b.y - e.y, b.x - e.x), L2 = 12 * sc()
    ctx.setLineDash([]); ctx.fillStyle = color
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(ang - 0.45) * L2, b.y - Math.sin(ang - 0.45) * L2); ctx.lineTo(b.x - Math.cos(ang + 0.45) * L2, b.y - Math.sin(ang + 0.45) * L2); ctx.fill()
  }
  ctx.restore()
}
function drawRoute(gid) {
  const g = groupOf(gid)
  if (!g) return
  const stops = []
  ;[0, 1, 2].forEach((k) => {
    const b = L().assign[k][gid]
    if (!b) return
    const last = stops[stops.length - 1]
    if (last && last.b === b) last.ks.push(k + 1)
    else stops.push({ b, ks: [k + 1], p: tokenPos(k, gid) })
  })
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5])
  let last = P(BASE_US)
  stops.forEach(({ p }) => { ctx.beginPath(); ctx.moveTo(last.x, last.y); for (let i = 1; i <= 24; i++) { const q = curvePt(last, p, i / 24); ctx.lineTo(q.x, q.y) } ctx.stroke(); last = p })
  ctx.setLineDash([])
  stops.forEach(({ p, ks }) => pill(ks.join('·'), p.x, p.y - 30 * sc(), '#0a0f1d', g.color, 10))
  ctx.restore()
}
function drawToken(g, p, sel, t, k = 1) {
  const r = 19 * Math.max(0.85, sc()) * k
  ctx.save()
  if (sel) { ctx.shadowColor = g.color; ctx.shadowBlur = 22 }
  ctx.fillStyle = g.color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.7)'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke()
  if (sel) { ctx.strokeStyle = g.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + 2 * Math.sin(t * 5), 0, Math.PI * 2); ctx.stroke() }
  ctx.fillStyle = '#0a0f1d'; ctx.font = `800 ${12 * Math.max(0.85, sc()) * k}px "PingFang SC"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(g.short || g.name.slice(0, 2), p.x, p.y + 1)
  ctx.fillStyle = '#0a0f1d'; ctx.beginPath(); ctx.arc(p.x + r * 0.75, p.y - r * 0.75, 8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = '700 10px sans-serif'; ctx.fillText(g.members.length, p.x + r * 0.75, p.y - r * 0.75 + 0.5)
  ctx.restore()
}

// ===================== 拖拽 =====================
function tokenAt(x, y) {
  for (const g of [...L().groups].reverse()) { const p = tokenPos(S.phase, g.id); if (Math.hypot(p.x - x, p.y - y) < 22) return g.id }
  return null
}
function dropTarget(x, y) {
  let best = null, bd = 1e9
  BUILDINGS.forEach((b) => {
    if (!isOpen(b.id, S.phase)) return
    const p = P(b), d = Math.hypot(p.x - x, p.y - y)
    if (d < radiusOf(b.id, S.phase) + 34 && d < bd) { best = b.id; bd = d }
  })
  return best
}
const buildingAt = (x, y) => BUILDINGS.find((b) => { const p = P(b); return Math.hypot(p.x - x, p.y - y) < radiusOf(b.id, S.phase) + 4 }) || null
const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
function onDown(e) {
  if (S.playing) return
  const { x, y } = local(e)
  const gid = tokenAt(x, y)
  if (gid) { S.drag = { gid, x, y, moved: false }; cv.setPointerCapture(e.pointerId); select(gid) }
}
function onMove(e) {
  const { x, y } = local(e)
  if (S.drag) { S.drag.moved = S.drag.moved || Math.hypot(x - S.drag.x, y - S.drag.y) > 3; S.drag.x = x; S.drag.y = y; tip.style.opacity = 0; return }
  cv.style.cursor = tokenAt(x, y) ? 'grab' : 'default'
  const b = buildingAt(x, y)
  if (b) {
    const on = isOpen(b.id, S.phase)
    const who = L().groups.filter((g) => L().assign[S.phase][g.id] === b.id)
    tip.innerHTML = `<b style="color:${on ? colorOf(b.id, S.phase) : '#8a9bbd'}">${fullName(b.id)}</b><br>` +
      (on ? (who.length ? '本阶段：' + who.map((g) => `<span style="color:${g.color}">${esc(g.name)}</span>`).join('、') : '<span style="color:#f87171">本阶段没人去</span>') : `第${b.open}阶段开放`)
    tip.style.left = Math.min(W - 230, x + 16) + 'px'; tip.style.top = (y + 12) + 'px'; tip.style.opacity = 1
  } else tip.style.opacity = 0
}
function onUp(e) {
  if (!S.drag) return
  const { x, y } = local(e)
  if (S.drag.moved) {
    const hit = dropTarget(x, y)
    const A = L().assign[S.phase]
    if (hit) A[S.drag.gid] = hit
    else delete A[S.drag.gid]
    savePlan()
    renderSide()
  }
  S.drag = null
}

// ===================== 侧栏 =====================
const $ = (sel) => root.value.querySelector(sel)
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function select(gid) { S.sel = gid; renderSide() }
function chip(id, pos) {
  const m = MEMBERS[id]
  if (!m) return ''
  const tag = pos === 'head' ? '<span class="pos head">车头</span>' : pos === 'body' ? '<span class="pos body">车身</span>' : ''
  return `<div class="row chip${pos === 'head' ? ' cap' : ''}" draggable="true" data-m="${id}" title="双击设为车头">${tag}<span class="nm">${esc(m.name)}</span><span class="rv">${m.rally == null ? '-' : m.rally.toFixed(2)}</span><span class="t ${m.role === '主力' ? 'main' : 'sub'}">${m.role === '主力' ? '主' : '替'}</span></div>`
}
function renderLeft() {
  const D = L()
  const l = Number(S.legion)
  const mainN = res.rows.filter((r) => r.legion === l && r.role === 'main').length
  const subN = res.rows.filter((r) => r.legion === l && r.role === 'sub').length
  const q = (label, n, max, color) => `<div class="q"><small>${label}</small><div><b>${n}</b> / ${max}　<small>剩 ${Math.max(0, max - n)} 个</small></div><div class="bar"><i style="width:${Math.min(100, n / max * 100)}%;background:${color}"></i></div></div>`
  $('.left').innerHTML = `
    <div class="sec"><h3>排表信息</h3>
      <div class="field"><label>频道</label><input id="gdChannel" placeholder="如 xx频道：xxx" value="${esc(INFO.channel)}" /></div>
      <div class="field"><label>指挥</label><input id="gdCommander" placeholder="如 指挥：xxx" value="${esc(INFO.commander[S.legion])}" /></div>
      <p class="hint">写进导出的排表图；频道两个团共用，指挥按团分开，下周自动带上</p></div>
    <div class="sec"><h3>报名情况</h3><div class="quota">${q('主力', mainN, res.caps.main, '#3b82f6')}${q('替补', subN, res.caps.sub, '#f59e0b')}</div>
      ${D.fromLastWeek ? '<p class="hint" style="margin-top:6px;color:#fbbf24">本周还没排过：分组和任务照上周起了个头，组里只留了这周报名的人</p>' : ''}</div>
    <div class="sec"><h3>分组 <button class="mini" id="gdAddGroup">＋ 新建分组</button></h3><p class="hint" style="margin:-4px 0 8px">数字是集结值 · 拖名字换组 · 双击设车头</p>
      ${D.groups.map((g) => `<div class="group${g.id === S.sel ? ' sel' : ''}" data-g="${g.id}">
        <div class="ghead" data-pick="${g.id}"><span class="dot" style="background:${g.color};box-shadow:0 0 8px ${g.color}"></span><b>${esc(g.name)}</b><span class="hint">${g.members.length} 人</span>
          <span class="gop" data-rename="${g.id}" title="改名">✎</span>${g.members.length ? '' : `<span class="gop" data-del="${g.id}" title="删除空组">✕</span>`}</div>
        <div class="chips">${g.members.map((id, i) => chip(id, i === 0 ? 'head' : 'body')).join('') || '<span class="hint">把名字拖进来</span>'}</div></div>`).join('')}
    </div>
    <div class="sec"><h3>未分组主力 <span class="hint">${D.pool.length}</span></h3><div class="pool chips" data-g="pool">${D.pool.map((id) => chip(id)).join('') || '<span class="hint">都分好了</span>'}</div></div>
    <div class="sec"><h3>替补 <span class="hint">${D.subs.length}</span></h3><div class="pool chips" data-g="subs">${D.subs.map((id) => chip(id)).join('') || '<span class="hint">没有替补</span>'}</div></div>`
  bindLeft()
}
function listOf(key) { const D = L(); return key === 'pool' ? D.pool : key === 'subs' ? D.subs : groupOf(key).members }
function bindLeft() {
  const left = $('.left')
  $('#gdChannel').oninput = (e) => { INFO.channel = e.target.value.trim(); saveTpl('channel', { channel: INFO.channel }) }
  $('#gdCommander').oninput = (e) => { INFO.commander[S.legion] = e.target.value.trim(); saveTpl('commander' + S.legion, { legion: Number(S.legion), commander: INFO.commander[S.legion] }) }
  $('#gdAddGroup').onclick = () => {
    const name = (window.prompt('新分组的名字（12 个字以内）', '新分组') || '').trim().slice(0, 12)
    if (!name) return
    const D = L()
    const used = new Set(D.groups.map((g) => g.id))
    let i = D.groups.length; while (used.has('g' + i)) i += 1
    D.groups.push({ id: 'g' + i, name, short: name.replace(/组$/, '').slice(0, 2), color: GD.GROUP_COLORS[D.groups.length % GD.GROUP_COLORS.length], members: [] })
    S.sel = 'g' + i; savePlan(); renderSide()
  }
  left.querySelectorAll('[data-pick]').forEach((el) => { el.onclick = (e) => { if (!e.target.closest('.gop')) select(el.dataset.pick) } })
  left.querySelectorAll('[data-rename]').forEach((el) => {
    el.onclick = () => {
      const g = groupOf(el.dataset.rename)
      const name = (window.prompt('分组改名（12 个字以内）', g.name) || '').trim().slice(0, 12)
      if (!name || name === g.name) return
      // 要点模板按组名存：改名后把要点带到新名字下
      if (L().notes[g.id]) saveTpl('note' + S.legion + name, { legion: Number(S.legion), group: name, note: L().notes[g.id] })
      g.name = name; g.short = name.replace(/组$/, '').slice(0, 2); savePlan(); renderSide()
    }
  })
  left.querySelectorAll('[data-del]').forEach((el) => {
    el.onclick = () => {
      const D = L(), gid = el.dataset.del
      if (!window.confirm(`删除「${groupOf(gid).name}」？`)) return
      D.groups = D.groups.filter((g) => g.id !== gid)
      ;[0, 1, 2].forEach((k) => { delete D.assign[k][gid]; delete D.tasks[k][gid] })
      if (S.sel === gid) S.sel = (D.groups[0] || {}).id || null
      savePlan(); renderSide()
    }
  })
  left.querySelectorAll('.chip').forEach((el) => {
    el.ondragstart = (e) => e.dataTransfer.setData('text/plain', el.dataset.m)
    el.ondblclick = () => {
      const key = el.closest('[data-g]').dataset.g
      if (key === 'pool' || key === 'subs') return
      const arr = listOf(key); arr.splice(arr.indexOf(el.dataset.m), 1); arr.unshift(el.dataset.m); savePlan(); renderSide()
    }
  })
  left.querySelectorAll('[data-g]').forEach((box) => {
    box.ondragover = (e) => { e.preventDefault(); box.classList.add('over') }
    box.ondragleave = () => box.classList.remove('over')
    box.ondrop = (e) => {
      e.preventDefault(); box.classList.remove('over')
      const id = e.dataTransfer.getData('text/plain')
      if (!MEMBERS[id]) return
      const D = L()
      ;[D.pool, D.subs, ...D.groups.map((g) => g.members)].forEach((arr) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1) })
      // 拖回「未分组」：替补自动回替补栏
      const key = box.dataset.g
      if (key === 'pool' && MEMBERS[id].role === '替补') D.subs.push(id)
      else if (key === 'subs' && MEMBERS[id].role === '主力') D.pool.push(id)
      else listOf(key).push(id)
      savePlan(); renderSide()
    }
  })
}
function renderRight() {
  const g = groupOf(S.sel)
  const el = $('.right')
  if (!g) { el.innerHTML = '<p class="hint">点地图上的棋子或左边分组</p>'; return }
  const D = L()
  const opt = (k, v) => ['<option value="">—</option>'].concat(BUILDINGS.filter((b) => isOpen(b.id, k)).map((b) => `<option value="${b.id}"${v === b.id ? ' selected' : ''}>${shortName(b.id)}</option>`)).join('')
  const opt2 = (v) => T456.map((x) => `<option${x === v ? ' selected' : ''}>${x}</option>`).join('')
  el.innerHTML = `
    <div class="sec"><h3><span class="dot" style="background:${g.color};box-shadow:0 0 8px ${g.color}"></span><span style="color:var(--ink);font-size:16px">${esc(g.name)}</span><span class="hint">车头 ${g.members[0] ? esc(MEMBERS[g.members[0]].name) : '未定'} · ${g.members.length} 人</span></h3></div>
    <div class="sec"><h3>三个阶段的任务</h3>
      <table class="tasks"><tr><th style="width:56px">阶段</th><th>1 队（地图拖）</th><th>2/3 队</th><th>4-6 队</th></tr>
      ${[0, 1, 2].map((k) => { const tk = D.tasks[k][g.id] || {}; const a = D.assign[k][g.id]
        return `<tr><td>${['一', '二', '三'][k]}阶段</td><td><span class="tgt${a ? '' : ' none'}" data-ph="${k}">${a ? shortName(a) : '待命'}</span></td>
        <td><select data-k="${k}" data-f="t23">${opt(k, tk.t23)}</select></td><td><select data-k="${k}" data-f="t456">${opt2(tk.t456 || '')}</select></td></tr>` }).join('')}
      </table></div>
    <div class="sec"><h3>本组要点 <span class="hint">按组名存，下周自动带上</span></h3><textarea id="gdNote" placeholder="例如：车头切藏品、吃药、上麦">${esc(D.notes[g.id] || '')}</textarea></div>
    <div class="sec"><h3>建筑颜色</h3>
      <div class="legend"><span style="--c:#fbbf24">兵器坊（前期）· 官渡（后期）</span><span style="--c:#7dd3fc">工匠坊</span><span style="--c:#fb7185">乌巢</span><span style="--c:#a3e635">大粮仓</span><span style="--c:#a3b1cc">小粮仓 · 霹雳车</span></div>
      <p class="hint" style="line-height:1.7;margin-top:6px">前期：兵器坊 > 工匠坊 > 乌巢、小粮仓<br>后期：官渡 > 乌巢 > 大粮仓 > 霹雳车<br>首要建筑本阶段没人去会闪红。</p></div>
    <div class="sec"><button class="btn primary" style="width:100%" id="gdExport">导出排表图</button></div>`
  el.querySelectorAll('.tgt').forEach((x) => { x.onclick = () => setPhase(Number(x.dataset.ph)) })
  el.querySelectorAll('select').forEach((s) => {
    s.onchange = () => { const k = Number(s.dataset.k); D.tasks[k][g.id] = Object.assign(D.tasks[k][g.id] || {}, { [s.dataset.f]: s.value }); savePlan() }
  })
  $('#gdNote').oninput = (e) => { D.notes[g.id] = e.target.value; saveTpl('note' + S.legion + g.name, { legion: Number(S.legion), group: g.name, note: e.target.value }) }
  $('#gdExport').onclick = exportSheet
}
function renderTimeline() {
  const l = Number(S.legion)
  $('.timeline').innerHTML = PHASES.map((p, k) => `<div class="ph${k === S.phase ? ' on' : ''}" data-k="${k}"><b>${p.name}　${GD.phaseTime(l, k)}</b><small>${p.desc}</small><i id="gdBar${k}"></i></div>`).join('') +
    `<div class="play"><div id="gdClock">${GD.phaseTime(l, S.phase).slice(0, 5)}</div><button class="btn primary" id="gdPlay">${S.playing ? '推演中…' : '▶ 推演'}</button></div>`
  root.value.querySelectorAll('.ph').forEach((el) => { el.onclick = () => setPhase(Number(el.dataset.k)) })
  $('#gdPlay').onclick = play
}
function updateClock(k, p) {
  const st = PHASES[k].start, mins = st[1] + Math.floor(p * PHASES[k].dur)
  const h = (S.legion === '2' ? st[0] - 7 : st[0]) + Math.floor(mins / 60)
  const c = $('#gdClock'); if (c) c.textContent = `${String(h).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  ;[0, 1, 2].forEach((i) => { const b = $('#gdBar' + i); if (b) b.style.width = (i < k ? 100 : i === k ? p * 100 : 0) + '%' })
  root.value.querySelectorAll('.ph').forEach((el, i) => el.classList.toggle('on', i === k))
}
function setPhase(k) { if (S.playing) return; S.phase = k; renderTimeline(); renderRight() }
function play() { if (S.playing) return; S.playing = true; S.playStart = performance.now(); S.phase = 0; renderTimeline(); renderRight() }
function renderSide() { renderLeft(); renderRight(); if (!S.playing) renderTimeline() }
function switchLegion(l) {
  if (S.playing) return
  S.legion = String(l); S.sel = (L().groups[0] || {}).id || null; S.phase = 0
  root.value.querySelectorAll('.lgtab').forEach((x) => x.classList.toggle('on', x.dataset.l === S.legion))
  renderSide()
}

// ===================== 导出 =====================
function battleText(l) {
  const d = new Date(res.battles[l])
  const bj = new Date(d.getTime() + 8 * 3600000)
  return `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 周日 ${l === 1 ? '21:00' : '14:00'} 场`
}
function exportSheet() {
  const l = Number(S.legion), D = DATA[l]
  const names = Object.fromEntries(Object.values(MEMBERS).map((m) => [m.id, m.name]))
  const c = GD.drawSheet({ alliance: res.alliance, legion: l, battleText: battleText(l), plan: D, names, subs: D.subs.map((id) => MEMBERS[id].name), notes: D.notes, channel: INFO.channel, commander: INFO.commander[l] })
  c.toBlob((blob) => { if (blob) download(blob, `官渡${l === 1 ? '一团' : '二团'}安排表.png`); else message.error('生成图片失败') }, 'image/png')
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen()
  else if (root.value.requestFullscreen) root.value.requestFullscreen()
}
function onKey(e) {
  if (e.key !== 'Escape' || (e.target.closest && e.target.closest('input, textarea, select'))) return
  if (!document.fullscreenElement) emit('close')
}

onMounted(() => {
  cv = $('canvas'); ctx = cv.getContext('2d'); tip = $('.tip')
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey)
  renderSide()
  ro = new ResizeObserver(resize); ro.observe(cv.parentElement)
  resize()
  raf = requestAnimationFrame(render)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
  window.removeEventListener('keydown', onKey)
  // 还在排队的保存立刻发出去（没改过的不写）
  Object.keys(timers).forEach((k) => clearTimeout(timers[k]))
  ;[...pending.keys()].forEach((k) => flush(k))
})
</script>

<template>
  <div ref="root" class="gdb">
    <header>
      <button class="btn" @click="emit('close')">← 返回</button>
      <h1>官渡之战 <span>· 排表沙盘</span></h1>
      <div class="tabs">
        <button class="lgtab" :class="{ on: legion === 1 }" data-l="1" @click="switchLegion(1)">一团 · 周日 21:00</button>
        <button class="lgtab" :class="{ on: legion === 2 }" data-l="2" @click="switchLegion(2)">二团 · 周日 14:00</button>
      </div>
      <span class="hint saved">{{ saveState }}</span>
      <div class="grow"></div>
      <span class="hint">拖动地图上的分组棋子到建筑 · 点棋子看全程路线 · Esc 返回</span>
      <button class="btn" title="浏览器全屏，开会投屏用" @click="toggleFull">⛶ 全屏</button>
    </header>
    <aside class="left"></aside>
    <main>
      <div class="wrap"><canvas></canvas><div class="tip"></div></div>
      <div class="timeline"></div>
    </main>
    <aside class="right"></aside>
  </div>
</template>

<style>
/* 沙盘的侧栏是手写 DOM，scoped 管不到，全部挂在 .gdb 下面 */
.gdb {
  --bg: #0a0f1d; --panel: #111a2e; --panel2: #16213a; --line: #24324f; --ink: #e6ecf7; --mute: #8a9bbd;
  position: fixed; inset: 0; z-index: 2000; display: grid; grid-template-columns: 300px 1fr 330px; grid-template-rows: 56px 1fr;
  background: var(--bg); color: var(--ink); font-size: 13px; font-family: "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif;
}
.gdb * { box-sizing: border-box; }
.gdb button, .gdb select, .gdb textarea, .gdb input { font: inherit; color: inherit; }
.gdb header { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--line); background: linear-gradient(90deg, #0d1528, #121c33); }
.gdb h1 { font-size: 18px; letter-spacing: 2px; margin: 0; white-space: nowrap; }
.gdb h1 span { color: #fbbf24; }
.gdb .tabs { display: flex; background: #0b1324; border: 1px solid var(--line); border-radius: 10px; padding: 3px; }
.gdb .tabs button { border: 0; background: none; padding: 6px 14px; border-radius: 7px; cursor: pointer; color: var(--mute); }
.gdb .tabs button.on { background: #3b82f6; color: #fff; }
.gdb .grow { flex: 1; }
.gdb .btn { border: 1px solid var(--line); background: var(--panel2); padding: 7px 14px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.gdb .btn:hover { border-color: #3a4d75; }
.gdb .btn.primary { background: linear-gradient(135deg, #f59e0b, #f97316); border: 0; color: #1a1205; font-weight: 700; }
.gdb .mini { margin-left: auto; border: 1px dashed #3a4d75; background: none; color: #93c5fd; border-radius: 6px; padding: 1px 8px; cursor: pointer; font-size: 12px; }
.gdb .hint { color: var(--mute); font-size: 12px; }
.gdb .saved { color: #34d399; min-width: 50px; }
.gdb aside { background: var(--panel); overflow: auto; padding: 14px; }
.gdb aside.left { border-right: 1px solid var(--line); }
.gdb aside.right { border-left: 1px solid var(--line); }
.gdb .sec { margin-bottom: 16px; }
.gdb .sec h3 { font-size: 13px; color: var(--mute); font-weight: 600; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
.gdb .sec p { margin: 0; }
.gdb .field { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.gdb .field label { width: 34px; color: var(--mute); font-size: 12px; flex: none; }
.gdb .field input { flex: 1; min-width: 0; background: #0d1630; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
.gdb .field input:focus, .gdb textarea:focus { outline: none; border-color: #4b6aa8; }
.gdb .quota { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gdb .q { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
.gdb .q b { font-size: 20px; }
.gdb .q small { color: var(--mute); }
.gdb .q .bar { height: 5px; background: #0b1324; border-radius: 3px; margin-top: 6px; overflow: hidden; }
.gdb .q .bar i { display: block; height: 100%; border-radius: 3px; }
.gdb .group { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 8px; margin-bottom: 8px; }
.gdb .group.sel { border-color: #fbbf24; }
.gdb .group.over, .gdb .pool.over { background: #1d2b4a; border-color: #4b6aa8; }
.gdb .ghead { display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 6px; }
.gdb .ghead b { flex: 1; }
.gdb .gop { color: var(--mute); padding: 0 3px; cursor: pointer; }
.gdb .gop:hover { color: #fbbf24; }
.gdb .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.gdb .chips { display: flex; flex-direction: column; gap: 3px; min-height: 26px; }
.gdb .row { display: flex; align-items: center; gap: 6px; background: #0d1630; border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; cursor: grab; user-select: none; }
.gdb .row:hover { border-color: #3a4d75; }
.gdb .row .pos { font-size: 10px; padding: 1px 4px; border-radius: 3px; flex: none; }
.gdb .pos.head { background: #7f1d1d; color: #fecaca; }
.gdb .pos.body { background: #1f2a44; color: #9fb0d0; }
.gdb .row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gdb .row.cap { border-color: #fbbf24; }
.gdb .row.cap .nm { color: #fde68a; font-weight: 700; }
.gdb .row .rv { font-variant-numeric: tabular-nums; color: #cbd6ee; font-size: 12px; }
.gdb .row .t { font-size: 10px; padding: 0 3px; border-radius: 3px; flex: none; }
.gdb .t.main { background: #1e3a8a; color: #bfdbfe; }
.gdb .t.sub { background: #3f2a0a; color: #fcd34d; }
.gdb .pool { border: 1px dashed var(--line); border-radius: 10px; padding: 8px; }
.gdb main { position: relative; overflow: hidden; display: flex; flex-direction: column; }
.gdb .wrap { flex: 1; position: relative; min-height: 0; }
.gdb canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gdb .tip { position: absolute; pointer-events: none; background: rgba(10,15,29,.95); border: 1px solid #34466d; border-radius: 10px; padding: 8px 10px; font-size: 12px; line-height: 1.6; opacity: 0; transition: opacity .12s; max-width: 220px; }
.gdb .timeline { display: flex; gap: 8px; padding: 10px 16px 14px; border-top: 1px solid var(--line); background: #0c1426; }
.gdb .ph { flex: 1; background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; cursor: pointer; position: relative; overflow: hidden; }
.gdb .ph.on { border-color: #fbbf24; box-shadow: 0 0 0 1px #fbbf24 inset; }
.gdb .ph b { display: block; font-size: 13px; }
.gdb .ph small { color: var(--mute); }
.gdb .ph i { position: absolute; left: 0; bottom: 0; height: 3px; background: #fbbf24; width: 0; }
.gdb .play { width: 110px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.gdb #gdClock { font-variant-numeric: tabular-nums; font-size: 18px; font-weight: 700; color: #fbbf24; }
.gdb table.tasks { width: 100%; border-collapse: collapse; font-size: 12px; }
.gdb table.tasks th { color: var(--mute); font-weight: 500; text-align: left; padding: 4px 2px; }
.gdb table.tasks td { padding: 4px 2px; border-top: 1px solid var(--line); vertical-align: top; }
.gdb table.tasks select { width: 100%; background: #0d1630; border: 1px solid var(--line); border-radius: 6px; padding: 3px; }
.gdb .tgt { display: inline-block; padding: 2px 6px; border-radius: 5px; background: #0d1630; border: 1px solid var(--line); cursor: pointer; }
.gdb .tgt.none { color: var(--mute); border-style: dashed; }
.gdb textarea { width: 100%; min-height: 70px; background: #0d1630; border: 1px solid var(--line); border-radius: 8px; padding: 6px; resize: vertical; }
.gdb .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--mute); }
.gdb .legend span::before { content: ''; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; background: var(--c); box-shadow: 0 0 6px var(--c); }
</style>

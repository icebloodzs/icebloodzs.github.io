/**
 * 官渡之战：建筑、阶段、重要程度、配色，以及导出排表图。
 * 沙盘（GuanDuBoard.vue）和官渡之战页（GuanDu.vue）共用。
 * 建筑 id 要和云函数 handlers/guandu.js 里的 BUILDING_IDS 一致（保存时服务端按它校验）。
 */

/** 建筑：x / y 是菱形战场里的相对位置（0~1），open 是第几阶段开放 */
export const BUILDINGS = [
  { id: 'wuchao', name: '乌巢', kind: 'nest', x: 0.5, y: 0.1, open: 2 },
  { id: 'bqf', name: '兵器坊', kind: 'forge', x: 0.5, y: 0.235, open: 1 },
  { id: 'upL', name: '上路小粮仓', side: '我方', kind: 'granary', x: 0.3, y: 0.33, open: 1 },
  { id: 'upR', name: '上路小粮仓', side: '敌方', kind: 'granary', x: 0.7, y: 0.33, open: 1 },
  { id: 'aocang', name: '敖仓', kind: 'big', x: 0.385, y: 0.425, open: 3 },
  { id: 'liyang', name: '黎阳', kind: 'big', x: 0.615, y: 0.425, open: 3 },
  { id: 'midL', name: '中路小粮仓', side: '我方', kind: 'granary', x: 0.245, y: 0.54, open: 1 },
  { id: 'midR', name: '中路小粮仓', side: '敌方', kind: 'granary', x: 0.755, y: 0.54, open: 1 },
  { id: 'guandu', name: '官渡', kind: 'fort', x: 0.5, y: 0.545, open: 3 },
  { id: 'pili', name: '霹雳车', kind: 'catapult', x: 0.5, y: 0.7, open: 3 },
  { id: 'lowL', name: '下路小粮仓', side: '我方', kind: 'granary', x: 0.33, y: 0.77, open: 1 },
  { id: 'lowR', name: '下路小粮仓', side: '敌方', kind: 'granary', x: 0.67, y: 0.77, open: 1 },
  { id: 'gjf', name: '工匠坊', kind: 'hammer', x: 0.5, y: 0.885, open: 1 }
]
export const BM = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]))
export const BASE_US = { x: 0.1, y: 0.54 }
export const BASE_THEM = { x: 0.9, y: 0.54 }
export const fullName = (id) => { const b = BM[id]; return b ? (b.side ? b.side + b.name : b.name) : '' }
export const shortName = (id) => { const b = BM[id]; return b ? (b.side ? (b.side === '我方' ? '我·' : '敌·') + b.name.replace('小粮仓', '仓') : b.name) : '' }

export const PHASES = [
  { name: '第一阶段', start: [21, 5], dur: 10, desc: '兵器坊 · 工匠坊 · 6 个小粮仓' },
  { name: '第二阶段', start: [21, 15], dur: 10, desc: '乌巢开放 · 采矿' },
  { name: '第三阶段', start: [21, 25], dur: 20, desc: '官渡 · 大粮仓 · 霹雳车' }
]
const pad = (n) => String(n).padStart(2, '0')
/** 二团是 14:00 场，阶段时间整体往前 7 小时 */
export function phaseTime(legion, k) {
  const p = PHASES[k]
  const h = Number(legion) === 2 ? p.start[0] - 7 : p.start[0]
  const end = p.start[1] + p.dur
  return `${pad(h)}:${pad(p.start[1])}-${pad(h + Math.floor(end / 60))}:${pad(end % 60)}`
}
export const isOpen = (id, phase) => BM[id].open <= phase + 1

/**
 * 重要程度（用户定的）：前期 兵器坊 > 工匠坊 > 乌巢、小粮仓；后期 官渡 > 乌巢 > 大粮仓 > 霹雳车。
 * 1 首要 / 2 重要 / 3 次要 / 0 一般 —— 只用来上色，界面上不写字
 */
export function rankOf(id, phase) {
  const k = BM[id].kind
  if (phase < 2) return id === 'bqf' ? 1 : id === 'gjf' ? 2 : (id === 'wuchao' || k === 'granary') ? 3 : 0
  return id === 'guandu' ? 1 : id === 'wuchao' ? 2 : (k === 'big' || k === 'catapult') ? 3 : 0
}
export const RANK_COLOR = ['#5b6b8c', '#fbbf24', '#7dd3fc', '#a3b1cc']
export const WUCHAO_COLOR = '#fb7185' // 乌巢二阶段起专属
export const BIG_COLOR = '#a3e635' // 大粮仓三阶段专属
export function colorOf(id, phase) {
  if (id === 'wuchao' && phase >= 1) return WUCHAO_COLOR
  if (BM[id].kind === 'big' && phase >= 2) return BIG_COLOR
  return RANK_COLOR[rankOf(id, phase)]
}

export const T456 = ['', '掏人、驻防', '驻防', '挖矿', '炸矿', '采集', '补位']
/** 新建分组依次用的颜色 */
export const GROUP_COLORS = ['#f59e0b', '#a78bfa', '#34d399', '#22d3ee', '#f472b6', '#f87171', '#60a5fa', '#facc15', '#2dd4bf', '#c084fc', '#fb923c', '#94a3b8']

/** 已派任务数 / 应派数（每组三个阶段各一个 1 队目标） */
export function progressOf(plan) {
  if (!plan) return { done: 0, total: 0, missing: [] }
  const total = plan.groups.length * 3
  let done = 0
  const missing = []
  plan.groups.forEach((g) => [0, 1, 2].forEach((k) => {
    if (plan.assign[k] && plan.assign[k][g.id]) done += 1
    else missing.push(`${PHASES[k].name}${g.name}`)
  }))
  return { done, total, missing }
}

/**
 * 导出排表图：照用户原来的 Excel 排表版式画。
 * opts: { alliance: { name, serverNo }, legion, battleText, plan, names: { memberId: 名字 }, subs: [名字], notes: { gid: 要点 }, channel, commander }
 */
export function drawSheet(opts) {
  const { alliance, legion, battleText, plan, names, subs, notes, channel, commander } = opts
  const S = { title: '#2f5597', head: '#4472c4', group: '#2f5597', name: '#b4c6e7', cell: '#dae3f3', line: '#8eaadb', red: '#e0203a', ink: '#1f2329' }
  const legionName = Number(legion) === 1 ? '一团' : '二团'
  const COLS = [110, 150, 330, 330, 330, 340]
  const X = COLS.reduce((a, w) => a.concat(a[a.length - 1] + w), [0])
  const WIDTH = X[X.length - 1]
  const RH = 32, TITLE = 64, HEAD = 58
  const blocks = plan.groups.map((g) => ({ g, rows: Math.max(4, g.members.length) }))
  const HEIGHT = TITLE + HEAD + blocks.reduce((a, b) => a + b.rows, 0) * RH + RH * 2
  const k = 2
  const c = document.createElement('canvas')
  c.width = WIDTH * k; c.height = HEIGHT * k
  const x = c.getContext('2d')
  x.scale(k, k)
  const font = (w, size) => `${w} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const box = (x0, y0, w, h, fill) => { x.fillStyle = fill; x.fillRect(x0, y0, w, h); x.strokeStyle = S.line; x.lineWidth = 1; x.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1) }
  const text = (s, x0, y0, o = {}) => { x.font = font(o.bold ? 700 : 400, o.size || 14); x.fillStyle = o.color || S.ink; x.textAlign = o.align || 'left'; x.textBaseline = 'middle'; x.fillText(s, x0, y0) }
  const wrap = (s, w, size) => {
    x.font = font(400, size); const out = []
    String(s || '').split('\n').forEach((para) => { let line = ''; [...para].forEach((ch) => { if (x.measureText(line + ch).width > w) { out.push(line); line = ch } else line += ch }); out.push(line) })
    return out.filter((l, i) => l || i === 0)
  }
  box(0, 0, WIDTH, TITLE, '#dbe5f7')
  const allianceText = `${alliance.serverNo ? alliance.serverNo + '区' : ''}【${alliance.name || ''}】`
  text(`${allianceText}官渡${legionName}安排表`, WIDTH / 2, 24, { bold: true, size: 20, color: S.title, align: 'center' })
  text(battleText || '', WIDTH / 2, 48, { size: 14, color: '#5b6b8c', align: 'center' })
  if (channel) text(channel, 16, TITLE / 2, { bold: true, size: 15, color: S.title })
  let y = TITLE
  box(X[0], y, COLS[0], HEAD / 2, S.head); text('分组', X[0] + COLS[0] / 2, y + HEAD / 4, { bold: true, color: '#fff', align: 'center' })
  box(X[1], y, COLS[1], HEAD / 2, S.head); text('昵称', X[1] + COLS[1] / 2, y + HEAD / 4, { bold: true, color: '#fff', align: 'center' })
  box(X[0], y + HEAD / 2, COLS[0] + COLS[1], HEAD / 2, S.head)
  text(`主力 ${plan.groups.reduce((a, g) => a + g.members.length, 0)} 人 · 替补 ${subs.length} 人`, X[0] + (COLS[0] + COLS[1]) / 2, y + HEAD * 0.75, { color: '#fff', align: 'center', size: 12 })
  PHASES.forEach((p, i) => {
    box(X[2 + i], y, COLS[2 + i], HEAD, S.head)
    text(`${p.name}  ${phaseTime(legion, i)}`, X[2 + i] + COLS[2 + i] / 2, y + 20, { bold: true, color: '#fff', align: 'center', size: 15 })
    text(p.desc, X[2 + i] + COLS[2 + i] / 2, y + 41, { color: '#e6ecff', align: 'center', size: 12 })
  })
  box(X[5], y, COLS[5], HEAD, S.head); text('官渡要点', X[5] + COLS[5] / 2, y + HEAD / 2, { bold: true, color: '#fff', align: 'center', size: 15 })
  y += HEAD
  blocks.forEach(({ g, rows }) => {
    const h = rows * RH
    box(X[0], y, COLS[0], h, S.group)
    text(g.name, X[0] + COLS[0] / 2, y + h / 2, { bold: true, color: '#fff', align: 'center', size: 15 })
    for (let r = 0; r < rows; r++) {
      const id = g.members[r]
      box(X[1], y + r * RH, COLS[1], RH, S.name)
      if (id) text(names[id] || '', X[1] + COLS[1] / 2, y + r * RH + RH / 2, { align: 'center', bold: r === 0, color: r === 0 ? S.red : S.ink })
    }
    PHASES.forEach((p, i) => {
      box(X[2 + i], y, COLS[2 + i], h, S.cell)
      const a = plan.assign[i][g.id], tk = plan.tasks[i][g.id] || {}
      const lines = [[`1队：${a ? fullName(a) : '待命'}`, a ? S.red : '#8a94a6'], tk.t23 ? [`2/3队：${fullName(tk.t23)}`, S.red] : null, tk.t456 ? [`4/5/6队：${tk.t456}`, S.ink] : null].filter(Boolean)
      const top = y + h / 2 - (lines.length - 1) * 12
      lines.forEach(([s, col], j) => text(s, X[2 + i] + 12, top + j * 24, { color: col, size: 14 }))
    })
    box(X[5], y, COLS[5], h, S.cell)
    const note = wrap(notes[g.id] || '', COLS[5] - 24, 13)
    const top = y + h / 2 - (note.length - 1) * 10
    note.forEach((s, j) => text(s, X[5] + 12, top + j * 20, { size: 13 }))
    y += h
  })
  box(X[0], y, COLS[0], RH, S.head); text('替补', X[0] + COLS[0] / 2, y + RH / 2, { bold: true, color: '#fff', align: 'center' })
  box(X[1], y, WIDTH - X[1], RH, S.cell)
  text(subs.join('、') || '无', X[1] + 12, y + RH / 2, { size: 14 })
  y += RH
  box(0, y, WIDTH, RH, S.head)
  // 指挥后面固定跟一句「所有调度以实时战况为准」
  const cmd = commander ? `${commander}，所有调度以实时战况为准` : '所有调度以实时战况为准'
  text([cmd, channel].filter(Boolean).join('　　'), WIDTH - 20, y + RH / 2, { color: '#fff', align: 'right', bold: true })
  text('三冰小帮手 · 官渡排表', 20, y + RH / 2, { color: '#dbe5f7', size: 12 })
  return c
}

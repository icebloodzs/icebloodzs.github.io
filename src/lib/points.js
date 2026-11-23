/** 积分考勤的显示小工具（算分在云函数 lib/points.js，这边不算） */

export const fmtPts = (p) => (p == null ? '—' : p > 0 ? '+' + p : p < 0 ? '−' + -p : '0')
export const ptsColor = (p) => (p > 0 ? '#18a058' : p < 0 ? '#e0203a' : '#8a9099')
export const ATT_TEXT = { 0: '到场', 1: '请假', 2: '缺席' }
export const TYPE = { check: '勾选', rank: '排名', choice: '状态', manual: '手填' }
export const BY = { self: '本人填', leader: '组长/管理员填', admin: '只管理员填' }
export const SRC = { self: '本人', leader: '组长', admin: '管理员', auto: '截止未填·自动缺席' }

/** 11/23 20:30 */
export function dlText(t) {
  if (!t) return ''
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 一项规则的一句话：勾选 +1 / 每次 +1 / 前30名 +2，31-60名 +1 / 请假 −1，缺席 −2 / 手填分值 */
export function ruleText(it) {
  if (it.type === 'check') return (it.multi ? '每次 ' : '勾选 ') + fmtPts(it.pts)
  if (it.type === 'rank') return it.tiers.map((t, i) => (i ? it.tiers[i - 1].n + 1 + '-' + t.n : '前' + t.n) + '名 ' + fmtPts(t.pts)).join('，')
  if (it.type === 'choice') return (it.multi ? '每次 ' : '') + it.options.filter((o) => o.pts).map((o) => o.label + ' ' + fmtPts(o.pts)).join('，')
  return '手填分值'
}

/** 状态类可多次的值 → 「全套大药×2、无×1」 */
export function multiText(it, v) {
  const t = []
  for (const [k, c] of Object.entries(v || {})) if (c > 0 && it.options[k]) t.push(it.options[k].label + '×' + c)
  return t.join('、') || '无'
}

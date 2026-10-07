/** 数字和时间的显示规则，和小程序那边保持一致 */

/** 1.01亿 / 7023万 */
export function big(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e4) + '万'
  return String(n)
}

export function num(v, digits = 0) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return isFinite(n) ? n.toFixed(digits) : '—'
}

/** 2026-10-05 00:48 */
export function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 多久没更新了，顺带给个颜色：三天内绿、三到七天黄、七天以上红 */
export function ago(iso) {
  if (!iso) return { text: '从未', type: 'error' }
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return {
    text: d <= 0 ? '今天' : d + '天',
    type: d >= 7 ? 'error' : d >= 3 ? 'warning' : 'success'
  }
}

/**
 * 排序用。没填的一律当**最小**。
 *
 * 原来是把空值固定返回「排最后」，想让它不管升降序都垫底 —— 但 naive-ui 是拿
 * sorter 的结果直接取反来做降序的，于是一按降序，没填的全翻到了最上面。
 * 排行榜默认都是降序看最高的几个，空值堆在头上最难受，所以改成「空=最小」：
 * 降序时沉底（要的就是这个），升序时在最前面，两个方向都说得通。
 */
export function cmp(a, b) {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an && bn) return 0
  if (an) return -1
  if (bn) return 1
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b), 'zh')
  return a - b
}

/** naive-ui 的 sorter */
export const sorter = (get) => (rowA, rowB) => cmp(get(rowA), get(rowB))

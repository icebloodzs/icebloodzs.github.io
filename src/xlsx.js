/** 导出 Excel：表格交给云函数生成（带表头配色），回来的 base64 转成文件下载 */
import { call } from './api'

export function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** 中文按两个字符宽算，列宽才不至于挤成一团 */
function visual(s) {
  let n = 0
  String(s).split('').forEach((c) => { n += c.charCodeAt(0) > 255 ? 2 : 1 })
  return n
}

/**
 * 表格配色跟浏览器版走：紫色表头、浅紫隔行底色、淡紫细边框；
 * 第一列（名字）靠左加粗，数字靠右，其余居中；表头带筛选下拉。
 */
const PURPLE = '6C5CE7'
const EXCEL_STYLES = [
  { fill: PURPLE, color: 'FFFFFF', bold: true, size: 11, line: '5A4BD6' }, // 0 表头
  ...['FFFFFF', 'F5F3FF'].flatMap((fill) => [
    { fill, color: '2B2F36', size: 11, line: 'E4E0F7' }, // 文本居中
    { fill, color: '2B2F36', size: 11, line: 'E4E0F7', bold: true, align: 'left' }, // 第一列
    { fill, color: '2B2F36', size: 11, line: 'E4E0F7', align: 'right' } // 数字
  ])
]

export async function buildExcel({ aoa, sheetName, name }) {
  // 列宽看表头和内容里最长的那个，封顶 40
  const cols = aoa[0].map((_, c) => ({ wch: Math.min(40, Math.max(8, ...aoa.map((r) => visual(r[c] ?? '') + 4))) }))
  const cellStyles = aoa.map((row, r) => (r === 0
    ? row.map(() => 0)
    : row.map((v, c) => 1 + (r % 2 === 0 ? 3 : 0) + (c === 0 ? 1 : typeof v === 'number' ? 2 : 0))))
  const res = await call('files.buildExcel', {
    aoa,
    cols,
    rows: aoa.map((_, r) => ({ hpt: r === 0 ? 26 : 20 })),
    styles: EXCEL_STYLES,
    cellStyles,
    autoFilter: true,
    sheetName: sheetName || 'Sheet1'
  })
  const bin = atob(res.base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i)
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
}

/** 用现成的样式表直接出（集结分配那套带颜色的） */
export async function buildStyledExcel(sheet, sheetName, name) {
  const res = await call('files.buildExcel', { ...sheet, sheetName })
  const bin = atob(res.base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i)
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
}

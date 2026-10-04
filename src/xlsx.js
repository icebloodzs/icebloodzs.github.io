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

export async function buildExcel({ aoa, sheetName, name }) {
  const res = await call('files.buildExcel', {
    aoa,
    cols: aoa[0].map((t) => ({ wch: Math.max(8, visual(t) + 4) })),
    styles: [
      { fill: '6C5CE7', color: 'FFFFFF', bold: true, size: 11 },
      { color: '222222', size: 11 }
    ],
    cellStyles: [aoa[0].map(() => 0)].concat(aoa.slice(1).map((r) => r.map(() => 1))),
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

/**
 * 在浏览器里读 Excel：每个工作表转成二维数组（aoa），一张一张发给云函数。
 *
 * 不把整个文件传上去：云开发 HTTP 网关的请求体上限大约 100KB，一本十来天的源数据表就超了。
 * 一张表一百来人只有几 KB。xlsx 这个库不小，只在真要读文件时才加载。
 */
export async function readWorkbook(file) {
  const XLSX = await import('xlsx')
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return book.SheetNames.map((name) => ({
    sheet: name,
    aoa: trim(XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true }))
  }))
}

/** 去掉尾部的空行空列，省点流量 */
function trim(aoa) {
  const blank = (v) => v === '' || v === null || v === undefined
  const rows = aoa.filter((r) => Array.isArray(r) && r.some((v) => !blank(v)))
  let width = 0
  rows.forEach((r) => {
    for (let i = r.length - 1; i >= 0; i -= 1) {
      if (!blank(r[i])) {
        width = Math.max(width, i + 1)
        break
      }
    }
  })
  return rows.map((r) => r.slice(0, width))
}

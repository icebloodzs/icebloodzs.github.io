import fs from 'node:fs'
import crypto from 'node:crypto'

/**
 * 给开发者后台的静态资源打版本戳。
 *
 * /dev/ 是不走构建的纯静态页，文件名固定，浏览器会一直用缓存里那份 ——
 * 实测改完 app.js 传上去，页面还是老的，因为 index.html 里写死的是 `?v=1`。
 * 所以这里按文件内容算个短哈希写进去：内容没变戳就不变，变了就自动换，
 * 既能破缓存又不会每次构建都产生无谓的改动。
 */
const DIR = 'public/dev'
const files = ['app.js', 'style.css']

const hash = crypto
  .createHash('sha256')
  .update(files.map((f) => fs.readFileSync(`${DIR}/${f}`)).join('\n'))
  .digest('hex')
  .slice(0, 8)

const page = `${DIR}/index.html`
const before = fs.readFileSync(page, 'utf8')
const after = before.replace(/(app\.js|style\.css)\?v=[^"']*/g, (_, name) => `${name}?v=${hash}`)

if (before !== after) {
  fs.writeFileSync(page, after)
  console.log(`  dev/ 版本戳 → ${hash}（已更新 index.html）`)
} else {
  console.log(`  dev/ 版本戳 → ${hash}（没变）`)
}

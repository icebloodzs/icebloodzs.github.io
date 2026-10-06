// 把每个视图单独 SSR 渲染一遍：只要模板/脚本里有引用错误就会直接抛出来，
// 比打包能多抓一层（打包不执行代码）。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://icebloodzs.github.io/' })
for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CSS', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'Image', 'SVGElement', 'HTMLImageElement', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'location', 'history', 'localStorage']) {
  if (dom.window[k] !== undefined) globalThis[k] = dom.window[k]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  ssr: { noExternal: [/naive-ui/, /vooks/, /vueuc/, /seemly/, /treemate/, /css-render/, /evtd/, /@css-render/, /date-fns/, /highlight\.js/, /async-validator/] }
})

const ui = await vite.ssrLoadModule('naive-ui')
const naive = ui.default ?? ui

const MEMBERS = [
  { _id: 'a', name: '测试甲', maxBonus: 128.5, maxMarch: 230000, attrsSum: 5310.88, attrsUpdatedAt: '2026-10-01T10:00:00.000Z',
    troopsByLevel: { 3: { inf: 173, cav: 42, arc: 80 }, 2: { inf: 10, cav: null, arc: 5 } },
    attrs: { atk: 905.58, def: 1050.41 }, heroPower: 61000000, boundAt: '2026-09-01T00:00:00.000Z' },
  { _id: 'b', name: '测试乙', maxBonus: null, maxMarch: null, attrsSum: null, attrsUpdatedAt: null, troopsByLevel: null }
]
const app = {
  me: ref({ role: 'super', memberId: 'a', nickname: '我', member: MEMBERS[0] }),
  members: ref(MEMBERS),
  season: ref({
    key: 'S6', label: 'S6', limits: [],
    topTier: '3', topTierLabel: '宫3',
    tiers: [{ key: '2', label: '宫2' }, { key: '3', label: '宫3' }]
  }),
  loginBy: () => {}, reload: async () => {}, refreshMe: async () => {}, refreshNotices: async () => {}
}

const views = ['Mine', 'Roster', 'ImportList', 'Bonus', 'Attrs', 'Missing', 'Season', 'Rally', 'Placement', 'Shape', 'Users', 'Notice', 'Board', 'Login']
let bad = 0
for (const v of views) {
  try {
    const mod = await vite.ssrLoadModule(`/src/views/${v}.vue`)
    const root = createSSRApp({
      setup: () => () =>
        h(ui.NLoadingBarProvider, null, { default: () =>
          h(ui.NMessageProvider, null, { default: () =>
            h(ui.NDialogProvider, null, { default: () => h(mod.default) }) }) })
    })
    root.use(naive)
    root.provide('app', app)
    const html = await renderToString(root)
    console.log(`  ok   ${v}  ${html.length} 字节`)
    if (v === 'Bonus') {
      // 最高 + 次高两档排一行；没填的那档写「-」
      if (!html.includes('兵力（宫3 / 宫2）')) { bad++; console.log('  !!   Bonus 的兵力列标题不对') }
      if (!html.includes('步173 骑42 弓80')) { bad++; console.log('  !!   Bonus 没把三个兵种写全') }
      if (!html.includes('步10 骑- 弓5')) { bad++; console.log('  !!   Bonus 没把没填的兵种写成 -') }
    }
    if (v === 'Mine') {
      ;['宫3/宫2', '本赛季最高', '宫2', '宫3'].forEach((w) => {
        if (!html.includes(w)) { bad++; console.log(`  !!   Mine 缺少 ${w}`) }
      })
    }
  } catch (e) {
    bad++
    console.log(`  FAIL ${v}: ${e.stack}`)
  }
}

// App.vue：顶栏固定（header 和内容区都是 absolute，内容区从 64px 开始）
const src = fs.readFileSync('src/App.vue', 'utf8')
const checks = [
  ['header absolute', /<n-layout-header[^>]*position="absolute"/],
  ['内容区 absolute', /<n-layout\s+class="body"[\s\S]*?position="absolute"/],
  ['内容区从 64px 开始', /style="top: 64px"/],
  ['内容区自己滚', /class="body"[\s\S]*?:native-scrollbar="false"/]
]
checks.forEach(([n, re]) => { if (!re.test(src)) { bad++; console.log(`  !!   App.vue: ${n} 没通过`) } else console.log(`  ok   App.vue ${n}`) })

// 换个赛季再渲一遍：档位必须跟着赛季走，不能写死宫2宫3
app.season.value = { key: 'S9', label: 'S9', limits: [], topTier: '4', topTierLabel: '宫4', tiers: [{ key: '3', label: '宫3' }, { key: '4', label: '宫4' }] }
for (const [v, want, deny] of [['Bonus', ['兵力（宫4 / 宫3）'], []], ['Mine', ['宫4/宫3', '宫4'], []]]) {
  const mod = await vite.ssrLoadModule(`/src/views/${v}.vue`)
  const root = createSSRApp({
    setup: () => () => h(ui.NLoadingBarProvider, null, { default: () =>
      h(ui.NMessageProvider, null, { default: () =>
        h(ui.NDialogProvider, null, { default: () => h(mod.default) }) }) })
  })
  root.use(naive)
  root.provide('app', app)
  const html = await renderToString(root)
  want.forEach((w) => { if (!html.includes(w)) { bad++; console.log(`  !!   S9 的 ${v} 缺少 ${w}`) } })
  deny.forEach((w) => { if (html.includes(w)) { bad++; console.log(`  !!   S9 的 ${v} 不该出现 ${w}`) } })
  if (!want.some((w) => !html.includes(w))) console.log(`  ok   ${v} 换到 S9 后档位跟着变`)
}

// 列表页靠 .page 的固定高度把高度一层层传给表格，中间夹一个 n-space 就断了
// （n-space 给每个子项包一层高度自适应的 div，表格会变成 0 高，整张表看不见）
for (const v of ['Roster', 'Bonus', 'Attrs', 'Missing', 'Season', 'Users']) {
  const src = fs.readFileSync(`src/views/${v}.vue`, 'utf8')
  const i = src.indexOf('<div class="page">')
  const j = src.indexOf('<TableCard')
  if (i < 0 || j < 0) { bad++; console.log(`  !!   ${v}.vue 没有 .page 外壳`); continue }
  const span = src.slice(i, j)
  if ((span.match(/<n-space/g) || []).length > (span.match(/<\/n-space>/g) || []).length) {
    bad++
    console.log(`  !!   ${v}.vue 的 TableCard 被 n-space 包住了，表格会撑不开`)
  } else {
    console.log(`  ok   ${v}.vue 的表格能拿到高度`)
  }
}

// /dev/ 不走构建，缓存全靠 index.html 里的 ?v= 戳；戳和文件内容对不上就是忘了跑 build
{
  const crypto = await import('node:crypto')
  const want = crypto
    .createHash('sha256')
    .update(['app.js', 'style.css'].map((f) => fs.readFileSync(`public/dev/${f}`)).join('\n'))
    .digest('hex')
    .slice(0, 8)
  const html = fs.readFileSync('public/dev/index.html', 'utf8')
  if (html.includes(`?v=${want}`)) console.log('  ok   dev/ 的缓存版本戳是最新的')
  else { bad++; console.log(`  !!   dev/ 的版本戳过期了，跑一下 npm run stamp（应该是 ${want}）`) }
}

// probe/Shell.vue 是从 App.vue 抠出来的布局副本，App.vue 改了布局它必须跟着改，
// 不然截图自检看的就不是真页面了
const shell = fs.readFileSync('probe/Shell.vue', 'utf8')
;['class="right"', 'position="absolute"', 'style="top: 64px"', '--page-h'].forEach((m) => {
  if (!shell.includes(m)) { bad++; console.log(`  !!   probe/Shell.vue 和 App.vue 不一致，缺 ${m}，请重新生成`) }
})
console.log('  ok   probe/Shell.vue 与 App.vue 布局一致')

await vite.close()
console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)

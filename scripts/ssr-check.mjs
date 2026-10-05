// 把每个视图单独 SSR 渲染一遍：只要模板/脚本里有引用错误就会直接抛出来，
// 比打包能多抓一层（打包不执行代码）。
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
  season: ref({ key: 'S6', label: 'S6', limits: [] }),
  loginBy: () => {}, reload: async () => {}, refreshMe: async () => {}
}

const views = ['Mine', 'Roster', 'ImportList', 'Bonus', 'Attrs', 'Missing', 'Season', 'Rally', 'Placement', 'Users', 'Login']
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
      const want = ['兵力（宫3 / 宫2）', 'bn-l', 'bn-lv']
      want.forEach((w) => { if (!html.includes(w)) { bad++; console.log(`  !!   Bonus 缺少 ${w}`) } })
      if (/宫3\s*兵力|宫2\s*兵力/.test(html)) { bad++; console.log('  !!   Bonus 还留着两列') }
    }
    if (v === 'Mine') {
      ;['三级兵营带的兵', '二级兵营带的兵', '留空', 'lvh'].forEach((w) => {
        if (!html.includes(w)) { bad++; console.log(`  !!   Mine 缺少 ${w}`) }
      })
    }
  } catch (e) {
    bad++
    console.log(`  FAIL ${v}: ${e.stack}`)
  }
}

// App.vue：顶栏固定（header 和内容区都是 absolute，内容区从 64px 开始）
const src = (await import('node:fs')).readFileSync('src/App.vue', 'utf8')
const checks = [
  ['header absolute', /<n-layout-header[^>]*position="absolute"/],
  ['内容区 absolute', /<n-layout\s+class="body"[\s\S]*?position="absolute"/],
  ['内容区从 64px 开始', /style="top: 64px"/],
  ['内容区自己滚', /class="body"[\s\S]*?:native-scrollbar="false"/]
]
checks.forEach(([n, re]) => { if (!re.test(src)) { bad++; console.log(`  !!   App.vue: ${n} 没通过`) } else console.log(`  ok   App.vue ${n}`) })

await vite.close()
console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)

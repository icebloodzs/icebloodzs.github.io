// 本地截图自检：积分考勤 / 同盟分组页，接口转到本机假后端（scratch fake_server.js）。不提交。
import { createApp, h, ref } from 'vue'
import naive, { NConfigProvider, NLoadingBarProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { API } from '../../src/api'
import Points from '../../src/views/Points.vue'
import Groups from '../../src/views/Groups.vue'
const _fetch = window.fetch
window.fetch = (url, opt) => {
  if (url === API) {
    const b = JSON.parse(opt.body); b.token = new URLSearchParams(location.search).get('as') || 'admin'
    return _fetch('http://localhost:5298/', { ...opt, body: JSON.stringify(b) })
  }
  return _fetch(url, opt)
}
const members = ref([])
const view = location.hash.replace('#', '') || 'points'
const themeOverrides = { common: { primaryColor: '#6c5ce7', primaryColorHover: '#8b7cf0', primaryColorPressed: '#5a4bd1', primaryColorSuppl: '#8b7cf0', borderRadius: '8px' } }
const app = createApp({
  setup() {
    return () => h(NConfigProvider, { themeOverrides }, { default: () => h(NLoadingBarProvider, null, { default: () => h(NMessageProvider, null, { default: () => h(NDialogProvider, null, { default: () =>
      h('div', { style: 'padding:24px;background:#f5f6fa;min-height:100vh;box-sizing:border-box;--page-h:calc(100vh - 48px)' }, [h(view === 'groups' ? Groups : Points)]) }) }) }) })
  }
})
app.provide('app', { me: ref({ role: 'admin', webScope: 'full' }), members, narrow: ref(false), ally: ref({}), season: ref(null), attrKeys: ref([]), can: () => true })
app.use(naive).mount('#app')
window.__app = app
// ?steps=css1|css2|text:按钮文字 —— 依次点击，每步隔 900ms（截图自检用）
const steps = (new URLSearchParams(location.search).get('steps') || '').split('|').filter(Boolean)
let k = 0
function next() {
  if (k >= steps.length) return
  const st = steps[k++]
  let el = null
  if (st.startsWith('text:')) { const t = st.slice(5); el = [...document.querySelectorAll('button,a,span,div,.n-tabs-tab')].reverse().find((e) => e.children.length <= 2 && e.textContent.trim() === t) }
  else el = document.querySelector(st)
  if (el) el.click(); else console.warn('no step', st)
  setTimeout(next, 900)
}
setTimeout(next, 1500)

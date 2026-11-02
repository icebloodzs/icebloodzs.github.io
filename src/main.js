import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'
import './style.css'

/*
 * 发了新版之后，之前就开着的页面再去按需加载（导入 Excel 时的表格库等）会拿到已经被换掉的旧文件，
 * 报「Unable to preload CSS / Failed to fetch dynamically imported module」。这时直接刷新一次换成新版；
 * 10 秒内只刷一次，免得文件真坏了一直刷。
 */
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('sanbing_reload_at') || 0)
    if (Date.now() - last < 10000) return
    sessionStorage.setItem('sanbing_reload_at', String(Date.now()))
  } catch (err) {
    // 存不了就不防连刷了，照样刷新
  }
  e.preventDefault()
  location.reload()
})

// 组件不多，全量注册省得一个个 import，漏一个就是运行时报错
createApp(App).use(naive).mount('#app')

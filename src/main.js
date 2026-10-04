import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'
import './style.css'

// 组件不多，全量注册省得一个个 import，漏一个就是运行时报错
createApp(App).use(naive).mount('#app')

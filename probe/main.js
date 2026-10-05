import { createApp, h } from 'vue'
import naive, { NConfigProvider, NLoadingBarProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import Shell from './Shell.vue'

const themeOverrides = { common: { primaryColor: '#6c5ce7', primaryColorHover: '#8b7cf0', primaryColorPressed: '#5a4bd1', primaryColorSuppl: '#8b7cf0' } }
createApp({
  render: () => h(NConfigProvider, { themeOverrides }, { default: () =>
    h(NLoadingBarProvider, null, { default: () =>
      h(NMessageProvider, null, { default: () =>
        h(NDialogProvider, null, { default: () => h(Shell) }) }) }) })
}).use(naive).mount('#app')

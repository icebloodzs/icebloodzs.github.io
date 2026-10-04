import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 仓库是 icebloodzs.github.io（用户站点），发布在根路径，base 用 '/'
export default defineConfig({
  plugins: [vue()],
  base: '/',
  build: {
    outDir: 'dist',
    // 一个站就这么点东西，不拆太碎
    chunkSizeWarningLimit: 1500
  }
})

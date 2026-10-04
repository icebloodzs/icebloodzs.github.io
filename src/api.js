/**
 * 和云函数说话的地方。
 *
 * 浏览器没有微信身份，靠「电脑出码、小程序扫码」换来的 token 认人，
 * 每个请求都把它带上。token 存哪儿见 store：localStorage 优先，被禁了退回 cookie。
 */
import { ref } from 'vue'

export const API = 'https://cloud1-d4gobc9ws5134943d-1483434711.ap-shanghai.app.tcloudbase.com/api'
const TOKEN_KEY = 'sanbing_web_token'

export const store = {
  how: 'none',
  read() {
    try {
      const v = localStorage.getItem(TOKEN_KEY)
      if (v) {
        this.how = 'local'
        return v
      }
    } catch (e) { /* 浏览器禁了本地存储，走 cookie */ }
    const m = String(document.cookie || '').match(new RegExp('(?:^|; )' + TOKEN_KEY + '=([^;]*)'))
    if (m) {
      this.how = 'cookie'
      return decodeURIComponent(m[1])
    }
    return ''
  },
  write(v) {
    try {
      localStorage.setItem(TOKEN_KEY, v)
      // 写完回读一次：有的浏览器 setItem 不报错但读不回来
      if (localStorage.getItem(TOKEN_KEY) === v) {
        this.how = 'local'
        return true
      }
    } catch (e) { /* 继续试 cookie */ }
    try {
      document.cookie = `${TOKEN_KEY}=${encodeURIComponent(v)}; max-age=604800; path=/; samesite=lax`
      if (String(document.cookie || '').includes(TOKEN_KEY + '=')) {
        this.how = 'cookie'
        return true
      }
    } catch (e) { /* 两个都不行，只留内存 */ }
    this.how = 'none'
    return false
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY) } catch (e) { /* 忽略 */ }
    try { document.cookie = `${TOKEN_KEY}=; max-age=0; path=/` } catch (e) { /* 忽略 */ }
  }
}

export const token = ref(store.read())
/** 还有几个请求在飞，用来显示顶部那条进度 */
export const inflight = ref(0)

export async function call(action, data = {}) {
  inflight.value += 1
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, data, token: token.value })
    })
    const body = await r.json()
    if (!body || body.code !== 0) {
      const err = new Error((body && body.message) || '请求失败')
      err.errCode = body && body.errCode
      throw err
    }
    return body.data
  } finally {
    inflight.value = Math.max(0, inflight.value - 1)
  }
}

export function setToken(v) {
  token.value = v || ''
  if (v) return store.write(v)
  store.clear()
  return true
}

/** 这种错是「登录态确实不能用了」，要清掉重扫 */
export function fatal(msg) {
  const e = new Error(msg)
  e.fatal = true
  return e
}

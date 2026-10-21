<script setup>
/**
 * 两种登法：
 *   扫码 —— 这边出票据画二维码，用小程序扫完确认，这边轮询拿 token。
 *            个人主体没有开放平台网站应用，做不了「微信扫一扫登网页」，所以反着来。
 *   登录 ID —— 给用不了小程序扫码的人（手机浏览器、平板）：ID 在小程序首页复制，
 *            进来只有「我的信息」「我的属性」。
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { call } from '../api'
import QRCode from 'qrcode'

const props = defineProps({ tip: String, why: String, retry: Boolean })
const emit = defineEmits(['done', 'retry'])

/** 横着排，只留短标题；展开的说明放下面一行 */
const STEPS = ['微信打开小程序', '扫码并确认', '自动进入']

const qr = ref('')
const state = ref('loading')
const msg = ref('')
let timer = null
let dieAt = 0

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
}

/**
 * 轮询间隔：刚出码的半分钟里 1.5 秒问一次（扫得快的人不用等），之后放慢到 3 秒；
 * 网页切到后台（看不见）时只 10 秒问一次。每问一次都是一次云函数调用，开着不管的登录页最费额度。
 */
let bornAt = 0
/** 正在等的那张票：换了新码之后，旧码那条还在路上的轮询回来就不再续了 */
let liveTicket = ''
function nextDelay() {
  if (typeof document !== 'undefined' && document.hidden) return 10000
  return Date.now() - bornAt < 30000 ? 1500 : 3000
}
function schedule(ticket) {
  timer = setTimeout(async () => {
    await poll(ticket)
    if (timer && ticket === liveTicket) schedule(ticket)
  }, nextDelay())
}

async function newTicket() {
  stop()
  state.value = 'loading'
  msg.value = ''
  try {
    const res = await call('web.ticketCreate')
    qr.value = await QRCode.toDataURL(res.ticket, { width: 440, margin: 1 })
    state.value = 'ready'
    dieAt = Date.now() + res.expiresIn * 1000
    bornAt = Date.now()
    liveTicket = res.ticket
    timer = -1
    schedule(res.ticket)
  } catch (e) {
    state.value = 'error'
    msg.value = e.message
  }
}

async function poll(ticket) {
  if (Date.now() > dieAt) {
    stop()
    state.value = 'expired'
    return
  }
  try {
    const res = await call('web.ticketPoll', { ticket })
    if (res.status === 'expired') {
      stop()
      state.value = 'expired'
    } else if (res.status === 'confirmed') {
      stop()
      emit('done', res.token)
    }
  } catch (e) { /* 轮询失败就等下一次 */ }
}

const mode = ref('scan')
const keyText = ref('')
const keyBusy = ref(false)
const keyMsg = ref('')

/** 切到登录 ID 就别再轮询了，切回来重新出码 */
watch(mode, (m) => {
  if (m === 'key') stop()
  else newTicket()
})

async function keyLogin() {
  const key = keyText.value.trim()
  if (!key) {
    keyMsg.value = '先把登录 ID 粘进来'
    return
  }
  keyBusy.value = true
  keyMsg.value = ''
  try {
    const res = await call('web.keyLogin', { key })
    emit('done', res.token)
  } catch (e) {
    keyMsg.value = e.message
  } finally {
    keyBusy.value = false
  }
}

onMounted(() => { if (!props.retry) newTicket() })
onUnmounted(stop)
watch(() => props.retry, (v) => { if (!v && mode.value === 'scan') newTicket() })
</script>

<template>
  <div class="login">
    <n-card class="box">
      <img class="logo" src="/logo.png" alt="三冰小帮手" />
      <h1>同盟管理 · 浏览器版</h1>
      <div class="sub">手机、电脑、平板都能用，和小程序同一份数据</div>

      <n-tabs v-model:value="mode" type="segment" size="small" style="margin-bottom: 18px">
        <n-tab name="scan">小程序扫码</n-tab>
        <n-tab name="key">登录 ID</n-tab>
      </n-tabs>

      <template v-if="mode === 'key'">
        <n-input
          v-model:value="keyText"
          size="large"
          placeholder="粘贴登录 ID，如 ABCD EFGH JKLM"
          clearable
          @keyup.enter="keyLogin"
        />
        <n-button type="primary" block size="large" :loading="keyBusy" style="margin-top: 12px" @click="keyLogin">登录</n-button>
        <div v-if="keyMsg" class="key-err">{{ keyMsg }}</div>
        <div class="hint">
          登录 ID 在小程序<b>首页 →「浏览器版」</b>里，点「复制」。<br />
          用 ID 登录只有「我的信息」「我的属性」。<br />
          开发版的管理员要用管理功能，请改用小程序扫码。
        </div>
      </template>

      <template v-else>
      <div class="qr">
        <n-spin v-if="state === 'loading'" size="large" />
        <img v-else-if="state === 'ready'" :src="qr" alt="登录二维码" />
        <div v-else class="qr-mask">
          <n-button v-if="retry" type="primary" @click="emit('retry')">重试</n-button>
          <template v-else>
            <div>{{ state === 'expired' ? '二维码过期了' : (msg || '生成失败') }}</div>
            <n-button size="small" style="margin-top: 10px" @click="newTicket">刷新二维码</n-button>
          </template>
        </div>
      </div>

      <div class="steps">
        <div v-for="(t, i) in STEPS" :key="i" class="step">
          <span class="no">{{ i + 1 }}</span>
          <div class="st">{{ t }}</div>
        </div>
      </div>
      <div class="hint">小程序首页或「管理」页 →「浏览器版」→ 扫码 · 七天内不用再扫</div>
      </template>

      <n-alert v-if="tip" :type="retry ? 'warning' : 'info'" :bordered="false" style="margin-top: 14px">
        {{ tip }}
        <div v-if="why" class="why">{{ why }}</div>
      </n-alert>
      <div class="foot">
        <n-button v-if="mode === 'scan' && state === 'ready'" tertiary round size="small" class="rf" @click="newTicket">
          <span class="rf-i">↻</span> 换一个二维码
        </n-button>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, #7b6ef0 0%, #6c5ce7 55%, #5a4bd1 100%);
}
.box {
  /* 手机上留点边，别贴满屏 */
  width: min(372px, calc(100vw - 32px));
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(40, 24, 100, 0.28);
}
/* 图案本身四周没留白，这里靠外边距撑开 */
.logo { display: block; width: 196px; height: auto; margin: 2px auto 14px; }
/* logo 上已经有「三冰小帮手」，标题缩一号，只说明这一页是干什么的 */
h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; text-align: center; color: #4b5563; }
.sub { color: #8a9099; font-size: 12px; text-align: center; margin-bottom: 20px; }

.qr {
  width: 200px;
  height: 200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #efeff5;
  border-radius: 12px;
  overflow: hidden;
}
.qr img { width: 198px; height: 198px; display: block; }
.qr-mask {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #fafafc;
  color: #8a9099;
  font-size: 13px;
}

.steps {
  display: flex;
  margin: 22px 0 0;
}
.step {
  flex: 1;
  position: relative;
  text-align: center;
}
/* 两点之间连一条细线，线压在圆点下面 */
.step + .step::before {
  content: '';
  position: absolute;
  left: -50%;
  top: 11px;
  width: 100%;
  height: 1px;
  background: #eceaf5;
}
.no {
  position: relative;
  z-index: 1;
  display: inline-block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #efeafe;
  color: #6c5ce7;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}
.st { margin-top: 7px; font-size: 12px; color: #4b5563; white-space: nowrap; }
.hint { margin-top: 12px; font-size: 12px; color: #9aa0a6; text-align: center; line-height: 1.7; }
.foot { margin-top: 16px; text-align: center; }
.rf-i { display: inline-block; margin-right: 2px; font-size: 13px; }
.rf:hover .rf-i { transform: rotate(180deg); transition: transform 0.35s ease; }
.key-err { margin-top: 10px; color: #d03050; font-size: 13px; text-align: center; }
.why { margin-top: 6px; font-size: 11px; opacity: 0.75; word-break: break-all; }
</style>

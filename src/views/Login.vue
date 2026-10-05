<script setup>
/**
 * 扫码登录：这边出票据画二维码，管理员用小程序扫完确认，这边轮询拿 token。
 * 个人主体没有开放平台网站应用，做不了「微信扫一扫登网页」，所以反着来。
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
  if (timer) clearInterval(timer)
  timer = null
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
    timer = setInterval(() => poll(res.ticket), 1500)
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

onMounted(() => { if (!props.retry) newTicket() })
onUnmounted(stop)
watch(() => props.retry, (v) => { if (!v) newTicket() })
</script>

<template>
  <div class="login">
    <n-card class="box">
      <h1>同盟管理 · 电脑版</h1>
      <div class="sub">宽屏看统计，和小程序同一份数据</div>

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
      <div class="hint">小程序里走「管理 → 登录电脑版」· 登录后七天内不用再扫</div>

      <n-alert v-if="tip" :type="retry ? 'warning' : 'info'" :bordered="false" style="margin-top: 14px">
        {{ tip }}
        <div v-if="why" class="why">{{ why }}</div>
      </n-alert>
      <div class="foot">
        <n-button v-if="state === 'ready'" tertiary round size="small" class="rf" @click="newTicket">
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
  width: 372px;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(40, 24, 100, 0.28);
}
h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; text-align: center; }
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
.why { margin-top: 6px; font-size: 11px; opacity: 0.75; word-break: break-all; }
</style>

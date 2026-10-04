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

      <n-steps vertical size="small" :current="0" class="steps">
        <n-step title="打开小程序" description="管理 → 登录电脑版" />
        <n-step title="扫上面这个码" description="点确认" />
        <n-step title="自动进入" description="七天内不用再扫" />
      </n-steps>

      <n-alert v-if="tip" :type="retry ? 'warning' : 'info'" :bordered="false" style="margin-top: 14px">
        {{ tip }}
        <div v-if="why" class="why">{{ why }}</div>
      </n-alert>
      <n-button v-if="state === 'ready'" quaternary size="small" style="margin-top: 12px" @click="newTicket">
        刷新二维码
      </n-button>
    </n-card>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8b7cf0, #6c5ce7);
}
.box { width: 400px; text-align: center; border-radius: 18px; }
h1 { margin: 0 0 4px; font-size: 22px; }
.sub { color: #8a9099; font-size: 13px; margin-bottom: 22px; }
.qr {
  width: 220px;
  height: 220px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr img { width: 220px; height: 220px; }
.qr-mask {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f1f2f6;
  border-radius: 12px;
  color: #8a9099;
  font-size: 13px;
}
.steps { margin-top: 22px; text-align: left; }
.why { margin-top: 6px; font-size: 11px; opacity: 0.75; word-break: break-all; }
</style>

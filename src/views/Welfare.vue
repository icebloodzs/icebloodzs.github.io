<script setup>
/**
 * 同盟福利 · 宝藏采集：点「开始采集」→ 采集端（开发者那边）打开游戏 → 没登录就在这里显示登录码等扫 →
 * 进游戏扫一轮 → 结果传到本盟小程序的「同盟福利」里。这一页不显示宝藏，只管发起和看进度。
 *
 * 登录信息保存在采集端：登录过一次，下次直接「一键发布」不用再扫码；「换账号」会清掉重新出码。
 * 任务状态在云端（collect.*），这边只在任务跑着的时候轮询。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'

const message = useMessage()
const dialog = useDialog()

const loading = ref(true)
const busy = ref(false)
const task = ref({ status: 'idle' })
const hasLogin = ref(false)
const runnerOnline = ref(false)
/** 今天还能采几次；null = 不限（开发者自己的盟） */
const left = ref(null)
const limit = ref(2)
let timer = null

const ACTIVE = ['queued', 'starting', 'qr', 'entering', 'scanning']
const active = computed(() => ACTIVE.includes(task.value.status))
/** 采集端不在线或今天次数用完就不能点 */
const blocked = computed(() => !runnerOnline.value || left.value === 0)
const STEP = { queued: 0, starting: 0, qr: 1, entering: 2, scanning: 3, done: 4 }
const step = computed(() => (STEP[task.value.status] ?? 0) + 1)
const STATUS_TEXT = {
  queued: '排队中，等采集端接单',
  starting: '采集端已接单，正在打开游戏',
  qr: '请用支付宝扫码登录',
  entering: '已登录，正在进游戏',
  scanning: '正在采集'
}

async function load(quiet) {
  try {
    const res = await call('collect.status')
    task.value = res.task || { status: 'idle' }
    hasLogin.value = res.hasLogin
    runnerOnline.value = res.runnerOnline
    left.value = res.left === undefined ? null : res.left
    limit.value = res.limit || 2
  } catch (e) {
    if (!quiet) message.error(e.message)
  } finally {
    loading.value = false
  }
  schedule()
}

/** 只在任务跑着的时候轮询；等扫码时勤一点，扫描中慢一点（省调用次数） */
function schedule() {
  clearTimeout(timer)
  // 采集端显示离线时隔 20 秒再看一次，它一上线按钮就亮，不用手动刷新
  if (!active.value) { if (!runnerOnline.value) timer = setTimeout(() => load(true), 20000); return }
  timer = setTimeout(() => load(true), task.value.status === 'scanning' ? 8000 : 3000)
}

async function start(fresh) {
  busy.value = true
  try {
    await call('collect.start', { fresh })
    await load()
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}

function startFresh() {
  if (!hasLogin.value) return start(true)
  dialog.warning({
    title: '换账号重新扫码？',
    content: '会清掉上次保存的登录，重新出一个登录码。',
    positiveText: '换账号',
    negativeText: '不换',
    onPositiveClick: () => start(true)
  })
}

async function cancel() {
  try {
    await call('collect.cancel')
    await load()
  } catch (e) {
    message.error(e.message)
  }
}

onMounted(() => load())
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <n-spin :show="loading">
    <n-card title="同盟福利 · 宝藏采集" size="small">
      <template #header-extra>
        <n-tag :type="runnerOnline ? 'success' : 'default'" size="small" round>
          {{ runnerOnline ? '采集端在线' : '采集端不在线' }}
        </n-tag>
      </template>

      <n-alert type="info" :show-icon="false" style="margin-bottom:16px">
        采集到的宝藏会更新到本盟小程序的「同盟福利 · 实时宝藏」里，此为专为支持开发版做的代采集。
        目前仅支持用<b>支付宝端小号</b>。
      </n-alert>

      <!-- 没在跑：开始按钮 + 上一次的结果 -->
      <template v-if="!active">
        <n-result
          v-if="task.status === 'done'"
          status="success"
          :title="`找到 ${task.found || 0} 个宝藏`"
          :description="task.message"
          size="small"
        />
        <n-alert v-else-if="task.status === 'failed'" type="error" title="上次采集没完成" style="margin-bottom:16px">
          {{ task.message || '采集失败' }}
        </n-alert>
        <n-alert v-else-if="task.status === 'canceled'" type="default" style="margin-bottom:16px">上次采集已取消</n-alert>

        <n-space align="center" style="margin-top:8px">
          <n-button v-if="hasLogin" type="primary" size="large" :loading="busy" :disabled="blocked" @click="start(false)">
            一键发布（用上次的账号）
          </n-button>
          <n-button :type="hasLogin ? 'default' : 'primary'" size="large" :loading="busy && !hasLogin" :disabled="blocked" @click="startFresh">
            {{ hasLogin ? '换账号重新扫码' : '扫码登录并采集' }}
          </n-button>
        </n-space>
        <div v-if="!runnerOnline" class="hint">采集端没开着，联系开发者打开后再来。</div>
        <div v-else-if="left === 0" class="hint">每天最多采集 {{ limit }} 次，今天的用完了，明天再来。</div>
        <div v-else-if="left !== null" class="hint">今天还能采集 {{ left }} 次（每天 {{ limit }} 次，发起就算一次）。</div>
        <div v-else-if="hasLogin" class="hint">上次的登录已保存，一般能保持 30 天左右；失效了会自动出登录码。</div>
      </template>

      <!-- 在跑：步骤 + 登录码 / 进度 -->
      <template v-else>
        <n-steps :current="step" size="small" style="margin:8px 0 20px">
          <n-step title="打开游戏" />
          <n-step title="扫码登录" />
          <n-step title="进游戏" />
          <n-step title="采集" />
        </n-steps>

        <div v-if="task.status === 'qr' && task.qr" class="qr-box">
          <img :src="task.qr" class="qr" alt="登录码" />
          <div class="qr-t">用<b>支付宝</b>扫码登录游戏</div>
          <div class="hint">只用小号扫；扫完在手机上确认，这里会自动往下走。登录码过期会自动换新的。</div>
        </div>
        <div v-else class="run">
          <n-spin size="small" />
          <span class="run-t">{{ task.message || STATUS_TEXT[task.status] }}</span>
        </div>

        <div v-if="task.status === 'scanning'" class="hint">边采集边更新，小程序里现在就能看到已找到的。</div>

        <n-button style="margin-top:20px" :disabled="task.cancel" @click="cancel">{{ task.cancel ? '正在取消…' : '取消' }}</n-button>
      </template>
    </n-card>
  </n-spin>
</template>

<style scoped>
.hint { margin-top: 10px; font-size: 13px; color: #8a9099; line-height: 1.6; }
.qr-box { display: flex; flex-direction: column; align-items: center; padding: 8px 0 4px; }
.qr { width: 208px; height: 208px; border-radius: 12px; border: 1px solid #efeff5; padding: 8px; background: #fff; }
.qr-t { margin-top: 12px; font-size: 15px; }
.run { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.run-t { font-size: 15px; }
</style>

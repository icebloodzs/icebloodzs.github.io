<script setup>
/**
 * 同盟公告：发布 / 看历史 / 撤销。
 * 发出去之后成员下次打开小程序或电脑版会自动弹一次，点过「知道了」就不再弹；
 * 到了展示期限自己停掉，不用记着来撤。
 */
import { ref, inject, onMounted, h } from 'vue'
import { useMessage, useDialog, NTag, NButton, NSpace } from 'naive-ui'
import { call } from '../api'
import { when } from '../fmt'

const { refreshNotices } = inject('app')
const message = useMessage()
const dialog = useDialog()

const title = ref('')
const content = ref('')
const duration = ref('7d')
/** 服务端会回真正的选项，这里给一份一样的兜底，免得没加载完时下拉里露出 7d 这种原始值 */
const durations = ref([
  { label: '1 天', value: '1d' }, { label: '3 天', value: '3d' },
  { label: '7 天', value: '7d' }, { label: '30 天', value: '30d' },
  { label: '不限期', value: 'forever' }
])
const rows = ref([])
const activeCount = ref(0)
const max = ref(5)
const busy = ref(false)
const loading = ref(true)

const STATUS = {
  on: ['展示中', 'success'],
  off: ['已撤销', 'error'],
  expired: ['已过期', 'default']
}

async function load() {
  loading.value = true
  try {
    // all=true：管理员这边连撤销过的、过期的也要看得到
    const res = await call('notice.list', { all: true })
    rows.value = res.rows || []
    if (res.durations && res.durations.length) {
      durations.value = res.durations.map((d) => ({ label: d.label, value: d.key }))
    }
    activeCount.value = res.activeCount || 0
    max.value = res.max || 5
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function publish() {
  if (!title.value.trim()) return message.warning('请填标题')
  if (!content.value.trim()) return message.warning('请填内容')
  busy.value = true
  try {
    await call('notice.publish', { title: title.value.trim(), content: content.value.trim(), duration: duration.value })
    title.value = ''
    content.value = ''
    message.success('已发布')
    await load()
    await refreshNotices()
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}

function act(row, what) {
  const off = what === 'revoke'
  dialog.warning({
    title: off ? '撤销公告' : '删掉这条记录',
    content: off ? '撤销后盟里就看不到这条了，记录还留着。' : '彻底删掉，之后查不到发过这条公告。',
    positiveText: off ? '撤销' : '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await call(off ? 'notice.revoke' : 'notice.remove', { id: row._id })
        await load()
        await refreshNotices()
      } catch (e) {
        message.error(e.message)
      }
    }
  })
}

const leftText = (r) =>
  r.status !== 'on' ? '' : r.daysLeft === null ? '不限期' : `还剩 ${r.daysLeft} 天`
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="发布公告" :bordered="false">
      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        成员下次打开小程序或电脑版会自动弹一次，点过「知道了」就不再弹，但首页那张公告卡随时能再点开。
        到了展示时长会自己停止显示，不用你记着来撤。同时最多展示 {{ max }} 条（现在 {{ activeCount }} 条）。
      </n-alert>

      <n-space vertical :size="12">
        <n-input v-model:value="title" placeholder="标题，如：周五晚八点集合打城" maxlength="30" show-count />
        <n-input v-model:value="content" type="textarea" :rows="6" placeholder="公告内容，可以分行写" maxlength="1000" show-count />
        <n-space align="center">
          <span class="lab">展示时长</span>
          <n-select v-model:value="duration" :options="durations" style="width: 140px" />
          <n-button type="primary" :loading="busy" @click="publish">发布</n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-card title="发过的公告" :bordered="false">
      <n-spin :show="loading">
        <div v-if="!rows.length" class="empty">还没发过</div>
        <div v-for="r in rows" :key="r._id" class="item">
          <div class="head">
            <b>{{ r.title }}</b>
            <n-tag size="small" :type="STATUS[r.status][1]" :bordered="false">{{ STATUS[r.status][0] }}</n-tag>
            <span class="meta">{{ r.createdByName }} · {{ when(r.createdAt) }}<template v-if="leftText(r)"> · {{ leftText(r) }}</template></span>
            <div style="flex: 1"></div>
            <n-button v-if="r.status === 'on'" size="tiny" quaternary type="error" @click="act(r, 'revoke')">撤销</n-button>
            <n-button v-else size="tiny" quaternary type="error" @click="act(r, 'remove')">删掉</n-button>
          </div>
          <div class="body">{{ r.content }}</div>
        </div>
      </n-spin>
    </n-card>
  </n-space>
</template>

<style scoped>
.lab { font-size: 13px; color: #8a9099; }
.empty { padding: 24px; text-align: center; color: #8a9099; }
.item { padding: 14px 0; border-top: 1px solid #eef0f2; }
.item:first-child { border-top: 0; padding-top: 0; }
.head { display: flex; align-items: center; gap: 10px; }
.meta { font-size: 12px; color: #8a9099; }
/* 公告正文保留管理员写的换行 */
.body { margin-top: 8px; font-size: 13px; line-height: 1.8; color: #4b5563; white-space: pre-wrap; word-break: break-word; }
</style>

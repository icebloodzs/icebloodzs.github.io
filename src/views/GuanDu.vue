<script setup>
/**
 * 官渡之战（浏览器版）：本周报名概况 + 报名名单 + 进入全屏沙盘排表。
 * 报名在小程序里（周四 15:00 ~ 周日 12:00，每团主力 30 / 替补 10），这里只看和排。
 * 数据一次拉齐：admin.guanduOverview({ withPlans })，进沙盘直接用，不再请求。
 */
import { ref, computed, inject, h, onMounted } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import { call } from '../api'
import { download } from '../xlsx'
import { sorter } from '../fmt'
import * as GD from '../lib/guandu'
import GuanDuBoard from './GuanDuBoard.vue'

const { narrow } = inject('app')
const message = useMessage()
const res = ref(null)
const loading = ref(false)
const boardLegion = ref(0) // 0 = 没开沙盘
const tab = ref('1')

async function load() {
  loading.value = true
  try {
    res.value = await call('admin.guanduOverview', { withPlans: true })
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const STATUS = { before: ['未开始', 'default'], open: ['报名中', 'success'], closed: ['已截止', 'warning'], ended: ['已结束', 'default'] }
const statusLine = computed(() => {
  const r = res.value
  if (!r) return ''
  return { before: '周四 15:00 开始报名', open: '周日 12:00 截止报名', closed: '报名已截止，开战前在小程序「官渡管理」里还能代报、调整', ended: '本周已打完，下周四 15:00 开始报名' }[r.status]
})

const legions = computed(() => {
  const r = res.value
  if (!r) return []
  return [1, 2].map((l) => {
    const rows = r.rows.filter((x) => x.legion === l)
    const main = rows.filter((x) => x.role === 'main').length
    const sub = rows.filter((x) => x.role === 'sub').length
    const plan = r.plans[l]
    const prog = GD.progressOf(plan)
    return {
      legion: l,
      name: l === 1 ? '一团' : '二团',
      time: l === 1 ? '周日 21:00' : '周日 14:00',
      color: l === 1 ? '#4472c4' : '#8b5cf6',
      main, sub,
      groups: plan.groups.map((g) => `${g.name} ${g.members.length}`).join(' · '),
      ungrouped: rows.filter((x) => !plan.groups.some((g) => g.members.includes(x.memberId))).length,
      prog,
      fromLastWeek: plan.fromLastWeek,
      pub: plan.publishedAt ? (plan.pubStale ? `已发布 ${stamp(plan.publishedAt)}，之后又改过，进沙盘重新发布` : `已发布给成员 · ${stamp(plan.publishedAt)}`) : '还没发布给成员：排好后在沙盘右上角点「发布给成员」',
      pubOk: Boolean(plan.publishedAt && !plan.pubStale)
    }
  })
})

const roleTag = (role) => h(NTag, { size: 'small', bordered: false, type: role === 'main' ? 'success' : 'warning' }, () => (role === 'main' ? '主力' : '替补'))
const stamp = (iso) => {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600000)
  return `${d.getUTCMonth() + 1}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
const signColumns = [
  { title: '#', key: '_i', width: 50, render: (_r, i) => i + 1 },
  { title: '成员', key: 'name', sorter: sorter((r) => r.name) },
  { title: '身份', key: 'role', width: 90, render: (r) => roleTag(r.role), sorter: sorter((r) => r.role) },
  { title: '集结值', key: 'rally', width: 100, render: (r) => (r.rally == null ? '-' : r.rally.toFixed(2)), sorter: sorter((r) => r.rally) },
  { title: '报名时间', key: 'at', width: 130, render: (r) => stamp(r.at), sorter: sorter((r) => r.at) },
  { title: '', key: 'byAdmin', width: 70, render: (r) => (r.byAdmin ? h('span', { style: 'color:#8a9099;font-size:12px' }, '代报') : '') }
]
const pendingColumns = [
  { title: '#', key: '_i', width: 50, render: (_r, i) => i + 1 },
  { title: '成员', key: 'name', sorter: sorter((r) => r.name) },
  { title: '集结值', key: 'rally', width: 100, render: (r) => (r.rally == null ? '-' : r.rally.toFixed(2)), sorter: sorter((r) => r.rally) },
  { title: '绑定', key: 'bound', width: 90, render: (r) => (r.bound ? '已绑定' : h('span', { style: 'color:#d97706' }, '未绑定（只能代报）')) }
]
const tableRows = computed(() => {
  const r = res.value
  if (!r) return []
  if (tab.value === 'pending') return r.pending
  return r.rows.filter((x) => x.legion === Number(tab.value)).sort((a, b) => (a.role === b.role ? (b.rally ?? -1) - (a.rally ?? -1) : a.role === 'main' ? -1 : 1))
})

function exportSheet(l) {
  const r = res.value
  const plan = r.plans[l]
  const signed = r.rows.filter((x) => x.legion === l)
  const names = Object.fromEntries(signed.map((x) => [x.memberId, x.name]))
  const inGroup = new Set(plan.groups.flatMap((g) => g.members))
  const subs = signed.filter((x) => x.role === 'sub' && !inGroup.has(x.memberId)).sort((a, b) => (b.rally ?? -1) - (a.rally ?? -1)).map((x) => x.name)
  const notes = {}
  plan.groups.forEach((g) => { const t = r.tpl.notes && r.tpl.notes[l] && r.tpl.notes[l][g.name]; if (t) notes[g.id] = t })
  const bj = new Date(new Date(r.battles[l]).getTime() + 8 * 3600000)
  const c = GD.drawSheet({
    alliance: r.alliance, legion: l, battleText: `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 周日 ${l === 1 ? '21:00' : '14:00'} 场`,
    plan: { ...plan, groups: plan.groups.map((g) => ({ ...g, members: g.members.filter((id) => names[id]) })) },
    names, subs, notes, channel: r.tpl.channel, commander: r.tpl.commander && r.tpl.commander[l]
  })
  preview.value = { url: c.toDataURL('image/png'), canvas: c, name: `官渡${l === 1 ? '一团' : '二团'}安排表.png` }
}
const preview = ref(null) // 导出图预览，看过再下载
function savePreview() {
  const p = preview.value
  p.canvas.toBlob((blob) => { if (blob) download(blob, p.name); else message.error('生成图片失败') }, 'image/png')
}

function closeBoard() {
  boardLegion.value = 0
  load()
}
</script>

<template>
  <n-space vertical :size="16">
    <n-alert type="info" :bordered="false">
      成员在小程序首页人物卡片上点「官渡报名」，选一团或二团、主力或替补（每团主力 30、替补 10，满了就报不上）。
      报名截止后在这里进沙盘排表，排完点「发布给成员」，成员在小程序里就能看到自己的任务；也可以导出排表图发群。催报、代报、游戏勾选清单在小程序「管理 → 官渡管理」。
    </n-alert>
    <n-alert v-if="narrow" type="warning" :bordered="false">沙盘排表需要电脑的大屏幕，手机上只能看报名情况。</n-alert>

    <n-spin :show="loading && !res">
      <n-grid v-if="res" cols="1 l:2" responsive="screen" :x-gap="16" :y-gap="16">
        <n-gi v-for="lg in legions" :key="lg.legion">
          <n-card :bordered="false" class="gd-card" :style="{ '--c': lg.color }">
            <template #header>
              <n-space align="center" :size="8">
                <span>{{ lg.name }} · {{ lg.time }}</span>
                <n-tag size="small" round :bordered="false" :type="STATUS[res.status][1]">{{ STATUS[res.status][0] }}</n-tag>
              </n-space>
            </template>
            <div class="gd-sub">{{ statusLine }}</div>
            <div class="gd-nums">
              <div>
                <div class="gd-k">主力</div>
                <div class="gd-v">{{ lg.main }}<small> / {{ res.caps.main }}</small></div>
                <n-progress type="line" :percentage="Math.round(lg.main / res.caps.main * 100)" :show-indicator="false" :color="lg.color" :height="6" />
                <div class="gd-k">剩 {{ Math.max(0, res.caps.main - lg.main) }} 个</div>
              </div>
              <div>
                <div class="gd-k">替补</div>
                <div class="gd-v">{{ lg.sub }}<small> / {{ res.caps.sub }}</small></div>
                <n-progress type="line" :percentage="Math.round(lg.sub / res.caps.sub * 100)" :show-indicator="false" color="#f59e0b" :height="6" />
                <div class="gd-k">剩 {{ Math.max(0, res.caps.sub - lg.sub) }} 个</div>
              </div>
              <div>
                <div class="gd-k">排表</div>
                <div class="gd-v">{{ lg.prog.done }}<small> / {{ lg.prog.total }}</small></div>
                <n-progress type="line" :percentage="lg.prog.total ? Math.round(lg.prog.done / lg.prog.total * 100) : 0" :show-indicator="false" color="#18a058" :height="6" />
                <div class="gd-k">三个阶段已派的任务</div>
              </div>
            </div>
            <div class="gd-groups">{{ lg.groups }}<span v-if="lg.ungrouped"> · 未分组 {{ lg.ungrouped }}</span></div>
            <div v-if="lg.fromLastWeek" class="gd-tip">本周还没排过：进沙盘会照上周的分组和任务起个头</div>
            <div v-else-if="lg.prog.missing.length" class="gd-tip">还没派：{{ lg.prog.missing.slice(0, 3).join('、') }}{{ lg.prog.missing.length > 3 ? ` 等 ${lg.prog.missing.length} 项` : '' }}</div>
            <div class="gd-pub" :class="{ ok: lg.pubOk }">{{ lg.pub }}</div>
            <n-space style="margin-top: 14px">
              <n-button type="primary" size="large" :disabled="narrow" @click="boardLegion = lg.legion">进入沙盘排表</n-button>
              <n-button size="large" @click="exportSheet(lg.legion)">导出排表图</n-button>
            </n-space>
          </n-card>
        </n-gi>
      </n-grid>
    </n-spin>

    <n-card v-if="res" :bordered="false" title="报名名单">
      <template #header-extra><n-button size="small" :loading="loading" @click="load">刷新</n-button></template>
      <n-tabs v-model:value="tab" type="segment" style="max-width: 420px; margin-bottom: 12px">
        <n-tab name="1">一团 {{ res.rows.filter((r) => r.legion === 1).length }}</n-tab>
        <n-tab name="2">二团 {{ res.rows.filter((r) => r.legion === 2).length }}</n-tab>
        <n-tab name="pending">未报名 {{ res.pending.length }}</n-tab>
      </n-tabs>
      <n-data-table :columns="tab === 'pending' ? pendingColumns : signColumns" :data="tableRows" :row-key="(r) => r.memberId" size="small" :max-height="520" />
    </n-card>

    <n-modal :show="!!preview" preset="card" title="排表预览" style="width: 1240px; max-width: 96vw" @update:show="(v) => { if (!v) preview = null }">
      <img v-if="preview" :src="preview.url" alt="排表预览" style="width: 100%; display: block; border-radius: 6px" />
      <template #footer>
        <n-space justify="end"><n-button @click="preview = null">关闭</n-button><n-button type="primary" @click="savePreview">下载图片</n-button></n-space>
      </template>
    </n-modal>

    <GuanDuBoard v-if="boardLegion && res" :data="res" :legion="boardLegion" @close="closeBoard" />
  </n-space>
</template>

<style scoped>
.gd-card { position: relative; overflow: hidden; }
.gd-card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--c); }
.gd-sub { color: #8a9099; font-size: 13px; margin-top: -6px; }
.gd-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 14px 0 10px; }
.gd-k { color: #8a9099; font-size: 12px; margin: 2px 0; }
.gd-v { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.gd-v small { font-size: 14px; color: #8a9099; font-weight: 400; }
.gd-groups { color: #4b5563; font-size: 13px; }
.gd-pub { color: #d97706; font-size: 13px; margin-top: 6px; }
.gd-pub.ok { color: #18a058; }
.gd-tip { color: #e0203a; font-size: 13px; margin-top: 6px; }
</style>

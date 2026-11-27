<script setup>
/**
 * 南蛮分组（云函数 handlers/nanman.js，和小程序 pages/nanman 同一份数据）。
 * 每组 7 / 6 人（含组长，默认 7）：
 *   按六维一键排 —— 全部在队成员六维从高到低，蛇形分到各组，每组第一名当组长；
 *   选大车头当组长 —— 一人一组，成员在小程序里通过转发自己选组（浏览器版没有微信转发，只能开关自选）。
 * 未分组的人在最上面；点任何人可以挪组 / 设组长 / 移出；导出图片（排版同小程序 nanman-lib.js）。
 */
import { ref, computed, inject } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'

const { me, narrow = ref(false) } = inject('app')
const message = useMessage()
const dialog = useDialog()

const view = ref(null)
const loading = ref(false)
const busy = ref(false)
const size = ref(7)

const byId = computed(() => Object.fromEntries(((view.value && view.value.members) || []).map((m) => [m._id, m])))
const plan = computed(() => view.value && view.value.plan)
const nameOf = (id) => (byId.value[id] ? byId.value[id].name : '?')
const sixOf = (id) => (byId.value[id] && byId.value[id].six != null ? Math.round(byId.value[id].six) : null)
const groups = computed(() => (plan.value ? plan.value.groups.map((g, i) => {
  const ids = (g.leader ? [g.leader] : []).concat(g.members)
  return { i, leader: g.leader, ids, count: ids.length }
}) : []))

function apply(v) {
  view.value = v
  if (v.plan) size.value = v.plan.size
}

async function load() {
  loading.value = true
  try {
    apply(await call('nanman.get', {}))
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
load()

async function run(action, payload, ok) {
  if (busy.value) return
  busy.value = true
  try {
    apply(await call(action, payload))
    if (ok) message.success(ok)
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}

function setSize(v) {
  size.value = v
  if (plan.value) run('nanman.edit', { op: 'size', size: v })
}

function autoArrange() {
  const go = () => run('nanman.auto', { size: size.value }, '已按六维分好')
  if (!plan.value) return go()
  dialog.warning({
    title: '按六维重新一键排？',
    content: `全部在队成员按六维从高到低蛇形分组，每组 ${size.value} 人，现在的分组会被覆盖`,
    positiveText: '重新排',
    negativeText: '取消',
    onPositiveClick: go
  })
}

// ---------------- 选大车头 ----------------
const pickOpen = ref(false)
const picked = ref([])
const pickKw = ref('')
const pickList = computed(() => ((view.value && view.value.members) || [])
  .slice()
  .sort((a, b) => (b.six == null ? -1 : 0) - (a.six == null ? -1 : 0) || (b.six || 0) - (a.six || 0))
  .filter((m) => !pickKw.value.trim() || m.name.toLowerCase().includes(pickKw.value.trim().toLowerCase())))
function openPick() {
  picked.value = plan.value ? plan.value.groups.map((g) => g.leader).filter(Boolean) : []
  pickKw.value = ''
  pickOpen.value = true
}
function togglePick(id) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : picked.value.concat(id)
}
async function confirmPick() {
  if (!picked.value.length) return message.warning('至少选一个组长')
  pickOpen.value = false
  await run('nanman.leaders', { size: size.value, leaderIds: picked.value }, `${picked.value.length} 位组长，已开放成员自选`)
}

// ---------------- 挪人 ----------------
function moveOptions(id, gi) {
  const p = plan.value
  const isLeader = gi >= 0 && p.groups[gi].leader === id
  const opts = []
  if (gi >= 0 && !isLeader) opts.push({ label: '👑 设为本组组长', key: 'lead' })
  opts.push({ label: '移到未分组', key: 'none' }, { label: '不参加', key: 'out' }, { type: 'divider', key: 'd' })
  groups.value.forEach((g) => {
    if (g.i !== gi) opts.push({ label: `移到第 ${g.i + 1} 组（${g.count}/${p.size}）`, key: 'g' + g.i })
  })
  return opts
}
function onMove(id, gi, key) {
  if (key === 'lead') return run('nanman.move', { memberId: id, to: gi, leader: true })
  if (key === 'none' || key === 'out') return run('nanman.move', { memberId: id, to: key })
  return run('nanman.move', { memberId: id, to: Number(key.slice(1)) })
}
function removeGroup(i) {
  dialog.warning({ title: `删掉第 ${i + 1} 组？`, content: '组里的人回到未分组', positiveText: '删除', negativeText: '取消', onPositiveClick: () => run('nanman.edit', { op: 'removeGroup', index: i }) })
}
function clearPlan() {
  dialog.error({ title: '清空分组？', content: '所有人回到没分组的状态', positiveText: '清空', negativeText: '取消', onPositiveClick: () => run('nanman.edit', { op: 'clear' }) })
}

// ---------------- 导出图片（排版同小程序 pages/nanman/nanman-lib.js） ----------------
const LABEL_W = 110
const CELL_W = 150
const ROW_H = 56
const HEAD_H = 96
const PAD = 24
function exportImage() {
  const p = plan.value
  const rows = groups.value.map((g) => g.ids.map(nameOf))
  const cols = Math.max(p.size, ...rows.map((r) => r.length))
  const W = PAD * 2 + LABEL_W + cols * CELL_W
  const H = PAD * 2 + HEAD_H + rows.length * ROW_H
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  const ally = (me.value && me.value.alliance && me.value.alliance.name) || ''
  const d = new Date()
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1f2329'
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText(`${ally ? '【' + ally + '】' : ''}南蛮分组`, PAD, PAD + 30)
  ctx.font = '22px sans-serif'
  ctx.fillStyle = '#8a9099'
  ctx.fillText(`${d.getMonth() + 1}月${d.getDate()}日 · 共 ${rows.length} 组 · 每组 ${p.size} 人 · 红字为组长`, PAD, PAD + 72)
  const top = PAD + HEAD_H
  rows.forEach((names, r) => {
    const y = top + r * ROW_H
    ctx.fillStyle = r % 2 === 0 ? '#f19ba6' : '#ffffff'
    ctx.fillRect(PAD, y, LABEL_W + cols * CELL_W, ROW_H)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#1f2329'
    ctx.font = 'bold 24px sans-serif'
    ctx.fillText(`第${r + 1}组`, PAD + LABEL_W / 2, y + ROW_H / 2)
    for (let c = 0; c < cols; c += 1) {
      const name = names[c] || ''
      ctx.font = c === 0 ? 'bold 24px sans-serif' : '24px sans-serif'
      ctx.fillStyle = c === 0 ? '#b91c1c' : '#1f2329'
      let text = name
      while (text && ctx.measureText(text).width > CELL_W - 16) text = text.slice(0, -1)
      if (text !== name) text = text.slice(0, -1) + '…'
      ctx.fillText(text, PAD + LABEL_W + c * CELL_W + CELL_W / 2, y + ROW_H / 2)
    }
  })
  ctx.strokeStyle = '#c9c9c9'
  ctx.lineWidth = 1
  for (let r = 0; r <= rows.length; r += 1) {
    ctx.beginPath(); ctx.moveTo(PAD, top + r * ROW_H); ctx.lineTo(PAD + LABEL_W + cols * CELL_W, top + r * ROW_H); ctx.stroke()
  }
  for (let c = 0; c <= cols + 1; c += 1) {
    const x = c === 0 ? PAD : PAD + LABEL_W + (c - 1) * CELL_W
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + rows.length * ROW_H); ctx.stroke()
  }
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${ally}南蛮分组_${d.getMonth() + 1}-${d.getDate()}.png`
  a.click()
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card :bordered="false">
      <div class="nm-top">
        <n-space align="center" :size="12" :wrap="true">
          <span>每组人数（含组长）</span>
          <n-radio-group :value="size" size="small" @update:value="setSize">
            <n-radio-button :value="7">7 人</n-radio-button>
            <n-radio-button :value="6">6 人</n-radio-button>
          </n-radio-group>
          <n-tag v-if="plan" :type="plan.mode === 'auto' ? 'info' : plan.open ? 'success' : 'default'" :bordered="false">
            {{ plan.mode === 'auto' ? '按六维排' : plan.open ? '成员自选中' : '自选已关' }}
          </n-tag>
        </n-space>
        <n-space :size="10" :wrap="true">
          <n-button type="primary" :loading="busy" @click="autoArrange">按六维一键排</n-button>
          <n-button @click="openPick">选大车头当组长</n-button>
          <template v-if="plan">
            <n-button v-if="plan.mode === 'pick'" @click="run('nanman.edit', { op: 'open', open: !plan.open }, plan.open ? '已关闭自选' : '已开放自选')">{{ plan.open ? '关闭自选' : '开放自选' }}</n-button>
            <n-button @click="run('nanman.edit', { op: 'addGroup' })">加一组</n-button>
            <n-button @click="exportImage">导出图片</n-button>
            <n-button type="error" quaternary @click="clearPlan">清空</n-button>
          </template>
        </n-space>
      </div>
      <div class="nm-hint">
        一键排：全部在队成员按六维从高到低<b>蛇形</b>分组（第 1 组拿第 1、2N、2N+1 名……），每组第一名当组长。
        选组长：选几个大车头，一人一组；成员在<b>小程序「南蛮分组」转发</b>出去的链接里自己选组，满员进不去。点任何人可以挪组、设组长、移出。
      </div>
    </n-card>

    <n-spin :show="loading">
      <n-empty v-if="!plan" description="还没分组：选好每组人数，点「按六维一键排」或「选大车头当组长」" style="padding: 60px 0" />
      <template v-else>
        <n-card v-if="plan.unassigned.length" :bordered="false" class="nm-un" :title="`未分组（${plan.unassigned.length} 人）`" size="small">
          <div class="nm-people">
            <n-dropdown v-for="id in plan.unassigned" :key="id" trigger="click" :options="moveOptions(id, -1)" @select="(k) => onMove(id, -1, k)">
              <span class="nm-p">{{ nameOf(id) }}<i v-if="sixOf(id) != null">{{ sixOf(id) }}</i></span>
            </n-dropdown>
          </div>
        </n-card>

        <div class="nm-grid" :style="narrow ? 'grid-template-columns: 1fr' : ''">
          <n-card v-for="g in groups" :key="g.i" :bordered="false" size="small">
            <template #header>
              <span class="nm-no">第 {{ g.i + 1 }} 组</span>
              <n-tag size="small" :bordered="false" :type="g.count > plan.size ? 'error' : g.count === plan.size ? 'success' : 'default'" style="margin-left:8px">{{ g.count }}/{{ plan.size }}</n-tag>
              <n-tag v-if="!g.leader" size="small" :bordered="false" type="warning" style="margin-left:6px">缺组长</n-tag>
            </template>
            <template #header-extra>
              <n-button v-if="!g.count" text type="error" size="small" @click="removeGroup(g.i)">删除</n-button>
            </template>
            <div class="nm-people">
              <n-dropdown v-for="id in g.ids" :key="id" trigger="click" :options="moveOptions(id, g.i)" @select="(k) => onMove(id, g.i, k)">
                <span :class="['nm-p', { 'nm-leader': id === g.leader }]"><template v-if="id === g.leader">👑</template>{{ nameOf(id) }}<i v-if="sixOf(id) != null">{{ sixOf(id) }}</i></span>
              </n-dropdown>
              <span v-if="!g.count" class="nm-empty">还没有人</span>
            </div>
          </n-card>
        </div>

        <n-card v-if="plan.out.length" :bordered="false" size="small" :title="`不参加（${plan.out.length} 人）`" style="margin-top:16px">
          <div class="nm-people">
            <n-dropdown v-for="id in plan.out" :key="id" trigger="click" :options="moveOptions(id, -1)" @select="(k) => onMove(id, -1, k)">
              <span class="nm-p nm-out">{{ nameOf(id) }}</span>
            </n-dropdown>
          </div>
        </n-card>
      </template>
    </n-spin>

    <n-modal v-model:show="pickOpen" preset="card" title="选大车头当组长" :style="{ width: narrow ? '96vw' : '520px' }">
      <n-input v-model:value="pickKw" placeholder="搜名字" clearable />
      <div class="nm-pick">
        <div v-for="m in pickList" :key="m._id" class="nm-pick-row" @click="togglePick(m._id)">
          <n-checkbox :checked="picked.includes(m._id)" />
          <span class="nm-pick-name">{{ m.name }}</span>
          <span class="nm-pick-six">六维 {{ m.six == null ? '未录' : Math.round(m.six) }}</span>
        </div>
      </div>
      <template #footer>
        <n-space justify="space-between" align="center">
          <span class="nm-hint" style="margin:0">已选 {{ picked.length }} 人 = {{ picked.length }} 组</span>
          <n-button type="primary" @click="confirmPick">确定</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>

<style scoped>
.nm-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.nm-hint { margin-top: 12px; font-size: 12px; color: #6b7280; line-height: 1.8; }
.nm-un { box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45); margin-bottom: 16px; }
.nm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.nm-no { font-weight: 700; }
.nm-people { display: flex; flex-wrap: wrap; gap: 8px; }
.nm-p { display: inline-block; padding: 5px 10px; border-radius: 8px; background: #f3f5f9; color: #374151; font-size: 13px; cursor: pointer; }
.nm-p:hover { background: #e8ebf3; }
.nm-p i { font-style: normal; margin-left: 5px; font-size: 11px; color: #9ca3af; }
.nm-leader { background: #fde2e4; color: #b91c1c; font-weight: 700; }
.nm-out { color: #9ca3af; text-decoration: line-through; }
.nm-empty { font-size: 12px; color: #9ca3af; }
.nm-pick { margin-top: 10px; max-height: 55vh; overflow-y: auto; }
.nm-pick-row { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid #f0f1f4; cursor: pointer; }
.nm-pick-name { flex: 1; }
.nm-pick-six { font-size: 12px; color: #9ca3af; }
</style>

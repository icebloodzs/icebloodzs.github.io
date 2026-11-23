<script setup>
/**
 * 同盟分组：小组看板。未分组的人横排在最上面，下面每组一栏；拖名字换组、点「设组长」切换、组名点一下就能改。
 * 一个组可以有多个组长，一个人只能当自己所在组的组长。小程序「小组」页同样能看能调。
 * 接口：group.list / group.save（整体保存小组列表）/ group.assign / group.setLeader，见云函数 handlers/groups.js
 */
import { ref, computed, onMounted } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'

const message = useMessage()
const dialog = useDialog()
const data = ref(null)
const loading = ref(false)
const busy = ref(false)
const dragId = ref(null)
const over = ref(undefined)

async function load() {
  loading.value = true
  try {
    data.value = await call('group.list')
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function run(action, payload, ok) {
  if (busy.value) return
  busy.value = true
  try {
    data.value = await call(action, payload)
    if (ok) message.success(ok)
  } catch (e) {
    message.error(e.message)
    await load()
  } finally {
    busy.value = false
  }
}

const groups = computed(() => (data.value ? data.value.groups : []))
const byGroup = computed(() => {
  const out = { '': [] }
  groups.value.forEach((g) => { out[g.id] = [] })
  for (const m of data.value ? data.value.members : []) (out[m.groupId || ''] || out['']).push(m)
  for (const k of Object.keys(out)) out[k].sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name, 'zh'))
  return out
})
const unassigned = computed(() => byGroup.value[''] || [])
const isNew = (m) => m.joinedAt && Date.now() - new Date(m.joinedAt).getTime() < 7 * 86400000
const newDate = (m) => { const d = new Date(m.joinedAt); return `${d.getMonth() + 1}/${d.getDate()} 入队` }

function drop(gid) {
  const id = dragId.value
  over.value = undefined
  dragId.value = null
  if (!id) return
  const m = data.value.members.find((x) => x._id === id)
  if (!m || (m.groupId || '') === gid) return
  // 先在界面上挪过去，接口回来再以服务端为准
  m.groupId = gid || null
  m.leader = false
  const name = gid ? groups.value.find((g) => g.id === gid).name : '未分组'
  run('group.assign', { memberId: id, groupId: gid || null }, `${m.name} → ${name}`)
}
const toggleLeader = (m) => run('group.setLeader', { memberId: m._id, leader: !m.leader }, m.leader ? `已取消 ${m.name} 的组长` : `${m.name} 设为组长`)

const newId = () => 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)
function addGroup() {
  const used = new Set(groups.value.map((g) => g.name))
  const cn = '一二三四五六七八九十'
  let i = groups.value.length + 1
  let name = i <= 10 ? cn[i - 1] + '组' : `${i}组`
  while (used.has(name)) { i += 1; name = `${i}组` }
  run('group.save', { groups: [...groups.value, { id: newId(), name }] }, `已新建「${name}」`)
}
function rename(g, ev) {
  const name = ev.target.textContent.trim().slice(0, 12)
  if (!name || name === g.name) { ev.target.textContent = g.name; return }
  run('group.save', { groups: groups.value.map((x) => (x.id === g.id ? { ...x, name } : x)) }, '组名已改')
}
function removeGroup(g) {
  const n = (byGroup.value[g.id] || []).length
  dialog.warning({
    title: `删除「${g.name}」？`,
    content: n ? `组里的 ${n} 人会回到「未分组」，组长身份一起取消。` : '这个组没有人。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => run('group.save', { groups: groups.value.filter((x) => x.id !== g.id) }, '已删除')
  })
}
function move(g, d) {
  const arr = [...groups.value]
  const i = arr.findIndex((x) => x.id === g.id)
  const j = i + d
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  run('group.save', { groups: arr })
}
</script>

<template>
  <n-space vertical :size="16">
    <n-alert type="info" :bordered="false">
      同盟里的小组，<b>积分考勤要用</b>，以后集结分配、官渡也可以直接读。拖名字换组，点「设组长」切换组长（一个组可以有多个组长，一个人只能当自己所在组的组长）；组名点一下就能改。小程序「小组」页同样能看能调，组长只看得到自己组。
    </n-alert>

    <div class="gp-bar">
      <n-button type="primary" :loading="busy" @click="addGroup">＋ 新建小组</n-button>
      <span class="gp-sum" v-if="data">{{ groups.length }} 个小组 · 名单 {{ data.members.length }} 人 · 未分组 {{ unassigned.length }} 人</span>
      <n-button size="small" :loading="loading" @click="load">刷新</n-button>
    </div>

    <n-spin :show="loading && !data">
      <div
        class="gp-none"
        :class="{ over: over === '' }"
        @dragover.prevent="over = ''"
        @dragleave="over = undefined"
        @drop="drop('')"
      >
        <div class="gp-h">未分组 <span>{{ unassigned.length }} 人 · 新入队的人先在这，拖到下面的小组里</span></div>
        <div class="gp-wrap">
          <div v-for="m in unassigned" :key="m._id" class="gp-chip" draggable="true" @dragstart="dragId = m._id">
            <span>{{ m.name }}</span>
            <n-tag v-if="isNew(m)" size="tiny" type="info" :bordered="false">{{ newDate(m) }}</n-tag>
          </div>
          <span v-if="!unassigned.length" class="gp-empty">都分好组了。把人拖到这里就是移出小组</span>
        </div>
      </div>

      <div class="gp-kb">
        <div
          v-for="(g, gi) in groups"
          :key="g.id"
          class="gp-col"
          :class="{ over: over === g.id }"
          @dragover.prevent="over = g.id"
          @dragleave="over = undefined"
          @drop="drop(g.id)"
        >
          <div class="gp-h">
            <b contenteditable="true" spellcheck="false" class="gp-name" @blur="rename(g, $event)" @keydown.enter.prevent="$event.target.blur()">{{ g.name }}</b>
            <span>{{ byGroup[g.id].length }} 人</span>
            <span class="gp-sp" />
            <n-button text size="tiny" :disabled="gi === 0" @click="move(g, -1)">←</n-button>
            <n-button text size="tiny" :disabled="gi === groups.length - 1" @click="move(g, 1)">→</n-button>
            <n-button text size="tiny" type="error" @click="removeGroup(g)">删除</n-button>
          </div>
          <div v-for="m in byGroup[g.id]" :key="m._id" class="gp-chip row" draggable="true" @dragstart="dragId = m._id">
            <span>{{ m.name }}</span>
            <n-tag v-if="isNew(m)" size="tiny" type="info" :bordered="false">{{ newDate(m) }}</n-tag>
            <span class="gp-sp" />
            <span class="gp-ld" :class="{ on: m.leader }" @click="toggleLeader(m)">{{ m.leader ? '组长' : '设组长' }}</span>
          </div>
          <div v-if="!byGroup[g.id].length" class="gp-empty">拖人到这里</div>
        </div>
      </div>
      <n-empty v-if="data && !groups.length" description="还没有小组，先新建一个" style="margin-top: 24px" />
    </n-spin>
  </n-space>
</template>

<style scoped>
.gp-bar { display: flex; align-items: center; gap: 12px; }
.gp-sum { margin-left: auto; color: #8a9099; font-size: 13px; }
.gp-none { background: #fffaf0; border: 2px dashed #f6d9a6; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
.gp-none.over, .gp-col.over { border-color: #6c5ce7; background: #f4f2ff; }
.gp-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.gp-kb { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-items: start; }
.gp-col { background: #fff; border-radius: 8px; padding: 10px; min-height: 120px; border: 2px dashed transparent; }
.gp-h { display: flex; align-items: center; gap: 6px; padding: 2px 4px 8px; font-size: 14px; }
.gp-h span { color: #8a9099; font-size: 12px; font-weight: 400; }
.gp-name { outline: none; border-radius: 4px; padding: 0 2px; cursor: text; }
.gp-name:focus { background: #f4f2ff; }
.gp-sp { flex: 1; }
.gp-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; background: #fff; border: 1px solid #efeff5; cursor: grab; font-size: 13px; }
.gp-chip.row { display: flex; background: #fafafc; border-color: transparent; margin-bottom: 4px; }
.gp-chip:hover { border-color: #c8c0ff; }
.gp-ld { font-size: 12px; color: #8a9099; cursor: pointer; }
.gp-ld.on { color: #6c5ce7; font-weight: 600; }
.gp-empty { color: #8a9099; font-size: 12px; padding: 6px; }
</style>

<script setup>
/**
 * 一场的计分表（管理员）：每人一行、每个计分项一列，直接在格子里改。
 * 改别人自己填的数会进修改记录（云函数记），成员那边这场标「有改动」。
 * 出勤选了请假 / 缺席，这人别的项清空变灰。
 */
import { ref, computed, onMounted, inject } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'
import { fmtPts, ptsColor, dlText, ruleText, multiText, BY, SRC } from '../lib/points'

const props = defineProps({ id: String, groups: Array, archived: Boolean })
const emit = defineEmits(['back', 'share', 'member'])
const { members } = inject('app')
const message = useMessage()
const dialog = useDialog()
const d = ref(null)
const loading = ref(false)
const saving = ref({})

async function load() {
  loading.value = true
  try {
    d.value = await call('points.detail', { id: props.id })
  } catch (e) {
    message.error(e.message)
    emit('back')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const s = computed(() => d.value && d.value.session)
const readonly = computed(() => props.archived || (s.value && s.value.archived))
const gname = (gid) => (props.groups.find((g) => g.id === gid) || {}).name || '未分组'
const gFilter = ref(null)
const srcFilter = ref('')
const kw = ref('')
const rows = computed(() => {
  if (!d.value) return []
  return d.value.rows.filter((r) => {
    if (gFilter.value && r.groupId !== gFilter.value) return false
    if (kw.value && !r.name.includes(kw.value)) return false
    if (srcFilter.value === 'none') return !r.by || r.by === 'auto'
    if (srcFilter.value) return r.by === srcFilter.value
    return true
  })
})
/* 表头排序：点一次从高到低（填写状态：没填的在前），再点反过来，第三次回到默认顺序 */
const sortBy = ref({ key: '', dir: -1 })
const SRC_ORDER = { '': 0, auto: 1, self: 2, leader: 3, admin: 4 }
const SORT_KEY = { total: (r) => r.total, src: (r) => -SRC_ORDER[r.by || ''] }
function sortCol(key) {
  const s = sortBy.value
  sortBy.value = s.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : { key: '', dir: -1 }
}
const sortMark = (key) => (sortBy.value.key !== key ? '⇅' : sortBy.value.dir === -1 ? '↓' : '↑')
const sortedRows = computed(() => {
  const { key, dir } = sortBy.value
  if (!key) return rows.value
  const f = SORT_KEY[key]
  return rows.value.slice().sort((a, b) => dir * (f(a) - f(b)) || a.name.localeCompare(b.name, 'zh'))
})
const groupOpts = computed(() => [{ label: '全部分组', value: null }, ...props.groups.map((g) => ({ label: g.name, value: g.id }))])
const SRC_TABS = [['', '全部'], ['none', '未填/自动缺席'], ['self', '本人填'], ['leader', '组长填'], ['admin', '管理员填']]
const away = (r) => r.vals && (r.vals.att === 1 || r.vals.att === 2)

/** 改一格：带上这人现在的全部值一起交（服务端按管理员身份整份收），回来换掉这一行 */
async function save(r, itemId, value) {
  if (readonly.value) return
  const vals = { ...(r.by && r.by !== 'auto' ? r.vals || {} : {}) }
  if (value === undefined || value === null || value === '') delete vals[itemId]
  else vals[itemId] = value
  if (vals.att === undefined) vals.att = itemId === 'att' ? value : 0
  saving.value = { ...saving.value, [r.mid]: true }
  try {
    const res = await call('points.fill', { id: props.id, memberId: r.mid, vals })
    const i = d.value.rows.findIndex((x) => x.mid === r.mid)
    if (i >= 0) d.value.rows[i] = { ...res.row, groupId: d.value.rows[i].groupId, leader: d.value.rows[i].leader, changed: true }
    d.value.session.progress = res.progress
    refreshLog()
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = { ...saving.value, [r.mid]: false }
  }
}
async function refreshLog() {
  try {
    const x = await call('points.detail', { id: props.id })
    d.value.log = x.log
    d.value.groupProgress = x.groupProgress
  } catch (e) { /* 记录刷不出来不影响改数 */ }
}

/* 状态类可多次：弹窗里每个选项填次数 */
const multi = ref(null)
function openMulti(r, it) {
  const v = (r.vals && r.vals[it.id]) || {}
  multi.value = { r, it, counts: it.options.map((o, k) => Number(v[k] || 0)) }
}
function saveMulti() {
  const { r, it, counts } = multi.value
  const v = {}
  counts.forEach((c, k) => { if (c > 0) v[k] = c })
  multi.value = null
  save(r, it.id, v)
}
const choiceOpts = (it) => it.options.map((o, k) => ({ label: o.pts ? `${o.label} ${fmtPts(o.pts)}` : o.label, value: k }))

/* 截止时间 / 重新开放 */
const showDl = ref(false)
const dlValue = ref(0)
function openDl() {
  dlValue.value = s.value.closed ? Date.now() + 2 * 3600 * 1000 : new Date(s.value.deadline).getTime()
  showDl.value = true
}
async function saveDl() {
  try {
    await call('points.update', { id: props.id, deadline: dlValue.value })
    showDl.value = false
    message.success('截止时间已改')
    load()
  } catch (e) {
    message.error(e.message)
  }
}

/* 加人：名单里有、这场没有的 */
const showAdd = ref(false)
const addIds = ref([])
const addOpts = computed(() => {
  const inIt = new Set(d.value ? d.value.rows.map((r) => r.mid) : [])
  return (members.value || []).filter((m) => m.inRoster !== false && !inIt.has(m._id)).map((m) => ({ label: m.name, value: m._id }))
})
async function addPeople() {
  if (!addIds.value.length) return
  try {
    const r = await call('points.addPerson', { id: props.id, memberIds: addIds.value })
    message.success(`已加入 ${r.added} 人`)
    showAdd.value = false
    addIds.value = []
    load()
  } catch (e) {
    message.error(e.message)
  }
}

function removeSession() {
  dialog.warning({
    title: `删除「${s.value.title}」？`,
    content: '这场所有人填的数据都会删掉，赛季积分跟着减。删了找不回来。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await call('points.remove', { id: props.id })
        message.success('已删除')
        emit('back')
      } catch (e) {
        message.error(e.message)
      }
    }
  })
}

const SRC_CLS = { self: 'self', leader: 'leader', admin: 'admin', auto: 'auto' }
</script>

<template>
  <n-spin :show="loading && !d">
    <div v-if="d" class="ps">
      <div class="ps-head">
        <n-button @click="emit('back')">← 场次</n-button>
        <div class="ps-meta">
          <div class="ps-mute">{{ s.date }} {{ s.week }} · 模板「{{ s.tpl }}」 · 名单 {{ d.rows.length }} 人 · {{ s.createdBy }} 创建</div>
          <div class="ps-title">{{ s.title }}
            <n-tag size="small" round :bordered="false" :type="s.closed ? 'default' : 'success'">{{ s.closed ? '已截止 ' : '填写中 · ' }}{{ dlText(s.deadline) }}{{ s.closed ? '' : ' 截止' }}</n-tag>
          </div>
          <div class="ps-gp">
            <span class="ps-mute">各组已填：</span>
            <n-tag v-for="g in d.groupProgress" :key="g.groupId || 'none'" size="small" :bordered="false" :type="g.all && g.done === g.all ? 'success' : 'default'">{{ gname(g.groupId) }} {{ g.done }}/{{ g.all }}</n-tag>
          </div>
        </div>
        <n-space v-if="!readonly">
          <n-button @click="openDl">{{ s.closed ? '重新开放填写' : '改截止时间' }}</n-button>
          <n-button @click="showAdd = true">加人</n-button>
          <n-button type="error" ghost @click="removeSession">删除</n-button>
          <n-button type="primary" @click="emit('share')">分享到微信群</n-button>
        </n-space>
      </div>

      <n-alert v-if="d.log.length" type="warning" :bordered="false" class="ps-log">
        <b>修改记录</b>（组长/管理员代填、改的每一处都记在这，截止后也能改、不限时间；成员那边这场标「有改动」）
        <div class="ps-logs">
          <div v-for="(l, i) in d.log" :key="i">{{ dlText(l.at) }} · {{ l.who }}{{ l.by === 'admin' ? '（管理员）' : '（组长）' }} {{ !l.item ? '代填 ' + (d.rows.find((r) => r.mid === l.mid) || {}).name : `改 ${(d.rows.find((r) => r.mid === l.mid) || {}).name}「${l.item}」${l.from} → ${l.to}` }}<n-tag v-if="l.late" size="tiny" type="warning" :bordered="false" style="margin-left: 6px">截止后</n-tag></div>
        </div>
      </n-alert>
      <n-alert v-else type="info" :bordered="false">表里改的数据来源会变成「管理员」；组长/管理员的每次代填、修改都进修改记录（截止后也能改，不限时间）。排名项填的是名次，按名次分档给分。</n-alert>

      <div class="ps-bar">
        <n-select v-model:value="gFilter" :options="groupOpts" placeholder="全部分组" size="small" style="width: 130px" />
        <n-radio-group v-model:value="srcFilter" size="small">
          <n-radio-button v-for="[k, n] in SRC_TABS" :key="k" :value="k" :label="n" />
        </n-radio-group>
        <n-input v-model:value="kw" size="small" placeholder="搜名字" clearable style="width: 140px" />
        <span class="ps-mute" style="margin-left: auto">已填 {{ s.progress.done }}/{{ s.progress.all }} · 请假 {{ s.progress.leave }} · 缺席 {{ s.progress.absent }}</span>
      </div>

      <div class="ps-tbl">
        <table>
          <thead>
            <tr>
              <th class="stk">#</th><th class="stk nm">成员</th><th class="sortable" :class="{ on: sortBy.key === 'src' }" @click="sortCol('src')">来源 <i>{{ sortMark('src') }}</i></th>
              <th v-for="it in d.items" :key="it.id">{{ it.name }}<small>{{ ruleText(it) }}</small><small>{{ BY[it.by] }}</small></th>
              <th class="sortable" :class="{ on: sortBy.key === 'total' }" @click="sortCol('total')">本场得分 <i>{{ sortMark('total') }}</i></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in sortedRows" :key="r.mid" :class="{ un: !r.by, busy: saving[r.mid] }">
              <td class="stk">{{ i + 1 }}</td>
              <td class="stk nm"><a @click="emit('member', r.mid, id)">{{ r.name }}</a><n-tag v-if="r.leader" size="tiny" type="info" :bordered="false">组长</n-tag><span class="ps-g">{{ gname(r.groupId) }}</span></td>
              <td><span class="ps-src" :class="SRC_CLS[r.by] || 'none'">{{ r.by ? SRC[r.by] : '未填' }}</span><small v-if="r.at && r.by !== 'auto'" class="ps-mute">{{ dlText(r.at).split(' ')[1] }}</small></td>
              <td v-for="it in d.items" :key="it.id">
                <!-- 状态 -->
                <template v-if="it.type === 'choice' && !it.multi">
                  <n-select
                    size="small" :disabled="readonly || (it.id !== 'att' && away(r))" :consistent-menu-width="false"
                    :value="r.by && r.vals ? r.vals[it.id] ?? null : null" :options="choiceOpts(it)" :placeholder="it.id !== 'att' && away(r) ? '—' : '未填'"
                    :class="['ps-ch', it.id === 'att' && r.vals ? 'a' + r.vals.att : '']" :style="{ width: it.id === 'att' ? '96px' : '132px' }"
                    @update:value="(v) => save(r, it.id, v)"
                  />
                </template>
                <n-button v-else-if="it.type === 'choice'" size="small" :disabled="readonly || away(r)" @click="openMulti(r, it)">
                  {{ away(r) ? '—' : r.vals && r.vals[it.id] ? multiText(it, r.vals[it.id]) + ' ' + fmtPts(r.parts[it.id].p) : '未填' }}
                </n-button>
                <!-- 勾选 -->
                <n-button
                  v-else-if="it.type === 'check' && !it.multi" size="small" :disabled="readonly || away(r)"
                  :type="r.vals && r.vals[it.id] ? (it.pts < 0 ? 'error' : 'success') : 'default'" :secondary="Boolean(r.vals && r.vals[it.id])" :dashed="!(r.vals && r.vals[it.id])"
                  style="min-width: 48px" @click="save(r, it.id, !(r.vals && r.vals[it.id]))"
                >{{ r.vals && r.vals[it.id] ? fmtPts(it.pts) : '—' }}</n-button>
                <!-- 次数 / 名次 / 手填 -->
                <span v-else class="ps-num">
                  <n-input-number
                    size="small" :show-button="false" :update-value-on-input="false" :disabled="readonly || away(r)"
                    :value="r.vals ? r.vals[it.id] ?? null : null" :placeholder="it.type === 'rank' ? '名次' : '0'" style="width: 64px"
                    @update:value="(v) => save(r, it.id, v)"
                  />
                  <small>{{ it.type === 'rank' ? '名' : it.type === 'check' ? '次' : '' }}</small>
                  <b v-if="r.parts[it.id] && r.parts[it.id].p" :style="{ color: ptsColor(r.parts[it.id].p) }">{{ fmtPts(r.parts[it.id].p) }}</b>
                </span>
              </td>
              <td><b :style="{ color: ptsColor(r.total) }">{{ fmtPts(r.total) }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <n-modal :show="!!multi" preset="card" :title="multi ? `${multi.r.name} · ${multi.it.name}` : ''" style="width: 380px; max-width: 94vw" @update:show="(v) => { if (!v) multi = null }">
      <template v-if="multi">
        <div class="ps-mute" style="margin-bottom: 10px">一场可能有多次，每个选项填次数，分数累加</div>
        <div v-for="(o, k) in multi.it.options" :key="k" class="ps-mrow">
          <span>{{ o.label }} <small :style="{ color: ptsColor(o.pts) }">每次 {{ fmtPts(o.pts) }}</small></span>
          <n-input-number v-model:value="multi.counts[k]" :min="0" :max="99" size="small" style="width: 110px" />
        </div>
      </template>
      <template #footer><n-space justify="end"><n-button @click="multi = null">取消</n-button><n-button type="primary" @click="saveMulti">确定</n-button></n-space></template>
    </n-modal>

    <n-modal v-model:show="showDl" preset="card" :title="s && s.closed ? '重新开放填写' : '改截止时间'" style="width: 420px; max-width: 94vw">
      <n-date-picker v-model:value="dlValue" type="datetime" format="yyyy-MM-dd HH:mm" style="width: 100%" />
      <div class="ps-mute" style="margin-top: 8px">{{ s && s.closed ? '改到以后的时间，成员就又能自己填了；之前自动记的缺席，没填的人会变回「未填」。' : '截止后没填的人自动记缺席。' }}</div>
      <template #footer><n-space justify="end"><n-button @click="showDl = false">取消</n-button><n-button type="primary" @click="saveDl">保存</n-button></n-space></template>
    </n-modal>

    <n-modal v-model:show="showAdd" preset="card" title="加人到这场" style="width: 440px; max-width: 94vw">
      <n-select v-model:value="addIds" multiple filterable :options="addOpts" placeholder="选名单里漏掉的人（当天刚入队等）" />
      <template #footer><n-space justify="end"><n-button @click="showAdd = false">取消</n-button><n-button type="primary" @click="addPeople">加入</n-button></n-space></template>
    </n-modal>
  </n-spin>
</template>

<style scoped>
.ps { display: flex; flex-direction: column; gap: 12px; }
.ps-head { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.ps-meta { flex: 1; min-width: 260px; }
.ps-title { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 10px; margin: 2px 0 6px; }
.ps-gp { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ps-mute { color: #8a9099; font-size: 12px; }
.ps-logs { max-height: 120px; overflow: auto; font-size: 12px; line-height: 1.9; margin-top: 4px; }
.ps-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ps-tbl { background: #fff; border-radius: 10px; overflow: auto; max-height: calc(var(--page-h, 80vh) - 200px); min-height: 300px; }
.ps-tbl table { border-collapse: separate; border-spacing: 0; font-size: 13px; min-width: 100%; }
.ps-tbl th, .ps-tbl td { padding: 6px 8px; border-bottom: 1px solid #efeff5; text-align: center; white-space: nowrap; background: #fff; }
.ps-tbl thead th { position: sticky; top: 0; z-index: 2; background: #fafafc; font-weight: 600; vertical-align: top; }
.ps-tbl th small { display: block; color: #8a9099; font-weight: 400; font-size: 11px; }
.ps-tbl .stk { position: sticky; left: 0; z-index: 1; }
.ps-tbl .stk.nm { left: 36px; text-align: left; }
.ps-tbl thead .stk { z-index: 3; }
.ps-tbl tr.un td { background: #fffdf7; }
.ps-tbl tr.busy td { opacity: .6; }
.ps-tbl a { color: #6c5ce7; cursor: pointer; margin-right: 4px; }
.ps-g { color: #8a9099; font-size: 12px; margin-left: 4px; }
.ps-src { font-size: 12px; display: block; }
.ps-src.self { color: #18a058; } .ps-src.leader { color: #2080f0; } .ps-src.admin { color: #b7770c; } .ps-src.auto { color: #e0203a; } .ps-src.none { color: #d97706; }
.ps-num { display: inline-flex; align-items: center; gap: 4px; }
.ps-num small { color: #8a9099; }
.ps-mrow { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #efeff5; }
.ps-ch.a1 :deep(.n-base-selection-label) { color: #d97706; }
.ps-ch.a2 :deep(.n-base-selection-label) { color: #e0203a; }

/* 可排序的表头 */
th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
th.sortable i { font-style: normal; font-size: 11px; opacity: 0.35; margin-left: 2px; }
th.sortable:hover i, th.sortable.on i { opacity: 1; color: #2563eb; }
</style>

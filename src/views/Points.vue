<script setup>
/**
 * 积分考勤（开发版）：场次 / 积分总览 / 规则与设置 三个页签。
 * 成员在小程序里自己填，组长看本组、代填；这里是管理员建场次、改数、看总表、定规则的地方。
 * 分数都是云函数现算的（handlers/points.js），这边只负责显示和提交。
 */
import { ref, computed, onMounted, inject, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { call } from '../api'
import PointsSession from './PointsSession.vue'
import PointsRules from './PointsRules.vue'
import { fmtPts, ptsColor, dlText, ATT_TEXT } from '../lib/points'

const { narrow } = inject('app')
const message = useMessage()
const tab = ref('sessions')
const cur = ref(null) // 正在看的场次 id
const season = ref('')
const list = ref(null)
const loading = ref(false)
const rules = ref(null)
const groups = ref([])

async function loadList() {
  loading.value = true
  try {
    list.value = await call('points.sessions', season.value ? { season: season.value } : {})
    if (!season.value) season.value = list.value.season
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
async function loadRules() {
  try {
    rules.value = await call('points.rules')
  } catch (e) {
    message.error(e.message)
  }
}
async function loadGroups() {
  try {
    groups.value = (await call('group.list')).groups
  } catch (e) { /* 分组拉不到只是少显示组名 */ }
}
onMounted(() => { loadList(); loadRules(); loadGroups() })
watch(season, (v, o) => { if (o) { loadList(); if (tab.value === 'overview') loadOverview() } })

const seasonOpts = computed(() => (list.value ? list.value.seasons : [season.value]).filter(Boolean).map((s) => ({ label: s + ' 赛季' + (list.value && s === list.value.current ? '（进行中）' : '（已归档）'), value: s })))
const archived = computed(() => Boolean(list.value && season.value !== list.value.current))
const gname = (gid) => (groups.value.find((g) => g.id === gid) || {}).name || '未分组'

/* ---------- 新建场次 ---------- */
const OFF = 8 * 3600 * 1000
const todayStr = () => new Date(Date.now() + OFF).toISOString().slice(0, 10)
const dayStart = (s) => Date.parse(s + 'T00:00:00+08:00')
function defaultDeadline(dateStr) {
  const mode = rules.value ? rules.value.rules.settings.deadline : 'day2359'
  if (mode === 'plus6h') return Date.now() + 6 * 3600 * 1000
  if (mode === 'next1200') return dayStart(dateStr) + 36 * 3600 * 1000
  return dayStart(dateStr) + (23 * 60 + 59) * 60 * 1000
}
const showNew = ref(false)
const form = ref({ date: dayStart(todayStr()), title: '', tplId: '', deadline: 0 })
const creating = ref(false)
function openNew() {
  if (!rules.value) return
  const t = rules.value.rules.templates[0]
  const d = todayStr()
  form.value = { date: dayStart(d), title: '', tplId: t ? t.id : '', deadline: defaultDeadline(d) }
  showNew.value = true
}
const dateStrOf = (ms) => new Date(ms + OFF).toISOString().slice(0, 10)
watch(() => form.value.date, (v) => { if (showNew.value && v) form.value.deadline = defaultDeadline(dateStrOf(v)) })
const tplOpts = computed(() => (rules.value ? rules.value.rules.templates.map((t) => ({ label: `${t.name}（${t.items.length} 项）`, value: t.id })) : []))
async function create() {
  if (!form.value.tplId) return message.warning('先选模板')
  creating.value = true
  try {
    const tpl = rules.value.rules.templates.find((t) => t.id === form.value.tplId)
    const r = await call('points.create', { date: dateStrOf(form.value.date), title: form.value.title || tpl.name, tplId: form.value.tplId, deadline: form.value.deadline })
    showNew.value = false
    await loadList()
    cur.value = r.id
    showShare.value = true
  } catch (e) {
    message.error(e.message)
  } finally {
    creating.value = false
  }
}
const showShare = ref(false)

/* ---------- 总览 ---------- */
const ov = ref(null)
const ovLoading = ref(false)
const ovGroup = ref(null)
async function loadOverview() {
  ovLoading.value = true
  try {
    ov.value = await call('points.overview', { season: season.value })
  } catch (e) {
    message.error(e.message)
  } finally {
    ovLoading.value = false
  }
}
watch(tab, (t) => {
  if (t === 'overview') loadOverview()
  if (t === 'sessions') loadList()
})
/* 表头排序：点一次从高到低，再点从低到高，第三次回到默认（按排名） */
const ovSort = ref({ key: '', dir: -1 })
const unfilledOf = (r) => r.cells.filter((c) => c && !c.by).length
const OV_KEY = { total: (r) => r.total, away: (r) => r.absent * 1000 + r.leave, unfilled: unfilledOf }
function sortOv(key) {
  const s = ovSort.value
  ovSort.value = s.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : { key: '', dir: -1 }
}
const sortMark = (s, key) => (s.key !== key ? '⇅' : s.dir === -1 ? '↓' : '↑')
const ovRows = computed(() => {
  if (!ov.value) return []
  const rows = ov.value.rows.filter((r) => !ovGroup.value || r.groupId === ovGroup.value)
  const { key, dir } = ovSort.value
  if (!key) return rows
  const f = OV_KEY[key]
  return rows.slice().sort((a, b) => dir * (f(a) - f(b)) || a.rank - b.rank)
})
const groupOpts = computed(() => [{ label: '全部分组', value: null }, ...groups.value.map((g) => ({ label: g.name, value: g.id }))])

/* ---------- 成员明细抽屉 ---------- */
const drawer = ref(null)
const drawerLoading = ref(false)
const drawerFocus = ref(null)
async function openMember(mid, sid) {
  drawerLoading.value = true
  drawerFocus.value = sid || null
  drawer.value = { loading: true }
  try {
    drawer.value = await call('points.member', { memberId: mid, season: season.value })
  } catch (e) {
    message.error(e.message)
    drawer.value = null
  } finally {
    drawerLoading.value = false
  }
}
const SRC = { self: '本人填', leader: '组长填', admin: '管理员填', auto: '截止未填 · 自动缺席' }

function back() {
  cur.value = null
  loadList()
}
</script>

<template>
  <div>
    <PointsSession v-if="cur" :id="cur" :groups="groups" :archived="archived" @back="back" @share="showShare = true" @member="openMember" />

    <n-space v-else vertical :size="16">
      <div class="pt-top">
        <n-tabs v-model:value="tab" type="segment" style="max-width: 420px">
          <n-tab name="sessions">场次</n-tab>
          <n-tab name="overview">积分总览</n-tab>
          <n-tab name="rules">规则与设置</n-tab>
        </n-tabs>
        <n-select v-if="tab !== 'rules'" v-model:value="season" :options="seasonOpts" size="small" style="width: 180px" />
      </div>

      <!-- 场次 -->
      <div v-if="tab === 'sessions'" key="sessions" class="pt-sec">
        <div class="pt-bar">
          <n-button type="primary" :disabled="archived || !rules" @click="openNew">＋ 新建场次</n-button>
          <span class="pt-mute">建好后去小程序「积分考勤」里转发卡片到盟群，成员点开直接填；{{ rules && rules.rules.settings.autoAbsent === false ? '截止没填的留给组长处理' : '截止没填的自动记缺席' }}</span>
        </div>
        <n-alert v-if="archived" type="warning" :bordered="false">{{ season }} 赛季已归档，只能看不能改。</n-alert>
        <n-spin :show="loading">
          <div class="pt-grid">
            <div v-for="s in list ? list.sessions : []" :key="s.id" class="pt-sess" :class="{ open: !s.closed }" @click="cur = s.id">
              <div class="pt-badge">
                <n-tag size="small" round :bordered="false" :type="s.closed ? 'default' : 'success'">{{ s.closed ? '已截止' : '填写中' }}</n-tag>
              </div>
              <div class="pt-d">{{ s.date }} {{ s.week }} · 模板「{{ s.tpl }}」</div>
              <div class="pt-t">{{ s.title }}</div>
              <template v-if="!s.closed">
                <n-progress type="line" :percentage="s.progress.all ? Math.round(s.progress.done / s.progress.all * 100) : 0" :show-indicator="false" :height="6" color="#6c5ce7" style="margin-top: 10px" />
                <div class="pt-st"><span>已填 <b>{{ s.progress.done }}</b>/{{ s.progress.all }}</span><span>{{ dlText(s.deadline) }} 截止</span></div>
              </template>
              <div v-else class="pt-st">
                <span>已填 <b>{{ s.progress.done }}</b></span><span>请假 <b>{{ s.progress.leave }}</b></span><span>缺席 <b>{{ s.progress.absent }}</b></span>
              </div>
              <div v-if="s.logCount" class="pt-mute" style="margin-top: 8px">组长/管理员改过 {{ s.logCount }} 处</div>
            </div>
          </div>
          <n-empty v-if="list && !list.sessions.length" :description="archived ? '这个赛季没有场次' : '这个赛季还没有场次，点「新建场次」开始'" style="margin: 40px 0" />
        </n-spin>
      </div>

      <!-- 总览 -->
      <div v-if="tab === 'overview'" key="overview" class="pt-sec">
        <div class="pt-bar">
          <n-select v-model:value="ovGroup" :options="groupOpts" placeholder="全部分组" size="small" style="width: 140px" />
          <span class="pt-mute">点格子看这个人这场的明细；「不在队」= 那场名单里没有他，不算缺席</span>
          <n-button size="small" style="margin-left: auto" :loading="ovLoading" @click="loadOverview">刷新</n-button>
        </div>
        <n-spin :show="ovLoading">
          <div v-if="ov" class="pt-ov">
            <table>
              <thead>
                <tr>
                  <th class="stk">#</th><th class="stk nm">成员</th><th>小组</th>
                  <th class="sortable" :class="{ on: ovSort.key === 'total' }" @click="sortOv('total')">{{ ov.season }} 合计 <i>{{ sortMark(ovSort, 'total') }}</i></th>
                  <th class="sortable" :class="{ on: ovSort.key === 'unfilled' }" @click="sortOv('unfilled')">没填 <i>{{ sortMark(ovSort, 'unfilled') }}</i></th>
                  <th class="sortable" :class="{ on: ovSort.key === 'away' }" @click="sortOv('away')">缺 / 假 <i>{{ sortMark(ovSort, 'away') }}</i></th>
                  <th v-for="c in ov.cols" :key="c.id" class="col">{{ c.date.slice(5) }}<small>{{ c.title }}</small></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in ovRows" :key="r.mid">
                  <td class="stk">{{ r.rank }}</td>
                  <td class="stk nm"><a @click="openMember(r.mid)">{{ r.name }}</a><n-tag v-if="!r.inRoster" size="tiny" :bordered="false">已离队</n-tag></td>
                  <td class="pt-mute">{{ gname(r.groupId) }}</td>
                  <td><b :style="{ color: ptsColor(r.total) }">{{ fmtPts(r.total) }}</b></td>
                  <td :class="unfilledOf(r) ? 'lvc' : 'pt-mute'">{{ unfilledOf(r) || '—' }}</td>
                  <td class="pt-mute">{{ r.absent }} / {{ r.leave }}</td>
                  <td v-for="(c, i) in r.cells" :key="i" class="cell" @click="c && openMember(r.mid, ov.cols[i].id)">
                    <span v-if="!c" class="pt-mute small">不在队</span>
                    <template v-else>
                      <span :style="{ color: ptsColor(c.total) }">{{ fmtPts(c.total) }}</span>
                      <small v-if="c.att === 1 || c.att === 2" :class="c.att === 2 ? 'abs' : 'lv'">{{ ATT_TEXT[c.att] }}</small>
                      <small v-else-if="!c.by" class="lv">未填</small>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
            <n-empty v-if="!ov.rows.length" description="这个赛季还没有分数" style="margin: 30px 0" />
          </div>
        </n-spin>
      </div>

      <PointsRules v-if="tab === 'rules'" :data="rules" @saved="(r) => (rules = r)" />
    </n-space>

    <!-- 新建场次 -->
    <n-modal v-model:show="showNew" preset="card" title="新建场次" style="width: 520px; max-width: 94vw">
      <n-form label-placement="left" label-width="72">
        <n-form-item label="日期"><n-date-picker v-model:value="form.date" type="date" /></n-form-item>
        <n-form-item label="标题"><n-input v-model:value="form.title" maxlength="24" placeholder="比如：城战 · 襄阳（不填就用模板名）" /></n-form-item>
        <n-form-item label="模板"><n-radio-group v-model:value="form.tplId"><n-radio-button v-for="o in tplOpts" :key="o.value" :value="o.value" :label="o.label" /></n-radio-group></n-form-item>
        <n-form-item label="截止"><n-date-picker v-model:value="form.deadline" type="datetime" format="yyyy-MM-dd HH:mm" /></n-form-item>
      </n-form>
      <div class="pt-mute">名单取当前同盟（{{ list ? '离队的不算' : '' }}），漏掉的人建好后在场次里「加人」。</div>
      <template #footer>
        <n-space justify="end"><n-button @click="showNew = false">取消</n-button><n-button type="primary" :loading="creating" @click="create">创建</n-button></n-space>
      </template>
    </n-modal>

    <!-- 分享提示 -->
    <n-modal v-model:show="showShare" preset="card" title="发到微信群让大家填" style="width: 460px; max-width: 94vw">
      <ol class="pt-ol">
        <li>手机打开小程序 → 「积分考勤」，点这一场</li>
        <li>右上角「转发」到盟群（组长可以从「小组」页转发到小组群，卡片只显示本组进度）</li>
        <li>成员点卡片直接进填写页，填完马上算分；{{ rules && rules.rules.settings.autoAbsent === false ? '截止没填的留给组长处理' : '截止没填的自动记缺席' }}</li>
      </ol>
      <div class="pt-mute">浏览器发不了微信卡片，转发要在小程序里做。</div>
      <template #footer><n-space justify="end"><n-button type="primary" @click="showShare = false">知道了</n-button></n-space></template>
    </n-modal>

    <!-- 成员明细 -->
    <n-drawer :show="!!drawer" :width="narrow ? '100%' : 480" @update:show="(v) => { if (!v) drawer = null }">
      <n-drawer-content v-if="drawer" :title="drawer.member ? drawer.member.name : '加载中'" closable>
        <n-spin :show="drawerLoading">
          <template v-if="drawer.summary">
            <div class="pt-stat">
              <div><b :style="{ color: ptsColor(drawer.summary.total) }">{{ fmtPts(drawer.summary.total) }}</b><span>{{ drawer.season }} 累计</span></div>
              <div><b>{{ drawer.summary.rank || '—' }}</b><span>盟内排名</span></div>
              <div><b>{{ drawer.summary.n }}</b><span>参加场次</span></div>
              <div><b>{{ drawer.summary.absent }} / {{ drawer.summary.leave }}</b><span>缺席 / 请假</span></div>
            </div>
            <div class="pt-mute" style="margin: 6px 0 12px">{{ gname(drawer.member.groupId) }}{{ drawer.member.leader ? ' · 组长' : '' }}</div>
            <p v-if="drawer.missed.length" class="pt-mute">{{ drawer.missed.join('、') }} 不在当场名单里（未入队或已离队），不计分也不算缺席。</p>
            <div v-for="s in drawer.sessions" :key="s.id" class="pt-hist" :class="{ focus: drawerFocus === s.id }">
              <div class="h" @click="drawerFocus = drawerFocus === s.id ? null : s.id">
                <span class="pt-mute">{{ s.date }}</span><b style="flex: 1">{{ s.title }}</b>
                <n-tag v-if="s.log.length" size="tiny" type="warning" :bordered="false">改过</n-tag>
                <span class="pt-mute small">{{ SRC[s.by] || '未填' }}</span>
                <b :style="{ color: ptsColor(s.total) }">{{ fmtPts(s.total) }}</b>
              </div>
              <div v-if="drawerFocus === s.id || !drawerFocus" class="x">
                <div v-for="p in s.parts" :key="p.id"><span>{{ p.name }}</span><span>{{ p.shown }}</span><span :style="{ color: ptsColor(p.p) }">{{ fmtPts(p.p) }}</span></div>
                <div v-for="(l, i) in s.log" :key="i" class="pt-log">{{ dlText(l.at) }} {{ l.who }} {{ l.to === '代填' && !l.item ? '代填' : `改「${l.item}」${l.from} → ${l.to}` }}{{ l.late ? '（截止后）' : '' }}</div>
              </div>
            </div>
            <n-empty v-if="!drawer.sessions.length" description="这个赛季还没有记录" />
          </template>
        </n-spin>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.pt-sec { display: flex; flex-direction: column; gap: 16px; }
.pt-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: space-between; }
.pt-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pt-mute { color: #8a9099; font-size: 13px; }
.small { font-size: 12px; }
.pt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.pt-sess { background: #fff; border-radius: 10px; padding: 14px 16px; cursor: pointer; border: 1px solid transparent; position: relative; }
.pt-sess:hover { border-color: #c8c0ff; }
.pt-sess.open { border-color: #d9d3ff; }
.pt-badge { position: absolute; right: 12px; top: 12px; }
.pt-d { color: #8a9099; font-size: 12px; }
.pt-t { font-size: 16px; font-weight: 600; margin-top: 4px; }
.pt-st { display: flex; gap: 14px; font-size: 12px; color: #555; margin-top: 8px; }
.pt-st b { font-size: 14px; color: #1f2329; }
.pt-ov { background: #fff; border-radius: 10px; overflow: auto; max-height: calc(var(--page-h, 80vh) - 110px); }
.pt-ov table { border-collapse: separate; border-spacing: 0; font-size: 13px; min-width: 100%; }
.pt-ov th, .pt-ov td { padding: 8px 10px; border-bottom: 1px solid #efeff5; white-space: nowrap; text-align: center; background: #fff; }
.pt-ov thead th { position: sticky; top: 0; z-index: 2; background: #fafafc; font-weight: 600; }
.pt-ov th small { display: block; color: #8a9099; font-weight: 400; font-size: 11px; }
.pt-ov .stk { position: sticky; left: 0; z-index: 1; }
.pt-ov .stk.nm { left: 38px; text-align: left; }
.pt-ov thead .stk { z-index: 3; }
.pt-ov a { color: #6c5ce7; cursor: pointer; }
.pt-ov .cell { cursor: pointer; }
.pt-ov .cell:hover { background: #f4f2ff; }
.pt-ov .cell small { display: block; font-size: 11px; }
.lv { color: #d97706; } .abs { color: #e0203a; }
.pt-ol { padding-left: 20px; line-height: 2; margin: 0 0 8px; }
.pt-stat { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center; }
.pt-stat b { display: block; font-size: 20px; }
.pt-stat span { font-size: 12px; color: #8a9099; }
.pt-hist { border: 1px solid #efeff5; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
.pt-hist.focus { border-color: #6c5ce7; }
.pt-hist .h { display: flex; gap: 8px; align-items: center; padding: 10px 12px; cursor: pointer; background: #fafafc; }
.pt-hist .x { padding: 6px 12px 10px; font-size: 13px; }
.pt-hist .x > div:not(.pt-log) { display: grid; grid-template-columns: 1fr auto 48px; gap: 8px; padding: 3px 0; }
.pt-hist .x > div > span:last-child { text-align: right; }
.pt-log { color: #b7770c; font-size: 12px; }

/* 可排序的表头 */
th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
th.sortable i { font-style: normal; font-size: 11px; opacity: 0.35; margin-left: 2px; }
th.sortable:hover i, th.sortable.on i { opacity: 1; color: #2563eb; }
.lvc { color: #d97706; font-weight: 600; }
</style>

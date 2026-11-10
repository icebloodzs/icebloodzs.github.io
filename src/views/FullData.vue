<script setup>
/**
 * 全员数据：一张表把每个人的名单数据、自填资料、六维都摆出来，列和导入导出的 Excel 一一对应
 * （账号名称、六维更新时间、关联状态、阶位、主玩阵营、最高加成、战力、实力、步 / 骑 / 弓兵等级、四维、六维、六项属性）。
 * 表头老写法（步兵营等级、步兵防御力、步兵生命值、骑兵破坏力……）导入时也认。
 *
 * 导出：就是表格右上角的「导出 Excel」，表头即导入用的表头，导出的文件改完可以原样导回来。
 * 导入：在浏览器里读表、认表头，按行发给云函数 admin.importFull，先预演、确认后再写。
 * 按名字认人，只用比库里新的数据（规则写在云函数 handlers/fulldata.js）。
 * 手动改：点成员名字，右边滑出编辑面板，只把改过的那几组发给 admin.editFull。
 */
import { ref, inject, computed, h, reactive } from 'vue'
import { useMessage } from 'naive-ui'
import TableCard from './TableCard.vue'
import { call } from '../api'
import { readWorkbook } from '../sheet'
import { big, num, sorter } from '../fmt'
import { indexCol } from '../cols'

const { members, reload, narrow } = inject('app')
const message = useMessage()

const ATTRS = [
  ['infDef', '步兵防御'], ['infHp', '步兵生命'], ['cavAtk', '骑兵攻击'],
  ['cavBreak', '骑兵破坏'], ['arcAtk', '弓兵攻击'], ['arcBreak', '弓兵破坏']
]
const FOUR = ['infDef', 'infHp', 'arcAtk', 'arcBreak']
const ARMS = [['inf', '步兵等级'], ['cav', '骑兵等级'], ['arc', '弓兵等级']]
/** 兵营档位从低到高，键同云函数 lib/season.js 的 TIERS */
const TIERS = [['L9', '9级'], ['L10', '10级'], ['1', '宫1'], ['2', '宫2'], ['3', '宫3'], ['4', '宫4']]
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

const sumOf = (r, keys) => {
  const vals = keys.map((k) => r.attrs && r.attrs[k]).filter((v) => v !== null && v !== undefined)
  return vals.length ? Math.round(vals.reduce((a, b) => a + Number(b), 0) * 100) / 100 : null
}
const rankText = (r) => (r.rank ? (CN[r.rank] || r.rank) + '阶' : '')
/** 兵营等级 = 这个兵种填了兵力的最高一档；兵力没填就用导入表时记下的档位 */
const tierOf = (r, arm) => {
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    const one = r.troopsByLevel && r.troopsByLevel[TIERS[i][0]]
    if (one && Number(one[arm]) > 0) return TIERS[i][1]
  }
  const lv = r.barracksLv && r.barracksLv[arm]
  const hit = TIERS.find(([k]) => k === lv)
  return hit ? hit[1] : ''
}
/** 2026-10-28 16:22:26（北京时间，和导入时的解析对得上） */
const stamp = (iso) => {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600000)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
const dash = (v) => (v === null || v === undefined || v === '' ? h('span', { style: 'color:#c0c4cc' }, '—') : v)

const textCol = (title, key, get, width = 100) => ({
  title, key, width, sorter: sorter(get), render: (r) => dash(get(r)), xls: get
})
const numberCol = (title, key, get, digits = 0, width = 100) => ({
  title, key, width, sorter: sorter(get),
  render: (r) => dash(get(r) === null || get(r) === undefined ? null : num(get(r), digits)),
  xls: (r) => (get(r) === null || get(r) === undefined ? '' : Number(get(r)))
})
const bigNumCol = (title, key, width = 100) => ({
  title, key, width, sorter: sorter((r) => r[key]),
  render: (r) => dash(r[key] === null || r[key] === undefined ? null : big(r[key])),
  xls: (r) => (r[key] === null || r[key] === undefined ? '' : Number(r[key]))
})

const columns = computed(() => [
  // 序号列表头留空；导回来时空表头那列会被跳过
  { ...indexCol, title: '' },
  {
    title: '账号名称', key: 'name', width: 130, fixed: 'left', sorter: sorter((r) => r.name), xls: (r) => r.name,
    render: (r) => h('a', { class: 'fd-name', title: '点击修改', onClick: () => openEdit(r) }, r.name)
  },
  textCol('阶位', 'rank', rankText, 70),
  textCol('主玩阵营', 'camps', (r) => (r.camps || []).join('、'), 150),
  numberCol('最高加成', 'maxBonus', (r) => r.maxBonus, 2, 90),
  bigNumCol('战力', 'power'),
  bigNumCol('实力', 'strength'),
  ...ARMS.map(([arm, title]) => textCol(title, 'tier_' + arm, (r) => tierOf(r, arm), 100)),
  numberCol('四维', 'four', (r) => sumOf(r, FOUR), 0, 80),
  numberCol('六维', 'six', (r) => sumOf(r, ATTRS.map(([k]) => k)), 0, 80),
  ...ATTRS.map(([k, title]) => numberCol(title, k, (r) => (r.attrs ? r.attrs[k] : null), 0, 100)),
  textCol('关联状态', 'boundUid', (r) => (r.boundUid ? '已关联' : '未关联'), 90),
  textCol('六维更新时间', 'attrsUpdatedAt', (r) => stamp(r.attrsUpdatedAt), 160)
])

// ---------------- 手动修改 ----------------

const RANKS = Array.from({ length: 10 }, (_, i) => ({ label: CN[i + 1] + '阶', value: i + 1 }))
const TIER_OPTIONS = TIERS.map(([value, label]) => ({ label, value })).reverse()
const CAMPS = ['群雄', '魏国', '吴国', '蜀国']

const editing = ref(null) // 正在改的那一行
const saving = ref(false)
const form = reactive({ rank: null, power: null, strength: null, camps: [], maxBonus: null, tiers: {}, attrs: {} })
let origin = ''

/** 填了兵力的兵种，档位按兵力算，不让手改 */
const troopTier = (r, arm) => {
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    const one = r.troopsByLevel && r.troopsByLevel[TIERS[i][0]]
    if (one && Number(one[arm]) > 0) return TIERS[i][1]
  }
  return ''
}

/** 当前表单里各组的值，用来比有没有改过 */
const snapshot = () => JSON.stringify({
  roster: [form.rank, form.power, form.strength],
  profile: [[...form.camps].sort(), form.maxBonus],
  tiers: form.tiers,
  attrs: form.attrs
})

function openEdit(r) {
  editing.value = r
  form.rank = r.rank || null
  form.power = r.power ?? null
  form.strength = r.strength ?? null
  form.camps = (r.camps || []).slice()
  form.maxBonus = r.maxBonus ?? null
  form.tiers = Object.fromEntries(ARMS.map(([arm]) => [arm, (r.barracksLv && r.barracksLv[arm]) || null]))
  form.attrs = Object.fromEntries(ATTRS.map(([k]) => [k, r.attrs && r.attrs[k] !== undefined && r.attrs[k] !== null ? Number(r.attrs[k]) : null]))
  origin = snapshot()
}

const formSum = (keys) => {
  const vals = keys.map((k) => form.attrs[k]).filter((v) => v !== null && v !== undefined)
  return vals.length ? Math.round(vals.reduce((a, b) => a + Number(b), 0)) : '—'
}
const dirty = computed(() => editing.value && snapshot() !== origin)

async function saveEdit() {
  const before = JSON.parse(origin)
  const now = JSON.parse(snapshot())
  const payload = { memberId: editing.value._id }
  const blankOr = (v) => (v === null || v === undefined ? '' : v)
  if (JSON.stringify(before.roster) !== JSON.stringify(now.roster)) {
    Object.assign(payload, { rank: blankOr(form.rank), power: blankOr(form.power), strength: blankOr(form.strength) })
  }
  if (JSON.stringify(before.profile) !== JSON.stringify(now.profile)) {
    Object.assign(payload, { camps: form.camps, maxBonus: blankOr(form.maxBonus) })
  }
  if (JSON.stringify(before.tiers) !== JSON.stringify(now.tiers)) {
    payload.barracksLv = Object.fromEntries(ARMS.map(([arm]) => [arm, blankOr(form.tiers[arm])]))
  }
  if (JSON.stringify(before.attrs) !== JSON.stringify(now.attrs)) {
    payload.attrs = Object.fromEntries(ATTRS.map(([k]) => [k, blankOr(form.attrs[k])]))
  }
  saving.value = true
  try {
    await call('admin.editFull', payload)
    message.success(`已保存「${editing.value.name}」`)
    editing.value = null
    await reload()
  } catch (err) {
    message.error(err.message)
  } finally {
    saving.value = false
  }
}

// ---------------- 导入 ----------------

/** 表头 → 字段；别的工具导出的表头写法略有不同也能认 */
const HEAD = {
  name: ['账号名称', '成员名称', '成员', '名称', '名字'],
  attrsAt: ['六维更新时间', '属性更新时间', '资料更新'],
  rank: ['阶位', '阶级'],
  camps: ['主玩阵营', '阵营'],
  maxBonus: ['最高加成', '最高集结值', '集结值'],
  power: ['战力'],
  strength: ['实力'],
  inf: ['步兵等级', '步兵营等级', '步兵营'],
  cav: ['骑兵等级', '骑兵营等级', '骑兵营'],
  arc: ['弓兵等级', '弓兵营等级', '弓兵营']
}
const ATTR_HEAD = {
  infDef: ['步兵防御', '步兵防御力'], infHp: ['步兵生命', '步兵生命值'],
  cavAtk: ['骑兵攻击', '骑兵攻击力'], cavBreak: ['骑兵破坏', '骑兵破坏力'],
  arcAtk: ['弓兵攻击', '弓兵攻击力'], arcBreak: ['弓兵破坏', '弓兵破坏力']
}
const clean = (s) => String(s || '').replace(/\s/g, '')

/** 找到带「账号名称」这类表头的那张表，按行转成 { name, attrsAt, …, attrs: {} } */
function toRows(sheets) {
  for (const { aoa } of sheets) {
    const hi = aoa.findIndex((row) => row.some((c) => HEAD.name.includes(clean(c))))
    if (hi < 0) continue
    const head = aoa[hi].map(clean)
    const at = (names) => head.findIndex((c) => names.includes(c))
    const idx = Object.fromEntries(Object.entries(HEAD).map(([k, names]) => [k, at(names)]))
    const aidx = Object.fromEntries(Object.entries(ATTR_HEAD).map(([k, names]) => [k, at(names)]))
    return aoa.slice(hi + 1).map((r) => {
      const row = { attrs: {} }
      Object.entries(idx).forEach(([k, i]) => { if (i >= 0) row[k] = r[i] })
      Object.entries(aidx).forEach(([k, i]) => { if (i >= 0) row.attrs[k] = r[i] })
      return row
    }).filter((r) => String(r.name || '').trim())
  }
  return null
}

/** 表的时间：文件名里的 13 位毫秒时间戳（游戏导出就是这么命名的），没有就用文件的修改时间 */
function fileTime(file) {
  const m = file.name.match(/(\d{13})/)
  const ms = m ? Number(m[1]) : 0
  if (ms > Date.UTC(2020, 0, 1) && ms < Date.now() + 86400000) return new Date(ms)
  return new Date(file.lastModified || Date.now())
}

const picker = ref(null)
const busy = ref(false)
const pending = ref(null) // { rows, snapshotAt, fileName }
const preview = ref(null)
const showPreview = ref(false)

function pickFile() {
  if (picker.value) {
    picker.value.value = ''
    picker.value.click()
  }
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  busy.value = true
  try {
    const rows = toRows(await readWorkbook(file))
    if (!rows || !rows.length) throw new Error('没找到「账号名称」列，请用本页导出的表格式')
    pending.value = { rows, snapshotAt: fileTime(file).toISOString(), fileName: file.name }
    preview.value = await send(true)
    showPreview.value = true
  } catch (err) {
    message.error(err.message)
  } finally {
    busy.value = false
  }
}

/** 网关请求体有上限，一次发 80 行；结果按批合起来 */
async function send(dryRun) {
  const { rows, snapshotAt } = pending.value
  const total = { total: 0, matched: 0, changed: 0, unchanged: 0, attrs: 0, roster: 0, profile: 0, barracks: 0, unmatched: [], duplicates: [], list: [] }
  for (let i = 0; i < rows.length; i += 80) {
    const res = await call('admin.importFull', { rows: rows.slice(i, i + 80), snapshotAt, dryRun })
    ;['total', 'matched', 'changed', 'unchanged', 'attrs', 'roster', 'profile', 'barracks'].forEach((k) => { total[k] += res[k] || 0 })
    ;['unmatched', 'duplicates', 'list'].forEach((k) => { total[k] = total[k].concat(res[k] || []) })
  }
  return total
}

async function confirmImport() {
  busy.value = true
  try {
    const res = await send(false)
    showPreview.value = false
    message.success(`导入完成：更新 ${res.changed} 人`)
    pending.value = null
    await reload()
  } catch (err) {
    message.error(err.message)
  } finally {
    busy.value = false
  }
}

const snapText = computed(() => (pending.value ? stamp(pending.value.snapshotAt).slice(0, 16) : ''))
</script>

<template>
  <div class="page">
    <TableCard
      title="全员数据"
      sheet-name="成员"
      desc="每个人的名单数据、自填资料和六维都在这一张表里。导出的 Excel 改完可以直接导回来，也支持把其他平台或自己统计的数据直接导入。点红色的账号名称可以修改这个人的数据。"
      :columns="columns"
      :rows="members"
      :scroll-x="2100"
    >
      <template #actions>
        <n-button :loading="busy" @click="pickFile">导入 Excel</n-button>
      </template>
    </TableCard>
    <input ref="picker" type="file" accept=".xlsx,.xls" style="display:none" @change="onFile" />

    <n-drawer :show="!!editing" :width="narrow ? '100%' : 460" placement="right" @update:show="(v) => { if (!v && !saving) editing = null }">
      <n-drawer-content v-if="editing" closable :native-scrollbar="false" body-content-style="padding: 18px 22px">
        <template #header>
          <div class="ed-head">
            <span class="ed-name">{{ editing.name }}</span>
            <n-tag size="small" :bordered="false" :type="editing.boundUid ? 'success' : 'default'">{{ editing.boundUid ? '已关联' : '未关联' }}</n-tag>
          </div>
          <div class="ed-sub">六维更新 {{ editing.attrsUpdatedAt ? stamp(editing.attrsUpdatedAt).slice(0, 16) : '从未' }}</div>
        </template>

        <div class="ed-sec">名单数据</div>
        <div class="ed-grid3">
          <div class="ed-field"><label>阶位</label><n-select v-model:value="form.rank" :options="RANKS" clearable placeholder="—" /></div>
          <div class="ed-field">
            <label>战力<span v-if="form.power">{{ big(form.power) }}</span></label>
            <n-input-number v-model:value="form.power" :min="0" :show-button="false" placeholder="—" />
          </div>
          <div class="ed-field">
            <label>实力<span v-if="form.strength">{{ big(form.strength) }}</span></label>
            <n-input-number v-model:value="form.strength" :min="0" :show-button="false" placeholder="—" />
          </div>
        </div>

        <div class="ed-sec">资料</div>
        <div class="ed-field">
          <label>主玩阵营</label>
          <div class="ed-camps">
            <button v-for="c in CAMPS" :key="c" type="button" :class="['ed-camp', { on: form.camps.includes(c) }]"
              @click="form.camps = form.camps.includes(c) ? form.camps.filter((x) => x !== c) : [...form.camps, c]">{{ c }}</button>
          </div>
        </div>
        <div class="ed-grid4">
          <div class="ed-field">
            <label>最高加成</label>
            <n-input-number v-model:value="form.maxBonus" :min="0" :step="0.1" :show-button="false" placeholder="—"><template #suffix>%</template></n-input-number>
          </div>
          <div v-for="[arm, title] in ARMS" :key="arm" class="ed-field">
            <label>{{ title }}<span v-if="troopTier(editing, arm)" title="填了兵力的兵种，等级按兵力算">按兵力</span></label>
            <n-input v-if="troopTier(editing, arm)" :value="troopTier(editing, arm)" disabled />
            <n-select v-else v-model:value="form.tiers[arm]" :options="TIER_OPTIONS" clearable placeholder="—" />
          </div>
        </div>

        <div class="ed-sec">六维 <span class="ed-sum">四维 <b>{{ formSum(FOUR) }}</b> · 六维 <b>{{ formSum(ATTRS.map(([k]) => k)) }}</b></span></div>
        <div class="ed-grid2">
          <div v-for="[k, title] in ATTRS" :key="k" class="ed-field">
            <label>{{ title }}</label>
            <n-input-number v-model:value="form.attrs[k]" :min="0" :show-button="false" placeholder="—" />
          </div>
        </div>
        <div class="ed-note">改了六维会记成「管理员修改」，更新时间按现在算，成长榜照常统计。</div>

        <template #footer>
          <n-space justify="end">
            <n-button :disabled="saving" @click="editing = null">取消</n-button>
            <n-button type="primary" :loading="saving" :disabled="!dirty" @click="saveEdit">保存</n-button>
          </n-space>
        </template>
      </n-drawer-content>
    </n-drawer>

    <n-modal v-model:show="showPreview" preset="card" title="导入预演" style="width: 640px; max-width: 94vw" :mask-closable="!busy">
      <template v-if="preview">
        <div class="fd-file">{{ pending && pending.fileName }} · 表格时间 {{ snapText }}</div>
        <n-space size="small" style="margin: 10px 0 14px">
          <n-tag :bordered="false">共 {{ preview.total }} 行</n-tag>
          <n-tag :bordered="false" type="success">认出 {{ preview.matched }} 人</n-tag>
          <n-tag :bordered="false" type="info">要更新 {{ preview.changed }} 人</n-tag>
          <n-tag :bordered="false">没变化 {{ preview.unchanged }}</n-tag>
          <n-tag v-if="preview.unmatched.length" :bordered="false" type="warning">对不上 {{ preview.unmatched.length }}</n-tag>
        </n-space>
        <div class="fd-line">六维 {{ preview.attrs }} 人 · 阶位/战力/实力 {{ preview.roster }} 人 · 阵营/加成 {{ preview.profile }} 人 · 兵营等级 {{ preview.barracks }} 人</div>
        <div v-if="preview.unmatched.length" class="fd-warn">
          系统里没有这些名字（新人请先「导入名单」，改过名的先在名单里合并）：{{ preview.unmatched.join('、') }}
        </div>
        <div v-if="preview.duplicates.length" class="fd-warn">表里重复出现，只用了第一行：{{ preview.duplicates.join('、') }}</div>
        <div v-if="preview.list.length" class="fd-list">
          <div v-for="c in preview.list" :key="c.name" class="fd-row"><b>{{ c.name }}</b><span>{{ c.groups.join(' · ') }}</span></div>
        </div>
      </template>
      <template #footer>
        <n-space justify="end">
          <n-button :disabled="busy" @click="showPreview = false">取消</n-button>
          <n-button type="primary" :loading="busy" :disabled="!preview || !preview.changed" @click="confirmImport">确认导入</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page { height: var(--page-h); min-height: 360px; }
.fd-file { color: #6b7280; font-size: 13px; }
.fd-line { color: #374151; font-size: 13px; margin-bottom: 8px; }
.fd-warn { color: #b45309; font-size: 13px; margin-bottom: 8px; line-height: 1.6; }
.fd-list { max-height: 300px; overflow: auto; border: 1px solid #eef0f4; border-radius: 8px; padding: 6px 12px; }
.fd-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #f0f1f4; }
.fd-row:last-child { border-bottom: none; }
.fd-row span { color: #6b7280; }

/* 成员名可点，点了右侧滑出编辑面板 */
:deep(.fd-name) { font-weight: 600; color: #e03e3e; cursor: pointer; border-bottom: 1px dashed #f0a3a3; }
:deep(.fd-name:hover) { color: #b42318; border-bottom-color: #b42318; }

.ed-head { display: flex; align-items: center; gap: 10px; }
.ed-name { font-size: 18px; font-weight: 700; }
.ed-sub { font-size: 12px; color: #9aa0a6; font-weight: 400; margin-top: 4px; }
.ed-sec { display: flex; align-items: baseline; justify-content: space-between; font-size: 13px; font-weight: 700; color: #6c5ce7;
  margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #f0f1f4; }
.ed-sec:first-child { margin-top: 0; }
.ed-sum { font-weight: 400; color: #6b7280; }
.ed-sum b { color: #1f2329; font-variant-numeric: tabular-nums; }
.ed-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.ed-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.ed-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.ed-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; margin-bottom: 2px; }
.ed-field label { font-size: 12px; color: #6b7280; display: flex; justify-content: space-between; }
.ed-field label span { color: #9aa0a6; }
.ed-camps { display: flex; gap: 8px; margin-bottom: 12px; }
.ed-camp { flex: 1; height: 32px; border-radius: 8px; border: 1px solid #e0e3e8; background: #fff; color: #4b5563; font-size: 13px; cursor: pointer; transition: all .15s; }
.ed-camp:hover { border-color: #6c5ce7; color: #6c5ce7; }
.ed-camp.on { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
.ed-note { font-size: 12px; color: #9aa0a6; margin-top: 12px; }
</style>

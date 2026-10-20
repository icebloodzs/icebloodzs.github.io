<script setup>
/**
 * 考勤功勋：把每次导入的名单快照算成出勤表（口径同山河出勤表脚本，算法在云函数 lib/attendance.js）。
 *
 * 一条考勤记录 = 某个时间点的一份名单 + 描述 + 是否隐藏：
 *   - 当天功勋 = 这份名单的总功勋 − 时间上前一份的总功勋，够达标线就算出勤；
 *   - 隐藏的记录不出列，只当后一份的基准（打之前导一份隐藏的，打完再导一份）。
 * 表不存库，每次按全部记录现算，所以改时间 / 隐藏 / 删记录，表都会自己对上。
 */
import { ref, computed, h, inject } from 'vue'
import { useMessage, useDialog, NTag, NTooltip, NDropdown, NSwitch, NButton, NPopconfirm } from 'naive-ui'
import { call } from '../api'
import { big, when, sorter } from '../fmt'
import { buildStyledExcel } from '../xlsx'

const { me } = inject('app')
const message = useMessage()
const dialog = useDialog()

const data = ref(null)
const loading = ref(false)
const season = ref('')

async function load() {
  loading.value = true
  try {
    data.value = await call('attendance.table', { season: season.value })
    season.value = data.value.season
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
load()

const isCurrent = computed(() => data.value && data.value.season === data.value.currentSeason)

// ---------------- 筛选 ----------------

const keyword = ref('')
const status = ref('all')
const rateBelow = ref(80)
const labels = ref([])
const range = ref(null)
const showLeft = ref(false)
const showMerit = ref(true)

const STATUS = [
  { label: '全部', value: 'all' },
  { label: '满勤', value: 'perfect' },
  { label: '有缺勤', value: 'missed' },
  { label: '零出勤', value: 'zero' },
  { label: '出勤率低于…', value: 'below' },
  { label: '有标签', value: 'tagged' }
]

const labelOptions = computed(() => {
  const set = new Set(((data.value && data.value.columns) || []).map((c) => c.label || '（无描述）'))
  return [...set].map((l) => ({ label: l, value: l }))
})

/** 按描述 / 时间段筛出来要显示的那几天 */
const shownCols = computed(() => {
  const cols = (data.value && data.value.columns) || []
  return cols.filter((c) => {
    if (labels.value.length && !labels.value.includes(c.label || '（无描述）')) return false
    if (range.value) {
      const t = new Date(c.at).getTime()
      const end = range.value[1] + 86400000 - 1
      if (t < range.value[0] || t > end) return false
    }
    return true
  })
})
const filtered = computed(() => shownCols.value.length !== ((data.value && data.value.columns) || []).length)

/**
 * 每个人在「当前看得到的这几天」里的出勤：筛了时间段 / 描述时，出勤天数和出勤率按筛出来的这几天重算，
 * 不筛就跟总表一模一样。
 */
const rows = computed(() => {
  if (!data.value) return []
  const cols = shownCols.value
  const kw = keyword.value.trim().toLowerCase()
  return data.value.rows
    .filter((r) => showLeft.value || r.inRoster)
    .map((r) => {
      let days = 0
      let tagged = false
      cols.forEach((c) => {
        const cell = r.cells[c.id]
        if (cell && cell.ok) days += 1
        if (cell && cell.tag) tagged = true
      })
      return { ...r, viewDays: days, viewRate: cols.length ? days / cols.length : null, tagged }
    })
    .filter((r) => {
      if (kw && !(r.name.toLowerCase().includes(kw) || r.formerNames.some((n) => n.toLowerCase().includes(kw)))) return false
      if (status.value === 'perfect') return cols.length && r.viewDays === cols.length
      if (status.value === 'missed') return r.viewDays < cols.length
      if (status.value === 'zero') return cols.length && r.viewDays === 0
      if (status.value === 'below') return r.viewRate != null && r.viewRate * 100 < rateBelow.value
      if (status.value === 'tagged') return r.tagged
      return true
    })
})

const summary = computed(() => {
  const list = rows.value.filter((r) => r.inRoster)
  const cols = shownCols.value.length
  const rates = list.map((r) => r.viewRate).filter((v) => v != null)
  return [
    ['成员人数', list.length],
    ['有效天数', cols],
    ['平均出勤率', rates.length ? pct(rates.reduce((s, v) => s + v, 0) / rates.length) : '—'],
    ['满勤', list.filter((r) => cols && r.viewDays === cols).length],
    ['零出勤', list.filter((r) => cols && r.viewDays === 0).length],
    ['达标线', big(data.value ? data.value.threshold : 0)]
  ]
})

function pct(v) {
  return v == null ? '—' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%'
}

function md(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}号`
}

// ---------------- 表格 ----------------

/** 标签配色同出勤表脚本：缺勤红、摸鱼橙、未守紫、请假玫红，别的用青色 */
const TAG_COLOR = {
  缺勤: { color: '#fdecec', textColor: '#b71c1c' },
  摸鱼: { color: '#fff1e0', textColor: '#e65100' },
  未守: { color: '#f3e5f5', textColor: '#6a1b9a' },
  请假: { color: '#fce4ec', textColor: '#ad1457' }
}
const TAGS = ['缺勤', '摸鱼', '未守', '请假']

function tagMenu(col, row) {
  const cell = row.cells[col.id]
  return [
    ...TAGS.map((t) => ({ label: t, key: t })),
    { label: '自定义…', key: '__custom' },
    { type: 'divider', key: 'd1' },
    { label: '不标', key: '__none', disabled: !cell.tag },
    { label: '恢复导入时的', key: '__reset' }
  ]
}

async function onTag(col, row, key) {
  const cell = row.cells[col.id]
  if (key === '__custom') {
    const t = window.prompt(`给「${cell.name}」${md(col.at)}${col.label ? '（' + col.label + '）' : ''} 标个标签（8 个字以内）`, cell.tag || '')
    if (t === null) return
    return saveTag(col, cell, { tag: t.trim() })
  }
  if (key === '__reset') return saveTag(col, cell, { reset: true })
  return saveTag(col, cell, { tag: key === '__none' ? '' : key })
}

async function saveTag(col, cell, body) {
  try {
    await call('attendance.tag', { id: col.id, name: cell.name, ...body })
    await load()
  } catch (e) {
    message.error(e.message)
  }
}

function dayCell(col, row) {
  const cell = row.cells[col.id]
  if (!cell) return h('span', { class: 'att-blank' }, '—')
  const text = showMerit.value ? big(cell.merit) : cell.ok ? '✓' : '✗'
  const tag = cell.tag ? h(NTag, { size: 'tiny', bordered: false, color: TAG_COLOR[cell.tag] || { color: '#e0f2f1', textColor: '#00695c' }, style: 'margin-left:4px' }, () => cell.tag) : null
  const body = h('div', { class: ['att-cell', cell.ok ? 'att-ok' : 'att-no'] }, [h('span', text), tag])
  const tip = `${cell.name}　当天功勋 ${Number(cell.merit).toLocaleString('zh-CN')}　${cell.ok ? '达标' : '未达标'}${cell.tag ? '　标签：' + cell.tag : ''}`
  const withTip = h(NTooltip, { placement: 'top' }, { trigger: () => body, default: () => tip })
  if (!isCurrent.value) return withTip
  return h(NDropdown, { trigger: 'click', options: tagMenu(col, row), onSelect: (k) => onTag(col, row, k) }, () => h('span', [withTip]))
}

const columns = computed(() => {
  const fixed = [
    {
      title: '成员名称',
      key: 'name',
      width: 150,
      fixed: 'left',
      sorter: sorter((r) => r.name),
      render: (r) => h('div', { class: 'att-name' }, [
        h('span', { style: r.inRoster ? '' : 'color:#9ca3af' }, r.name),
        r.inRoster ? null : h(NTag, { size: 'tiny', bordered: false, style: 'margin-left:4px' }, () => '已离队'),
        r.formerNames.length ? h('div', { class: 'att-former' }, '曾用 ' + r.formerNames.join('、')) : null
      ])
    },
    { title: '战力', key: 'power', width: 92, sorter: sorter((r) => r.power), render: (r) => big(r.power) },
    { title: '实力', key: 'strength', width: 92, sorter: sorter((r) => r.strength), render: (r) => big(r.strength) },
    {
      title: '出勤率',
      key: 'viewRate',
      width: 84,
      sorter: sorter((r) => r.viewRate),
      defaultSortOrder: 'descend',
      render: (r) => h('b', { style: `color:${r.viewRate === 1 ? '#16a34a' : r.viewRate < 0.6 ? '#dc2626' : '#374151'}` }, pct(r.viewRate))
    },
    { title: '出勤天数', key: 'viewDays', width: 84, sorter: sorter((r) => r.viewDays), render: (r) => `${r.viewDays} / ${shownCols.value.length}` },
    { title: '总功勋', key: 'total', width: 100, sorter: sorter((r) => r.total), render: (r) => big(r.total) }
  ]
  const days = shownCols.value.map((c) => ({
    key: c.id,
    width: 118,
    align: 'center',
    sorter: sorter((r) => (r.cells[c.id] ? r.cells[c.id].merit : null)),
    title: () => h('div', { class: 'att-head' }, [
      h('div', md(c.at)),
      h('div', { class: 'att-label' }, c.label || '—'),
      h('div', { class: 'att-rate' }, [
        pct(c.rate),
        c.partial ? h(NTag, { size: 'tiny', bordered: false, type: 'warning', style: 'margin-left:4px' }, () => '残缺') : null,
        c.reset ? h(NTag, { size: 'tiny', bordered: false, type: 'info', style: 'margin-left:4px' }, () => '重置') : null
      ])
    ]),
    render: (r) => dayCell(c, r)
  }))
  return fixed.concat(days)
})
const scrollX = computed(() => 602 + shownCols.value.length * 118)

// ---------------- 人员变动 ----------------

const changes = computed(() => {
  const c = data.value && data.value.changes
  if (!c) return null
  const fmt = (list, f) => list.map(f).join('、')
  return {
    joins: fmt(c.joins, (x) => `${x.name}(${md(x.at)})`),
    leaves: fmt(c.leaves, (x) => `${x.name}(${md(x.after)}后)`),
    renames: fmt(c.renames, (x) => `${x.from}→${x.to}(${md(x.at)})`),
    joinN: c.joins.length,
    leaveN: c.leaves.length,
    renameN: c.renames.length
  }
})
const changeCount = computed(() => (changes.value ? changes.value.joinN + changes.value.leaveN + changes.value.renameN : 0))

// ---------------- 导出 ----------------

const exporting = ref(false)
async function exportExcel() {
  if (exporting.value || !data.value) return
  exporting.value = true
  try {
    const cols = shownCols.value
    const head = ['成员名称', '战力', '实力', '出勤率', '出勤天数', '总功勋'].concat(cols.map((c) => `${md(c.at)}(${c.label || '—'})`))
    const rateRow = ['每日出勤率', '', '', '', '', ''].concat(cols.map((c) => pct(c.rate)))
    const aoa = [head, rateRow]
    // 0 表头 / 1 普通 / 2 达标 / 3 不达标 / 4 不在队 / 5 有标签
    const styles = [
      { fill: '6C5CE7', color: 'FFFFFF', bold: true, size: 11 },
      { color: '222222', size: 11 },
      { fill: 'E8F5E9', color: '1B5E20', size: 11 },
      { fill: 'FFEBEE', color: 'B71C1C', size: 11 },
      { fill: 'F3F4F6', color: '9CA3AF', size: 11 },
      { fill: 'FFF3E0', color: 'E65100', size: 11 }
    ]
    const cellStyles = [head.map(() => 0), rateRow.map(() => 0)]
    rows.value.forEach((r) => {
      const line = [r.name, r.power ?? '', r.strength ?? '', pct(r.viewRate), r.viewDays, r.total ?? '']
      const st = line.map(() => 1)
      cols.forEach((c) => {
        const cell = r.cells[c.id]
        if (!cell) {
          line.push('—')
          st.push(4)
        } else {
          line.push(cell.tag ? `${cell.merit} ${cell.tag}` : cell.merit)
          st.push(cell.tag ? 5 : cell.ok ? 2 : 3)
        }
      })
      aoa.push(line)
      cellStyles.push(st)
    })
    const ally = (me.value && me.value.alliance && me.value.alliance.name) || ''
    await buildStyledExcel(
      { aoa, styles, cellStyles, cols: head.map((t, i) => ({ wch: i === 0 ? 18 : i < 6 ? 14 : 16 })) },
      '出勤表',
      `${ally}${data.value.season}_出勤表_${new Date().toISOString().slice(0, 10)}.xlsx`
    )
  } catch (e) {
    message.error(e.message)
  } finally {
    exporting.value = false
  }
}

// ---------------- 达标线 ----------------

const thrOpen = ref(false)
const thrValue = ref(500000)
function openThreshold() {
  thrValue.value = data.value ? data.value.threshold : 500000
  thrOpen.value = true
}
async function saveThreshold() {
  try {
    await call('attendance.settings', { threshold: thrValue.value })
    thrOpen.value = false
    message.success('达标线改好了，出勤表已重算')
    await load()
  } catch (e) {
    message.error(e.message)
  }
}

// ---------------- 读文件 ----------------

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''))
    fr.onerror = () => reject(new Error('文件读不出来'))
    fr.readAsDataURL(file)
  })
}

// ---------------- 新增一条 ----------------

const LABELS = ['攻城', '守城', '水战', '集结', '活动']
const addOpen = ref(false)
const add = ref(null)
const adding = ref(false)

function openAdd() {
  add.value = { at: Date.now(), label: '', hidden: false, mode: 'file', base64: '', fileName: '', sheets: [], sheet: null, text: '' }
  addOpen.value = true
}

async function pickAddFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    const base64 = await readFile(file)
    const res = await call('attendance.parse', { base64 })
    const sheets = res.sheets.filter((s) => s.kind === 'roster')
    if (!sheets.length) return message.error('这个表格里没有带「成员名称」表头的工作表')
    Object.assign(add.value, { base64, fileName: file.name, sheets, sheet: sheets[sheets.length - 1].sheet })
    applyGuess()
  } catch (err) {
    message.error(err.message)
  }
}

/** 选中的工作表名能猜出日期 / 描述 / 隐藏的话，顺手填上（描述没填过才填） */
function applyGuess() {
  const s = add.value.sheets.find((x) => x.sheet === add.value.sheet)
  if (!s || !s.guess) return
  add.value.hidden = s.guess.hidden
  if (!add.value.label) add.value.label = s.guess.label
}

const addSheet = computed(() => add.value && add.value.sheets.find((x) => x.sheet === add.value.sheet))

async function submitAdd() {
  const a = add.value
  if (a.mode === 'file' && !a.base64) return message.warning('先选表格文件')
  if (a.mode === 'text' && !a.text.trim()) return message.warning('先把名单粘进来')
  if (!a.hidden && !a.label.trim()) return message.warning('写一句描述（比如 攻城 / 守城），隐藏的可以不写')
  adding.value = true
  try {
    const body = { at: a.at, label: a.label.trim(), hidden: a.hidden }
    if (a.mode === 'file') Object.assign(body, { base64: a.base64, sheet: a.sheet })
    else body.text = a.text
    const res = await call('attendance.create', body)
    message.success(`已加上 ${md(res.record.at)}${res.record.label ? '（' + res.record.label + '）' : ''}，${res.record.count} 人`)
    addOpen.value = false
    await load()
  } catch (e) {
    message.error(e.message)
  } finally {
    adding.value = false
  }
}

// ---------------- 整本导入（以前脚本用的源数据表） ----------------

const bookOpen = ref(false)
const book = ref(null)
const importing = ref(false)

function openBook() {
  book.value = { base64: '', fileName: '', sheets: [] }
  bookOpen.value = true
}

async function pickBookFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    const base64 = await readFile(file)
    const res = await call('attendance.parse', { base64 })
    book.value = {
      base64,
      fileName: file.name,
      sheets: res.sheets.map((s) => ({
        ...s,
        pick: s.kind === 'roster' && !s.exists && Boolean(s.guess),
        at: s.guess ? new Date(s.guess.at).getTime() : Date.now(),
        label: s.guess ? s.guess.label : '',
        hidden: s.guess ? s.guess.hidden : false
      }))
    }
  } catch (err) {
    message.error(err.message)
  }
}

const bookPicked = computed(() => (book.value ? book.value.sheets.filter((s) => s.pick) : []))

async function submitBook() {
  if (!bookPicked.value.length) return message.warning('没勾要导入的工作表')
  importing.value = true
  try {
    const res = await call('attendance.importBook', {
      base64: book.value.base64,
      picks: bookPicked.value.map((s) => ({ sheet: s.sheet, at: s.at, label: s.label, hidden: s.hidden }))
    })
    const skipped = res.skipped.length ? `，跳过 ${res.skipped.length} 张（${res.skipped.map((x) => x.sheet + '：' + x.why).join('；')}）` : ''
    message.success(`导入了 ${res.added.length} 张${skipped}`, { duration: 6000 })
    bookOpen.value = false
    await load()
  } catch (e) {
    message.error(e.message)
  } finally {
    importing.value = false
  }
}

// ---------------- 记录管理 ----------------

const recOpen = ref(false)
const editing = ref(null)

async function patchRecord(rec, patch) {
  try {
    await call('attendance.update', { id: rec._id, ...patch })
    await load()
  } catch (e) {
    message.error(e.message)
  }
}

async function removeRecord(rec) {
  try {
    await call('attendance.remove', { id: rec._id })
    message.success('删掉了，出勤表已重算')
    await load()
  } catch (e) {
    message.error(e.message)
  }
}

function openEdit(rec) {
  editing.value = { rec, at: new Date(rec.at).getTime(), label: rec.label }
}

async function saveEdit() {
  const e = editing.value
  await patchRecord(e.rec, { at: e.at, label: e.label })
  editing.value = null
}

const recColumns = [
  { title: '时间', key: 'at', width: 150, render: (r) => when(r.at) },
  { title: '描述', key: 'label', width: 100, render: (r) => r.label || h('span', { style: 'color:#9ca3af' }, '—') },
  {
    title: '隐藏',
    key: 'hidden',
    width: 70,
    render: (r) => h(NSwitch, { size: 'small', value: r.hidden, disabled: !isCurrent.value, onUpdateValue: (v) => patchRecord(r, { hidden: v }) })
  },
  {
    title: '人数',
    key: 'count',
    width: 90,
    render: (r) => [String(r.count), r.partial ? h(NTag, { size: 'tiny', bordered: false, type: 'warning', style: 'margin-left:4px' }, () => '残缺') : null]
  },
  { title: '来源', key: 'sheet', render: (r) => r.sheet || '粘贴' },
  {
    title: '',
    key: 'op',
    width: 110,
    render: (r) => (isCurrent.value
      ? [
          h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(r) }, () => '改'),
          h(NPopconfirm, { onPositiveClick: () => removeRecord(r) }, {
            trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, () => '删'),
            default: () => '删掉这条，出勤表会按剩下的重算'
          })
        ]
      : null)
  }
]

function help() {
  dialog.info({
    title: '考勤怎么算',
    style: 'width: 560px',
    content: () => h('div', { style: 'line-height:1.9' }, [
      h('p', '每条考勤记录是某个时间点导出的一份同盟名单（成员名称 / 火炉 / 战力 / 周功勋 / 总功勋 / 实力）。'),
      h('p', '当天功勋 = 这份名单的总功勋 − 时间上前一份的总功勋，够达标线就算出勤；第一份没得减，直接取周功勋。'),
      h('p', '打之前先导一份「隐藏」的当基准，打完再导一份写上描述 —— 隐藏的不出列、不计有效天数，只当后一份的起点。'),
      h('p', '改名、离队又回来、名字转手、赛季重置都会自动认，历史出勤跟着人走。点表格里某一天的格子可以标「缺勤 / 摸鱼 / 请假」，标签只是备注，不改判定。'),
      h('p', '出勤率 = 出勤天数 / 有效天数；入队前的那几天显示 —，也算在分母里（跟以前的出勤表一样）。')
    ])
  })
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card :bordered="false">
      <div class="att-top">
        <n-space align="center" :size="10">
          <n-select v-model:value="season" :options="((data && data.seasons) || []).map((s) => ({ label: s, value: s }))" style="width: 100px" @update:value="load" />
          <n-tag v-if="data && !isCurrent" type="warning" :bordered="false">往期赛季，只能看</n-tag>
          <n-button text type="primary" @click="help">怎么算的？</n-button>
        </n-space>
        <n-space :size="10">
          <n-button v-if="isCurrent" type="primary" @click="openAdd">新增考勤</n-button>
          <n-button v-if="isCurrent" @click="openBook">导入源数据表</n-button>
          <n-button @click="recOpen = true">记录管理<template v-if="data">（{{ data.records.length }}）</template></n-button>
          <n-button v-if="isCurrent" @click="openThreshold">达标线</n-button>
          <n-button :loading="exporting" :disabled="!rows.length" @click="exportExcel">导出 Excel</n-button>
        </n-space>
      </div>

      <div class="att-stats">
        <div v-for="s in summary" :key="s[0]" class="att-stat">
          <span>{{ s[0] }}</span><b>{{ s[1] }}</b>
        </div>
      </div>

      <n-collapse v-if="changes && changeCount" class="att-changes">
        <n-collapse-item :title="`人员变动：改名 ${changes.renameN} · 离开 ${changes.leaveN} · 加入 ${changes.joinN}`" name="c">
          <div v-if="changes.renames"><b>改名</b> {{ changes.renames }}</div>
          <div v-if="changes.leaves"><b>离开</b> {{ changes.leaves }}</div>
          <div v-if="changes.joins"><b>加入</b> {{ changes.joins }}</div>
        </n-collapse-item>
      </n-collapse>
    </n-card>

    <n-card :bordered="false">
      <div class="att-filters">
        <n-input v-model:value="keyword" placeholder="搜成员名（含曾用名）" clearable style="width: 190px" />
        <n-select v-model:value="status" :options="STATUS" style="width: 140px" />
        <n-input-number v-if="status === 'below'" v-model:value="rateBelow" :min="1" :max="100" style="width: 110px">
          <template #suffix>%</template>
        </n-input-number>
        <n-select v-model:value="labels" :options="labelOptions" multiple clearable placeholder="全部描述" style="width: 200px" />
        <n-date-picker v-model:value="range" type="daterange" clearable start-placeholder="开始日期" end-placeholder="结束日期" style="width: 250px" />
        <n-checkbox v-model:checked="showLeft">含已离队</n-checkbox>
        <n-checkbox v-model:checked="showMerit">显示功勋数</n-checkbox>
        <span class="att-count">{{ rows.length }} 人<template v-if="filtered"> · 筛出 {{ shownCols.length }} 天，出勤率按这几天算</template></span>
      </div>

      <n-empty v-if="data && !data.records.length" description="还没有考勤记录。点「新增考勤」导一份名单，或者把以前脚本用的源数据表整本导进来" style="padding: 60px 0" />
      <n-data-table
        v-else
        :loading="loading"
        :columns="columns"
        :data="rows"
        :row-key="(r) => r.pid"
        :scroll-x="scrollX"
        :max-height="'calc(100vh - 420px)'"
        :bordered="false"
        size="small"
        striped
      />
    </n-card>

    <!-- 新增一条 -->
    <n-modal v-model:show="addOpen" preset="card" title="新增考勤" :style="{ width: '600px' }">
      <n-form v-if="add" label-placement="left" label-width="80">
        <n-form-item label="时间">
          <n-date-picker v-model:value="add.at" type="datetime" style="width: 220px" />
        </n-form-item>
        <n-form-item label="描述">
          <n-space vertical :size="6" style="width: 100%">
            <n-input v-model:value="add.label" maxlength="20" placeholder="攻城 / 守城 / 水战 …" />
            <n-space :size="6">
              <n-tag v-for="l in LABELS" :key="l" checkable :checked="add.label === l" @update:checked="add.label = l">{{ l }}</n-tag>
            </n-space>
          </n-space>
        </n-form-item>
        <n-form-item label="隐藏">
          <n-switch v-model:value="add.hidden" />
          <span class="att-hint">隐藏的不出列，只当下一份的基准（开打前导一份）</span>
        </n-form-item>
        <n-form-item label="成员数据">
          <n-space vertical :size="8" style="width: 100%">
            <n-radio-group v-model:value="add.mode" size="small">
              <n-radio-button value="file">上传表格</n-radio-button>
              <n-radio-button value="text">粘贴</n-radio-button>
            </n-radio-group>
            <template v-if="add.mode === 'file'">
              <label class="att-file">
                <input type="file" accept=".xlsx,.xls,.csv" hidden @change="pickAddFile" />
                <n-button tag="span" size="small">{{ add.fileName ? '换一个文件' : '选择 Excel 文件' }}</n-button>
                <span v-if="add.fileName" class="att-hint">{{ add.fileName }}</span>
              </label>
              <n-select
                v-if="add.sheets.length > 1"
                v-model:value="add.sheet"
                :options="add.sheets.map((s) => ({ label: `${s.sheet}（${s.count} 人${s.exists ? '，已导过' : ''}）`, value: s.sheet }))"
                @update:value="applyGuess"
              />
              <div v-if="addSheet" class="att-hint">
                读到 {{ addSheet.count }} 人<template v-if="addSheet.partial">，<b style="color:#d97706">没有总功勋列</b>，按周功勋算</template>
                <template v-if="addSheet.exists">，<b style="color:#d97706">这张表导过了</b></template>
              </div>
            </template>
            <n-input
              v-else
              v-model:value="add.text"
              type="textarea"
              :rows="6"
              placeholder="同盟名单整段粘进来，保留表头（成员名称 / 火炉等级 / 战力 / 周功勋 / 总功勋 / 实力）"
            />
          </n-space>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="addOpen = false">取消</n-button>
          <n-button type="primary" :loading="adding" @click="submitAdd">加上</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 整本导入 -->
    <n-modal v-model:show="bookOpen" preset="card" title="导入源数据表" :style="{ width: '820px' }">
      <n-alert type="info" :bordered="false" style="margin-bottom: 12px">
        以前出勤表脚本用的那本「源数据表」：一个工作表一天，表名写成「10月19号(攻城)」「10月19号(隐藏)」，
        日期、描述、隐藏会按表名自动填好，核对一下再导。已经导过的表会跳过。
      </n-alert>
      <label class="att-file">
        <input type="file" accept=".xlsx,.xls" hidden @change="pickBookFile" />
        <n-button tag="span">{{ book && book.fileName ? '换一个文件' : '选择源数据表' }}</n-button>
        <span v-if="book && book.fileName" class="att-hint">{{ book.fileName }}</span>
      </label>
      <n-table v-if="book && book.sheets.length" size="small" :bordered="false" style="margin-top: 12px">
        <thead>
          <tr><th style="width:36px" /><th>工作表</th><th style="width:210px">时间</th><th style="width:120px">描述</th><th style="width:60px">隐藏</th><th style="width:110px">人数</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in book.sheets" :key="s.sheet">
            <td><n-checkbox v-model:checked="s.pick" :disabled="s.kind !== 'roster' || s.exists" /></td>
            <td>
              {{ s.sheet }}
              <n-tag v-if="s.exists" size="tiny" :bordered="false">已导过</n-tag>
              <n-tag v-else-if="s.kind !== 'roster'" size="tiny" :bordered="false" type="warning">不是名单</n-tag>
            </td>
            <td><n-date-picker v-model:value="s.at" type="datetime" size="small" :disabled="!s.pick" /></td>
            <td><n-input v-model:value="s.label" size="small" :disabled="!s.pick || s.hidden" /></td>
            <td><n-switch v-model:value="s.hidden" size="small" :disabled="!s.pick" /></td>
            <td>{{ s.count }}<n-tag v-if="s.partial" size="tiny" :bordered="false" type="warning" style="margin-left:4px">残缺</n-tag></td>
          </tr>
        </tbody>
      </n-table>
      <template #footer>
        <n-space justify="end">
          <n-button @click="bookOpen = false">取消</n-button>
          <n-button type="primary" :loading="importing" :disabled="!bookPicked.length" @click="submitBook">导入 {{ bookPicked.length }} 张</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 记录管理 -->
    <n-drawer v-model:show="recOpen" :width="720">
      <n-drawer-content title="考勤记录" closable>
        <n-alert type="default" :bordered="false" style="margin-bottom: 12px">
          按时间新的在上。改时间、开关隐藏、删记录之后出勤表自动重算；名单本身导错了就删掉重导。
        </n-alert>
        <n-data-table :columns="recColumns" :data="(data && data.records) || []" size="small" :bordered="false" />
      </n-drawer-content>
    </n-drawer>

    <n-modal :show="Boolean(editing)" preset="card" title="改这条记录" :style="{ width: '420px' }" @update:show="(v) => { if (!v) editing = null }">
      <n-form v-if="editing" label-placement="left" label-width="60">
        <n-form-item label="时间"><n-date-picker v-model:value="editing.at" type="datetime" /></n-form-item>
        <n-form-item label="描述"><n-input v-model:value="editing.label" maxlength="20" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editing = null">取消</n-button>
          <n-button type="primary" @click="saveEdit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="thrOpen" preset="card" title="达标线" :style="{ width: '420px' }">
      <n-space vertical>
        <span class="att-hint">当天功勋达到多少算出勤。以前的出勤表是 50 万。</span>
        <n-input-number v-model:value="thrValue" :min="1" :step="100000" style="width: 100%" />
        <span class="att-hint">= {{ big(thrValue) }}</span>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="thrOpen = false">取消</n-button>
          <n-button type="primary" @click="saveThreshold">保存并重算</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>

<style scoped>
.att-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
.att-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 16px; }
.att-stat { background: #f7f6ff; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
.att-stat span { font-size: 12px; color: #6b7280; }
.att-stat b { font-size: 20px; color: #1f2937; }
.att-changes { margin-top: 14px; line-height: 1.8; font-size: 13px; }
.att-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.att-count { color: #6b7280; font-size: 13px; }
.att-hint { color: #6b7280; font-size: 12px; margin-left: 8px; }
.att-file { display: inline-flex; align-items: center; cursor: pointer; }
.att-name { line-height: 1.3; }
.att-former { font-size: 11px; color: #9ca3af; }
.att-head { line-height: 1.35; font-weight: 600; }
.att-label { color: #8b4513; font-size: 12px; }
.att-rate { color: #1f3864; font-size: 12px; font-weight: 400; }
:deep(.att-cell) { border-radius: 6px; padding: 3px 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 88px; }
:deep(.att-ok) { background: #e8f5e9; color: #1b5e20; }
:deep(.att-no) { background: #ffebee; color: #b71c1c; }
:deep(.att-blank) { color: #c0c4cc; }
</style>

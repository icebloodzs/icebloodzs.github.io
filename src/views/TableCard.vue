<script setup>
/**
 * 列表页的壳：标题 + 说明 + 搜索 + 导出 Excel + 表格。
 * 六个列表页长得都一样，统一到这里，各页只管给列定义。
 *
 * 列定义就是 naive-ui 那套，额外认一个 xls(row, index)：导出时这一列取什么值，不写就按 key 取。
 * index 是**当前排序后**的行号，和表格里看到的序号一致。
 */
import { ref, computed, inject, h } from 'vue'
import { useMessage } from 'naive-ui'
import { buildExcel } from '../xlsx'

const props = defineProps({
  title: String,
  desc: String,
  columns: { type: Array, required: true },
  rows: { type: Array, required: true },
  search: { type: Boolean, default: true },
  scrollX: { type: Number, default: 0 }
})

const message = useMessage()
// 手机：搜索框和导出挪到标题下面一整行，表格不撑满整页高、改成最多七成屏高
const { narrow = ref(false) } = inject('app', {})
const keyword = ref('')
const busy = ref(false)

/*
 * 手机：不摆宽表格（横着滑体验很差），每行变一张卡片 ——
 * 第一列（成员名）当卡片标题，其余列「列名：值」两两一排，值用的还是列定义里的 render，跟表格里看到的一样。
 * 排序换成一个下拉框（能排的列就是表头上能点的那些）+ 升降序切换。
 */
const titleOf = (c) => (typeof c.title === 'function' ? c.key : c.title)
const sortable = computed(() => props.columns.filter((c) => typeof c.sorter === 'function'))
const defaultSort = props.columns.find((c) => c.defaultSortOrder)
const sortKey = ref(defaultSort ? defaultSort.key : '')
const sortDesc = ref(defaultSort ? defaultSort.defaultSortOrder !== 'ascend' : true)
const sortOptions = computed(() => [{ label: '默认顺序', value: '' }].concat(sortable.value.map((c) => ({ label: '按' + titleOf(c), value: c.key }))))
const cardRows = computed(() => {
  const col = sortable.value.find((c) => c.key === sortKey.value)
  if (!col) return shown.value
  const list = shown.value.slice().sort(col.sorter)
  return sortDesc.value ? list.reverse() : list
})
const headCol = computed(() => props.columns.find((c) => c.key === 'name') || props.columns[0])
const bodyCols = computed(() => props.columns.filter((c) => c !== headCol.value && c.title))
/** 用列定义的 render 画一格；没有 render 就直接取值 */
const Cell = (p) => {
  const c = p.col
  const v = c.render ? c.render(p.row, p.index) : p.row[c.key]
  return v === null || v === undefined || v === '' ? h('span', { style: 'color:#c0c4cc' }, '—') : v
}

const shown = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.rows
  return props.rows.filter((r) => String(r.name || '').toLowerCase().includes(kw))
})

async function exportExcel() {
  if (busy.value) return
  busy.value = true
  try {
    const cols = props.columns.filter((c) => c.title)
    const aoa = [cols.map((c) => c.title)]
    shown.value.forEach((r, i) => {
      aoa.push(cols.map((c) => {
        const v = c.xls ? c.xls(r, i) : r[c.key]
        return v === null || v === undefined ? '' : v
      }))
    })
    await buildExcel({ aoa, sheetName: props.title, name: `${props.title}-${new Date().toISOString().slice(0, 10)}.xlsx` })
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <n-card
    class="tc"
    :title="title"
    :bordered="false"
    content-style="display:flex;flex-direction:column;min-height:0"
  >
    <template v-if="!narrow" #header-extra>
      <n-space align="center">
        <n-input v-if="search" v-model:value="keyword" placeholder="搜成员名" clearable style="width: 180px" />
        <n-button :loading="busy" @click="exportExcel">导出 Excel</n-button>
      </n-space>
    </template>
    <div v-if="narrow" class="tc-bar">
      <n-input v-if="search" v-model:value="keyword" placeholder="搜成员名" clearable size="small" />
      <n-button size="small" :loading="busy" @click="exportExcel">导出</n-button>
    </div>
    <div v-if="narrow && sortable.length" class="tc-bar">
      <n-select v-model:value="sortKey" :options="sortOptions" size="small" />
      <n-button size="small" :disabled="!sortKey" @click="sortDesc = !sortDesc">{{ sortDesc ? '从高到低' : '从低到高' }}</n-button>
    </div>

    <n-alert v-if="desc" type="info" :bordered="false" style="margin-bottom: 14px">{{ desc }}</n-alert>
    <slot name="filters" />

    <!-- flex-height：表格自己占满剩下的高度，表头钉住、只有表体滚 -->
    <div v-if="narrow" class="tc-cards">
      <div class="tc-count">{{ cardRows.length }} 人</div>
      <div v-for="(row, i) in cardRows" :key="row._id || row.uid || i" class="tc-card">
        <div class="tc-head"><span class="tc-no">{{ i + 1 }}</span><Cell :col="headCol" :row="row" :index="i" /></div>
        <div class="tc-kv">
          <div v-for="c in bodyCols" :key="c.key" class="tc-item" :class="{ wide: (c.width || 0) >= 200 }">
            <span class="tc-k">{{ titleOf(c) }}</span>
            <span class="tc-v"><Cell :col="c" :row="row" :index="i" /></span>
          </div>
        </div>
      </div>
      <n-empty v-if="!cardRows.length" description="没有符合的成员" style="padding: 30px 0" />
    </div>
    <n-data-table
      v-else
      :flex-height="!narrow"
      :max-height="narrow ? '70vh' : undefined"
      :columns="columns"
      :data="shown"
      :bordered="false"
      size="small"
      :scroll-x="scrollX || undefined"
      striped
      :style="narrow ? '' : 'flex: 1; min-height: 0'"
    />
    <div class="count">共 {{ shown.length }} 人</div>
  </n-card>
</template>

<style scoped>
/* 撑满外面给的高度；外面没给确定高度时退化成原来那样跟着内容长 */
.tc { height: 100%; display: flex; flex-direction: column; }
.tc :deep(.n-card__content) { min-height: 0; }
.tc-bar { display: flex; gap: 8px; margin-bottom: 10px; }
.tc-bar > :first-child { flex: 1; }
.tc-count { font-size: 12px; color: #8a9099; margin-bottom: 4px; }
.tc-card { padding: 10px 2px; border-top: 1px solid #f0f0f5; }
.tc-head { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.tc-no { width: 22px; flex: none; font-size: 12px; color: #9aa0a6; text-align: right; }
.tc-kv { margin: 6px 0 0 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 12px; }
.tc-item { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 13px; }
/* 表格里本来就很宽的列（比如两档兵力并排）在卡片里独占一行，不然会挤到旁边那格上 */
.tc-item.wide { grid-column: 1 / -1; }
.tc-k { flex: none; color: #9aa0a6; font-size: 12px; }
.tc-v { min-width: 0; word-break: break-all; font-variant-numeric: tabular-nums; }
.count { margin-top: 10px; color: #8a9099; font-size: 12px; flex: none; }
</style>

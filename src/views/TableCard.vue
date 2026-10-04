<script setup>
/**
 * 列表页的壳：标题 + 说明 + 搜索 + 导出 Excel + 表格。
 * 六个列表页长得都一样，统一到这里，各页只管给列定义。
 *
 * 列定义就是 naive-ui 那套，额外认一个 xls(row)：导出时这一列取什么值，不写就按 key 取。
 */
import { ref, computed } from 'vue'
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
const keyword = ref('')
const busy = ref(false)

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
    shown.value.forEach((r) => {
      aoa.push(cols.map((c) => {
        const v = c.xls ? c.xls(r) : r[c.key]
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
  <n-card :title="title" :bordered="false">
    <template #header-extra>
      <n-space align="center">
        <n-input v-if="search" v-model:value="keyword" placeholder="搜成员名" clearable style="width: 180px" />
        <n-button :loading="busy" @click="exportExcel">导出 Excel</n-button>
      </n-space>
    </template>

    <n-alert v-if="desc" type="default" :bordered="false" style="margin-bottom: 14px">{{ desc }}</n-alert>
    <slot name="filters" />

    <n-data-table
      :columns="columns"
      :data="shown"
      :bordered="false"
      size="small"
      :scroll-x="scrollX || undefined"
      striped
    />
    <div class="count">共 {{ shown.length }} 人</div>
  </n-card>
</template>

<style scoped>
.count { margin-top: 10px; color: #8a9099; font-size: 12px; }
</style>

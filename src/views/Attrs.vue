<script setup>
import { inject, computed, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, timeCol } from '../cols'
import { num, sorter } from '../fmt'

const app = inject('app')
const members = app.members
/** 没拿到就按六维兜底，别因为少传一个字段整页渲染不出来 */
const attrKeys = computed(() => (app.attrKeys && app.attrKeys.value) || ['infDef', 'infHp', 'cavAtk', 'cavBreak', 'arcAtk', 'arcBreak'])

/** 六个维度的中文名，列顺序固定「步 → 骑 → 弓」 */
const LABELS = {
  infDef: '步防', infHp: '步生', cavAtk: '骑攻', cavBreak: '骑破', arcAtk: '弓攻', arcBreak: '弓破'
}

/*
 * 序号列：跟着当前排序走（naive-ui 的 render 第二个参数就是排序后的行号），
 * 所以按哪一列排，序号就是那一列的名次。
 */
const indexCol = {
  title: '#',
  key: '_idx',
  width: 56,
  fixed: 'left',
  render: (_r, i) => h('span', { style: 'color:#8a9099;font-variant-numeric:tabular-nums' }, i + 1),
  xls: (_r, i) => i + 1
}

/** 本赛季这几维的总和；S1~S3 不算骑兵那两项，不然和列表对不上 */
const sumOf = (r) => {
  const v = attrKeys.value.map((k) => (r.attrs ? r.attrs[k] : null)).filter((x) => x != null)
  if (v.length) return Math.round(v.reduce((a, b) => a + Number(b), 0) * 100) / 100
  // 没有逐维数据但有服务端算好的总和时退回去用它 —— 那份是按六维算的，
  // 所以只在本赛季正好看六维时才能用，四维赛季宁可显示「—」也不能拿六维的数充数
  return attrKeys.value.length === 6 ? (r.attrsSum ?? null) : null
}

const attrCol = (title, key) => ({
  title,
  key: 'a_' + key,
  width: 92,
  sorter: sorter((r) => (r.attrs ? r.attrs[key] : null)),
  render: (r) => {
    const v = r.attrs && r.attrs[key]
    return v === null || v === undefined ? h('span', { style: 'color:#c9ccd1' }, '—') : num(v, 2)
  },
  xls: (r) => (r.attrs && r.attrs[key] !== null && r.attrs[key] !== undefined ? Number(r.attrs[key]) : '')
})

const columns = computed(() => [
  indexCol,
  nameCol,
  ...attrKeys.value.map((k) => attrCol(LABELS[k] || k, k)),
  {
    ...numCol(`${attrKeys.value.length}维总和`, 'attrsSum', 2, 110, true),
    sorter: sorter(sumOf),
    render: (r) => (sumOf(r) === null ? h('span', { style: 'color:#c9ccd1' }, '—') : num(sumOf(r), 2)),
    xls: (r) => (sumOf(r) === null ? '' : sumOf(r))
  },
  timeCol('最后更新', 'attrsUpdatedAt', '从未上传')
])
</script>

<template>
  <div class="page">
    <TableCard
      title="属性排名"
      :desc="`属性来自成员自己传的「属性加成」截图，识别后入库，不支持手动修改。本赛季看 ${attrKeys.length} 维，点表头可以按单项排序，左边的序号跟着当前排序走。`"
      :columns="columns"
      :rows="members"
      :scroll-x="1060"
    />
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; }
</style>

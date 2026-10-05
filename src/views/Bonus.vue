<script setup>
import { inject, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, bigCol, timeCol } from '../cols'
import { sorter } from '../fmt'

const { members } = inject('app')

const sumOf = (r, lv) => {
  const one = (r.troopsByLevel && r.troopsByLevel[lv]) || {}
  let s = null
  ;['inf', 'cav', 'arc'].forEach((k) => {
    if (one[k] !== null && one[k] !== undefined) s = (s || 0) + Number(one[k])
  })
  return s
}
const detail = (r, lv) => {
  const one = (r.troopsByLevel && r.troopsByLevel[lv]) || {}
  const v = (k) => (one[k] === null || one[k] === undefined ? '-' : one[k])
  return `步${v('inf')} 骑${v('cav')} 弓${v('arc')}`
}

/** 两档挤在一列里，上下两行：宫3 一行、宫2 一行 */
const troopCol = {
  title: '兵力（宫3 / 宫2）',
  key: 'troops2',
  width: 230,
  sorter: sorter((r) => {
    const a = sumOf(r, '3')
    const b = sumOf(r, '2')
    return a === null && b === null ? null : (a || 0) + (b || 0)
  }),
  render: (r) => {
    const line = (lv) => {
      const s = sumOf(r, lv)
      return h('div', { class: 'bn-l' }, [
        h('span', { class: 'bn-lv' }, '宫' + lv),
        s === null
          ? h('span', { class: 'bn-none' }, '—')
          : h('b', { class: 'bn-n' }, s + '万'),
        h('span', { class: 'bn-d' }, s === null ? '' : detail(r, lv))
      ])
    }
    // 两档都没填就别摆两个破折号了，给一个就够
    if (sumOf(r, '3') === null && sumOf(r, '2') === null) return h('span', { class: 'bn-none' }, '—')
    return h('div', [line('3'), line('2')])
  },
  xls: (r) => {
    const t = (lv) => (sumOf(r, lv) === null ? '' : `宫${lv} ${sumOf(r, lv)}万（${detail(r, lv)}）`)
    return [t('3'), t('2')].filter(Boolean).join(' / ')
  }
}

const columns = [
  nameCol,
  numCol('最高集结值', 'maxBonus', 2, 120),
  bigCol('单人出征', 'maxMarch', 110),
  troopCol,
  numCol('六维总和', 'attrsSum', 2, 110),
  timeCol('资料更新', 'attrsUpdatedAt')
]
</script>

<style>
/* 表格单元格里的两行兵力 */
.bn-l { display: flex; align-items: baseline; gap: 6px; line-height: 1.7; white-space: nowrap; }
.bn-lv { width: 26px; color: #9aa0a6; font-size: 11px; }
.bn-n { color: #6c5ce7; min-width: 52px; }
.bn-none { color: #c9ccd1; min-width: 52px; }
.bn-d { color: #9aa0a6; font-size: 11px; }
</style>

<template>
  <TableCard
    title="成员加成"
    desc="集结值和兵力由成员在「我的信息」里自己填，属性由截图识别。按资料更新时间排序能快速找出没及时更新的人。"
    :columns="columns"
    :rows="members"
    :scroll-x="1000"
  />
</template>

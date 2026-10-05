<script setup>
import { inject, computed, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, bigCol, timeCol } from '../cols'
import { sorter } from '../fmt'

const { members, season } = inject('app')

/**
 * 只看本赛季最高那一档兵营：S1-S2 到 10 级、S3 宫1、S4 宫2、S5-S8 宫3、S9 往后宫4。
 * 档位是服务端按赛季给的（season.topTier），这里不写死。
 */
const top = computed(() => (season.value && season.value.topTier) || '3')
const topLabel = computed(() => (season.value && season.value.topTierLabel) || '宫3')

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

/** 一行放下：本赛季最高那档的合计 + 三个兵种明细 */
const troopCol = computed(() => ({
  title: `兵力（${topLabel.value}）`,
  key: 'troopsTop',
  width: 210,
  sorter: sorter((r) => sumOf(r, top.value)),
  render: (r) => {
    const s = sumOf(r, top.value)
    if (s === null) return h('span', { class: 'bn-none' }, '—')
    return h('div', { class: 'bn-l' }, [
      h('b', { class: 'bn-n' }, s + '万'),
      h('span', { class: 'bn-d' }, detail(r, top.value))
    ])
  },
  xls: (r) => sumOf(r, top.value)
}))

const columns = computed(() => [
  nameCol,
  numCol('最高集结值', 'maxBonus', 2, 120),
  bigCol('单人出征', 'maxMarch', 110),
  troopCol.value,
  numCol('六维总和', 'attrsSum', 2, 110),
  timeCol('资料更新', 'attrsUpdatedAt')
])
</script>

<style>
/* 兵力那一格：合计 + 明细挤一行，不换行 */
.bn-l { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
.bn-n { color: #6c5ce7; }
.bn-none { color: #c9ccd1; }
.bn-d { color: #9aa0a6; font-size: 11px; }
</style>

<template>
  <TableCard
    title="成员加成"
    desc="集结值和兵力由成员在「我的信息」里自己填，属性由截图识别。兵力只看本赛季最高那档兵营。按资料更新时间排序能快速找出没及时更新的人。"
    :columns="columns"
    :rows="members"
    :scroll-x="1000"
  />
</template>

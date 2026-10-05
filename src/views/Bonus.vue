<script setup>
import { inject, computed, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, bigCol, timeCol } from '../cols'
import { sorter } from '../fmt'

const { members, season } = inject('app')

/**
 * 展示本赛季最高和次高两档兵营：S1-S2 到 10 级、S3 宫1、S4 宫2、S5-S8 宫3、S9 往后宫4。
 * 档位是服务端按赛季给的（season.tiers），这里不写死。
 */
const FALLBACK = [{ key: '2', label: '宫2' }, { key: '3', label: '宫3' }]
/** 服务端按赛季给的两档，高的放前面 */
const tiers = computed(() => {
  const t = (season.value && season.value.tiers) || FALLBACK
  return t.slice().reverse()
})

const ARMS = [['inf', '步'], ['cav', '骑'], ['arc', '弓']]

const sumOf = (r, lv) => {
  const one = (r.troopsByLevel && r.troopsByLevel[lv]) || {}
  let s = null
  ARMS.forEach(([k]) => {
    if (one[k] !== null && one[k] !== undefined) s = (s || 0) + Number(one[k])
  })
  return s
}
/**
 * 最高和次高两档排在同一行里，每档都把步 / 骑 / 弓写全，没填的写「-」，
 * 整档都没填就只写一个「-」（例如全在宫3 的人，宫2 那段就是「宫2 -」）。
 */
const detail = (r, lv) => {
  const one = (r.troopsByLevel && r.troopsByLevel[lv]) || {}
  const has = ARMS.some(([k]) => one[k] !== null && one[k] !== undefined)
  if (!has) return '-'
  return ARMS.map(([k, label]) => label + (one[k] === null || one[k] === undefined ? '-' : one[k])).join(' ')
}

const troopCol = computed(() => ({
  title: '兵力（' + tiers.value.map((t) => t.label).join(' / ') + '）',
  key: 'troops2',
  width: 300,
  sorter: sorter((r) => {
    const all = tiers.value.map((t) => sumOf(r, t.key))
    return all.every((x) => x === null) ? null : all.reduce((a, b) => a + (b || 0), 0)
  }),
  render: (r) => {
    if (tiers.value.every((t) => sumOf(r, t.key) === null)) return h('span', { class: 'bn-none' }, '—')
    return h('div', { class: 'bn-l' }, tiers.value.map((t) => h('span', { class: 'bn-seg' }, [
      h('span', { class: 'bn-lv' }, t.label),
      h('span', { class: 'bn-d' }, detail(r, t.key))
    ])))
  },
  xls: (r) => tiers.value.map((t) => `${t.label} ${detail(r, t.key)}`).join(' / ')
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
/* 兵力那一格：两档排一行，不换行 */
.bn-l { display: flex; align-items: baseline; gap: 14px; white-space: nowrap; }
.bn-seg { display: inline-flex; align-items: baseline; gap: 5px; }
.bn-lv { color: #9aa0a6; font-size: 11px; }
.bn-d { color: #4b5563; }
.bn-none { color: #c9ccd1; }
</style>

<template>
  <div class="page">
    <TableCard
      title="成员加成"
      desc="集结值和兵力由成员在「我的信息」里自己填，属性由截图识别。兵力按本赛季最高和次高两档兵营展示，没填的写「-」。按资料更新时间排序能快速找出没及时更新的人。"
      :columns="columns"
      :rows="members"
      :scroll-x="1100"
    />
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; }
</style>

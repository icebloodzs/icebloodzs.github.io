<script setup>
import { inject, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, bigCol, timeCol } from '../cols'
import { num, sorter } from '../fmt'

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

const troopCol = (lv) => ({
  title: `宫${lv} 兵力`,
  key: 'lv' + lv,
  width: 150,
  align: 'right',
  sorter: sorter((r) => sumOf(r, lv)),
  render: (r) => {
    const s = sumOf(r, lv)
    if (s === null) return h('span', { style: 'color:#c9ccd1' }, '—')
    return h('div', [
      h('b', { style: 'color:#6c5ce7' }, s + '万'),
      h('div', { style: 'font-size:11px;color:#9aa0a6' }, detail(r, lv))
    ])
  },
  xls: (r) => sumOf(r, lv)
})

const columns = [
  nameCol,
  numCol('最高集结值', 'maxBonus', 2, 120),
  bigCol('单人出征', 'maxMarch', 110),
  troopCol('3'),
  troopCol('2'),
  numCol('六维总和', 'attrsSum', 2, 110),
  timeCol('资料更新', 'attrsUpdatedAt')
]
</script>

<template>
  <TableCard
    title="成员加成"
    desc="集结值和兵力由成员在小程序「我的数据」里自己填，属性由截图识别。按资料更新时间排序能快速找出没及时更新的人。"
    :columns="columns"
    :rows="members"
    :scroll-x="1000"
  />
</template>

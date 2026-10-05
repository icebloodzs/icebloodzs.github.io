<script setup>
import { inject, h } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, numCol, timeCol } from '../cols'
import { num, sorter } from '../fmt'

const { members } = inject('app')

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

const columns = [
  nameCol,
  attrCol('步防', 'infDef'),
  attrCol('步生', 'infHp'),
  attrCol('骑攻', 'cavAtk'),
  attrCol('骑破', 'cavBreak'),
  attrCol('弓攻', 'arcAtk'),
  attrCol('弓破', 'arcBreak'),
  numCol('六维总和', 'attrsSum', 2, 110),
  timeCol('最后更新', 'attrsUpdatedAt', '从未上传')
]
</script>

<template>
  <div class="page">
    <TableCard
      title="属性排名"
      desc="六维来自成员自己传的「属性加成」截图，识别后入库，不支持手动修改。点表头可以按单项排序，最后一列是这份属性什么时候传的。"
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

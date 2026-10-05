<script setup>
import { inject, computed, h } from 'vue'
import { NTag } from 'naive-ui'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, boundCol } from '../cols'
import { when, ago, sorter } from '../fmt'

const { members, loginBy } = inject('app')

/** 最后登录在 appUsers 上，按绑定的 uid 关联过来 */
const loginOf = (r) => (r.boundUid ? loginBy.value[r.boundUid] : null)

const timeCell = (iso, empty) => {
  if (!iso) return h(NTag, { size: 'small', type: 'default', bordered: false }, () => empty)
  const a = ago(iso)
  return h('div', { style: 'white-space:nowrap' }, [
    h('span', { style: 'color:#4b5563' }, when(iso)),
    ' ',
    h(NTag, { size: 'small', type: a.type, bordered: false }, () => a.text)
  ])
}

const columns = computed(() => [
  nameCol,
  boundCol,
  {
    title: '绑定时间',
    key: 'boundAt',
    width: 165,
    sorter: sorter((r) => (r.boundAt ? new Date(r.boundAt).getTime() : null)),
    render: (r) => (r.boundUid ? timeCell(r.boundAt, '—') : h('span', { style: 'color:#c9ccd1' }, '—')),
    xls: (r) => when(r.boundAt)
  },
  {
    title: '最后登录',
    key: 'lastLogin',
    width: 165,
    sorter: sorter((r) => {
      const t = loginOf(r)
      return t ? new Date(t).getTime() : null
    }),
    render: (r) => (r.boundUid ? timeCell(loginOf(r), '没登录过') : h('span', { style: 'color:#c9ccd1' }, '—')),
    xls: (r) => when(loginOf(r))
  },
  bigCol('战力', 'power'),
  bigCol('实力', 'strength'),
  {
    title: '曾用名',
    key: 'formerNames',
    width: 160,
    render: (r) => (r.formerNames || []).join('、') || '—',
    xls: (r) => (r.formerNames || []).join('、')
  }
])
</script>

<template>
  <div class="page">
    <TableCard
      title="绑定情况"
      desc="谁已经把微信绑到了名单里的成员账号上。没绑的人在小程序里看不到自己的数据。最后登录按微信号算，可以看出谁很久没打开过小程序了。"
      :columns="columns"
      :rows="members"
      :scroll-x="1000"
    />
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; }
</style>

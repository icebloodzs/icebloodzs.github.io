<script setup>
import { inject, computed, h } from 'vue'
import { NTag } from 'naive-ui'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, timeCol } from '../cols'
import { big } from '../fmt'

const { members, season } = inject('app')

const POSITIONS = [
  { label: '先锋', type: 'success' },
  { label: '督军', type: 'info' },
  { label: '镇国', type: 'warning' },
  { label: '巅峰镇国', type: 'error' }
]

function posOf(score) {
  const s = season.value
  if (!s || score === null || score === undefined) return null
  const i = score < s.vanguardMax ? 0 : score < s.marshalMax ? 1 : score < s.guardianMax ? 2 : 3
  return POSITIONS[i]
}

const columns = computed(() => [
  nameCol,
  bigCol('成员实力', 'strength'),
  {
    ...bigCol('武将战力', 'heroPower'),
    render: (r) => (r.heroPower == null
      ? h('span', { style: 'color:#c9ccd1' }, '未录入')
      : h('b', { style: 'color:#6c5ce7' }, big(r.heroPower)))
  },
  bigCol('赛季评分', 'seasonScore'),
  {
    title: '定位',
    key: 'position',
    width: 100,
      render: (r) => {
      const p = posOf(r.seasonScore)
      return p ? h(NTag, { size: 'small', type: p.type, bordered: false }, () => p.label) : '—'
    },
    xls: (r) => (posOf(r.seasonScore) || {}).label || ''
  },
  { title: '录入人', key: 'heroPowerBy', width: 110 },
  timeCol('更新时间', 'heroPowerUpdatedAt', '从未录入')
])

const bands = computed(() => {
  const s = season.value
  if (!s) return []
  return [
    ['先锋', `< ${big(s.vanguardMax)}`, 'success'],
    ['督军', `${big(s.vanguardMax)} ~ ${big(s.marshalMax)}`, 'info'],
    ['镇国', `${big(s.marshalMax)} ~ ${big(s.guardianMax)}`, 'warning'],
    ['巅峰镇国', `≥ ${big(s.guardianMax)}`, 'error']
  ]
})
</script>

<template>
  <div class="page">
    <!-- 档位这块往下翻的时候钉在顶上，对着看评分落在哪一档 -->
    <div class="pin">
      <n-card :bordered="false" size="small" :title="(season && season.label) || '赛季'">
        <n-space>
          <n-tag v-for="b in bands" :key="b[0]" :type="b[2]" :bordered="false">{{ b[0] }} {{ b[1] }}</n-tag>
        </n-space>
      </n-card>
    </div>

    <TableCard
      title="赛季评分"
      desc="评分 = 成员实力 − 武将战力。武将战力只能由成员自己上传截图识别，不支持手动修改。 点表头可以按单项排序，最后一列是这份评分什么时候传的。"
      :columns="columns"
      :rows="members"
      :scroll-x="960"
    />
  </div>
</template>

<style scoped>
.page > * + * { margin-top: 16px; }
.pin {
  position: sticky;
  top: 0;
  z-index: 10;
  /* 把内容区顶上那 20px 留白包进来，钉住之后下面的表格才不会从缝里露出来 */
  margin-top: -20px;
  padding-top: 20px;
  background: #f5f6fa;
}
/* 钉住之后表格会贴着它往上滚，给点阴影才分得清上下 */
.pin :deep(.n-card) { box-shadow: 0 2px 10px rgba(31, 35, 41, 0.06); }
</style>

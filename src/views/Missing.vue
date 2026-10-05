<script setup>
import { inject, computed, ref, h } from 'vue'
import { NTag } from 'naive-ui'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, boundCol, timeCol } from '../cols'

const { members } = inject('app')
const picked = ref(['bonus', 'troops', 'attrs'])

const OPTS = [
  { label: '没填集结值', value: 'bonus' },
  { label: '没填兵力', value: 'troops' },
  { label: '没传属性', value: 'attrs' },
  { label: '没填出征数量', value: 'march' }
]

const rows = computed(() => members.value.filter((m) =>
  (picked.value.includes('bonus') && m.maxBonus == null) ||
  (picked.value.includes('troops') && !m.troopsComplete) ||
  (picked.value.includes('attrs') && !m.profileComplete) ||
  (picked.value.includes('march') && m.maxMarch == null)
))

const lackCol = {
  title: '缺什么',
  key: 'lack',
  width: 260,
  render: (r) => {
    const tags = []
    if (r.maxBonus == null) tags.push(['没填集结', 'warning'])
    if (!r.troopsComplete) tags.push(['没填兵力', 'warning'])
    if (!r.profileComplete) tags.push(['没传属性', 'error'])
    if (r.maxMarch == null) tags.push(['没填出征', 'default'])
    return h('div', tags.map((t) =>
      h(NTag, { size: 'small', type: t[1], bordered: false, style: 'margin-right:4px' }, () => t[0])))
  },
  xls: (r) => [
    r.maxBonus == null ? '没填集结' : '',
    !r.troopsComplete ? '没填兵力' : '',
    !r.profileComplete ? '没传属性' : '',
    r.maxMarch == null ? '没填出征' : ''
  ].filter(Boolean).join(' ')
}

const columns = [nameCol, lackCol, boundCol, bigCol('战力', 'power'), timeCol('资料更新', 'attrsUpdatedAt')]
</script>

<template>
  <div class="page">
    <TableCard
      title="遗漏排查"
      desc="找出还没填集结值、没填兵力、没传属性截图的人。勾选条件是「或」的关系。"
      :columns="columns"
      :rows="rows"
      :scroll-x="860"
    >
      <template #filters>
        <n-checkbox-group v-model:value="picked" style="margin-bottom: 14px">
          <n-space>
            <n-checkbox v-for="o in OPTS" :key="o.value" :value="o.value" :label="o.label" />
          </n-space>
        </n-checkbox-group>
      </template>
    </TableCard>
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; }
</style>

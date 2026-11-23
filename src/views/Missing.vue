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

// 「缺什么」只列勾上的条件：没勾的那项就算缺也不显示，免得和筛选对不上
const LACKS = [
  { key: 'bonus', text: '没填集结', type: 'warning', test: (r) => r.maxBonus == null },
  { key: 'troops', text: '没填兵力', type: 'warning', test: (r) => !r.troopsComplete },
  { key: 'attrs', text: '没传属性', type: 'error', test: (r) => !r.profileComplete },
  { key: 'march', text: '没填出征', type: 'default', test: (r) => r.maxMarch == null }
]
const lacksOf = (r) => LACKS.filter((l) => picked.value.includes(l.key) && l.test(r))

const rows = computed(() => members.value.filter((m) => lacksOf(m).length))

const lackCol = {
  title: '缺什么',
  key: 'lack',
  width: 260,
  render: (r) => h('div', lacksOf(r).map((l) =>
    h(NTag, { size: 'small', type: l.type, bordered: false, style: 'margin-right:4px' }, () => l.text))),
  xls: (r) => lacksOf(r).map((l) => l.text).join(' ')
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

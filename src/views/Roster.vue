<script setup>
import { inject, computed } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, boundCol } from '../cols'
import { sorter } from '../fmt'

const { members } = inject('app')

const columns = [
  nameCol,
  { title: '阶级', key: 'rank', width: 80,  sorter: sorter((r) => r.rank) },
  { title: '火炉', key: 'furnace', width: 110 },
  bigCol('战力', 'power'),
  bigCol('实力', 'strength'),
  bigCol('周功勋', 'weeklyMerit'),
  bigCol('总功勋', 'totalMerit', 120),
  bigCol('周捐献', 'weeklyDonate'),
  boundCol
]

const stats = computed(() => {
  const all = members.value
  return [
    ['在册成员', all.length],
    ['已绑定微信', all.filter((m) => m.boundUid).length],
    ['已传属性', all.filter((m) => m.profileComplete).length],
    ['已填集结值', all.filter((m) => m.maxBonus != null).length],
    ['已录武将战力', all.filter((m) => m.heroPower != null).length]
  ]
})
</script>

<template>
  <n-space vertical :size="16">
    <n-grid :cols="5" :x-gap="14">
      <n-gi v-for="s in stats" :key="s[0]">
        <n-card :bordered="false" size="small">
          <n-statistic :label="s[0]" :value="s[1]" />
        </n-card>
      </n-gi>
    </n-grid>

    <TableCard
      title="同盟名单"
      desc="名单数据来自管理员导入的同盟成员列表。点表头切换升序 / 降序。"
      :columns="columns"
      :rows="members"
      :scroll-x="1000"
    />
  </n-space>
</template>

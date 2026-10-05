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
  <div class="page">
    <n-grid :cols="5" :x-gap="14">
      <n-gi v-for="s in stats" :key="s[0]">
        <n-card :bordered="false" size="small">
          <n-statistic :label="s[0]" :value="s[1]" />
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 剩下的高度全给表格。注意别再套 n-space：
         它会把每个子项各包一层高度自适应的 div，表格就撑不开了 -->
    <div class="rest">
      <TableCard
        title="同盟名单"
        desc="名单数据来自管理员导入的同盟成员列表。点表头切换升序 / 降序。"
        :columns="columns"
        :rows="members"
        :scroll-x="1000"
      />
    </div>
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; display: flex; flex-direction: column; }
.page > * + * { margin-top: 16px; }
.rest { flex: 1; min-height: 0; }
</style>

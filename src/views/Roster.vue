<script setup>
import { inject, computed, ref } from 'vue'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, boundCol, isVirtualUid } from '../cols'
import { sorter, big, cmp } from '../fmt'

const { members, narrow = ref(false) } = inject('app')

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

/*
 * 手机上不摆宽表格（九列横着滑太难看），换成一人一张小卡片：
 * 名字 + 绑定状态一行，阶级 / 火炉一行，战力 / 实力 / 功勋一行。上面一个搜索框、一个排序。
 */
const keyword = ref('')
const sortKey = ref('power')
const SORTS = [
  { label: '按战力', value: 'power' },
  { label: '按实力', value: 'strength' },
  { label: '按总功勋', value: 'totalMerit' },
  { label: '按周功勋', value: 'weeklyMerit' },
  { label: '按名字', value: 'name' },
  { label: '未绑定在前', value: 'unbound' }
]
const cards = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = members.value.filter((m) => !kw || String(m.name || '').toLowerCase().includes(kw))
  const k = sortKey.value
  return list.slice().sort((a, b) => {
    if (k === 'name') return cmp(a.name, b.name)
    // 数值从大到小，没数据的沉底
    const desc = (x, y) => (x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : y - x)
    if (k === 'unbound') return Number(Boolean(a.boundUid)) - Number(Boolean(b.boundUid)) || desc(a.power, b.power)
    return desc(a[k], b[k])
  })
})

const stats = computed(() => {
  const all = members.value
  return [
    ['在册成员', all.length],
    ['已绑定微信', all.filter((m) => m.boundUid && !isVirtualUid(m.boundUid)).length],
    ['已传属性', all.filter((m) => m.profileComplete).length],
    ['已填集结值', all.filter((m) => m.maxBonus != null).length],
    ['已录武将战力', all.filter((m) => m.heroPower != null).length]
  ]
})
</script>

<template>
  <div class="page" :class="{ narrow }">
    <n-grid cols="2 s:5" responsive="screen" :x-gap="narrow ? 8 : 14" :y-gap="8">
      <n-gi v-for="s in stats" :key="s[0]">
        <n-card :bordered="false" size="small">
          <n-statistic :label="s[0]" :value="s[1]" />
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 剩下的高度全给表格。注意别再套 n-space：
         它会把每个子项各包一层高度自适应的 div，表格就撑不开了 -->
    <!-- 手机：卡片列表 -->
    <n-card v-if="narrow" :bordered="false" size="small" title="同盟名单">
      <div class="m-bar">
        <n-input v-model:value="keyword" placeholder="搜成员名" clearable size="small" />
        <n-select v-model:value="sortKey" :options="SORTS" size="small" style="width: 116px; flex: none" />
      </div>
      <div class="m-count">{{ cards.length }} 人</div>
      <div v-for="(m, i) in cards" :key="m._id" class="m-card">
        <div class="m-row">
          <span class="m-no">{{ i + 1 }}</span>
          <b class="m-name">{{ m.name }}</b>
          <n-tag size="tiny" :type="!m.boundUid ? 'error' : isVirtualUid(m.boundUid) ? 'info' : 'success'" :bordered="false">{{ !m.boundUid ? '未绑定' : isVirtualUid(m.boundUid) ? '登录码' : '已绑定' }}</n-tag>
        </div>
        <div class="m-sub">{{ m.rank != null ? m.rank + '阶' : '—' }} · {{ m.furnace || '火炉未知' }}</div>
        <div class="m-nums">
          <span><i>战力</i>{{ big(m.power) }}</span>
          <span><i>实力</i>{{ big(m.strength) }}</span>
          <span><i>总功勋</i>{{ big(m.totalMerit) }}</span>
          <span><i>周功勋</i>{{ big(m.weeklyMerit) }}</span>
        </div>
      </div>
      <n-empty v-if="!cards.length" description="没有符合的成员" style="padding: 30px 0" />
    </n-card>

    <div v-else class="rest">
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

/* 手机：整页跟着外层滚，不再自己定高 */
.page.narrow { height: auto; min-height: 0; display: block; }
.page.narrow > * + * { margin-top: 10px; }
.m-bar { display: flex; gap: 8px; }
.m-count { margin: 8px 0 4px; font-size: 12px; color: #8a9099; }
.m-card { padding: 10px 2px; border-top: 1px solid #f0f0f5; }
.m-row { display: flex; align-items: center; gap: 8px; }
.m-no { width: 22px; flex: none; font-size: 12px; color: #9aa0a6; text-align: right; }
.m-name { flex: 1; min-width: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-sub { margin: 4px 0 0 30px; font-size: 12px; color: #8a9099; }
.m-nums { margin: 6px 0 0 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 13px; font-variant-numeric: tabular-nums; }
.m-nums i { font-style: normal; color: #9aa0a6; font-size: 12px; margin-right: 6px; }
</style>

<script setup>
/** 集结分配的一组小表：每列一张，点位置往外抛 seat key。noVal 的列（冲车/斗阵）不显示数值列 */
defineProps({ cols: { type: Array, required: true }, sel: { type: String, default: '' } })
const emit = defineEmits(['tap'])
const cellBg = (row, c) => (row.kind === 'dim' ? '#f3f4f6' : row.kind === 'empty' ? '#fff' : c.color.light)
</script>

<template>
  <table v-for="c in cols" :key="c.name" class="plan">
    <thead>
      <tr><th colspan="2" :style="{ background: c.color.main }">{{ c.name }}</th></tr>
    </thead>
    <tbody>
      <tr v-for="(row, i) in c.rows" :key="i">
        <template v-if="row.kind === 'title'">
          <!-- 守城的车名行就是车头，可以点 -->
          <td
            colspan="2"
            :class="['t', row.key ? 's' : '', sel === row.key ? 'on' : '']"
            :style="{ background: row.prob ? '#f08a24' : c.color.main }"
            @click="row.key && emit('tap', row.key)"
          >{{ row.text }}<span v-if="!c.noVal" class="v">{{ row.value }}</span></td>
        </template>
        <template v-else-if="row.kind === 'label'">
          <td colspan="2" class="l" :style="{ color: c.color.main }">
            {{ row.text }}<span class="v">{{ row.value }}</span>
          </td>
        </template>
        <template v-else>
          <td
            :colspan="c.noVal ? 2 : 1"
            :class="['s', 'nm', row.kind === 'head' ? 'hd' : '', row.kind === 'dim' ? 'dm' : '', row.kind === 'empty' ? 'em' : '', sel === row.key ? 'on' : '']"
            :style="{ background: sel === row.key ? '#ffe9a8' : cellBg(row, c) }"
            @click="emit('tap', row.key)"
          >{{ row.kind === 'empty' ? '空位' : row.text }}</td>
          <td
            v-if="!c.noVal"
            :class="['s', 'nu', row.kind === 'head' ? 'hd' : '', row.kind === 'dim' ? 'dm' : '', sel === row.key ? 'on' : '']"
            :style="{ background: sel === row.key ? '#ffe9a8' : cellBg(row, c) }"
            @click="emit('tap', row.key)"
          >{{ row.value }}</td>
        </template>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
table.plan { border-collapse: collapse; font-size: 12px; min-width: 212px; }
table.plan th { color: #fff; padding: 9px 12px; border: 1px solid #e9ebee; }
table.plan td { border: 1px solid #e9ebee; padding: 7px 12px; text-align: center; white-space: nowrap; }
table.plan td.nm { text-align: left; min-width: 112px; }
table.plan td.nu { text-align: right; min-width: 62px; color: #4b5563; }
table.plan td.t { color: #fff; font-weight: 700; text-align: left; }
table.plan td.l { background: #fff; font-size: 11px; font-weight: 700; text-align: left; }
table.plan td.dm { color: #6b7280; }
table.plan td.em { color: #b6bbc2; }
table.plan td.hd { color: #e0203a; font-weight: 700; }
table.plan td.s { cursor: pointer; }
table.plan td.s:hover { filter: brightness(0.96); }
table.plan td.on { outline: 2px solid #e0a800; outline-offset: -2px; }
.v { float: right; font-weight: 400; opacity: 0.9; }
@media (max-width: 767px) {
  table.plan { width: 100%; }
}
</style>

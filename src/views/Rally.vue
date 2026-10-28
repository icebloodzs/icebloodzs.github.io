<script setup>
/**
 * 集结分配。算法直接用小程序那份 lib/rally.js，一个字没改，两端结果一致。
 * 每个位置带一个 seat key（"车号:h" / "车号:位次" / "b:序号"），点一个再点另一个就对调。
 */
import { ref, inject, computed } from 'vue'
import { useMessage } from 'naive-ui'
import * as R from '../lib/rally'
import { buildStyledExcel, download } from '../xlsx'

const { members } = inject('app')
const message = useMessage()

const opt = ref({
  mode: 'attack', groups: 4, subs: 1, mainBody: 5, subBody: 5, firstBody: 5,
  probability: 0, headBy: 'rally', bodyBy: 'rally', title: '',
  catapult: false, catapults: 1, catBody: 6, catRatio: '6:1:3',
  ram: false, ramFull: 6, ramReserve: 4
})
const plan = ref(null)
const used = ref(null)
const sel = ref('')
const busy = ref(false)

const MODES = [{ label: '攻城', value: 'attack' }, { label: '守城', value: 'defense' }]
const BY = [{ label: '集结值', value: 'rally' }, { label: '六维总和', value: 'attrs' }]
const BODY = R.BODY_MODES.map((m) => ({ label: m.label, value: m.key }))
const attack = computed(() => opt.value.mode === 'attack')

function options() {
  const o = opt.value
  return {
    groups: o.groups, subs: o.subs, mainBody: o.mainBody, subBody: o.subBody,
    mainRatio: '5:2:3', subRatio: '5:2:3', probability: o.probability, firstBody: o.firstBody,
    headBy: o.headBy, bodyBy: o.bodyBy,
    catapult: o.catapult, catapults: o.catapults, catBody: o.catBody, catRatio: o.catRatio || '6:1:3',
    ram: o.ram, ramFull: o.ramFull, ramReserve: o.ramReserve,
    title: o.title || (attack.value ? '攻城集结分配' : '守城集结分配'),
    note: ''
  }
}

function generate() {
  const o = options()
  used.value = o
  plan.value = attack.value ? R.generateAttack(members.value, o) : R.generateDefense(members.value, o)
  sel.value = ''
}

const seatOf = (key) => R.getSeat(plan.value, String(key))

function tap(key) {
  if (!sel.value) {
    if (!seatOf(key)) return
    sel.value = key
  } else if (sel.value === key) {
    sel.value = ''
  } else {
    plan.value = R.swapSeats(plan.value, sel.value, key)
    sel.value = ''
  }
}

/** 一组一列，霹雳车、冲车各一列排在后面；和导出图片、Excel 用同一份排版 */
const columns = computed(() => (plan.value ? R.buildLayout(plan.value, used.value).columns : []))
const bench = computed(() => (plan.value ? (plan.value.bench || []).filter(Boolean) : []))
const cellBg = (row, c) => (row.kind === 'dim' ? '#f3f4f6' : row.kind === 'empty' ? '#fff' : c.color.light)
const ramSingle = computed(() => R.RAM_TOTAL - 1 - (opt.value.ramFull || 0))
const fileBase = () => (used.value.title || '集结分配').replace(/[\\/:*?"<>|【】\s]/g, '')

function exportImage() {
  if (busy.value || !plan.value) return
  const layout = R.buildLayout(plan.value, used.value)
  const size = R.imageSize(layout)
  const canvas = document.createElement('canvas')
  canvas.width = size.W
  canvas.height = size.H
  R.drawImage(canvas.getContext('2d'), layout, size)
  canvas.toBlob((blob) => {
    if (blob) download(blob, fileBase() + '.png')
    else message.error('生成图片失败')
  }, 'image/png')
}

async function exportExcel() {
  if (busy.value || !plan.value) return
  busy.value = true
  try {
    const layout = R.buildLayout(plan.value, used.value)
    const sheet = R.layoutToSheet(layout)
    await buildStyledExcel(sheet, attack.value ? '攻城表' : '守城表',
      (layout.title || '集结分配').replace(/[\\/:*?"<>|【】\s]/g, '') + '.xlsx')
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="集结分配" :bordered="false">
      <template #header-extra>
        <n-space>
          <n-button type="primary" @click="generate">生成</n-button>
          <n-button v-if="plan" :loading="busy" @click="exportExcel">导出 Excel</n-button>
          <n-button v-if="plan" @click="exportImage">导出图片</n-button>
        </n-space>
      </template>

      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        车头按集结值（或六维）从高到低挑，车身按你选的排法依次填；不管按什么排，名字右边都显示集结值。
        霹雳车占正常队伍；冲车（只有攻城）是独立队伍，六维最高的当车头，车头加车身共 16 个。算的是和小程序同一套逻辑，两边结果一致。
        参与人数 {{ members.length }}（在册成员）。
      </n-alert>

      <n-form label-placement="left" :label-width="90" size="small">
        <n-grid cols="1 s:2 l:4" responsive="screen" :x-gap="16">
          <n-gi><n-form-item label="模式"><n-select v-model:value="opt.mode" :options="MODES" /></n-form-item></n-gi>
          <n-gi><n-form-item label="组数"><n-input-number v-model:value="opt.groups" :min="1" :max="8" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="attack"><n-form-item label="每组副车"><n-input-number v-model:value="opt.subs" :min="0" :max="5" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="attack"><n-form-item label="主车车身"><n-input-number v-model:value="opt.mainBody" :min="0" :max="20" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="attack"><n-form-item label="副车车身"><n-input-number v-model:value="opt.subBody" :min="0" :max="20" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="attack"><n-form-item label="概率车"><n-input-number v-model:value="opt.probability" :min="0" :max="8" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="!attack"><n-form-item label="第一组车身"><n-input-number v-model:value="opt.firstBody" :min="0" :max="30" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi><n-form-item label="车头依据"><n-select v-model:value="opt.headBy" :options="BY" /></n-form-item></n-gi>
          <n-gi><n-form-item label="车身排法"><n-select v-model:value="opt.bodyBy" :options="BODY" /></n-form-item></n-gi>
          <n-gi><n-form-item label="霹雳车"><n-switch v-model:value="opt.catapult" /></n-form-item></n-gi>
          <n-gi v-if="opt.catapult"><n-form-item label="霹雳车数"><n-input-number v-model:value="opt.catapults" :min="1" :max="4" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="opt.catapult"><n-form-item label="每辆车身"><n-input-number v-model:value="opt.catBody" :min="1" :max="10" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="opt.catapult"><n-form-item label="霹雳车比例"><n-input v-model:value="opt.catRatio" placeholder="6:1:3" /></n-form-item></n-gi>
          <n-gi v-if="attack"><n-form-item label="冲车"><n-switch v-model:value="opt.ram" /></n-form-item></n-gi>
          <n-gi v-if="attack && opt.ram"><n-form-item label="满兵车身" :feedback="`其余 ${ramSingle} 个 1 兵车身，凑满 16 个`"><n-input-number v-model:value="opt.ramFull" :min="5" :max="8" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi v-if="attack && opt.ram"><n-form-item label="候补车身"><n-input-number v-model:value="opt.ramReserve" :min="0" :max="10" :step="1" style="width:100%" /></n-form-item></n-gi>
          <n-gi span="1 s:2"><n-form-item label="标题"><n-input v-model:value="opt.title" :placeholder="attack ? '攻城集结分配' : '守城集结分配'" /></n-form-item></n-gi>
        </n-grid>
      </n-form>
    </n-card>

    <n-card v-if="plan" :title="used.title" :bordered="false">
      <n-alert :type="sel ? 'warning' : 'info'" :bordered="false" style="margin-bottom: 12px">
        <template v-if="sel">已选中 <b>{{ seatOf(sel) ? seatOf(sel).name : '空位' }}</b>，再点另一个位置就对调；点它自己取消。</template>
        <template v-else>点一个人，再点另一个位置即可对调（空位也能点，等于把人挪过去）。<template v-if="plan.ram">冲车是独立队伍：点冲车上的位置再点组里或替补的人，就是把他换上冲车，组里的位置不动。</template></template>
      </n-alert>

      <!-- 一组一张小表并排放，组和组之间留空，不然几十列挤成一坨看不清 -->
      <div class="wrap">
        <div class="cols">
          <table v-for="c in columns" :key="c.name" class="plan">
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
                    @click="row.key && tap(row.key)"
                  >{{ row.text }}<span class="v">{{ row.value }}</span></td>
                </template>
                <template v-else-if="row.kind === 'label'">
                  <td colspan="2" class="l" :style="{ color: c.color.main }">
                    {{ row.text }}<span class="v">{{ row.value }}</span>
                  </td>
                </template>
                <template v-else>
                  <td
                    :class="['s', 'nm', row.kind === 'head' ? 'hd' : '', row.kind === 'dim' ? 'dm' : '', row.kind === 'empty' ? 'em' : '', sel === row.key ? 'on' : '']"
                    :style="{ background: sel === row.key ? '#ffe9a8' : cellBg(row, c) }"
                    @click="tap(row.key)"
                  >{{ row.kind === 'empty' ? '空位' : row.text }}</td>
                  <td
                    :class="['s', 'nu', row.kind === 'head' ? 'hd' : '', row.kind === 'dim' ? 'dm' : '', sel === row.key ? 'on' : '']"
                    :style="{ background: sel === row.key ? '#ffe9a8' : cellBg(row, c) }"
                    @click="tap(row.key)"
                  >{{ row.value }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <n-space align="center" style="margin-top: 14px">
        <span class="bt">替补 {{ bench.length }}</span>
        <n-tag
          v-for="(m, i) in bench"
          :key="i"
          :type="sel === 'b:' + i ? 'warning' : 'default'"
          :bordered="false"
          style="cursor: pointer"
          @click="tap('b:' + i)"
        >{{ m.name }}</n-tag>
        <span v-if="!bench.length" class="bt">（空）</span>
      </n-space>
    </n-card>
  </n-space>
</template>

<style scoped>
.wrap { overflow-x: auto; padding-bottom: 6px; }
.cols { display: flex; gap: 20px; align-items: flex-start; }
table.plan { border-collapse: collapse; font-size: 12px; min-width: 212px; }
table.plan th { color: #fff; padding: 9px 12px; border: 1px solid #e9ebee; }
table.plan td { border: 1px solid #e9ebee; padding: 7px 12px; text-align: center; white-space: nowrap; }
table.plan td.nm { text-align: left; min-width: 112px; }
/* 手机：各组上下排、每组撑满一行，不用左右滑 */
@media (max-width: 767px) {
  .cols { flex-direction: column; gap: 14px; }
  table.plan { width: 100%; }
}
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
.bt { font-size: 13px; color: #6b7280; }
</style>

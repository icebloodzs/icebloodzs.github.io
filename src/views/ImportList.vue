<script setup>
/**
 * 导入名单：粘游戏导出的成员列表，先预演再正式导入。
 * 认人、改名、离队、归队的判断都在云函数里（和小程序走同一个 roster.import），
 * 这边只负责把结果摆清楚。
 */
import { ref, inject, computed, h } from 'vue'
import { useMessage, useDialog, NButton } from 'naive-ui'
import { call } from '../api'

const { me, reload } = inject('app')
const message = useMessage()
const dialog = useDialog()

const text = ref('')
const markMissingOut = ref(true)
const busy = ref(false)
const summary = ref(null)
/*
 * 手动指定的改名：{ 新名字 -> 老记录 _id }。
 * 自动配的那几对会预先填好，管理员可以改、也可以挑"就是新人"。
 * 带着它再预演一次，服务端会按指定的配对重算；正式导入时是**原地改名**，
 * 绑定和六维资料都跟着走，不用导完再合并。
 */
const picks = ref({})
/** 「就是新人」的哨兵值。不能用 null —— n-select 把 null 当成"没选中"，选了之后是一片空白 */
const NEW = '__new__'
/** 在册上限由服务端给（whoami），界面只负责显示 */
const maxMembers = computed(() => (me.value && me.value.alliance && me.value.alliance.maxMembers) || 100)

const PLACEHOLDER = '每行一名成员，列之间用 Tab 分隔\n例如：\n1\t草莓招了\t4\t宫阙3级\t99999999\t0\t999999999\t99999\t999999999'

const stats = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    ['共', s.total, 'default'], ['新增', s.created, 'success'], ['更新', s.updated, 'default'],
    ['认出改名', s.renamed, 'info'], ['归队', s.returned, 'success'],
    ['不在名单', s.missing, 'warning'], ['疑似改名', s.suspects, 'error'],
    ['名字易主', s.handover, 'error'], ['重复', s.duplicates, 'warning']
  ]
})

async function run(dryRun) {
  if (busy.value) return
  if (!text.value.trim()) return message.warning('先把名单粘进来')

  const payload = { text: text.value, markMissingOut: markMissingOut.value, dryRun }
  const chosen = Object.entries(picks.value)
    .filter(([, memberId]) => memberId && memberId !== NEW)
    .map(([name, memberId]) => ({ name, memberId }))
  if (chosen.length) payload.confirmRenames = chosen
  if (!dryRun) {
    const ok = await confirmRun()
    if (!ok) return
    if (summary.value && summary.value.bulkLower) payload.acceptLower = true
  }

  busy.value = true
  try {
    const res = await call('roster.import', payload)
    summary.value = res
    if (dryRun) seedPicks(res)
    if (!dryRun) {
      message.success(`导入完成：新增 ${res.created} · 更新 ${res.updated} · 改名 ${res.renamed}`)
      text.value = ''
      await reload()
    }
  } catch (e) {
    summary.value = null
    message.error(e.message)
  } finally {
    busy.value = false
  }
}

/**
 * 预演回来后，把自动认出的那几对预先选上。
 * 已经手动改过的不覆盖 —— 否则每次重新预演都把人家的选择冲掉。
 */
function seedPicks(res) {
  const next = { ...picks.value }
  ;(res.candidateList || []).forEach((c) => {
    if (next[c.name] !== undefined) return
    const auto = (res.suspectList || []).find((x) => x.to === c.name)
    next[c.name] = auto ? auto.memberId : NEW
  })
  picks.value = next
}

/** 候选下拉的选项：相似度高的在前，已经配给别人的标出来 */
function optionsOf(c) {
  return [
    { label: '就是新人，不是改名', value: NEW },
    ...c.options.map((o) => ({
      label: `${o.name}　相似 ${o.score}%　实力 ${o.strength}　战力 ${o.power}`
        + (o.bound ? '　[已绑微信]' : '')
        + (o.takenBy && o.takenBy !== c.name ? `　(建议配给 ${o.takenBy})` : ''),
      value: o.memberId
    }))
  ]
}

const pickedCount = computed(() => Object.values(picks.value).filter((v) => v && v !== NEW).length)

/** 全部当新人，一个改名都不认 */
function allNew() {
  const next = {}
  ;(summary.value.candidateList || []).forEach((c) => { next[c.name] = NEW })
  picks.value = next
  run(true)
}

function confirmRun() {
  const s = summary.value
  const warn = s && s.bulkLower
    ? `有 ${s.dropped} 人的总功勋比库里小，这份名单可能是旧的或者赛季重置了。`
    : ''
  return new Promise((resolve) => {
    dialog.warning({
      title: '确认导入',
      content: warn + (markMissingOut.value ? '名单里没有的人会被标记为已离队。' : '本次不标记离队。'),
      positiveText: '写进库',
      negativeText: '再想想',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false)
    })
  })
}

async function merge(row) {
  try {
    await call('admin.mergeMembers', { fromId: row.memberId, intoId: row.intoId })
    row.intoId = null
    message.success(`已合并「${row.from}」→「${row.to}」`)
    await reload()
  } catch (e) {
    message.error(e.message)
  }
}

const suspectCols = [
  { title: '老名字', key: 'from' },
  { title: '新名字', key: 'to' },
  { title: '火炉', key: 'furnace' },
  { title: '实力（老 → 新）', key: 'st', render: (r) => `${r.fromStrength} → ${r.toStrength}` },
  { title: '绑定', key: 'bound', render: (r) => (r.bound ? '已绑' : '未绑') },
  {
    title: '操作',
    key: 'op',
    render: (r) => (r.intoId
      ? h(NButton, { size: 'small', onClick: () => merge(r) }, () => '合并成同一人')
      : '导入后可合并')
  }
]
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="导入同盟名单" :bordered="false">
      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        同盟四阶导出数据（含 成员名称/阶级/火炉等级/战力/周功勋/总功勋/周捐献/实力），
        复制后整段粘到下面，<b>保留表头那一行</b>。先点「解析预览」核对，没问题再「确认导入」。
        同盟最多 {{ maxMembers }} 人，超了导不进去。
      </n-alert>

      <n-input v-model:value="text" type="textarea" :rows="8" :placeholder="PLACEHOLDER" />

      <div class="bar">
        <n-checkbox v-model:checked="markMissingOut">把名单里消失的人标记为已离队</n-checkbox>
        <n-space>
          <n-button :loading="busy" @click="run(true)">解析预览</n-button>
          <n-button type="primary" :loading="busy" :disabled="!summary" @click="run(false)">确认导入</n-button>
        </n-space>
      </div>
    </n-card>

    <template v-if="summary">
      <n-card :title="summary.dryRun ? '预览结果（还没写库）' : '导入完成'" :bordered="false">
        <n-space>
          <n-statistic v-for="s in stats" :key="s[0]" :label="s[0]">
            <span :class="'c-' + s[2]">{{ s[1] }}</span>
          </n-statistic>
        </n-space>

        <n-space vertical :size="10" style="margin-top: 16px">
          <n-alert v-if="summary.nameOnly" type="info" :bordered="false">
            这份只有名字，没有数值列：只会更新在册状态，不动战力功勋这些数据。
          </n-alert>
          <n-alert v-if="summary.truncated" type="error" :bordered="false">
            有 {{ summary.truncated }} 行列数不全（多半是粘贴被截断），已跳过没写进去。
          </n-alert>
          <n-alert v-if="summary.overLimit" type="error" :bordered="false">
            导入后在册会有 <b>{{ summary.willBeInRoster }}</b> 人，超过上限 {{ summary.maxMembers }} 人，这样是导不进去的。
            <template v-if="!markMissingOut">
              <b>上面「把名单里消失的人标记为已离队」没勾</b> ——
              不勾的话名单里没有的 {{ summary.missing }} 人会一直留在册上，加起来就超了。勾上再预演一次。
            </template>
            多半是粘错了内容，或者关掉了「把名单里消失的人标记为已离队」。
          </n-alert>
          <n-alert v-if="summary.bulkLower" type="error" :bordered="false">
            有 {{ summary.dropped }} 人的总功勋比库里小，这份名单可能是旧的或者赛季重置了。确认导入时会再问你一次。
          </n-alert>

          <!-- 手动指定改名：每个没按名字对上的新名字，挑一个它可能是谁 -->
          <n-alert v-if="summary.candidateList && summary.candidateList.length" type="info" :bordered="false"
            :title="`这 ${summary.candidateList.length} 个名字库里没有，可能是谁改的名`">
            <div class="hint">
              按火炉、实力、战力算的相似度，从最像的往下排。选好之后点「重新预演」，
              指定的配对会在导入时<b>原地改名</b>——绑定和六维资料都跟着走，不用导完再合并。
              确实是新人就选「就是新人」。
            </div>
            <div v-for="c in summary.candidateList" :key="c.key" class="cand">
              <div class="cand-n">
                {{ c.name }}
                <span class="cand-s">实力 {{ c.strength }} · 战力 {{ c.power }}</span>
              </div>
              <n-select
                v-model:value="picks[c.name]"
                :options="optionsOf(c)"
                size="small"
                style="width: 420px; max-width: 100%"
                placeholder="挑一个它原来叫什么"
              />
            </div>
            <n-space :size="10" style="margin-top: 12px">
              <n-button size="small" type="primary" :loading="busy" @click="run(true)">
                重新预演{{ pickedCount ? `（已指定 ${pickedCount} 对）` : '' }}
              </n-button>
              <n-button v-if="pickedCount" size="small" @click="allNew">都当新人</n-button>
            </n-space>
          </n-alert>

          <n-alert v-if="summary.suspectList && summary.suspectList.length" type="warning" :bordered="false"
            :title="`疑似改名 ${summary.suspects} 人`">
            火炉、实力、战力都相近，但总功勋对不上。确认是同一个人就点「合并」，老记录的绑定和资料会保留。
            <n-data-table :columns="suspectCols" :data="summary.suspectList" size="small" :bordered="false" style="margin-top: 10px" />
          </n-alert>

          <n-alert v-if="summary.renamedList && summary.renamedList.length" type="success" :bordered="false"
            :title="`认出改名 ${summary.renamed} 人（绑定和资料都保留）`">
            <div v-for="x in summary.renamedList" :key="x.to">
              {{ x.from }} → {{ x.to }}（{{ x.how }}{{ x.bound ? '，已绑定' : '' }}）
            </div>
          </n-alert>

          <n-alert v-if="summary.handoverList && summary.handoverList.length" type="error" :bordered="false"
            :title="`名字换人了 ${summary.handover} 个`">
            同名但总功勋对不上，多半是老号退了、新号用了同一个名字。
            <div v-for="x in summary.handoverList" :key="x.name">
              {{ x.name }}：总功勋 {{ x.fromTotal }} → {{ x.toTotal }}{{ x.bound ? '（老号已绑定微信，要手动处理）' : '' }}
            </div>
          </n-alert>

          <n-alert v-if="summary.returnedNames && summary.returnedNames.length" type="success" :bordered="false"
            :title="`归队 ${summary.returned} 人`">
            {{ summary.returnedNames.join('、') }}
          </n-alert>
          <n-alert v-if="summary.createdNames && summary.createdNames.length" type="info" :bordered="false"
            :title="`新增 ${summary.created} 人`">
            {{ summary.createdNames.join('、') }}
          </n-alert>
          <n-alert v-if="summary.missingNames && summary.missingNames.length" type="warning" :bordered="false"
            :title="`不在这份名单里的 ${summary.missing} 人`">
            {{ summary.markMissingOut ? '会标记为已离队，资料和绑定都留着' : '本次不标记，保持原样' }}：{{ summary.missingNames.join('、') }}
          </n-alert>
          <n-alert v-if="summary.duplicateNames && summary.duplicateNames.length" type="warning" :bordered="false"
            :title="`名单里重复 ${summary.duplicates} 个`">
            只取了第一条：{{ summary.duplicateNames.join('、') }}
          </n-alert>
        </n-space>
      </n-card>
    </template>
  </n-space>
</template>

<style scoped>
.hint { font-size: 12px; line-height: 1.7; color: #4b5563; }
.cand { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
.cand-n { width: 230px; flex: none; font-size: 13px; font-weight: 600; }
/* 手机：新名字一行、下拉框一行 */
@media (max-width: 767px) {
  .cand { flex-direction: column; align-items: stretch; gap: 6px; }
  .cand-n { width: auto; }
}
.cand-s { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: #8a9099; }
.bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.c-success { color: #16a34a; }
.c-warning { color: #d97706; }
.c-error { color: #dc2626; }
.c-info { color: #2563eb; }
.c-default { color: #6c5ce7; }
</style>

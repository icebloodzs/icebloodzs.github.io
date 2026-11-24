<script setup>
/**
 * 积分考勤 · 规则与设置。每个同盟一套，互不影响；新盟默认带一套示例。
 * 在本地改完点「保存规则」一次交给云函数（points.saveRules 会再清洗一遍）。
 * 改规则只影响之后新建的场次：已有场次存的是创建时的规则快照。
 */
import { ref, computed, watch } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'
import { TYPE, BY, ruleText, fmtPts } from '../lib/points'

const props = defineProps({ data: Object })
const emit = defineEmits(['saved'])
const message = useMessage()
const dialog = useDialog()
const r = ref(null) // 本地编辑的副本
const curId = ref('att')
const base = ref('')
const saving = ref(false)

function reset() {
  if (!props.data) return
  r.value = JSON.parse(JSON.stringify(props.data.rules))
  base.value = JSON.stringify(r.value)
  if (!r.value.items.some((x) => x.id === curId.value)) curId.value = r.value.items[0].id
}
watch(() => props.data, reset, { immediate: true })
/** 和上次保存的比，有差别就是有改动 */
const dirty = computed(() => Boolean(r.value) && JSON.stringify(r.value) !== base.value)

const it = computed(() => r.value && r.value.items.find((x) => x.id === curId.value))
const TYPE_TIP = { check: '勾上就加/扣固定分，例如空城参与 +1、车头 +1', rank: '成员照游戏排行直接填第几名，按名次分档给分', choice: '多选一的状态，例如到场 / 请假 / 缺席', manual: '直接填分，填几分算几分' }

function setType(t) {
  const x = it.value
  x.type = t
  if (t === 'check' && x.pts == null) x.pts = 1
  if (t === 'rank' && !x.tiers) x.tiers = [{ n: 30, pts: 2 }, { n: 60, pts: 1 }]
  if (t === 'choice' && !x.options) x.options = [{ label: '是', pts: 0 }, { label: '否', pts: -1 }]
  if (t !== 'check' && t !== 'choice') delete x.multi
}
const newId = (p) => p + Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 36).toString(36)
function addItem() {
  const id = newId('i')
  r.value.items.push({ id, name: '新计分项', type: 'check', on: true, by: 'self', pts: 1, desc: '' })
  curId.value = id
}
function delItem() {
  const x = it.value
  const used = r.value.templates.filter((t) => t.items.includes(x.id)).map((t) => t.name)
  dialog.warning({
    title: `删除「${x.name}」？`,
    content: `${used.length ? '会从模板「' + used.join('、') + '」里一起去掉。' : ''}已建的场次用的是当时的规则，分数不变。点「保存规则」后生效。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      r.value.items = r.value.items.filter((y) => y.id !== x.id)
      r.value.templates.forEach((t) => { t.items = t.items.filter((i) => i !== x.id) })
      curId.value = r.value.items[0].id
    }
  })
}
const addTier = () => { const t = it.value.tiers; t.push({ n: (t.length ? t[t.length - 1].n : 0) + 30, pts: 1 }) }
const addOpt = () => it.value.options.push({ label: '新选项', pts: 0 })

function addTpl() {
  r.value.templates.push({ id: newId('t'), name: '新模板', items: ['att'] })
}
function delTpl(t) {
  r.value.templates = r.value.templates.filter((x) => x.id !== t.id)
}
const toggleTplItem = (t, id) => { const i = t.items.indexOf(id); if (i >= 0) t.items.splice(i, 1); else t.items.push(id) }

async function save() {
  saving.value = true
  try {
    const res = await call('points.saveRules', { rules: r.value })
    emit('saved', res)
    message.success('规则已保存，之后新建的场次按新规则算')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
function restoreDefault() {
  dialog.warning({
    title: '恢复成示例规则？',
    content: '计分项和模板会换回默认那套（点「保存规则」后才生效）。',
    positiveText: '恢复',
    negativeText: '取消',
    onPositiveClick: async () => {
      // 默认规则只在云函数里有一份：拿一个没存过规则的视图不方便，这里直接让服务端存空规则会被拒，所以用 rules 接口带回的 defaults
      if (props.data && props.data.defaults) r.value = JSON.parse(JSON.stringify(props.data.defaults))
    }
  })
}
async function newSeason() {
  dialog.warning({
    title: `开始新赛季？`,
    content: `${props.data.season} 归档只读，积分从 0 算。`,
    positiveText: '开始',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await call('points.newSeason')
        message.success(`已开始 ${res.season} 赛季`)
        emit('saved', await call('points.rules'))
      } catch (e) {
        message.error(e.message)
      }
    }
  })
}
const DEADLINES = [{ label: '当天 23:59', value: 'day2359' }, { label: '次日 12:00', value: 'next1200' }, { label: '创建后 6 小时', value: 'plus6h' }]
const RANK_SHOWS = [{ label: '前 10 名 + 自己', value: 'top10' }, { label: '全盟', value: 'all' }, { label: '只看自己', value: 'self' }]
</script>

<template>
  <div v-if="r" class="pr">
    <n-alert type="info" :bordered="false">
      这是本盟自己的规则，每个同盟各一套，互不影响。新建的同盟默认带一套示例，按需改、可删。改规则只影响<b>之后新建</b>的场次，已有场次用创建时的规则，分数不会被悄悄改掉。
    </n-alert>
    <div class="pr-bar">
      <span v-if="dirty" class="pr-dirty">有改动还没保存</span>
      <n-button v-if="props.data.defaults" size="small" @click="restoreDefault">恢复示例规则</n-button>
      <n-button size="small" :disabled="!dirty" @click="reset">撤销改动</n-button>
      <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存规则</n-button>
    </div>

    <div class="pr-grid">
      <div>
        <n-card :bordered="false" size="small" title="计分项">
          <template #header-extra><n-button size="tiny" @click="addItem">＋ 新增</n-button></template>
          <div v-for="x in r.items" :key="x.id" class="pr-it" :class="{ on: x.id === curId, off: !x.on }" @click="curId = x.id">
            <span class="ty">{{ TYPE[x.type] }}</span>
            <div class="nm">{{ x.name }}<small>{{ ruleText(x) }} · {{ BY[x.by] }}</small></div>
          </div>
        </n-card>

        <n-card :bordered="false" size="small" title="设置" style="margin-top: 16px">
          <n-form label-placement="left" label-width="86" size="small">
            <n-form-item label="赛季">
              <div>
                <n-radio-group v-model:value="r.settings.autoSeason" size="small">
                  <n-radio-button :value="true" label="跟游戏自动切换" /><n-radio-button :value="false" label="手动" />
                </n-radio-group>
                <div class="pr-tip">
                  当前 {{ props.data.season }}。
                  <template v-if="r.settings.autoSeason">同盟切到新赛季（{{ props.data.gameSeason || '同盟信息里的赛季' }} 之后）时自动把旧赛季归档只读，积分从 0 算，不用手动操作。</template>
                  <template v-else>需要时手动 <n-button text type="primary" size="tiny" :disabled="props.data.rules.settings.autoSeason" @click="newSeason">开始新赛季</n-button>（先保存成「手动」）。</template>
                </div>
              </div>
            </n-form-item>
            <n-form-item label="默认截止"><n-select v-model:value="r.settings.deadline" :options="DEADLINES" /></n-form-item>
            <n-form-item label="截止没填">
              <n-radio-group v-model:value="r.settings.autoAbsent" size="small">
                <n-radio-button :value="true" label="自动记缺席" /><n-radio-button :value="false" label="留空等组长处理" />
              </n-radio-group>
            </n-form-item>
            <n-form-item label="成员看排行"><n-select v-model:value="r.settings.rankShow" :options="RANK_SHOWS" /></n-form-item>
          </n-form>
        </n-card>
      </div>

      <div>
        <n-card v-if="it" :bordered="false" size="small">
          <template #header>编辑「{{ it.name }}」 <n-tag size="small" :bordered="false">{{ TYPE[it.type] }}型</n-tag></template>
          <template #header-extra>
            <span v-if="it.id === 'att'" class="pr-tip">出勤是基础项，截止自动缺席要用它，不能删</span>
            <n-button v-else size="tiny" type="error" ghost @click="delItem">删除此项</n-button>
          </template>
          <n-form label-placement="left" label-width="96" size="small">
            <n-form-item label="名称"><n-input v-model:value="it.name" maxlength="20" style="max-width: 260px" /></n-form-item>
            <n-form-item label="类型">
              <div>
                <n-radio-group :value="it.type" size="small" :disabled="it.id === 'att'" @update:value="setType">
                  <n-radio-button v-for="(n, k) in TYPE" :key="k" :value="k" :label="n" />
                </n-radio-group>
                <div class="pr-tip">{{ TYPE_TIP[it.type] }}</div>
              </div>
            </n-form-item>
            <n-form-item label="谁来填">
              <div>
                <n-radio-group v-model:value="it.by" size="small">
                  <n-radio-button v-for="(n, k) in BY" :key="k" :value="k" :label="n" />
                </n-radio-group>
                <div class="pr-tip">「本人填」的项出现在成员的填写页；组长和管理员什么项都能改。</div>
              </div>
            </n-form-item>
            <n-form-item v-if="(it.type === 'check' || it.type === 'choice') && it.id !== 'att'" label="一场多次">
              <n-checkbox :checked="Boolean(it.multi)" @update:checked="(v) => { if (v) it.multi = true; else delete it.multi }">
                一场里可能有多次（{{ it.type === 'check' ? '成员填次数，次数 × 分值' : '每个选项填次数，分数累加' }}）
              </n-checkbox>
            </n-form-item>
            <n-form-item v-if="it.type === 'check'" label="分值">
              <n-input-number v-model:value="it.pts" :min="-100" :max="100" style="width: 120px" /><span class="pr-tip" style="margin: 0 0 0 8px">负数就是扣分</span>
            </n-form-item>
            <n-form-item v-if="it.type === 'rank'" label="分档">
              <div>
                <div v-for="(t, i) in it.tiers" :key="i" class="pr-row">
                  {{ i ? '第 ' + (it.tiers[i - 1].n + 1) + ' 到' : '前' }}
                  <n-input-number v-model:value="t.n" :min="1" :max="9999" :show-button="false" style="width: 72px" /> 名
                  <n-input-number v-model:value="t.pts" :min="-100" :max="100" :show-button="false" style="width: 72px" /> 分
                  <n-button text type="error" size="tiny" @click="it.tiers.splice(i, 1)">删</n-button>
                </div>
                <n-button size="tiny" @click="addTier">＋ 加一档</n-button>
                <div class="pr-tip">其余不计分，没填不计分。</div>
              </div>
            </n-form-item>
            <n-form-item v-if="it.type === 'choice'" label="选项">
              <div>
                <div v-for="(o, i) in it.options" :key="i" class="pr-row">
                  <n-input v-model:value="o.label" maxlength="12" style="width: 120px" />
                  <n-input-number v-model:value="o.pts" :min="-100" :max="100" :show-button="false" style="width: 72px" /> 分
                  <n-checkbox :checked="!o.noSelf" @update:checked="(v) => { if (v) delete o.noSelf; else o.noSelf = true }">本人可选</n-checkbox>
                  <n-button v-if="!(it.id === 'att' && i < 3) && it.options.length > 2" text type="error" size="tiny" @click="it.options.splice(i, 1)">删</n-button>
                </div>
                <n-button size="tiny" @click="addOpt">＋ 加一个</n-button>
                <div class="pr-tip">{{ it.id === 'att' ? '到场、请假、缺席是固定的三项（请假会清空其他项、截止没填记缺席），只能改名和分值；可以再加别的，比如「迟到 −1」。' : '至少留两个选项。' }}</div>
              </div>
            </n-form-item>
            <n-form-item v-if="it.type === 'manual'" label="填法"><span class="pr-tip" style="margin: 0">组长/管理员在场次表里直接填分数，正数加分、负数扣分。</span></n-form-item>
            <n-form-item label="给成员看的说明"><n-input v-model:value="it.desc" type="textarea" :autosize="{ minRows: 2 }" maxlength="120" /></n-form-item>
            <n-form-item label="状态"><n-checkbox v-model:checked="it.on">启用（停用后新场次选不到，历史不受影响）</n-checkbox></n-form-item>
          </n-form>
        </n-card>

        <n-card :bordered="false" size="small" style="margin-top: 16px">
          <template #header>场次模板 <span class="pr-tip" style="display: inline; font-weight: 400">新建场次时一键带出这些项</span></template>
          <div v-for="t in r.templates" :key="t.id" class="pr-tpl">
            <div class="pr-row">
              <n-input v-model:value="t.name" maxlength="12" size="small" style="width: 140px" />
              <span class="pr-tip" style="margin: 0">{{ t.items.length }} 项</span>
              <span style="flex: 1" />
              <n-button v-if="r.templates.length > 1" text type="error" size="tiny" @click="delTpl(t)">删除模板</n-button>
            </div>
            <div class="pr-picks">
              <span v-for="x in r.items.filter((y) => y.on)" :key="x.id" class="pr-pick" :class="{ on: t.items.includes(x.id) }" @click="toggleTplItem(t, x.id)">{{ x.name }}</span>
            </div>
          </div>
          <n-button size="small" @click="addTpl">＋ 新模板</n-button>
        </n-card>
      </div>
    </div>
  </div>
  <n-spin v-else style="width: 100%; padding: 60px 0" />
</template>

<style scoped>
.pr { display: flex; flex-direction: column; gap: 12px; }
.pr-bar { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.pr-dirty { color: #d97706; font-size: 13px; margin-right: auto; }
.pr-grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; align-items: start; }
html.narrow .pr-grid { grid-template-columns: 1fr; }
.pr-it { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
.pr-it:hover { background: #fafafc; }
.pr-it.on { border-color: #6c5ce7; background: #f4f2ff; }
.pr-it .ty { font-size: 11px; width: 34px; text-align: center; border-radius: 3px; padding: 1px 0; background: #f2f3f5; color: #666; flex: none; }
.pr-it .nm { flex: 1; }
.pr-it .nm small { display: block; color: #8a9099; font-size: 12px; }
.pr-it.off .nm { color: #bbb; text-decoration: line-through; }
.pr-tip { color: #8a9099; font-size: 12px; margin-top: 6px; }
.pr-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.pr-tpl { border: 1px solid #efeff5; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.pr-picks { display: flex; gap: 6px; flex-wrap: wrap; }
.pr-pick { font-size: 12px; padding: 3px 10px; border-radius: 12px; border: 1px solid #e0e0e6; cursor: pointer; }
.pr-pick.on { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
</style>

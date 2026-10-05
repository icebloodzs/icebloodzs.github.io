<script setup>
/**
 * 我的信息：六维和武将战力只能传截图（服务端识别后入库），
 * 集结值、单人出征、两档兵力是手填的。
 */
import { inject, ref, computed, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { call } from '../api'
import { big, num, when } from '../fmt'

const { me, season, reload, refreshMe } = inject('app')
const message = useMessage()

const ARMS = [['inf', '步兵'], ['cav', '骑兵'], ['arc', '弓兵']]
const LEVELS = ['2', '3']
/** 表格里每一档的说明，免得对着两行空格子猜该填哪个 */
const LEVEL_HINT = { 2: '二级兵营', 3: '三级兵营' }
const SIX = [
  ['步兵', [['infDef', '防御力'], ['infHp', '生命值']]],
  ['骑兵', [['cavAtk', '攻击力'], ['cavBreak', '破坏力']]],
  ['弓兵', [['arcAtk', '攻击力'], ['arcBreak', '破坏力']]]
]

const member = computed(() => me.value && me.value.member)
const busy = ref('')
const saving = ref(false)
const before = ref(null)

const form = ref(blank())
function blank() {
  const t = {}
  LEVELS.forEach((lv) => { t[lv] = { inf: null, cav: null, arc: null } })
  return { maxBonus: null, maxMarch: null, troops: t }
}

function fill(m) {
  if (!m) return
  const t = {}
  LEVELS.forEach((lv) => {
    t[lv] = {}
    ARMS.forEach(([k]) => {
      const v = m.troopsByLevel && m.troopsByLevel[lv] ? m.troopsByLevel[lv][k] : null
      t[lv][k] = v === null || v === undefined ? null : Number(v)
    })
  })
  form.value = { maxBonus: m.maxBonus ?? null, maxMarch: m.maxMarch ?? null, troops: t }
}
watch(member, fill, { immediate: true })

const levelSum = (lv) => {
  let s = null
  ARMS.forEach(([k]) => {
    const v = form.value.troops[lv][k]
    if (v !== null && v !== undefined) s = (s || 0) + Number(v)
  })
  return s
}
const allSum = computed(() => {
  let s = null
  LEVELS.forEach((lv) => {
    const one = levelSum(lv)
    if (one !== null) s = (s || 0) + one
  })
  return s
})
const fmtSum = (v) => (v === null ? '—' : String(Math.round(v * 10) / 10))

const position = computed(() => {
  const s = season.value
  const score = member.value && member.value.seasonScore
  if (!s || score === null || score === undefined) return null
  const list = [['先锋', 'success'], ['督军', 'info'], ['镇国', 'warning'], ['巅峰镇国', 'error']]
  const i = score < s.vanguardMax ? 0 : score < s.marshalMax ? 1 : score < s.guardianMax ? 2 : 3
  return list[i]
})

/** 原图动辄三五兆，压到长边 1280 再传 */
function compress(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读不了这个文件'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('这不是一张图片'))
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

async function upload({ file }, kind) {
  if (busy.value) return
  busy.value = kind
  before.value = kind === 'attrs' ? member.value : null
  try {
    const base64 = await compress(file.file)
    const res = await call('web.uploadShot', { kind, base64, ext: 'jpg' })
    await refreshMe()
    await reload()
    message.success(kind === 'attrs'
      ? `识别到 ${res.recognized.count}/6 项并已保存`
      : `读到武将战力 ${res.heroPowerText}，已保存`)
  } catch (e) {
    before.value = null
    message.error(e.message)
  } finally {
    busy.value = ''
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const res = await call('profile.save', {
      troopsByLevel: form.value.troops,
      camps: (member.value && member.value.camps) || [],
      maxBonus: form.value.maxBonus,
      battleReportFileId: member.value && member.value.battleReportFileId,
      maxMarch: form.value.maxMarch === null ? '' : String(form.value.maxMarch)
    })
    me.value.member = res.member
    fill(res.member)
    await reload()
    message.success('已保存')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}

/** 传完属性后和上次比一比 */
const diff = computed(() => {
  if (!before.value || !member.value) return null
  return SIX.map(([arm, items]) => ({
    arm,
    items: items.map(([k, label]) => {
      const o = before.value.attrs ? before.value.attrs[k] : null
      const n = member.value.attrs ? member.value.attrs[k] : null
      const d = (o === null || o === undefined || n === null || n === undefined) ? null : Number(n) - Number(o)
      return { label, old: o, now: n, d }
    })
  }))
})
const dColor = (d) => (d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#9aa0a6')
</script>

<template>
  <n-result v-if="!member" status="info" title="还没绑定成员账号"
    description="你的微信还没绑定名单里的成员账号，先在小程序里「去绑定」，绑完这里就能传截图了。" />

  <n-space v-else vertical :size="16">
    <!-- 六维 -->
    <n-card :bordered="false">
      <template #header>我的属性 · {{ member.name }}</template>
      <template #header-extra><n-tag size="small" :bordered="false">只能截图识别</n-tag></template>

      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        数值只认截图识别的结果，不支持手动修改。传一张游戏里的「属性加成」面板截图就会自动识别入库。
      </n-alert>

      <n-grid :cols="3" :x-gap="14">
        <n-gi v-for="[arm, items] in SIX" :key="arm">
          <n-card size="small" :title="arm" embedded :bordered="false">
            <div v-for="[k, label] in items" :key="k" class="row">
              <span>{{ label }}</span>
              <b>{{ member.attrs && member.attrs[k] != null ? num(member.attrs[k], 2) + '%' : '未录入' }}</b>
            </div>
          </n-card>
        </n-gi>
      </n-grid>

      <n-descriptions :column="2" style="margin-top: 14px" label-placement="left" size="small" bordered>
        <n-descriptions-item label="六维总和">{{ num(member.attrsSum, 2) }}</n-descriptions-item>
        <n-descriptions-item label="最后更新">{{ member.attrsUpdatedAt ? when(member.attrsUpdatedAt) : '从未上传' }}</n-descriptions-item>
      </n-descriptions>

      <n-upload :show-file-list="false" accept="image/*" :custom-request="(o) => upload(o, 'attrs')" style="margin-top: 14px">
        <n-button type="primary" :loading="busy === 'attrs'" block>
          {{ busy === 'attrs' ? '识别中…' : '上传属性截图' }}
        </n-button>
      </n-upload>
    </n-card>

    <!-- 和上次比 -->
    <n-card v-if="diff" :bordered="false" title="和上次比">
      <n-grid :cols="3" :x-gap="14">
        <n-gi v-for="g in diff" :key="g.arm">
          <n-card size="small" :title="g.arm" embedded :bordered="false">
            <div v-for="it in g.items" :key="it.label" class="row">
              <span>{{ it.label }}</span>
              <b>
                <span class="old">{{ num(it.old, 2) }}%</span> → {{ num(it.now, 2) }}%
                <span v-if="it.d !== null" :style="{ color: dColor(it.d) }">
                  ({{ it.d > 0 ? '+' : '' }}{{ it.d.toFixed(2) }})
                </span>
              </b>
            </div>
          </n-card>
        </n-gi>
      </n-grid>
    </n-card>

    <!-- 赛季评分 -->
    <n-card :bordered="false" :title="'赛季评分 · ' + ((season && season.label) || '')">
      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        评分 = 成员实力 − 武将战力。武将战力同样只能靠截图识别，传战力面板截图即可。
      </n-alert>
      <n-descriptions :column="5" bordered size="small">
        <n-descriptions-item label="成员实力">{{ big(member.strength) }}</n-descriptions-item>
        <n-descriptions-item label="武将战力">{{ member.heroPower == null ? '未录入' : big(member.heroPower) }}</n-descriptions-item>
        <n-descriptions-item label="赛季评分">{{ big(member.seasonScore) }}</n-descriptions-item>
        <n-descriptions-item label="定位">
          <n-tag v-if="position" size="small" :type="position[1]" :bordered="false">{{ position[0] }}</n-tag>
          <span v-else>—</span>
        </n-descriptions-item>
        <n-descriptions-item label="最后更新">{{ member.heroPowerUpdatedAt ? when(member.heroPowerUpdatedAt) : '从未上传' }}</n-descriptions-item>
      </n-descriptions>
      <n-upload :show-file-list="false" accept="image/*" :custom-request="(o) => upload(o, 'hero')" style="margin-top: 14px">
        <n-button type="primary" :loading="busy === 'hero'" block>
          {{ busy === 'hero' ? '识别中…' : '上传战力截图' }}
        </n-button>
      </n-upload>
    </n-card>

    <!-- 手填的几项 -->
    <n-card :bordered="false" title="集结与兵力">
      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        这几项游戏里没有现成截图，手填。集结值和单人出征说的是<b>同一队</b>——你集结值最高的那一队，以及这一队能带多少兵。
        <div class="tip">
          <div><b>宫3</b>：三级兵营带的兵，步 / 骑 / 弓分开填，单位万。</div>
          <div><b>宫2</b>：二级兵营带的兵，填法一样。</div>
          <div>只有一档的就只填那一行，另一行<b>留空</b>。留空是「没有这一档」，填 0 是「有兵营但兵是 0」，统计时不一样。</div>
        </div>
      </n-alert>

      <n-form label-placement="left" :label-width="110" size="small">
        <n-grid :cols="2" :x-gap="20">
          <n-gi>
            <n-form-item label="最高集结值">
              <n-input-number v-model:value="form.maxBonus" :min="0" :step="1" placeholder="如 28.50" style="width: 100%">
                <template #suffix>%</template>
              </n-input-number>
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="单人出征数量">
              <n-input-number v-model:value="form.maxMarch" :min="0" :step="10000" placeholder="如 143510" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <n-table :bordered="false" :single-line="false" size="small" style="margin-top: 6px">
        <thead>
          <tr>
            <th style="width: 108px">兵营</th>
            <th v-for="[k, label] in ARMS" :key="k">{{ label }}</th>
            <th style="width: 90px">小计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lv in LEVELS" :key="lv">
            <td>
              <b>宫{{ lv }}</b>
              <div class="lvh">{{ LEVEL_HINT[lv] }}</div>
            </td>
            <td v-for="[k] in ARMS" :key="k">
              <n-input-number v-model:value="form.troops[lv][k]" :min="0" :step="1" placeholder="-" size="small" style="width: 100%" />
            </td>
            <td class="sum">{{ fmtSum(levelSum(lv)) }}</td>
          </tr>
        </tbody>
      </n-table>

      <div class="foot">
        <span>两档合计 <b>{{ fmtSum(allSum) }}</b> 万</span>
        <n-button type="primary" :loading="saving" @click="save">保存</n-button>
      </div>
    </n-card>
  </n-space>
</template>

<style scoped>
.row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; color: #4b5563; }
.row b { color: #6c5ce7; }
.old { color: #9aa0a6; }
.tip { margin-top: 6px; line-height: 1.8; }
.tip b { color: #4b5563; }
.lvh { font-size: 11px; color: #9aa0a6; line-height: 1.4; margin-top: 1px; }
.sum { text-align: right; font-weight: 600; color: #6c5ce7; }
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; font-size: 13px; color: #4b5563; }
.foot b { color: #6c5ce7; font-size: 16px; }
</style>

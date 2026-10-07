<script setup>
/**
 * 我的属性排名。
 *
 * 这一屏不是给管理员看的，是给成员自己看的：我排第几、这次涨了多少、
 * 离前面那个还差多少。数字能看见在动，才有继续传截图的动力。
 */
import { ref, computed, onMounted, inject } from 'vue'
import { call } from '../api'
import { num } from '../fmt'

const { me } = inject('app')

const data = ref(null)
const board = ref(null)
const err = ref('')
const days = ref(7)

async function load() {
  err.value = ''
  try {
    const [mine, growth] = await Promise.all([
      call('attrs.mine'),
      call('attrs.growth', { days: days.value, limit: 8 })
    ])
    data.value = mine
    board.value = growth
  } catch (e) {
    err.value = e.message || '加载失败'
  }
}
onMounted(load)

const bound = computed(() => Boolean(me.value && me.value.member))
const change = computed(() => (data.value && data.value.change) || null)
const history = computed(() => (data.value && data.value.history) || [])

/** 名次条：第几名换算成百分位，越靠前条越长 */
const topPercent = computed(() => {
  const d = data.value
  if (!d || !d.rank || !d.total) return 0
  return Math.round(((d.total - d.rank + 1) / d.total) * 100)
})

/*
 * 折线图。没有引图表库 —— 就一条线，手写 SVG 比装一个库划算得多。
 * 点少于两个就不画（一条线至少得有两头）。
 */
const W = 640
const H = 180
const PAD = { l: 8, r: 8, t: 16, b: 24 }

const chart = computed(() => {
  const pts = history.value.filter((p) => p.sum != null)
  if (pts.length < 2) return null
  const vals = pts.map((p) => p.sum)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  // 全程没变过的话给个假的上下界，不然除以 0
  if (hi === lo) { hi = lo + 1; lo -= 1 }
  const span = hi - lo
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const xy = pts.map((p, i) => ({
    x: PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw),
    y: PAD.t + ih - ((p.sum - lo) / span) * ih,
    sum: p.sum,
    at: p.at
  }))
  return {
    pts: xy,
    line: xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    // 线下面填一块浅色，视觉上更像「涨上去的」
    area: `${PAD.l},${PAD.t + ih} ` + xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` ${(PAD.l + iw)},${PAD.t + ih}`,
    lo,
    hi
  }
})

const dayText = (v) => (v ? String(v).slice(5, 10).replace('-', '/') : '')
const signed = (v, digits = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + num(v, digits))
</script>

<template>
  <div class="page">
    <n-alert v-if="err" type="error" :bordered="false">{{ err }}</n-alert>
    <n-alert v-else-if="!bound" type="info" :bordered="false">
      还没绑定游戏账号，绑定之后这里才会显示你的属性和排名。
    </n-alert>

    <template v-else-if="data">
      <!-- 名次 + 这次涨了多少 -->
      <n-card :bordered="false" size="small">
        <div class="top">
          <div class="rank">
            <div class="rank-n">
              <span class="hash">第</span>{{ data.rank || '—' }}<span class="hash">名</span>
            </div>
            <div class="rank-s">全盟 {{ data.total }} 人传过属性 · 超过 {{ topPercent }}%</div>
            <div class="bar"><div class="bar-in" :style="{ width: topPercent + '%' }"></div></div>
          </div>
          <div class="sum">
            <div class="sum-n">{{ data.me ? num(data.me.sum, 2) : '—' }}</div>
            <div class="sum-s">{{ data.keys.length }}维总和</div>
          </div>
          <div v-if="change && change.delta != null" class="jump" :class="{ big: change.big }">
            <div class="jump-n">{{ signed(change.delta) }}</div>
            <div class="jump-s">比上次 {{ change.percent != null ? signed(change.percent, 1) + '%' : '' }}</div>
          </div>
        </div>
        <n-alert v-if="change && change.big" type="success" :bordered="false" style="margin-top: 12px">
          🎉 这次涨了 {{ signed(change.percent, 1) }}%，是一次大跨步 —— 继续保持。
        </n-alert>
      </n-card>

      <div class="cols">
        <!-- 折线 -->
        <n-card :bordered="false" size="small" title="属性走势" class="col">
          <template #header-extra>
            <span class="lab">{{ history.length }} 次记录</span>
          </template>
          <svg v-if="chart" class="chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
            <polyline :points="chart.area" fill="rgba(108,92,231,0.12)" stroke="none" />
            <polyline :points="chart.line" fill="none" stroke="#6c5ce7" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
            <g v-for="(p, i) in chart.pts" :key="i">
              <circle :cx="p.x" :cy="p.y" r="3.5" fill="#fff" stroke="#6c5ce7" stroke-width="2" />
            </g>
            <text :x="PAD.l" :y="H - 6" font-size="11" fill="#8a9099">{{ dayText(chart.pts[0].at) }}</text>
            <text :x="W - PAD.r" :y="H - 6" font-size="11" fill="#8a9099" text-anchor="end">
              {{ dayText(chart.pts[chart.pts.length - 1].at) }}
            </text>
          </svg>
          <div v-else class="empty">
            至少传过两次属性才画得出走势，现在只有 {{ history.length }} 次。
          </div>
          <div v-if="chart" class="lab" style="margin-top: 6px">
            区间 {{ num(chart.lo, 0) }} ~ {{ num(chart.hi, 0) }}
          </div>
        </n-card>

        <!-- 逐维 -->
        <n-card :bordered="false" size="small" title="每一维的变化" class="col">
          <div v-for="d in (change ? change.dims : [])" :key="d.key" class="dim">
            <span class="dim-l">{{ d.label }}</span>
            <span class="dim-v">{{ d.to == null ? '—' : num(d.to, 2) }}</span>
            <span class="dim-d" :class="d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : ''">
              {{ d.delta == null ? '首次' : d.delta === 0 ? '持平' : signed(d.delta) }}
            </span>
          </div>
          <div v-if="!change" class="empty">还没有属性记录。</div>
        </n-card>
      </div>

      <!-- 前后两位 -->
      <n-card :bordered="false" size="small" title="追赶目标">
        <div class="nb">
          <div class="nb-one" :class="{ dim: !data.above }">
            <div class="lab">前面一位</div>
            <template v-if="data.above">
              <div class="nb-n">{{ data.above.name }}</div>
              <div class="nb-g">还差 <b>{{ num(data.above.gap, 2) }}</b> 就能超过他</div>
            </template>
            <div v-else class="nb-n">你就是第一 👑</div>
          </div>
          <div class="nb-one me">
            <div class="lab">我</div>
            <div class="nb-n">{{ data.me ? data.me.name : '' }}</div>
            <div class="nb-g">{{ data.me ? num(data.me.sum, 2) : '' }}</div>
          </div>
          <div class="nb-one" :class="{ dim: !data.below }">
            <div class="lab">后面一位</div>
            <template v-if="data.below">
              <div class="nb-n">{{ data.below.name }}</div>
              <div class="nb-g">领先他 <b>{{ num(data.below.gap, 2) }}</b></div>
            </template>
            <div v-else class="nb-n">你在最后一位</div>
          </div>
        </div>
      </n-card>

      <!-- 成长榜 -->
      <n-card :bordered="false" size="small" title="成长榜">
        <template #header-extra>
          <n-radio-group v-model:value="days" size="small" @update:value="load">
            <n-radio-button :value="7">近 7 天</n-radio-button>
            <n-radio-button :value="30">近 30 天</n-radio-button>
          </n-radio-group>
        </template>
        <div v-if="board && board.rows.length" class="gl">
          <div v-for="(r, i) in board.rows" :key="r.memberId" class="g" :class="{ me: r.mine }">
            <span class="g-i" :class="'m' + (i + 1)">{{ i + 1 }}</span>
            <span class="g-n">{{ r.name }}<span v-if="r.mine" class="g-me">我</span></span>
            <span class="g-d">{{ signed(r.delta) }}</span>
            <span class="g-p">{{ r.percent != null ? signed(r.percent, 1) + '%' : '' }}</span>
          </div>
        </div>
        <div v-else class="empty">这 {{ days }} 天还没人更新过属性。</div>
      </n-card>
    </template>

    <n-spin v-else style="margin: 60px auto; display: block" />
  </div>
</template>

<style scoped>
.page { height: var(--page-h); min-height: 360px; overflow: auto; }
.page > * + * { margin-top: 14px; }
.lab { font-size: 12px; color: #8a9099; }
.empty { padding: 24px 0; text-align: center; font-size: 13px; color: #9aa0a6; }

.top { display: flex; align-items: center; gap: 28px; }
.rank { flex: 1; min-width: 0; }
.rank-n { font-size: 38px; font-weight: 700; line-height: 1; color: #6c5ce7; font-variant-numeric: tabular-nums; }
.hash { font-size: 15px; font-weight: 500; color: #8a9099; margin: 0 4px; }
.rank-s { margin-top: 8px; font-size: 12px; color: #8a9099; }
.bar { margin-top: 8px; height: 6px; border-radius: 999px; background: #eceaf5; overflow: hidden; }
.bar-in { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #a79bff, #6c5ce7); }

.sum, .jump { text-align: right; flex: none; }
.sum-n { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sum-s, .jump-s { margin-top: 6px; font-size: 12px; color: #8a9099; }
.jump-n { font-size: 26px; font-weight: 700; color: #16a34a; font-variant-numeric: tabular-nums; }
.jump.big .jump-n { color: #e23832; }

.cols { display: flex; gap: 14px; align-items: stretch; }
.col { flex: 1; min-width: 0; }
.chart { width: 100%; height: 180px; display: block; }

.dim { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; border-top: 1px solid #f1f1f5; }
.dim:first-child { border-top: 0; }
.dim-l { width: 68px; flex: none; font-size: 13px; color: #4b5563; }
.dim-v { flex: 1; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dim-d { font-size: 13px; color: #9aa0a6; font-variant-numeric: tabular-nums; }
.dim-d.up { color: #16a34a; font-weight: 600; }
.dim-d.down { color: #e23832; font-weight: 600; }

.nb { display: flex; gap: 12px; }
.nb-one { flex: 1; padding: 12px 14px; border-radius: 10px; background: #fafafc; }
.nb-one.me { background: #f3f0ff; }
.nb-one.dim { opacity: 0.55; }
.nb-n { margin-top: 6px; font-size: 15px; font-weight: 600; }
.nb-g { margin-top: 4px; font-size: 12px; color: #8a9099; }
.nb-g b { color: #6c5ce7; font-size: 13px; }

.gl { display: flex; flex-direction: column; }
.g { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 8px; }
.g.me { background: #f3f0ff; }
.g-i {
  flex: none; width: 22px; height: 22px; border-radius: 6px; background: #eceaf5;
  color: #8a9099; font-size: 12px; font-weight: 700; text-align: center; line-height: 22px;
}
.g-i.m1 { background: #ffd66b; color: #7a4a00; }
.g-i.m2 { background: #dfe3ea; color: #4b5563; }
.g-i.m3 { background: #f0c9a0; color: #7a4a00; }
.g-n { flex: 1; min-width: 0; font-size: 14px; }
.g-me { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: #6c5ce7; color: #fff; font-size: 11px; }
.g-d { font-size: 14px; font-weight: 700; color: #16a34a; font-variant-numeric: tabular-nums; }
.g-p { width: 64px; text-align: right; font-size: 12px; color: #8a9099; font-variant-numeric: tabular-nums; }
</style>

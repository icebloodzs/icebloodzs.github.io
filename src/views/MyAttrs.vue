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
 * 走势图。没引图表库 —— 几条折线加一套刻度，手写 SVG 比装个库划算。
 *
 * 两种看法：
 *   分维 —— 每一维各一条线，六条并排看，谁在涨谁没动一目了然（默认）
 *   总和 —— 只画总和那一条。总和是三千多、单维是几百，画在一起会把单维压成平线，
 *           所以分开两个模式，不混在一张图里
 */
const W = 680
const H = 260
const PAD = { l: 44, r: 12, t: 14, b: 42 }
const mode = ref('dims')
/** 鼠标移到哪一列（或点中哪一列）；-1 = 没选 */
const hover = ref(-1)

/** 六维配色，顺序和 attrKeys 一致：步 → 骑 → 弓，同兵种深浅成对 */
const BAND = ['#5b7cfa', '#9db4ff', '#12a594', '#5eead4', '#f59e0b', '#fcd34d']

/** 刻度取整：1 / 2 / 5 的倍数，标出来才是整数 */
function ticksOf(lo, hi, n = 5) {
  const raw = (hi - lo) / n || 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const k = raw / mag
  const step = (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * mag
  const out = []
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) {
    if (v >= lo - step * 0.001) out.push(Math.round(v * 100) / 100)
  }
  return out
}

const chart = computed(() => {
  const pts = history.value.filter((p) => p.sum != null)
  if (pts.length < 2) return null
  const keys = (data.value && data.value.keys) || []
  const labels = (data.value && data.value.labels) || []
  const dims = mode.value === 'dims'

  /*
   * 纵轴范围按数据本身留边，不从 0 起。
   * 六维都是三五百，从 0 画会把六条线全挤在上面三分之一，谁涨谁跌根本分不出来 ——
   * 这一屏要看的就是「有没有在涨」，不是比谁的绝对值大，所以留边优先。
   */
  const all = dims
    ? pts.reduce((acc, p) => acc.concat((p.values || []).filter((v) => v != null)), [])
    : pts.map((p) => p.sum)
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (hi === lo) hi = lo + 1
  const pad = (hi - lo) * 0.18
  lo = Math.max(0, lo - pad)
  hi += pad
  const ts = ticksOf(lo, hi)
  hi = Math.max(hi, ts[ts.length - 1])
  lo = Math.min(lo, ts[0])

  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const xAt = (i) => PAD.l + (i / (pts.length - 1)) * iw
  const yAt = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih

  const series = dims
    ? keys.map((k, j) => ({
        key: k,
        label: labels[j] || k,
        color: BAND[j % BAND.length],
        pts: pts.map((p, i) => ({ x: xAt(i), y: yAt((p.values || [])[j] || 0) }))
      }))
    : [{
        key: 'sum',
        label: '总和',
        color: '#6c5ce7',
        pts: pts.map((p, i) => ({ x: xAt(i), y: yAt(p.sum) }))
      }]

  // 每一列一块透明的感应区，鼠标扫过去就锁定那一列
  const half = pts.length > 1 ? iw / (pts.length - 1) / 2 : iw
  return {
    dims,
    series: series.map((x) => ({ ...x, line: x.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') })),
    grid: ts.map((v) => ({ v, y: yAt(v) })),
    xs: pts.map((p, i) => ({
      x: xAt(i),
      at: p.at,
      zone: { x: Math.max(PAD.l, xAt(i) - half), w: Math.min(half * 2, W - PAD.r - Math.max(PAD.l, xAt(i) - half)) }
    })),
    y0: PAD.t + ih,
    yTop: PAD.t
  }
})

/** 选中那一列的明细：每一维当时多少、比上一次涨了多少 */
const picked = computed(() => {
  const c = chart.value
  const pts = history.value.filter((p) => p.sum != null)
  const i = hover.value
  if (!c || i < 0 || i >= pts.length) return null
  const labels = (data.value && data.value.labels) || []
  const prev = pts[i - 1]
  const cur = pts[i]
  const rows = labels.map((label, j) => {
    const v = (cur.values || [])[j]
    const b = prev ? (prev.values || [])[j] : null
    const d = v != null && b != null ? Math.round((v - b) * 100) / 100 : null
    return { label, color: BAND[j % BAND.length], value: v, delta: d }
  })
  const sd = prev && cur.sum != null && prev.sum != null ? Math.round((cur.sum - prev.sum) * 100) / 100 : null
  // 悬浮框贴在竖线旁边；靠右那几列往左翻，不然会顶出卡片
  const ratio = c.xs[i].x / W
  return {
    i,
    at: cur.at,
    no: i + 1,
    total: pts.length,
    sum: cur.sum,
    sumDelta: sd,
    rows,
    x: c.xs[i].x,
    left: ratio * 100,
    flip: ratio > 0.58
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
            <n-radio-group v-model:value="mode" size="small">
              <n-radio-button value="dims">分维</n-radio-button>
              <n-radio-button value="sum">总和</n-radio-button>
            </n-radio-group>
          </template>
          <div class="wrap">
          <svg v-if="chart" class="chart" :viewBox="`0 0 ${W} ${H}`">
            <!-- 横向网格 + 左侧刻度 -->
            <g v-for="g in chart.grid" :key="g.v">
              <line :x1="PAD.l" :y1="g.y" :x2="W - PAD.r" :y2="g.y" stroke="#edeef2" stroke-width="1" />
              <text :x="PAD.l - 8" :y="g.y + 3.5" font-size="10" fill="#9aa0a6" text-anchor="end">{{ g.v }}</text>
            </g>
            <!-- 每一维一条线，各自的空心圆点 -->
            <g v-for="sr in chart.series" :key="sr.key">
              <polyline :points="sr.line" fill="none" :stroke="sr.color" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
              <circle v-for="(p, i) in sr.pts" :key="i" :cx="p.x" :cy="p.y" r="3.2"
                fill="#fff" :stroke="sr.color" stroke-width="1.8" />
            </g>
            <!-- 选中那一列：一条竖线 + 感应区 -->
            <line v-if="picked" :x1="picked.x" :y1="chart.yTop" :x2="picked.x" :y2="chart.y0"
              stroke="#9aa0a6" stroke-width="1" stroke-dasharray="3 3" />
            <rect v-for="(x, i) in chart.xs" :key="'z' + i" :x="x.zone.x" :y="chart.yTop"
              :width="x.zone.w" :height="chart.y0 - chart.yTop" fill="transparent"
              @mouseenter="hover = i" @mouseleave="hover = -1" />
            <!-- 底部日期 -->
            <text v-for="(x, i) in chart.xs" :key="i" :x="x.x" :y="H - 24" font-size="10" fill="#9aa0a6"
              :text-anchor="i === 0 ? 'start' : i === chart.xs.length - 1 ? 'end' : 'middle'">
              {{ dayText(x.at) }}
            </text>
          </svg>
          <!-- 扫到某一列时贴着竖线弹出来；不吃鼠标事件，不然会把下面的感应区挡住 -->
          <div v-if="picked" class="tip" :class="{ flip: picked.flip }" :style="{ left: picked.left + '%' }">
            <div class="tip-h">{{ dayText(picked.at) }} · 第 {{ picked.no }}/{{ picked.total }} 次</div>
            <div v-for="r in picked.rows" :key="r.label" class="tip-r">
              <i :style="{ borderColor: r.color }"></i>
              <span class="tip-l">{{ r.label }}</span>
              <span class="tip-v">{{ r.value == null ? '—' : num(r.value, 2) }}</span>
              <span class="tip-d" :class="r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''">
                {{ r.delta == null ? '' : r.delta === 0 ? '持平' : signed(r.delta) }}
              </span>
            </div>
            <div class="tip-r tip-sum">
              <i style="border-color: transparent"></i>
              <span class="tip-l">总和</span>
              <span class="tip-v">{{ num(picked.sum, 2) }}</span>
              <span class="tip-d" :class="picked.sumDelta > 0 ? 'up' : picked.sumDelta < 0 ? 'down' : ''">
                {{ picked.sumDelta == null ? '' : signed(picked.sumDelta) }}
              </span>
            </div>
          </div>
          </div>
          <div v-if="chart" class="legend">
            <span v-for="sr in chart.series" :key="sr.key" class="lg">
              <i :style="{ borderColor: sr.color }"></i>{{ sr.label }}
            </span>
          </div>
          <div v-if="!chart" class="empty">
            至少传过两次属性才画得出走势，现在只有 {{ history.length }} 次。
          </div>
          <div v-if="chart" class="lab" style="margin-top: 6px">
            {{ history.length }} 次记录 · {{ chart.dims ? '每一维一条线' : '六维加起来的总和' }} · 鼠标扫过任意一列看具体数值
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
.chart { width: 100%; height: 260px; display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 2px; }
.lg { display: inline-flex; align-items: center; font-size: 11px; color: #6b7280; }
/* 图例的点做成空心圆，和线上的标记一致 */
.lg i { width: 9px; height: 9px; border-radius: 50%; border: 2px solid; margin-right: 5px; }

/* 扫到某一列时贴着竖线弹出来的悬浮框 */
.wrap { position: relative; }
.tip {
  position: absolute;
  top: 8px;
  margin-left: 12px;
  /*
   * 必须给宽度。绝对定位 + left:X% 时，不写宽度就按「容器右边剩下那点空间」收缩，
   * 越靠右的列越窄，文字就被挤换行了 —— .flip 的位移是布局之后才发生的，救不回来。
   * max-content 让它按内容撑开，不受剩余空间限制。
   */
  width: max-content;
  min-width: 196px;
  max-width: 280px;
  white-space: nowrap;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #ebedf0;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.12);
  pointer-events: none;
  z-index: 2;
}
/* 靠右那几列往左翻，不然会顶出卡片 */
.tip.flip { transform: translateX(-100%); margin-left: -12px; }
.tip-h { font-size: 12px; font-weight: 600; padding-bottom: 6px; border-bottom: 1px solid #eceef2; white-space: nowrap; }
.tip-r { display: flex; align-items: center; padding: 4px 0; font-size: 12px; }
.tip-r i { width: 8px; height: 8px; border-radius: 50%; border: 2px solid; margin-right: 8px; flex: none; }
.tip-l { width: 44px; flex: none; color: #6b7280; }
.tip-v { flex: 1; padding-right: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tip-d { flex: none; min-width: 56px; text-align: right; color: #9aa0a6; font-variant-numeric: tabular-nums; }
.tip-d.up { color: #16a34a; font-weight: 600; }
.tip-d.down { color: #e23832; font-weight: 600; }
.tip-sum { margin-top: 2px; padding-top: 7px; border-top: 1px solid #eceef2; }

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

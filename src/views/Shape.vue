<script setup>
/**
 * 黑土摆图形。算法直接用小程序那份 lib/shape.js，一个字没改，两端结果一致。
 *
 * 和「黑土落位」的区别：这里的字是沿**游戏的 X/Y 网格**画的，格子边对边紧挨着，
 * 在菱形视角下看才是正的。这里只算「哪些格子要站人、每格的序号和坐标」，不排成员。
 */
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import * as S from '../lib/shape'
import * as P from '../lib/placement'
import { download } from '../xlsx'

const message = useMessage()

/** 摆图形只在 7 级城池上摆：内 9×9 + 外 11 圈，边长 31 */
const LEVEL = { label: '7级城池', city: 9, rings: 11 }
/** 四个区域各一种底色，和小程序保持一致 */
const BLOCK_COLORS = [
  { fill: '#4a90d9', text: '#fff' },
  { fill: '#5cb85c', text: '#fff' },
  { fill: '#d9534f', text: '#fff' },
  { fill: '#f0ad4e', text: '#5a3a00' }
]
const AREAS = S.AREAS

const baseX = ref('')
const baseY = ref('')
const texts = ref({ leftBottom: '', rightBottom: '', top: '', bottom: '' })
const D = ref(44)
const labelMode = ref('coord')

const board = computed(() => S.buildBoard(LEVEL.city, LEVEL.rings))

/**
 * 顶角 (0,0) 那一格的游戏坐标 —— 填的就是黑土最上面那一格，不用换算。
 * 没填就返回 null，图上只标序号、不标坐标。
 */
const origin = computed(() => {
  const x = Number(baseX.value)
  const y = Number(baseY.value)
  if (!baseX.value || !baseY.value || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
})

const result = computed(() => {
  const items = S.AREAS.map((a) => ({ area: a.key, text: texts.value[a.key] })).filter((x) => x.text)
  return S.placeAll(board.value, items, origin.value || { x: 0, y: 0 })
})

/** 格子 id → 它属于哪一块、序号、坐标 */
const hitMap = computed(() => {
  const m = new Map()
  result.value.blocks.forEach((b, bi) => b.cells.forEach((c) => m.set(c.id, { ...c, block: bi })))
  return m
})

const span = computed(() => board.value.size * D.value)

/**
 * 格子是个菱形，离中心越远能写字的地方越窄，所以字号得按放字的高度算出来。
 * dy 是文字中心离格子中心的距离，chars 是要写几个字符。
 * 推导：菱形在偏移 t 处的半宽是 D/2 - |t|，文字占 dy±fs/2 这一段，取最窄处。
 */
function fitFont(dy, chars) {
  const room = D.value / 2 - Math.abs(dy) * D.value
  return Math.max(5, Math.floor(room / (chars * 0.6 / 2 + 0.5)))
}
/**
 * 一格里只放一行字。序号和坐标同时放会把坐标压到 6 号字，谁也看不清，
 * 两样都要看就下面的点位清单，那里是一一对应的。
 */
const label = computed(() => {
  if (!origin.value || labelMode.value === 'seq') return { key: 'seq', dy: 0, fs: fitFont(0, 3) }
  return { key: 'coord', dy: 0, fs: fitFont(0, 7) }
})

const cells = computed(() => {
  const b = board.value
  const out = []
  b.cells.forEach((cell) => {
    if (cell.city) return
    const hit = hitMap.value.get(cell.id)
    const ctr = P.cellCenter(cell.r, cell.c, b.size, D.value)
    const color = hit ? BLOCK_COLORS[hit.block % BLOCK_COLORS.length] : null
    out.push({
      id: cell.id,
      x: ctr.x,
      y: ctr.y,
      // 图形格子用自己的底色描边，几格拼起来才是实心的，不会有白缝
      fill: color ? color.fill : '#f3f4f6',
      stroke: color ? color.fill : '#e2e4e8',
      text: color ? color.text : '',
      seq: hit ? String(hit.seq).padStart(3, '0') : '',
      coord: hit ? `${hit.x},${hit.y}` : ''
    })
  })
  return out
})

const city = computed(() => {
  const b = board.value
  const mid = (b.size - 1) / 2
  const ctr = P.cellCenter(mid, mid, b.size, D.value)
  return { x: ctr.x, y: ctr.y, d: b.city * D.value, label: LEVEL.label }
})

const corner = computed(() => {
  if (!origin.value) return null
  const n = board.value.size - 1
  return { top: `${origin.value.x},${origin.value.y}`, bottom: `${origin.value.x - n},${origin.value.y - n}` }
})

/** 序号 → 坐标 的清单，方便直接复制到群里报点 */
const list = computed(() => {
  const out = []
  result.value.blocks.forEach((b, bi) => {
    if (!b.ok) return
    const area = (S.AREAS.find((a) => a.key === b.area) || {}).label || b.area
    b.cells.forEach((c) => out.push({ seq: String(c.seq).padStart(3, '0'), area, text: b.text, coord: `${c.x},${c.y}`, _i: bi }))
  })
  return out
})

const blocks = computed(() =>
  result.value.blocks.map((b, bi) => ({
    area: (S.AREAS.find((a) => a.key === b.area) || {}).label || b.area,
    text: b.text,
    ok: b.ok,
    reason: b.reason,
    total: b.total,
    from: b.ok ? String(b.cells[0].seq).padStart(3, '0') : '',
    to: b.ok ? String(b.cells[b.cells.length - 1].seq).padStart(3, '0') : '',
    color: b.ok ? BLOCK_COLORS[bi % BLOCK_COLORS.length].fill : '#b9bec6'
  }))
)

const listCols = [
  { title: '序号', key: 'seq', width: 80 },
  { title: '区域', key: 'area', width: 80 },
  { title: '内容', key: 'text', width: 100 },
  { title: '坐标', key: 'coord' }
]

async function copyList() {
  const txt = list.value.map((r) => `${r.seq} ${r.area}${r.text} ${r.coord}`).join('\n')
  try {
    await navigator.clipboard.writeText(txt)
    message.success(`已复制 ${list.value.length} 个点位`)
  } catch {
    message.error('复制失败，可以手动选中表格')
  }
}

function savePng() {
  const svg = document.getElementById('shape-map')
  if (!svg) return
  const blob = new Blob(['<?xml version="1.0"?>' + new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width * 2
    canvas.height = img.height * 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob((b) => download(b, '摆图形.png'))
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    message.error('导出失败，可以直接截图')
  }
  img.src = url
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="摆图形" :bordered="false">
      <template #header-extra>
        <n-button :disabled="!result.total" @click="savePng">下载图片</n-button>
      </template>

      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        用 7 级城池的黑土格子拼字或图案，整幅图摆在城池下方：左下、右下各一块贴着下边，
        正下方再放个图案，中间留出缝、左右对称。填了参照坐标之后每格都会标出实际坐标，照着报点位不会错。
      </n-alert>

      <n-form label-placement="left" :label-width="90" size="small">
        <n-grid :cols="4" :x-gap="16">
          <n-gi :span="4">
            <n-form-item label="参照坐标">
              <n-space :size="8" align="center">
                <n-input v-model:value="baseX" placeholder="X 如 521" style="width: 120px" />
                <n-input v-model:value="baseY" placeholder="Y 如 1314" style="width: 120px" />
                <span class="lab">填黑土最上面那一格的坐标，游戏里点一下那格就能看到</span>
              </n-space>
            </n-form-item>
          </n-gi>
          <n-gi v-for="a in AREAS" :key="a.key">
            <n-form-item :label="a.label">
              <n-input v-model:value="texts[a.key]" placeholder="字或图案名" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <n-space align="center" :size="14">
        <span class="lab">格子大小</span>
        <n-slider v-model:value="D" :min="20" :max="80" :step="2" style="width: 180px" />
        <n-radio-group v-model:value="labelMode" size="small" :disabled="!origin">
          <n-radio-button value="coord">格内标坐标</n-radio-button>
          <n-radio-button value="seq">格内标序号</n-radio-button>
        </n-radio-group>
        <span v-if="corner" class="lab">
          顶角 {{ corner.top }} · 底角 {{ corner.bottom }}
        </span>
        <span v-else class="lab">没填参照坐标，图上只有序号</span>
      </n-space>

      <n-space v-if="blocks.length" :size="10" style="margin-top: 14px">
        <n-tag v-for="b in blocks" :key="b.area" :bordered="false" :color="{ color: b.color, textColor: '#fff' }">
          {{ b.area }}「{{ b.text }}」{{ b.ok ? `${b.total} 格 · ${b.from}–${b.to}` : b.reason || '摆不下' }}
        </n-tag>
        <n-tag :bordered="false">共 {{ result.total }} 格</n-tag>
      </n-space>
    </n-card>

    <n-card v-if="cells.length" :bordered="false">
      <div class="wrap">
        <svg id="shape-map" :width="span" :height="span" :viewBox="`0 0 ${span} ${span}`" xmlns="http://www.w3.org/2000/svg">
          <g v-for="c in cells" :key="c.id">
            <g :transform="`translate(${c.x},${c.y}) rotate(45)`">
              <rect
                :x="-D / 2.83" :y="-D / 2.83" :width="D / 1.414" :height="D / 1.414" rx="2"
                :fill="c.fill" :stroke="c.stroke" stroke-width="1"
              />
            </g>
            <template v-if="c.seq">
              <text
                :x="c.x" :y="c.y + label.dy + label.fs * 0.35" text-anchor="middle"
                :font-size="label.fs" font-weight="700" :fill="c.text"
              >{{ label.key === 'seq' ? c.seq : c.coord }}</text>
            </template>
          </g>
          <g :transform="`translate(${city.x},${city.y}) rotate(45)`">
            <rect :x="-city.d / 2.83" :y="-city.d / 2.83" :width="city.d / 1.414" :height="city.d / 1.414"
              rx="6" fill="#e8a33d" stroke="#b5651d" stroke-width="3" />
          </g>
          <text :x="city.x" :y="city.y + 8" text-anchor="middle"
            :font-size="Math.max(10, Math.round(city.d * 0.16))" font-weight="700" fill="#7c2d12">{{ city.label }}</text>
        </svg>
      </div>
    </n-card>

    <n-card v-if="list.length && origin" :bordered="false" title="点位清单">
      <template #header-extra>
        <n-button size="small" @click="copyList">复制清单</n-button>
      </template>
      <n-data-table :columns="listCols" :data="list" :max-height="360" size="small" :row-key="(r) => r.seq" virtual-scroll />
    </n-card>
  </n-space>
</template>

<style scoped>
.wrap { overflow: auto; text-align: center; }
.lab { font-size: 13px; color: #8a9099; }
</style>

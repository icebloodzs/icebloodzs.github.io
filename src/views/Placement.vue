<script setup>
/**
 * 黑土落位。算法同样直接用小程序那份 lib/placement.js。
 * 点一格再点另一格：空格就挪过去，有人就问「交换还是合并」；两人一格的可以拆开。
 * 快捷键 E 交换 / W 合并 / S 拆开 / Esc 取消。
 */
import { ref, inject, computed, onMounted, onUnmounted } from 'vue'
import { useMessage } from 'naive-ui'
import * as P from '../lib/placement'
import { download } from '../xlsx'

const { members } = inject('app')
const message = useMessage()

const preset = ref('lv7')
const battle = ref(false)
const grid = ref(null)
const assign = ref({})
const tray = ref([])
const sel = ref('')
const pending = ref(null)

const PRESETS = P.PRESETS.map((p) => ({ label: p.label, value: p.key }))

function generate() {
  const p = P.PRESETS.find((x) => x.key === preset.value)
  const g = P.buildGrid({ city: p.city, up: p.up, down: p.down, battle: battle.value })
  const names = members.value.slice().sort((a, b) => (b.strength || 0) - (a.strength || 0)).map((m) => m.name)
  const made = P.autoUnits(names, g.order.length)
  const res = P.fill(g.order, made.units)
  grid.value = g
  assign.value = res.assign
  tray.value = (made.tray || []).concat(res.rest || [])
  sel.value = ''
  pending.value = null
}

const D = computed(() => (grid.value && grid.value.size > 20 ? 54 : 76))
const span = computed(() => (grid.value ? grid.value.size * D.value : 0))

const cells = computed(() => {
  if (!grid.value) return []
  return grid.value.cells
    .filter((c) => c.kind !== 'city' && c.kind !== 'battle')
    .map((c) => {
      const ctr = P.cellCenter(c.r, c.c, grid.value.size, D.value)
      const color = P.ringColor(c.ring, c.soil)
      const names = assign.value[c.id] || []
      const on = sel.value === c.id || (pending.value && (pending.value.from === c.id || pending.value.to === c.id))
      return { id: c.id, x: ctr.x, y: ctr.y, color, names, on }
    })
})

const city = computed(() => {
  if (!grid.value) return null
  const g = grid.value
  const a = P.cellCenter(g.lo, g.lo, g.size, D.value)
  const b = P.cellCenter(g.hi, g.hi, g.size, D.value)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: g.city * D.value }
})

function tap(id) {
  if (pending.value) return
  const has = (assign.value[id] || []).length
  if (!sel.value) {
    if (!has) return
    sel.value = id
  } else if (sel.value === id) {
    sel.value = ''
  } else if (!has) {
    assign.value = P.drop(assign.value, sel.value, id, 'swap').assign
    sel.value = ''
  } else {
    pending.value = { from: sel.value, to: id }
    sel.value = ''
  }
}

function act(what) {
  if (!grid.value) return
  if (what === 'cancel') {
    sel.value = ''
    pending.value = null
  } else if (what === 'split') {
    if (!sel.value || (assign.value[sel.value] || []).length < 2) return
    const r = P.split(grid.value.order, assign.value, sel.value)
    assign.value = r.assign
    if (r.toTray) {
      tray.value = tray.value.concat([r.toTray])
      message.warning(`没有空格了，${r.toTray} 放进了待分配`)
    } else {
      message.success('已拆开')
    }
    sel.value = ''
  } else if (pending.value) {
    const res = P.drop(assign.value, pending.value.from, pending.value.to, what)
    if (res.error) message.error(res.error)
    else {
      assign.value = res.assign
      message.success(what === 'merge' ? '已合并到一格' : '已交换')
    }
    pending.value = null
  }
}

function onKey(e) {
  const tag = String((e.target || {}).tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const map = { e: 'swap', w: 'merge', s: 'split', escape: 'cancel' }
  const what = map[String(e.key || '').toLowerCase()]
  if (!what) return
  e.preventDefault()
  act(what)
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

const selNames = computed(() => (sel.value ? (assign.value[sel.value] || []).join(' / ') : ''))
const canSplit = computed(() => sel.value && (assign.value[sel.value] || []).length > 1)

function savePng() {
  const svg = document.getElementById('map')
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
    canvas.toBlob((b) => download(b, '黑土落位.png'))
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
    <n-card title="黑土落位" :bordered="false">
      <template #header-extra>
        <n-space>
          <n-button type="primary" @click="generate">生成</n-button>
          <n-button v-if="grid" @click="savePng">下载图片</n-button>
        </n-space>
      </template>

      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        按成员实力从高到低、由内圈往外圈排。人比格子多时，最强的格子配一个最弱的（强带弱），再多的进待分配。
      </n-alert>

      <n-space align="center">
        <n-select v-model:value="preset" :options="PRESETS" style="width: 220px" />
        <n-checkbox v-model:checked="battle">留出斗阵位</n-checkbox>
        <span class="m">在册成员 {{ members.length }} 人</span>
      </n-space>

      <template v-if="grid">
        <n-alert type="info" :bordered="false" style="margin-top: 14px">
          {{ grid.city }}×{{ grid.city }} 城池 · 黑土上 {{ grid.up }} 圈 / 下 {{ grid.down }} 圈 ·
          黑土 {{ grid.blackCount }} 格、白土 {{ grid.whiteCount }} 格
          <template v-if="tray.length"> · <b>待分配 {{ tray.length }} 人</b>：{{ tray.join('、') }}</template>
        </n-alert>

        <n-alert :type="pending ? 'warning' : (sel ? 'warning' : 'default')" :bordered="false" style="margin-top: 10px">
          <template v-if="pending">
            把 <b>{{ (assign[pending.from] || []).join(' / ') }}</b> 和 <b>{{ (assign[pending.to] || []).join(' / ') }}</b> 怎么处理？
            <n-space inline style="margin-left: 8px">
              <n-button size="tiny" @click="act('swap')">交换 <n-text code>E</n-text></n-button>
              <n-button size="tiny" @click="act('merge')">合并到一格 <n-text code>W</n-text></n-button>
              <n-button size="tiny" quaternary @click="act('cancel')">取消 <n-text code>Esc</n-text></n-button>
            </n-space>
          </template>
          <template v-else-if="sel">
            已选中 <b>{{ selNames }}</b>：再点一个格子——空格就挪过去，有人就问你换还是合。
            <n-space inline style="margin-left: 8px">
              <n-button v-if="canSplit" size="tiny" @click="act('split')">拆成两格 <n-text code>S</n-text></n-button>
              <n-button size="tiny" quaternary @click="act('cancel')">取消 <n-text code>Esc</n-text></n-button>
            </n-space>
          </template>
          <template v-else>
            点一个有人的格子，再点另一个格子即可<b>移动 / 交换 / 合并</b>；两个人一格的可以<b>拆开</b>。
            快捷键：<n-text code>E</n-text> 交换 · <n-text code>W</n-text> 合并 · <n-text code>S</n-text> 拆开 · <n-text code>Esc</n-text> 取消
          </template>
        </n-alert>
      </template>
    </n-card>

    <n-card v-if="grid" :bordered="false">
      <div class="wrap">
        <svg id="map" :width="span" :height="span" :viewBox="`0 0 ${span} ${span}`" xmlns="http://www.w3.org/2000/svg">
          <g v-for="c in cells" :key="c.id" @click="tap(c.id)" style="cursor: pointer">
            <g :transform="`translate(${c.x},${c.y}) rotate(45)`">
              <rect
                :x="-D / 2.83" :y="-D / 2.83" :width="D / 1.414" :height="D / 1.414" rx="3"
                :fill="c.on ? '#ffe9a8' : c.color.fill"
                :stroke="c.on ? '#e0a800' : c.color.stroke"
                :stroke-width="c.on ? 3 : 1.5"
              />
            </g>
            <text
              v-for="(n, i) in c.names" :key="i"
              :x="c.x" :y="c.y + (c.names.length === 2 ? (i === 0 ? -5 : 9) : 4)"
              text-anchor="middle" :font-size="c.names.length === 2 ? 10 : 11" fill="#1f2329"
            >{{ n.length > (c.names.length === 2 ? 5 : 6) ? n.slice(0, c.names.length === 2 ? 5 : 6) : n }}</text>
          </g>
          <g v-if="city" :transform="`translate(${city.x},${city.y}) rotate(45)`">
            <rect :x="-city.d / 2.83" :y="-city.d / 2.83" :width="city.d / 1.414" :height="city.d / 1.414"
              rx="6" fill="#e8a33d" stroke="#b5651d" stroke-width="3" />
          </g>
          <text v-if="city" :x="city.x" :y="city.y + 8" text-anchor="middle"
            :font-size="Math.round(city.d * 0.16)" font-weight="700" fill="#7c2d12">城池</text>
        </svg>
      </div>
    </n-card>
  </n-space>
</template>

<style scoped>
.wrap { overflow: auto; text-align: center; }
.m { font-size: 13px; color: #8a9099; }
</style>

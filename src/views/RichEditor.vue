<script setup>
/**
 * 简版富文本编辑器：加粗、字色、插一张图。
 *
 * 用 Quill，不自己撸 contenteditable —— 光是选区和光标就有一堆边界情况，
 * execCommand 又早废弃了。工具栏只留这几样：功能越少，服务端那边要洗的东西越少。
 *
 * 图片不走 Quill 默认的 base64 内嵌（那会把几百 KB 塞进正文），
 * 改成传到云存储、拿 cloud:// 回来。真正显示时由服务端现签临时链接。
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import { call } from '../api'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  height: { type: Number, default: 220 },
  /** 允许插图；公告不需要 */
  image: { type: Boolean, default: true },
  maxLength: { type: Number, default: 1000 }
})
const emit = defineEmits(['update:modelValue', 'length'])

const box = ref(null)
const busy = ref(false)
const error = ref('')
let quill = null
/** 自己写进去的时候别再 emit 回去，不然两边来回打架 */
let silent = false

/** 几个常用色，够用就行，不摆一整个调色盘 */
/*
 * 这几个颜色是挑过的：在小程序三种风格的底色上（白、米白、赛博的深紫）对比度都 >= 4.2。
 * 原来那组里的近黑 #1f2329 配赛博风格只有 1.17，等于隐身；黄色 #ca8a04 配白底只有 2.94。
 * 小程序那边还有一道兜底（utils/safecolor.js）会把不合格的推回来，这里是从源头少踩坑。
 */
const COLORS = ['#e23832', '#c65910', '#9b7608', '#188b42', '#3e74ea', '#8468d9', '#747981']

function plainLength() {
  // Quill 的 getText 末尾永远带个换行，减掉
  return quill ? Math.max(0, quill.getText().replace(/\n+$/, '').length) : 0
}

async function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files && input.files[0]
    if (!file) return
    busy.value = true
    error.value = ''
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1])
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const res = await call('board.uploadImage', { base64, ext })
      const range = quill.getSelection(true)
      // 编辑时先用临时链接显示，提交时再换回 cloud://（见 getHtml）
      quill.insertEmbed(range ? range.index : 0, 'image', res.url, 'user')
      imageMap.set(res.url, res.fileId)
      quill.setSelection((range ? range.index : 0) + 1)
    } catch (e) {
      error.value = e.message || '图片传不上去'
    } finally {
      busy.value = false
    }
  }
  input.click()
}

/** 临时链接 → cloud:// 的对照表：提交时要换回去，不然链接过期图就没了 */
const imageMap = new Map()

function getHtml() {
  if (!quill) return ''
  let html = quill.root.innerHTML
  imageMap.forEach((fileId, url) => {
    html = html.split(url).join(fileId)
  })
  return html === '<p><br></p>' ? '' : html
}

onMounted(() => {
  quill = new Quill(box.value, {
    theme: 'snow',
    placeholder: props.placeholder,
    modules: { toolbar: false }
  })
  if (props.modelValue) {
    silent = true
    quill.clipboard.dangerouslyPasteHTML(props.modelValue)
    silent = false
  }
  quill.on('text-change', () => {
    if (silent) return
    emit('update:modelValue', getHtml())
    emit('length', plainLength())
  })
})

onBeforeUnmount(() => {
  quill = null
})

// 外面把内容清空时（比如发完帖），编辑器也跟着清
watch(
  () => props.modelValue,
  (v) => {
    if (!quill || silent) return
    if (!v && plainLength() > 0) {
      silent = true
      quill.setText('')
      silent = false
      imageMap.clear()
    }
  }
)

const fmt = (name, value) => {
  if (!quill) return
  quill.focus()
  const cur = quill.getFormat()
  quill.format(name, cur[name] === value || (name === 'bold' && cur.bold) ? false : value, 'user')
  emit('update:modelValue', getHtml())
}
</script>

<template>
  <div class="ed">
    <div class="bar">
      <button class="t" type="button" title="加粗" @click="fmt('bold', true)"><b>B</b></button>
      <span class="sep"></span>
      <!-- 默认色 = 不设颜色，交给各端自己的主题；想要黑字就用它，别去挑一个固定的黑 -->
      <button class="t sm" type="button" title="恢复默认颜色" @click="fmt('color', false)">默认</button>
      <button
        v-for="c in COLORS"
        :key="c"
        class="dot"
        type="button"
        :style="{ background: c }"
        :title="'字色 ' + c"
        @click="fmt('color', c)"
      ></button>
      <span v-if="image" class="sep"></span>
      <button v-if="image" class="t" type="button" :disabled="busy" @click="pickImage">
        {{ busy ? '上传中…' : '🖼 插图' }}
      </button>
      <div style="flex: 1"></div>
      <span class="n" :class="{ over: plainLength() > maxLength }">{{ plainLength() }} / {{ maxLength }}</span>
    </div>
    <div ref="box" class="body" :style="{ height: height + 'px' }"></div>
    <div v-if="error" class="err">{{ error }}</div>
  </div>
</template>

<style scoped>
.ed { border: 1px solid #dfe2e6; border-radius: 10px; overflow: hidden; background: #fff; }
.bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #eef0f2; background: #fafbfc; }
.t {
  all: unset; cursor: pointer; padding: 3px 10px; border-radius: 6px;
  font-size: 13px; color: #4b5563; line-height: 20px;
}
.t:hover { background: #eef0f2; }
.t[disabled] { opacity: .5; cursor: default; }
.dot { all: unset; cursor: pointer; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.08) inset; }
.dot:hover { transform: scale(1.15); }
.sep { width: 1px; height: 16px; background: #e4e7ea; }
.t.sm { font-size: 12px; padding: 0 8px; }
.n { font-size: 12px; color: #8a9099; font-variant-numeric: tabular-nums; }
.n.over { color: #d93026; font-weight: 600; }
.body { overflow: auto; }
.err { padding: 6px 10px; font-size: 12px; color: #d93026; }
/* Quill 自带的边框去掉，用外面这层 */
.ed :deep(.ql-container) { border: 0; font-size: 14px; font-family: inherit; }
.ed :deep(.ql-editor) { min-height: 100%; line-height: 1.8; }
.ed :deep(.ql-editor.ql-blank::before) { color: #b6bbc2; font-style: normal; left: 15px; }
.ed :deep(.ql-editor img) { max-width: 100%; border-radius: 8px; }
</style>

<script setup>
import { inject, computed, h, ref } from 'vue'
import { NTag, NButton, useMessage, useDialog } from 'naive-ui'
import TableCard from './TableCard.vue'
import { nameCol, bigCol, boundCol, isVirtualUid } from '../cols'
import { when, ago, sorter } from '../fmt'
import { call } from '../api'

const { members, loginBy, reload } = inject('app')
const message = useMessage()
const dialog = useDialog()

/*
 * 浏览器登录码：给没有微信的成员。管理员生成后私发给他，他在登录页选「登录 ID」粘进去，
 * 只能看、改自己那份。已经绑了微信的不发（让本人在小程序首页复制）。服务端见 lib/webMember.js。
 */
const keys = ref({}) // memberId → 登录码，生成 / 复制过才有
const busy = ref('')
const keyText = (k) => String(k || '').replace(/(.{4})(?=.)/g, '$1 ')

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    // 非 https / 老浏览器没有 clipboard，退回 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (err) { /* 复制不了就让他手抄 */ }
    ta.remove()
    return ok
  }
}

async function fetchKey(m, reset) {
  busy.value = m._id
  try {
    const { webKey } = await call('admin.memberWebKey', { memberId: m._id, reset })
    keys.value = { ...keys.value, [m._id]: webKey }
    const ok = await copyText(webKey)
    message.success(ok ? (reset ? '新登录码已复制，私发给他' : '登录码已复制，私发给他') : '复制失败，请手动抄下登录码')
    // 第一次生成会给他建账号、名单里变成「已绑定」，拉一遍
    if (!m.boundUid || reset) reload()
  } catch (e) {
    message.error(e.message || '操作失败')
  } finally {
    busy.value = ''
  }
}

function resetKey(m) {
  dialog.warning({
    title: `重置「${m.name}」的登录码`,
    content: '旧的登录码马上失效，用它登录着的设备会被踢下线。',
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: () => fetchKey(m, true)
  })
}

const keyCell = (r) => {
  if (r.boundUid && !isVirtualUid(r.boundUid)) return h('span', { style: 'color:#c9ccd1' }, '有微信，本人复制')
  const k = keys.value[r._id]
  const loading = busy.value === r._id
  const btn = (text, onClick, extra = {}) =>
    h(NButton, { size: 'tiny', secondary: true, disabled: Boolean(busy.value), loading, onClick, ...extra }, () => text)
  return h('div', { style: 'display:flex;align-items:center;gap:6px;white-space:nowrap' }, [
    k ? h('b', { style: 'letter-spacing:1px;font-variant-numeric:tabular-nums' }, keyText(k)) : null,
    btn(r.boundUid ? '复制' : '生成并复制', () => fetchKey(r, false), { type: 'primary' }),
    r.boundUid ? btn('重置', () => resetKey(r)) : null
  ])
}

/** 最后登录在 appUsers 上，按绑定的 uid 关联过来 */
const loginOf = (r) => (r.boundUid ? loginBy.value[r.boundUid] : null)

const timeCell = (iso, empty) => {
  if (!iso) return h(NTag, { size: 'small', type: 'default', bordered: false }, () => empty)
  const a = ago(iso)
  return h('div', { style: 'white-space:nowrap' }, [
    h('span', { style: 'color:#4b5563' }, when(iso)),
    ' ',
    h(NTag, { size: 'small', type: a.type, bordered: false }, () => a.text)
  ])
}

const columns = computed(() => [
  nameCol,
  boundCol,
  {
    title: '绑定时间',
    key: 'boundAt',
    width: 165,
    sorter: sorter((r) => (r.boundAt ? new Date(r.boundAt).getTime() : null)),
    render: (r) => (r.boundUid ? timeCell(r.boundAt, '—') : h('span', { style: 'color:#c9ccd1' }, '—')),
    xls: (r) => when(r.boundAt)
  },
  {
    title: '最后登录',
    key: 'lastLogin',
    width: 165,
    sorter: sorter((r) => {
      const t = loginOf(r)
      return t ? new Date(t).getTime() : null
    }),
    render: (r) => (r.boundUid ? timeCell(loginOf(r), '没登录过') : h('span', { style: 'color:#c9ccd1' }, '—')),
    xls: (r) => when(loginOf(r))
  },
  {
    title: '浏览器登录码',
    key: 'webKey',
    width: 250,
    render: keyCell,
    xls: (r) => (isVirtualUid(r.boundUid) ? '已发' : '')
  },
  bigCol('战力', 'power'),
  bigCol('实力', 'strength'),
  {
    title: '曾用名',
    key: 'formerNames',
    width: 160,
    render: (r) => (r.formerNames || []).join('、') || '—',
    xls: (r) => (r.formerNames || []).join('、')
  }
])
</script>

<template>
  <div class="page">
    <TableCard
      title="绑定情况"
      desc="谁已经把微信绑到了名单里的成员账号上。没绑的人在小程序里看不到自己的数据。最后登录按微信号算，可以看出谁很久没打开过小程序了。没有微信的成员，点「生成并复制」把浏览器登录码私发给他，他就能在浏览器版看、改自己的资料；以后他用微信绑定自己的名字，登录码自动作废。"
      :columns="columns"
      :rows="members"
      :scroll-x="1250"
    />
  </div>
</template>

<style scoped>
/* 整页不滚，表格在卡片里自己滚 */
.page { height: var(--page-h); min-height: 360px; }
</style>

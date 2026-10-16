/**
 * 三冰小帮手 · 开发者后台。
 *
 * 只给开发者自己用：管兑换码（等级 / 有效期 / 用没用）和各个盟的会员状态与模型用量。
 * 身份走和电脑版一样的「电脑出码、小程序扫码」换 token，再由云函数校验白名单（devAdmins）。
 *
 * 没有构建步骤：三个文件丢到静态托管就能跑，改完刷新即可。
 */
const API = 'https://cloud1-d4gobc9ws5134943d-1483434711.ap-shanghai.app.tcloudbase.com/api'
const TOKEN_KEY = 'sanbing_dev_token'

// ---------------- 基础 ----------------

/** localStorage 被禁（无痕 / 三方 cookie 限制）时退回内存，至少这一次会话能用 */
const store = {
  mem: '',
  read() {
    try {
      return localStorage.getItem(TOKEN_KEY) || this.mem
    } catch (e) {
      return this.mem
    }
  },
  write(v) {
    this.mem = v || ''
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v)
      else localStorage.removeItem(TOKEN_KEY)
    } catch (e) {
      // 存不住就只在内存里留着
    }
  }
}

let token = store.read()
let inflight = 0

async function call(action, data) {
  inflight += 1
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, data: data || {}, token })
    })
    const body = await r.json()
    if (!body || body.code !== 0) {
      const e = new Error((body && body.message) || '请求失败')
      e.errCode = body && body.errCode
      throw e
    }
    return body.data
  } finally {
    inflight -= 1
  }
}

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let toastTimer = null
function toast(msg) {
  const el = $('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2200)
}

const num = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('zh-CN'))
const money = (v) => '¥' + Number(v || 0).toLocaleString('zh-CN')

function when(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (!d.getTime()) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const day = (v) => (v ? when(v).slice(0, 10) : '—')

/** 多久没动静了，用来一眼看出哪个盟凉了 */
function ago(v) {
  if (!v) return '从未'
  const ms = Date.now() - new Date(v).getTime()
  const d = Math.floor(ms / 86400000)
  if (d <= 0) return '今天'
  if (d < 30) return d + ' 天前'
  return Math.floor(d / 30) + ' 个月前'
}

/** 把文本存成文件下载下来（备份就是靠这个落到本机的） */
function download(name, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B')

/* ---------------- 表格排序 ----------------
 * 各张表共用一套：每张表记一个 { key, dir }，表头点一下换列、再点一下反向。
 * 列定义里给 sort(row) 就能排，不给就是不可排序的列。
 */
const sorts = {}

/*
 * 每一屏最近一次拉回来的数据。
 * 排序和筛选只是换个看法，不该每点一下表头就重新请求一次服务端 ——
 * 识别用量那一屏每请求一次都要聚合按月统计 + 查 200 条明细 + 查成员名，点几下就卡。
 * 只有切进这一屏、或者做完增删改之后才重新拉（render 的 refresh 参数）。
 */
const cache = {}

function sortState(table) {
  if (!sorts[table]) sorts[table] = { key: '', dir: -1 }
  return sorts[table]
}

/** 表头 HTML。cols = [{ label, key?, sort?, num? }] */
function thead(table, cols) {
  const st = sortState(table)
  return (
    '<thead><tr>' +
    cols
      .map((c) => {
        const cls = (c.num ? 'num' : '') + (c.sort ? ' sortable' : '')
        if (!c.sort) return `<th class="${cls}">${c.label}</th>`
        const on = st.key === c.key
        const mark = on ? (st.dir === 1 ? ' ▲' : ' ▼') : ' <span class="muted">⇅</span>'
        return `<th class="${cls}${on ? ' sort-on' : ''}" data-sort="${table}:${c.key}">${c.label}${mark}</th>`
      })
      .join('') +
    '</tr></thead>'
  )
}

/** 按当前排序状态排一份副本。空值永远垫底，不跟着升降序翻上来 */
function applySort(table, cols, rows) {
  const st = sortState(table)
  const col = cols.find((c) => c.key === st.key && c.sort)
  if (!col) return rows
  const val = col.sort
  return rows.slice().sort((a, b) => {
    const x = val(a)
    const y = val(b)
    const xn = x === null || x === undefined || x === ''
    const yn = y === null || y === undefined || y === ''
    if (xn && yn) return 0
    if (xn) return 1
    if (yn) return -1
    if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y), 'zh') * st.dir
    return (x - y) * st.dir
  })
}

/** 把表头的点击接上。rerender 是这一屏的重绘函数 */
function bindSort(rerender) {
  $('body')
    .querySelectorAll('[data-sort]')
    .forEach((th) => {
      th.onclick = () => {
        const [table, key] = th.dataset.sort.split(':')
        const st = sortState(table)
        // 点同一列就反向，换一列从降序开始（看榜通常先看最大的）
        if (st.key === key) st.dir = -st.dir
        else { st.key = key; st.dir = -1 }
        rerender()
      }
    })
}

/** 下拉选项，value 为空的那项是「全部」 */
const optionsOf = (list, cur, allLabel) =>
  [`<option value="">${allLabel}</option>`]
    .concat(list.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`))
    .join('')

function copy(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast('已复制'))
    .catch(() => toast('复制失败，手动选中吧'))
}

// ---------------- 登录 ----------------

let pollTimer = null

function showOnly(which) {
  $('boot').hidden = which !== 'boot'
  $('login').hidden = which !== 'login'
  $('app').hidden = which !== 'app'
}

async function newTicket() {
  clearTimeout(pollTimer)
  const box = $('qr')
  box.innerHTML = '<div class="qr-mask">正在生成二维码…</div>'
  $('loginTip').textContent = ''
  try {
    const { ticket } = await call('web.ticketCreate')
    box.innerHTML = ''
    if (typeof QRCode === 'function') {
      new QRCode(box, { text: ticket, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M })
    } else {
      // 画不出码就把票据亮出来，至少知道是 CDN 挂了而不是服务挂了
      box.innerHTML = '<div class="qr-mask">二维码组件没加载出来<br />票据：' + esc(ticket) + '</div>'
    }
    poll(ticket, Date.now() + 3 * 60 * 1000)
  } catch (e) {
    box.innerHTML = '<div class="qr-mask">出码失败</div>'
    $('loginTip').textContent = e.message
  }
}

function poll(ticket, deadline) {
  pollTimer = setTimeout(async () => {
    if (Date.now() > deadline) {
      $('loginTip').textContent = '二维码过期了，点下面换一个'
      return
    }
    try {
      const res = await call('web.ticketPoll', { ticket })
      if (res.status === 'confirmed') {
        token = res.token
        store.write(token)
        boot()
        return
      }
      if (res.status === 'expired') {
        $('loginTip').textContent = '二维码过期了，点下面换一个'
        return
      }
    } catch (e) {
      // 轮询失败不打断，下一次接着问
    }
    poll(ticket, deadline)
  }, 1500)
}

function logout() {
  call('web.logout').catch(() => {})
  token = ''
  store.write('')
  clearTimeout(pollTimer)
  showOnly('login')
  newTicket()
}

// ---------------- 视图 ----------------

const VIEWS = [
  { key: 'overview', title: '总览', render: renderOverview },
  { key: 'codes', title: '兑换码', render: renderCodes },
  { key: 'alliances', title: '同盟', render: renderAlliances },
  { key: 'vision', title: '识别用量', render: renderVision },
  { key: 'plans', title: '会员方案', render: renderPlans },
  { key: 'demo', title: '演示环境', render: renderDemo },
  { key: 'backup', title: '备份', render: renderBackup },
  { key: 'logs', title: '操作日志', render: renderLogs }
]
// 当前页记在地址栏 hash 里，刷新 / 收藏都停在原地
let view = (location.hash || '').replace('#', '') || 'overview'
if (!VIEWS.some((v) => v.key === view)) view = 'overview'
/** 总览拉到的等级 / 功能表，别的页面直接复用，不用重复请求 */
let meta = { levels: [], features: [] }

function buildNav() {
  $('nav').innerHTML = VIEWS.map((v) => `<button data-k="${v.key}" class="${v.key === view ? 'on' : ''}">${v.title}</button>`).join('')
  $('nav').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      view = b.dataset.k
      location.hash = view
      buildNav()
      load()
    }
  })
}

async function load() {
  const def = VIEWS.find((v) => v.key === view) || VIEWS[0]
  $('viewTitle').textContent = def.title
  $('body').innerHTML = '<div class="empty">加载中…</div>'
  try {
    await def.render()
    $('updatedAt').textContent = '更新于 ' + when(new Date()).slice(11)
  } catch (e) {
    if (e.errCode === 'WEB_UNAUTHED') return logout()
    if (e.errCode === 'NOT_DEVELOPER') {
      $('body').innerHTML = '<div class="card"><h3>你不是开发者</h3><p class="hint">这个账号不在白名单里。把 devAdmins 集合里加一条 _id = 你的 uid 就行。</p></div>'
      return
    }
    $('body').innerHTML = `<div class="card"><h3>出错了</h3><p class="hint danger">${esc(e.message)}</p></div>`
  }
}

const statCard = (label, value, sub) =>
  `<div class="stat"><span>${label}</span><b>${value}</b><i>${sub || ''}</i></div>`

// ---------------- 总览 ----------------

async function renderOverview() {
  const d = await call('dev.overview')
  meta = { levels: d.levels, features: d.features }

  const lv = d.levels
    .map((l) => {
      const x = d.byLevel[l.key] || {}
      return `<tr>
        <td><span class="tag purple">${esc(l.name)}</span></td>
        <td class="num">${money(l.price)}</td>
        <td class="num">${num(x.alliances)}</td>
        <td class="num">${num(x.codesUsed)}</td>
        <td class="num">${num(x.codesUnused)}</td>
        <td class="num">${money(x.revenue == null ? (x.codesUsed || 0) * l.price : x.revenue)}</td>
      </tr>`
    })
    .join('')

  const exp = d.expiring.length
    ? d.expiring
        .map(
          (a) => `<tr>
            <td>${esc(a.serverNo)} 区 · <b>${esc(a.name)}</b></td>
            <td>${esc(a.levelName || '—')}</td>
            <td class="num ${a.left < 0 ? 'danger' : a.left <= 7 ? 'warn' : ''}">${a.left < 0 ? '已过期 ' + -a.left + ' 天' : '还剩 ' + a.left + ' 天'}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="empty">14 天内没有到期的，安心</td></tr>'

  $('body').innerHTML = `
    <div class="grid g5" style="margin-bottom:16px">
      ${statCard('同盟', num(d.alliances.total), `已激活 ${d.alliances.active} · 待激活 ${d.alliances.inactive}`)}
      ${statCard('累计收入', money(d.revenue.total), `本月 ${money(d.revenue.month)}`)}
      ${statCard('可用兑换码', num(d.codes.unused), `已用 ${d.codes.used} · 作废 ${d.codes.void + d.codes.expired}`)}
      ${statCard('图片识别', num(d.vision.calls) + ' 次', `本月 ${d.vision.monthCalls} 次 · ${num(d.vision.tokens)} token`)}
      ${statCard('模型成本', money(d.vision.cost), d.vision.pricePer1k ? `按 ${d.vision.pricePer1k} 元/千 token` : '当前模型免费，未计价')}
    </div>

    <div class="card">
      <h3>按等级</h3>
      <p class="hint">收入按「兑换码被用掉」的时间记，没发出去的码不算钱。</p>
      <table>
        <thead><tr><th>等级</th><th class="num">单价</th><th class="num">在用同盟</th><th class="num">已用码</th><th class="num">未用码</th><th class="num">累计收入</th></tr></thead>
        <tbody>${lv}</tbody>
      </table>
    </div>

    <div class="card">
      <h3>快到期的同盟</h3>
      <p class="hint">14 天内到期或已过期的排在这里，提前去催续费。</p>
      <table><thead><tr><th>同盟</th><th>等级</th><th class="num">剩余</th></tr></thead><tbody>${exp}</tbody></table>
    </div>

    <div class="card">
      <h3>人</h3>
      <div class="grid g3">
        ${statCard('名单成员', num(d.people.members), '所有盟加起来')}
        ${statCard('已绑定', num(d.people.bound), '绑了微信的成员')}
        ${statCard('微信用户', num(d.people.users), '进过小程序的人')}
      </div>
    </div>`
}

// ---------------- 兑换码 ----------------

const CODE_STATUS = {
  unused: '<span class="tag green">可用</span>',
  used: '<span class="tag">已用</span>',
  void: '<span class="tag red">已作废</span>',
  expired: '<span class="tag amber">已过期</span>'
}
let codeFilter = 'all'

/*
 * 常用档位，点一下把表单填好。
 * 试用码的「码有效期」设成 30 天 —— 发出去一个月还没用就自动作废，
 * 免得三天的试用码躺半年后被人翻出来用。
 */
const CODE_PRESETS = [
  // 试用默认给最高那一档：让人把功能都摸一遍，到期自动掉回免费版，不会把盟锁死
  // 试用码单价记 0：不然总览里的收入会把每个试用码都按终极版 648 元算进去
  { label: '3 天试用', days: 3, validDays: 30, note: '试用', level: 'top', price: 0 },
  { label: '7 天试用', days: 7, validDays: 30, note: '试用', level: 'top', price: 0 },
  { label: '1 个月', days: 30, validDays: 0, note: '' },
  { label: '1 年', days: 365, validDays: 0, note: '' }
]
/** 档位自动填的备注；换到别的档位时只清这几个，管理员自己打的备注不动 */
const PRESET_NOTES = new Set(CODE_PRESETS.map((p) => p.note).filter(Boolean))

const CODE_COLS = [
  { label: '码', key: 'code', sort: (r) => r.code },
  { label: '等级', key: 'level', sort: (r) => r.price },
  { label: '单价', key: 'price', sort: (r) => r.price, num: true },
  // 不限期排在最长的那头。别用 Infinity：两个不限期相减是 NaN，排序会乱
  { label: '会员时长', key: 'days', sort: (r) => (r.days === 0 ? 1e9 : r.days), num: true },
  { label: '状态', key: 'status', sort: (r) => r.status },
  { label: '用在哪个盟', key: 'used', sort: (r) => (r.usedAt ? new Date(r.usedAt).getTime() : null) },
  { label: '生成', key: 'created', sort: (r) => new Date(r.createdAt).getTime() },
  { label: '备注', key: 'note', sort: (r) => r.note },
  { label: '' }
]

async function renderCodes(refresh = true) {
  if (refresh || !cache.codes) cache.codes = await call('dev.codes')
  const d = cache.codes
  if (!meta.levels.length) meta.levels = d.levels

  const opts = d.levels.map((l) => `<option value="${l.key}">${esc(l.name)} ${l.price} 元</option>`).join('')
  const picked = d.rows.filter((r) => codeFilter === 'all' || r.status === codeFilter)
  if (!sortState('code').key) sorts.code = { key: 'created', dir: -1 }
  const rows = applySort('code', CODE_COLS, picked)

  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
          <td><code>${esc(r.code)}</code> <button class="btn link small" data-copy="${esc(r.code)}">复制</button></td>
          <td><span class="tag purple">${esc(r.levelName)}</span></td>
          <td class="num">${money(r.price)}</td>
          <td class="num">${r.days ? r.days + ' 天' : '不限期'}</td>
          <td>${CODE_STATUS[r.status] || r.status}</td>
          <td>${r.allianceName ? esc(r.allianceName) + '<br /><span class="muted tiny">' + when(r.usedAt) + '</span>' : '—'}</td>
          <td class="muted tiny">${day(r.createdAt)}${r.codeExpiresAt ? '<br />码 ' + day(r.codeExpiresAt) + ' 作废' : ''}</td>
          <td class="muted tiny">${esc(r.note || '')}</td>
          <td style="white-space:nowrap">
            ${r.status === 'used'
              ? '<span class="muted tiny">已用掉</span>'
              : r.status === 'void'
                ? `<button class="btn link" data-undo="${esc(r.code)}">恢复</button><button class="btn link danger" data-del="${esc(r.code)}">删除</button>`
                : `<button class="btn link" data-void="${esc(r.code)}">作废</button><button class="btn link danger" data-del="${esc(r.code)}">删除</button>`}
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="9" class="empty">没有符合条件的兑换码</td></tr>'

  $('body').innerHTML = `
    <div class="card">
      <h3>生成兑换码</h3>
      <p class="hint">一个码只能用一次。会员天数 = 这个码能换多少天会员，填 0 表示不限期；码有效期 = 这个码自己多久不用就作废，填 0 表示一直有效。
        试用码建议配个终极版 —— 让人把功能都摸一遍，到期自动掉回免费版，不会把盟锁死。</p>
      <div class="row" style="margin-bottom:10px">
        <span class="muted tiny" style="align-self:center">常用档位</span>
        ${CODE_PRESETS.map((p, i) => `<button class="btn ghost small" data-preset="${i}">${p.label}</button>`).join('')}
      </div>
      <div class="row">
        <label class="f">等级<select id="cLevel">${opts}</select></label>
        <label class="f">单价（元）<input id="cPrice" type="number" min="0" placeholder="按等级" style="width:90px" /></label>
        <label class="f">会员天数<input id="cDays" type="number" value="365" min="0" /></label>
        <label class="f">码有效期（天）<input id="cValid" type="number" value="0" min="0" /></label>
        <label class="f">数量<input id="cCount" type="number" value="1" min="1" max="50" /></label>
        <label class="f" style="flex:1">备注<input id="cNote" placeholder="卖给谁 / 什么渠道" style="width:100%" /></label>
        <button class="btn" id="cMake" style="align-self:flex-end">生成</button>
      </div>
      <div id="madeBox"></div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h3>全部兑换码（${rows.length}${rows.length !== d.rows.length ? ' / ' + d.rows.length : ''}）</h3>
      </div>
      <div class="filters">
          <select id="cFilter">
            <option value="all">全部</option>
            <option value="unused">可用</option>
            <option value="used">已用</option>
            <option value="void">已作废</option>
            <option value="expired">已过期</option>
          </select>
          <button class="btn ghost small push" id="cImport">导入旧兑换码</button>
      </div>
      <table>
        ${thead('code', CODE_COLS)}
        <tbody>${body}</tbody>
      </table>
    </div>`

  $('cFilter').value = codeFilter
  $('cFilter').onchange = (e) => {
    codeFilter = e.target.value
    renderCodes(false)
  }
  bindSort(() => renderCodes(false))

  $('body')
    .querySelectorAll('[data-preset]')
    .forEach((b) => (b.onclick = () => {
      const p = CODE_PRESETS[Number(b.dataset.preset)]
      $('cDays').value = p.days
      $('cValid').value = p.validDays
      // 从「试用」换到「1 年」时把自动填的「试用」清掉，不然一年期的码也被标成试用
      if (p.note) $('cNote').value = p.note
      else if (PRESET_NOTES.has($('cNote').value.trim())) $('cNote').value = ''
      if (p.level === 'top') {
        const sel = $('cLevel')
        sel.value = sel.options[sel.options.length - 1].value
      }
      // 试用档位填 0；别的档位清空 = 按等级标价
      $('cPrice').value = p.price == null ? '' : p.price
    }))

  $('cMake').onclick = async () => {
    const payload = {
      level: $('cLevel').value,
      days: Number($('cDays').value || 0),
      validDays: Number($('cValid').value || 0),
      count: Number($('cCount').value || 1),
      note: $('cNote').value
    }
    // 不填就不传，服务端按等级标价记
    if ($('cPrice').value.trim() !== '') payload.price = Number($('cPrice').value)
    $('cMake').disabled = true
    try {
      const res = await call('dev.codeCreate', payload)
      const text = res.codes.join('\n')
      /*
       * 先重绘整屏（列表里要出现新码），再把刚生成的码贴出来。
       * 原来顺序是反的：先贴码、再重绘 —— 重绘会把整屏换掉，刚贴上的码一闪就没了，
       * 只剩一句 toast，想复制还得去下面列表里一个个找。
       */
      await renderCodes()
      $('madeBox').innerHTML =
        `<div class="codes">${res.codes.map(esc).join('<br />')}</div>` +
        `<div class="row" style="margin-top:10px"><button class="btn small" id="copyAll">全部复制</button><span class="muted tiny">发给买家即可，用掉之后这里会显示是哪个盟用的</span></div>`
      $('copyAll').onclick = () => copy(text)
      toast('生成了 ' + res.codes.length + ' 个')
    } catch (e) {
      toast(e.message)
    } finally {
      const btn = $('cMake')
      if (btn) btn.disabled = false
    }
  }

  $('cImport').onclick = async () => {
    if (!confirm('把云函数环境变量 ACTIVATION_CODES 里的老兑换码搬进库，按「基础版 365 天」记。库里已有的会跳过。')) return
    try {
      const res = await call('dev.codeImportEnv', { level: 'basic', days: 365 })
      toast(`导入 ${res.added.length} 个，跳过 ${res.skipped.length} 个`)
      renderCodes()
    } catch (e) {
      toast(e.message)
    }
  }

  bindCodeActions()
}

function bindCodeActions() {
  const body = $('body')
  body.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)))
  body.querySelectorAll('[data-void]').forEach((b) => (b.onclick = () => codeAct('dev.codeVoid', { code: b.dataset.void }, '作废后这个码就激活不了了，确定？')))
  body.querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => codeAct('dev.codeVoid', { code: b.dataset.undo, undo: true }, '恢复成可用？')))
  body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => codeAct('dev.codeDelete', { code: b.dataset.del }, '直接删掉，记录也不留。确定？')))
}

async function codeAct(action, data, ask) {
  if (!confirm(ask)) return
  try {
    await call(action, data)
    toast('好了')
    renderCodes()
  } catch (e) {
    toast(e.message)
  }
}

// ---------------- 同盟 ----------------

/** 同盟那一屏的筛选条件，翻来翻去保持住 */
const allyFilter = { server: '', name: '', status: '', level: '' }

const ALLY_COLS = [
  { label: '同盟', key: 'name', sort: (a) => a.name },
  { label: '区', key: 'serverNo', sort: (a) => Number(a.serverNo) || a.serverNo },
  { label: '状态', key: 'active', sort: (a) => (a.active ? 1 : 0) },
  { label: '等级', key: 'level', sort: (a) => a.levelOrder || 0 },
  { label: '会员到期', key: 'expire', sort: (a) => (a.memberExpiresAt ? new Date(a.memberExpiresAt).getTime() : null) },
  { label: '成员', key: 'members', sort: (a) => a.members, num: true },
  { label: '识别次数', key: 'calls', sort: (a) => a.vision.calls, num: true },
  { label: 'token / 成本', key: 'tokens', sort: (a) => a.vision.tokens, num: true },
  { label: '活跃', key: 'login', sort: (a) => (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : null) },
  { label: '' }
]

async function renderAlliances(refresh = true) {
  if (refresh || !cache.ally) cache.ally = await call('dev.alliances')
  const d = cache.ally
  if (!meta.levels.length) meta.levels = d.levels
  // 等级排序要按档次高低，不是按字母
  const order = new Map(meta.levels.map((l, i) => [l.key, i + 1]))
  d.rows.forEach((a) => { a.levelOrder = order.get(a.level) || 0 })

  const servers = [...new Set(d.rows.map((a) => a.serverNo).filter(Boolean))].sort(
    (x, y) => (Number(x) || 0) - (Number(y) || 0)
  )
  const kw = allyFilter.name.trim().toLowerCase()
  const picked = d.rows.filter((a) => {
    if (allyFilter.server && String(a.serverNo) !== allyFilter.server) return false
    if (allyFilter.status === 'on' && !a.active) return false
    if (allyFilter.status === 'off' && a.active) return false
    if (allyFilter.status === 'expired' && !(a.daysLeft !== null && a.daysLeft < 0)) return false
    if (allyFilter.status === 'soon' && !(a.daysLeft !== null && a.daysLeft >= 0 && a.daysLeft <= 14)) return false
    if (allyFilter.level && a.level !== allyFilter.level) return false
    if (kw && !(`${a.name} ${a.serverNo} ${a.ownerName || ''}`.toLowerCase().includes(kw))) return false
    return true
  })

  const rows = applySort('ally', ALLY_COLS, picked)
  const body = rows.length
    ? rows
        .map((a) => {
          const left =
            a.daysLeft === null
              ? a.level
                ? '<span class="tag green">不限期</span>'
                : '<span class="muted">—</span>'
              : a.daysLeft < 0
                ? `<span class="tag red">过期 ${-a.daysLeft} 天</span>`
                : a.daysLeft <= 14
                  ? `<span class="tag amber">${a.daysLeft} 天</span>`
                  : `${a.daysLeft} 天`
          return `<tr>
            <td><b>${esc(a.name)}</b>${a.ownerName ? '<br /><span class="muted tiny">盟主 ' + esc(a.ownerName) + '</span>' : ''}</td>
            <td class="tiny">${esc(a.serverNo)} 区<br /><span class="muted">${esc(a.season)}</span></td>
            <td>${a.active ? '<span class="tag green">已激活</span>' : '<span class="tag red">已停用</span>'}</td>
            <td>${a.level ? '<span class="tag purple">' + esc(a.levelName) + '</span>' : '<span class="muted">未设置</span>'}${extrasText(a)}</td>
            <td class="tiny">${a.memberExpiresAt ? day(a.memberExpiresAt) : '—'}<br />${left}</td>
            <td class="num">${num(a.members)}<br /><span class="muted tiny">绑定 ${a.bound}</span></td>
            <td class="num">${num(a.vision.calls)}<br /><span class="muted tiny">本月 ${a.vision.monthCalls}</span></td>
            <td class="num">${num(a.vision.tokens)}<br /><span class="muted tiny">${money(a.vision.cost)}</span></td>
            <td class="tiny">${ago(a.lastLoginAt)}<br /><span class="muted">导入 ${a.imports} 次</span></td>
            <td style="white-space:nowrap">
              <button class="btn link" data-grant="${esc(a._id)}" data-name="${esc(a.name)}" data-level="${esc(a.level || '')}">授权 / 续期</button>
              <button class="btn link" data-extras="${esc(a._id)}" data-name="${esc(a.name)}">附加功能</button>
              <button class="btn link ${a.active ? 'danger' : ''}" data-toggle="${esc(a._id)}" data-on="${a.active ? '0' : '1'}" data-name="${esc(a.name)}">${a.active ? '停用' : '启用'}</button>
            </td>
          </tr>`
        })
        .join('')
    : '<tr><td colspan="10" class="empty">没有符合条件的同盟</td></tr>'

  const levelOpts = [`<option value="">全部等级</option>`]
    .concat(
      meta.levels.map(
        (l) => `<option value="${esc(l.key)}"${l.key === allyFilter.level ? ' selected' : ''}>${esc(l.name)}</option>`
      )
    )
    .join('')

  $('body').innerHTML = `
    <div class="card">
      <h3>同盟（${rows.length}${rows.length !== d.rows.length ? ' / ' + d.rows.length : ''}）</h3>
      <div class="filters">
          <select id="fServer">${optionsOf(servers.map(String), allyFilter.server, '全部区')}</select>
          <select id="fStatus">
            <option value="">全部状态</option>
            <option value="on"${allyFilter.status === 'on' ? ' selected' : ''}>已激活</option>
            <option value="off"${allyFilter.status === 'off' ? ' selected' : ''}>已停用</option>
            <option value="soon"${allyFilter.status === 'soon' ? ' selected' : ''}>14 天内到期</option>
            <option value="expired"${allyFilter.status === 'expired' ? ' selected' : ''}>已过期</option>
          </select>
          <select id="fLevel">${levelOpts}</select>
          <input id="fName" placeholder="搜盟名 / 区 / 盟主" value="${esc(allyFilter.name)}" style="width:170px" />
          ${allyFilter.server || allyFilter.status || allyFilter.level || allyFilter.name ? '<button class="btn ghost small" id="fClear">清空</button>' : ''}
      </div>
      <p class="hint">「授权 / 续期」不用兑换码，直接给这个盟记上等级和天数；「停用」之后盟里所有人都只剩「等激活」那一屏，用来处理到期不续费的。点表头可以排序。</p>
      <table>
        ${thead('ally', ALLY_COLS)}
        <tbody>${body}</tbody>
      </table>
    </div>`

  const redraw = () => renderAlliances(false)
  $('fServer').onchange = (e) => { allyFilter.server = e.target.value; redraw() }
  $('fStatus').onchange = (e) => { allyFilter.status = e.target.value; redraw() }
  $('fLevel').onchange = (e) => { allyFilter.level = e.target.value; redraw() }
  // 搜索框打字时不重绘整屏（会丢焦点），回车或失焦再筛
  const nameBox = $('fName')
  nameBox.onchange = (e) => { allyFilter.name = e.target.value; redraw() }
  nameBox.onkeydown = (e) => { if (e.key === 'Enter') { allyFilter.name = e.target.value; redraw() } }
  if ($('fClear')) $('fClear').onclick = () => { Object.assign(allyFilter, { server: '', name: '', status: '', level: '' }); redraw() }
  bindSort(redraw)

  $('body').querySelectorAll('[data-grant]').forEach((b) => (b.onclick = () => grant(b.dataset.grant, b.dataset.name, b.dataset.level)))
  $('body').querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => toggle(b.dataset.toggle, b.dataset.on === '1', b.dataset.name)))
  $('body').querySelectorAll('[data-extras]').forEach((b) => (b.onclick = () => editExtras(b.dataset.extras, b.dataset.name)))
}

/** 等级之外单独开着的功能，在等级标签下面列一行 */
function extrasText(a) {
  const opts = (cache.ally && cache.ally.extraOptions) || []
  const list = (a.extraFeatures || []).map((k) => {
    const o = opts.find((x) => x.key === k)
    return o ? o.label.replace(/（.*$/, '') : k
  })
  return list.length ? `<br /><span class="tag amber tiny" title="等级之外单独开的">+ ${esc(list.join('、'))}</span>` : ''
}

/**
 * 单独加开 / 收回功能。用编号勾选：输入要开着的编号，空着回车 = 全部收回。
 * 主要给调整分级时的老客户用（比如之前高级版带电脑版，现在电脑版挪到终极了）。
 */
async function editExtras(allianceId, name) {
  const d = cache.ally
  const a = d.rows.find((x) => x._id === allianceId)
  const opts = d.extraOptions || []
  const cur = (a && a.extraFeatures) || []
  const lines = opts.map((o, i) => `${i + 1}. ${o.label}（${o.levelName}）${cur.includes(o.key) ? '  ✔ 已开' : ''}`).join('\n')
  const now = cur.map((k) => opts.findIndex((o) => o.key === k) + 1).filter((n) => n > 0).join(',')
  const pick = prompt(`「${name}」等级之外单独开哪些功能？\n\n${lines}\n\n填编号，逗号隔开；清空回车 = 全部收回`, now)
  if (pick === null) return
  const nums = pick.split(/[,，\s]+/).filter(Boolean).map(Number)
  if (nums.some((n) => !(n >= 1 && n <= opts.length))) return toast('编号填错了')
  try {
    const res = await call('dev.allianceExtras', { allianceId, features: nums.map((n) => opts[n - 1].key) })
    toast(res.extraFeatures.length ? '已单独开通 ' + res.extraFeatures.length + ' 项' : '已全部收回')
    renderAlliances()
  } catch (e) {
    toast(e.message)
  }
}

async function grant(allianceId, name, level) {
  const levels = meta.levels.map((l, i) => `${i + 1}=${l.name}`).join('  ')
  const pick = prompt(`给「${name}」授权\n\n选等级：${levels}\n（直接回车保持现在的等级）`, '')
  if (pick === null) return
  const idx = Number(pick)
  const lv = idx >= 1 && idx <= meta.levels.length ? meta.levels[idx - 1].key : level || 'basic'

  const days = prompt(`加多少天会员？\n\n正数=续期，负数=扣回去，0=设成不限期`, '365')
  if (days === null) return
  const n = Number(days)
  if (!Number.isFinite(n)) return toast('天数填错了')

  try {
    const res = await call('dev.allianceGrant', {
      allianceId,
      level: lv,
      days: n,
      unlimited: n === 0,
      activate: true
    })
    toast(res.memberExpiresAt ? '到期时间：' + day(res.memberExpiresAt) : '已设为不限期')
    renderAlliances()
  } catch (e) {
    toast(e.message)
  }
}

async function toggle(allianceId, active, name) {
  if (!confirm(active ? `启用「${name}」？` : `停用「${name}」后，盟里所有人都会被挡在「等激活」那一屏。确定？`)) return
  try {
    await call('dev.allianceActive', { allianceId, active })
    toast('好了')
    renderAlliances()
  } catch (e) {
    toast(e.message)
  }
}

// ---------------- 识别用量 ----------------

const visFilter = { server: '', ally: '', kind: '', ok: '', member: '' }

const VIS_COLS = [
  { label: '时间', key: 'at', sort: (r) => new Date(r.at).getTime() },
  { label: '区 / 同盟', key: 'ally', sort: (r) => `${r.serverNo} ${r.allianceName}` },
  { label: '成员', key: 'member', sort: (r) => r.memberName },
  { label: '类型', key: 'kind', sort: (r) => r.kind },
  { label: 'token', key: 'tokens', sort: (r) => r.totalTokens, num: true },
  { label: '结果', key: 'ok', sort: (r) => (r.ok ? 1 : 0) },
  { label: '模型' }
]

const MONTH_COLS = [
  { label: '月份', key: 'month', sort: (m) => m.month },
  { label: '调用', key: 'calls', sort: (m) => m.calls, num: true },
  { label: '失败', key: 'failed', sort: (m) => m.failed, num: true },
  { label: 'token', key: 'tokens', sort: (m) => m.tokens, num: true },
  { label: '成本', key: 'cost', sort: (m) => m.cost, num: true }
]

async function renderVision(refresh = true) {
  if (refresh || !cache.vis) cache.vis = await call('dev.vision')
  const d = cache.vis

  const months = Object.keys(d.byMonth).map((k) => ({ month: k, ...d.byMonth[k] }))
  if (!sortState('vmonth').key) sorts.vmonth = { key: 'month', dir: -1 }
  const mSorted = applySort('vmonth', MONTH_COLS, months)
  const mRows = mSorted.length
    ? mSorted
        .map((m) => `<tr><td>${esc(m.month)}</td><td class="num">${num(m.calls)}</td><td class="num">${num(m.failed)}</td><td class="num">${num(m.tokens)}</td><td class="num">${money(m.cost)}</td></tr>`)
        .join('')
    : '<tr><td colspan="5" class="empty">还没有识别记录</td></tr>'

  // 筛选项从这 200 条里现取，没出现过的区 / 盟不列出来
  const servers = [...new Set(d.rows.map((r) => r.serverNo).filter(Boolean))].sort((x, y) => (Number(x) || 0) - (Number(y) || 0))
  const allies = [...new Set(d.rows.filter((r) => !visFilter.server || String(r.serverNo) === visFilter.server).map((r) => r.allianceName).filter(Boolean))].sort()
  const kw = visFilter.member.trim().toLowerCase()
  const picked = d.rows.filter((r) => {
    if (visFilter.server && String(r.serverNo) !== visFilter.server) return false
    if (visFilter.ally && r.allianceName !== visFilter.ally) return false
    if (visFilter.kind && r.kind !== visFilter.kind) return false
    if (visFilter.ok === 'ok' && !r.ok) return false
    if (visFilter.ok === 'fail' && r.ok) return false
    if (kw && !String(r.memberName || '').toLowerCase().includes(kw)) return false
    return true
  })

  if (!sortState('vis').key) sorts.vis = { key: 'at', dir: -1 }
  const rows = applySort('vis', VIS_COLS, picked)
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td class="tiny">${when(r.at)}</td>
            <td class="tiny">${r.serverNo ? esc(r.serverNo) + ' 区' : '—'}<br /><span class="muted">${esc(r.allianceName || '—')}</span></td>
            <td>${esc(r.memberName || '—')}</td>
            <td>${r.kind === 'hero' ? '武将战力' : '属性面板'}</td>
            <td class="num">${num(r.totalTokens)}</td>
            <td>${r.ok ? '<span class="tag green">成功</span>' : '<span class="tag red">' + esc(r.errCode || '失败') + '</span>'}</td>
            <td class="muted tiny">${esc(r.model)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty">没有符合条件的记录</td></tr>'

  const dirty = visFilter.server || visFilter.ally || visFilter.kind || visFilter.ok || visFilter.member

  $('body').innerHTML = `
    <div class="card">
      <h3>按月</h3>
      <p class="hint">成本按云函数环境变量 VISION_PRICE_PER_1K（元 / 千 token）算；现在用的 glm-4v-flash 是免费的，所以显示 0。换成收费模型时把单价填上就有钱数了。点表头可以排序。</p>
      <table>${thead('vmonth', MONTH_COLS)}<tbody>${mRows}</tbody></table>
    </div>
    <div class="card">
      <h3>最近 200 次（${rows.length}${rows.length !== d.rows.length ? ' / ' + d.rows.length : ''}）</h3>
      <div class="filters">
          <select id="vServer">${optionsOf(servers.map(String), visFilter.server, '全部区')}</select>
          <select id="vAlly">${optionsOf(allies, visFilter.ally, '全部同盟')}</select>
          <select id="vKind">
            <option value="">全部类型</option>
            <option value="attrs"${visFilter.kind === 'attrs' ? ' selected' : ''}>属性面板</option>
            <option value="hero"${visFilter.kind === 'hero' ? ' selected' : ''}>武将战力</option>
          </select>
          <select id="vOk">
            <option value="">全部结果</option>
            <option value="ok"${visFilter.ok === 'ok' ? ' selected' : ''}>成功</option>
            <option value="fail"${visFilter.ok === 'fail' ? ' selected' : ''}>失败</option>
          </select>
          <input id="vMember" placeholder="搜成员名" value="${esc(visFilter.member)}" style="width:130px" />
          ${dirty ? '<button class="btn ghost small" id="vClear">清空</button>' : ''}
          <button class="btn ghost small push" id="vPrune">清理半年前</button>
      </div>
      <p class="hint">共 ${num(d.total)} 条，只取最近 200 条看，筛选和排序都是在这 200 条里做的。失败的也记 ——
        老是失败说明那个盟的人传的图不对，按区 / 同盟筛一下就能看出是哪一家。
        明细会一直长，清掉旧的不影响上面的按月统计（那份存在另一张汇总表里）。</p>
      <table>${thead('vis', VIS_COLS)}<tbody>${body}</tbody></table>
    </div>`

  const redraw = () => renderVision(false)
  $('vServer').onchange = (e) => { visFilter.server = e.target.value; visFilter.ally = ''; redraw() }
  $('vAlly').onchange = (e) => { visFilter.ally = e.target.value; redraw() }
  $('vKind').onchange = (e) => { visFilter.kind = e.target.value; redraw() }
  $('vOk').onchange = (e) => { visFilter.ok = e.target.value; redraw() }
  const box = $('vMember')
  box.onchange = (e) => { visFilter.member = e.target.value; redraw() }
  box.onkeydown = (e) => { if (e.key === 'Enter') { visFilter.member = e.target.value; redraw() } }
  if ($('vClear')) $('vClear').onclick = () => { Object.assign(visFilter, { server: '', ally: '', kind: '', ok: '', member: '' }); redraw() }
  bindSort(redraw)

  $('vPrune').onclick = async () => {
    if (!confirm('删掉半年前的逐条识别记录？按月统计不受影响，删了就找不回来了。')) return
    try {
      const r = await call('dev.visionPrune', { months: 6 })
      toast('删了 ' + r.deleted + ' 条')
      renderVision()
    } catch (e) {
      toast(e.message)
    }
  }
}

// ---------------- 会员方案 ----------------

async function renderPlans() {
  if (!meta.levels.length) {
    const d = await call('dev.overview')
    meta = { levels: d.levels, features: d.features }
  }
  const cards = meta.levels
    .map((l) => {
      // hidden 的（留言板）不在会员介绍里列；客服时效、定制这类服务承诺跟在后面
      const mine = meta.features.filter((f) => f.level === l.key && !f.hidden)
      const items = mine
        .map((f) => `<li>${esc(f.label)}${f.todo ? ' <span class="tag amber">待做</span>' : ''}</li>`)
        .concat((l.perks || []).map((p) => `<li class="muted">${esc(p)}</li>`))
        .join('')
      return `<div class="card">
        <h3>${esc(l.name)} <span class="muted">${l.price ? money(l.price) + '/每月' : '免费'}</span></h3>
        <p class="hint">${l.order > 0 ? '包含下面这些，外加前一档的全部' : '建盟就是这一档，不用兑换码；会员到期也掉回这一档'}</p>
        <ul style="margin:0;padding-left:18px;line-height:2">${items}</ul>
      </div>`
    })
    .join('')

  $('body').innerHTML = `
    <div class="card">
      <h3>会员方案</h3>
      <p class="hint">改价钱或调整哪档包含什么，改云函数的 <code>lib/membership.js</code>，这里、兑换码的下拉、小程序「管理 → 版本」页都会跟着变。
        个别盟要在等级之外多开某项（比如老客户保留电脑版），去「同盟」那页点「附加功能」。</p>
    </div>
    <div class="grid g4">${cards}</div>`
}

// ---------------- 演示环境 ----------------

const ROLE_NAME = { super: '超管', admin: '管理员', member: '成员' }

async function renderDemo() {
  const d = await call('demo.status')
  const demo = d.demo

  $('body').innerHTML = `
    <div class="card">
      <h3>演示环境</h3>
      <p class="hint">
        造一个跟真盟完全隔离的「演示同盟」：人数和数值分布照着真盟的样子来，但<b>名字全是生成的</b>，
        不会把真玩家 ID 放进宣传视频。还会补一段历史（逐日名单快照 + 六维逐步提升），
        不然看板上「涨了多少」那半边是空的。删掉演示盟 = 一次性清干净，碰不到真盟。
      </p>
      <div class="row">
        <label class="f">成员数<input id="dCount" type="number" value="86" min="10" max="100" /></label>
        <label class="f">历史天数<input id="dDays" type="number" value="21" min="2" max="60" /></label>
        <label class="f">随机种子<input id="dSeed" type="number" value="20261006" /></label>
        <button class="btn" id="dSeed2" style="align-self:flex-end">${demo ? '重新生成' : '生成演示数据'}</button>
        ${demo ? '<button class="btn ghost" id="dDel" style="align-self:flex-end">删掉演示盟</button>' : ''}
      </div>
      <div class="codes" id="dLog" hidden></div>
    </div>

    <div class="grid g3">
      ${statCard('演示同盟', demo ? esc(demo.name) : '还没造', demo ? `${esc(demo.serverNo)} 区` : '点上面生成')}
      ${statCard('成员', demo ? num(demo.members) : '—', demo ? '全是生成的假名' : '')}
      ${statCard('历史快照', demo ? num(demo.snapshots) : '—', demo ? '逐日一份' : '')}
    </div>

    <div class="card">
      <h3>我现在在哪</h3>
      <p class="hint">
        一个微信同时只能属于一个盟，所以要在小程序里看演示数据、或者从头测流程，得把自己临时挪走。
        原来的归属、绑着的全部成员和角色都存在服务端，点「回到我自己的盟」完整还原。
        <br /><b>离开当前同盟</b> = 变回没进任何盟的新用户：小程序里能从头测建盟（直接免费版）、凭邀请链接加入、输兑换码换档。
        离开期间真盟里绑的成员不解绑，别人绑不走。测试时新建的盟回家后就没超管了，测完可以在小程序「同盟信息」里删掉（只有空盟能删）。
      </p>
      <div class="row">
        <span class="tag ${!d.here ? 'red' : d.inDemo ? 'amber' : d.atHome ? 'green' : 'purple'}">${
          !d.here ? '没进任何盟' : d.inDemo ? '正在演示盟' : d.atHome ? '在自己的盟' : '在测试的盟'
        }</span>
        ${d.here ? `<span class="muted tiny">${esc(d.here.serverNo)} 区 · ${esc(d.here.name)} · ${esc(ROLE_NAME[d.here.role] || d.here.role)}</span>` : ''}
        ${d.home && !d.atHome ? `<span class="muted tiny">原归属：${esc(d.home.name || '—')}</span>` : ''}
        <div style="flex:1"></div>
        ${d.here ? '<button class="btn ghost" id="dLeave">离开当前同盟</button>' : ''}
        ${demo && !d.inDemo ? '<button class="btn ghost" id="dSwitch">切到演示同盟</button>' : ''}
        ${!d.atHome ? '<button class="btn" id="dBack">回到我自己的盟</button>' : ''}
      </div>
    </div>`

  const logBox = $('dLog')
  const say = (t) => { logBox.hidden = false; logBox.innerHTML += esc(t) + '<br />' }

  $('dSeed2').onclick = async () => {
    if (demo && !confirm('会先把现有的演示盟整个删掉再重造，确定？')) return
    $('dSeed2').disabled = true
    logBox.hidden = false
    logBox.innerHTML = ''
    say('正在生成，上百条记录要写一会儿，别切页面…')
    try {
      const res = await call('demo.seed', {
        count: Number($('dCount').value || 86),
        days: Number($('dDays').value || 21),
        seed: Number($('dSeed').value || 20261006)
      })
      say(`好了：${res.members} 人 · ${res.rosterSnapshots} 份名单快照 · ${res.attrSnapshots} 条六维记录`)
      toast('演示数据已生成')
      setTimeout(renderDemo, 1200)
    } catch (e) {
      say('出错了：' + e.message)
      toast(e.message)
    } finally {
      const b = $('dSeed2')
      if (b) b.disabled = false
    }
  }

  if ($('dDel')) {
    $('dDel').onclick = async () => {
      if (!confirm('把演示盟和它的全部数据删掉。真盟不受影响。确定？')) return
      try {
        await call('demo.remove')
        toast('删掉了')
        renderDemo()
      } catch (e) {
        toast(e.message)
      }
    }
  }

  const act = (id, ask, action, payload, done) => {
    if (!$(id)) return
    $(id).onclick = async () => {
      if (!confirm(ask)) return
      try {
        await call(action, payload)
        toast(done)
        renderDemo()
      } catch (e) {
        toast(e.message)
      }
    }
  }
  act('dSwitch', '把你自己临时挪到演示盟，随时能切回来。', 'demo.switch', {}, '切过去了')
  act('dBack', '回到你自己的盟，绑定和权限原样还原。', 'demo.switch', { back: true }, '回来了')
  act(
    'dLeave',
    '离开当前同盟，变成没进任何盟的新用户。\n小程序重新打开就是「创建 / 加入同盟」那一屏。\n原来的归属存着，随时点「回到我自己的盟」还原。',
    'demo.leave',
    {},
    '已离开，去小程序里从头测吧'
  )
}

// ---------------- 备份 ----------------

async function renderBackup() {
  const d = await call('dev.backupMeta')
  const total = d.collections.reduce((a, c) => a + (c.count || 0), 0)

  const rows = d.collections
    .map((c) => `<tr><td><code>${esc(c.name)}</code></td><td class="num">${num(c.count)}</td><td class="muted tiny">${esc(c.error || '')}</td></tr>`)
    .join('')
  const files = d.files
    .map((f) => `<tr><td><code>${esc(f.path)}</code></td><td class="num">${size(f.size)}</td></tr>`)
    .join('')

  $('body').innerHTML = `
    <div class="card">
      <h3>备份到本机</h3>
      <p class="hint">
        点下面的按钮会直接下载到你电脑的「下载」目录。数据是逐页取回来再拼成一个 JSON，
        集合大的时候要等一会儿，别中途切页面。
        <b>环境变量（智谱 API Key 这些）不在备份里</b>，换环境要自己重新填。
      </p>
      <div class="row">
        <button class="btn" id="bAll">全部备份（数据 + 代码）</button>
        <button class="btn ghost" id="bData">只备份数据</button>
        <button class="btn ghost" id="bCode">只备份云函数代码</button>
      </div>
      <div class="codes" id="bLog" hidden></div>
    </div>

    <div class="grid g3" style="align-items:start">
      <div class="card">
        <h3>数据（${num(total)} 条）</h3>
        <table><thead><tr><th>集合</th><th class="num">条数</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="card" style="grid-column: span 2">
        <h3>云函数代码（${d.files.length} 个文件）</h3>
        <p class="hint">线上正在跑的那一份，不含 node_modules。本地仓库才是正本，这里是用来核对线上到底是哪一版的。</p>
        <table><thead><tr><th>文件</th><th class="num">大小</th></tr></thead><tbody>${files}</tbody></table>
      </div>
    </div>`

  const logBox = $('bLog')
  const say = (t) => {
    logBox.hidden = false
    logBox.innerHTML += esc(t) + '<br />'
    logBox.scrollTop = logBox.scrollHeight
  }

  async function dumpData() {
    const out = { env: 'cloud1-d4gobc9ws5134943d', at: new Date().toISOString(), collections: {} }
    for (const c of d.collections) {
      if (c.error) {
        say(`${c.name} 跳过（${c.error}）`)
        continue
      }
      const rows = []
      for (let skip = 0; ; skip += d.pageSize) {
        const page = await call('dev.backupCollection', { name: c.name, skip, limit: d.pageSize })
        rows.push(...page.rows)
        say(`${c.name} ${rows.length}/${c.count}`)
        if (page.done) break
      }
      out.collections[c.name] = rows
    }
    return out
  }

  async function run(what) {
    ;['bAll', 'bData', 'bCode'].forEach((id) => { $(id).disabled = true })
    logBox.hidden = false
    logBox.innerHTML = ''
    try {
      if (what !== 'code') {
        say('开始导数据…')
        const data = await dumpData()
        download(`sanbing-data-${stamp()}.json`, JSON.stringify(data, null, 2))
        say('数据已下载')
      }
      if (what !== 'data') {
        say('开始导代码…')
        const code = await call('dev.backupCode')
        download(`sanbing-code-${stamp()}.json`, JSON.stringify(code, null, 2))
        say(`代码已下载（${code.count} 个文件，${size(code.bytes)}）`)
      }
      toast('备份好了，看下载目录')
    } catch (e) {
      say('出错了：' + e.message)
      toast(e.message)
    } finally {
      ;['bAll', 'bData', 'bCode'].forEach((id) => { const b = $(id); if (b) b.disabled = false })
    }
  }

  $('bAll').onclick = () => run('all')
  $('bData').onclick = () => run('data')
  $('bCode').onclick = () => run('code')
}

// ---------------- 操作日志 ----------------

const LOG_NAME = {
  codeCreate: '生成兑换码',
  codeVoid: '作废兑换码',
  codeRestore: '恢复兑换码',
  codeDelete: '删除兑换码',
  codeImportEnv: '导入旧兑换码',
  allianceGrant: '授权 / 续期',
  allianceEnable: '启用同盟',
  allianceDisable: '停用同盟'
}

async function renderLogs() {
  const d = await call('dev.logs')
  const rows = d.rows.length
    ? d.rows
        .map(
          (r) => `<tr>
            <td class="tiny">${when(r.at)}</td>
            <td>${esc(LOG_NAME[r.action] || r.action)}</td>
            <td class="muted tiny">${esc(JSON.stringify(r.detail || {}))}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="empty">还没有操作记录</td></tr>'
  $('body').innerHTML = `
    <div class="card">
      <h3>最近 100 条</h3>
      <p class="hint">后台里每一个会改数据的操作都记在这儿。</p>
      <table><thead><tr><th>时间</th><th>操作</th><th>详情</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`
}

// ---------------- 启动 ----------------

async function boot() {
  showOnly('boot')
  if (!token) {
    showOnly('login')
    newTicket()
    return
  }
  try {
    const d = await call('dev.overview')
    meta = { levels: d.levels, features: d.features }
    $('who').textContent = d.me ? d.me.slice(0, 12) + '…' : '开发者'
    showOnly('app')
    buildNav()
    load()
  } catch (e) {
    // 认证类错误才踢回登录页；网络抖动不要白白把 token 丢了
    if (e.errCode === 'WEB_UNAUTHED' || e.errCode === 'NOT_DEVELOPER') {
      if (e.errCode === 'NOT_DEVELOPER') alert('这个微信不在开发者白名单里')
      token = ''
      store.write('')
      showOnly('login')
      newTicket()
      return
    }
    showOnly('app')
    buildNav()
    $('body').innerHTML = `<div class="card"><h3>连不上</h3><p class="hint danger">${esc(e.message)}</p></div>`
  }
}

$('refreshQr').onclick = newTicket
$('logout').onclick = logout
$('reload').onclick = load
boot()

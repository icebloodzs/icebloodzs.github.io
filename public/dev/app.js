/**
 * 三冰小帮手 · 开发者后台。
 *
 * 只给开发者自己用：管激活码（等级 / 有效期 / 用没用）和各个盟的会员状态与模型用量。
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
  { key: 'codes', title: '激活码', render: renderCodes },
  { key: 'alliances', title: '同盟', render: renderAlliances },
  { key: 'vision', title: '识别用量', render: renderVision },
  { key: 'plans', title: '会员方案', render: renderPlans },
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
        <td class="num">${money((x.codesUsed || 0) * l.price)}</td>
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
      ${statCard('可用激活码', num(d.codes.unused), `已用 ${d.codes.used} · 作废 ${d.codes.void + d.codes.expired}`)}
      ${statCard('图片识别', num(d.vision.calls) + ' 次', `本月 ${d.vision.monthCalls} 次 · ${num(d.vision.tokens)} token`)}
      ${statCard('模型成本', money(d.vision.cost), d.vision.pricePer1k ? `按 ${d.vision.pricePer1k} 元/千 token` : '当前模型免费，未计价')}
    </div>

    <div class="card">
      <h3>按等级</h3>
      <p class="hint">收入按「激活码被用掉」的时间记，没发出去的码不算钱。</p>
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

// ---------------- 激活码 ----------------

const CODE_STATUS = {
  unused: '<span class="tag green">可用</span>',
  used: '<span class="tag">已用</span>',
  void: '<span class="tag red">已作废</span>',
  expired: '<span class="tag amber">已过期</span>'
}
let codeFilter = 'all'

async function renderCodes() {
  const d = await call('dev.codes')
  if (!meta.levels.length) meta.levels = d.levels

  const opts = d.levels.map((l) => `<option value="${l.key}">${esc(l.name)} ${l.price} 元</option>`).join('')
  const rows = d.rows.filter((r) => codeFilter === 'all' || r.status === codeFilter)

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
    : '<tr><td colspan="9" class="empty">没有符合条件的激活码</td></tr>'

  $('body').innerHTML = `
    <div class="card">
      <h3>生成激活码</h3>
      <p class="hint">一个码只能用一次。会员天数 = 这个码能换多少天会员，填 0 表示不限期；码有效期 = 这个码自己多久不用就作废，填 0 表示一直有效。</p>
      <div class="row">
        <label class="f">等级<select id="cLevel">${opts}</select></label>
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
        <h3>全部激活码（${d.rows.length}）</h3>
        <div class="row">
          <select id="cFilter">
            <option value="all">全部</option>
            <option value="unused">可用</option>
            <option value="used">已用</option>
            <option value="void">已作废</option>
            <option value="expired">已过期</option>
          </select>
          <button class="btn ghost small" id="cImport">导入旧激活码</button>
        </div>
      </div>
      <table>
        <thead><tr><th>码</th><th>等级</th><th class="num">单价</th><th class="num">会员时长</th><th>状态</th><th>用在哪个盟</th><th>生成</th><th>备注</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`

  $('cFilter').value = codeFilter
  $('cFilter').onchange = (e) => {
    codeFilter = e.target.value
    renderCodes()
  }

  $('cMake').onclick = async () => {
    const payload = {
      level: $('cLevel').value,
      days: Number($('cDays').value || 0),
      validDays: Number($('cValid').value || 0),
      count: Number($('cCount').value || 1),
      note: $('cNote').value
    }
    $('cMake').disabled = true
    try {
      const res = await call('dev.codeCreate', payload)
      const text = res.codes.join('\n')
      $('madeBox').innerHTML =
        `<div class="codes">${res.codes.map(esc).join('<br />')}</div>` +
        `<div class="row" style="margin-top:10px"><button class="btn small" id="copyAll">全部复制</button><span class="muted tiny">发给买家即可，用掉之后这里会显示是哪个盟用的</span></div>`
      $('copyAll').onclick = () => copy(text)
      toast('生成了 ' + res.codes.length + ' 个')
      await renderCodes()
    } catch (e) {
      toast(e.message)
    } finally {
      const btn = $('cMake')
      if (btn) btn.disabled = false
    }
  }

  $('cImport').onclick = async () => {
    if (!confirm('把云函数环境变量 ACTIVATION_CODES 里的老激活码搬进库，按「普通会员 365 天」记。库里已有的会跳过。')) return
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

async function renderAlliances() {
  const d = await call('dev.alliances')
  if (!meta.levels.length) meta.levels = d.levels

  const rows = d.rows.length
    ? d.rows
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
            <td><b>${esc(a.name)}</b><br /><span class="muted tiny">${esc(a.serverNo)} 区 · ${esc(a.season)}${a.ownerName ? ' · 盟主 ' + esc(a.ownerName) : ''}</span></td>
            <td>${a.active ? '<span class="tag green">已激活</span>' : '<span class="tag red">已停用</span>'}</td>
            <td>${a.level ? '<span class="tag purple">' + esc(a.levelName) + '</span>' : '<span class="muted">未设置</span>'}</td>
            <td class="tiny">${a.memberExpiresAt ? day(a.memberExpiresAt) : '—'}<br />${left}</td>
            <td class="num">${num(a.members)}<br /><span class="muted tiny">绑定 ${a.bound}</span></td>
            <td class="num">${num(a.vision.calls)}<br /><span class="muted tiny">本月 ${a.vision.monthCalls}</span></td>
            <td class="num">${num(a.vision.tokens)}<br /><span class="muted tiny">${money(a.vision.cost)}</span></td>
            <td class="tiny">${ago(a.lastLoginAt)}<br /><span class="muted">导入 ${a.imports} 次</span></td>
            <td style="white-space:nowrap">
              <button class="btn link" data-grant="${esc(a._id)}" data-name="${esc(a.name)}" data-level="${esc(a.level || '')}">授权 / 续期</button>
              <button class="btn link ${a.active ? 'danger' : ''}" data-toggle="${esc(a._id)}" data-on="${a.active ? '0' : '1'}" data-name="${esc(a.name)}">${a.active ? '停用' : '启用'}</button>
            </td>
          </tr>`
        })
        .join('')
    : '<tr><td colspan="9" class="empty">还没有同盟</td></tr>'

  $('body').innerHTML = `
    <div class="card">
      <h3>同盟（${d.rows.length}）</h3>
      <p class="hint">「授权 / 续期」不用激活码，直接给这个盟记上等级和天数；「停用」之后盟里所有人都只剩「等激活」那一屏，用来处理到期不续费的。</p>
      <table>
        <thead><tr><th>同盟</th><th>状态</th><th>等级</th><th>会员到期</th><th class="num">成员</th><th class="num">识别次数</th><th class="num">token / 成本</th><th>活跃</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`

  $('body').querySelectorAll('[data-grant]').forEach((b) => (b.onclick = () => grant(b.dataset.grant, b.dataset.name, b.dataset.level)))
  $('body').querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => toggle(b.dataset.toggle, b.dataset.on === '1', b.dataset.name)))
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

async function renderVision() {
  const d = await call('dev.vision')
  const months = Object.keys(d.byMonth).sort().reverse()

  const mRows = months.length
    ? months
        .map((k) => {
          const m = d.byMonth[k]
          return `<tr><td>${k}</td><td class="num">${num(m.calls)}</td><td class="num">${num(m.failed)}</td><td class="num">${num(m.tokens)}</td><td class="num">${money(m.cost)}</td></tr>`
        })
        .join('')
    : '<tr><td colspan="5" class="empty">还没有识别记录</td></tr>'

  const rows = d.rows.length
    ? d.rows
        .map(
          (r) => `<tr>
            <td class="tiny">${when(r.at)}</td>
            <td>${r.kind === 'hero' ? '武将战力' : '属性面板'}</td>
            <td>${esc(r.memberName || '—')}</td>
            <td class="num">${num(r.totalTokens)}</td>
            <td>${r.ok ? '<span class="tag green">成功</span>' : '<span class="tag red">' + esc(r.errCode || '失败') + '</span>'}</td>
            <td class="muted tiny">${esc(r.model)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">还没有识别记录</td></tr>'

  $('body').innerHTML = `
    <div class="card">
      <h3>按月</h3>
      <p class="hint">成本按云函数环境变量 VISION_PRICE_PER_1K（元 / 千 token）算；现在用的 glm-4v-flash 是免费的，所以显示 0。换成收费模型时把单价填上就有钱数了。</p>
      <table><thead><tr><th>月份</th><th class="num">调用</th><th class="num">失败</th><th class="num">token</th><th class="num">成本</th></tr></thead><tbody>${mRows}</tbody></table>
    </div>
    <div class="card">
      <h3>最近 200 次</h3>
      <p class="hint">共 ${num(d.total)} 条。失败的也记——老是失败说明那个盟的人传的图不对，可以主动去问。</p>
      <table><thead><tr><th>时间</th><th>类型</th><th>成员</th><th class="num">token</th><th>结果</th><th>模型</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`
}

// ---------------- 会员方案 ----------------

async function renderPlans() {
  if (!meta.levels.length) {
    const d = await call('dev.overview')
    meta = { levels: d.levels, features: d.features }
  }
  const cards = meta.levels
    .map((l) => {
      const mine = meta.features.filter((f) => f.level === l.key)
      const items = mine
        .map((f) => `<li>${esc(f.label)}${f.todo ? ' <span class="tag amber">待做</span>' : ''}</li>`)
        .join('')
      return `<div class="card">
        <h3>${esc(l.name)} <span class="muted">${money(l.price)}</span></h3>
        <p class="hint">${l.order > 1 ? '包含下面这些，外加前一档的全部' : '基础档'}</p>
        <ul style="margin:0;padding-left:18px;line-height:2">${items}</ul>
      </div>`
    })
    .join('')

  $('body').innerHTML = `
    <div class="card">
      <h3>会员方案</h3>
      <p class="hint">改价钱或调整哪档包含什么，改云函数的 <code>lib/membership.js</code>，这里和激活码的下拉都会跟着变。小程序端暂时不展示会员信息。</p>
    </div>
    <div class="grid g3">${cards}</div>`
}

// ---------------- 操作日志 ----------------

const LOG_NAME = {
  codeCreate: '生成激活码',
  codeVoid: '作废激活码',
  codeRestore: '恢复激活码',
  codeDelete: '删除激活码',
  codeImportEnv: '导入旧激活码',
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

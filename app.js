/**
 * 电脑版后台：一个静态页 + 云函数的 HTTP 入口，没有打包、没有框架。
 *
 * 登录：这边出票据画二维码，管理员用小程序扫码确认，这边轮询拿到 token 存 localStorage。
 * 之后每个请求都带这个 token，云函数据此认人（和小程序同一套权限判定）。
 * 数据只拉一次 admin.memberList（百来人一次回全），四个视图都在前端算。
 */

// 静态托管的域名加不了路由（系统内部域名），所以 API 走云开发的 HTTP 访问服务，
// 跨域靠云函数自己回的 CORS 头放行
var API = 'https://cloud1-d4gobc9ws5134943d-1483434711.ap-shanghai.app.tcloudbase.com/api'

var TOKEN_KEY = 'sanbing_web_token'
var token = ''
try { token = localStorage.getItem(TOKEN_KEY) || '' } catch (e) { token = '' }

var state = { me: null, members: [], season: null, view: 'roster', sort: { key: 'power', desc: true }, keyword: '' }

// ---------------- 调接口 ----------------

function call(action, data) {
  return fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: action, data: data || {}, token: token })
  })
    .then(function (r) { return r.json() })
    .then(function (r) {
      if (!r || r.code !== 0) {
        var err = new Error((r && r.message) || '请求失败')
        err.errCode = r && r.errCode
        throw err
      }
      return r.data
    })
}

function $(id) { return document.getElementById(id) }

// ---------------- 登录 ----------------

var qrTimer = null
var pollTimer = null

function stopLogin() {
  if (qrTimer) clearTimeout(qrTimer)
  if (pollTimer) clearInterval(pollTimer)
  qrTimer = pollTimer = null
}

function newTicket() {
  stopLogin()
  $('loginTip').textContent = ''
  $('qr').innerHTML = '<div class="qr-mask">正在生成二维码…</div>'
  call('web.ticketCreate')
    .then(function (res) {
      $('qr').innerHTML = ''
      new QRCode($('qr'), { text: res.ticket, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M })
      var left = res.expiresIn
      pollTimer = setInterval(function () { poll(res.ticket) }, 1500)
      qrTimer = setTimeout(function () {
        stopLogin()
        $('qr').innerHTML = '<div class="qr-mask">二维码过期了<br>点下面刷新</div>'
      }, left * 1000)
    })
    .catch(function (e) {
      $('qr').innerHTML = '<div class="qr-mask">生成失败</div>'
      $('loginTip').textContent = e.message
    })
}

function poll(ticket) {
  call('web.ticketPoll', { ticket: ticket })
    .then(function (res) {
      if (res.status === 'expired') {
        stopLogin()
        $('qr').innerHTML = '<div class="qr-mask">二维码过期了<br>点下面刷新</div>'
        return
      }
      if (res.status !== 'confirmed') return
      stopLogin()
      token = res.token
      try { localStorage.setItem(TOKEN_KEY, token) } catch (e) {}
      $('loginTip').textContent = '登录成功，正在进入…'
      boot()
    })
    .catch(function () {})
}

function logout() {
  call('web.logout').catch(function () {})
  token = ''
  try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
  location.reload()
}

// ---------------- 启动 ----------------

function boot() {
  if (!token) {
    $('login').style.display = 'flex'
    $('app').classList.remove('on')
    newTicket()
    return
  }
  call('identity.whoami')
    .then(function (me) {
      if (!me.alliance || !me.alliance.active) throw new Error('这个账号还没加入已激活的同盟')
      if (me.role !== 'admin' && me.role !== 'super') throw new Error('只有管理员能用电脑版')
      state.me = me
      $('login').style.display = 'none'
      $('app').classList.add('on')
      $('allyName').textContent = me.alliance.name
      $('allySub').textContent = me.alliance.serverNo + ' 区 · ' + me.alliance.season
      $('whoName').textContent = (me.nickname || '管理员') + (me.role === 'super' ? '（超管）' : '')
      return load()
    })
    .catch(function (e) {
      token = ''
      try { localStorage.removeItem(TOKEN_KEY) } catch (err) {}
      $('login').style.display = 'flex'
      $('app').classList.remove('on')
      newTicket()
      $('loginTip').textContent = e.message || '登录已失效，请重新扫码'
    })
}

function load() {
  $('body').innerHTML = '<div class="card"><div class="empty">读取中…</div></div>'
  return Promise.all([
    call('admin.memberList', { roster: 'in', sort: 'powerDesc', page: 1, pageSize: 200 }),
    call('season.list', {})
  ]).then(function (res) {
    state.members = res[0].rows
    state.season = res[1].season
    render()
  }).catch(function (e) {
    $('body').innerHTML = '<div class="card"><div class="empty danger">' + esc(e.message) + '</div></div>'
  })
}

// ---------------- 小工具 ----------------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}

/** 1.01亿 / 7023万 这种写法，和小程序里一致 */
function big(v) {
  if (v === null || v === undefined || v === '') return '—'
  var n = Number(v)
  if (!isFinite(n)) return '—'
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return Math.round(n / 1e4) + '万'
  return String(n)
}

function num(v, digits) {
  if (v === null || v === undefined || v === '') return '—'
  var n = Number(v)
  return isFinite(n) ? n.toFixed(digits || 0) : '—'
}

/** 多久没更新了：越久颜色越重 */
function ago(iso) {
  if (!iso) return '<span class="danger">从未</span>'
  var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  var cls = d >= 7 ? 'danger' : d >= 3 ? 'warn' : 'ok'
  return '<span class="' + cls + '">' + (d <= 0 ? '今天' : d + ' 天前') + '</span>'
}

function sortRows(rows, key, desc) {
  var get = {
    name: function (m) { return m.name },
    power: function (m) { return m.power },
    strength: function (m) { return m.strength },
    rank: function (m) { return m.rank },
    weeklyMerit: function (m) { return m.weeklyMerit },
    totalMerit: function (m) { return m.totalMerit },
    weeklyDonate: function (m) { return m.weeklyDonate },
    maxBonus: function (m) { return m.maxBonus },
    maxMarch: function (m) { return m.maxMarch },
    attrsSum: function (m) { return m.attrsSum },
    troops: function (m) { return troopSum(m) },
    heroPower: function (m) { return m.heroPower },
    seasonScore: function (m) { return m.seasonScore },
    attrsUpdatedAt: function (m) { return m.attrsUpdatedAt ? new Date(m.attrsUpdatedAt).getTime() : 0 }
  }[key] || function (m) { return m.power }

  return rows.slice().sort(function (a, b) {
    var x = get(a)
    var y = get(b)
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x || '').localeCompare(String(y || ''), 'zh') * (desc ? -1 : 1)
    }
    // 没填的一律排最后，不和 0 混在一起
    var xn = x === null || x === undefined
    var yn = y === null || y === undefined
    if (xn && yn) return 0
    if (xn) return 1
    if (yn) return -1
    return (desc ? y - x : x - y)
  })
}

function troopSum(m) {
  var t = m.troops || {}
  var v = ['inf', 'cav', 'arc'].map(function (k) { return t[k] })
  if (v.every(function (x) { return x === null || x === undefined })) return null
  return v.reduce(function (s, x) { return s + (Number(x) || 0) }, 0)
}

function filtered() {
  var kw = state.keyword.trim().toLowerCase()
  if (!kw) return state.members
  return state.members.filter(function (m) { return String(m.name).toLowerCase().indexOf(kw) >= 0 })
}

function table(cols, rows, renderRow) {
  if (!rows.length) return '<div class="empty">没有符合条件的成员</div>'
  var head = cols.map(function (c) {
    var arrow = state.sort.key === c.key ? (state.sort.desc ? ' ▼' : ' ▲') : ''
    return '<th data-sort="' + (c.key || '') + '">' + esc(c.label) + arrow + '</th>'
  }).join('')
  var body = rows.map(renderRow).join('')
  return '<div class="tbl-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
}

function toolbar(extra) {
  return '<div class="bar">' +
    '<span>共 <b class="num">' + filtered().length + '</b> 人</span>' +
    (extra || '') +
    '<span class="sp"></span>' +
    '<input type="search" id="kw" placeholder="搜成员名" value="' + esc(state.keyword) + '" />' +
    '<button class="btn" id="csv">导出 CSV</button>' +
    '</div>'
}

// ---------------- 四个视图 ----------------

var VIEWS = {
  roster: {
    title: '同盟名单',
    desc: '名单数据来自管理员导入的同盟成员列表。点表头切换升序 / 降序。',
    cols: [
      { key: '', label: '#' }, { key: 'name', label: '成员' }, { key: 'rank', label: '阶级' },
      { key: '', label: '火炉' }, { key: 'power', label: '战力' }, { key: 'strength', label: '实力' },
      { key: 'weeklyMerit', label: '周功勋' }, { key: 'totalMerit', label: '总功勋' },
      { key: 'weeklyDonate', label: '周捐献' }, { key: '', label: '绑定' }
    ],
    row: function (m, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        '<td>' + (m.rank == null ? '—' : m.rank) + '</td>' +
        '<td>' + esc(m.furnace || '—') + '</td>' +
        '<td class="num">' + big(m.power) + '</td>' +
        '<td class="num">' + big(m.strength) + '</td>' +
        '<td>' + big(m.weeklyMerit) + '</td>' +
        '<td>' + big(m.totalMerit) + '</td>' +
        '<td>' + big(m.weeklyDonate) + '</td>' +
        '<td>' + (m.boundUid ? '<span class="ok">已绑</span>' : '<span class="muted">未绑</span>') + '</td></tr>'
    }
  },

  bonus: {
    title: '成员加成',
    desc: '集结值和兵力由成员在小程序「我的数据」里自己填，属性由截图识别。按更新时间排序能快速找出没及时更新的人。',
    cols: [
      { key: '', label: '#' }, { key: 'name', label: '成员' }, { key: 'maxBonus', label: '最高集结值' },
      { key: 'maxMarch', label: '单人出征' }, { key: 'troops', label: '兵力合计' }, { key: '', label: '步 / 骑 / 弓' },
      { key: 'attrsSum', label: '六维总和' }, { key: 'attrsUpdatedAt', label: '资料更新' }
    ],
    row: function (m, i) {
      var t = m.troops || {}
      var b = m.barracks || {}
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        '<td class="num">' + num(m.maxBonus, 2) + '</td>' +
        '<td>' + (m.maxMarch == null ? '<span class="muted">—</span>' : big(m.maxMarch)) + '</td>' +
        '<td class="num">' + (troopSum(m) === null ? '—' : troopSum(m) + '万') + '</td>' +
        '<td class="muted">宫' + (b.inf || '-') + ' ' + num(t.inf) + ' / 宫' + (b.cav || '-') + ' ' + num(t.cav) + ' / 宫' + (b.arc || '-') + ' ' + num(t.arc) + '</td>' +
        '<td>' + num(m.attrsSum, 2) + '</td>' +
        '<td>' + ago(m.attrsUpdatedAt) + '</td></tr>'
    }
  },

  missing: {
    title: '遗漏排查',
    desc: '找出还没填集结值、没填兵力、没传属性截图的人。勾选条件是「或」的关系。',
    cols: [
      { key: '', label: '#' }, { key: 'name', label: '成员' }, { key: '', label: '缺什么' },
      { key: '', label: '绑定' }, { key: 'power', label: '战力' }, { key: 'attrsUpdatedAt', label: '资料更新' }
    ],
    row: function (m, i) {
      var tags = []
      if (m.maxBonus == null) tags.push('<span class="tag warn">没填集结</span>')
      if (!m.troopsComplete) tags.push('<span class="tag warn">没填兵力</span>')
      if (!m.profileComplete) tags.push('<span class="tag danger">没传属性</span>')
      if (m.maxMarch == null) tags.push('<span class="tag muted">没填出征</span>')
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        '<td>' + tags.join(' ') + '</td>' +
        '<td>' + (m.boundUid ? '<span class="ok">已绑</span>' : '<span class="danger">未绑</span>') + '</td>' +
        '<td class="num">' + big(m.power) + '</td>' +
        '<td>' + ago(m.attrsUpdatedAt) + '</td></tr>'
    }
  },

  season: {
    title: '赛季评分',
    desc: '评分 = 成员实力 − 武将战力。武将战力只能由成员自己上传截图识别，填不了也改不了。',
    cols: [
      { key: '', label: '#' }, { key: 'name', label: '成员' }, { key: 'strength', label: '成员实力' },
      { key: 'heroPower', label: '武将战力' }, { key: 'seasonScore', label: '赛季评分' },
      { key: '', label: '定位' }, { key: '', label: '录入人' }
    ],
    row: function (m, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        '<td>' + big(m.strength) + '</td>' +
        '<td class="num">' + (m.heroPower == null ? '<span class="muted">未录入</span>' : big(m.heroPower)) + '</td>' +
        '<td class="num">' + big(m.seasonScore) + '</td>' +
        '<td>' + positionOf(m.seasonScore) + '</td>' +
        '<td class="muted">' + esc(m.heroPowerBy || '—') + '</td></tr>'
    }
  },

  users: {
    title: '绑定情况',
    desc: '谁已经把微信绑到了名单里的成员账号上。没绑的人在小程序里看不到自己的数据。',
    cols: [
      { key: '', label: '#' }, { key: 'name', label: '成员' }, { key: '', label: '绑定' },
      { key: 'power', label: '战力' }, { key: 'strength', label: '实力' }, { key: '', label: '曾用名' }
    ],
    row: function (m, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        '<td>' + (m.boundUid ? '<span class="ok">已绑定</span>' : '<span class="danger">未绑定</span>') + '</td>' +
        '<td class="num">' + big(m.power) + '</td>' +
        '<td>' + big(m.strength) + '</td>' +
        '<td class="muted">' + esc((m.formerNames || []).join('、') || '—') + '</td></tr>'
    }
  }
}

var POSITIONS = [
  { key: 'vanguard', label: '先锋', color: '#16a34a' },
  { key: 'marshal', label: '督军', color: '#2563eb' },
  { key: 'guardian', label: '镇国', color: '#d97706' },
  { key: 'apex', label: '巅峰镇国', color: '#dc2626' }
]

function positionOf(score) {
  var s = state.season
  if (!s || score === null || score === undefined) return '<span class="muted">—</span>'
  var i = score < s.vanguardMax ? 0 : score < s.marshalMax ? 1 : score < s.guardianMax ? 2 : 3
  return '<span class="tag" style="color:' + POSITIONS[i].color + '">' + POSITIONS[i].label + '</span>'
}

/** 遗漏排查的勾选条件 */
var missPick = { bonus: true, troops: true, attrs: true }

function rowsForView() {
  var rows = filtered()
  if (state.view === 'missing') {
    rows = rows.filter(function (m) {
      return (missPick.bonus && m.maxBonus == null) ||
        (missPick.troops && !m.troopsComplete) ||
        (missPick.attrs && !m.profileComplete)
    })
  }
  return sortRows(rows, state.sort.key, state.sort.desc)
}

function render() {
  var v = VIEWS[state.view]
  $('viewTitle').textContent = v.title

  var extra = ''
  if (state.view === 'missing') {
    extra = ['bonus', 'troops', 'attrs'].map(function (k) {
      var label = { bonus: '没填集结', troops: '没填兵力', attrs: '没传属性' }[k]
      return '<label class="chk"><input type="checkbox" data-miss="' + k + '"' + (missPick[k] ? ' checked' : '') + ' />' + label + '</label>'
    }).join('')
  }

  var rows = rowsForView()
  var stats = state.view === 'roster' ? statCards() : ''
  $('body').innerHTML = stats +
    '<div class="card"><h4>' + esc(v.title) + '</h4><p class="desc">' + esc(v.desc) + '</p>' +
    toolbar(extra) +
    table(v.cols, rows, function (m, i) { return v.row(m, i) }) +
    '</div>'

  bindBody(rows)
}

function statCards() {
  var all = state.members
  var bound = all.filter(function (m) { return m.boundUid }).length
  var profile = all.filter(function (m) { return m.profileComplete }).length
  var bonus = all.filter(function (m) { return m.maxBonus != null }).length
  var hero = all.filter(function (m) { return m.heroPower != null }).length
  var cells = [
    [all.length, '在册成员'], [bound, '已绑定微信'], [profile, '已传属性'],
    [bonus, '已填集结值'], [hero, '已录武将战力']
  ]
  return '<div class="stats">' + cells.map(function (c) {
    return '<div class="stat"><div class="n">' + c[0] + '</div><div class="l">' + c[1] + '</div></div>'
  }).join('') + '</div>'
}

function bindBody(rows) {
  var kw = $('kw')
  if (kw) {
    kw.oninput = function () {
      state.keyword = kw.value
      var pos = kw.selectionStart
      render()
      var el = $('kw')
      if (el) { el.focus(); el.setSelectionRange(pos, pos) }
    }
  }
  var csv = $('csv')
  if (csv) csv.onclick = function () { exportCsv(rows) }

  Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
    var key = th.getAttribute('data-sort')
    if (!key) return
    th.onclick = function () {
      if (state.sort.key === key) state.sort.desc = !state.sort.desc
      else state.sort = { key: key, desc: true }
      render()
    }
  })

  Array.prototype.forEach.call(document.querySelectorAll('input[data-miss]'), function (box) {
    box.onchange = function () {
      missPick[box.getAttribute('data-miss')] = box.checked
      render()
    }
  })
}

function exportCsv(rows) {
  var v = VIEWS[state.view]
  var head = v.cols.map(function (c) { return c.label })
  var lines = [head.join(',')]
  rows.forEach(function (m, i) {
    // 直接把那一行的 HTML 去掉标签，表格里看到什么就导出什么
    var html = v.row(m, i)
    var cells = html.replace(/<\/tr>\s*$/, '').split(/<td[^>]*>/).slice(1).map(function (c) {
      return '"' + c.replace(/<\/td>.*$/s, '').replace(/<[^>]+>/g, '').replace(/"/g, '""').trim() + '"'
    })
    lines.push(cells.join(','))
  })
  var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  var a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = v.title + '-' + new Date().toISOString().slice(0, 10) + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------- 绑事件 ----------------

Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (el) {
  el.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (x) { x.classList.remove('on') })
    el.classList.add('on')
    state.view = el.getAttribute('data-view')
    state.keyword = ''
    state.sort = state.view === 'season'
      ? { key: 'seasonScore', desc: true }
      : state.view === 'bonus' ? { key: 'maxBonus', desc: true } : { key: 'power', desc: true }
    render()
  }
})

$('refreshQr').onclick = newTicket
$('reload').onclick = load
$('logout').onclick = logout

boot()

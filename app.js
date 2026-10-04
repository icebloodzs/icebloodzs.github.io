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

/**
 * 登录态存哪儿。
 * 优先 localStorage；浏览器禁了本地存储（无痕、第三方数据拦截等）就退回 cookie；
 * 两个都不行就只留在内存里，并且**明确告诉用户刷新后要重扫**，而不是悄悄把人踢回登录页。
 */
var store = {
  how: 'none',
  read: function () {
    try {
      var v = localStorage.getItem(TOKEN_KEY)
      if (v) { this.how = 'local'; return v }
    } catch (e) {}
    var m = String(document.cookie || '').match(new RegExp('(?:^|; )' + TOKEN_KEY + '=([^;]*)'))
    if (m) { this.how = 'cookie'; return decodeURIComponent(m[1]) }
    return ''
  },
  write: function (v) {
    try {
      localStorage.setItem(TOKEN_KEY, v)
      // 写完立刻读一次确认真的存住了（有的浏览器 setItem 不报错但读不回来）
      if (localStorage.getItem(TOKEN_KEY) === v) { this.how = 'local'; return true }
    } catch (e) {}
    try {
      document.cookie = TOKEN_KEY + '=' + encodeURIComponent(v) + '; max-age=604800; path=/; samesite=lax'
      if (String(document.cookie || '').indexOf(TOKEN_KEY + '=') >= 0) { this.how = 'cookie'; return true }
    } catch (e) {}
    this.how = 'none'
    return false
  },
  clear: function () {
    try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
    try { document.cookie = TOKEN_KEY + '=; max-age=0; path=/' } catch (e) {}
  }
}

var token = store.read()

var state = { me: null, members: [], season: null, loginBy: {}, view: 'mine', sort: { key: 'power', desc: true }, keyword: '' }

/** 集结分配：表单参数 + 生成出来的方案，切走再切回来不丢 */
var rally = {
  mode: 'attack', groups: 4, subs: 1, mainBody: 5, subBody: 5, firstBody: 5,
  mainRatio: '5:2:3', subRatio: '5:2:3', probability: 0,
  headBy: 'rally', bodyBy: 'rally', title: '', note: '',
  plan: null, opts: null, busy: false,
  // 手动换人：先点中一个位置，再点另一个就换过去
  sel: ''
}

/** 我的属性：传完截图后拿变化前的值做对比 */
var mine = { before: null, busy: '', msg: '', err: '', form: null, saving: false }

/** 兵力按宫2 / 宫3 两档填 */
var TROOP_LEVELS = ['2', '3']
var TROOP_ARMS = [['inf', '步兵'], ['cav', '骑兵'], ['arc', '弓兵']]

/** 黑土落位：预设 + 排好的格子 */
var place = {
  preset: 'lv7', battle: false, grid: null, assign: null, tray: [], busy: false,
  // 手动调整：sel = 选中的格子；pending = 选中的两格待定（交换还是合并）
  sel: '', pending: null, msg: ''
}

/** 导入名单那一屏的状态；文本留在内存里，切走再切回来不丢 */
var imp = { text: '', markMissingOut: true, busy: false, summary: null, error: '', done: '' }

// ---------------- 调接口 ----------------

var inflight = 0

/** 顶部那条细进度条：只要还有请求没回来就一直显示 */
function busy(delta) {
  inflight = Math.max(0, inflight + delta)
  var bar = $('topbar')
  if (bar) bar.className = inflight > 0 ? 'topbar on' : 'topbar'
}

function call(action, data) {
  busy(1)
  return fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: action, data: data || {}, token: token })
  })
    .then(function (r) { return r.json() })
    .then(function (r) {
      busy(-1)
      if (!r || r.code !== 0) {
        var err = new Error((r && r.message) || '请求失败')
        err.errCode = r && r.errCode
        throw err
      }
      return r.data
    }, function (e) {
      busy(-1)
      throw e
    })
}

function $(id) { return document.getElementById(id) }

/** 同一时间只显示一屏：boot(开机转圈) / login(扫码) / app(主体) */
function screen(which) {
  $('boot').style.display = which === 'boot' ? 'flex' : 'none'
  $('login').style.display = which === 'login' ? 'flex' : 'none'
  if (which === 'app') $('app').classList.add('on')
  else $('app').classList.remove('on')
}

/** 这种错是「这个登录态确实不能用了」，要清掉重扫 */
function fatal(msg) {
  var e = new Error(msg)
  e.fatal = true
  return e
}

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
      $('loginWhy').textContent = ''
      screen('boot')
      var kept = store.write(token)
      $('loginTip').textContent = kept ? '登录成功，正在进入…' : '登录成功（这台浏览器存不住登录态，刷新后要重扫）'
      boot()
    })
    .catch(function () {})
}

function logout() {
  call('web.logout').catch(function () {})
  token = ''
  store.clear()
  location.reload()
}

// ---------------- 启动 ----------------

function boot() {
  if (!token) {
    screen('login')
    newTicket()
    return
  }
  // 有 token 就先转圈，别让登录页先闪一下
  screen('boot')
  call('identity.whoami')
    .then(function (me) {
      if (!me.alliance || !me.alliance.active) throw fatal('这个账号还没加入已激活的同盟')
      if (me.role !== 'admin' && me.role !== 'super') throw fatal('只有管理员能用电脑版')
      state.me = me
      screen('app')
      $('allyName').textContent = me.alliance.name
      $('allySub').textContent = me.alliance.serverNo + ' 区 · ' + me.alliance.season
      $('whoName').textContent = (me.nickname || '管理员') + (me.role === 'super' ? '（超管）' : '') +
        (store.how === 'none' ? ' · 刷新后要重扫' : '')
      return load()
    })
    .catch(function (e) {
      // 服务端明确说这个 token 不认（过期 / 被退掉 / 不是管理员）才清掉重扫；
      // 网络抖一下、接口 500 这种不该把人踢回登录页，给个重试就行
      var dead = e.errCode === 'WEB_UNAUTHED' || e.errCode === 'FORBIDDEN' || e.fatal
      if (!dead) {
        screen('login')
        $('qr').innerHTML = '<div class="qr-mask">连不上服务器<br>点下面重试</div>'
        $('loginTip').textContent = (e.message || '网络不太好') + '（登录态还在，重试就行）'
        $('loginWhy').textContent = '（登录态没动，网络好了点重试就能进）'
        $('refreshQr').textContent = '重试'
        $('refreshQr').onclick = function () { $('refreshQr').textContent = '刷新二维码'; boot() }
        return
      }
      // 把服务端给的原因原样显示出来，不然只看到「重新扫码」没法判断是哪一步出的问题
      var dead_token = token
      token = ''
      store.clear()
      screen('login')
      newTicket()
      $('loginTip').textContent = e.message || '登录已失效，请重新扫码'
      $('loginWhy').textContent = '（上次的登录态被服务器拒了：' + (e.errCode || '未知') +
        '，token ' + dead_token.slice(0, 8) + '…，存在' + (store.how === 'cookie' ? ' cookie' : ' localStorage') + '，已清掉）'
    })
}

function load() {
  $('body').innerHTML = '<div class="card"><div class="empty">读取中…</div></div>'
  return Promise.all([
    call('admin.memberList', { roster: 'in', sort: 'powerDesc', page: 1, pageSize: 200 }),
    call('season.list', {}),
    call('admin.userList', {})
  ]).then(function (res) {
    state.members = res[0].rows
    state.season = res[1].season
    // 最后登录时间在 appUsers 上，按 uid 挂起来给「绑定情况」用
    state.loginBy = {}
    ;(res[2].rows || []).forEach(function (u) { state.loginBy[u.uid] = u.lastLoginAt })
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

/** 具体时间，精确到分钟 */
function when(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  var p2 = function (n) { return (n < 10 ? '0' : '') + n }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
}

/** 多久没更新了：做成小圆标，越久颜色越重，省地方也不换行 */
function ago(iso) {
  if (!iso) return '<span class="tag tag-bad">从未</span>'
  var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  var cls = d >= 7 ? 'tag-bad' : d >= 3 ? 'tag-warn' : 'tag-ok'
  return '<span class="tag ' + cls + '">' + (d <= 0 ? '今天' : d + '天') + '</span>'
}

/** 时间单元格：绝对时间 + 小圆标，强制一行 */
function timeCell(iso, emptyText) {
  if (!iso) return '<td class="nowrap"><span class="tag tag-bad">' + (emptyText || '从未') + '</span></td>'
  return '<td class="nowrap"><span class="when">' + when(iso) + '</span> ' + ago(iso) + '</td>'
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
    attrsUpdatedAt: function (m) { return m.attrsUpdatedAt ? new Date(m.attrsUpdatedAt).getTime() : 0 },
    heroPowerUpdatedAt: function (m) { return m.heroPowerUpdatedAt ? new Date(m.heroPowerUpdatedAt).getTime() : null },
    boundAt: function (m) { return m.boundAt ? new Date(m.boundAt).getTime() : null },
    lastLoginAt: function (m) {
      var t = state.loginBy[m.boundUid]
      return t ? new Date(t).getTime() : null
    }
  }[key]

  // attr.infDef 这种：按六维里的某一项排
  if (!get && key.indexOf('attr.') === 0) {
    var field = key.slice(5)
    get = function (m) {
      var v = m.attrs && m.attrs[field]
      return v === undefined ? null : v
    }
  }
  if (!get) get = function (m) { return m.power }

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
    return '<th class="' + (c.cls || '') + '" data-sort="' + (c.key || '') + '">' + esc(c.label) + arrow + '</th>'
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
    '<button class="btn" id="xlsx">导出 Excel</button>' +
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
        timeCell(m.attrsUpdatedAt, '从未') + '</tr>'
    }
  },

  attrs: {
    title: '属性排名',
    desc: '六维来自成员自己传的「属性加成」截图，服务端识别后入库，填不了也改不了。' +
      '点表头可以按单项排序，最后一列是这份属性是什么时候传的。',
    cols: [
      { key: '', label: '#', cls: 'idx' }, { key: 'name', label: '成员' },
      { key: 'attr.infDef', label: '步防' }, { key: 'attr.infHp', label: '步生' },
      { key: 'attr.cavAtk', label: '骑攻' }, { key: 'attr.cavBreak', label: '骑破' },
      { key: 'attr.arcAtk', label: '弓攻' }, { key: 'attr.arcBreak', label: '弓破' },
      { key: 'attrsSum', label: '六维总和' }, { key: 'attrsUpdatedAt', label: '最后更新' }
    ],
    row: function (m, i) {
      var a = m.attrs || {}
      var cell = function (k) {
        var v = a[k]
        return '<td>' + (v === null || v === undefined ? '<span class="muted">—</span>' : num(v, 2)) + '</td>'
      }
      return '<tr><td class="idx">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(m.name) + '</td>' +
        cell('infDef') + cell('infHp') + cell('cavAtk') + cell('cavBreak') + cell('arcAtk') + cell('arcBreak') +
        '<td class="num">' + num(m.attrsSum, 2) + '</td>' +
        timeCell(m.attrsUpdatedAt, '从未上传') + '</tr>'
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
        timeCell(m.attrsUpdatedAt, '从未') + '</tr>'
    }
  },

  season: {
    title: '赛季评分',
    desc: '评分 = 成员实力 − 武将战力。武将战力只能由成员自己上传截图识别，填不了也改不了。' +
      '最后一列是这次战力是什么时候录的，按它排序能看出谁的分是老数据。',
    cols: [
      { key: 'name', label: '成员' }, { key: 'strength', label: '成员实力' },
      { key: 'heroPower', label: '武将战力' }, { key: 'seasonScore', label: '赛季评分' },
      { key: '', label: '定位' }, { key: '', label: '录入人' },
      { key: 'heroPowerUpdatedAt', label: '更新时间' }
    ],
    row: function (m) {
      return '<tr><td class="name">' + esc(m.name) + '</td>' +
        '<td>' + big(m.strength) + '</td>' +
        '<td class="num">' + (m.heroPower == null ? '<span class="muted">未录入</span>' : big(m.heroPower)) + '</td>' +
        '<td class="num">' + big(m.seasonScore) + '</td>' +
        '<td>' + positionOf(m.seasonScore) + '</td>' +
        '<td class="muted">' + esc(m.heroPowerBy || '—') + '</td>' +
        timeCell(m.heroPowerUpdatedAt, '从未录入') + '</tr>'
    }
  },

  users: {
    title: '绑定情况',
    desc: '谁已经把微信绑到了名单里的成员账号上。没绑的人在小程序里看不到自己的数据。' +
      '最后登录按微信号算，可以看出谁很久没打开过小程序了。',
    cols: [
      { key: 'name', label: '成员' }, { key: '', label: '绑定' },
      { key: 'boundAt', label: '绑定时间' }, { key: 'lastLoginAt', label: '最后登录' },
      { key: 'power', label: '战力' }, { key: 'strength', label: '实力' }, { key: '', label: '曾用名' }
    ],
    row: function (m) {
      var login = state.loginBy[m.boundUid]
      return '<tr><td class="name">' + esc(m.name) + '</td>' +
        '<td>' + (m.boundUid ? '<span class="ok">已绑定</span>' : '<span class="danger">未绑定</span>') + '</td>' +
        (m.boundUid ? timeCell(m.boundAt, '—') : '<td class="muted">—</td>') +
        (m.boundUid ? timeCell(login, '没登录过') : '<td class="muted">—</td>') +
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
  if (state.view === 'import') return renderImport()
  if (state.view === 'rally') return renderRally()
  if (state.view === 'placement') return renderPlacement()
  if (state.view === 'mine') return renderMine()
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
  var xlsx = $('xlsx')
  if (xlsx) xlsx.onclick = function () { exportTableExcel(rows) }

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

/**
 * 当前这屏导成 Excel。
 * 表格里看到什么就导什么：把那一行的 HTML 去掉标签当单元格，再交给云函数生成带样式的 xlsx。
 */
function exportTableExcel(rows) {
  var v = VIEWS[state.view]
  var aoa = [v.cols.map(function (c) { return c.label })]
  rows.forEach(function (m, i) {
    var html = v.row(m, i)
    var cells = html.replace(/<\/tr>\s*$/, '').split(/<td[^>]*>/).slice(1).map(function (c) {
      return c.replace(/<\/td>[\s\S]*$/, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    })
    // 纯数字的单元格转成数字，Excel 里才能直接排序求和
    aoa.push(cells.map(function (x) {
      return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x
    }))
  })

  var head = aoa[0].map(function () { return 0 })
  var body = aoa[0].map(function () { return 1 })
  var btn = $('xlsx')
  if (btn) { btn.disabled = true; btn.textContent = '生成中…' }
  call('files.buildExcel', {
    aoa: aoa,
    cols: aoa[0].map(function (label) { return { wch: Math.max(8, visual(label) + 4) } }),
    styles: [
      { fill: '6C5CE7', color: 'FFFFFF', bold: true, size: 11 },
      { color: '222222', size: 11 }
    ],
    cellStyles: [head].concat(aoa.slice(1).map(function () { return body })),
    sheetName: v.title
  }).then(function (res) {
    var bin = atob(res.base64)
    var buf = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i)
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      v.title + '-' + new Date().toISOString().slice(0, 10) + '.xlsx')
  }).catch(function (e) {
    alert(e.message)
  }).then(function () {
    if (btn) { btn.disabled = false; btn.textContent = '导出 Excel' }
  })
}

/** 中文按两个字符宽算，列宽才不至于挤成一团 */
function visual(s) {
  var n = 0
  String(s).split('').forEach(function (c) { n += c.charCodeAt(0) > 255 ? 2 : 1 })
  return n
}

// ---------------- 导入名单 ----------------

/**
 * 粘游戏里导出的成员列表，先预演再正式导入。
 * 认人、改名、离队、归队这些判断全在云函数里做（和小程序走的是同一个 roster.import），
 * 这边只负责把结果摆出来给人看。
 */
function renderImport() {
  $('viewTitle').textContent = '导入名单'
  var sum = imp.summary

  var html = '<div class="card"><h4>导入同盟名单</h4>' +
    '<p class="desc">在游戏同盟里导出成员列表（含 成员名称/阶级/火炉等级/战力/周功勋/总功勋/周捐献/实力），' +
    '复制后整段粘到下面，<b>保留表头那一行</b>。先点「解析预览」核对，没问题再「确认导入」。</p>' +
    '<textarea id="impText" class="paste" placeholder="每行一名成员，列之间用 Tab 分隔&#10;例如：&#10;1\t草莓招了\t4\t宫阙3级\t999999999\t0\t999999999\t99999\t999999999">' + esc(imp.text) + '</textarea>' +
    '<div class="bar" style="margin-top:14px">' +
    '<label class="chk"><input type="checkbox" id="impMark"' + (imp.markMissingOut ? ' checked' : '') + ' />把名单里消失的人标记为已离队</label>' +
    '<span class="sp"></span>' +
    '<button class="btn" id="impPreview"' + (imp.busy ? ' disabled' : '') + '>' + (imp.busy ? '处理中…' : '🔍 解析预览') + '</button>' +
    '<button class="btn btn-primary" id="impRun"' + (imp.busy || !sum ? ' disabled' : '') + '>💾 确认导入</button>' +
    '</div>'

  if (imp.error) html += '<div class="note note-bad">' + esc(imp.error) + '</div>'
  if (imp.done) html += '<div class="note note-ok">' + esc(imp.done) + '</div>'
  html += '</div>'

  if (sum) html += renderSummary(sum)
  $('body').innerHTML = html
  bindImport()
}

function renderSummary(s) {
  var cells = [
    ['共', s.total, ''], ['新增', s.created, 'ok'], ['更新', s.updated, ''],
    ['认出改名', s.renamed, 'num'], ['归队', s.returned, 'ok'],
    ['不在名单', s.missing, 'warn'], ['疑似改名', s.suspects, 'danger'],
    ['名字易主', s.handover, 'danger'], ['重复', s.duplicates, 'warn']
  ]
  var html = '<div class="card"><h4>' + (s.dryRun ? '预览结果（还没写库）' : '导入完成') + '</h4>' +
    '<div class="stats">' + cells.map(function (c) {
      return '<div class="stat"><div class="n ' + (c[2] || '') + '">' + c[1] + '</div><div class="l">' + c[0] + '</div></div>'
    }).join('') + '</div>'

  if (s.nameOnly) html += '<div class="note">这份只有名字，没有数值列：只会更新在册状态，不动战力功勋这些数据。</div>'
  if (s.truncated) html += '<div class="note note-bad">有 ' + s.truncated + ' 行列数不全（多半是粘贴被截断），已跳过没写进去。</div>'
  if (s.bulkLower) html += '<div class="note note-bad">有 ' + s.dropped + ' 人的总功勋比库里小，这份名单可能是旧的或者赛季重置了。确认导入时会再问你一次。</div>'

  // 疑似改名：拿不准的，给个「合并」按钮让人工定夺
  if (s.suspectList && s.suspectList.length) {
    html += '<div class="note note-bad"><b>疑似改名 ' + s.suspects + ' 人</b>（火炉、实力、战力都相近，但总功勋对不上）。' +
      '确认是同一个人就点「合并」，老记录的绑定和资料会保留；不是同一个人就不用管，' + (s.dryRun ? '正式导入后新名字会作为新人加进去。' : '新名字已经作为新人加进去了。') + '</div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>老名字</th><th>新名字</th><th>火炉</th><th>实力（老 → 新）</th><th>绑定</th><th>操作</th></tr></thead><tbody>' +
      s.suspectList.map(function (x, i) {
        return '<tr><td class="name">' + esc(x.from) + '</td><td class="name">' + esc(x.to) + '</td>' +
          '<td>' + esc(x.furnace || '—') + '</td>' +
          '<td class="muted">' + esc(x.fromStrength) + ' → ' + esc(x.toStrength) + '</td>' +
          '<td>' + (x.bound ? '<span class="ok">已绑</span>' : '<span class="muted">未绑</span>') + '</td>' +
          '<td>' + (x.intoId
            ? '<button class="btn" data-merge="' + i + '">合并成同一人</button>'
            : '<span class="muted">导入后可合并</span>') + '</td></tr>'
      }).join('') + '</tbody></table></div>'
  }

  if (s.renamedList && s.renamedList.length) {
    html += '<div class="note note-ok"><b>认出改名 ' + s.renamed + ' 人</b>，绑定和资料都保留：<br>' +
      s.renamedList.map(function (x) {
        return esc(x.from) + ' → ' + esc(x.to) + '（' + esc(x.how) + (x.bound ? '，已绑定' : '') + '）'
      }).join('<br>') + '</div>'
  }

  if (s.handoverList && s.handoverList.length) {
    html += '<div class="note note-bad"><b>名字换人了 ' + s.handover + ' 个</b>（同名但总功勋对不上，多半是老号退了新号用了同一个名字）：<br>' +
      s.handoverList.map(function (x) {
        return esc(x.name) + '：总功勋 ' + esc(x.fromTotal) + ' → ' + esc(x.toTotal) + (x.bound ? '（老号已绑定微信，要手动处理）' : '')
      }).join('<br>') + '</div>'
  }

  if (s.returnedNames && s.returnedNames.length) {
    html += '<div class="note note-ok"><b>归队 ' + s.returned + ' 人</b>（之前标过离队，这次又在名单里）：' + esc(s.returnedNames.join('、')) + '</div>'
  }
  if (s.createdNames && s.createdNames.length) {
    html += '<div class="note"><b>新增 ' + s.created + ' 人</b>：' + esc(s.createdNames.join('、')) + '</div>'
  }
  if (s.missingNames && s.missingNames.length) {
    html += '<div class="note note-warn"><b>不在这份名单里的 ' + s.missing + ' 人</b>' +
      (s.markMissingOut ? '（会标记为已离队，资料和绑定都留着）' : '（本次不标记，保持原样）') + '：' +
      esc(s.missingNames.join('、')) + '</div>'
  }
  if (s.duplicateNames && s.duplicateNames.length) {
    html += '<div class="note note-warn"><b>名单里重复 ' + s.duplicates + ' 个</b>，只取了第一条：' + esc(s.duplicateNames.join('、')) + '</div>'
  }

  return html + '</div>'
}

function bindImport() {
  var ta = $('impText')
  if (ta) ta.oninput = function () { imp.text = ta.value }
  var mark = $('impMark')
  if (mark) mark.onchange = function () { imp.markMissingOut = mark.checked }
  var prev = $('impPreview')
  if (prev) prev.onclick = function () { runImport(true) }
  var run = $('impRun')
  if (run) run.onclick = function () { runImport(false) }

  Array.prototype.forEach.call(document.querySelectorAll('button[data-merge]'), function (btn) {
    btn.onclick = function () {
      var x = imp.summary.suspectList[Number(btn.getAttribute('data-merge'))]
      if (!x || !x.intoId) return
      if (!confirm('确认「' + x.from + '」和「' + x.to + '」是同一个人？\n合并后保留老记录的绑定和资料，名字和名单数据用新的。')) return
      btn.disabled = true
      call('admin.mergeMembers', { fromId: x.memberId, intoId: x.intoId })
        .then(function () {
          x.intoId = null
          imp.done = '已合并「' + x.from + '」→「' + x.to + '」'
          renderImport()
          load()
        })
        .catch(function (e) {
          btn.disabled = false
          alert(e.message)
        })
    }
  })
}

function runImport(dryRun) {
  if (imp.busy) return
  if (!imp.text.trim()) { imp.error = '先把名单粘进来'; return renderImport() }

  var payload = { text: imp.text, markMissingOut: imp.markMissingOut, dryRun: dryRun }
  // 大面积功勋变小时云函数会拦一次，预览过了再让用户点头
  if (!dryRun && imp.summary && imp.summary.bulkLower) {
    if (!confirm('有 ' + imp.summary.dropped + ' 人的总功勋比库里小，这份名单可能是旧的或者赛季重置了。\n确定要用它覆盖吗？')) return
    payload.acceptLower = true
  }
  if (!dryRun && !confirm('确认把这份名单写进库？' + (imp.markMissingOut ? '\n名单里没有的人会被标记为已离队。' : ''))) return

  imp.busy = true
  imp.error = ''
  imp.done = ''
  renderImport()
  call('roster.import', payload)
    .then(function (res) {
      imp.summary = res
      imp.busy = false
      if (!dryRun) {
        imp.done = '导入完成：新增 ' + res.created + ' · 更新 ' + res.updated + ' · 改名 ' + res.renamed + ' · 离队 ' + (res.markMissingOut ? res.missing : 0)
        imp.text = ''
        load()
      }
      renderImport()
    })
    .catch(function (e) {
      imp.busy = false
      imp.summary = null
      imp.error = e.message
      renderImport()
    })
}

// ---------------- 集结分配 ----------------

/** 下拉框，省得每个表单项都写一遍 */
function sel(id, value, options) {
  return '<select id="' + id + '">' + options.map(function (o) {
    return '<option value="' + o[0] + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'
  }).join('') + '</select>'
}

function numInput(id, value, min, max) {
  return '<input type="number" id="' + id + '" value="' + value + '" min="' + min + '" max="' + max + '" style="width:72px" />'
}

function renderRally() {
  $('viewTitle').textContent = '集结分配'
  var attack = rally.mode === 'attack'
  var html = '<div class="card"><h4>集结分配</h4>' +
    '<p class="desc">车头按集结值（或六维）从高到低挑，车身按你选的排法依次填。' +
    '算的是和小程序同一套逻辑（<code>utils/rally.js</code> 原样拿过来的），两边结果一致。</p>' +
    '<div class="form">' +
    '<label>模式 ' + sel('rMode', rally.mode, [['attack', '攻城'], ['defense', '守城']]) + '</label>' +
    '<label>组数 ' + numInput('rGroups', rally.groups, 1, 8) + '</label>' +
    (attack
      ? '<label>每组副车 ' + numInput('rSubs', rally.subs, 0, 5) + '</label>' +
        '<label>主车车身 ' + numInput('rMainBody', rally.mainBody, 0, 20) + '</label>' +
        '<label>副车车身 ' + numInput('rSubBody', rally.subBody, 0, 20) + '</label>' +
        '<label>概率车 ' + numInput('rProb', rally.probability, 0, 8) + '</label>'
      : '<label>第一组车身 ' + numInput('rFirstBody', rally.firstBody, 0, 30) + '</label>') +
    '<label>车头依据 ' + sel('rHeadBy', rally.headBy, [['rally', '集结值'], ['attrs', '六维总和']]) + '</label>' +
    '<label>车身排法 ' + sel('rBodyBy', rally.bodyBy, Rally.BODY_MODES.map(function (m) { return [m.key, m.label] })) + '</label>' +
    '<label>标题 <input type="text" id="rTitle" value="' + esc(rally.title) + '" placeholder="' + (attack ? '攻城集结分配' : '守城集结分配') + '" style="width:180px" /></label>' +
    '</div>' +
    '<div class="bar" style="margin-top:14px">' +
    '<span class="muted">参与人数 ' + state.members.length + '（在册成员）</span><span class="sp"></span>' +
    '<button class="btn btn-primary" id="rGo">生成</button>' +
    (rally.plan ? '<button class="btn" id="rXlsx"' + (rally.busy ? ' disabled' : '') + '>' + (rally.busy ? '生成中…' : '导出 Excel') + '</button>' : '') +
    '</div></div>'

  if (rally.plan) html += renderPlanTable()
  $('body').innerHTML = html
  bindRally()
}

/**
 * 方案表：每格都带 data-seat（车头是 "车号:h"、车身是 "车号:位次"、替补是 "b:序号"），
 * 点一个再点另一个就换位置，和小程序里那套一样。
 */
function renderPlanTable() {
  var plan = rally.plan
  var metric = Rally.METRICS[Rally.displayKeyOf(rally.opts.bodyBy)]
  var val = function (m) { return m ? metric.fmt(metric.get(m)) : '' }
  var groupCount = Math.max.apply(null, plan.cars.map(function (c) { return c.group + 1 }).concat([1]))

  var seat = function (key, m, cls) {
    var on = rally.sel === key ? ' seat-on' : ''
    return '<td class="seat ' + (cls || '') + (m ? '' : ' seat-empty') + on + '" data-seat="' + key + '">' +
      (m ? esc(m.name) : '<span class="muted">空位</span>') + '</td>' +
      '<td class="seat-v ' + (cls || '') + on + '" data-seat="' + key + '">' + esc(val(m)) + '</td>'
  }

  // 每组一列，列内自上而下堆这一组的车
  var cols = []
  for (var g = 0; g < groupCount; g += 1) {
    var color = Rally.GROUP_COLORS[g % Rally.GROUP_COLORS.length]
    var rows = []
    plan.cars.forEach(function (car, ci) {
      if (car.group !== g) return
      if (plan.mode === 'defense') {
        rows.push('<td colspan="2" class="cell-title" style="background:' + color.main + '">' +
          (car.head ? esc(car.head.name) : '（车头待定）') + '<span class="cell-val">' + esc(val(car.head)) + '</span></td>')
        rows.push('<td colspan="2" class="cell-label" style="background:' + color.light + '">车身<span class="cell-val">' + metric.label + '</span></td>')
      } else {
        rows.push('<td colspan="2" class="cell-title" style="background:' + (car.tier === 'prob' ? '#f08a24' : color.main) + '">' +
          esc(Rally.carTitle ? Rally.carTitle(car) : '车') + '<span class="cell-val">' + metric.label + '</span></td>')
        rows.push(seat(ci + ':h', car.head, 'cell-head').replace(/style="[^"]*"/g, '') )
      }
      car.bodies.forEach(function (m, bi) { rows.push(seat(ci + ':' + bi, m, 'cell-body')) })
    })
    cols.push({ color: color, rows: rows })
  }

  var height = Math.max.apply(null, cols.map(function (c) { return c.rows.length }).concat([0]))
  var head = cols.map(function (c, i) {
    return '<th colspan="2" style="background:' + c.color.main + '">' + Rally.GROUP_NAMES[i] + '组</th>'
  }).join('')
  var body = ''
  for (var r = 0; r < height; r += 1) {
    body += '<tr>' + cols.map(function (c) {
      var cell = c.rows[r]
      if (!cell) return '<td colspan="2"></td>'
      // 给车身 / 车头格补上本组底色
      return cell.indexOf('cell-title') >= 0 || cell.indexOf('cell-label') >= 0
        ? cell
        : cell.replace(/class="(seat|seat-v)([^"]*)"/g, 'class="$1$2" style="background:' + c.color.light + '"')
    }).join('') + '</tr>'
  }

  var bench = (plan.bench || []).filter(Boolean)
  var benchHtml = ''
  if (bench.length || rally.sel) {
    benchHtml = '<div class="bench"><span class="bench-t">替补 ' + bench.length + '</span>' +
      bench.map(function (m, i) {
        return '<span class="chip seat' + (rally.sel === 'b:' + i ? ' seat-on' : '') + '" data-seat="b:' + i + '">' + esc(m.name) + '</span>'
      }).join('') +
      (bench.length ? '' : '<span class="muted">（空）</span>') + '</div>'
  }

  return '<div class="card"><h4>' + esc(rally.opts.title) + '</h4>' +
    '<div class="hint">' + (rally.sel
      ? '已选中 <b>' + esc(seatName(rally.sel)) + '</b>，再点另一个位置就对调；点它自己或按 Esc 取消'
      : '点一个人，再点另一个位置即可对调（空位也能点，等于把人挪过去）') + '</div>' +
    '<div class="tbl-wrap"><table class="plan"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    benchHtml + '</div>'
}

/** 某个位置上是谁，用来写提示 */
function seatName(key) {
  var p = String(key).split(':')
  if (p[0] === 'b') {
    var m = (rally.plan.bench || [])[Number(p[1])]
    return m ? m.name : '替补空位'
  }
  var car = rally.plan.cars[Number(p[0])]
  if (!car) return '空位'
  var who = p[1] === 'h' ? car.head : car.bodies[Number(p[1])]
  return who ? who.name : '空位'
}

function rallyOpts() {
  return {
    groups: rally.groups, subs: rally.subs, mainBody: rally.mainBody, subBody: rally.subBody,
    mainRatio: rally.mainRatio, subRatio: rally.subRatio, probability: rally.probability,
    firstBody: rally.firstBody, headBy: rally.headBy, bodyBy: rally.bodyBy,
    title: rally.title || (rally.mode === 'attack' ? '攻城集结分配' : '守城集结分配'),
    note: rally.note
  }
}

function bindRally() {
  var bind = function (id, key, isNum) {
    var el = $(id)
    if (!el) return
    el.onchange = function () {
      rally[key] = isNum ? Math.max(0, Number(el.value) || 0) : el.value
      renderRally()
    }
  }
  bind('rMode', 'mode'); bind('rHeadBy', 'headBy'); bind('rBodyBy', 'bodyBy')
  bind('rGroups', 'groups', true); bind('rSubs', 'subs', true); bind('rMainBody', 'mainBody', true)
  bind('rSubBody', 'subBody', true); bind('rFirstBody', 'firstBody', true); bind('rProb', 'probability', true)
  var t = $('rTitle')
  if (t) t.oninput = function () { rally.title = t.value }

  var go = $('rGo')
  if (go) go.onclick = function () {
    var opts = rallyOpts()
    rally.opts = opts
    rally.plan = rally.mode === 'attack'
      ? Rally.generateAttack(state.members, opts)
      : Rally.generateDefense(state.members, opts)
    rally.sel = ''
    renderRally()
  }

  var xlsx = $('rXlsx')
  if (xlsx) xlsx.onclick = exportRallyExcel

  // 点两下换位置
  Array.prototype.forEach.call(document.querySelectorAll('[data-seat]'), function (td) {
    td.onclick = function () {
      var key = td.getAttribute('data-seat')
      if (!rally.sel) {
        if (seatName(key) === '空位' || seatName(key) === '替补空位') return
        rally.sel = key
      } else if (rally.sel === key) {
        rally.sel = ''
      } else {
        rally.plan = Rally.swapSeats(rally.plan, rally.sel, key)
        rally.sel = ''
      }
      renderRally()
    }
  })
}

/** Excel 由云函数生成（带颜色），回来的是 base64，这边转成文件下载 */
function exportRallyExcel() {
  if (rally.busy || !rally.plan) return
  rally.busy = true
  renderRally()
  var layout = Rally.buildLayout(rally.plan, rally.opts)
  var sheet = Rally.layoutToSheet(layout)
  call('files.buildExcel', {
    aoa: sheet.aoa, merges: sheet.merges, cols: sheet.cols, rows: sheet.rows,
    styles: sheet.styles, cellStyles: sheet.cellStyles,
    sheetName: rally.mode === 'attack' ? '攻城表' : '守城表'
  }).then(function (res) {
    var bin = atob(res.base64)
    var buf = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i)
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      (layout.title || '集结分配').replace(/[\\/:*?"<>|【】\s]/g, '') + '.xlsx')
  }).catch(function (e) {
    alert(e.message)
  }).then(function () {
    rally.busy = false
    renderRally()
  })
}

function download(blob, name) {
  var a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------- 黑土落位 ----------------

function renderPlacement() {
  $('viewTitle').textContent = '黑土落位'
  var g = place.grid
  var html = '<div class="card"><h4>黑土落位</h4>' +
    '<p class="desc">按成员实力从高到低、由内圈往外圈排。人比格子多时，最强的格子配一个最弱的（强带弱），再多的进待分配。' +
    '算法同样是小程序那份 <code>utils/placement.js</code> 原样拿过来的。</p>' +
    '<div class="form">' +
    '<label>城池 ' + sel('pPreset', place.preset, Placement.PRESETS.map(function (p) { return [p.key, p.label] })) + '</label>' +
    '<label class="chk"><input type="checkbox" id="pBattle"' + (place.battle ? ' checked' : '') + ' />留出斗阵位</label>' +
    '</div>' +
    '<div class="bar" style="margin-top:14px">' +
    '<span class="muted">在册成员 ' + state.members.length + ' 人</span><span class="sp"></span>' +
    '<button class="btn btn-primary" id="pGo">生成</button>' +
    (g ? '<button class="btn" id="pPng">下载图片</button>' : '') +
    '</div>'

  if (g) {
    html += '<div class="note">' + g.city + '×' + g.city + ' 城池 · 黑土上 ' + g.up + ' 圈 / 下 ' + g.down + ' 圈 · ' +
      '黑土 ' + g.blackCount + ' 格、白土 ' + g.whiteCount + ' 格' +
      (place.tray.length ? ' · <b class="warn">待分配 ' + place.tray.length + ' 人</b>：' + esc(place.tray.join('、')) : '') + '</div>'
    html += '<div class="hint">' + placeHint() + '</div>'
    if (place.msg) html += '<div class="note note-ok">' + esc(place.msg) + '</div>'
  }
  html += '</div>'

  if (g) html += '<div class="card"><div id="mapWrap" class="map-wrap"></div></div>'
  $('body').innerHTML = html
  if (g) drawPlacement()
  bindPlacement()
}

/** 顶上那行操作提示，按当前选中状态变 */
function placeHint() {
  var key = function (k) { return '<kbd>' + k + '</kbd>' }
  if (place.pending) {
    var a = (place.assign[place.pending.from] || []).join(' / ')
    var b = (place.assign[place.pending.to] || []).join(' / ')
    return '把 <b>' + esc(a) + '</b> 和 <b>' + esc(b) + '</b> 怎么处理？' +
      '<button class="btn btn-sm" data-act="swap">交换 ' + key('E') + '</button>' +
      '<button class="btn btn-sm" data-act="merge">合并到一格 ' + key('W') + '</button>' +
      '<button class="btn btn-sm" data-act="cancel">取消 ' + key('Esc') + '</button>' +
      '<span class="muted">两人一格的不能再合</span>'
  }
  if (place.sel) {
    var names = place.assign[place.sel] || []
    return '已选中 <b>' + esc(names.join(' / ')) + '</b>：再点一个格子——空格就挪过去，有人就问你换还是合。' +
      (names.length > 1
        ? '<button class="btn btn-sm" data-act="split">拆成两格 ' + key('S') + '</button>'
        : '') +
      '<button class="btn btn-sm" data-act="cancel">取消 ' + key('Esc') + '</button>'
  }
  return '点一个有人的格子，再点另一个格子即可<b>移动 / 交换 / 合并</b>；两个人一格的可以<b>拆开</b>。' +
    '<span class="muted">快捷键：' + key('E') + ' 交换 · ' + key('W') + ' 合并 · ' + key('S') + ' 拆开 · ' + key('Esc') + ' 取消</span>'
}

/** 画菱形：每格一个旋转 45° 的方块，名字正着写 */
function drawPlacement() {
  var g = place.grid
  var D = g.size > 20 ? 54 : 76
  var span = g.size * D
  var wrap = $('mapWrap')
  var parts = ['<svg width="' + span + '" height="' + span + '" viewBox="0 0 ' + span + ' ' + span + '" class="map">']
  g.cells.forEach(function (cell) {
    var ctr = Placement.cellCenter(cell.r, cell.c, g.size, D)
    if (cell.kind === 'city' || cell.kind === 'battle') return
    var color = Placement.ringColor(cell.ring, cell.soil)
    var names = (place.assign[cell.id] || [])
    var on = place.sel === cell.id || (place.pending && (place.pending.from === cell.id || place.pending.to === cell.id))
    parts.push('<g class="cellbox" data-cell="' + cell.id + '" transform="translate(' + ctr.x + ',' + ctr.y + ') rotate(45)">' +
      '<rect x="' + (-D / 2.83) + '" y="' + (-D / 2.83) + '" width="' + (D / 1.414) + '" height="' + (D / 1.414) + '" rx="3" fill="' +
      (on ? '#ffe9a8' : color.fill) + '" stroke="' + (on ? '#e0a800' : color.stroke) + '" stroke-width="' + (on ? 3 : 1.5) + '"/></g>')
    names.forEach(function (n, i) {
      parts.push('<text class="cellbox" data-cell="' + cell.id + '" x="' + ctr.x + '" y="' + (ctr.y + (names.length === 2 ? (i === 0 ? -5 : 9) : 4)) + '" text-anchor="middle" font-size="' + (names.length === 2 ? 10 : 11) + '" fill="#1f2329">' + esc(Placement.clip(n, names.length === 2 ? 5 : 6)) + '</text>')
    })
  })
  // 城池：一整块
  var c0 = Placement.cellCenter(g.lo, g.lo, g.size, D)
  var c1 = Placement.cellCenter(g.hi, g.hi, g.size, D)
  var cx = (c0.x + c1.x) / 2
  var cy = (c0.y + c1.y) / 2
  var cd = g.city * D
  parts.push('<g transform="translate(' + cx + ',' + cy + ') rotate(45)">' +
    '<rect x="' + (-cd / 2.83) + '" y="' + (-cd / 2.83) + '" width="' + (cd / 1.414) + '" height="' + (cd / 1.414) + '" rx="6" fill="#e8a33d" stroke="#b5651d" stroke-width="3"/></g>' +
    '<text x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" font-size="' + Math.round(cd * 0.16) + '" font-weight="700" fill="#7c2d12">城池</text>')
  parts.push('</svg>')
  wrap.innerHTML = parts.join('')
}

function bindPlacement() {
  var p = $('pPreset')
  if (p) p.onchange = function () { place.preset = p.value; place.grid = null; renderPlacement() }
  var b = $('pBattle')
  if (b) b.onchange = function () { place.battle = b.checked; place.grid = null; renderPlacement() }

  var go = $('pGo')
  if (go) go.onclick = function () {
    var preset = Placement.PRESETS.filter(function (x) { return x.key === place.preset })[0]
    var grid = Placement.buildGrid({ city: preset.city, up: preset.up, down: preset.down, battle: place.battle })
    // 按实力从高到低，和小程序一致
    var names = state.members.slice().sort(function (a, b2) { return (b2.strength || 0) - (a.strength || 0) }).map(function (m) { return m.name })
    var made = Placement.autoUnits(names, grid.order.length)
    var res = Placement.fill(grid.order, made.units)
    place.grid = grid
    place.assign = res.assign
    place.tray = (made.tray || []).concat(res.rest || [])
    place.sel = ''
    place.pending = null
    place.msg = ''
    renderPlacement()
  }

  var png = $('pPng')
  if (png) png.onclick = downloadPlacementPng

  // 格子点击：选 → 再选 → 移动 / 问换还是合
  Array.prototype.forEach.call(document.querySelectorAll('[data-cell]'), function (node) {
    node.onclick = function () {
      if (place.pending) return
      var id = node.getAttribute('data-cell')
      var has = (place.assign[id] || []).length
      place.msg = ''
      if (!place.sel) {
        if (!has) return
        place.sel = id
      } else if (place.sel === id) {
        place.sel = ''
      } else if (!has) {
        var moved = Placement.drop(place.assign, place.sel, id, 'swap')
        place.assign = moved.assign
        place.sel = ''
      } else {
        place.pending = { from: place.sel, to: id }
        place.sel = ''
      }
      renderPlacement()
    }
  })

  // 操作条上的按钮
  Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (btn) {
    btn.onclick = function () { placeAct(btn.getAttribute('data-act')) }
  })
}

/** 交换 / 合并 / 拆开 / 取消：按钮和快捷键共用这一处 */
function placeAct(act) {
  if (!place.grid) return
  if (act === 'cancel') {
    place.sel = ''
    place.pending = null
  } else if (act === 'split') {
    if (!place.sel || (place.assign[place.sel] || []).length < 2) return
    var r = Placement.split(place.grid.order, place.assign, place.sel)
    place.assign = r.assign
    if (r.toTray) {
      place.tray = place.tray.concat([r.toTray])
      place.msg = '没有空格了，' + r.toTray + ' 放进了待分配'
    } else {
      place.msg = '已拆开'
    }
    place.sel = ''
  } else if (place.pending && (act === 'swap' || act === 'merge')) {
    var res = Placement.drop(place.assign, place.pending.from, place.pending.to, act)
    if (res.error) place.msg = res.error
    else {
      place.assign = res.assign
      place.msg = act === 'merge' ? '已合并到一格' : '已交换'
    }
    place.pending = null
  } else {
    return
  }
  renderPlacement()
}

/**
 * 黑土落位的快捷键：E 交换、W 合并、S 拆开、Esc 取消。
 * 只在落位那一屏生效，而且在输入框里打字时不抢键。
 */
function onKey(e) {
  if (state.view !== 'placement') return
  var t = e.target || {}
  var tag = String(t.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  var act = { e: 'swap', w: 'merge', s: 'split', escape: 'cancel' }[String(e.key || '').toLowerCase()]
  if (!act) return
  e.preventDefault()
  placeAct(act)
}

/** SVG 转 PNG：画到 canvas 再导出，不用额外依赖 */
function downloadPlacementPng() {
  var svg = $('mapWrap').innerHTML
  var blob = new Blob(['<?xml version="1.0"?>' + svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')], { type: 'image/svg+xml;charset=utf-8' })
  var url = URL.createObjectURL(blob)
  var img = new Image()
  img.onload = function () {
    var canvas = document.createElement('canvas')
    canvas.width = img.width * 2
    canvas.height = img.height * 2
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob(function (b) { download(b, '黑土落位.png') })
  }
  img.onerror = function () { URL.revokeObjectURL(url); alert('导出失败，可以直接截图') }
  img.src = url
}

// ---------------- 我的属性 ----------------

/** 库里只存这六项（属性面板 13 行里挑出来的），按兵种分组显示 */
var MY_ATTRS = [
  { arm: '步兵', items: [['infDef', '防御力'], ['infHp', '生命值']] },
  { arm: '骑兵', items: [['cavAtk', '攻击力'], ['cavBreak', '破坏力']] },
  { arm: '弓兵', items: [['arcAtk', '攻击力'], ['arcBreak', '破坏力']] }
]

function renderMine() {
  $('viewTitle').textContent = '我的信息'
  var me = state.me || {}
  var m = me.member

  if (!m) {
    $('body').innerHTML = '<div class="card"><h4>我的信息</h4>' +
      '<p class="desc">你的微信还没绑定名单里的成员账号，先在小程序里「去绑定」，绑完这里就能传截图了。</p></div>'
    return
  }

  var a = m.attrs || {}
  var html = '<div class="card"><h4>我的属性 · ' + esc(m.name) + '</h4>' +
    '<p class="desc">数值只认截图识别的结果，这里也填不了、改不了。传一张游戏里的「属性加成」面板截图就会自动识别入库，' +
    '和在小程序里传是同一回事。</p>' +
    '<div class="arms">' +
    MY_ATTRS.map(function (g) {
      return '<div class="arm"><div class="arm-t">' + g.arm + '</div>' +
        g.items.map(function (it) {
          var v = a[it[0]]
          return '<div class="arm-row"><span>' + it[1] + '</span><b>' +
            (v === null || v === undefined ? '<span class="muted">未录入</span>' : num(v, 2) + '%') + '</b></div>'
        }).join('') + '</div>'
    }).join('') +
    '</div>' +
    '<div class="sum-bar"><span>六维总和 <b class="num">' + num(m.attrsSum, 2) + '</b></span>' +
    '<span>最后更新 <b>' + (m.attrsUpdatedAt ? when(m.attrsUpdatedAt) : '从未上传') + '</b></span></div>' +
    '<div class="bar" style="margin-top:16px"><span class="sp"></span>' +
    '<label class="btn btn-primary' + (mine.busy ? ' disabled' : '') + '">' +
    (mine.busy === 'attrs' ? '识别中…' : '上传属性截图') +
    '<input type="file" accept="image/*" id="shotAttrs" hidden /></label></div>' +
    '</div>'

  // 赛季评分
  var season = state.season || {}
  html += '<div class="card"><h4>赛季评分 · ' + esc(season.label || '') + '</h4>' +
    '<p class="desc">评分 = 成员实力 − 武将战力。武将战力同样只能靠截图识别，传战力面板截图即可。</p>' +
    '<div class="sum-bar">' +
    '<span>成员实力 <b>' + big(m.strength) + '</b></span>' +
    '<span>武将战力 <b class="num">' + (m.heroPower == null ? '未录入' : big(m.heroPower)) + '</b></span>' +
    '<span>赛季评分 <b class="num">' + big(m.seasonScore) + '</b></span>' +
    '<span>定位 ' + positionOf(m.seasonScore) + '</span>' +
    '<span>最后更新 <b>' + (m.heroPowerUpdatedAt ? when(m.heroPowerUpdatedAt) : '从未上传') + '</b></span>' +
    '</div>' +
    '<div class="bar" style="margin-top:16px"><span class="sp"></span>' +
    '<label class="btn btn-primary' + (mine.busy ? ' disabled' : '') + '">' +
    (mine.busy === 'hero' ? '识别中…' : '上传战力截图') +
    '<input type="file" accept="image/*" id="shotHero" hidden /></label></div>' +
    '</div>'

  // 可以手填的几项：集结值、单人出征、两档兵力
  var f = mine.form || (mine.form = formFrom(m))
  html += '<div class="card"><h4>集结与兵力</h4>' +
    '<p class="desc">这几项游戏里没有现成截图，手填。集结值和单人出征说的是<b>同一队</b>——你集结值最高的那一队，' +
    '以及这一队能带多少兵。兵力按兵营等级分两档填，只有一种就只填那一行。</p>' +
    '<div class="form">' +
    '<label>最高集结值 <input type="number" step="0.01" id="fBonus" value="' + esc(f.maxBonus) + '" style="width:110px" />%</label>' +
    '<label>单人出征数量 <input type="number" id="fMarch" value="' + esc(f.maxMarch) + '" style="width:130px" placeholder="如 143510" /></label>' +
    '</div>' +
    '<div class="tbl-wrap" style="margin-top:14px"><table class="troops"><thead><tr>' +
    '<th></th>' + TROOP_ARMS.map(function (a) { return '<th>' + a[1] + '</th>' }).join('') + '<th>小计</th></tr></thead><tbody>' +
    TROOP_LEVELS.map(function (lv) {
      return '<tr><td class="lv">宫' + lv + '</td>' +
        TROOP_ARMS.map(function (a) {
          return '<td><input type="number" step="0.1" class="tin" data-lv="' + lv + '" data-arm="' + a[0] + '" value="' + esc(f.troops[lv][a[0]]) + '" placeholder="-" /></td>'
        }).join('') +
        '<td class="num">' + fmtSum(levelSum(f, lv)) + '</td></tr>'
    }).join('') +
    '</tbody></table></div>' +
    '<div class="sum-bar"><span>两档合计 <b class="num">' + fmtSum(allSum(f)) + '</b> 万</span>' +
    '<span class="muted">单位：万，可以填小数</span></div>' +
    '<div class="bar" style="margin-top:14px"><span class="sp"></span>' +
    '<button class="btn btn-primary" id="fSave"' + (mine.saving ? ' disabled' : '') + '>' + (mine.saving ? '保存中…' : '保存') + '</button></div>' +
    '</div>'

  if (mine.err) html += '<div class="card"><div class="note note-bad">' + esc(mine.err) + '</div></div>'
  if (mine.msg) html += '<div class="card"><div class="note note-ok">' + esc(mine.msg) + '</div></div>'
  if (mine.before) html += renderDiff(mine.before, m)

  $('body').innerHTML = html
  bindMine()
}

/** 传完之后对比一下这次和上次的差值 */
function renderDiff(before, now) {
  var oldA = before.attrs || {}
  var newA = now.attrs || {}
  var rows = MY_ATTRS.map(function (g) {
    return '<div class="arm arm-diff"><div class="arm-t">' + g.arm + '</div>' +
      g.items.map(function (it) {
        var o = oldA[it[0]]
        var n = newA[it[0]]
        if (o === null || o === undefined || n === null || n === undefined) {
          return '<div class="arm-row"><span>' + it[1] + '</span><b>' + (n == null ? '—' : num(n, 2) + '%') + '</b></div>'
        }
        var d = Number(n) - Number(o)
        var cls = d > 0 ? 'ok' : d < 0 ? 'danger' : 'muted'
        return '<div class="arm-row"><span>' + it[1] + '</span>' +
          '<b><span class="muted">' + num(o, 2) + '%</span> → ' + num(n, 2) + '%' +
          ' <span class="' + cls + '">(' + (d > 0 ? '+' : '') + d.toFixed(2) + ')</span></b></div>'
      }).join('') + '</div>'
  }).join('')

  var od = before.attrsSum
  var nd = now.attrsSum
  var ds = (od != null && nd != null) ? (Number(nd) - Number(od)) : null
  return '<div class="card"><h4>和上次比</h4><div class="arms">' + rows + '</div>' +
    (ds === null ? '' : '<div class="sum-bar"><span>六维总和 <span class="muted">' + num(od, 2) + '</span> → <b class="num">' + num(nd, 2) + '</b> ' +
      '<span class="' + (ds > 0 ? 'ok' : ds < 0 ? 'danger' : 'muted') + '">(' + (ds > 0 ? '+' : '') + ds.toFixed(2) + ')</span></span></div>') +
    '</div>'
}

/** 把成员数据摊成表单用的字符串 */
function formFrom(m) {
  var t = {}
  TROOP_LEVELS.forEach(function (lv) {
    t[lv] = {}
    TROOP_ARMS.forEach(function (a) {
      var v = m.troopsByLevel && m.troopsByLevel[lv] ? m.troopsByLevel[lv][a[0]] : null
      t[lv][a[0]] = v === null || v === undefined ? '' : String(v)
    })
  })
  return {
    maxBonus: m.maxBonus === null || m.maxBonus === undefined ? '' : String(m.maxBonus),
    maxMarch: m.maxMarch === null || m.maxMarch === undefined ? '' : String(m.maxMarch),
    troops: t
  }
}

function levelSum(f, lv) {
  var s = null
  TROOP_ARMS.forEach(function (a) {
    var raw = String(f.troops[lv][a[0]] || '').trim()
    if (!raw) return
    var n = Number(raw)
    if (isFinite(n)) s = (s || 0) + n
  })
  return s
}

function allSum(f) {
  var s = null
  TROOP_LEVELS.forEach(function (lv) {
    var one = levelSum(f, lv)
    if (one !== null) s = (s || 0) + one
  })
  return s
}

var fmtSum = function (v) { return v === null ? '—' : String(Math.round(v * 10) / 10) }

function bindMine() {
  var hook = function (id, kind) {
    var el = $(id)
    if (!el) return
    el.onchange = function () {
      var f = el.files && el.files[0]
      if (f) uploadShot(f, kind)
      el.value = ''
    }
  }
  hook('shotAttrs', 'attrs')
  hook('shotHero', 'hero')

  var f = mine.form
  if (!f) return
  var bonus = $('fBonus')
  if (bonus) bonus.oninput = function () { f.maxBonus = bonus.value }
  var march = $('fMarch')
  if (march) march.oninput = function () { f.maxMarch = march.value }
  Array.prototype.forEach.call(document.querySelectorAll('.tin'), function (el) {
    el.oninput = function () {
      f.troops[el.getAttribute('data-lv')][el.getAttribute('data-arm')] = el.value
      // 只刷小计，别整屏重画，不然输入框会失焦
      var row = el.parentNode && el.parentNode.parentNode
      if (row && row.lastChild) row.lastChild.textContent = fmtSum(levelSum(f, el.getAttribute('data-lv')))
    }
  })
  var save = $('fSave')
  if (save) save.onclick = saveMine
}

/** 保存手填的几项；六维和武将战力不在这里，它们只认截图 */
function saveMine() {
  if (mine.saving) return
  var f = mine.form
  var march = String(f.maxMarch || '').replace(/[,\s]/g, '')
  if (march && !/^\d+$/.test(march)) {
    mine.err = '单人出征数量请填完整数字，例如 143510'
    return renderMine()
  }
  mine.saving = true
  mine.err = ''
  mine.msg = ''
  renderMine()
  call('profile.save', {
    troopsByLevel: f.troops,
    camps: (state.me.member && state.me.member.camps) || [],
    maxBonus: f.maxBonus,
    battleReportFileId: state.me.member && state.me.member.battleReportFileId,
    maxMarch: march
  }).then(function (res) {
    state.me.member = res.member
    mine.form = formFrom(res.member)
    mine.msg = '已保存'
    load()
  }).catch(function (e) {
    mine.err = e.message
  }).then(function () {
    mine.saving = false
    renderMine()
  })
}

/**
 * 传截图：先在浏览器里压一道再发。
 * 原图动辄三五兆，压到长边 1280、质量 0.75 之后一般两三百 K，走 HTTP 接口稳当得多。
 */
function uploadShot(file, kind) {
  if (mine.busy) return
  mine.busy = kind
  mine.err = ''
  mine.msg = ''
  mine.before = state.me.member
  renderMine()

  compress(file).then(function (dataUrl) {
    return call('web.uploadShot', { kind: kind, base64: dataUrl, ext: 'jpg' })
  }).then(function (res) {
    state.me.member = res.member
    mine.form = formFrom(res.member)
    mine.msg = kind === 'attrs'
      ? '识别到 ' + res.recognized.count + '/6 项并已保存' +
        (res.recognized.missing && res.recognized.missing.length ? '（有 ' + res.recognized.missing.length + ' 项没读出来，可以换张更清楚的重传）' : '')
      : '读到武将战力 ' + res.heroPowerText + '，已保存'
    if (kind === 'hero') mine.before = null
    load()
  }).catch(function (e) {
    mine.err = e.message || '上传失败'
    mine.before = null
  }).then(function () {
    mine.busy = ''
    renderMine()
  })
}

function compress(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader()
    reader.onerror = function () { reject(new Error('读不了这个文件')) }
    reader.onload = function () {
      var img = new Image()
      img.onerror = function () { reject(new Error('这不是一张图片')) }
      img.onload = function () {
        var max = 1280
        var scale = Math.min(1, max / Math.max(img.width, img.height))
        var canvas = document.createElement('canvas')
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

// ---------------- 绑事件 ----------------

Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (el) {
  el.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (x) { x.classList.remove('on') })
    el.classList.add('on')
    state.view = el.getAttribute('data-view')
    state.keyword = ''
    if (state.view === 'import' || state.view === 'rally' || state.view === 'placement' || state.view === 'mine') return render()
    state.sort = state.view === 'season'
      ? { key: 'seasonScore', desc: true }
      : state.view === 'bonus' ? { key: 'maxBonus', desc: true }
        : state.view === 'attrs' ? { key: 'attrsSum', desc: true }
          : { key: 'power', desc: true }
    render()
  }
})

document.onkeydown = onKey

$('refreshQr').onclick = newTicket
$('reload').onclick = load
$('logout').onclick = logout

boot()

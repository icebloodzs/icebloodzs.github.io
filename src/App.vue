<script setup>
/**
 * 外壳：开机转圈 → 扫码登录 → 主体三选一，左边菜单钉住不跟着滚。
 * 数据只拉一次（成员名单 + 赛季 + 登录用户），各页在前端自己算。
 */
import { ref, computed, h, provide, watch } from 'vue'
import { NIcon, zhCN, dateZhCN } from 'naive-ui'
import { call, token, setToken, store, inflight, fatal } from './api'
import { when } from './fmt'
import Login from './views/Login.vue'
import Mine from './views/Mine.vue'
import Roster from './views/Roster.vue'
import ImportList from './views/ImportList.vue'
import Bonus from './views/Bonus.vue'
import Attrs from './views/Attrs.vue'
import Missing from './views/Missing.vue'
import Season from './views/Season.vue'
import Rally from './views/Rally.vue'
import Placement from './views/Placement.vue'
import Shape from './views/Shape.vue'
import MyAttrs from './views/MyAttrs.vue'
import Users from './views/Users.vue'
import Notice from './views/Notice.vue'
import Board from './views/Board.vue'
import Attendance from './views/Attendance.vue'
import SideNav from './views/SideNav.vue'

const VIEWS = {
  mine: { label: '我的信息', icon: '👤', comp: Mine },
  roster: { label: '同盟名单', icon: '📋', comp: Roster },
  import: { label: '导入名单', icon: '📥', comp: ImportList },
  bonus: { label: '成员加成', icon: '⚡', comp: Bonus },
  attrs: { label: '属性排名', icon: '📊', comp: Attrs },
  missing: { label: '遗漏排查', icon: '🔍', comp: Missing },
  season: { label: '赛季评分', icon: '🏅', comp: Season },
  attendance: { label: '考勤功勋', icon: '🗓️', comp: Attendance },
  rally: { label: '集结分配', icon: '🚩', comp: Rally },
  placement: { label: '黑土落位', icon: '🗺️', comp: Placement },
  shape: { label: '摆图形', icon: '🔠', comp: Shape },
  myattrs: { label: '我的属性', icon: '📈', comp: MyAttrs },
  users: { label: '绑定情况', icon: '👥', comp: Users },
  notice: { label: '同盟公告', icon: '📢', comp: Notice },
  board: { label: '留言板', icon: '💬', comp: Board }
}

const screen = ref(token.value ? 'boot' : 'login')

/**
 * 手机适配：窄于 768 像素就把左边菜单收进抽屉、内容区留白收窄。
 * 浏览器版要兼容所有端（手机浏览器、平板、电脑），用不了小程序的人主要在手机上打开。
 */
const NARROW_PX = 768
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < NARROW_PX)
const navOpen = ref(false)
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { narrow.value = window.innerWidth < NARROW_PX })
}
/* 根节点挂个 narrow class：各页「整页定高、表格自己滚」的写法在手机上一并取消（见 style.css） */
watch(narrow, (v) => { if (typeof document !== 'undefined') document.documentElement.classList.toggle('narrow', v) }, { immediate: true })
const view = ref('mine')
const me = ref(null)
const members = ref([])
const season = ref(null)
const loginBy = ref({})
const loading = ref(false)
const loginTip = ref('')
const loginWhy = ref('')
const netError = ref(false)

/** 同盟公告：今天还没看过的就弹一次（每天一次，服务端按北京时间算），关掉之后首页菜单里还能再看 */
const notices = ref([])
const noticeOpen = ref(false)
const noticeIndex = ref(0)

async function refreshNotices() {
  try {
    const res = await call('notice.list', {})
    notices.value = res.rows || []
    const unread = res.unread || []
    if (unread.length) {
      const i = notices.value.findIndex((n) => n._id === unread[0])
      noticeIndex.value = Math.max(0, i)
      noticeOpen.value = true
    }
  } catch (e) {
    // 公告拉不到不影响别的，静默
  }
}

/** 关掉弹窗，顺手把当前这几条记成看过了 */
async function closeNotice() {
  noticeOpen.value = false
  const ids = notices.value.map((n) => n._id)
  if (!ids.length) return
  try {
    await call('notice.read', { ids })
  } catch (e) {
    // 没记上下次再弹一遍
  }
}

const icon = (t) => () => h('span', { style: 'font-size:15px' }, t)
// 服务端下发的功能开关。留言板现在被一刀切关掉了（个人主体小程序不让做用户发帖，
// 见云函数 lib/membership.js），这边菜单也跟着藏，免得点进去只拿到一句「功能未开放」。
const can = (key) => {
  const f = me.value && me.value.alliance && me.value.alliance.features
  return !f || f[key] !== false
}
/** 菜单项对应的付费功能：等级不够（或者老客户单独没开）的就不摆出来 */
const VIEW_FEATURE = { attendance: 'attendance', season: 'season', placement: 'placement', shape: 'shape', board: 'forum', rally: 'rally', notice: 'notice' }
const shown = (k) => !VIEW_FEATURE[k] || can(VIEW_FEATURE[k])
/**
 * 电脑版能用到什么程度（服务端在 whoami 里给，见云函数 lib/webAccess.js）：
 * full = 开发版的管理员扫码进来，全部菜单；self = 其余情况，只有「我的」两页。
 */
const selfOnly = computed(() => !me.value || me.value.webScope !== 'full')
const menuOptions = computed(() => selfOnly.value
  ? [{
      type: 'group',
      label: '我的',
      key: 'g0',
      children: ['mine', 'myattrs'].map((k) => ({ label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon) }))
    }]
  : [
  {
    type: 'group',
    label: '我的',
    key: 'g0',
    children: ['mine', 'myattrs'].map((k) => ({ label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon) }))
  },
  {
    type: 'group',
    label: '成员数据',
    key: 'g1',
    children: ['roster', 'import', 'attendance', 'bonus', 'attrs', 'missing', 'season'].filter(shown).map((k) => ({
      label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon)
    }))
  },
  {
    type: 'group',
    label: '指挥工具',
    key: 'g2',
    children: ['rally', 'placement', 'shape', 'notice', 'board']
      .filter(shown)
      .map((k) => ({ label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon) }))
  },
  { type: 'group', label: '账号', key: 'g3', children: [{ label: VIEWS.users.label, key: 'users', icon: icon('👥') }] }
])

const themeOverrides = {
  common: {
    primaryColor: '#6c5ce7',
    primaryColorHover: '#7d6ff0',
    primaryColorPressed: '#5b4bd6',
    primaryColorSuppl: '#7d6ff0',
    borderRadius: '8px'
  }
}

// 各页都要用的数据，provide 下去，省得一层层传
/*
 * 本赛季要看几维：S1~S3 只有四维（没开骑兵），S4 起六维。
 * 服务端在 whoami 里下发，这边不自己算，免得两头规则对不上。
 */
const attrKeys = computed(() => {
  const a = me.value && me.value.alliance
  return (a && a.attrKeys) || ['infDef', 'infHp', 'cavAtk', 'cavBreak', 'arcAtk', 'arcBreak']
})
provide('app', { me, members, season, attrKeys, loginBy, reload, refreshMe, refreshNotices, can, selfOnly, narrow })
// 手机上点了菜单就把抽屉收起来
watch(view, () => { navOpen.value = false })

async function boot() {
  if (!token.value) {
    screen.value = 'login'
    return
  }
  screen.value = 'boot'
  try {
    const who = await call('identity.whoami')
    if (!who.alliance || !who.alliance.active) throw fatal('这个账号还没加入已激活的同盟')
    me.value = who
    if (who.webScope !== 'full' && !['mine', 'myattrs'].includes(view.value)) view.value = 'mine'
    screen.value = 'app'
    await reload()
    refreshNotices()
  } catch (e) {
    // 服务端明确说登录态不能用才清掉；网络抖一下保留，给个重试
    // FEATURE_LOCKED = 这个盟的版本不够用电脑版，token 留着也没用，一起清掉
    const dead = e.errCode === 'WEB_UNAUTHED' || e.errCode === 'FORBIDDEN' || e.errCode === 'FEATURE_LOCKED' || e.fatal
    if (!dead) {
      netError.value = true
      loginTip.value = (e.message || '连不上服务器') + '（登录态还在，重试就行）'
      loginWhy.value = ''
    } else {
      loginWhy.value =
        e.errCode === 'FEATURE_LOCKED'
          ? '浏览器版管理功能是开发版才有的，升级后再扫码'
          : `上次的登录态被服务器拒了：${e.errCode || '未知'}，存在 ${store.how === 'cookie' ? 'cookie' : 'localStorage'}，已清掉`
      loginTip.value = e.message || '登录已失效，请重新扫码'
      setToken('')
      netError.value = false
    }
    screen.value = 'login'
  }
}

async function reload() {
  loading.value = true
  try {
    // 只有「我的」两页时用不着全盟名单（服务端也不让拉），只要赛季配置
    if (selfOnly.value) {
      const seasonRes = await call('season.list', {})
      season.value = seasonRes.season
      members.value = []
      return
    }
    const [list, seasonRes, users] = await Promise.all([
      call('admin.memberList', { roster: 'in', sort: 'powerDesc', page: 1, pageSize: 200 }),
      call('season.list', {}),
      call('admin.userList', {})
    ])
    members.value = list.rows
    season.value = seasonRes.season
    const map = {}
    ;(users.rows || []).forEach((u) => { map[u.uid] = u.lastLoginAt })
    loginBy.value = map
  } finally {
    loading.value = false
  }
}

/** 传完截图 / 改完资料后，刷新自己那份 */
async function refreshMe() {
  const who = await call('identity.whoami')
  me.value = who
  return who
}

function onLogin(t) {
  setToken(t)
  loginTip.value = ''
  loginWhy.value = ''
  netError.value = false
  boot()
}

function onRetry() {
  netError.value = false
  loginTip.value = ''
  boot()
}

async function logout() {
  try { await call('web.logout') } catch (e) { /* 本地清掉就行 */ }
  setToken('')
  location.reload()
}

const title = computed(() => VIEWS[view.value].label)
/** 只有「我的」两页时，告诉人为什么、怎么才能用全部 */
const selfTip = computed(() => {
  const who = me.value || {}
  const free = who.alliance && who.alliance.level !== 'ultra'
  if (free) return `${who.alliance.name} 现在是${who.alliance.levelName || '免费版'}：浏览器版先开放「我的信息」「我的属性」，名单、集结、考勤这些管理功能要开发版。`
  return '普通成员在浏览器版里可以用「我的信息」「我的属性」，管理功能只对开发版的管理员开放。'
})
const ally = computed(() => (me.value && me.value.alliance) || {})

boot()
</script>

<template>
  <!-- 中文：日期选择器、分页这些组件默认是英文 -->
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-loading-bar-provider>
        <n-dialog-provider>
          <div v-if="inflight > 0" class="topbar" />

          <div v-if="screen === 'boot'" class="boot">
            <n-spin size="large" />
            <div class="boot-t">正在进入…</div>
          </div>

          <Login
            v-else-if="screen === 'login'"
            :tip="loginTip"
            :why="loginWhy"
            :retry="netError"
            @done="onLogin"
            @retry="onRetry"
          />

          <n-layout v-else has-sider position="absolute">
            <n-layout-sider v-if="!narrow" bordered :width="212" :native-scrollbar="false" content-style="height:100%">
              <SideNav v-model:value="view" :ally="ally" :me="me" :options="menuOptions" />
            </n-layout-sider>
            <!-- 手机：菜单收进抽屉，左上角 ☰ 打开 -->
            <n-drawer v-else v-model:show="navOpen" placement="left" :width="240">
              <SideNav v-model:value="view" :ally="ally" :me="me" :options="menuOptions" />
            </n-drawer>

            <!-- 外面套一层 relative 的壳：里面那层是 absolute 定位的，
                 没有这层壳它会贴到最外层 n-layout 上，把左边侧栏盖住 -->
            <div class="right">
              <n-layout position="absolute">
                <n-layout-header bordered position="absolute" class="top" :class="{ narrow }">
                  <div class="top-l">
                    <n-button v-if="narrow" quaternary size="small" class="burger" @click="navOpen = true">☰</n-button>
                    <h3>{{ title }}</h3>
                  </div>
                  <n-space align="center" :size="10">
                    <n-button size="small" secondary :loading="loading" @click="reload">{{ narrow ? '刷新' : '刷新数据' }}</n-button>
                    <n-popconfirm @positive-click="logout">
                      <template #trigger><n-button size="small" quaternary>退出</n-button></template>
                      退出后需要重新扫码登录
                    </n-popconfirm>
                  </n-space>
                </n-layout-header>
                <n-layout
                  class="body"
                  position="absolute"
                  style="top: 64px"
                  :native-scrollbar="false"
                  :content-style="narrow ? 'padding: 12px 10px 32px; min-height: 100%' : 'padding: 20px 24px 40px; min-height: 100%'"
                >
                  <n-alert v-if="selfOnly" type="info" :bordered="false" style="margin-bottom: 16px">{{ selfTip }}</n-alert>
                  <n-spin :show="loading && !members.length && !selfOnly">
                    <component :is="VIEWS[view].comp" />
                  </n-spin>
                </n-layout>
              </n-layout>
            </div>
          </n-layout>

          <!-- 公告弹窗：每天第一次上线自动弹一次，关掉之后从左边「同盟公告」还能再看 -->
          <n-modal
            v-model:show="noticeOpen"
            preset="card"
            :style="{ width: narrow ? '92vw' : '560px' }"
            :mask-closable="false"
            :title="notices[noticeIndex] ? notices[noticeIndex].title : '同盟公告'"
            @close="closeNotice"
          >
            <template v-if="notices[noticeIndex]">
              <div class="nt-meta">
                {{ notices[noticeIndex].createdByName }} · {{ when(notices[noticeIndex].createdAt) }}
                <template v-if="notices[noticeIndex].daysLeft !== null">
                  · {{ notices[noticeIndex].daysLeft }} 天后不再显示
                </template>
              </div>
              <!-- html 是服务端洗过白名单的，这里才敢 v-html -->
              <div class="nt-body" v-html="notices[noticeIndex].html"></div>
            </template>
            <template #footer>
              <div class="nt-foot">
                <n-space v-if="notices.length > 1" align="center" :size="8">
                  <n-button size="small" quaternary :disabled="noticeIndex === 0" @click="noticeIndex -= 1">上一条</n-button>
                  <span class="nt-meta">{{ noticeIndex + 1 }} / {{ notices.length }}</span>
                  <n-button size="small" quaternary :disabled="noticeIndex >= notices.length - 1" @click="noticeIndex += 1">下一条</n-button>
                </n-space>
                <div style="flex: 1"></div>
                <n-button type="primary" @click="closeNotice">知道了</n-button>
              </div>
            </template>
          </n-modal>
        </n-dialog-provider>
      </n-loading-bar-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/*
 * 公告弹窗的样式必须是全局的：n-modal 会把内容 teleport 到 body 上，
 * scoped 的属性选择器带不过去，写成 scoped 的话换行和底部排版都会失效。
 */
.nt-meta { font-size: 12px; color: #8a9099; }
/* 公告正文保留管理员写的换行 */
.nt-body { margin-top: 12px; font-size: 14px; line-height: 1.85; color: #3c4350; word-break: break-word; max-height: 50vh; overflow: auto; }
.nt-body p { margin: 0 0 4px; }
.nt-body p:last-child { margin-bottom: 0; }
.nt-foot { display: flex; align-items: center; }
</style>

<style>
/*
 * 列表页要「整页不滚、表格自己滚」，得先有个确定的高度。
 * 一屏 − 顶栏 64 − 内容区上下留白 (20 + 40) = 可用高度。
 * 顶栏高度和这两个留白值改了，这里要跟着改（.top 的 height、n-layout 的 content-style）。
 */
:root { --page-h: calc(100vh - 124px); }
</style>

<style scoped>
.topbar {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 9999;
  height: 3px;
  width: 92%;
  background: linear-gradient(90deg, #8b7cf0, #c4b5fd);
  animation: creep 8s ease-out forwards;
}
@keyframes creep { from { width: 10%; } to { width: 92%; } }

.boot {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: linear-gradient(135deg, #8b7cf0, #6c5ce7);
}
.boot-t { color: #fff; opacity: 0.9; font-size: 14px; }

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  /* 和侧栏顶部那块同高，分隔线才连得上 */
  height: 64px;
  background: #fff;
}
.top h3 { margin: 0; font-size: 18px; font-weight: 600; white-space: nowrap; }
.top-l { display: flex; align-items: center; gap: 4px; min-width: 0; }
.top.narrow { padding: 0 10px; }
.top.narrow h3 { font-size: 16px; }
.burger { font-size: 18px; }
/* 侧栏右边剩下的地方，给里面的 absolute 布局当定位参照 */
.right { position: relative; flex: 1; min-width: 0; }
/* 内容区单独一层 absolute，从顶栏下面开始；顶栏因此滚不动 */
.body { background: #f5f6fa; }
</style>

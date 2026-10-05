<script setup>
/**
 * 外壳：开机转圈 → 扫码登录 → 主体三选一，左边菜单钉住不跟着滚。
 * 数据只拉一次（成员名单 + 赛季 + 登录用户），各页在前端自己算。
 */
import { ref, computed, h, provide } from 'vue'
import { NIcon } from 'naive-ui'
import { call, token, setToken, store, inflight, fatal } from './api'
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
import Users from './views/Users.vue'

const VIEWS = {
  mine: { label: '我的信息', icon: '👤', comp: Mine },
  roster: { label: '同盟名单', icon: '📋', comp: Roster },
  import: { label: '导入名单', icon: '📥', comp: ImportList },
  bonus: { label: '成员加成', icon: '⚡', comp: Bonus },
  attrs: { label: '属性排名', icon: '📊', comp: Attrs },
  missing: { label: '遗漏排查', icon: '🔍', comp: Missing },
  season: { label: '赛季评分', icon: '🏅', comp: Season },
  rally: { label: '集结分配', icon: '🚩', comp: Rally },
  placement: { label: '黑土落位', icon: '🗺️', comp: Placement },
  users: { label: '绑定情况', icon: '👥', comp: Users }
}

const screen = ref(token.value ? 'boot' : 'login')
const view = ref('mine')
const me = ref(null)
const members = ref([])
const season = ref(null)
const loginBy = ref({})
const loading = ref(false)
const loginTip = ref('')
const loginWhy = ref('')
const netError = ref(false)

const icon = (t) => () => h('span', { style: 'font-size:15px' }, t)
const menuOptions = [
  { type: 'group', label: '我的', key: 'g0', children: [{ label: VIEWS.mine.label, key: 'mine', icon: icon('👤') }] },
  {
    type: 'group',
    label: '成员数据',
    key: 'g1',
    children: ['roster', 'import', 'bonus', 'attrs', 'missing', 'season'].map((k) => ({
      label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon)
    }))
  },
  {
    type: 'group',
    label: '指挥工具',
    key: 'g2',
    children: ['rally', 'placement'].map((k) => ({ label: VIEWS[k].label, key: k, icon: icon(VIEWS[k].icon) }))
  },
  { type: 'group', label: '账号', key: 'g3', children: [{ label: VIEWS.users.label, key: 'users', icon: icon('👥') }] }
]

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
provide('app', { me, members, season, loginBy, reload, refreshMe })

async function boot() {
  if (!token.value) {
    screen.value = 'login'
    return
  }
  screen.value = 'boot'
  try {
    const who = await call('identity.whoami')
    if (!who.alliance || !who.alliance.active) throw fatal('这个账号还没加入已激活的同盟')
    if (who.role !== 'admin' && who.role !== 'super') throw fatal('只有管理员能用电脑版')
    me.value = who
    screen.value = 'app'
    await reload()
  } catch (e) {
    // 服务端明确说登录态不能用才清掉；网络抖一下保留，给个重试
    const dead = e.errCode === 'WEB_UNAUTHED' || e.errCode === 'FORBIDDEN' || e.fatal
    if (!dead) {
      netError.value = true
      loginTip.value = (e.message || '连不上服务器') + '（登录态还在，重试就行）'
      loginWhy.value = ''
    } else {
      loginWhy.value = `上次的登录态被服务器拒了：${e.errCode || '未知'}，存在 ${store.how === 'cookie' ? 'cookie' : 'localStorage'}，已清掉`
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
const ally = computed(() => (me.value && me.value.alliance) || {})

boot()
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
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
            <n-layout-sider bordered :width="212" :native-scrollbar="false" content-style="display:flex;flex-direction:column">
              <div class="brand">
                <n-avatar round :size="34" color="#6c5ce7">{{ (ally.name || '盟').slice(0, 1) }}</n-avatar>
                <div>
                  <div class="brand-n">{{ ally.name }}</div>
                  <div class="brand-s">{{ ally.serverNo }} 区 · {{ ally.season }}</div>
                </div>
              </div>
              <n-menu v-model:value="view" :options="menuOptions" :indent="18" style="flex: 1" />
              <div class="who">
                <n-avatar round :size="26" color="#e8e4ff" style="color:#6c5ce7">
                  {{ (me.nickname || '管').slice(0, 1) }}
                </n-avatar>
                <div class="who-t">
                  <div class="who-n">{{ me.nickname || '管理员' }}</div>
                  <div class="who-r">{{ me.role === 'super' ? '超级管理员' : '管理员' }}</div>
                </div>
              </div>
            </n-layout-sider>

            <!-- 外面套一层 relative 的壳：里面那层是 absolute 定位的，
                 没有这层壳它会贴到最外层 n-layout 上，把左边侧栏盖住 -->
            <div class="right">
              <n-layout position="absolute">
                <n-layout-header bordered position="absolute" class="top">
                  <h3>{{ title }}</h3>
                  <n-space align="center" :size="10">
                    <n-button size="small" secondary :loading="loading" @click="reload">刷新数据</n-button>
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
                  content-style="padding: 20px 24px 40px; min-height: 100%"
                >
                  <n-spin :show="loading && !members.length">
                    <component :is="VIEWS[view].comp" />
                  </n-spin>
                </n-layout>
              </n-layout>
            </div>
          </n-layout>
        </n-dialog-provider>
      </n-loading-bar-provider>
    </n-message-provider>
  </n-config-provider>
</template>

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

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  box-sizing: border-box;
  padding: 0 16px;
  border-bottom: 1px solid var(--n-border-color, #efeff5);
}
.brand-n { font-size: 15px; font-weight: 600; line-height: 1.2; }
.brand-s { font-size: 12px; color: #8a9099; margin-top: 2px; }

.who {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 16px;
  border-top: 1px solid var(--n-border-color, #efeff5);
}
.who-n { font-size: 13px; font-weight: 600; line-height: 1.2; }
.who-r { font-size: 11px; color: #8a9099; margin-top: 2px; }

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  /* 和侧栏顶部那块同高，分隔线才连得上 */
  height: 64px;
  background: #fff;
}
.top h3 { margin: 0; font-size: 18px; font-weight: 600; }
/* 侧栏右边剩下的地方，给里面的 absolute 布局当定位参照 */
.right { position: relative; flex: 1; min-width: 0; }
/* 内容区单独一层 absolute，从顶栏下面开始；顶栏因此滚不动 */
.body { background: #f5f6fa; }
</style>

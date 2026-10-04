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

          <n-layout v-else has-sider style="min-height: 100vh">
            <n-layout-sider bordered :width="208" :native-scrollbar="false" class="side">
              <div class="brand">
                <div class="brand-n">{{ ally.name }}</div>
                <div class="brand-s">{{ ally.serverNo }} 区 · {{ ally.season }}</div>
              </div>
              <n-menu v-model:value="view" :options="menuOptions" :indent="18" />
            </n-layout-sider>

            <n-layout>
              <n-layout-header bordered class="top">
                <h3>{{ title }}</h3>
                <n-space align="center">
                  <n-tag :bordered="false" type="success" size="small" round>
                    {{ me.nickname || '管理员' }}{{ me.role === 'super' ? ' · 超管' : '' }}
                  </n-tag>
                  <n-button size="small" :loading="loading" @click="reload">刷新数据</n-button>
                  <n-button size="small" quaternary @click="logout">退出</n-button>
                </n-space>
              </n-layout-header>
              <n-layout-content class="body" :native-scrollbar="false">
                <n-spin :show="loading && !members.length">
                  <component :is="VIEWS[view].comp" />
                </n-spin>
              </n-layout-content>
            </n-layout>
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

.side { background: linear-gradient(180deg, #8b7cf0, #7a68e8); }
.side :deep(.n-menu .n-menu-item-content) { color: rgba(255, 255, 255, 0.86); }
.side :deep(.n-menu .n-menu-item-content:hover) { background: rgba(255, 255, 255, 0.12); }
.side :deep(.n-menu .n-menu-item-content--selected) { background: rgba(255, 255, 255, 0.22); }
.side :deep(.n-menu .n-menu-item-content--selected .n-menu-item-content-header) { color: #fff; font-weight: 600; }
.side :deep(.n-menu-item-group-title) { color: rgba(255, 255, 255, 0.65); }
.brand { padding: 20px 20px 10px; color: #fff; }
.brand-n { font-size: 20px; font-weight: 700; }
.brand-s { font-size: 12px; opacity: 0.8; margin-top: 2px; }

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
}
.top h3 { margin: 0; font-size: 19px; }
.body { padding: 20px 24px 60px; background: #f5f6fa; }
</style>

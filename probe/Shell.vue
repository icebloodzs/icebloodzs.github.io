<script setup>
import { ref, onMounted, provide, computed } from 'vue'
import Bonus from '../src/views/Bonus.vue'
import Mine from '../src/views/Mine.vue'

// 用 #bonus / #mine 看真实视图，#scrolled 看滚动时顶栏固不固定
const hash = location.hash
const MEMBERS = [
  { _id: 'a', name: '冰小三', maxBonus: 128.5, maxMarch: 230000, attrsSum: 5310.88,
    attrsUpdatedAt: '2026-10-04T14:17:00.000Z',
    troopsByLevel: { 3: { inf: 173, cav: 42, arc: 80 }, 2: { inf: 10, cav: null, arc: 5 } },
    attrs: { infDef: 905.58, infHp: 1050.41, cavAtk: 726.47, cavBreak: 835.24, arcAtk: 769.5, arcBreak: 1023.68 },
    heroPower: 61000000, boundAt: '2026-09-01T00:00:00.000Z' },
  { _id: 'b', name: '只有宫3', maxBonus: 96, maxMarch: 180000, attrsSum: null, attrsUpdatedAt: null,
    troopsByLevel: { 3: { inf: 120, cav: 30, arc: 55 } } },
  { _id: 'c', name: '什么都没填', maxBonus: null, maxMarch: null, attrsSum: null, attrsUpdatedAt: null, troopsByLevel: null }
]
provide('app', {
  me: ref({ role: 'super', memberId: 'a', nickname: '我', member: MEMBERS[0] }),
  members: ref(MEMBERS),
  season: ref({ key: 'S6', label: 'S6', limits: [] }),
  loginBy: () => {}, reload: async () => {}, refreshMe: async () => {}
})
const inner = computed(() => (hash.includes('bonus') ? Bonus : hash.includes('mine') ? Mine : null))
onMounted(() => {
  if (!hash.includes('scrolled')) return
  setTimeout(() => {
    const el = document.querySelector('.body .n-scrollbar-container')
    if (el) el.scrollTop = Number((hash.match(/scrolled(\d+)/) || [])[1] || 500)
  }, 300)
})
const ally = { name: '山河', serverNo: '1306', season: 'S6' }
const me = { role: 'super', nickname: '我' }
const view = ref('mine')
const menuOptions = [
  { type: 'group', label: '我的', key: 'g1', children: [{ label: '我的信息', key: 'mine' }] },
  { type: 'group', label: '成员数据', key: 'g2', children: [
    { label: '同盟名单', key: 'roster' }, { label: '导入名单', key: 'import' },
    { label: '成员加成', key: 'bonus' }, { label: '属性排名', key: 'attrs' },
    { label: '遗漏排查', key: 'missing' }, { label: '赛季评分', key: 'season' }] },
  { type: 'group', label: '指挥工具', key: 'g3', children: [
    { label: '集结分配', key: 'rally' }, { label: '黑土落位', key: 'placement' }] },
  { type: 'group', label: '账号', key: 'g4', children: [{ label: '绑定情况', key: 'users' }] }
]
</script>

<template>
<n-layout has-sider position="absolute">
            <n-layout-sider bordered :width="212" :native-scrollbar="false" content-style="display:flex;flex-direction:column">
              <div class="brand">
                <n-avatar round :size="34" color="#6c5ce7">{{ (ally.name || '盟').slice(0, 1) }}</n-avatar>
                <div>
                  <div class="brand-n">山河</div>
                  <div class="brand-s">1306 区 · S6</div>
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
                  <h3>我的信息</h3>
                  <n-space align="center" :size="10">
                    <n-button size="small" secondary>刷新数据</n-button>
                    <n-popconfirm>
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
                  <component :is="inner" v-if="inner" />
                  <div v-else>
                    <div class="probe-box">这块是内容区，左边不该被盖住；往下拖动时上面那条顶栏要钉住不动。</div>
                    <div class="probe-tall">很长的内容，用来看滚动</div>
                  </div>
                </n-layout>
              </n-layout>
            </div>
          </n-layout>
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
.probe-box { background: #fff; border-radius: 10px; padding: 20px; font-size: 14px; }
.probe-tall { height: 1400px; background: #fff; border-radius: 10px; margin-top: 16px; padding: 20px; }
</style>

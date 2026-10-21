<script setup>
/**
 * 左边那一栏：盟名 + 菜单 + 我是谁。
 * 宽屏时钉在左边，窄屏（手机）收进左上角的抽屉里 —— 两处用的是同一份。
 */
defineProps({ ally: Object, me: Object, options: Array, value: String })
const emit = defineEmits(['update:value'])

const roleText = (role) => (role === 'super' ? '超级管理员' : role === 'admin' ? '管理员' : '成员')
</script>

<template>
  <div class="nav">
    <div class="brand">
      <n-avatar round :size="34" color="#6c5ce7">{{ (ally.name || '盟').slice(0, 1) }}</n-avatar>
      <div>
        <div class="brand-n">{{ ally.name }}</div>
        <div class="brand-s">{{ ally.serverNo }} 区 · {{ ally.season }}</div>
      </div>
    </div>
    <n-menu :value="value" :options="options" :indent="18" style="flex: 1" @update:value="(v) => emit('update:value', v)" />
    <div class="who">
      <n-avatar round :size="26" color="#e8e4ff" style="color:#6c5ce7">
        {{ (me.nickname || roleText(me.role)).slice(0, 1) }}
      </n-avatar>
      <div class="who-t">
        <div class="who-n">{{ me.nickname || (me.member && me.member.name) || roleText(me.role) }}</div>
        <div class="who-r">{{ roleText(me.role) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nav { display: flex; flex-direction: column; height: 100%; }
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  box-sizing: border-box;
  padding: 0 16px;
  border-bottom: 1px solid #efeff5;
  flex: none;
}
.brand-n { font-size: 15px; font-weight: 600; line-height: 1.2; }
.brand-s { font-size: 12px; color: #8a9099; margin-top: 2px; }
.who {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 16px;
  border-top: 1px solid #efeff5;
  flex: none;
}
.who-n { font-size: 13px; font-weight: 600; line-height: 1.2; }
.who-r { font-size: 11px; color: #8a9099; margin-top: 2px; }
</style>

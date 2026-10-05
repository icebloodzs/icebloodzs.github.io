<script setup>
/**
 * 盟内留言板：发帖 + 评论。只在本盟内，没有跨盟入口。
 * 和小程序走同一套接口（board.*），两边看到的是同一份内容。
 */
import { ref, inject, onMounted, computed } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { call } from '../api'
import { when } from '../fmt'

const { me } = inject('app')
const message = useMessage()
const dialog = useDialog()

const rows = ref([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(true)
const busy = ref(false)

const title = ref('')
const text = ref('')
const maxTitle = ref(30)
const maxPost = ref(500)
const maxComment = ref(200)
/** 哪条帖子正在写评论：postId -> 内容 */
const draft = ref({})
/** 哪几条展开了全部评论 */
const expanded = ref({})

const bound = computed(() => Boolean(me.value && me.value.member))

async function load(p = 1) {
  loading.value = true
  try {
    const res = await call('board.list', { page: p })
    rows.value = p === 1 ? res.rows : rows.value.concat(res.rows)
    total.value = res.total
    page.value = res.page
    hasMore.value = res.hasMore
    maxPost.value = (res.limits && res.limits.post) || 500
    maxTitle.value = (res.limits && res.limits.title) || 30
    maxComment.value = (res.limits && res.limits.comment) || 200
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(() => load(1))

async function publish() {
  const content = text.value.trim()
  if (!content) return message.warning('写点什么再发')
  busy.value = true
  try {
    await call('board.publish', { title: title.value.trim(), content })
    title.value = ''
    text.value = ''
    await load(1)
  } catch (e) {
    message.error(e.message)
  } finally {
    busy.value = false
  }
}

/** 展开某条的全部评论（列表里默认只带两条） */
async function expand(row) {
  try {
    const res = await call('board.detail', { id: row._id })
    row.comments = res.post.comments
    expanded.value = { ...expanded.value, [row._id]: true }
  } catch (e) {
    message.error(e.message)
  }
}

async function comment(row) {
  const content = (draft.value[row._id] || '').trim()
  if (!content) return message.warning('写点什么再发')
  try {
    await call('board.comment', { postId: row._id, content })
    draft.value = { ...draft.value, [row._id]: '' }
    await expand(row)
    row.commentCount = (row.commentCount || 0) + 1
  } catch (e) {
    message.error(e.message)
  }
}

function removePost(row) {
  dialog.warning({
    title: '删掉这条留言',
    content: '连同下面的评论一起删掉，删了找不回来。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await call('board.removePost', { id: row._id })
        await load(1)
      } catch (e) {
        message.error(e.message)
      }
    }
  })
}

async function removeComment(row, c) {
  try {
    await call('board.removeComment', { id: c._id })
    await expand(row)
    row.commentCount = Math.max(0, (row.commentCount || 1) - 1)
  } catch (e) {
    message.error(e.message)
  }
}

async function pin(row) {
  try {
    await call('board.pin', { id: row._id, pinned: !row.pinned })
    await load(1)
  } catch (e) {
    message.error(e.message)
  }
}
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="同盟留言板" :bordered="false">
      <n-alert type="info" :bordered="false" style="margin-bottom: 14px">
        只有本盟的人看得到，没有跨盟。显示的是你绑定的成员名，不是微信昵称。
        自己发的随时能删，管理员谁的都能删、也能置顶。
      </n-alert>

      <template v-if="bound">
        <n-input v-model:value="title" :maxlength="maxTitle" placeholder="标题（选填）" />
        <n-input v-model:value="text" type="textarea" :rows="3" :maxlength="maxPost" show-count
          placeholder="说点什么，盟里的人都能看到" style="margin-top: 10px" />
        <div class="bar">
          <n-button type="primary" :loading="busy" @click="publish">发表</n-button>
        </div>
      </template>
      <n-alert v-else type="warning" :bordered="false">绑定游戏账号之后才能发言。</n-alert>
    </n-card>

    <n-spin :show="loading && !rows.length">
      <div v-if="!rows.length && !loading" class="empty">还没有人发言</div>

      <n-card v-for="r in rows" :key="r._id" :bordered="false" class="post">
        <div class="head">
          <div class="avatar">{{ (r.authorName || '?').slice(0, 1) }}</div>
          <div>
            <div class="name">
              <n-tag v-if="r.pinned" size="small" type="warning" :bordered="false">置顶</n-tag>
              {{ r.authorName }}
            </div>
            <div class="time">{{ when(r.createdAt) }}</div>
          </div>
          <div style="flex: 1"></div>
          <n-button v-if="r.canPin" size="tiny" quaternary @click="pin(r)">{{ r.pinned ? '取消置顶' : '置顶' }}</n-button>
          <n-button v-if="r.canRemove" size="tiny" quaternary type="error" @click="removePost(r)">删除</n-button>
        </div>

        <div v-if="r.title" class="title">{{ r.title }}</div>
        <div class="text">{{ r.content }}</div>

        <div v-if="r.comments && r.comments.length" class="cmts">
          <div v-for="c in r.comments" :key="c._id" class="cmt">
            <b>{{ c.authorName }}</b>
            <span v-if="c.replyTo" class="muted"> 回复 {{ c.replyTo }}</span>
            <span>：{{ c.content }}</span>
            <n-button v-if="c.canRemove" size="tiny" quaternary type="error" @click="removeComment(r, c)">删</n-button>
          </div>
          <n-button
            v-if="!expanded[r._id] && r.commentCount > r.comments.length"
            size="tiny" text type="primary" @click="expand(r)"
          >查看全部 {{ r.commentCount }} 条评论</n-button>
        </div>

        <div v-if="bound" class="reply">
          <n-input v-model:value="draft[r._id]" size="small" :maxlength="maxComment"
            placeholder="评论一句" @keyup.enter="comment(r)" />
          <n-button size="small" @click="comment(r)">评论</n-button>
        </div>
      </n-card>

      <div v-if="hasMore" class="more">
        <n-button :loading="loading" @click="load(page + 1)">加载更多</n-button>
      </div>
      <div v-else-if="rows.length" class="muted end">共 {{ total }} 条</div>
    </n-spin>
  </n-space>
</template>

<style scoped>
.bar { display: flex; justify-content: flex-end; margin-top: 12px; }
.empty { padding: 40px; text-align: center; color: #8a9099; }
.post { margin-bottom: 14px; }
.head { display: flex; align-items: center; gap: 10px; }
.avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: #e8e4ff; color: #6c5ce7; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.name { font-size: 14px; font-weight: 600; }
.time { font-size: 12px; color: #8a9099; margin-top: 2px; }
/* 正文保留换行 */
/* 标题选填，有才显示 */
.title { margin-top: 12px; font-size: 16px; font-weight: 600; line-height: 1.5; word-break: break-word; }
.title + .text { margin-top: 6px; }
.text { margin-top: 12px; font-size: 14px; line-height: 1.8; color: #3c4350; white-space: pre-wrap; word-break: break-word; }
.cmts { margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: #f6f7f9; }
.cmt { font-size: 13px; line-height: 1.9; color: #4b5563; }
.cmt b { color: #6c5ce7; }
.muted { color: #8a9099; }
.reply { display: flex; gap: 8px; margin-top: 12px; }
.more, .end { text-align: center; padding: 10px 0 20px; }
.end { font-size: 12px; }
</style>

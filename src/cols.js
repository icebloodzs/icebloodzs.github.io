/** 几个列表页共用的列定义片段 */
import { h } from 'vue'
import { NTag } from 'naive-ui'
import { big, num, when, ago, sorter } from './fmt'

export const nameCol = {
  title: '成员',
  key: 'name',
  width: 130,
  fixed: 'left',
  sorter: sorter((r) => r.name),
  render: (r) => h('b', r.name)
}

/** wan = 「万」那一档保留几位小数，默认 1（见 fmt.js 的 big） */
export const bigCol = (title, key, width = 110, desc = false, wan = 1) => ({
  title,
  key,
  width,
  sorter: sorter((r) => r[key]),
  defaultSortOrder: desc ? 'descend' : undefined,
  render: (r) => big(r[key], wan),
  xls: (r) => (r[key] === null || r[key] === undefined ? '' : Number(r[key]))
})

/** desc=true 时这一列就是表格的默认排序列（降序），一进来就按它排好 */
export const numCol = (title, key, digits = 2, width = 100, desc = false) => ({
  title,
  key,
  width,
  sorter: sorter((r) => r[key]),
  defaultSortOrder: desc ? 'descend' : undefined,
  render: (r) => num(r[key], digits),
  xls: (r) => (r[key] === null || r[key] === undefined ? '' : Number(r[key]))
})

/** 时间列：绝对时间 + 一个小圆标，不换行 */
export const timeCol = (title, key, emptyText = '从未', width = 160) => ({
  title,
  key,
  width,
  sorter: sorter((r) => (r[key] ? new Date(r[key]).getTime() : null)),
  render: (r) => {
    if (!r[key]) return h(NTag, { size: 'small', type: 'error', bordered: false }, () => emptyText)
    const a = ago(r[key])
    return h('div', { style: 'white-space:nowrap' }, [
      h('span', { style: 'color:#4b5563' }, when(r[key])),
      ' ',
      h(NTag, { size: 'small', type: a.type, bordered: false }, () => a.text)
    ])
  },
  xls: (r) => when(r[key])
})

/** 没有微信、靠浏览器登录码的成员，挂在虚拟用户 web_<成员 id> 名下（云函数 lib/webMember.js） */
export const isVirtualUid = (uid) => typeof uid === 'string' && uid.startsWith('web_')
const boundText = (r) => (!r.boundUid ? '未绑定' : isVirtualUid(r.boundUid) ? '登录码' : '已绑定')

export const boundCol = {
  title: '绑定',
  key: 'boundUid',
  width: 90,
  sorter: sorter((r) => (r.boundUid ? 1 : 0)),
  render: (r) => h(NTag, { size: 'small', type: !r.boundUid ? 'error' : isVirtualUid(r.boundUid) ? 'info' : 'success', bordered: false },
    () => boundText(r)),
  xls: boundText
}

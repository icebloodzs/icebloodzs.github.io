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

export const bigCol = (title, key, width = 110) => ({
  title,
  key,
  width,
  sorter: sorter((r) => r[key]),
  render: (r) => big(r[key]),
  xls: (r) => (r[key] === null || r[key] === undefined ? '' : Number(r[key]))
})

export const numCol = (title, key, digits = 2, width = 100) => ({
  title,
  key,
  width,
  sorter: sorter((r) => r[key]),
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

export const boundCol = {
  title: '绑定',
  key: 'boundUid',
  width: 90,
  sorter: sorter((r) => (r.boundUid ? 1 : 0)),
  render: (r) => h(NTag, { size: 'small', type: r.boundUid ? 'success' : 'error', bordered: false },
    () => (r.boundUid ? '已绑定' : '未绑定')),
  xls: (r) => (r.boundUid ? '已绑定' : '未绑定')
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortTasks } from '../src/lib/taskSorting.ts'
import type { Task } from '../src/lib/workspace.ts'

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    priority: 'medium',
    dueDate: '',
    createdAt: '2026-11-01T00:00:00Z',
    done: false,
    categoryId: '',
    ...extra,
  }
}
const ids = (tasks: readonly Task[], timeZone = 'Asia/Shanghai') =>
  sortTasks(tasks, timeZone).map((item) => item.id)

test('task ordering follows priority before deadline, creation time and title, without mutating storage order', () => {
  const tasks = [
    task('low-urgent', { priority: 'low', dueDate: '2026-11-01' }),
    task('medium', { dueDate: '2026-11-02' }),
    task('high-new', { priority: 'high', createdAt: '2026-11-02T00:00:00Z', title: '阿' }),
    task('high-old', { priority: 'high', createdAt: '2026-10-31T00:00:00Z', title: '中' }),
    task('high-later', { priority: 'high', dueDate: '2026-11-04' }),
    task('high-sooner', { priority: 'high', dueDate: '2026-11-03', done: true }),
  ]
  const before = structuredClone(tasks)
  assert.deepEqual(ids(tasks), [
    'high-sooner',
    'high-later',
    'high-old',
    'high-new',
    'medium',
    'low-urgent',
  ])
  assert.deepEqual(tasks, before)
})

test('deadlines use actual instants and date-only deadlines use 23:59 in the client timezone', () => {
  const tasks = [
    task('none'),
    task('next-local-day', { dueDate: '2026-11-03', dueAt: '2026-11-03T16:00:00Z' }),
    task('date-only', { dueDate: '2026-11-03' }),
    task('later-time', { dueDate: '2026-11-03', dueAt: '2026-11-03T10:00:00+08:00' }),
    task('earlier-time', { dueDate: '2026-11-03', dueAt: '2026-11-03T01:00:00Z' }),
  ]
  assert.deepEqual(ids(tasks), [
    'earlier-time',
    'later-time',
    'date-only',
    'next-local-day',
    'none',
  ])
  assert.deepEqual(ids(tasks, 'UTC'), [
    'earlier-time',
    'later-time',
    'next-local-day',
    'date-only',
    'none',
  ])
})

test('creation times compare chronologically and equal instants fall back to Chinese title order', () => {
  const tasks = [
    task('later', { title: '阿', createdAt: '2026-11-01T02:00:00Z' }),
    task('zhong', { title: '中间方案', createdAt: '2026-11-01T09:00:00+08:00' }),
    task('bo', { title: '补充资料', createdAt: '2026-11-01T01:00:00Z' }),
    task('a', { title: '阿米娅资料', createdAt: '2026-11-01T01:00:00Z' }),
  ]
  assert.deepEqual(ids(tasks), ['a', 'bo', 'zhong', 'later'])
})

test('completed tasks use the same ordering keys and exact ties retain their existing order', () => {
  const first = task('first', { title: '同名任务', done: true })
  const second = task('second', { title: '同名任务' })
  assert.deepEqual(ids([first, second]), ['first', 'second'])
  assert.deepEqual(ids([second, first]), ['second', 'first'])
})

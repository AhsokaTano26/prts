import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTaskMatrix, parseMatrixOptions, matrixHash } from '../src/lib/taskMatrix.ts'
import type { Task } from '../src/lib/workspace.ts'

const now = Date.parse('2026-11-02T04:00:00Z')
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  priority: 'medium',
  categoryId: '',
  done: false,
  dueDate: '',
  createdAt: '2026-11-01T00:00:00Z',
  ...extra,
})
const options = {
  now,
  timeZone: 'Asia/Shanghai',
  urgentDays: 7 as const,
  importantPriority: 'high' as const,
  columns: 16,
}

test('only unfinished tasks remain represented with truthful coordinates and quadrants', () => {
  const tasks = [
    task('act', { priority: 'high', dueAt: '2026-11-03T04:00:00Z' }),
    task('plan', { priority: 'high', dueAt: '2026-11-20T04:00:00Z' }),
    task('fit', { priority: 'medium', dueDate: '2026-11-03' }),
    task('later', { priority: 'low', dueDate: '2026-12-01' }),
    task('unknown', { priority: 'high' }),
    task('completed', { dueAt: '2099-01-01T00:00:00Z', done: true }),
    task('completed-undated', { done: true }),
  ]
  const before = structuredClone(tasks)
  const model = buildTaskMatrix(tasks, options)
  assert.deepEqual(model.counts, { act: 1, plan: 1, fit: 1, later: 1 })
  assert.equal(model.undated[0].id, 'unknown')
  assert.equal(model.tasks.length, 5)
  assert.ok(model.tasks.every((item) => !item.done))
  assert.ok(model.max < Date.parse('2027-01-01T00:00:00Z'))
  assert.equal(model.points.flatMap((point) => point.tasks).length + model.undated.length, 5)
  for (const point of model.points) {
    const id = point.tasks[0].id
    assert.equal(point.quadrant, id)
    const due =
      id === 'fit'
        ? Date.parse('2026-11-03T15:59:00Z')
        : id === 'later'
          ? Date.parse('2026-12-01T15:59:00Z')
          : Date.parse(point.tasks[0].dueAt!)
    assert.ok(Math.abs(point.x - ((due - model.min) / (model.max - model.min)) * 100) < 0.000001)
    assert.ok(point.y > 0 && point.y < 100)
  }
  assert.deepEqual(tasks, before)
})

test('urgency includes overdue tasks and the exact cutoff while completed tasks stay excluded', () => {
  const tasks = [
    task('overdue', { dueAt: '2026-10-01T00:00:00Z' }),
    task('boundary', { dueAt: '2026-11-09T04:00:00Z' }),
    task('after', { dueAt: '2026-11-09T04:00:00.001Z' }),
    task('completed', { dueAt: '2026-11-03T00:00:00Z', done: true }),
  ]
  const model = buildTaskMatrix(tasks, { ...options, importantPriority: 'medium' })
  assert.equal(model.counts.act, 2)
  assert.equal(model.counts.plan, 1)
  assert.ok(model.points.every((point) => point.quadrant === 'act' || point.quadrant === 'plan'))
  assert.equal(model.tasks.length, 3)
})

test('overdue flags use actual deadlines and distinguish overdue tasks inside mixed clusters', () => {
  const input = [
    task('overdue', { dueAt: new Date(now - 1).toISOString() }),
    task('boundary', { dueAt: new Date(now).toISOString() }),
    task('yesterday', { dueDate: '2026-11-01', priority: 'low' }),
    task('today', { dueDate: '2026-11-02' }),
    task('unknown'),
    task('completed', { dueAt: new Date(now - 1).toISOString(), done: true }),
  ]
  const model = buildTaskMatrix(input, options)
  assert.deepEqual([...model.overdueIds].sort(), ['overdue', 'yesterday'])
  const mixed = model.points.find((point) => point.tasks.some((item) => item.id === 'boundary'))!
  assert.equal(mixed.overdueCount, 1)
  assert.ok(mixed.tasks.some((item) => item.id === 'overdue'))
  assert.equal(
    model.points.reduce((total, point) => total + point.overdueCount, 0),
    2,
  )
  assert.equal(model.undated[0].id, 'unknown')
})

test('quadrants stay equal while the chosen importance threshold repositions priority levels', () => {
  const input = (['high', 'medium', 'low'] as const).map((priority) =>
    task(priority, {
      priority,
      dueAt: '2026-11-03T04:00:00Z',
    }),
  )
  for (const importantPriority of ['high', 'medium'] as const) {
    const model = buildTaskMatrix(input, { ...options, importantPriority })
    assert.equal(model.importanceY, 50)
    for (const point of model.points) {
      const important =
        point.priority === 'high' || (importantPriority === 'medium' && point.priority === 'medium')
      assert.equal(point.y < 50, important)
      assert.equal(model.priorityY[point.priority], point.y)
    }
    assert.ok(
      model.priorityY.high < model.priorityY.medium && model.priorityY.medium < model.priorityY.low,
    )
  }
})

test('dense aggregation keeps every task once and never merges across priority or urgency boundaries', () => {
  const tasks = Array.from({ length: 10000 }, (_, i) =>
    task(String(i), {
      priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
      dueAt: new Date(now + (i % 10) * 86400000).toISOString(),
    }),
  )
  const model = buildTaskMatrix(tasks, { ...options, columns: 4 })
  const represented = model.points.flatMap((point) => point.tasks)
  assert.equal(represented.length, 10000)
  assert.equal(new Set(represented.map((item) => item.id)).size, 10000)
  assert.ok(model.points.length <= 4 * 3 + 3)
  assert.ok(
    model.points.every((point) =>
      point.tasks.every(
        (item) =>
          item.priority === point.priority &&
          Date.parse(item.dueAt!) <= model.cutoff === ['act', 'fit'].includes(point.quadrant),
      ),
    ),
  )
  assert.equal(
    Object.values(model.counts).reduce((sum, count) => sum + count, 0),
    10000,
  )
})

test('empty and undated-only matrices have a finite scale without fabricating deadlines', () => {
  for (const tasks of [[], [task('undated')]]) {
    const model = buildTaskMatrix(tasks, options)
    assert.equal(model.points.length, 0)
    assert.equal(model.undated.length, tasks.length)
    assert.ok(Number.isFinite(model.min) && Number.isFinite(model.max) && model.max > model.min)
  }
})

test('shareable matrix options round trip while invalid options safely fall back', () => {
  assert.deepEqual(parseMatrixOptions('#quadrants'), {
    urgentDays: 7,
    importantPriority: 'high',
  })
  const custom = {
    urgentDays: 3 as const,
    importantPriority: 'medium' as const,
  }
  assert.deepEqual(parseMatrixOptions(matrixHash(custom)), custom)
  assert.deepEqual(
    parseMatrixOptions('#quadrants?days=-2&important=admin&status=secret'),
    parseMatrixOptions('#quadrants'),
  )
  assert.equal(matrixHash(parseMatrixOptions('#quadrants')), '#quadrants')
  assert.deepEqual(parseMatrixOptions('#quadrants?status=done'), parseMatrixOptions('#quadrants'))
})

test('nearby marks have distinct hit targets without changing true time or priority coordinates', () => {
  const cutoff = now + 7 * 86400000
  const input = [-3600000, -1, 1, 3600000].map((offset, index) =>
    task(String(index), { priority: 'high', dueAt: new Date(cutoff + offset).toISOString() }),
  )
  const model = buildTaskMatrix(input, { ...options, columns: 10 })
  assert.equal(model.points.length, 2)
  const [left, right] = [...model.points].sort((a, b) => a.x - b.x)
  assert.equal(left.y, right.y)
  assert.ok(
    Math.hypot(((right.x - left.x) * 520) / 100, ((right.labelY - left.labelY) * 420) / 100) >= 44,
  )
  assert.ok(
    model.points.every((point) => point.x > 0 && point.x < 100 && point.labelY < model.importanceY),
  )
})

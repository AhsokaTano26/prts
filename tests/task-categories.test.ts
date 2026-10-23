import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialWorkspace, validateWorkspace, type Workspace } from '../src/lib/workspace.ts'
import {
  createTaskCategory,
  renameTaskCategory,
  deleteTaskCategory,
} from '../src/lib/taskCategories.ts'

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

test('creating a category trims the name and changes no tasks or existing data', () => {
  const workspace = freeze(createInitialWorkspace())
  const next = createTaskCategory(workspace, '  新项目  ')
  const category = next.taskCategories.at(-1)!
  assert.equal(category.name, '新项目')
  assert.ok(category.id)
  assert.equal(next.taskCategories.length, workspace.taskCategories.length + 1)
  assert.equal(new Set(next.taskCategories.map((item) => item.id)).size, next.taskCategories.length)
  assert.equal(next.tasks, workspace.tasks)
  assert.equal(next.notes, workspace.notes)
  assert.deepEqual(validateWorkspace(next), next)
})

test('renaming a category preserves its ID, assignments and the input', () => {
  const workspace = freeze(createInitialWorkspace())
  const category = workspace.taskCategories[0]
  const next = renameTaskCategory(workspace, category.id, '  长期工作  ')
  assert.equal(next.taskCategories[0].id, category.id)
  assert.equal(next.taskCategories[0].name, '长期工作')
  assert.equal(workspace.taskCategories[0].name, '工作')
  assert.equal(next.tasks, workspace.tasks)
  assert.deepEqual(next.notes, workspace.notes)
  assert.deepEqual(validateWorkspace(next), next)
})

test('deleting a category keeps every task and field, only moving its tasks to uncategorized', () => {
  const workspace = createInitialWorkspace()
  const category = workspace.taskCategories[0]
  const originalTasks = workspace.tasks.map((task, index) => ({
    ...task,
    extraField: `preserved-${index}`,
  }))
  workspace.tasks = originalTasks
  const frozen = freeze(workspace)
  const next = deleteTaskCategory(frozen, category.id)
  assert.equal(next.tasks.length, originalTasks.length)
  assert.deepEqual(
    next.tasks,
    originalTasks.map((task) => ({
      ...task,
      categoryId: task.categoryId === category.id ? '' : task.categoryId,
    })),
  )
  assert.deepEqual(frozen.tasks, originalTasks)
  assert.deepEqual(
    next.taskCategories,
    frozen.taskCategories.filter((item) => item.id !== category.id),
  )
  assert.equal(next.notes, frozen.notes)
  assert.equal(next.activities, frozen.activities)
  assert.equal(next.settings, frozen.settings)
  assert.equal(next.focusSessions, frozen.focusSessions)
  for (const task of frozen.tasks.filter((item) => item.categoryId !== category.id)) {
    assert.equal(
      next.tasks.find((item) => item.id === task.id),
      task,
    )
  }
})

test('category mutations reject invalid names, duplicates and reserved uncategorized operations', () => {
  const workspace = freeze(createInitialWorkspace())
  for (const name of ['', '  ', '未分类', ' 未分类 ', 'a'.repeat(41)]) {
    assert.throws(() => createTaskCategory(workspace, name), /分类/)
    assert.throws(() => renameTaskCategory(workspace, workspace.taskCategories[0].id, name), /分类/)
  }
  const english = freeze(createTaskCategory(workspace, 'Work'))
  assert.throws(() => createTaskCategory(english, ' work '), /分类.*已存在/)
  assert.throws(
    () => renameTaskCategory(english, english.taskCategories[0].id, 'WORK'),
    /分类.*已存在/,
  )
  const own = english.taskCategories.at(-1)!
  assert.equal(renameTaskCategory(english, own.id, 'WORK').taskCategories.at(-1)?.name, 'WORK')
  assert.throws(() => renameTaskCategory(workspace, '', '新名称'), /未分类/)
  assert.throws(() => deleteTaskCategory(workspace, ''), /未分类/)
  assert.throws(() => renameTaskCategory(workspace, 'missing-category', '新名称'), /分类不存在/)
  assert.throws(() => deleteTaskCategory(workspace, 'missing-category'), /分类不存在/)
})

test('at most 50 categories may be created, while renaming remains allowed at the limit', () => {
  const workspace: Workspace = {
    ...createInitialWorkspace(),
    tasks: [],
    taskCategories: Array.from({ length: 50 }, (_, index) => ({
      id: `category-${index}`,
      name: `分类${index}`,
    })),
  }
  freeze(workspace)
  assert.throws(() => createTaskCategory(workspace, '第51个分类'), /50/)
  assert.equal(
    renameTaskCategory(workspace, 'category-0', '新的名称').taskCategories[0].name,
    '新的名称',
  )
  assert.equal(deleteTaskCategory(workspace, 'category-0').taskCategories.length, 49)
})

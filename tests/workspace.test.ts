import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  createInitialWorkspace,
  formatBytes,
  loadWorkspace,
  makeId,
  relativeTime,
  saveWorkspace,
  validateWorkspace,
  WORKSPACE_STORAGE_KEY,
} from '../src/lib/workspace.ts'
import { MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES, storeFiles } from '../src/lib/files.ts'

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function mockStorage(initial?: string, writeError?: Error) {
  const entries = new Map<string, string>()
  if (initial !== undefined) entries.set(WORKSPACE_STORAGE_KEY, initial)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (writeError) throw writeError
        entries.set(key, value)
      },
    },
  })
  return entries
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

test('initial workspace is valid and uses today in the local timezone', () => {
  const workspace = createInitialWorkspace()
  assert.deepEqual(validateWorkspace(workspace), workspace)
  assert.equal(workspace.schemaVersion, 2)
  assert.deepEqual(
    workspace.taskCategories.map((category) => category.name),
    ['工作', '学习', '生活'],
  )
  assert.ok(
    workspace.tasks.every((task) =>
      workspace.taskCategories.some((category) => category.id === task.categoryId),
    ),
  )
  const today = new Date()
  const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  assert.equal(workspace.tasks[0].dueDate, expected)
  assert.ok(workspace.notes[0].content.includes('# '))
})

test('save and load round-trip through the single workspace key', () => {
  const entries = mockStorage()
  const workspace = createInitialWorkspace()
  workspace.settings.name = '测试用户'
  workspace.tasks[0].done = true
  saveWorkspace(workspace)
  assert.deepEqual(loadWorkspace(), workspace)
  assert.deepEqual([...entries.keys()], [WORKSPACE_STORAGE_KEY])
})

test('a cleared note title saves and reloads while live editing', () => {
  mockStorage()
  const workspace = createInitialWorkspace()
  workspace.notes[0].title = ''
  saveWorkspace(workspace)
  assert.equal(loadWorkspace().notes[0].title, '')
  assert.equal(validateWorkspace(workspace).notes[0].title, '')
})

test('malformed stored data is preserved while load returns valid defaults', () => {
  const raw = '{"tasks": broken backup'
  const entries = mockStorage(raw)
  assert.equal(loadWorkspace().schemaVersion, 2)
  assert.equal(entries.get(WORKSPACE_STORAGE_KEY), raw)
})

test('validation rejects future versions, invalid nested values, impossible dates and duplicate IDs', () => {
  assert.throws(() => validateWorkspace({ ...createInitialWorkspace(), schemaVersion: 3 }), /版本/)
  const invalidTask = createInitialWorkspace()
  invalidTask.tasks[0].done = 'yes' as unknown as boolean
  assert.throws(() => validateWorkspace(invalidTask), /完成状态/)
  const invalidDate = createInitialWorkspace()
  invalidDate.tasks[0].dueDate = '2026-02-30'
  assert.throws(() => validateWorkspace(invalidDate), /截止日期不存在/)
  const duplicate = createInitialWorkspace()
  duplicate.tasks[1].id = duplicate.tasks[0].id
  assert.throws(() => validateWorkspace(duplicate), /重复的 ID/)
  const invalidTimestamp = createInitialWorkspace()
  invalidTimestamp.notes[0].updatedAt = '2026-02-30T12:00:00.000Z'
  assert.throws(() => validateWorkspace(invalidTimestamp), /不存在的日期/)
  assert.throws(() => validateWorkspace(null), /格式错误/)
})

test('v1 and unversioned backups migrate every task to uncategorized without changing input or other data', () => {
  for (const schemaVersion of [1, undefined]) {
    const legacy = structuredClone(createInitialWorkspace()) as unknown as Record<string, unknown>
    if (schemaVersion === undefined) delete legacy.schemaVersion
    else legacy.schemaVersion = schemaVersion
    delete legacy.taskCategories
    legacy.tasks = (legacy.tasks as Record<string, unknown>[]).map(
      ({ categoryId: _categoryId, ...task }) => task,
    )
    const original = structuredClone(legacy)
    const migrated = validateWorkspace(legacy)
    assert.equal(migrated.schemaVersion, 2)
    assert.deepEqual(migrated.taskCategories, [])
    assert.deepEqual(
      migrated.tasks,
      (original.tasks as Record<string, unknown>[]).map((task) => ({ ...task, categoryId: '' })),
    )
    for (const field of ['notes', 'activities', 'settings', 'focusSessions'] as const) {
      assert.deepEqual(migrated[field], original[field])
    }
    assert.deepEqual(legacy, original)
  }
})

test('legacy storage is only migrated in memory until explicitly saved under the existing key', () => {
  const legacy = structuredClone(createInitialWorkspace()) as unknown as Record<string, unknown>
  legacy.schemaVersion = 1
  delete legacy.taskCategories
  legacy.tasks = (legacy.tasks as Record<string, unknown>[]).map(
    ({ categoryId: _categoryId, ...task }) => task,
  )
  const raw = JSON.stringify(legacy)
  const entries = mockStorage(raw)
  const migrated = loadWorkspace()
  assert.equal(migrated.schemaVersion, 2)
  assert.deepEqual(migrated.taskCategories, [])
  assert.equal(entries.get(WORKSPACE_STORAGE_KEY), raw)
  migrated.taskCategories = [{ id: 'new-category', name: '新计划' }]
  migrated.tasks[0].categoryId = 'new-category'
  saveWorkspace(migrated)
  assert.deepEqual(loadWorkspace(), migrated)
  assert.deepEqual([...entries.keys()], ['prts-workspace-v1'])
})

test('v2 imports trim category names and permit uncategorized tasks without mutating input', () => {
  const workspace = createInitialWorkspace()
  workspace.taskCategories[0].name = '  工作  '
  workspace.tasks[0].categoryId = ''
  const original = structuredClone(workspace)
  const validated = validateWorkspace(workspace)
  assert.equal(validated.taskCategories[0].name, '工作')
  assert.equal(validated.tasks[0].categoryId, '')
  assert.deepEqual(workspace, original)
})

test('v2 imports reject invalid category names, duplicate names or IDs, limits and broken task references', () => {
  for (const name of ['', '  ', '未分类', ' 未分类 ', 'a'.repeat(41), 123]) {
    const invalid = createInitialWorkspace()
    invalid.taskCategories[0].name = name as string
    assert.throws(() => validateWorkspace(invalid), /分类/)
  }
  const duplicates = createInitialWorkspace()
  duplicates.taskCategories[0].name = 'Work'
  duplicates.taskCategories[1].name = ' work '
  assert.throws(() => validateWorkspace(duplicates), /分类.*重复/)
  const duplicateIds = createInitialWorkspace()
  duplicateIds.taskCategories[1].id = duplicateIds.taskCategories[0].id
  assert.throws(() => validateWorkspace(duplicateIds), /重复的 ID/)
  const tooMany = createInitialWorkspace()
  tooMany.taskCategories = Array.from({ length: 51 }, (_, index) => ({
    id: `category-${index}`,
    name: `分类${index}`,
  }))
  assert.throws(() => validateWorkspace(tooMany), /50/)
  const dangling = createInitialWorkspace()
  dangling.tasks[0].categoryId = 'missing-category'
  assert.throws(() => validateWorkspace(dangling), /任务分类不存在/)
  const missingTaskField = createInitialWorkspace()
  Reflect.deleteProperty(missingTaskField.tasks[0], 'categoryId')
  assert.throws(() => validateWorkspace(missingTaskField), /分类/)
  const missingCategoryList = createInitialWorkspace()
  Reflect.deleteProperty(missingCategoryList, 'taskCategories')
  assert.throws(() => validateWorkspace(missingCategoryList), /分类/)
})

test('a storage write failure is reported instead of silently losing work', () => {
  const quotaError = new Error('storage full')
  quotaError.name = 'QuotaExceededError'
  mockStorage(undefined, quotaError)
  assert.throws(() => saveWorkspace(createInitialWorkspace()), /存储空间不足/)
})

test('format helpers handle ordinary values and malformed input', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB')
  assert.equal(formatBytes(Number.NaN), '0 B')
  assert.equal(relativeTime('not a date'), '时间未知')
  assert.equal(relativeTime(new Date(Date.now() - 120_000).toISOString()), '2 分钟前')
  assert.equal(relativeTime(new Date().toISOString()), '刚刚')
  assert.equal(new Set(Array.from({ length: 100 }, makeId)).size, 100)
})

test('file validation rejects oversized selections before opening IndexedDB', async () => {
  assert.deepEqual(await storeFiles([]), [])
  const oversized = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'oversized.bin')
  await assert.rejects(storeFiles([oversized]), /20 MB/)
  const validFile = new File([new Uint8Array(MAX_FILE_BYTES)], 'valid.bin')
  const tooManyFiles = Array.from(
    { length: Math.floor(MAX_TOTAL_FILE_BYTES / MAX_FILE_BYTES) + 1 },
    () => validFile,
  )
  await assert.rejects(storeFiles(tooManyFiles), /100 MB/)
})

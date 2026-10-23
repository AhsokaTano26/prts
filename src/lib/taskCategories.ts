import {
  makeId,
  MAX_TASK_CATEGORIES,
  normalizeTaskCategoryName,
  type Workspace,
} from './workspace.ts'

function availableName(workspace: Workspace, value: string, excludeId?: string): string {
  const name = normalizeTaskCategoryName(value)
  if (
    workspace.taskCategories.some(
      (category) =>
        category.id !== excludeId && category.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error('分类名称已存在')
  }
  return name
}

export function createTaskCategory(workspace: Workspace, name: string): Workspace {
  const normalizedName = availableName(workspace, name)
  if (workspace.taskCategories.length >= MAX_TASK_CATEGORIES) {
    throw new Error(`最多创建 ${MAX_TASK_CATEGORIES} 个分类`)
  }
  return {
    ...workspace,
    taskCategories: [...workspace.taskCategories, { id: makeId(), name: normalizedName }],
  }
}

export function renameTaskCategory(workspace: Workspace, id: string, name: string): Workspace {
  if (!id) throw new Error('不能重命名“未分类”')
  if (!workspace.taskCategories.some((category) => category.id === id)) {
    throw new Error('分类不存在')
  }
  const normalizedName = availableName(workspace, name, id)
  return {
    ...workspace,
    taskCategories: workspace.taskCategories.map((category) =>
      category.id === id ? { ...category, name: normalizedName } : category,
    ),
  }
}

export function deleteTaskCategory(workspace: Workspace, id: string): Workspace {
  if (!id) throw new Error('不能删除“未分类”')
  if (!workspace.taskCategories.some((category) => category.id === id)) {
    throw new Error('分类不存在')
  }
  return {
    ...workspace,
    taskCategories: workspace.taskCategories.filter((category) => category.id !== id),
    tasks: workspace.tasks.map((task) =>
      task.categoryId === id ? { ...task, categoryId: '' } : task,
    ),
  }
}

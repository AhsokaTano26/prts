import { useId, useRef, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import type { TaskCategory } from '../lib/workspace'
import { Modal } from './UI'

interface TaskCategoriesDialogProps {
  categories: TaskCategory[]
  onCreate: (name: string) => string | undefined
  onRename: (id: string, name: string) => string | undefined
  onDelete: (id: string) => string | undefined
  onClose: () => void
}

export default function TaskCategoriesDialog({
  categories,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: TaskCategoriesDialogProps) {
  const formId = useId()
  const createInput = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string>()
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState<string>()
  const [deletingId, setDeletingId] = useState<string>()
  const [deleteError, setDeleteError] = useState<string>()

  function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newName.trim()) return
    const error = onCreate(newName.trim())
    setCreateError(error)
    if (error === undefined) {
      setNewName('')
      createInput.current?.focus()
    }
  }

  function renameCategory(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    if (!editName.trim()) return
    const error = onRename(id, editName.trim())
    setEditError(error)
    if (error === undefined) {
      setEditingId(undefined)
      createInput.current?.focus()
    }
  }

  function deleteCategory(id: string) {
    const error = onDelete(id)
    setDeleteError(error)
    if (error === undefined) {
      setDeletingId(undefined)
      createInput.current?.focus()
    }
  }

  return (
    <Modal title="管理分类" onClose={onClose} className="task-category-dialog">
      <p className="task-category-dialog-copy">
        按工作或生活场景整理任务。最多 50 个分类，名称最多 40 个字符。
      </p>

      <form className="task-category-create-form" onSubmit={createCategory}>
        <label htmlFor={`${formId}-create`}>新分类名称</label>
        <div className="task-category-create-controls">
          <input
            ref={createInput}
            id={`${formId}-create`}
            className="task-category-input"
            value={newName}
            maxLength={40}
            placeholder="例如：工作、个人"
            autoComplete="off"
            aria-invalid={createError !== undefined || undefined}
            aria-describedby={createError !== undefined ? `${formId}-create-error` : undefined}
            onChange={(event) => {
              setNewName(event.target.value)
              setCreateError(undefined)
            }}
          />
          <button
            type="submit"
            className="task-category-button task-category-button-primary"
            disabled={!newName.trim()}
          >
            <Plus size={15} aria-hidden="true" />
            添加分类
          </button>
        </div>
        {createError !== undefined && (
          <p id={`${formId}-create-error`} className="task-category-error" role="alert">
            {createError}
          </p>
        )}
      </form>

      <div className="task-category-list-heading">
        <h3>已有分类</h3>
        <span>{categories.length} 个</span>
      </div>
      {categories.length === 0 ? (
        <p className="task-category-list-empty">暂无自定义分类。新建后即可将任务归入对应分类。</p>
      ) : (
        <ul className="task-category-list" aria-label="已有任务分类">
          {categories.map((category) => (
            <li key={category.id} className="task-category-row">
              {editingId === category.id ? (
                <form
                  className="task-category-edit-form"
                  onSubmit={(event) => renameCategory(event, category.id)}
                >
                  <label htmlFor={`${formId}-edit-${category.id}`}>修改分类名称</label>
                  <input
                    id={`${formId}-edit-${category.id}`}
                    className="task-category-input"
                    value={editName}
                    aria-label="分类名称"
                    maxLength={40}
                    autoComplete="off"
                    autoFocus
                    aria-invalid={editError !== undefined || undefined}
                    aria-describedby={editError !== undefined ? `${formId}-edit-error` : undefined}
                    onChange={(event) => {
                      setEditName(event.target.value)
                      setEditError(undefined)
                    }}
                  />
                  {editError !== undefined && (
                    <p id={`${formId}-edit-error`} className="task-category-error" role="alert">
                      {editError}
                    </p>
                  )}
                  <div className="task-category-row-actions">
                    <button
                      type="button"
                      className="task-category-button"
                      onClick={() => setEditingId(undefined)}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="task-category-button task-category-button-primary"
                      disabled={!editName.trim()}
                    >
                      保存分类名称
                    </button>
                  </div>
                </form>
              ) : (
                <div className="task-category-row-main">
                  <span className="task-category-name" title={category.name}>
                    {category.name}
                  </span>
                  <div className="task-category-row-actions">
                    <button
                      type="button"
                      className="task-category-button"
                      aria-label={`重命名分类：${category.name}`}
                      onClick={() => {
                        setEditingId(category.id)
                        setEditName(category.name)
                        setEditError(undefined)
                        setDeletingId(undefined)
                        setDeleteError(undefined)
                      }}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className="task-category-button task-category-button-danger"
                      aria-label={`删除分类：${category.name}`}
                      onClick={() => {
                        setDeletingId(category.id)
                        setDeleteError(undefined)
                        setEditingId(undefined)
                        setEditError(undefined)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              )}
              {deletingId === category.id && (
                <div
                  className="task-category-delete-confirm"
                  role="group"
                  aria-labelledby={`${formId}-delete-title`}
                  aria-describedby={`${formId}-delete-description`}
                >
                  <p id={`${formId}-delete-title`}>确认删除“{category.name}”？</p>
                  <p id={`${formId}-delete-description`}>
                    分类中的任务会移回未分类，任务不会删除。
                  </p>
                  {deleteError !== undefined && (
                    <p className="task-category-error" role="alert">
                      {deleteError}
                    </p>
                  )}
                  <div className="task-category-row-actions">
                    <button
                      type="button"
                      className="task-category-button"
                      onClick={() => {
                        setDeletingId(undefined)
                        setDeleteError(undefined)
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="task-category-button task-category-button-danger"
                      onClick={() => deleteCategory(category.id)}
                    >
                      确认删除分类
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

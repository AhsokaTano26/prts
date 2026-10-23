import { makeId } from './workspace.ts'
import { apiFetch } from './api.ts'

export interface WorkspaceFile {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024

async function result(response: Response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '文件操作失败，请重试。')
  return data
}

export async function listFiles(): Promise<WorkspaceFile[]> {
  const data = await result(await apiFetch('/api/files', { cache: 'no-store' }))
  return data.files
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取文件，请重试。'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })
}

export async function storeFileRecords(
  records: (WorkspaceFile & { blob: Blob })[],
): Promise<WorkspaceFile[]> {
  if (!records.length) return []
  for (const record of records) {
    if (!(record.blob instanceof Blob) || record.blob.size > MAX_FILE_BYTES)
      throw new Error(`「${record.name}」超过单个文件 20 MB 的大小限制。`)
  }
  if (records.reduce((sum, record) => sum + record.blob.size, 0) > MAX_TOTAL_FILE_BYTES)
    throw new Error('本次上传文件超过 100 MB，请分批上传。')
  const files = await Promise.all(
    records.map(async ({ blob, ...metadata }) => ({
      ...metadata,
      data: await base64(blob),
    })),
  )
  const data = await result(
    await apiFetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    }),
  )
  return data.files
}

export async function storeFiles(files: File[]): Promise<WorkspaceFile[]> {
  return storeFileRecords(
    files.map((file) => ({
      id: makeId(),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file,
    })),
  )
}

export async function readFileBlob(id: string): Promise<Blob> {
  const response = await apiFetch(`/api/files/${encodeURIComponent(id)}/content`)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '无法下载文件，请重试。')
  }
  return response.blob()
}

export async function removeFile(id: string): Promise<void> {
  if (!id) throw new Error('文件 ID 无效，无法删除。')
  const response = await apiFetch(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) await result(response)
}

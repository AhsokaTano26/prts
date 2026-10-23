import { makeId } from './workspace.ts'

export interface WorkspaceFile {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
  blob: Blob
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024

const DATABASE_NAME = 'prts-files-v1'
const STORE_NAME = 'files'
let databasePromise: Promise<IDBDatabase> | undefined

function storageError(error: unknown): Error {
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return new Error('文件保存失败：浏览器存储空间不足，请删除不需要的文件后重试。')
  }
  return new Error('无法访问本地文件存储，请检查浏览器隐私设置，或关闭其他工作台标签页后重试。')
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof globalThis.indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地文件存储，请使用支持 IndexedDB 的浏览器。'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    } catch (error) {
      reject(storageError(error))
      return
    }
    let failed = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onerror = () => {
      failed = true
      reject(storageError(request.error))
    }
    request.onblocked = () => {
      failed = true
      reject(new Error('本地文件存储正在被其他页面占用，请关闭其他工作台标签页后重试。'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (failed) {
        database.close()
        return
      }
      database.onversionchange = () => {
        database.close()
        databasePromise = undefined
      }
      database.onclose = () => {
        databasePromise = undefined
      }
      resolve(database)
    }
  }).catch((error: unknown) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise
}

export async function listFiles(): Promise<WorkspaceFile[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readonly')
    } catch (error) {
      reject(storageError(error))
      return
    }
    let files: WorkspaceFile[] = []
    const request = transaction.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => {
      files = request.result as WorkspaceFile[]
    }
    transaction.oncomplete = () =>
      resolve(files.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    transaction.onabort = () => reject(storageError(transaction.error))
    transaction.onerror = () => {
      /* The abort event reports the transaction failure. */
    }
  })
}

export async function storeFiles(files: File[]): Promise<WorkspaceFile[]> {
  if (files.length === 0) return []
  for (const file of files) {
    if (!(file instanceof Blob) || typeof file.name !== 'string')
      throw new Error('请选择有效的本地文件。')
    if (file.size > MAX_FILE_BYTES)
      throw new Error(`「${file.name}」超过单个文件 20 MB 的大小限制。`)
  }
  const incomingBytes = files.reduce((total, file) => total + file.size, 0)
  if (incomingBytes > MAX_TOTAL_FILE_BYTES)
    throw new Error('本次选择的文件超过 100 MB，本地文件总容量上限为 100 MB。')
  const records: WorkspaceFile[] = files.map((file) => ({
    id: makeId(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  }))
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
    } catch (error) {
      reject(storageError(error))
      return
    }
    let failure: Error | undefined
    const store = transaction.objectStore(STORE_NAME)
    // Capacity checks and additions share one transaction to handle concurrent tabs safely.
    const existing = store.getAll()
    existing.onsuccess = () => {
      try {
        const usedBytes = (existing.result as WorkspaceFile[]).reduce(
          (total, file) => total + file.blob.size,
          0,
        )
        if (usedBytes + incomingBytes > MAX_TOTAL_FILE_BYTES) {
          failure = new Error('本地文件总容量不能超过 100 MB，请删除不需要的文件后重试。')
          transaction.abort()
          return
        }
        for (const file of records) store.add(file)
      } catch (error) {
        failure = storageError(error)
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(records)
    transaction.onabort = () => reject(failure ?? storageError(transaction.error))
    transaction.onerror = () => {
      /* IDB aborts every addition if one request fails. */
    }
  })
}

export async function removeFile(id: string): Promise<void> {
  if (typeof id !== 'string' || !id) throw new Error('文件 ID 无效，无法删除。')
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
    } catch (error) {
      reject(storageError(error))
      return
    }
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(storageError(transaction.error))
    transaction.onerror = () => {
      /* Wait for abort so callers see the final outcome. */
    }
  })
}

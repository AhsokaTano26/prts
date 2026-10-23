export interface LegacyWorkspaceFile {
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

export async function listLegacyFiles(): Promise<LegacyWorkspaceFile[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readonly')
    } catch (error) {
      reject(storageError(error))
      return
    }
    let files: LegacyWorkspaceFile[] = []
    const request = transaction.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => {
      files = request.result as LegacyWorkspaceFile[]
    }
    transaction.oncomplete = () =>
      resolve(files.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    transaction.onabort = () => reject(storageError(transaction.error))
    transaction.onerror = () => {
      /* The abort event reports the transaction failure. */
    }
  })
}

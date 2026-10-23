export type CorpusSyncStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed'
  phase: 'checking' | 'downloading' | 'verifying' | 'activating' | null
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
  release: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  result: 'installed' | 'updated' | 'current' | null
}

export function parseCorpusSyncStatus(value: unknown): CorpusSyncStatus {
  const data = value as CorpusSyncStatus | null
  if (
    !data ||
    !['idle', 'running', 'succeeded', 'failed'].includes(data.state) ||
    ![null, 'checking', 'downloading', 'verifying', 'activating'].includes(data.phase) ||
    ![null, 'installed', 'updated', 'current'].includes(data.result) ||
    ['completedFiles', 'totalFiles', 'completedBytes', 'totalBytes'].some((key) => {
      const number = data[key as 'completedFiles']
      return !Number.isSafeInteger(number) || number < 0
    }) ||
    ['release', 'startedAt', 'finishedAt', 'error'].some((key) => {
      const text = data[key as 'release']
      return text !== null && typeof text !== 'string'
    })
  )
    throw new Error('语料同步状态格式异常，请重试。')
  return data
}

export function syncProgress(status: CorpusSyncStatus) {
  return status.totalBytes > 0
    ? Math.min(100, Math.round((status.completedBytes / status.totalBytes) * 100))
    : undefined
}

export function syncDescription(status: CorpusSyncStatus) {
  if (status.state === 'failed') return '本次同步未完成'
  if (status.state === 'succeeded')
    return status.result === 'current'
      ? '当前已是最新版本，校验完成'
      : status.result === 'installed'
        ? '语料下载完成，已可使用'
        : '语料已更新，新版本已生效'
  if (status.state === 'running')
    return {
      checking: '正在检查最新版本',
      downloading: '正在下载并校验语料',
      verifying: '正在校验本地文件',
      activating: '正在启用语料',
    }[status.phase || 'checking']
  return '尚未执行同步'
}

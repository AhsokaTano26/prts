import { DatabaseSync, backup } from 'node:sqlite'
import { mkdir, chmod, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const source = path.resolve(process.env.PRTS_DB_PATH || 'data/prts.sqlite')
const output = path.resolve(
  process.argv[2] || `backups/prts-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
)
if (source === output) throw new Error('备份目标不能与正在使用的数据库相同。')
await stat(source)
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
try {
  await stat(output)
  throw new Error('备份文件已存在，请选择新的文件名。')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const temporary = `${output}.${process.pid}.tmp`
const database = new DatabaseSync(source, { readOnly: true })
try {
  await backup(database, temporary)
  await chmod(temporary, 0o600)
  const verification = new DatabaseSync(temporary, { readOnly: true })
  try {
    const result = verification.prepare('PRAGMA quick_check').get()
    if (result.quick_check !== 'ok') throw new Error('数据库备份校验失败。')
  } finally {
    verification.close()
  }
  // Hard-linking fails if another backup has claimed the destination meanwhile.
  const { link } = await import('node:fs/promises')
  await link(temporary, output)
  console.log(`SQLite 备份完成：${output}`)
} finally {
  database.close()
  await unlink(temporary).catch(() => {})
}

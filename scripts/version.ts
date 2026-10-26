import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export function getAppVersion(root: string, override?: string): string {
  if (override?.trim()) return override.trim()
  try {
    return execFileSync(
      'git',
      ['describe', '--tags', '--match', 'v[0-9]*', '--always', '--abbrev=7', '--dirty'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    // Source archives and local Docker contexts may have no Git metadata.
    const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return `v${version}-local`
  }
}

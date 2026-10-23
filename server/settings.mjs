import { HttpError } from './errors.mjs'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4.1-mini'

// This table is intentionally separate from exportable workspace documents.
export function createSettings(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS prts_ai_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0)
  ) STRICT`)
  database
    .prepare('INSERT OR IGNORE INTO prts_ai_settings VALUES (1, ?, ?, ?, 1)')
    .run(DEFAULT_BASE_URL, DEFAULT_MODEL, '')
  const read = () => database.prepare('SELECT * FROM prts_ai_settings WHERE id = 1').get()
  function publicValue(row = read()) {
    return {
      baseUrl: row.base_url,
      model: row.model,
      hasApiKey: Boolean(row.api_key),
      configured: Boolean(row.api_key),
      revision: row.revision,
    }
  }
  function configuration() {
    const row = read()
    const url = new URL(row.base_url)
    const provider = url.hostname === 'api.openai.com' ? 'OpenAI' : url.hostname
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
    return {
      apiKey: row.api_key,
      model: row.model,
      endpoint: url.href,
      provider,
      configured: Boolean(row.api_key),
    }
  }
  function update(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new HttpError(400, '请提供有效的 AI 配置。')
    const { baseUrl, model, apiKey, clearApiKey, revision } = payload
    if (typeof baseUrl !== 'string' || !baseUrl.trim() || baseUrl.length > 2048)
      throw new HttpError(400, '请输入有效的 AI 服务地址。')
    let normalizedUrl
    try {
      const url = new URL(baseUrl.trim())
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('Invalid provider URL')
      normalizedUrl = url.href.replace(/\/+$/, '')
    } catch {
      throw new HttpError(
        400,
        'AI 服务地址必须是 HTTP(S) 地址，且不能包含账号、密码、查询参数或片段。',
      )
    }
    if (
      typeof model !== 'string' ||
      !model.trim() ||
      model.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(model)
    )
      throw new HttpError(400, '模型名称须为 1 至 200 个字符。')
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new HttpError(400, 'AI 配置版本无效，请重新加载。')
    if (clearApiKey !== undefined && typeof clearApiKey !== 'boolean')
      throw new HttpError(400, '清除密钥选项无效。')
    if (
      apiKey !== undefined &&
      (typeof apiKey !== 'string' ||
        apiKey.length > 8192 ||
        (apiKey.trim() && !/^[\x21-\x7e]+$/.test(apiKey.trim())))
    )
      throw new HttpError(400, 'API 密钥格式无效。')
    const key = apiKey?.trim()
    if (clearApiKey && key) throw new HttpError(400, '请分别操作替换密钥或清除密钥。')
    database.exec('BEGIN IMMEDIATE')
    try {
      const current = read()
      if (current.revision !== revision)
        throw new HttpError(409, 'AI 配置已在其他页面更新，请重新加载后再保存。')
      database
        .prepare(
          'UPDATE prts_ai_settings SET base_url = ?, model = ?, api_key = ?, revision = revision + 1 WHERE id = 1',
        )
        .run(normalizedUrl, model.trim(), clearApiKey ? '' : key || current.api_key)
      const result = publicValue()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return { read: publicValue, configuration, update }
}

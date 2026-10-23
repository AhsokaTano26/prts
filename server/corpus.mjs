import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { HttpError } from './errors.mjs'

const unzip = promisify(gunzip)
const DEFAULT_DIRECTORY = fileURLToPath(new URL('../data/corpus/', import.meta.url))
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_PLAIN_BYTES = 64 * 1024 * 1024
const CACHE_BYTES = 32 * 1024 * 1024
const SOURCES = [
  {
    id: 'arknights',
    name: '明日方舟',
    homepage: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-arknights',
  },
  {
    id: 'endfield',
    name: '明日方舟：终末地',
    homepage: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield',
  },
]
const GAME_WORDS =
  /明日方舟|终末地|arknights|endfield|罗德岛|阿米娅|凯尔希|源石|矿石病|泰拉|整合运动|莱万汀|陈千语|四号谷地|塔卫二/iu
const DOMAIN_TERMS = [
  '源石',
  '矿石病',
  '罗德岛',
  '泰拉',
  '整合运动',
  '四号谷地',
  '塔卫二',
  '终末地工业',
  '巴别塔',
]
const PROTAGONIST_QUESTION = /是谁|档案|语音|剧情|身世|种族|登场/u
const AMBIGUOUS_NAMES = new Set([
  '博士',
  '管理员',
  '医生',
  '老师',
  '助理',
  '警察',
  '工程师',
  '教授',
  '医生助理',
  '老板',
  '宝宝',
  '四月',
  '布丁',
  '香草',
  '暴雨',
  '和弦',
  '卡夫卡',
  'dijkstra',
  'touch',
  'ace',
])
const CHARACTER_QUESTION =
  /是谁|档案|语音|干员|人物|剧情|角色|关系|背景|设定|技能|故事|种族|登场|身世/u
const STOP_WORDS = new Set([
  '请',
  '请问',
  '介绍',
  '介绍一下',
  '一下',
  '什么',
  '为什么',
  '怎么样',
  '如何',
  '哪些',
  '是谁',
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '有',
  '吗',
  '呢',
  '我',
  '你',
  '他',
  '她',
  '它',
  '他们',
  '她们',
  '这个',
  '那个',
  '负责',
  '告诉',
  '帮',
  '帮我',
  '明日方舟',
  '终末地',
  '游戏',
  '资料',
  '故事',
  '角色',
  '有关',
  '关于',
])
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const normalize = (text) =>
  String(text).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
const unavailable = () =>
  new HttpError(
    503,
    '本地语料尚未准备好或校验失败，请运行 node scripts/sync-corpus.mjs 完成同步后重试。',
  )

function safePath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..') ||
    path.isAbsolute(relative)
  )
    throw unavailable()
  const target = path.resolve(root, relative)
  if (!target.startsWith(`${root}${path.sep}`)) throw unavailable()
  return target
}

async function confinedFile(root, relative, maximum = MAX_FILE_BYTES) {
  const target = await realpath(safePath(root, relative))
  if (!target.startsWith(`${root}${path.sep}`)) throw unavailable()
  const info = await stat(target)
  if (!info.isFile() || info.size > maximum) throw unavailable()
  return readFile(target)
}

async function jsonFile(root, relative) {
  return JSON.parse((await confinedFile(root, relative, 4 * 1024 * 1024)).toString('utf8'))
}

function descriptors(manifest) {
  return [
    manifest.document_catalog,
    ...(manifest.shards || []),
    ...(manifest.search_index?.shards || []),
    manifest.localization?.catalog,
    ...Object.values(manifest.localization?.languages || {}),
  ].filter(Boolean)
}

function cache() {
  const entries = new Map()
  let bytes = 0
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value, weight) {
      if (weight > CACHE_BYTES) return value
      const prior = entries.get(key)
      if (prior) {
        bytes -= prior.weight
        entries.delete(key)
      }
      while (bytes + weight > CACHE_BYTES && entries.size) {
        const oldest = entries.keys().next().value
        bytes -= entries.get(oldest).weight
        entries.delete(oldest)
      }
      entries.set(key, { value, weight })
      bytes += weight
      return value
    },
  }
}

// Reader for the upstream documented PRTSNG2 / PRTSTG1 offset-and-varint format.
// It reads data only; no upstream package or downloaded code is executed.
function postings(bytes, term) {
  if (bytes.length < 16 || !['PRTSNG2\0', 'PRTSTG1\0'].includes(bytes.toString('ascii', 0, 8)))
    throw unavailable()
  const count = bytes.readUInt32LE(8)
  const start = 12 + (count + 1) * 4
  if (count > 1_000_000 || start > bytes.length) throw unavailable()
  const target = Buffer.from(term)
  let low = 0,
    high = count - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    let cursor = start + bytes.readUInt32LE(12 + middle * 4)
    const end = start + bytes.readUInt32LE(16 + middle * 4)
    if (cursor < start || end < cursor || end > bytes.length) throw unavailable()
    function integer() {
      let value = 0,
        shift = 0
      while (cursor < end && shift <= 35) {
        const next = bytes[cursor++]
        value += (next & 127) * 2 ** shift
        if (!(next & 128)) return value
        shift += 7
      }
      throw unavailable()
    }
    const size = integer()
    if (size > end - cursor) throw unavailable()
    const comparison = Buffer.compare(bytes.subarray(cursor, cursor + size), target)
    cursor += size
    if (comparison < 0) {
      low = middle + 1
      continue
    }
    if (comparison > 0) {
      high = middle - 1
      continue
    }
    const length = integer()
    if (length > 100_000) throw unavailable()
    const ids = []
    let id = 0
    for (let i = 0; i < length; i += 1) {
      id += integer()
      ids.push(id)
    }
    if (cursor !== end) throw unavailable()
    return ids
  }
  return []
}

function grams(term) {
  const chars = Array.from(term)
  if (chars.length <= 3) return [term]
  const positions = new Set([0, Math.floor((chars.length - 3) / 2), chars.length - 3])
  return [...positions].map((index) => chars.slice(index, index + 3).join(''))
}

function excerpt(record, terms) {
  const lines = record.lines.filter(
    (line) =>
      typeof line.text === 'string' &&
      line.text.trim() &&
      Number.isInteger(line.line_number) &&
      !/^(角色(?:\s*ID)?|来源(?:记录)?|解锁条件)\s*[:：]/iu.test(line.text.trim()),
  )
  let best = 0,
    highest = -1,
    bestValue = -1
  for (let index = 0; index < lines.length; index += 1) {
    const text = normalize(lines[index].text)
    const score = terms.reduce(
      (total, term) => total + (text.includes(term) ? Math.max(1, term.length) : 0),
      0,
    )
    // A name-only question should reach prose, not stop at a short identity field.
    const value = score + (score > 0 && text.length >= 32 ? 2 : 0)
    if (value > bestValue) {
      bestValue = value
      highest = score
      best = index
    }
  }
  let chosen = lines.slice(Math.max(0, best - 1), Math.min(lines.length, best + 9))
  // If a very long preceding line would hide the hit, start with the matched line.
  if (chosen[0] !== lines[best] && chosen[0]?.text.length > 250) chosen = chosen.slice(1)
  const text = chosen
    .map((line) => `${line.speaker_raw ? `${line.speaker_raw}：` : ''}${line.text}`)
    .join('\n')
  let offset = 0
  if (text.length > 900) {
    const positions = terms
      .map((term) => normalize(text).indexOf(term))
      .filter((position) => position >= 0)
    if (positions.length) offset = Math.max(0, Math.min(...positions) - 120)
  }
  return {
    excerpt: `${offset ? '…' : ''}${text.slice(offset, offset + 900)}${text.length > offset + 900 ? '…' : ''}`,
    lineStart: chosen[0]?.line_number || 1,
    lineEnd: chosen.at(-1)?.line_number || 1,
    matchScore: highest,
  }
}

export function createCorpus({ directory = DEFAULT_DIRECTORY, release } = {}) {
  let snapshot,
    loading,
    retryAt = 0
  let activeSearches = 0
  const indices = cache(),
    bodies = cache()
  const inflight = new Map()

  async function packed(pack, descriptor) {
    const bytes = await confinedFile(pack.root, descriptor.path)
    if (
      bytes.length !== descriptor.compressed_size ||
      createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256
    )
      throw unavailable()
    const plain = await unzip(bytes, { maxOutputLength: MAX_PLAIN_BYTES })
    if (plain.length !== descriptor.uncompressed_size) throw unavailable()
    return plain
  }

  async function load() {
    const root = await realpath(directory)
    // A synchronizer can validate a staged release before publishing current.json.
    const pointer = release || (await jsonFile(root, 'current.json'))
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(pointer.release_id) || pointer.release_id === '..')
      throw unavailable()
    const releaseRoot = await realpath(safePath(root, `releases/${pointer.release_id}`))
    if (!releaseRoot.startsWith(`${root}${path.sep}`)) throw unavailable()
    const manifest = await jsonFile(releaseRoot, 'release-manifest.json')
    if (
      manifest.release_id !== pointer.release_id ||
      manifest.data_version !== pointer.data_version ||
      !Array.isArray(manifest.packs) ||
      manifest.packs.length > 20
    )
      throw unavailable()
    const packs = [],
      documents = [],
      characters = new Set()
    for (const entry of manifest.packs) {
      if (!/^[a-z_]+$/.test(entry.pack_id)) throw unavailable()
      const data = await jsonFile(releaseRoot, `${entry.pack_id}/pack-manifest.json`)
      const root = await realpath(safePath(releaseRoot, entry.pack_id))
      if (!root.startsWith(`${releaseRoot}${path.sep}`)) throw unavailable()
      const pack = {
        id: entry.pack_id,
        source: entry.pack_id.startsWith('endfield_') ? 'endfield' : 'arknights',
        root,
        manifest: data,
        rows: new Map(),
        shards: new Map((data.shards || []).map((item) => [item.path, item])),
      }
      const resources = descriptors(data)
      if (!data.document_catalog || !resources.length || !data.search_index?.shards?.length)
        throw unavailable()
      // Completeness is checked without unpacking or reading all 900 MB of text.
      for (let offset = 0; offset < resources.length; offset += 24) {
        await Promise.all(
          resources.slice(offset, offset + 24).map(async (resource) => {
            const info = await stat(safePath(root, resource.path))
            if (!info.isFile() || info.size !== resource.compressed_size) throw unavailable()
          }),
        )
      }
      const catalog = (await packed(pack, data.document_catalog))
        .toString('utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      if (catalog.length !== data.document_count) throw unavailable()
      for (const row of catalog) {
        const doc = row.document
        if (
          !doc ||
          typeof doc.document_id !== 'string' ||
          typeof doc.display_title !== 'string' ||
          !pack.shards.has(row.shard_path) ||
          !Number.isInteger(row.record_index) ||
          row.record_index < 0 ||
          row.record_index >= pack.shards.get(row.shard_path).document_count ||
          !Number.isInteger(row.search_index_id) ||
          pack.rows.has(row.search_index_id)
        )
          throw unavailable()
        const item = {
          id: `${pack.id}:${doc.document_id}`,
          documentId: doc.document_id,
          pack,
          title: doc.display_title,
          normalizedTitle: normalize(doc.display_title),
          character: normalize(doc.character_name || ''),
          shard: row.shard_path,
          recordIndex: row.record_index,
          authority: data.authority || entry.authority || 'mixed',
          sourceRef: doc.source_ref_prefix || doc.document_id,
        }
        pack.rows.set(row.search_index_id, item)
        documents.push(item)
        if (item.character.length >= 1 && item.character.length <= 24)
          characters.add(item.character)
      }
      packs.push(pack)
    }
    if (!documents.length || documents.length !== manifest.document_count) throw unavailable()
    return {
      release: pointer.release_id,
      dataVersion: pointer.data_version,
      documents,
      packs,
      characters: [...characters].sort((a, b) => b.length - a.length),
    }
  }

  async function ready() {
    if (snapshot) return snapshot
    if (Date.now() < retryAt) throw unavailable()
    if (!loading)
      loading = load()
        .then((value) => {
          snapshot = value
          return value
        })
        .catch(() => {
          retryAt = Date.now() + 3000
          throw unavailable()
        })
        .finally(() => {
          loading = null
        })
    return loading
  }

  async function cached(pack, descriptor, type) {
    const key = `${pack.id}/${descriptor.path}`
    const store = type === 'index' ? indices : bodies
    const existing = store.get(key)
    if (existing) return existing
    if (!inflight.has(key)) {
      inflight.set(
        key,
        packed(pack, descriptor)
          .then((plain) => {
            const value =
              type === 'index'
                ? plain
                : plain
                    .toString('utf8')
                    .trim()
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => JSON.parse(line))
            if (type !== 'index' && value.length !== descriptor.document_count) throw unavailable()
            return store.set(key, value, plain.length * (type === 'index' ? 1 : 3))
          })
          .finally(() => inflight.delete(key)),
      )
    }
    return inflight.get(key)
  }

  async function findTerm(pack, term) {
    let candidates
    for (const gram of grams(term)) {
      const key = Buffer.from(gram)
      const descriptor = pack.manifest.search_index.shards.find(
        (entry) =>
          Buffer.compare(Buffer.from(entry.first_ngram ?? entry.first_trigram), key) <= 0 &&
          Buffer.compare(Buffer.from(entry.last_ngram ?? entry.last_trigram), key) >= 0,
      )
      if (!descriptor) return []
      const found = postings(await cached(pack, descriptor, 'index'), gram)
      const present = new Set(found)
      candidates = candidates ? candidates.filter((id) => present.has(id)) : found
      if (!candidates.length) return []
    }
    return candidates || []
  }

  async function search(query, { source = 'all', limit = 6 } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500)
      throw new HttpError(400, '检索问题必须为 1 至 500 个字符。')
    if (!['all', 'arknights', 'endfield'].includes(source))
      throw new HttpError(400, '语料来源无效。')
    if (!Number.isInteger(limit) || limit < 1 || limit > 12)
      throw new HttpError(400, '结果数量必须为 1 至 12。')
    if (activeSearches >= 4)
      throw new HttpError(429, '本地检索正在处理其他请求，请稍后重试。', { 'retry-after': '1' })
    activeSearches += 1
    try {
      const data = await ready()
      const original = normalize(query)
      // Game labels specify scope; splitting them into 明日 / 方舟 can swamp the subject.
      const normalized =
        original.replace(/明日方舟[:：]?|终末地|arknights|endfield/giu, ' ').trim() || original
      const segments = [...segmenter.segment(normalized)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment)
      const names = data.characters
        .filter((name) => normalized.includes(name) && (name.length > 1 || segments.includes(name)))
        .slice(0, 4)
      const words = segments.filter((word) => !STOP_WORDS.has(word) && word.length > 1)
      const domains = DOMAIN_TERMS.filter((term) => original.includes(term))
      const terms = [...new Set([...names, ...domains, ...words])].slice(0, 10)
      if (!terms.length) terms.push(normalized.slice(0, 30))
      const scores = new Map()
      const selected = data.packs.filter((pack) => source === 'all' || pack.source === source)
      for (const pack of selected) {
        for (const term of terms) {
          const ids = await findTerm(pack, term)
          const weight =
            Math.log(2 + pack.rows.size / (ids.length + 1)) * (names.includes(term) ? 3 : 1)
          for (const id of ids) {
            const row = pack.rows.get(id)
            if (row) scores.set(row, (scores.get(row) || 0) + weight)
          }
        }
        for (const row of pack.rows.values()) {
          const titleMatches = terms.filter((term) => row.normalizedTitle.includes(term))
          if (titleMatches.length)
            scores.set(
              row,
              (scores.get(row) || 0) +
                8 * titleMatches.length +
                (domains.includes(row.normalizedTitle) ? 30 : 0) +
                (row.character && names.includes(row.character) ? 20 : 0),
            )
        }
      }
      const candidates = [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title, 'zh'))
        .slice(0, Math.max(30, limit * 5))
      const results = []
      for (const [row, score] of candidates) {
        const records = await cached(row.pack, row.pack.shards.get(row.shard), 'body')
        const record = records[row.recordIndex]
        if (record?.document?.document_id !== row.documentId || !Array.isArray(record.lines))
          throw unavailable()
        const hit = excerpt(record, terms)
        if (!hit.excerpt) continue
        if (hit.matchScore <= 0 && !terms.some((term) => row.normalizedTitle.includes(term)))
          continue
        const origin = SOURCES.find((item) => item.id === row.pack.source)
        results.push({
          id: row.id,
          title: row.title,
          source: origin.id,
          sourceLabel: origin.name,
          url: origin.homepage,
          excerpt: hit.excerpt,
          lineStart: hit.lineStart,
          lineEnd: hit.lineEnd,
          authority: row.authority,
          releaseId: data.release,
          dataVersion: data.dataVersion,
          sourceRef: row.sourceRef,
          score: score + Math.min(hit.matchScore, 10),
        })
      }
      results.sort((a, b) => b.score - a.score)
      return {
        query: query.trim(),
        results: results.slice(0, limit).map(({ score, ...result }) => result),
        release: data.release,
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw unavailable()
    } finally {
      activeSearches -= 1
    }
  }

  return {
    search,
    async status() {
      let data
      try {
        data = await ready()
      } catch {
        /* A truthful unavailable status still exposes original download channels. */
      }
      return {
        ready: Boolean(data),
        release: data?.release || null,
        documentCount: data?.documents.length || 0,
        sources: SOURCES.map((source) => ({
          ...source,
          documentCount: data?.documents.filter((row) => row.pack.source === source.id).length || 0,
          downloadUrl: `${source.homepage}/files`,
        })),
      }
    },
    async context(messages, source) {
      if (source === 'none') return []
      const questions = messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content)
      let query = questions.at(-1) || ''
      if (/^(那|她|他|它|这|其|继续|后来|还有|具体)/u.test(query.trim()) && questions.length > 1)
        query = `${questions.at(-2).slice(0, 200)} ${query}`
      let relevant = GAME_WORDS.test(query)
      if (!relevant) {
        if (!CHARACTER_QUESTION.test(query)) return []
        const normalized = normalize(query)
        const protagonist = source === 'endfield' ? '管理员' : source === 'arknights' ? '博士' : ''
        const segments = new Set(
          [...segmenter.segment(normalized)]
            .filter((part) => part.isWordLike)
            .map((part) => part.segment),
        )
        try {
          relevant = (await ready()).characters.some(
            (name) =>
              (!AMBIGUOUS_NAMES.has(name) ||
                (name === protagonist && PROTAGONIST_QUESTION.test(query))) &&
              normalized.includes(name) &&
              (name.length > 1 || segments.has(name)),
          )
        } catch {
          return []
        }
      }
      if (!relevant) return []
      if (query.length > 500) {
        const normalized = normalize(query)
        const tail = normalize(query.slice(-420))
        const segments = new Set(
          [...segmenter.segment(normalized)]
            .filter((part) => part.isWordLike)
            .map((part) => part.segment),
        )
        const names = (await ready()).characters
          .filter(
            (name) =>
              (!AMBIGUOUS_NAMES.has(name) || ['博士', '管理员'].includes(name)) &&
              normalized.includes(name) &&
              (name.length > 1 || segments.has(name)),
          )
          .sort((a, b) => Number(tail.includes(b)) - Number(tail.includes(a)))
          .slice(0, 4)
          .join(' ')
          .slice(0, 80)
        query = `${names}\n${query.slice(-(499 - names.length))}`
      }
      return (await search(query, { source, limit: 5 })).results
    },
  }
}

---
license: other
task:
- text-retrieval
---

# PRTS.chat 检索资料集 — 明日方舟

本数据集是 PRTS.chat 为《明日方舟》检索所使用的版本化资料集。它同时收录游戏内文本投影与 PRTS.chat 审校整理内容；游戏文本及相关内容的权利归上海鹰角网络科技有限公司及相关权利人所有。

该存档用于公开下载、版本冻结与可复现检索。文件保持 gzip 压缩，客户端会按
manifest 中的 SHA-256 校验并仅解压命中的索引或正文分片。

## 数据规模与版本

- Release：`agent-corpus-v2-20261018-endfield-1.6.3-release-v3`
- Data version：`08bba055746faa4eb5c2cf0c8fd5e4e1e96c2c2d920114af39aab7a949cee8af`
- 文档：17,801 篇
- 规范行：1,042,840 行
- 压缩文件：988 个，共 172,759,598 字节
- 包含分区：
- `official_game`
- `reviewed_wiki`
- `terra_journey`
- `entities`
- `references`

## 目录与格式

```text
releases/agent-corpus-v2-20261018-endfield-1.6.3-release-v3/
  <pack_id>/
    pack-manifest.json
    shards/*.jsonl.gz
    search-index/*.bin.gz
    catalog/documents.jsonl.gz
  bundles/<pack_id>.tar | <pack_id>.zip
  dataset-manifest.json
```

- `*.jsonl.gz`：gzip 压缩的规范文档 JSONL，每条记录带稳定 `document_id`、正文行号和来源引用。
- `*.bin.gz`：gzip 压缩的浏览器 unigram/bigram/trigram postings 二进制索引。
- `catalog/documents.jsonl.gz`：不含正文的轻量文档目录，供本地插件快速启动。
- `pack-manifest.json`：逐分片大小、SHA-256、文档数和索引边界。
- `dataset-manifest.json`：本存档包含的全部文件、大小和 SHA-256。
- `bundles/*.tar`：PRTS.chat 审校、Wiki、实体与参考资料的 pack 聚合包；内部成员仍为 gzip 分片。
- `bundles/*.zip`：游戏内原始资料 pack 的聚合包，使用传统 ZIP 密码 `arknights`，仅用于增加批量抓取门槛，不作为保密或访问控制机制。

## 下载

下载完整固定版本：

```bash
modelscope download --dataset 'HTiantian/prts-agent-corpus-arknights' \
  --include 'releases/agent-corpus-v2-20261018-endfield-1.6.3-release-v3/bundles/*' \
  --local_dir ./prts-agent-corpus
```

PRTS.chat 浏览器 Agent 首次安装时优先流式读取 pack 聚合包；聚合包不可用时自动回退到
逐分片下载和 PRTS.chat 源站。ZIP 固定密码是公开兼容参数，不代表资料受到加密授权保护。

## 完整性与版本规则

PRTS.chat 的版本 API 是批准版本的唯一真源。本仓库中的文件不得仅凭 `master`
推断为当前版本；客户端必须绑定 release ID、文件大小和 SHA-256。浏览器在写入
IndexedDB 前会校验压缩字节 SHA-256，解压后还会校验大小、JSONL 结构、文档数量和正文哈希。

## 来源与权利说明

- 游戏内文本来源：`Kengxxiao/ArknightsGameData` 的版本冻结投影。
- PRTS.chat 内容：审校 Wiki、《大地巡旅》、实体与版本绑定参考资料。
- 投影方式：PRTS.chat 将各来源规范化为稳定文档、行号与 unigram/bigram/trigram 索引。

本仓库使用 `license: other`，不把游戏内容或混合来源资料错误声明为 MIT/Apache。
数据允许公开浏览与下载；使用者仍应遵守上游项目、原始作品及各分区标注的许可与权利要求。

## 项目

- PRTS.chat：`https://prts.chat/agent-test`
- ArknightsGameData：`https://github.com/Kengxxiao/ArknightsGameData`

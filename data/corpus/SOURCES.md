# PRTS 版本化语料来源

运行 `node scripts/sync-corpus.mjs` 同步当前已批准发布；需要 Node.js 22.18 及以上和 curl。默认并发 10，可用 `--concurrency 8` 调整。重新运行会逐文件复核大小及 SHA-256，仅补齐缺失或损坏文件。只有全部资源验证通过，才原子更新 `current.json`；失败时保留已验证资源供下次复用。

- 批准版本入口：<https://prts.chat/api/agent/data/releases/current>
- 可信发布清单：`https://prts.chat/api/agent/data/releases/<release>/release-manifest.json`
- 可信分区清单：`https://prts.chat/api/agent/data/releases/<release>/<pack>/pack-manifest.json`
- 明日方舟数据集：<https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-arknights>
- 终末地数据集：<https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield>
- 原始下载入口：`https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-<arknights|endfield>/resolve/master/releases/<release>/`

ModelScope 的 `master` 只作为传输入口。脚本从 PRTS 的已批准发布绑定 release ID 和 data version，将两个 dataset manifest 的完整文件集合与可信 pack manifest 的路径、压缩大小和 SHA-256 逐项比对后下载。包含全部文档目录、正文分片、检索索引，以及终末地 localization 目录和全部语言文件。下载只跟随 HTTPS 重定向，不执行下载内容。

所有原始 `.gz` 保持压缩，不写入 Git。发布清单、分区清单、数据集清单、上游 README 和校验报告保留供审查。上游 README 原样保存在 `releases/<release>/sources/<arknights|endfield>/README.md`。资源落盘于 `releases/<release>/<pack>/`，不依赖此文件中的固定版本号。

两个上游数据集均声明 **`license: other`**。游戏文本及相关内容的权利归各自原始权利人所有，审校、Wiki、实体与参考资料遵循各自来源的权利要求。此目录的下载及校验流程不重新授权这些资料，也不将混合来源数据声明为 MIT 或 Apache。完整的原始来源与权利说明请查看随版本保存的上游 README 和 release manifest 的 `licenses` / `publication` 字段。

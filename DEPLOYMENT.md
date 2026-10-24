# VPS 部署

使用 Node.js 24 LTS 和 SQLite，无需安装 MySQL、PostgreSQL 或 Cloudflare 服务。服务器需要 `curl` 下载语料及配图。Node 原生 SQLite 提供数据库访问，不依赖本地编译扩展。

## 首次部署

```sh
npm ci
npm run build
npm start
```

无需 `.env` 即可启动。数据库尚无密码时，服务生成随机初始密码，并在启动日志中输出一次；使用该密码登录后，在「系统设置」修改密码和填写 AI 服务配置。如果希望自行指定初始密码，可在首次启动前复制 `.env.example` 为 `.env` 并填写 `PRTS_PASSWORD`。

访问密码初始化后只以数据库为准，后续修改 `.env` 中的 `PRTS_PASSWORD` 不会重置密码。修改密码需在设置页验证当前密码，成功后立即撤销全部设备会话。数据库只存密码的盐与 scrypt 哈希。AI 密钥、地址和模型也全部存入数据库，设置页保存后立即生效；不再读取或导入 `OPENAI_*` 环境变量。旧版升级后需在设置页配置 AI 服务一次。

默认仅监听 `127.0.0.1:8787`，建议由 Caddy 或 Nginx 提供 HTTPS。HTTPS 部署设置 `PRTS_COOKIE_SECURE=true`，并原样传递 Host。不要把 `.env`、数据库或 `data` 目录设为静态站点根目录。

首次启动建立 SQLite 并初始化访问密码，个人工作台和资源尚未填充。登录后创建工作台，或从旧浏览器迁移个人数据。**启动和构建不会自动下载资源**：进入「系统设置」，手动点击「首次下载语料」和「首次下载图片」；以后使用各自的检查更新按钮。未下载时检索显示未安装，立绘/配图显示占位。

```text
data/
  prts.sqlite        # 个人数据、会话、文件元信息、密码哈希与 AI 配置
  prts.sqlite-wal    # SQLite 运行期间的日志，不要单独删除
  prts.sqlite-shm
  uploads/           # 用户附件，应用只通过受认证 API 读取
  corpus/            # 手动下载的语料
  assets/            # 手动下载的立绘和配图
```

`PRTS_DB_PATH` 可指定持久磁盘上的数据库文件。其他数据子目录与该数据库放在同一父目录。进程用户必须可写该目录。建议单个 Node 进程提供个人工作台服务；不要把 SQLite 文件放在网络文件系统上。

## Docker Compose

需要 **Docker Compose 2.24.0 或更高版本**，以支持可选的 `.env` 文件；参见 [Docker Compose 的可选 env_file 说明](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/#additional-information-1)。

```sh
docker compose up -d --build
docker compose logs prts
```

没有 `.env` 也可运行。第一次使用新数据卷时，从日志获取随机初始密码，登录后在设置页修改密码和配置 AI。初始密码只输出一次，不会在后续启动日志中重复显示。需要 HTTPS Cookie 等部署参数时，再按 `.env.example` 创建 `.env`。

镜像构建不包含本机 `.env`、数据库、上传文件、语料或原始配图。首次部署的数据卷为空；`prts-data` 卷保存运行数据，更新容器不会丢失。不要使用 `docker compose down -v`，它会删除数据卷。

## GitHub Actions 发布到 Docker Hub

工作流位于 [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)，目标固定为 [`tano26/prts`](https://hub.docker.com/r/tano26/prts)。

首次配置：

1. 在 Docker Hub 的 `tano26` 账号下创建 `prts` 仓库；公开镜像可让 VPS 直接拉取。
2. 在 Docker 账号的 **Account settings → Personal access tokens** 创建令牌，选择 **Read & Write**（部分界面显示 **Repo Read & Write**）。不需要 Delete 权限，令牌必须能推送 `tano26/prts`。参见 [Docker 令牌权限说明](https://docs.docker.com/security/access-tokens/reference/)。
3. 打开 GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**，添加下面唯一必需的 Secret：

   | Secret 名称       | 值                               |
   | ----------------- | -------------------------------- |
   | `DOCKERHUB_TOKEN` | 上一步生成的 Docker Hub 访问令牌 |

用户名 `tano26` 已写入工作流，不需要 `DOCKERHUB_USERNAME`；也不需要添加 `GITHUB_TOKEN`。应用的访问密码和 AI 配置在运行时保存在 VPS 数据库中，不用于镜像构建。

将代码及工作流提交并推送到 GitHub 后，触发规则如下：

| 操作                                           | 发布的 `tano26/prts` 标签                             |
| ---------------------------------------------- | ----------------------------------------------------- |
| 推送 `main`，或在 Actions 手动选择 `main` 运行 | `edge`、`sha-<完整提交 SHA>`                          |
| 推送正式版本标签，例如 `v1.0.0`                | `1.0.0`、`latest`、`sha-<完整提交 SHA>`               |
| 推送预发布标签，例如 `v1.1.0-rc.1`             | `1.1.0-rc.1`、`sha-<完整提交 SHA>`；不会改动 `latest` |
| 手动选择其他分支运行                           | 仅 `sha-<完整提交 SHA>`                               |
| 向 `main` 提交 Pull Request                    | 执行测试和镜像启动检查，不登录或推送 Docker Hub       |

例如，在希望发布的提交上创建版本标签并推送：

```sh
git tag v1.0.0
git push origin v1.0.0
```

标签使用 `v主版本.次版本.修订版本`，可添加 `-rc.1` 等预发布后缀。`latest` 指向最近成功发布的正式版本；重跑旧版本也会更新它。需要固定部署版本时使用明确的版本号或工作流摘要中的镜像 digest。

每次运行先在 Node.js 24 上执行单元及接口测试，再构建镜像并验证首页、登录保护、SQLite 和空资源目录。通过后发布 `linux/amd64` 与 `linux/arm64` 的多架构镜像，Docker 会自动选择 VPS 的架构。Actions 摘要提供实际发布的标签和 digest。第三方 Actions 固定到提交 SHA，Dependabot 每周检查更新。

## 从 Docker Hub 部署

使用仓库内的 `compose.hub.yaml`，不需要在 VPS 安装 Node.js 或编译源码；`.env` 可选，Compose 版本要求同上：

```sh
docker compose -f compose.hub.yaml pull
docker compose -f compose.hub.yaml up -d
docker compose -f compose.hub.yaml logs prts
```

首次使用新数据卷时，从日志获取随机初始密码；然后登录设置页修改密码并配置 AI。若首次初始化前已经通过 `.env` 指定 `PRTS_PASSWORD`，则使用该密码，日志不会输出它。

默认拉取 `tano26/prts:latest`，需先成功发布至少一个正式版本标签。若仅推送过 `main`，可在 `.env` 中添加 `PRTS_IMAGE_TAG=edge`；正式部署建议填写固定版本，例如 `PRTS_IMAGE_TAG=1.0.0`。私有 Docker Hub 仓库需要先在 VPS 登录 Docker Hub。

更新时修改 `.env` 中的 `PRTS_IMAGE_TAG`（如果固定了版本），然后执行：

```sh
docker compose -f compose.hub.yaml pull
docker compose -f compose.hub.yaml up -d
```

源码版与 Hub 版使用相同的数据卷名称。在同一目录/Compose 项目名下切换可保留数据；更换目录时使用相同的 `-p` 项目名或显式迁移数据卷。不要同时启动两套实例操作同一数据库。新数据卷中语料和图片为空，登录后在「系统设置」中手动下载；更新镜像不会触发资源下载。

## 运行日志

服务默认将 JSON 运行日志写入标准输出（info）和标准错误（warn/error），Docker 会直接收集，不需要开启额外环境变量，也不会写入 SQLite 或容器内的日志文件。

```sh
# Hub 镜像部署
docker compose -f compose.hub.yaml logs -f --tail=100 prts

# 直接使用 docker run 部署，将容器名替换为实际名称
docker logs -f --tail=100 <容器名>
```

日志包括启动与关闭、HTTP 请求的方法/接口/状态码/耗时、服务端异常，以及 Webhook 和 SMTP 发送、失败与重试结果。请求携带独立的 `requestId`，响应头 `X-Request-ID` 返回同一标识，便于定位某次请求。未完成即断开的连接记录为 499。通知失败日志包含 `channel`、`attempt`、`status`，待重试时还包括 `retryInMs`；可识别的底层错误记录安全的类型和错误码，例如 `EAUTH`、`ECONNREFUSED`、`ENOSPC`。

请求日志不包含请求/响应正文、Cookie、认证头、查询参数、文件名或动态记录 ID；底层异常不输出原始消息。初次生成的随机访问密码仍仅按前文说明输出一次。语料、图片同步的详细进度仍可在设置页面查看。旧版镜像只有启动日志，需要更新到包含本次日志修复的镜像才能看到运行日志。

## HTTPS 反向代理

手机 PWA 安装需通过 HTTPS 域名访问（本机 localhost / 127.0.0.1 开发环境例外）。部署后在「系统设置 → 手机桌面应用」查看安装指引；普通 HTTP 局域网 IP 仍可访问网页，但无法启用完整安装与离线页功能。

Node 服务已为 `/manifest.webmanifest` 设置正确 MIME，并对 `/sw.js` 和清单使用 `Cache-Control: no-cache`。反向代理应保留这些响应头，避免给 Service Worker 脚本强制设置长期缓存。更新镜像后，已打开的应用会提示新版本，用户保存编辑并点「更新应用」后刷新；不会主动刷新正在编辑的页面。

Service Worker 仅缓存公开图标、安装清单和离线页，不缓存任何 `/api` 响应、工作台内容、附件、语料和游戏图片。离线时不能读取或修改服务器数据，联网后重新验证登录。安装桌面应用不会创建独立数据库，也不会改变 VPS 的数据卷和备份方式。

示例 Caddy 配置：

```caddyfile
prts.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

使用 Nginx 时保留 `Host`，并将上传请求限制设置为 `client_max_body_size 140m`（目前附件 API 使用 Base64 JSON，20 MB 单文件与 100 MB 总容量由应用另行限制）。

## 备份和恢复

在线备份 SQLite：

```sh
npm run db:backup
# 或指定一个不存在的目标路径
npm run db:backup -- backups/prts-manual.sqlite
```

命令使用 SQLite 在线备份 API，包含 WAL 中的已提交内容，随后运行完整性快速检查；目标已存在时拒绝覆盖。

**SQLite 备份不包含附件原文。** 完整私人数据备份应在暂停写入后同时保存数据库和 `uploads/`。最简单的做法是停止服务后备份整个 `data/`（包括仍存在的 WAL/SHM）；运行中的数据库不要只复制 `.sqlite` 主文件。

恢复时停止服务，把一致的数据库备份放回 `PRTS_DB_PATH`，恢复对应的 `uploads/` 并设置正确的属主/权限，再启动。图片和语料丢失时可重新手动下载；它们不会因为登录或重启而自动恢复。

AI API 密钥存入 SQLite，但设置接口不回传已有密钥；访问密码只保存盐与哈希。数据库备份包含 AI 密钥、密码哈希、个人内容及会话信息，请与服务器数据目录使用相同访问保护。恢复数据库也会恢复对应的密码及 AI 配置，环境变量不会覆盖恢复后的配置。

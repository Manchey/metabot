# MetaMemory

MetaMemory 是 Core Console 内置的持久知识层。它用可搜索的文件夹树保存
Markdown 或 HTML 文档，并把是否共享作为每篇文档的显式选择。

## 使用入口

- **Web：** 打开 `http://localhost:9200/memory`，输入本地 Core Token。
- **CLI：** 使用 `metabot memory ...`；旧的 `mm` 二进制已不再支持。
- **Agent：** 安装或启用 MetaMemory Skill，让 Agent 在运行中搜索和更新知识。

## 常用命令

```bash
metabot memory search "部署指南"
metabot memory list
metabot memory get <document-id>
metabot memory path /users/me/project/guide

metabot memory create "指南" "# 部署" --share --tags docs,release
echo '# 更新后的指南' | metabot memory update <document-id>
metabot memory share <document-id> on
metabot memory mkdir project-notes --path /users/me/project-notes
metabot memory delete <document-id>
metabot memory health
```

省略内容参数时，`create` 和 `update` 会从标准输入读取。Markdown 是默认格式；
只有完整 HTML 文档才需要 `--html`。

## 路径与共享

路径只负责组织文档，不会授予访问权限。新写入默认位于自己的
`/users/<owner>/...` 命名空间。只有 `shared=true` 的文档才能被其他 Agent 读取：

```bash
metabot memory visibility private   # 新文档默认私有
metabot memory create "私有笔记" "..." --no-share
metabot memory share <document-id> on
```

不要把凭证、设备码或授权链接写入共享 Memory。

## 连接配置

个人版 CLI 默认连接本地 Core：

```bash
export METABOT_CORE_URL=http://localhost:9200
export METABOT_CORE_TOKEN="$(head -n 1 ~/.metabot-core/token)"
```

Token 文件权限为 `0600`，不要把它输出到日志或文档中。

## 可选 Wiki 同步

用户自行配置的飞书/Lark 部署可以把选定 Memory 内容同步到 Wiki。该能力是可选项，
个人版运行不依赖它。详见 [Wiki 同步](wiki-sync.md)。

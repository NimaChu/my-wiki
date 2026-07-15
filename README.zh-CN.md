# Agent Wiki

零成本、零基础，拥有一个 AI Agent 可以帮你维护的本地知识库。

[English](README.md)

你可能已经把资料散落在浏览器收藏夹、聊天记录、PDF、网页、截图和笔记软件里。Agent Wiki 想解决的就是这件事：把有价值的资料整理成一个放在你自己电脑里的知识库，让 AI Agent 帮你入库、整理、检索、总结和持续维护。

它不要求你会 RAG，不要求你买知识库 SaaS，不要求你先学 Obsidian，也不要求你搭数据库。它就是一个普通文件夹，里面是 Markdown、图片、原始资料和一些本地命令。

## 一句话

Agent Wiki 是一个给普通人用的本地知识库模板：

**你负责提需求，AI Agent 负责整理资料，知识留在你自己的电脑里。**

## 适合谁

- 想拥有自己的本地知识库，但不想折腾数据库、向量库、后端服务的人
- 经常让 AI 帮忙读网页、读文档、总结资料的人
- 想把 AI 对话里的有用知识沉淀下来，而不是每次从头问的人
- 想保存图片、截图、官方文档、教程，并在提问时让 AI 一起引用的人
- 想要一个开源、透明、可迁移的个人知识管理方案的人

## 你能得到什么

- **本地知识库**：所有资料都在你的工作区文件夹里，不绑定任何云服务。
- **零成本默认可用**：不需要付费订阅，不需要先买数据库或 API。
- **AI 帮你维护**：你可以让 Codex、Cursor、Claude Code 等 coding agent 帮你入库和整理。
- **保留原始证据**：网页、文档、截图、图片线索会先进入 `raw/`，以后还能追溯来源。
- **沉淀可读笔记**：整理后的长期知识放在 `wiki/`，更适合反复查询。
- **支持图片证据**：重要截图和示意图可以保存到本地，并在回答问题时一起展示。
- **按需知识图谱**：只有当你想看知识图谱时，才启动本地 dashboard。
- **私有知识不必上传 GitHub**：GitHub 可以只同步工具代码，你的资料留在本地。

## 它长什么样

```text
agent-wiki/
  raw/          原始资料、网页抓取、截图、图片索引
  wiki/         整理后的长期知识页
  templates/    笔记模板
  src/          核心命令源码
  scripts/      兼容入口和本地辅助脚本
  tools/        可选的知识图谱 dashboard
```

你不需要一开始理解每个目录。记住两点就够了：

- `raw/` 放原始证据
- `wiki/` 放整理后的知识

## 三分钟开始

先安装到本地：

```bash
git clone https://github.com/NimaChu/agent-wiki.git
cd agent-wiki
npm install
```

检查知识库状态：

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:universes
```

然后打开你的 AI coding agent，对它说：

```text
维护这个本地知识库。
```

就可以开始用了。项目规则已经告诉 agent：维护时要分批处理 raw/，把长期有用的知识蒸馏到 wiki/，补证据链接和知识关系；维护宇宙分组时尽量保持数量少、边界宽而稳定，优先合并或改名，不轻易新增顶层宇宙；本地知识维护不等于推 GitHub，也不会默认启动 dashboard。

## 最常见的用法

### 1. 收藏一篇网页

```bash
npm run wiki:capture -- --title "文章标题" --url "https://example.com"
```

也可以直接让 agent 做：

```text
把这篇文章入库：https://example.com
```

如果 Dashboard 前端已经在运行，入库或维护造成的 `raw/`、`wiki/` 变化会自动刷新到图谱；如果前端没有运行，则不会因此启动或刷新 Dashboard。

### 2. 查询知识库

```bash
npm run wiki:search -- "你的问题关键词"
```

或者直接问 agent：

```text
基于本地知识库，解释一下这个知识点，并给出来源。
```

### 3. 保存文章里的图片

如果一篇资料里图片很重要，可以运行：

```bash
npm run wiki:images -- --source raw/source-note.md
```

之后 agent 在回答相关问题时，就可以引用这些本地图片。

### 4. 看知识图谱

平时不需要启动 dashboard。只有你想看知识之间的连接时再运行：

```bash
npm run dashboard
```

然后打开：

```text
http://127.0.0.1:5173/
```

## 为什么不用一上来就做 RAG

很多人一说知识库就想到向量数据库、embedding、召回、重排、服务部署。对小白来说，这些东西太早了。

Agent Wiki 的思路更简单：

1. 先把资料保存下来。
2. 再让 AI 帮你整理成可读笔记。
3. 每条结论尽量能回到原始来源。
4. 需要图的时候，把图也保留下来。
5. 以后真的需要 RAG，再从这套干净的 Markdown 知识库升级。

也就是说，它不是反对 RAG，而是让你先用最低成本拥有一套可维护、可迁移、可追溯的知识资产。

## 和普通笔记软件有什么不同

普通笔记软件通常需要你自己整理。

Agent Wiki 默认假设：**整理这件事可以交给 AI Agent。**

你可以让 agent：

- 把网页入库
- 总结一篇长文
- 抽取关键知识点
- 建立主题页
- 修复坏链接
- 找出还没整理的资料
- 给回答附上来源和图片

你更像是在指挥一个资料管理员，而不是从零手动写笔记。

## GitHub 和本地知识的边界

这个仓库适合开源的是工具本身：

- 命令行脚本
- 模板
- dashboard
- README
- 工作流说明

你的个人知识一般不需要推到 GitHub：

- 抓取的网页
- 私人笔记
- 本地图片
- 文档快照
- 个人 wiki 页面

简单记：

```text
改进工具能力 -> 可以提交 GitHub
维护自己的知识库 -> 留在本地
```

## 可选：Firecrawl MCP

如果你的 agent 环境支持 MCP，这个项目内置了 Firecrawl MCP 配置：

```text
https://mcp.firecrawl.dev/v2/mcp
```

这可以帮助 agent 抓取一些普通方式不好抓的网页。没有 Firecrawl 也可以使用 Agent Wiki；它只是一个可选增强。

## 可选：IMA 桥接

Agent Wiki 也可以把 IMA 知识库里的资料导入成本地 raw。

这个功能是可选的，需要用户明确确认并配置 IMA OpenAPI 凭证，也需要确认这些资料可以保存到本地。默认机制是 local-first：`wiki:sync-ima` 会把选中的 IMA 条目下载到 `raw/ima/`，生成普通的 `status: inbox` 源笔记。文本会写入 `## Capture`，二进制原文件会保存到 `raw/snapshots/ima/`，图片或富图片内容会尽量进入 `raw/assets/` 和图片索引。

```bash
npm run wiki:sync-ima
npm run wiki:fetch-ima -- raw/ima/source-note.md --metadata
```

导入后的 IMA raw 和普通 `inbox` 一样维护：让 agent 提炼 durable wiki 页面、补好 raw/wiki 证据链接，最后再标记为 `processed`。旧版本留下的 `ima-pointer` 只作为 legacy 格式存在，需要先用 `npm run wiki:fetch-ima -- raw/ima/source-note.md` 拉成本地 inbox，再走常规维护流程。

详细 agent 流程见：`docs/ima-local-import.md`。

## 常用命令

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:garden
npm run wiki:universes
npm run wiki:repair-links
npm run wiki:search -- "query terms"
npm run wiki:capture -- --title "Source title" --url "https://example.com"
npm run wiki:images -- --source raw/source-note.md
npm run wiki:sync-ima
npm run wiki:fetch-ima -- raw/ima/source-note.md --metadata
npm run dashboard
```

## 需要准备什么

必需：

- Node.js 18+
- npm
- 一个 AI coding agent，比如 Codex、Cursor、Claude Code 等

可选：

- Obsidian：如果你想用图谱、反链、Markdown 编辑体验
- Firecrawl MCP：如果你想增强网页抓取能力
- IMA OpenAPI：如果你想桥接已有 IMA 知识库
- GitHub：如果你想同步和改进这个工具项目

## 开源许可证

Agent Wiki 使用 [MIT License](LICENSE.txt) 开源。

## 给第一次使用的人

不要一开始就追求完美分类。先把资料放进来，然后让 agent 慢慢整理。

你可以从一句话开始：

```text
维护这个本地知识库。
```

这就够了。

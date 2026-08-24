# My Wiki

![GitHub stars](https://img.shields.io/github/stars/NimaChu/my-wiki?style=flat-square)
![npm version](https://img.shields.io/npm/v/my-wiki-skill?style=flat-square)
![npm downloads](https://img.shields.io/npm/dm/my-wiki-skill?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-111111?style=flat-square)
![Local First](https://img.shields.io/badge/Local-First-2E7D32?style=flat-square)
![Markdown](https://img.shields.io/badge/Knowledge-Markdown-1565C0?style=flat-square)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853D?style=flat-square)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE.txt)

**My Wiki 是一个可直接交给 AI Agent 使用的本地优先知识管理项目。项目主体提供 CLI、可视化知识宇宙、知识维护和 Viki 问答；仓库内另带一个可单独安装的轻量 Skill，用于让其他工作区中的 Agent 调用已安装项目。**

[简体中文](README.md) · [English](README.en.md)

<img width="1536" height="1024" alt="AI Agent 将本地资料整理成可追溯知识库" src="https://github.com/user-attachments/assets/bea713c3-8d37-427b-ab04-5f601123f252" />

网页、PDF、扫描件、图片、Office 文档、聊天记录和官方资料里有大量有价值的信息，但它们通常散落在不同位置，很难持续整理，更难在以后准确复用。

My Wiki 让本地 AI Agent 负责知识的完整生命周期：保存原始资料，提取可读正文，蒸馏原子 Wiki，建立关系与证据链接，回答问题，维护知识健康，并通过网页把知识呈现为可以探索和操作的知识宇宙。

默认不需要云数据库、向量数据库、Obsidian 或付费 API。知识以 Markdown、原始文件、快照和图片保存在你控制的本地文件夹中。

## 项目主体与 Skill 分离

My Wiki 的运行主体位于仓库根目录。把仓库作为 Agent 工作区打开后，Agent 可依据 `AGENTS.md` 直接运行 CLI、Dashboard、测试和容器部署，不需要先安装 Skill。

`my-wiki-skill/` 是项目的一部分，但只是可选适配层。它可以单独安装到 Codex、Claude Code、OpenCode 等客户端；使用时会定位已注册的 My Wiki 项目。Skill 不再复制应用代码，也不保存知识库。若项目主体或本地知识库尚未建立，Agent 会先征得用户确认，再代为安装项目并初始化独立 vault。

```text
my-wiki/
  AGENTS.md          Agent 打开项目时的入口说明
  scripts/           CLI 与知识维护主体
  assets/dashboard/  网页应用与本地服务
  deploy/            独立部署方案
  tests/             项目测试
  my-wiki-skill/     可单独安装的轻量 Agent 适配层
```

| 使用入口 | 需要全局 Skill | 需要项目主体 | 说明 |
|---|---:|---:|---|
| Codex/OpenCode 直接打开 `my-wiki` 项目 | 否 | 是 | Agent 读取根目录 `AGENTS.md` 和仓库内工作流 |
| Dashboard、Viki 与网页维护 | 否 | 是 | 后端直接调用已登录的本地 Agent CLI |
| 从知识库目录或其他项目中调用 My Wiki | 是 | 是 | Skill 负责发现或在确认后补齐项目与 vault |

全局 Skill 不是 Dashboard 或 CLI 的运行依赖。只在 My Wiki 项目中工作时，无需把它安装到 Codex 或 OpenCode 的全局 Skill 目录。

My Wiki 由两个相互配合的使用界面组成，共享同一个本地知识库：

| | Agent 项目 / 可选 Skill | 知识宇宙网页前端 |
|---|---|---|
| 适合场景 | 在 Codex、Claude Code、OpenCode 等客户端中直接聊天 | 浏览、比较、维护和可视化操作知识 |
| 主要交互 | 用自然语言让 Agent 入库、维护、检索和回答 | 用鼠标探索图谱、上传资料、处理队列、询问 Viki |
| 知识范围 | Wiki、raw 原始证据、图片、快照和本地文件 | 知识宇宙、知识星系、Wiki 星球与原文证据层 |
| Agent 能力 | 使用当前 Agent 客户端执行完整工作流 | 调用已登录的本地 Codex、OpenCode 或 Claude CLI |
| 数据位置 | 你指定的本地知识库目录 | 同一个本地知识库目录 |

你可以只使用其中一种，也可以在聊天和网页之间随时切换。两种方式读写的是同一套知识，不需要同步两份数据。

## 三种使用方式

### 1. 把项目作为 Agent 工作区打开

克隆并注册项目后，用 Codex、Claude Code、OpenCode 等 Agent 直接打开项目目录，然后说人话：

```text
在 D:\Knowledge\Personal 创建一个 My Wiki 知识库并设为默认。
把这篇文章入库：https://example.com/article
把这个 PDF 和其中的重要图片保存到知识库。
维护知识库。
根据本地知识回答这个问题，并展示相关证据图片。
```

Agent 会自动定位知识库，保存 raw 原始证据和附件，创建或更新原子 Wiki，维护双向关系，并优先用 Wiki 回答、再回到 raw 核实重要结论。你不需要记忆一套 CLI。

### 2. 在其他工作区中通过 Skill 使用

安装仓库中的 `my-wiki-skill/` 后，Agent 可以从其他项目调用同一套 My Wiki 主体和本地知识库。Skill 只负责工作流、项目发现与引导安装；项目或 vault 缺失时，它会在用户确认后补齐，而不会把主体或知识内容复制进 Skill 目录。

### 3. 打开知识宇宙网页前端

对 Agent 说：

```text
打开知识宇宙。
打开 My Wiki 前端。
打开知识图谱。
```

Agent 会启动本地网页应用。你可以：

- 在知识宇宙中观察多个知识星系及其交会；
- 进入知识星系，查看三维 Wiki 星球关系网络；
- 打开 Wiki 页面，继续进入它背后的 raw 原文证据层；
- 搜索 Wiki、关系和来源，而不破坏当前图谱层级；
- 双击 Wiki 或证据点进入轻量 Markdown 工作台，在阅读、源码和实时分屏间切换；文档大纲、公式/表格工具、图片粘贴与拖入都直接作用于受控的本地 Markdown 与 `references/assets/`，不引入第二套笔记数据库；
- 输入网页链接，或上传文件、文件夹和 Markdown + 图片 ZIP 图文包；
- 查看统一维护队列：上传进入后台后立即显示等待、提取进度或失败状态，并可按 Reference 独立蒸馏或修复；批量维护会依据每条状态自动选择动作。本地提取使用独立的 2 个并发槽位，Agent 修复/蒸馏使用另一组 2 个并发槽位，同一 Reference 不会重复执行；
- 查看大文件与知识包进度：分片上传、逐页 OCR 和分批 MinerU 显示实际字节或页数，单进程提取、导入预览与最终写入显示当前处理阶段；
- 使用常驻知识伙伴 Viki 基于 Wiki、raw 证据和相关图片进行问答；
- 在 Viki 中独立选择 Agent CLI 与宠物形态，并调整聊天窗口大小；
- 新增、重命名、隐藏/显示或删除知识星系，并可导出单个星系、预览及导入别人分享的 `.mywiki` 知识包；删除星系只移除分类，保留 Concept 与 Reference。

网页前端只监听 `127.0.0.1`。日常通过 Agent 入库或维护时不会自动启动它；只有你明确要求打开知识宇宙、前端或 Dashboard 时才会启动。

## 从资料到可复用知识

```text
网页 / PDF / 扫描件 / 图片 / Office 文档 / 外部平台
                         |
                         v
                    raw 证据层
              原文、快照、原件、图片、元数据
                         |
                     AI Agent
              蒸馏、关联、核实、维护、修复
                         |
                         v
                   原子 Wiki 页面
             概念、方法、API、实体、流程
                         |
          +--------------+--------------+
          v                             v
     有依据的知识问答               知识宇宙网页
```

My Wiki 不是给每份文档生成一段摘要。一份资料可以更新多个长期 Wiki，一个 Wiki 也可以综合多份原始证据。只有 Wiki 已建立、raw 与 Wiki 的双向证据关系闭合、后续事项处理完成，一份 raw 才会被标记为 `processed`。

这种结构让知识可以被反复使用：今天保存的资料可以更新已有 Wiki，明天的新问题可以复用这些 Wiki，重要结论仍然能一路回到原文、图片或 PDF 核实。

## 探索知识宇宙

<img width="1785" height="881" alt="My Wiki 交互式知识宇宙、知识星系和 Wiki 星球" src="https://raw.githubusercontent.com/NimaChu/my-wiki/main/.github/assets/knowledge-universe.png" />

- **知识宇宙**：整个知识库的全局视图，展示多个知识星系以及它们通过共同 Wiki 形成的联系。
- **知识星系**：一组成体系、可以独立理解和复用的知识集合，例如 FlexSim、Agent 开发或项目经验。
- **Wiki 星球**：一篇原子 Wiki，表达一个概念、方法、实体、流程或可长期复用的结论。
- **原文证据层**：支撑某篇 Wiki 的网页、Markdown、PDF、图片和其他 raw 来源。

图谱不是额外维护的一套数据库。它直接从 Wiki 与 raw 的关系生成，知识发生变化时，运行中的前端会自动刷新。

## 分享和复用知识星系

知识星系可以导出为单个 `.mywiki` 知识包。它不是只有几篇摘要，而是一套带证据的知识集合，包含：

- 这个星系的 Wiki Markdown；
- Wiki 关联的 raw Markdown；
- 可用的来源 URL；
- 相关图片与图像索引；
- raw 明确引用的网页快照、PDF 和其他原始文件。

接收方可以先预览重复项、重命名和冲突，再确认导入自己的知识宇宙。即使原始资料没有 URL，例如本地 PDF，知识包仍然可以保留完整证据。

你既可以在网页中导入和导出，也可以直接告诉 Agent：

```text
把“FlexSim”知识星系导出成知识包。
预览导入这个 flexsim.mywiki 知识包。
确认导入，并把星系名改成“仿真工程”。
```

这使 My Wiki 不只是个人资料整理工具，也可以成为可传播、可验证、可继续维护的知识生态基础。

### Open Knowledge Format v0.2

Wiki 概念默认采用 [Google Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format) 可消费的 Markdown 表达：标准 YAML frontmatter、`draft|stable|deprecated` 生命周期、结构化来源对象、标准 Markdown 关系链接和按来源 ID 连接的证据脚注。My Wiki 的知识星系、别名和证据闭环字段作为 OKF 允许的扩展键保留；系统不会把“已经蒸馏”冒充为人工验证。

```bash
# 审计当前 Wiki 的 OKF v0.2 兼容性
npm run wiki -- okf-audit

# 预览旧 Wiki 的迁移数量；--apply 会先备份 concepts/ 再转换
npm run wiki -- okf-migrate
npm run wiki -- okf-migrate --apply

# 导出全部知识或单个知识星系为独立 OKF directory bundle
npm run wiki -- export-okf
npm run wiki -- export-okf --galaxy "AI" --output /path/to/ai-okf
```

`.mywiki` 是经过 OKF v0.2 审计的可移植知识星系包：包内直接采用 `index.md`、`log.md`、`concepts/`、`references/` 布局，并在清单中保留星系名、工作流状态、校验和与冲突处理等 My Wiki 扩展。解包后的知识内容可被通用 OKF 消费者读取，My Wiki 则额外恢复可继续维护的证据闭环。

## 为什么选择 My Wiki

- **本地优先**：Markdown、原件、网页快照和图片都在你控制的目录中。
- **Agent 自动维护**：短指令即可完成入库、蒸馏、链接、检查和修复。
- **结论可追溯**：Wiki 结论回链 raw，重要信息可以核实到原文与图片。
- **面向复用而非堆积**：资料被整理成原子 Wiki 和关系，而不是只进入一个搜索黑盒。
- **网页应用可操作**：不仅看图谱，还能添加资料、处理维护队列、问 Viki、导入和导出知识星系。
- **支持多种本地文档**：文本 PDF、扫描 PDF、图片、DOCX、PPTX、XLSX、文件夹批次和 ZIP 图文包。
- **质量感知的 PDF 解析**：逐页检查乱码、稀疏文本和公式版面风险；中文 OCR 会清理逐字空格，低质量页面不会静默进入维护。
- **失败不会伪装成功**：空内容、低置信度或不完整解析会锁定为 `needs-followup`，不会被当成已读资料。
- **开放且可迁移**：Wiki 可审计并导出为 OKF v0.2，知识也可用任意 Markdown 编辑器打开或接入 Obsidian、RAG 和其他 Agent 工具。
- **零成本起步**：只需要 Node.js 和一个已经可用的本地 Agent 客户端。

### 统一文档提取与验收

My Wiki 自己定义文档 IR、逐页质量门禁和验收报告，外部解析器不能自行宣布资料可维护。每次本地文档提取都会在知识库的 `.my-wiki/extractions/` 写入一份可读的 `*.report.json` 和压缩的 `*.document.json.gz`；Raw frontmatter 记录两者路径。报告统一汇总页覆盖、版面/OCR 质量、公式、编码和本地附件门禁，只有通过硬门禁的证据才能进入蒸馏。

推荐工具链分工如下：

- [MinerU](https://github.com/opendatalab/mineru) 是中文扫描件、公式与表格密集技术 PDF 的主解析器。
- [Docling](https://github.com/docling-project/docling) 提供统一结构、阅读顺序、表格和元素级页码/bounding box provenance，也是 Office、OpenDocument 和 EPUB 的首选解析器。
- My Wiki 内置的 Agent 视觉修复器借鉴 doc7 的页级视觉重建思路：将中央门禁标出的风险页渲染为图片，交给现有 OpenCode 或 Codex CLI 的多模态模型。结果必须明显优于原页才会替换，并记录 provider、模型与被拒绝页，不需要安装 doc7。
- PDF.js/Tesseract 是无高保真引擎时的降级路径，不能覆盖已经实际运行但失败的 MinerU 或 Docling 结果。

安装 `uv` 后，在 macOS、Windows 或 Linux 项目目录运行：

```bash
npm run document:setup
npm run document:doctor
```

该命令安装项目验证过的 MinerU 与 Docling；模型文件由各引擎首次使用时下载。疑难页视觉修复复用已经登录的 OpenCode/Codex CLI 与其中可用的多模态模型，不安装额外文档 CLI。`npm run pdf:setup` 仍保留为只安装 MinerU 的兼容命令。

自动 PDF 路由默认先用 MinerU；仅当 MinerU 不可用时尝试 Docling，再降级到 PDF.js/Tesseract。可用 `MY_WIKI_PDF_ENGINE=mineru|docling|pdfjs|tesseract` 强制指定。风险页视觉修复默认复用可用的 OpenCode/Codex，可用 `MY_WIKI_VISUAL_REPAIR_MODE=off|auto|required`、`MY_WIKI_VISUAL_REPAIR_PROVIDER`、`MY_WIKI_VISUAL_REPAIR_MODEL` 和 `MY_WIKI_VISUAL_REPAIR_MAX_PAGES` 控制。超过 512 页的 PDF 默认按 64 页分批运行 MinerU，再恢复连续页码和图片命名空间；`MY_WIKI_MINERU_BATCH_THRESHOLD_PAGES` 和 `MY_WIKI_MINERU_BATCH_PAGES` 可调整批次。

完整的 IR、路由、报告字段和验收规则见 [`docs/document-extraction.md`](docs/document-extraction.md)。

最终写入 Raw 的 `## Capture` 正文还会执行编码完整性门禁。任何 U+FFFD 替换字符都会按页记录并将 Raw 锁定为 `needs-followup`；捕获、重提取、Agent 修复、维护预检和 `lint` 都会重复验证，避免后续写回造成的乱码沿用旧质量分数。

## 与 RAG、LLM + Obsidian 的区别

My Wiki 重点解决知识进入检索之前的整理层：把原始资料变成可读、有关系、能核实、可维护的长期知识。

| | My Wiki | 传统 RAG | LLM + Obsidian |
|---|---|---|---|
| 开始使用 | 克隆 Agent 项目并建立独立本地知识库；Skill 按需安装 | 搭建切片、Embedding、召回、存储和服务 | 安装编辑器和插件，再设计提示词与笔记规范 |
| 主要存储 | Markdown、原始文件、快照和本地图片 | 向量索引加外部原文存储 | Markdown Vault |
| 谁来整理 | Agent 维护 raw、原子 Wiki、关系和健康状态 | 流水线索引文本切片，可读知识通常另做 | 通常由用户手工整理，LLM 提供辅助 |
| 可追溯性 | Wiki 与 raw 双向链接并可自动检查 | 取决于检索元数据和应用设计 | 可以做到，但依赖用户习惯 |
| 网页能力 | 内置知识宇宙、录入、维护、Viki 和知识包交换 | 通常需要单独开发应用 | 主要是编辑器内的笔记浏览与插件能力 |
| 分享单元 | 带 Wiki、raw、图片和原件的知识星系 | 索引或应用特定的数据包 | 文件夹或整个 Vault |
| 更适合 | 个人、团队和项目知识的长期管理与复用 | 大规模语义检索和生产服务 | 人工写作、链接和浏览笔记 |

My Wiki 不排斥 RAG 或 Obsidian。你可以用 Obsidian 打开同一个知识库，也可以在规模真正需要时，把已经整理干净的 Markdown 证据层交给 RAG。

## 快速开始

需要 Node.js 18+ 和 npm。先安装并注册项目主体：

```bash
git clone https://github.com/NimaChu/my-wiki.git
cd my-wiki
npm run setup
npm run wiki -- init /path/to/my-vault --name personal --use
```

之后可以直接把 `my-wiki` 项目目录作为 Agent 工作区打开。项目命令也可独立运行：

```bash
npm run wiki -- status
npm run dashboard:open
```

需要在其他工作区中通过自然语言调用 My Wiki 时，再安装轻量 Skill：

```bash
npm run skill:install
# 或安装发布版 Skill
npx my-wiki-skill@latest
```

`npm run setup:all` 可以一次注册当前项目并安装仓库内的 Skill。国内网络安装发布版 Skill 时可使用 `npx --registry=https://registry.npmmirror.com my-wiki-skill@latest`。

安装器会自动探测常见 Agent Skill 目录：

| Agent 客户端 | 默认 Skill 目录 | 安装支持 |
|---|---|---|
| Claude Code | `~/.claude/skills` | 自动探测或 `--target claude` |
| Codex | `~/.codex/skills` | 自动探测或 `--target codex` |
| OpenCode | `~/.config/opencode/skills` | 自动探测或 `--target opencode` |
| OpenClaw | `~/.openclaw/workspace/skills` | 自动探测或 `--target openclaw` |
| Hermes Agent | `~/.hermes/skills` | 自动探测或 `--target hermes` |
| 其他兼容 `SKILL.md` 的 Agent | 由宿主决定 | 使用 `--dir <Skill目录>` |

安装 Skill 后需新开或刷新 Agent 会话。Skill 会调用已注册的项目主体；找不到项目或默认知识库时，它会先请求确认，再完成安装或初始化，不会把知识写进 Skill 或源码仓库。

## 本地知识库结构

知识库可以放在电脑任意位置，与项目主体和 Skill 安装目录完全分离：

```text
my-vault/
  index.md                 OKF 知识入口
  log.md                   OKF 更新日志
  concepts/                可长期复用的原子 Wiki 页面
  references/
    sources/               原始证据的 Markdown Reference
    assets/                每篇来源独立保存的图片与图像索引
    originals/             网页快照、PDF、Office 文档和其他原件
  templates/               当前知识库使用的 Markdown 模板
  .my-wiki/                本地缓存、运行状态、导入导出记录
```

`Concept.status` 与 `Reference.status` 使用 OKF 生命周期 `draft | stable | deprecated`。My Wiki 的维护流程单独写入 Reference 的扩展字段 `workflow_status: inbox | needs-followup | processed | stale`，两者不再复用同一个 `status`。

网页与 Agent 使用相同的本地解析质量门槛。文本 PDF 会逐页提取，扫描件和图片会本地 OCR，DOCX、PPTX、XLSX 会转换为结构化 Markdown；原文件始终保留在 `references/originals/`。

代码仓库和 npm Skill 包不包含你的知识库、本地 MCP 凭据或运行日志。知识库是否备份、同步、加密或始终留在一台电脑上，由你决定。

## 可选能力

- **Obsidian**：可以作为同一套 Markdown 知识库的人工编辑器，但 My Wiki 不依赖它。
- **Firecrawl MCP**：增强动态或难抓取网页的入库能力；完整托管爬取可能需要 Firecrawl 认证。
- **IMA 和其他外部平台**：先把得到授权的资料迁移到本地 raw，再走同一套维护流程。
- **RAG**：未来需要 Embedding 和生产级检索时再接入，不必放弃已有的 raw 与 Wiki。

## 开源许可证

My Wiki 源码使用 [MIT License](LICENSE.txt)。Dashboard 内置宠物资源保留各自的作者和许可说明，详见 [宠物资源说明](assets/dashboard/pets/NOTICE.md)。

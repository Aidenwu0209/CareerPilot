<div align="center">

# CareerPilot

**面向简历、面试与职业形象的开源 AI 求职平台**

在一个双语平台中完成专业简历制作、模拟面试、职业照生成与托管 AI 服务运营。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed)](#docker-%E9%83%A8%E7%BD%B2%E6%8E%A8%E8%8D%90)
[![质量检查](https://github.com/Aidenwu0209/careerpilot/actions/workflows/quality.yml/badge.svg?branch=develop%2Fcareerpilot)](https://github.com/Aidenwu0209/careerpilot/actions/workflows/quality.yml)

[English](./README.md) · [快速开始](#快速开始) · [商业化运维指南](docs/commercial-operations.zh-CN.md) · [参与贡献](CONTRIBUTING.md)

</div>

---

CareerPilot 覆盖从简历制作、JD 匹配到模拟面试与职业照生成的求职流程。项目支持使用 SQLite 自托管开发、使用 PostgreSQL 进行生产部署，并提供可选的商业化能力，包括托管模型、点数、套餐、支付、退款、对账和运营告警。

> **项目状态：** `main` 为稳定分支，`develop/careerpilot` 保存最新开发版本。外部 AI、支付、邮件、存储与监控服务需要部署者自行提供凭证并完成配置。

## 截图展示

| 模板画廊 | 简历编辑器 |
|:---:|:---:|
| ![模板画廊](images/template-list.png) | ![简历编辑器](images/resume-edit.png) |

| AI 填充简历 | AI 图片简历解析 |
|:---:|:---:|
| ![AI 填充简历](images/AI%20填充简历.gif) | ![AI 图片简历解析](images/图片简历解析.gif) |

| AI 优化 | AI 语法检查 |
|:---:|:---:|
| ![AI 优化](images/ai%20优化.png) | ![AI 语法检查](images/AI%20语法检查.png) |

| 语法一键修复 | JD 匹配分析 |
|:---:|:---:|
| ![语法一键修复](images/AI%20语法检查一键修复.png) | ![JD 匹配分析](images/JD%20匹配分析.png) |

| 多格式导出 | 创建分享链接 |
|:---:|:---:|
| ![多格式导出](images/多项导出.png) | ![创建分享链接](images/创建分享链接.png) |

| 简历分享页 | AI 职业照生成 |
|:---:|:---:|
| ![简历分享页](images/简历分享页.png) | ![AI 职业照生成](images/职业照生成.png) |

| 二维码模块 |
|:---:|
| ![二维码模块](images/二维码.png) |

| 新建面试 | 模拟面试 |
|:---:|:---:|
| ![新建面试](images/新建面试.png) | ![模拟面试](images/模拟面试.png) |

| 面试列表 | 面试报告 |
|:---:|:---:|
| ![面试列表](images/面试列表.png) | ![面试报告](images/面试报告.png) |

## 功能特性

### 简历编辑

- **拖拽编辑器** — 可视化拖拽排列简历模块与条目
- **行内编辑** — 点击任意字段，直接在画布上编辑
- **50 套专业模板** — 经典、现代、极简、创意、ATS 友好、时间线、北欧风、瑞士风等多种风格
- **主题定制** — 颜色、字体、间距、页边距实时预览调整
- **撤销 / 重做** — 完整编辑历史（最多 50 步）
- **自动保存** — 可配置保存间隔（0.3s–5s），支持手动保存
- **Markdown 支持** — 在文本字段中使用 Markdown 语法排版内容（例如 `**加粗**` 可显示**粗体文字**）

### Markdown 格式支持

以下简历模块支持 Markdown 语法：

| 模块 | 支持字段 |
|------|---------|
| 个人简介（Summary） | 正文内容 |
| 工作经历 | 描述、亮点（Highlights） |
| 教育背景 | 亮点（Highlights） |
| 项目经历 | 描述、亮点（Highlights） |
| 自定义模块 | 描述 |
| 语言能力 | 描述 |
| GitHub | 描述 |

**支持的语法：**

```
**加粗文字**    → 粗体
`代码文字`      → 行内代码
- 列表项        → 无序列表
```

> 技能、证书、个人信息等字段暂不支持 Markdown。

### AI 能力

- **AI 聊天助手** — 编辑器内集成对话式 AI，支持多会话和持久化历史
- **AI 一键生成简历** — 输入职位、经验、技能，自动生成完整简历
- **简历解析** — 上传已有 PDF 或图片，AI 自动提取全部内容
- **JD 匹配分析** — 对比简历与职位描述：关键词匹配、ATS 评分、改进建议
- **求职信生成** — 基于简历和 JD 的 AI 定制求职信，可选语气（正式 / 友好 / 自信）
- **语法与写作检查** — 检测弱动词、模糊描述和语法问题，返回质量评分
- **多语言翻译** — 支持 10 种语言互译，保留专业术语原文
- **平台托管 AI 供应商** — 超级管理员统一配置加密凭证，并发布获准的 GPT、Claude、GLM 与 DeepSeek 模型
- **商业化点数体系** — 个人与机构账户支持预占、按次/按 Token 结算、不可变流水与限额
- **多供应商图片编辑** — 职业照支持获准的 Gemini、GPT 与 ERNIE 生图模型；GPT 商品可分别设置 1K 与 4K 档位

### 模拟面试

- **JD 岗位面试模拟** — 粘贴 JD，AI 按顺序扮演不同面试官进行模拟面试
- **6 种预设面试官** — HR 面、技术面、场景面、行为面、项目深挖、Leader 面，各有独特性格和提问风格
- **自定义面试官** — 创建自定义面试官，设定考察维度和风格
- **智能追问** — AI 根据回答质量自适应追问，回答不到位会深入追问
- **面试控制** — 跳过问题、请求提示、标记复习、暂停/继续
- **详细报告** — 逐题评分、能力雷达图、改进建议与推荐资源
- **历史对比** — 追踪评分趋势和能力维度变化
- **报告导出** — 支持 PDF 和 Markdown 格式导出

### 导出与分享

- **多格式导出** — PDF（Puppeteer + Chromium）、智能一页 PDF（自动适配单页）、DOCX、HTML、TXT、JSON
- **JSON 导入** — 导入之前导出的 JSON 文件还原或创建简历；编辑器内覆盖当前简历，仪表盘创建新简历
- **链接分享** — 基于 Token 的分享链接，支持密码保护
- **浏览统计** — 追踪分享简历的查看次数

### 简历管理

- **多简历仪表盘** — 网格和列表视图、搜索、排序（按日期、名称）
- **JSON 导入创建** — 在仪表盘直接通过 JSON 文件创建新简历
- **复制与重命名** — 快捷简历管理操作
- **新手引导** — 交互式分步引导，帮助新用户快速上手

### 其他

- **双语界面** — 完整的中文（zh）和英文（en）界面
- **暗色模式** — 浅色、深色、跟随系统三种主题
- **正式账户认证** — 邮箱验证码免密登录、首次使用自动注册，并可选启用 Google OAuth
- **双数据库** — SQLite（默认，零配置）或 PostgreSQL

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, shadcn/ui, Radix UI |
| 拖拽 | @dnd-kit |
| 状态管理 | Zustand |
| 数据库 | Drizzle ORM (SQLite / PostgreSQL) |
| 认证 | NextAuth.js v5 + 邮箱验证码 + Google OAuth |
| AI | Vercel AI SDK v6 + 托管 GPT / Claude / GLM / DeepSeek / Gemini / ERNIE 供应商 |
| PDF | Puppeteer Core + @sparticuz/chromium |
| 国际化 | next-intl |
| 数据校验 | Zod v4 |

## 快速开始

### Docker 部署（推荐）

生产环境使用 PostgreSQL、Redis、健康检查、日志轮转和可选 OTLP Collector。完整变量说明、上线检查、Trace 验证与故障排查见 [部署指南](docs/DEPLOYMENT.md) 和 [环境变量参考](docs/ENVIRONMENT.md)。

```bash
cp .env.example .env
# 编辑 .env，至少设置 APP_URL、AUTH_SECRET、AI_CREDENTIAL_MASTER_KEY，
# 并新增随机的 POSTGRES_PASSWORD。
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

打开 `APP_URL`。首次启动自动完成数据库迁移；供应商凭证和模型不会自动写入。

> **密钥隔离：** `AUTH_SECRET` 与 `AI_CREDENTIAL_MASTER_KEY` 都至少 32 位，且必须使用两个不同的随机值。

> **AI 配置：** 供应商凭证由超级管理员统一配置，并使用 `AI_CREDENTIAL_MASTER_KEY` 加密。终端用户不会填写或获得供应商密钥。

<details>
<summary>使用 Google OAuth 登录</summary>

```bash
docker build -t careerpilot .
docker run -d -p 3000:3000 \
  -e AUTH_SECRET=your-secret \
  -e GOOGLE_CLIENT_ID=xxx \
  -e GOOGLE_CLIENT_SECRET=xxx \
  -v careerpilot-data:/app/data \
  careerpilot
```

</details>

### 本地开发

#### 环境要求

- Node.js 22（推荐，与 CI 保持一致）
- pnpm 10.29.2

#### 安装

```bash
git clone https://github.com/Aidenwu0209/careerpilot.git
cd careerpilot

pnpm install
cp .env.example .env.local
```

#### 配置环境变量

编辑 `.env.local`：

```bash
# 数据库（默认 SQLite，无需额外配置）
DB_TYPE=sqlite

# 默认是正式产品模式。本地可使用内存测试邮件适配器，
# 如需真实投递验证码，请配置 SMTP_*。
DEMO_MODE=false
```

> **AI 配置：** 请在 **管理后台 > AI 供应商** 中配置加密凭证，再通过托管模型目录发布可用模型。

查看 `.env.example` 了解所有可用选项（Google OAuth、PostgreSQL 等）。

#### 初始化数据库并启动

```bash
# 生成并执行迁移
pnpm db:generate
pnpm db:migrate

# （可选）填充示例数据
pnpm db:seed

# 启动开发服务器
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `AUTH_SECRET` | 是 | — | 会话加密密钥 |
| `DB_TYPE` | 否 | `sqlite` | 数据库类型：`sqlite` 或 `postgresql` |
| `DATABASE_URL` | PostgreSQL 时 | — | PostgreSQL 连接字符串 |
| `SQLITE_PATH` | 否 | `./data/careerpilot.db` | SQLite 数据库文件路径 |
| `DEMO_MODE` | 否 | `false` | 在 locale-aware `/demo` 开启隔离的预置演示身份（生产环境禁止开启） |
| `GOOGLE_CLIENT_ID` | 生产环境 | — | Google OAuth 客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 生产环境 | — | Google OAuth 客户端密钥 |
| `SMTP_HOST` | 生产环境 | — | 用于投递邮箱验证码的 SMTP 服务器 |
| `SMTP_PORT` | 否 | `587` | SMTP 服务端口 |
| `SMTP_USER` | 取决于 SMTP | — | SMTP 用户名 |
| `SMTP_PASS` | 取决于 SMTP | — | SMTP 密码 |
| `SMTP_FROM` | 生产环境 | — | 验证邮件发件地址 |
| `APP_NAME` | 否 | `CareerPilot` | 应用显示名称 |
| `DEFAULT_LOCALE` | 否 | `zh` | 默认语言：`zh` 或 `en` |

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（Turbopack） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | 运行 ESLint 检查 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm db:generate` | 生成 Drizzle 迁移文件（SQLite） |
| `pnpm db:generate:pg` | 生成 Drizzle 迁移文件（PostgreSQL） |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:studio` | 打开 Drizzle Studio（数据库 GUI） |
| `pnpm db:seed` | 填充示例数据 |

## 项目结构

```
src/
├── app/                        # Next.js App Router
│   ├── [locale]/               # 国际化路由 (/zh/..., /en/...)
│   │   ├── dashboard/          # 简历列表与管理
│   │   ├── editor/[id]/        # 简历编辑器
│   │   ├── preview/[id]/       # 全屏预览
│   │   ├── templates/          # 模板画廊
│   │   └── share/[token]/      # 公开分享简历查看
│   └── api/
│       ├── ai/                 # AI 接口
│       │   ├── chat/           #   流式对话 + 工具调用
│       │   ├── generate-resume/#   AI 生成简历
│       │   ├── jd-analysis/    #   JD 匹配分析
│       │   ├── grammar-check/  #   语法与写作检查
│       │   ├── cover-letter/   #   求职信生成
│       │   ├── translate/      #   简历翻译
│       │   └── models/         #   可用 AI 模型列表
│       ├── resume/             # 简历 CRUD、导出、解析、分享
│       ├── share/              # 公开分享访问
│       ├── user/               # 用户信息与设置
│       └── auth/               # NextAuth 认证
├── components/
│   ├── ui/                     # shadcn/ui 基础组件
│   ├── editor/                 # 编辑器画布、区块、字段、弹窗
│   ├── ai/                     # AI 对话面板与气泡
│   ├── preview/templates/      # 50 套简历模板
│   ├── dashboard/              # 仪表盘卡片、网格、弹窗
│   └── layout/                 # 头部、主题、语言切换
├── lib/
│   ├── db/                     # Schema、仓库、迁移、适配器
│   ├── auth/                   # 认证配置
│   └── ai/                     # AI 提示词、工具、模型配置
├── hooks/                      # 自定义 React Hooks（7 个）
├── stores/                     # Zustand 状态仓库（简历、编辑器、设置、UI、引导）
└── types/                      # TypeScript 类型定义
```

## 模板列表

CareerPilot 内置 **50 套专业设计模板**，覆盖多种风格和行业需求：

<details>
<summary>查看全部 50 套模板</summary>

| # | 模板 | # | 模板 | # | 模板 |
|---|------|---|------|---|------|
| 1 | Classic | 18 | Clean | 35 | Material |
| 2 | Modern | 19 | Bold | 36 | Medical |
| 3 | Minimal | 20 | Timeline | 37 | Luxe |
| 4 | Professional | 21 | Nordic | 38 | Retro |
| 5 | Two-Column | 22 | Gradient | 39 | Card |
| 6 | ATS | 23 | Magazine | 40 | Rose |
| 7 | Academic | 24 | Corporate | 41 | Teacher |
| 8 | Creative | 25 | Consultant | 42 | Coder |
| 9 | Elegant | 26 | Swiss | 43 | Zigzag |
| 10 | Executive | 27 | Metro | 44 | Neon |
| 11 | Developer | 28 | Architect | 45 | Scientist |
| 12 | Designer | 29 | Japanese | 46 | Blocks |
| 13 | Startup | 30 | Artistic | 47 | Ribbon |
| 14 | Formal | 31 | Sidebar | 48 | Engineer |
| 15 | Infographic | 32 | Finance | 49 | Watercolor |
| 16 | Compact | 33 | Berlin | 50 | Mosaic |
| 17 | Euro | 34 | Legal | | |

</details>

## API 参考

<details>
<summary>查看全部 API 端点</summary>

### 简历

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/resume` | 获取当前用户的简历列表 |
| `POST` | `/api/resume` | 创建新简历 |
| `GET` | `/api/resume/[id]` | 获取简历详情（含所有模块） |
| `PUT` | `/api/resume/[id]` | 更新简历元信息或模块 |
| `DELETE` | `/api/resume/[id]` | 删除简历 |
| `POST` | `/api/resume/[id]/duplicate` | 复制简历 |
| `GET` | `/api/resume/[id]/export` | 导出简历（pdf、docx、html、txt、json） |
| `POST` | `/api/resume/parse` | 解析上传的 PDF 或图片简历 |
| `POST` | `/api/resume/[id]/share` | 创建分享链接 |
| `GET` | `/api/resume/[id]/share` | 获取分享设置 |
| `DELETE` | `/api/resume/[id]/share` | 取消分享 |

### 分享

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/share/[token]` | 访问公开分享的简历 |

### AI

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/ai/chat` | 流式 AI 对话（带简历上下文） |
| `GET` | `/api/ai/chat/sessions` | 获取简历的对话会话列表 |
| `POST` | `/api/ai/chat/sessions` | 创建新对话会话 |
| `GET` | `/api/ai/chat/sessions/[id]` | 获取会话的分页消息 |
| `DELETE` | `/api/ai/chat/sessions/[id]` | 删除对话会话 |
| `POST` | `/api/ai/generate-resume` | AI 生成简历 |
| `POST` | `/api/ai/jd-analysis` | JD 匹配分析 |
| `POST` | `/api/ai/grammar-check` | 语法与写作检查 |
| `POST` | `/api/ai/cover-letter` | 生成求职信 |
| `POST` | `/api/ai/translate` | 翻译简历内容 |
| `GET` | `/api/ai/models` | 获取可用 AI 模型列表 |

### 用户

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/user` | 获取当前用户信息 |
| `PUT` | `/api/user` | 更新用户信息 |
| `GET` | `/api/user/settings` | 获取用户设置 |
| `PUT` | `/api/user/settings` | 更新用户设置 |

</details>

## 参与贡献

欢迎参与贡献。开发流程、必要检查和 Pull Request 要求请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

使用问题请参阅 [SUPPORT.md](SUPPORT.md)；安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告；参与仓库协作即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 常见问题

<details>
<summary><b>AI 配置是如何工作的？</b></summary>

CareerPilot 使用平台托管 AI 凭证。超级管理员在管理后台配置供应商凭证，凭证会加密存储，且只在受控的服务端请求中短暂解密；终端用户仅能看到获准模型和公开的点数价格。

</details>

<details>
<summary><b>可以在 SQLite 和 PostgreSQL 之间切换吗？</b></summary>

可以。通过 `DB_TYPE` 环境变量设置为 `sqlite` 或 `postgresql`。SQLite 是默认选项，零配置即可使用。使用 PostgreSQL 时需额外设置 `DATABASE_URL`。注意：数据不会在两种数据库之间自动迁移。

</details>

<details>
<summary><b>不使用 Google OAuth 时认证如何工作？</b></summary>

正式产品模式始终支持邮箱验证码免密登录。新邮箱验证后会创建账户并进入必填资料与条款/隐私确认流程；已有邮箱会恢复同一个账户。Google OAuth 为可选配置。只有显式设置 `DEMO_MODE=true` 才会在 `/demo` 开放固定的学生和教师演示身份，正式模式不会创建 fingerprint 用户。历史 fingerprint 账户保持隔离，必须经过人工核验后显式绑定，不能按邮箱静默合并。

</details>

<details>
<summary><b>PDF 导出是如何实现的？</b></summary>

PDF 导出使用 Puppeteer Core + @sparticuz/chromium。50 套模板各有独立的服务端导出处理器，将简历渲染为高保真 PDF。同时支持 DOCX、HTML、TXT 和 JSON 格式导出。

</details>

## 许可证

[Apache License 2.0](LICENSE)

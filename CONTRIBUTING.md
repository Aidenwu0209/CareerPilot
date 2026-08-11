# Contributing to CareerPilot

感谢你参与 CareerPilot。Bug 修复、功能改进、文档完善与测试补充都很欢迎。

## 开始之前

- 请先搜索现有 Issue，避免重复提交。
- 功能调整建议先创建 Feature Request，说明使用场景和预期结果。
- 安全漏洞不要创建公开 Issue，请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 分支约定

- `main`：稳定版本。
- `develop/careerpilot`：当前开发版本。
- 贡献分支：使用 `feat/<name>`、`fix/<name>` 或 `docs/<name>`。

Pull Request 默认以 `develop/careerpilot` 为目标分支，发布时再由维护者同步到 `main`。

## 本地开发

```bash
git clone https://github.com/Aidenwu0209/careerpilot.git
cd careerpilot
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

推荐使用 Node.js 22 与仓库声明的 pnpm 10.29.2。请勿提交 `.env.local`、API Key、数据库文件或其他敏感信息。

## 提交前检查

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

文档改动至少应运行 `git diff --check` 并确认链接指向的文件存在。

## Pull Request

- 一个 PR 只解决一个清晰的问题。
- 说明修改原因、主要变化和验证方法。
- UI 改动请附前后截图；数据库或环境变量变化请同步更新文档。
- 保持提交信息简洁，例如 `fix: handle unauthorized photo response`。
- 提交 PR 即表示你同意项目按照 [Apache-2.0](LICENSE) 许可证分发你的贡献。

参与协作时请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

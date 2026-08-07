# Codex Ship Flow

Codex Ship Flow 把“需求→计划→开发→独立 Review→确定性 Verification→上线→健康检查→回滚→同步与清理”变成一个可恢复的状态机。小白只需用自然语言说目标；Codex 自动读取当前状态、执行唯一安全的下一步，并且只在需要人类判断时提问。

这套实现以文章的端到端 ship 思路和本项目的安全要求为主：

- 每次运行使用独立分支和 Git worktree。
- Planner / Plan Critic / Developer / Reviewer / Verifier 身份分离。
- Review 和 Verification 绑定精确的 commit、tree、计划、manifest 和命令摘要；代码一变就不能沿用旧证据。
- 发布、部署和回滚使用持久化回执；中断后先探测或人工裁定，不盲目重放外部写入。
- 真实 deploy 没有能确认本次候选版本的 health check 时不能执行。
- 推送、合并、生产上线、可能影响数据的回滚和最终清理都保留人类门禁。

## 组成

- `src/ship_flow/`：Python 3.11+ 标准库引擎和 `ship` CLI。
- `skills/ship-flow/`：Codex 自然语言控制层。
- `scripts/install-codex-skill.py`：校验压力测试收据后，事务性安装 Skill 和自包含引擎。
- `.ship/manifest.toml`：每个项目人工确认的命令、发布目标和安全策略。
- `<git-common-dir>/ship-flow/`：不会被误提交的状态、证据、日志和操作回执。

## 本地安装

在本仓库根目录运行：

```bash
# 本机已验证的 Python 3.12
/Users/wu/.local/share/mise/installs/python/3.12.13/bin/python3 scripts/install-codex-skill.py
```

如果 `python3 --version` 已是 3.11 或更高，也可以直接使用 `python3`。本机系统默认 `/usr/bin/python3` 仍是 3.9，不要用它安装。

安装器会先验证源文件、完整测试和 7 个压力场景的绑定收据，然后安装到：

```text
~/.codex/skills/ship-flow
~/.codex/tools/ship-flow
```

安装期间的事务日志会使新旧启动器暂时 fail closed；如果进程中断，重新运行安装器只会恢复已知事务，不覆盖未知内容。

## 使用

在 Codex 中说：

```text
使用 $ship-flow 帮我开发这个功能，通过独立 Review 和 Verification 后准备上线。
```

继续已有运行：

```text
使用 $ship-flow 继续 <run-id>，仓库是 <repo-path>。
```

查看引擎的权威状态：

```bash
~/.codex/tools/ship-flow/bin/ship status --repo /absolute/repo --run-id RUN_ID --json
```

中文入门、故障恢复和卸载说明见 [docs/ship-flow-quickstart-zh.md](docs/ship-flow-quickstart-zh.md)。

## 开发验证

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:. python3 -m unittest discover -s tests/unit -v
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:. python3 -m unittest discover -s tests/integration -v
RUFF_CACHE_DIR=/private/tmp/ship-flow-ruff ruff format --check src/ship_flow tests scripts/install_codex_skill.py scripts/install-codex-skill.py
RUFF_CACHE_DIR=/private/tmp/ship-flow-ruff ruff check src/ship_flow tests scripts/install_codex_skill.py scripts/install-codex-skill.py
git diff --check
```

开发本工具时不会推送、合并或连接真实部署目标。

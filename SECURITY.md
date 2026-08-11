# Security Policy

## 支持范围

安全修复优先应用于当前 `main` 分支和最新发布版本。`develop/careerpilot` 是开发分支，可能包含尚未发布的变更。

## 报告漏洞

请不要通过公开 Issue 披露安全漏洞、密钥、个人数据或可直接利用的攻击细节。

请使用 GitHub 的 [Private vulnerability reporting](https://github.com/Aidenwu0209/careerpilot/security/advisories/new) 提交报告，并尽量包含：

- 受影响的版本或提交；
- 复现步骤和影响范围；
- 日志、截图或最小复现代码；
- 已知缓解方法（如有）。

维护者会在可用时间内确认报告并评估修复方案。修复公开前，请给维护者合理的协调时间。

## 部署安全提示

- 生产环境必须使用 PostgreSQL、可靠认证和高强度 `AUTH_SECRET`。
- `AI_CREDENTIAL_MASTER_KEY` 必须与认证密钥分离，并通过秘密管理系统注入。
- Stripe Webhook 必须校验签名；管理、定时任务和内部监控接口应使用独立密钥保护。
- 不要在 Issue、日志、截图或客户端代码中暴露供应商密钥和用户数据。

更多生产配置请参阅 [商业化运维指南](docs/commercial-operations.zh-CN.md)。

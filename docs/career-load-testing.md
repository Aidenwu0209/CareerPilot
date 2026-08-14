# CareerPilot 职业模块负载测试

这套脚本发出真实 HTTP 并发请求，并输出吞吐、错误率以及 p50/p95/p99 延迟。默认只允许访问 `localhost`，且只执行只读请求，避免误压生产环境或产生付费 AI 调用。

## 本地基线

先使用独立测试数据库启动 production build，再复制浏览器中测试账号的 Cookie：

```bash
pnpm build
pnpm start
CAREERPILOT_LOAD_COOKIE='authjs.session-token=REPLACE_ME' pnpm test:load:career -- --concurrency 20 --duration 60
```

默认验收阈值是错误率不超过 1%、p95 不超过 1500ms；任一超标时命令以非零状态退出，适合接入 CI 的预发布环境。输出只包含汇总数字，不记录 Cookie 或响应正文。

## 写入与 AI 场景

复制 `scripts/load/scenarios/career-read-only.json` 创建隔离场景，可以添加 POST 请求及固定测试数据。写入场景必须同时满足：

- 使用专用测试账号和独立数据库；
- 命令显式增加 `--allow-writes`；
- AI 场景使用限额测试密钥并预先估算费用；
- 不对生产域名运行。远程测试还需要显式增加 `--allow-remote`。

脚本的安全开关用于防止误操作，不代替服务端限流、账单上限和压测审批。

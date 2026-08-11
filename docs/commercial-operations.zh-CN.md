# CareerPilot ToC 支付、模型权限与运维接入

## 上线前必做

1. 在 Stripe 创建账户并设置 `STRIPE_SECRET_KEY`。
2. 将 Stripe webhook 指向 `POST /api/webhooks/stripe`，订阅：
   `checkout.session.completed`、`checkout.session.async_payment_succeeded`、
   `invoice.paid`、`customer.subscription.updated`、
   `customer.subscription.deleted`、`refund.created`、`refund.updated`。
3. 将签名密钥写入 `STRIPE_WEBHOOK_SECRET`，再设置 `BILLING_ENABLED=true`。
4. 用外部调度器携带 `Authorization: Bearer $CRON_SECRET` 定时请求：
   - 每 5 分钟：`GET /api/internal/monitoring/check`
   - 每日：`GET /api/internal/billing/reconcile`
5. 设置 OTLP Collector：`APM_ENABLED=true`、`OTEL_EXPORTER_OTLP_ENDPOINT`。
6. 至少配置一种外部告警通道：`ALERT_WEBHOOK_URL` 或 `ONCALL_EMAILS` + SMTP。

生产环境启用对应功能后，缺少必需变量会在启动阶段直接失败，避免“页面可打开但支付/告警不可用”。

## 模型供应商配置

| 模型族 | Provider type | Base URL |
|---|---|---|
| GPT | `openai` | 留空使用 OpenAI 默认地址 |
| Claude | `anthropic` | 留空使用 Anthropic 默认地址 |
| GLM | `glm` | 配置智谱 OpenAI-compatible 地址 |
| DeepSeek | `deepseek` | 配置 DeepSeek OpenAI-compatible 地址 |
| Gemini 生图 | `google` 或 `gemini` | 留空使用 Google 默认地址 |
| GPT 生图 | `openai` | 留空使用 OpenAI 默认地址 |
| ERNIE 生图 | `ernie` 或 `qianfan` | 留空使用百度千帆 v2 地址 |

后台“模型目录”中还需设置 family、能力（text/image_generation）和交付分辨率。

## GPT 1K / 4K 档位

- `1k`：直接返回 GPT Image 的原生输出。
- `4k`：先由 GPT Image 生成，再调用管理员为该模型设置的 HTTPS 超分辨率地址。

4K 超分服务使用独立的 `IMAGE_UPSCALER_API_KEY`，不会复用 OpenAI 密钥。把超分服务域名加入
`AI_UPSTREAM_ALLOWED_DOMAINS` 后再设置 `IMAGE_4K_ENABLED=true`。这是一档“高清交付”产品，不能宣传成
OpenAI 接口原生输出 4K。

## 套餐和模型权限

- 套餐与模型采用明确 allow-list 绑定。
- 代码为 `free` 的启用套餐是未付费用户的默认模型集合；它可以设置为 0 元、0 点且不会出现在购买区。
- 一次性充值包购买成功后获得该等级模型权限；全额退款后权限撤销。
- 订阅模型权限只在 entitlement 为 active 且未过期时生效；取消订阅后不会因历史订单继续保留权限。
- 若数据库尚未配置任何套餐模型映射，系统保持迁移兼容，不会突然屏蔽现有模型；一旦创建第一条映射即启用严格权限矩阵。

## 退款和对账

退款先扣回按退款金额比例计算的点数，再调用 Stripe；若 Stripe 拒绝，系统会写入独立、不可修改的
`payment_refund_rollback` 流水恢复点数。点数已消费、余额不足时退款会被拒绝，避免资金退回后出现负余额。

对账会比较本地订单的支付状态、金额和币种与 Stripe Checkout Session；差异保存到 reconciliation 表并通过
外部 webhook/值班邮件发送 critical 告警。

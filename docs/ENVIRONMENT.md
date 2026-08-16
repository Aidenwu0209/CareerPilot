# Environment variable reference

CareerPilot reads server configuration at process startup. Keep production values in a secret manager or an uncommitted `.env`; never expose credentials through `NEXT_PUBLIC_*` variables.

## Application and authentication

| Variable | Default | Required when | Purpose |
|---|---:|---|---|
| `APP_NAME` | `CareerPilot` | Optional | Product name used by server-side features. |
| `APP_URL` | `http://localhost:3000` | Production; billing | Canonical public HTTPS origin, without a trailing slash. |
| `APP_PORT` | `3000` | Docker only | Host port published by Compose. |
| `DEFAULT_LOCALE` | `zh` | Optional | Default locale (`zh` or `en`). |
| `DEMO_MODE` | `false` | Development only | Enables the isolated demo identity. Production rejects `true`. |
| `AUTH_SECRET` | — | Production | Auth.js signing secret, at least 32 characters. |
| `GOOGLE_CLIENT_ID` | — | Google sign-in | OAuth client ID; configure with `GOOGLE_CLIENT_SECRET`. |
| `GOOGLE_CLIENT_SECRET` | — | Google sign-in | OAuth client secret. |
| `SMTP_HOST` | — | Email-code login/on-call email | SMTP server host. |
| `SMTP_PORT` | `587` | SMTP | SMTP server port. |
| `SMTP_USER` | — | SMTP auth | SMTP username. |
| `SMTP_PASS` | — | SMTP auth | SMTP password. |
| `SMTP_FROM` | — | SMTP | Verified sender address. |

## Database and rate limiting

| Variable | Default | Required when | Purpose |
|---|---:|---|---|
| `DB_TYPE` | `sqlite` | Production: `postgresql` | Database adapter. SQLite is development-only. |
| `DATABASE_URL` | — | `DB_TYPE=postgresql` | PostgreSQL connection URL. |
| `DATABASE_POOL_MAX` | `10` | PostgreSQL | Maximum connections per app instance. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | `20` | PostgreSQL | Idle pooled-connection timeout. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | `10` | PostgreSQL | Initial connection timeout. |
| `DATABASE_MAX_LIFETIME_SECONDS` | `1800` | PostgreSQL | Maximum pooled-connection lifetime. |
| `DATABASE_SSL_MODE` | `prefer` | PostgreSQL | `prefer`, `require`, `verify-full`, or `disable`. Use `verify-full` for remote production databases. |
| `SQLITE_PATH` | `./data/careerpilot.db` | SQLite | Local development database file. |
| `REDIS_URL` | — | Multi-instance production | Shared Redis endpoint for distributed rate limits and career-catalog caching. |
| `RATE_LIMIT_DISTRIBUTED_REQUIRED` | `false` | Production Compose: `true` | Fails route policy instead of silently using in-process counters when Redis is unavailable. |
| `CACHE_TTL_OCCUPATIONS` | `600` | Optional | Career list-cache TTL in seconds (allowed range: 60–86400). |
| `CACHE_TTL_OCCUPATION_DETAIL` | `900` | Optional | Career detail-cache TTL in seconds (allowed range: 60–86400). |

Career-catalog cache keys include a shared generation. A successful catalog import or rollback increments that generation, so every app instance stops serving the prior list/detail entries without an expensive Redis key scan. Redis cache failures degrade to bounded in-process caching and database reads; they do not make read-only career routes unavailable.

## AI, billing and image delivery

| Variable | Default | Required when | Purpose |
|---|---:|---|---|
| `AI_CREDENTIAL_MASTER_KEY` | — | Production | Independent 32+ character key that encrypts managed provider credentials. |
| `AI_UPSTREAM_ALLOWED_DOMAINS` | — | Custom provider/upscaler hosts | Comma-separated SSRF allow-list additions. |
| `BILLING_ENABLED` | `false` | ToC billing | Enables Stripe checkout, refund and reconciliation paths. |
| `STRIPE_SECRET_KEY` | — | `BILLING_ENABLED=true` | Stripe server secret. |
| `STRIPE_WEBHOOK_SECRET` | — | `BILLING_ENABLED=true` | Stripe endpoint signing secret. |
| `IMAGE_4K_ENABLED` | `false` | GPT 4K delivery | Enables the separate upscale step. |
| `IMAGE_UPSCALER_API_KEY` | — | `IMAGE_4K_ENABLED=true` | Dedicated upscaler credential. |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | — | Initial administration | Promotes an already-registered email idempotently at startup. |

Provider credentials and model identifiers are configured in the admin console, not in generic environment variables. This keeps plan/model entitlements and credential rotation under audit.

## Logging, APM and alerting

| Variable | Default | Required when | Purpose |
|---|---:|---|---|
| `LOG_LEVEL` | `info` | Optional | Minimum JSON log level: `debug`, `info`, `warn`, or `error`. |
| `LOG_MAX_SIZE` | `10m` | Docker Compose | Rotates each container log at this size. |
| `LOG_MAX_FILES` | `3` | Docker Compose | Number of rotated JSON log files retained per container. |
| `APM_ENABLED` | `false` | APM | Registers OpenTelemetry instrumentation. |
| `OTEL_SERVICE_NAME` | `careerpilot-web` | APM | Service name exported with traces. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | `APM_ENABLED=true` | OTLP HTTP collector base endpoint; the exporter posts to `/v1/traces`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Authenticated collector | Exporter headers such as `Authorization=Bearer ...`. Treat as a secret. |
| `EXTERNAL_ALERTS_ENABLED` | `false` | External alerting | Enables webhook/on-call delivery. |
| `ALERT_WEBHOOK_URL` | — | Webhook alerting | HTTPS receiver for signed alert payloads. |
| `ALERT_WEBHOOK_SECRET` | — | Signed webhooks | HMAC-SHA256 signing secret. |
| `ALERT_COOLDOWN_MS` | `300000` | Alerting | Duplicate alert cooldown. |
| `ONCALL_EMAILS` | — | Email on-call | Comma-separated notification addresses; requires SMTP. |
| `CRON_SECRET` | — | Monitoring/reconciliation jobs | 24+ character bearer secret for protected internal jobs. |
| `OPS_ALERT_FAILURE_RATE_PERCENT` | `10` | Operations monitor | 24-hour AI failure-rate threshold. |
| `OPS_ALERT_DAILY_CREDITS` | `10000` | Operations monitor | Net 24-hour credit threshold. |
| `AI_COST_PER_CREDIT` | — | Optional | Estimated provider cost per consumed credit. |

Every proxy response includes `x-request-id`. A safe incoming ID is preserved; otherwise CareerPilot generates a UUID. Structured logs include `requestId` where available and automatically add the active OpenTelemetry `traceId` and `spanId`.

## Backup configuration

| Variable | Default | Required when | Purpose |
|---|---:|---|---|
| `BACKUP_ENABLED` | `false` | Backup runner | Marks backup configuration as enabled for readiness checks. |
| `BACKUP_DESTINATION` | — | Backups | Isolated destination outside the database host. |
| `BACKUP_RETENTION_DAYS` | `7` | Backups | Retention period. |
| `BACKUP_OWNER_EMAIL` | — | Backups | Owner notified after a failed drill. |
| `BACKUP_ENCRYPTION_KEY` | — | Backups | Independent 32+ character AES-GCM key. |
| `BACKUP_SCHEDULE` | `daily` | Backup runner | Intended cadence: `daily` or `hourly`. |

The application validates backup settings and contains encrypted backup/restore primitives, but the web process is not a scheduler. Operate the backup runner from a separate trusted job and keep the destination on separate storage.

## Configuration stop check

Before exposing traffic, the following must return HTTP 200 and report `status: "ok"`:

```bash
curl --fail --silent --show-error https://career.example.com/api/health | jq
```

Production startup fails closed for unsafe auth, database, billing, APM, image-4K or alert configurations. `/api/health` reports only presence/status and never returns secret values.

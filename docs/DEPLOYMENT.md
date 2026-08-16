# CareerPilot deployment

This guide describes the supported single-host Docker deployment. Larger installations can run the same image behind a load balancer, provided every instance shares PostgreSQL and Redis.

## Prerequisites

- Docker Engine with Compose v2
- A public HTTPS origin for `APP_URL`
- At least 2 CPU cores and 4 GB RAM for the web container; size PostgreSQL separately
- Provider credentials configured through the admin console after first startup

## Configure

Create a local `.env` that is never committed:

```dotenv
APP_URL=https://career.example.com
APP_PORT=3000
AUTH_SECRET=<openssl rand -base64 48>
AI_CREDENTIAL_MASTER_KEY=<a different random value of at least 32 characters>
POSTGRES_PASSWORD=<a random database password>
DATABASE_POOL_MAX=10
```

Copy optional billing, SMTP, APM, alerting and backup settings from `.env.example`. The complete semantics and enablement rules are in [the environment reference](./ENVIRONMENT.md). Do not place secrets in `NEXT_PUBLIC_*` variables.

## Start and verify

```bash
docker compose up -d --build
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3000/api/health | jq
```

The app container is considered healthy only when configuration, database connectivity and migrations are ready. PostgreSQL and Redis data live in named volumes.

For local APM verification, set `APM_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, then start the optional collector profile:

```bash
docker compose --profile observability up -d --build
docker compose logs --tail=100 otel-collector
```

The bundled collector exports received traces to its own debug log for verification. Replace that debug exporter with your production APM exporter or point the app directly at a managed OTLP endpoint.

## Managed AI and image setup

CareerPilot deliberately ships without provider credentials or AI model rows. Credentials are deployment secrets, while model identifiers, availability, entitlement and prices vary by provider account. Do not put provider keys in the repository, client settings or generic environment-variable fallbacks.

1. Generate independent values for `AUTH_SECRET` and `AI_CREDENTIAL_MASTER_KEY` (for example, two separate `openssl rand -base64 48` results), then start or restart the service.
2. Register the intended administrator account. Set `BOOTSTRAP_SUPER_ADMIN_EMAIL` to that exact email and restart the service once; the bootstrap is idempotent and only promotes an existing account.
3. Open **Admin > AI Providers**, add the managed provider credential, and run the connection test. A successful test proves only that the credential and endpoint are reachable; it does not prove access or quota for every model.
4. Open **Admin > Model Catalog**, create the exact model identifier enabled for that provider account, select its capability, set public visibility and pricing, and enable it. LinkedIn Photo requires `image_generation`.
5. If plan/model access rules have been configured, grant the image model to the intended plan. Sign in as a normal user and confirm that `/api/ai/models` lists it before testing generation.

Image-generation access is provider- and account-specific. Check the live provider pricing and quota pages before publishing a model. For example, Google's current [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing) marks the listed Gemini image-generation models as unavailable on the free tier. A provider connection test can therefore succeed while an image request correctly returns `PROVIDER_QUOTA_EXCEEDED`.

## Production checks

- Terminate TLS at a reverse proxy and forward the original host/protocol headers.
- Keep `RATE_LIMIT_DISTRIBUTED_REQUIRED=true`; production requests then fail according to route policy if Redis is unavailable instead of silently falling back to per-process counters.
- Set `DATABASE_SSL_MODE=verify-full` when connecting to a managed/remote PostgreSQL service. The bundled Compose network deliberately uses `disable` because traffic stays on the private Docker network.
- Coordinate `DATABASE_POOL_MAX × web instance count` with the database provider's connection limit.
- Configure `BACKUP_*`, run a restore drill, and store backups outside the database host.
- Configure OTLP and external alert/on-call settings, then exercise the protected monitoring check.

### Reverse proxy contract

Forward `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto` and the client IP header used by your proxy. Preserve an incoming `X-Request-Id` only if the proxy generates safe opaque IDs. CareerPilot returns that ID on every dynamic page/API response and generates a UUID when it is absent or unsafe.

Do not rewrite JSON API authentication failures into plain text or HTML. Clients defensively handle such responses, but keeping `{ "error": "AUTH_REQUIRED" }` preserves machine-readable behavior.

### Verify APM with a real exported trace

CareerPilot includes a local OTLP HTTP capture server for deployment smoke tests. Run these in two terminals:

```bash
# Terminal A: exits successfully after receiving the first non-empty trace payload
OTLP_SMOKE_EXIT_AFTER_TRACE=true pnpm test:otel:collector
```

```bash
# Terminal B
APM_ENABLED=true \
OTEL_SERVICE_NAME=careerpilot-smoke \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
pnpm dev

curl --fail http://127.0.0.1:3000/api/health
```

Terminal A must print `otlp.trace_received` with a positive `bytes` value and exit with code 0. This proves an application request reached an OTLP collector; a configured environment variable alone is not sufficient evidence. Repeat the check against the production collector and confirm the `careerpilot-web` service is searchable there.

The Compose collector can be checked independently:

```bash
curl --fail http://127.0.0.1:13133/
docker compose logs otel-collector | grep -E 'Traces|ResourceSpans'
```

### Verify logs and correlation

```bash
request_id="deploy-smoke-$(date +%s)"
curl --fail -D /tmp/careerpilot-headers.txt \
  -H "X-Request-Id: ${request_id}" \
  http://127.0.0.1:3000/api/health >/dev/null
grep -i "x-request-id: ${request_id}" /tmp/careerpilot-headers.txt
docker inspect careerpilot-app-1 --format '{{json .HostConfig.LogConfig}}' | jq
docker compose logs --tail=200 app | jq -R 'fromjson? // empty' | tail
```

The response header must echo the smoke ID. Compose configures Docker's `json-file` driver with `LOG_MAX_SIZE` and `LOG_MAX_FILES`; the inspect output must show both rotation options. Application log lines are JSON and active spans add `traceId`/`spanId`.

### Verify external alerts and on-call delivery

Schedule the monitoring route at least every five minutes and the billing reconciliation route daily:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://career.example.com/api/internal/monitoring/check | jq

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://career.example.com/api/internal/billing/reconcile | jq
```

Confirm the response contains `ok: true`, then create a controlled test condition in a non-production environment and verify webhook or email receipt. A 401 means the bearer value does not exactly match `CRON_SECRET`; a successful HTTP request without a received notification does not prove the channel works.

## Troubleshooting

| Symptom | Check | Resolution |
|---|---|---|
| Startup says `DB_TYPE must be "postgresql"` | `NODE_ENV` and `DB_TYPE` | Use PostgreSQL in production; SQLite is intentionally rejected. |
| Health returns 503 with migration mismatch | `checklist.migration` and app logs | Back up the database, deploy one migration owner, and do not serve traffic until expected/applied versions match. |
| Login redirects to a 404 `/login` | Reverse-proxy redirects and locale | Preserve the localized path (`/zh/login` or `/en/login`). CareerPilot itself emits localized auth redirects. |
| API UI reports unauthorized or invalid JSON | Proxy/WAF response body | Stop replacing JSON 401/403 bodies with text/HTML and preserve status/content type. |
| Redis outage blocks protected operations | Redis health and `RATE_LIMIT_DISTRIBUTED_REQUIRED` | Restore shared Redis. Do not disable the fail-closed policy to hide the outage. |
| Provider connection succeeds but generation fails | Exact model entitlement/quota | Verify the model ID, capability, plan mapping, account quota and allowed upstream hostname. |
| APM is enabled but no service appears | Collector URL, headers, egress | Run the local trace smoke above, then test the production endpoint from inside the app container. |
| Alert route is 200 but nobody is notified | `deliveries`, webhook receiver, SMTP | Verify at least one channel and run a controlled alert drill; check HMAC validation and SMTP sender authorization. |
| Container disk usage keeps growing | Docker log config | Check that `max-size`/`max-file` are present and that the host log driver honors rotation. |

## Upgrade and rollback

```bash
docker compose build --pull app
docker compose up -d app
docker compose logs --tail=200 app
```

Migrations run at application startup. Back up PostgreSQL before upgrading. For rollback, restore the matching database backup and run the previous immutable image tag; do not assume a newer schema is backward compatible.

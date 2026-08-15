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

Copy optional billing, SMTP, APM, alerting and backup settings from `.env.example`. Do not place secrets in `NEXT_PUBLIC_*` variables.

## Start and verify

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

The app container is considered healthy only when configuration, database connectivity and migrations are ready. PostgreSQL and Redis data live in named volumes.

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

## Upgrade and rollback

```bash
docker compose build --pull app
docker compose up -d app
docker compose logs --tail=200 app
```

Migrations run at application startup. Back up PostgreSQL before upgrading. For rollback, restore the matching database backup and run the previous immutable image tag; do not assume a newer schema is backward compatible.

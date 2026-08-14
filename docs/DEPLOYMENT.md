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

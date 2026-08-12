# Auth Product Flow Verification

Verified on 2026-08-12 from `wu/auth-product-flow` with fresh SQLite databases for each browser run.

## Quality gates

- `pnpm type-check`: passed
- `pnpm lint`: passed with 0 errors and 115 pre-existing warnings
- `pnpm test`: 471/471 suites and 1372/1372 tests passed; 0 failed or pending
- `pnpm build`: passed; Next.js reported `Proxy (Middleware)`
- `pnpm audit --prod --audit-level high`: no known vulnerabilities
- `git diff --check`: passed

The complete Vitest JSON report is `test-results.json`.

## Product browser flow

- All three Chinese landing CTAs target `/zh/login?callbackUrl=/zh/dashboard`.
- Direct `/zh/dashboard?view=list` access redirects to localized login and preserves the full callback.
- Product `/zh/demo` returns 404.
- The login page shows email verification, automatic first-use registration copy, and Google login.
- A new email creates one account, requires profile and legal-consent onboarding, and reaches the dashboard.
- The same email signs in again without repeating onboarding.
- A legacy `jade_fingerprint` value was preloaded; no product request sent `x-fingerprint`.
- Desktop light and 390px mobile dark layouts have no horizontal overflow.
- Browser console errors: 0; page errors: 0.

See `product-final/product-browser-results.json` and the screenshots in `product-final/`.

## Demo browser flow

- With `DEMO_MODE=true`, `/zh/demo` exposes only the fixed seeded student and teacher scenarios.
- The student reaches the seeded dashboard and does not see the teacher workbench.
- The teacher reaches the workbench and sees the explicitly assigned seeded student.
- Desktop light and 390px mobile dark layouts have no horizontal overflow.
- Browser console errors: 0; page errors: 0.

See `demo-final/demo-browser-results.json` and the screenshots in `demo-final/`.

## External product configuration

Production remains fail-closed and requires PostgreSQL, `DATABASE_URL`, independent strong
`AUTH_SECRET` and `AI_CREDENTIAL_MASTER_KEY` values, SMTP delivery configuration, and Google
OAuth credentials. `DEMO_MODE` must remain false in production. Optional billing, telemetry,
4K image, backup, and alerting features require their documented credentials when enabled.

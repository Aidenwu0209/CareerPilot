# CareerPilot product overview

Status: maintained product requirements baseline for v0.4.x. Code and automated tests are the source of truth for implementation status; this document records product intent and decisions.

## Product

CareerPilot is a bilingual career-development workspace for students and early-career candidates. It combines resume creation, explainable career matching, evidence review, mock interviews, professional-photo generation and a commercial AI gateway.

Primary users:

- Candidates build resumes, explore occupations, submit evidence and practise interviews.
- Teachers review evidence and assign career-development tasks within an authorized student relationship.
- Organization admins manage tenant members and usage.
- Platform super admins manage providers, models, plans, billing operations and incident signals.

## Product principles

1. Career scores must be explainable and evidence-backed. Preference assessments are non-diagnostic and do not silently inflate ability scores.
2. Unknown evidence remains unknown; absence of evidence is not a negative score.
3. User and tenant ownership is resolved server-side. Client-supplied user IDs are never an authorization boundary.
4. AI model access and price are policy data, not UI constants.
5. Paid access must preserve a useful free journey; pricing and paywall placement require an explicit product decision and analytics plan.

## Implemented capabilities

| Module | Current capability |
| --- | --- |
| Authentication | Password registration/sign-in, optional Google OAuth and email code, onboarding consent, account export/deletion |
| Resume | Structured editor, multiple templates, import/parse, AI assistance, sharing, PDF/DOCX/HTML/text/JSON export |
| Career | Versioned China occupation catalog, search/facets, goals, profile/evidence, teacher review, explainable matching, learning path, PDF/Markdown report export |
| Self-assessment | Compact RIASEC interest, MBTI-style preference, work-value and learning-preference questionnaire; explicitly non-diagnostic |
| Interview | Configurable interviewers/rounds, chat, pause/continue, report, history and PDF/Markdown export |
| Professional photo | Upload/camera input, provider/model selection, aspect ratios, GPT 1K/4K product tiers and download |
| AI gateway | GPT, Claude, GLM and DeepSeek text models; Gemini, GPT and ERNIE image families; model/plan entitlement checks, credit holds and attempts |
| Commercial | Plans/top-ups, Stripe checkout/webhook, entitlements, credit ledger, refunds, reconciliation and admin operations |
| Operations | Health/readiness, OpenTelemetry integration, external alert delivery, on-call email, backup configuration and audit events |
| Administration | Super-admin provider/model/plan/user/org controls; organization and teacher workspaces with scoped permissions |

## Planned or decision-gated capabilities

| Capability | Status | Decision required |
| --- | --- | --- |
| Daily check-in and streaks | Proposed | Retention value, abuse rules, timezone semantics and reward budget |
| Occupation subscriptions/notifications | Proposed | Data refresh source, notification channels, consent and unsubscribe policy |
| Unified career-growth dashboard | Proposed | Metric definitions and whether it replaces or extends the current career overview |
| Three-layer career paywall | Decision required | Free boundary, single-purchase prices, subscription benefits, refunds and experiment guardrails |
| Public external API | Not committed | Supported consumers, versioning/SLA and which internal routes may be exposed |

## Commercial model policy

- A billing plan maps to a user level and an explicit model-access set.
- Text-model families: OpenAI GPT, Anthropic Claude, Zhipu GLM and DeepSeek.
- Image-model families: Google Gemini, OpenAI GPT image and Baidu ERNIE.
- GPT image products distinguish 1K and 4K tiers. The 4K tier requires the configured upscaler path and must fail closed when it is unavailable.
- Price, credit cost and availability are admin-managed records. UI labels must be derived from active catalog data.

## Non-functional requirements

- Accessibility: keyboard-operable navigation, skip link, visible focus, semantic names, AA text contrast and reduced-motion support.
- Reliability: PostgreSQL in production, migrations fail closed, Redis-backed cross-instance rate limits, readiness health checks and tested backups.
- Security: encrypted provider credentials, signed webhooks, SSRF protection, immutable sanitized audit events and least-privilege route guards.
- Performance: paginated reads, query-shaped indexes, no request-path N+1 queries and bounded caches.
- Observability: structured logs without secrets/PII, request correlation where available, traces, external alerts and an owned on-call channel.
- Quality gate: lint, TypeScript, unit/integration tests, production build, migration validation and browser smoke tests before merge.

## Change control

Every feature PR must update this document when it changes a product boundary, model family, commercial rule, permission, public contract or planned-capability status. Pricing/paywall changes require product approval and must not be inferred from an Issue proposal alone.

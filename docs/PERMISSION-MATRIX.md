# Permission and sensitive-data matrix

CareerPilot resolves the active actor on the server for every protected API. Client-side navigation guards are a usability layer, not an authorization boundary.

| Surface | Anonymous | Active user | Organization admin | Super admin | Sensitive data policy |
| --- | --- | --- | --- | --- | --- |
| Public pages, health, signed share links | Limited | Limited | Limited | Limited | No account PII in public responses |
| `/api/account/**` | No | Own account only | Own account only | Own account only | Export/delete actions are scoped to actor ID |
| `/api/career/**`, `/api/interview/**`, resume APIs | No | Own records | Own records unless a teacher/org endpoint grants tenant scope | Own records unless using an admin endpoint | User-owned content is never authorized from a client-supplied user ID |
| `/api/teacher/**` | No | Denied unless assigned teacher | Tenant-scoped assignment access | Explicit route policy | Student-visible notes and private teacher notes remain distinct |
| `/api/org-admin/**` | No | Denied | Active organization and membership only | Explicit route policy | Cross-tenant IDs must be checked against active membership |
| `/api/admin/**` | No | Denied | Denied | Allowed | Exact identity fields are restricted to super admins for account support; tokens, credentials, resume text, interview text and prompts are excluded from list responses |
| Provider credentials | No | Denied | Denied | Write/rotate/test only | APIs never return plaintext credentials after storage |
| Audit events | No | Denied | Tenant-scoped views only where implemented | Allowed | Immutable; summaries redact keys, auth headers, JWTs, emails, phone numbers, identity numbers and document-like content |

## Review checklist

1. Call `resolveActiveContext()` (or a stricter server-side guard) before reading request data that can select another user or tenant.
2. Return `401` for no session and `403` for an authenticated actor outside the required role/scope.
3. Derive owner/tenant identifiers from the resolved actor. If an object ID comes from the URL, verify ownership before reading or mutating it.
4. Select only fields needed by the screen. Admin list endpoints may expose exact email/name only to `super_admin`; never return auth tokens, provider credentials or user document bodies.
5. Record privileged mutations in the immutable audit trail using record IDs and masked labels, never raw PII or secrets.
6. Add negative tests for anonymous, ordinary-user and cross-tenant access whenever a protected route changes.

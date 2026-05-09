# B. Service Foundation Detailed Plan v1.0

# Notive Service Foundation

---

# 1. Purpose

This document defines the detailed plan for Phase B (Service Foundation) of Notive's overall implementation plan.

Phase B builds the baseline so that a user can sign up, log in, belong to an organization, and access basic screens and features by role. The auth, organization, user, role, and shared layout built here become the foundation for documents (C), AI generation (D), work context (E), search (F), and admin (G).

Phase A §15 locked all Phase-B-relevant decisions. This document encodes those decisions in concrete impl scope. Any deviation requires a new revision of Phase A §15 plus Codex verification.

---

# 2. Phase B Goals

When Phase B completes, the following must be true.

* A user can enter the service via signup or invite acceptance.
* A user can log in, log out, and have their session persisted.
* A user belongs to exactly one organization (Phase A §15: 1 user = 1 organization for MVP).
* The organization has a single-level Team structure (Phase A §15).
* A user has at most one primary team in their organization (Phase A §15: 1 user = 1 primary team for MVP).
* A user is assigned exactly one role: Viewer, Editor, Manager, or Admin.
* Menu and screen access are restricted by role.
* The base layout and navigation are in place.
* Last-Admin protection is enforced.
* The minimum data foundation needed by Phases C–G is in place.
* Cleanup-worker / cron infrastructure is in place to support Phase A §15 retention rules (the workers themselves carry no Phase-B business logic yet; D and later wire them up).

---

# 3. Phase B Scope

## 3.1 In scope

* Project initial structure
* Base configuration (env, secrets, environments)
* Email + password authentication (Phase A §15)
* Mandatory email verification (Phase A §15)
* Server-side session storage (Phase A §15)
* Signup
* Login / logout
* Invite acceptance
* Organization creation
* Team creation under an organization
* Membership management (1 organization, 1 primary team, 1 role)
* Last-Admin protection
* Role assignment and change (Admin-only)
* Menu and route access control
* Shared application layout
* Base admin entry screen
* Base error / empty / access-denied screens
* AuditLog skeleton (table + writer interface; full write coverage lands in Phase G)
* Short-term storage infrastructure (Redis or compatible) — wired but unused in B; consumed by D for AI preview bodies
* Cleanup worker / cron infrastructure — wired but unused in B; activated in C/D for retention jobs

---

## 3.2 Out of scope

* Document authoring and editing
* AI document generation
* Document search
* Work diary
* To-do
* Advanced audit logging UI
* SSO / SAML / OAuth
* 2FA
* Billing and plan management
* External integrations
* Multi-level team / department hierarchy
* Multi-organization membership for a single user

---

# 4. Prerequisites

Phase A must have locked the following before B starts (Phase A §17 entry criteria).

| Item | Why needed |
| --- | --- |
| Signup mode | Onboarding screens and auth flow |
| Organization / team structure | Data model and admin screen scope |
| Role definitions | Permission handling baseline |
| P0 screen list | Layout and menu composition |
| Document default access policy | C-phase permission wiring |
| Technical direction | Project initial structure |
| Phase B minimum entities | DB migration list for B |
| Auth method | Login implementation |
| AI log retention | B-phase infra (Redis, workers) for D-phase use |

All prerequisites are satisfied by Phase A §15 as of the merge to `develop`.

---

# 5. Core User Flows

## 5.1 New user signup

### Default flow

1. The user enters the signup screen.
2. The user enters name, email, and password.
3. The system sends a verification email.
4. The user clicks the verification link (mandatory; cannot skip).
5. The user lands on the "create organization or accept invite" screen.
6. After joining an organization, the user lands on home.

### Exception flow

* Already-registered email → guide to login.
* Password fails policy (10+ chars, mixed classes, breach check) → field-level error.
* Email verification fails or expires → re-send option.
* Trying to reach home before joining an organization → redirect to onboarding.

---

## 5.2 Invite-based join

### Default flow

1. The user opens an invite link.
2. The system reads the invited email and token.
3. If no account, the user signs up first.
4. If an account exists, the user logs in.
5. The user sees the inviting organization and assigned role.
6. On accept, a Membership row is created in `Active` state.
7. The user lands on home.

### Exception flow

* Token expired
* Token already used
* The invited email differs from the logged-in account → reject and instruct
* Invite revoked

---

## 5.3 Organization creation

### Default flow

1. The user enters the org creation screen.
2. The user enters an organization name.
3. The system creates a default Team.
4. The creator gets the `Admin` role automatically (Phase A §15).
5. The user lands on home.

### Exception flow

* Name format error or slug collision
* Generic creation failure → preserve user input, allow retry

---

## 5.4 Login and session

### Default flow

1. The user enters email and password.
2. Auth Module verifies the password hash.
3. The system checks: account is `Active`, email is verified, organization membership is `Active`.
4. The system creates a server-side session and sets a session cookie.
5. The user lands on home.

### Exception flow

* Wrong password (constant-time compare; generic error message)
* Disabled / unverified account
* Removed from organization (no active membership)
* Session expired / revoked

---

## 5.5 Role-based access

### Default flow

1. The user is logged in.
2. The system loads the user's membership and role.
3. Menus that the role cannot access are hidden or disabled.
4. Direct URL access to a protected route is rejected by the server (the menu being hidden is not enough).

### Exception flow

* User without a role or membership → access-denied screen, route to home or contact admin
* Disabled team membership → treat as no team for permission purposes; documents owned by team transfer per Phase A §9.4

---

# 6. Screens

## 6.1 Phase B P0 screens

| Screen | Purpose | Audience |
| --- | --- | --- |
| Login | Existing user entry | Logged-out users |
| Signup | New account creation | Logged-out users |
| Email verification | Mandatory verification step | Pending users |
| Invite acceptance | Process org invite | Invited users |
| Organization creation | Create a new org | Verified users without org |
| Home dashboard (skeleton) | Default landing | Logged-in users |
| Access denied | Permission-denied notice | Logged-in users |
| Account settings (basic) | View own info | Logged-in users |
| Admin home (skeleton) | Entry to admin features | Admin only (Manager has no admin home in MVP — see §9) |

---

## 6.2 Phase B P1 screens

| Screen | Purpose | Audience |
| --- | --- | --- |
| Password reset | Account recovery | Logged-out users |
| Team management | Manage teams | Admin |
| User invite | Invite new users | Admin (Phase A §15: Manager cannot invite) |
| User list | View org users | Admin |
| Role change | Adjust user roles | Admin |
| Organization settings (basic) | Org name etc. | Admin |

---

## 6.3 Common state screens

* Loading
* Empty list
* Error
* Access denied
* Session expired
* Invite expired
* Save success / failure toast

---

# 7. Information Architecture

## 7.1 Base navigation

Phase B lays out the menu structure for later phases. Unimplemented features are shown as "preparing" placeholders.

| Menu | Phase B state | Access |
| --- | --- | --- |
| Home | Implemented | Logged-in users |
| AI document generation | Placeholder | Editor and above |
| Documents | Placeholder | Logged-in users |
| Work diary | Placeholder | Editor and above |
| To-do | Placeholder | Editor and above |
| Search | Placeholder | Logged-in users |
| Admin | Basic implementation | Admin only |
| Settings | Basic implementation | Logged-in users |

Note: Manager does not see the Admin menu in MVP. Phase A §15 Codex decision: Manager cannot invite users or manage templates. Manager has no Phase-B admin entry. Manager's elevated scope (team-document moderation) appears in C/G phases, not B.

---

## 7.2 Home dashboard composition

* Welcome message
* User's organization and team display
* Quick action area (placeholder)
* Recent documents area (placeholder)
* Work diary area (placeholder)
* Admin quick link (Admin only)

---

## 7.3 Admin home composition

* Org user count
* Team count
* Pending invite count
* User management entry
* Team management entry
* Template management entry (placeholder; Admin only — Phase A §15 Codex decision)
* Activity log entry (placeholder; Phase G implementation)

---

# 8. Data Scope (B-phase only)

## 8.1 Phase B core entities

These are the only entities Phase B creates. Phase A §15 minimum entity set is encoded here.

| Entity | DB table | B necessity |
| --- | --- | --- |
| User | `users` | Required |
| Organization | `organizations` | Required |
| Team | `teams` | Required |
| Membership | `memberships` | Required |
| Role | `roles` | Required (system-default rows seeded) |
| Invitation | `invitations` | Required |
| Session | `sessions` | Required |
| ActivityLog | `activity_logs` | Skeleton (table created; writer interface exposed; broad write coverage lands in Phase G) |
| OrganizationSetting | `organization_settings` | Required (basic columns only) |

Document, template, AI, work-context, and search tables are **not** created in Phase B.

---

## 8.2 Field-level locks tied to Phase A §15

* `users.email_verified_at` is required to transition `users.status` from `Pending` to `Active`. Until verified, the user cannot create or join an organization.
* `memberships.team_id` holds **exactly one** team per membership in MVP (or null for not-yet-assigned). Multi-team membership is deferred (Phase A §16).
* `memberships.role` is one of `Viewer`, `Editor`, `Manager`, `Admin` exactly.
* `organizations` has at most one Admin removal blocker: the system rejects any operation that would leave zero `Active` Admin memberships in an organization.
* `invitations.role` is the role to assign on accept. Phase A §15 / Codex: only Admin can create an invitation.

See `docs/database/notive-database-design-v1.0.md` §6 for full schema.

---

# 9. Permissions in Phase B

## 9.1 Role baseline

| Role | Phase B scope |
| --- | --- |
| Viewer | Home + placeholder menus for Documents and Search |
| Editor | Viewer + placeholder menus for AI generation, work diary, to-do |
| Manager | Editor + (no admin entry in MVP); Manager's elevated scope is team-document moderation in C, not user / template management in B |
| Admin | Full org management: invite, role change, team management, organization settings, last-Admin protection bypass attempts are blocked |

## 9.2 Admin-only operations in B (Phase A §15 + Codex decisions)

* Create user invitation
* Cancel / revoke invitation
* Change user role
* Disable / re-enable a user
* Create / rename / archive a team
* Assign or move a user between teams (within org)
* Edit organization settings
* (Templates: Admin-only; not implemented in B but Phase A §15 locks Admin-only ownership)

## 9.3 Last-Admin protection

The system rejects any of the following when only one `Active` Admin remains in an organization:

* Demoting that user
* Disabling that user
* Removing that user's membership
* Transferring that user out of the organization

Rejection is returned as `FORBIDDEN` with `reason_code=last_admin_protection` and recorded in `activity_logs`.

## 9.4 Menu permissions

| Menu | Viewer | Editor | Manager | Admin |
| --- | --- | --- | --- | --- |
| Home | Yes | Yes | Yes | Yes |
| AI document generation | No | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) |
| Documents | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) |
| Work diary | No | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) |
| To-do | No | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) |
| Search | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) | Yes (placeholder) |
| Admin | No | No | No (Phase A §15 Codex decision) | Yes |
| Settings | Yes | Yes | Yes | Yes |

## 9.5 Access control principles

* Apply both screen-level and data-level access control. Hiding the menu is not sufficient.
* Direct URL access to a protected route is blocked at the server.
* Cross-organization data must not be reachable via any route. The current organization context is mandatory for every protected query.
* Disabled users cannot log in.
* Expired or revoked invitations cannot be redeemed.
* Role changes and admin-scoped operations are recorded in `activity_logs`.

## 9.6 Error code convention (Phase A §15 / Codex decision)

* `UNAUTHORIZED` (401): no session.
* `FORBIDDEN` (403): authenticated, but the role lacks the requested feature permission. Use this when the user must understand "you are not allowed."
* `NOT_FOUND` (404): default for resource-permission denials. Use this whenever revealing existence of the resource itself would leak information (other-org resources, private docs, search results the user cannot see, etc.).

The default is `NOT_FOUND`. `FORBIDDEN` is reserved for the authenticated-but-feature-not-allowed case. Permission policy §15 will be updated to match.

Last-Admin protection is fixed to `FORBIDDEN` with `reason_code=last_admin_protection`.

---

# 10. Authentication Policy

Phase A §15 locks. Phase B implements them.

## 10.1 Auth method

* Email + password.
* Mandatory email verification before account becomes `Active`.
* Server-side session stored in Postgres (`sessions` table). A session cookie holds the session ID; tokens are hashed at rest.
* Constant-time password comparison; bcrypt or argon2id hash (algorithm choice locked at impl start, not before).

## 10.2 Password policy

* Minimum 10 characters.
* Must contain mixed character classes (configurable; baseline: lowercase + uppercase OR lowercase + digit).
* Breach check at signup and password change (e.g., k-anonymous Have I Been Pwned API or local Pwned Passwords corpus). If checked online, no plaintext leaves the server.
* Password reset token expires within 1 hour.

## 10.3 Session policy

* Default lifetime: 14 days idle, 30 days absolute.
* Logout clears the session row and the cookie.
* Multi-device login allowed.
* Sessions belonging to a `Disabled` user are forced to expire (logged-out on next request).

## 10.4 Future auth extensions

Phase B leaves the door open but does not implement:

* SSO (Google / Microsoft / SAML / OIDC)
* 2FA / TOTP
* IP allowlists

---

# 11. Organization and Invitation Policy

## 11.1 Organization creation

* A verified user can create one organization.
* The creator becomes the first Admin (Phase A §15).
* The system creates a default Team named `Default` (or org name) and assigns the creator to it.
* Slug is auto-generated from the name; collisions are resolved by suffixing.

## 11.2 Invitation policy

* Admin only. Codex decision: Manager cannot invite in MVP.
* Invitation specifies email, role, and optional team.
* Token has a 7-day expiry by default.
* Re-sending an invite reuses the email; previous token is revoked.
* Cancelling an invite sets `status` to `Revoked` and prevents redemption.
* Already-registered users receive an in-product invite that they accept after login.
* On accept, a Membership row is created with `status=Active`, the assigned role, and the assigned team.

## 11.3 Membership invariants

* `(user_id, organization_id)` is unique.
* MVP enforces "one active membership per user across organizations." Attempting to accept an invite while having an active membership elsewhere is rejected (Phase A §15: 1 user = 1 organization).
* Role change is Admin-only and audit-logged.
* Last-Admin protection (see §9.3).

---

# 12. Shared UI and Layout

## 12.1 Layout zones

* Side navigation
* Top bar
* Organization / team display
* User menu
* Main content area
* Toast / notification area

## 12.2 Side navigation

Per §9.4. Items the user's role cannot reach are hidden. Placeholder items show a "preparing" state to avoid user confusion.

## 12.3 Top bar

* Current page title
* Organization name
* Quick-create button (placeholder until C-phase)
* User profile menu
* Logout

## 12.4 Shared components

* Button, input, select, table, tabs, modal, toast, badge
* Empty / error / access-denied states
* Loading indicator

---

# 13. Infra Decisions (Codex-locked)

## 13.1 Short-term storage

Codex decision: **Redis-compatible short-term storage** is the Phase B standard for the store consumed by Phase D AI preview / editing. Phase B provisions a Redis-compatible service as part of the deployment but does not yet write business data into it. The concrete provider (for example managed cloud Redis, Upstash, or self-hosted Redis) is selected during Phase B infrastructure implementation and requires Codex verification.

* Connection wiring, healthcheck, and TTL semantics (24-hour idle for AI preview bodies — Phase A §15) are part of B-phase infra readiness.
* Encryption at rest (managed Redis with cluster-level encryption) and TLS in transit are required from B onward.

## 13.2 Background workers

Codex decision: cleanup runs on a **worker / cron** framework provisioned in B. Phase B does not run business cleanup yet; B only sets up the framework so C and D can register jobs without further infra work.

Jobs to be registered (later phases):

* AI preview body cleanup — every 5 minutes; deletes Redis-bound preview bodies past 24-hour idle (Phase D).
* AI request payload purge — daily; hard-deletes `ai_request_payloads` rows where `retain_until < now` (Phase D).
* AI metadata retention — daily; deletes `ai_requests` / `ai_results` / `ai_usage_logs` / `ai_references` rows older than 90 days (Phase D).
* Document soft-delete purge — daily; hard-deletes `documents` rows where `deleted_at + 30 days < now` (Phase C).

Phase B builds the worker entrypoint, cron schedule registration, idempotency primitives, and a dry-run mode. No data-mutating job runs on production until C / D is live.

## 13.3 Auth infrastructure

* Postgres-backed `sessions` table (no Redis-stored sessions in MVP — keeps the audit trail in one place).
* Mail provider for verification and invitation links (provider chosen at impl start; secrets via env).

---

## 13.4 Locked Tech Stack (Codex decision)

| Area | Lock |
| --- | --- |
| Web framework | Next.js App Router |
| Language | TypeScript |
| Runtime | Node.js LTS |
| DB | PostgreSQL (managed) |
| ORM / migration | Prisma (schema and migrations derived from DB design doc; DB design remains the source of truth) |
| Session storage | PostgreSQL-backed server session (`sessions` table) |
| Short-term store | Redis-compatible service |
| Background jobs | Worker / cron entrypoint, dry-run by default in B |
| Package manager | pnpm |
| Test baseline | Vitest (unit/integration) + Playwright (E2E) |
| Lint / format | ESLint + Prettier |
| Deployment assumption | Container-friendly single image with Web/API and Worker entrypoints; managed PostgreSQL; Redis-compatible store |

The concrete cloud provider, mail provider, and Redis-compatible service are selected during B-phase infrastructure implementation and require Codex verification. They are not part of this lock.

See `docs/architecture/notive-technical-architecture-v1.0.md` §5.1 for the architecture-level lock and `docs/operations/notive-deployment-operations-guide-v1.0.md` §4.1 for the operations view.

---

## 13.5 Project Directory Structure

The Phase B scaffold creates the following layout. Names are illustrative; the lock is on the **shape**, not exact filenames.

```text
notive/
├─ apps/
│  ├─ web/                          # Next.js App Router (Web + API route handlers)
│  │  ├─ app/
│  │  │  ├─ (auth)/                 # signup / login / verify-email / password-reset
│  │  │  ├─ (onboarding)/           # org create / invite accept
│  │  │  ├─ (app)/                  # home, settings, admin (placeholders)
│  │  │  ├─ api/                    # route handlers (REST endpoints)
│  │  │  └─ layout.tsx
│  │  ├─ components/
│  │  ├─ lib/                       # client-safe utilities only
│  │  └─ next.config.ts
│  └─ worker/                       # Node.js worker entrypoint
│     └─ src/
│        ├─ jobs/                   # registered cron jobs (B: empty / dry-run only)
│        └─ index.ts
├─ packages/
│  ├─ db/                           # Prisma schema + generated client
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  └─ migrations/
│  │  └─ src/
│  │     └─ index.ts                # re-exports prisma client
│  ├─ auth/                         # signup, login, session, password, email verify
│  ├─ permissions/                  # central Permission Module (§9 lives here)
│  ├─ mail/                         # mail provider adapter
│  ├─ redis/                        # redis client + healthcheck (no business use in B)
│  └─ shared/                       # shared TS types, error codes, constants
├─ tests/
│  ├─ unit/                         # Vitest
│  ├─ integration/                  # Vitest with real Postgres (test container)
│  └─ e2e/                          # Playwright
├─ scripts/
│  ├─ db-seed.ts                    # role rows, dev fixtures
│  └─ workers-dryrun.ts             # local cron dry-run
├─ .env.example
├─ docker/
│  ├─ Dockerfile                    # single image; web/worker selected by command
│  └─ docker-compose.yml            # local dev: Postgres + Redis + mail mock
├─ .eslintrc.cjs
├─ .prettierrc
├─ vitest.config.ts
├─ playwright.config.ts
├─ tsconfig.base.json
├─ pnpm-workspace.yaml
├─ package.json
└─ README.md
```

Constraints on the shape:

* Permission Module lives in `packages/permissions` and is the only place that emits permission-denial responses. App route handlers must call into it.
* `packages/db` is the only place that imports `@prisma/client` directly.
* Web/API and Worker use the same built image with different commands (`pnpm start:web`, `pnpm start:worker`).
* Worker code in `apps/worker` must not import Next.js. It runs as a plain Node.js process.
* `packages/redis` exposes only a typed client and healthcheck in B; business helpers are added in D.

---

## 13.6 Phase B Implementation Order

Implementation follows this strict order. Each step depends on the previous step's tests passing.

| # | Step | Output |
| --- | --- | --- |
| 1 | Repo / app scaffold | pnpm workspace, Next.js app, worker entrypoint, ESLint+Prettier, Vitest+Playwright configs, base CI |
| 2 | Env / config | `.env.example`, env validation at app bootstrap, secret loading per environment |
| 3 | DB / Prisma schema | `prisma/schema.prisma` derived from DB design §5–§12, initial migration applied to local + staging, role row seed |
| 4 | Auth / session | signup, email verification, login, logout, password reset, server session, password policy enforcement |
| 5 | Organization / team / membership | org creation (creator becomes Admin), team CRUD, single-active-membership constraint, last-Admin protection at DB + app |
| 6 | Permission Module | central denial paths, NOT_FOUND default, FORBIDDEN with `reason_code`, integration with route handlers |
| 7 | Admin skeleton | admin home placeholder, user list, role change UI, invite create/revoke |
| 8 | Audit log skeleton | `activity_logs` writer interface, B-phase events wired (login, invite, role change, disable/enable, last-Admin block), Admin-only `GET` endpoint |
| 9 | Tests | §16 checklist green in Vitest (unit + integration) and Playwright (E2E auth + permission flows) |

A step is not complete until its tests are green. Step 9 collects the tests written in earlier steps; it is not a separate "write all tests at the end" phase. Each step writes its own tests as it lands.

---

## 13.7 Required Environment Variables

Phase B needs the following before development starts. Full list with descriptions lives in `docs/operations/notive-deployment-operations-guide-v1.0.md` §4.2.

Required (B-phase):

* `NODE_ENV`
* `APP_BASE_URL`
* `LOG_LEVEL`
* `DATABASE_URL` / `DIRECT_DATABASE_URL`
* `REDIS_URL`
* `SESSION_SECRET`
* `SESSION_IDLE_TTL_DAYS`
* `SESSION_ABSOLUTE_TTL_DAYS`
* `PASSWORD_RESET_TTL_MINUTES`
* `MAIL_PROVIDER_API_KEY`
* `MAIL_FROM_ADDRESS`
* `MAIL_VERIFY_TTL_HOURS`
* `MAIL_INVITE_TTL_DAYS`
* `WORKER_DESTRUCTIVE_OPS` (default `false`)
* `WORKER_RUN_INTERVAL_OVERRIDE` (empty in production)

Not required in B but reserved (do not collide):

* `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` (C/이후)
* `AI_API_KEY` / `AI_API_BASE_URL` (D)

App bootstrap must validate the required env vars and fail fast if any are missing.

---

## 13.8 Test Baseline

Test setup is part of step 1 of §13.6 and lives in the repo from day one.

### Vitest

* Unit tests: pure functions, validators, permission helpers, password policy, last-Admin invariant logic.
* Integration tests: against a real PostgreSQL (test container or per-test schema) via Prisma. No mocking of Prisma.
* Coverage gate is not blocking in B but unit + integration paths must cover §16.1–§16.6.

### Playwright

* E2E suites for the auth flow (signup → verify → login → logout), invite flow (Admin invite → accept → membership), and permission flow (Viewer denied AI menu, Editor denied Admin URL, Manager denied Admin endpoint).
* Tests run against a Staging-like environment with seeded users.

### Lint / Format

* ESLint runs in CI on every PR; warnings allowed, errors blocking.
* Prettier runs as a check (`prettier --check`) in CI; auto-format locally.

### CI

* CI must run: type-check (`tsc --noEmit`), `eslint`, `prettier --check`, `vitest run`, `playwright test` (Playwright on a separate job to keep PR feedback fast).
* CI runs `prisma migrate deploy` against an ephemeral test DB before tests.

---

# 14. Phase B DB Migration Checklist

Migrations to ship in B (in order):

1. `users` (schema per DB design §5.1)
2. `sessions` (DB design §5.2)
3. `invitations` (DB design §5.3)
4. `organizations` (DB design §6.1)
5. `teams` (DB design §6.2)
6. `roles` (DB design §6.4) + system-role seed (Viewer / Editor / Manager / Admin)
7. `memberships` (DB design §6.3) + last-Admin protection enforced at both DB and application layers
8. `activity_logs` skeleton (DB design §12.1) — table only, no writers wired beyond a thin interface
9. `organization_settings` basic columns (DB design §12.2; only `default_role`, `default_team_id`, `invite_policy` are populated in B)

Migrations explicitly **not** in B: documents, document_versions, document_shares, templates, all AI tables, diary_entries, todos, projects, search_indexes, search_query_logs.

Each migration must include:

* Forward + backward script.
* `organization_id` indexes per DB design §14.1.
* Soft-delete fields per DB design §15.1 (where applicable).
* No raw default values that would fail after deploy (e.g., add NOT NULL columns with backfill in two steps if data exists).

---

# 15. Phase B API Checklist

Endpoints to ship in B (one section per group; full request / response shapes live in `docs/api/notive-api-spec-v1.0.md`).

## 15.1 Auth

* `POST /auth/signup`
* `POST /auth/verify-email`
* `POST /auth/resend-verification`
* `POST /auth/login`
* `POST /auth/logout`
* `POST /auth/password-reset/request`
* `POST /auth/password-reset/confirm`

## 15.2 Session

* `GET /me` (current user + active membership)

## 15.3 Organization

* `POST /organizations` (verified user; becomes first Admin)
* `GET /organizations/{id}` (Admin / member of that org)
* `PATCH /organizations/{id}` (Admin)

## 15.4 Team

* `GET /organizations/{id}/teams`
* `POST /organizations/{id}/teams` (Admin)
* `PATCH /organizations/{id}/teams/{teamId}` (Admin)
* `POST /organizations/{id}/teams/{teamId}/archive` (Admin)

## 15.5 Membership

* `GET /organizations/{id}/members`
* `PATCH /organizations/{id}/members/{userId}` (Admin only; role change, team change; last-Admin protection enforced)
* `POST /organizations/{id}/members/{userId}/disable` (Admin only; last-Admin protection enforced)
* `POST /organizations/{id}/members/{userId}/enable` (Admin only)

## 15.6 Invitation

* `POST /organizations/{id}/invitations` (Admin only; Codex decision)
* `GET /organizations/{id}/invitations`
* `POST /organizations/{id}/invitations/{invitationId}/revoke` (Admin only)
* `POST /invitations/{token}/accept` (target user; rejects if invited email ≠ logged-in account; rejects if user already has an active membership elsewhere)

## 15.7 ActivityLog (skeleton)

* `GET /organizations/{id}/activity-logs` (Admin; B-phase returns auth + admin events only — broader coverage in Phase G)

All endpoints follow the §9.6 error convention. Responses revealing existence of unauthorized resources return `NOT_FOUND`.

---

# 16. Phase B Permission Test Checklist

Every item below must pass before B is considered done.

## 16.1 Auth

* Cannot log in with unverified email.
* Cannot log in to a `Disabled` account.
* Cannot log in with a password that fails the policy check at signup.
* Session expires after the configured idle / absolute window.
* Logout invalidates the session both server-side and in the client cookie.

## 16.2 Cross-org isolation

* A request signed by a user in org A cannot read or modify any resource in org B (returns `NOT_FOUND`).
* Trying to invite into org B from a user with active membership only in org A is rejected.
* Direct ID-guess on org B's team / user / invitation IDs returns `NOT_FOUND`.

## 16.3 Role-based access

* Viewer cannot reach the AI generation menu (FORBIDDEN).
* Editor cannot reach the Admin menu (FORBIDDEN).
* Manager cannot reach any admin endpoint in B (FORBIDDEN — Codex decision).
* Admin can reach all org-management endpoints.

## 16.4 Last-Admin protection

* Demoting the only Admin returns an error and is audit-logged.
* Disabling the only Admin returns an error and is audit-logged.
* Removing the only Admin's membership returns an error.
* Transferring the only Admin out of the organization returns an error.
* All Last-Admin protection failures return `FORBIDDEN` with `reason_code=last_admin_protection`.

## 16.5 Membership uniqueness

* Accepting an invite while already an active member of another organization returns an error (Phase A §15: 1 user = 1 org).
* `(user_id, organization_id)` uniqueness is enforced at the DB level.
* A partial unique constraint enforces one `Active` membership per user across all organizations.

## 16.6 Audit log writes (skeleton)

* Login success / failure events are written.
* Invite create / accept / revoke events are written.
* Role change events are written.
* User disable / enable events are written.
* Each entry contains actor, target, action, result, IP, user agent, timestamp.

## 16.7 Infra readiness

* Redis (or chosen short-term store) responds to a healthcheck from the running app.
* The cleanup worker can run a dry-run job and reports success.
* Mail provider can deliver a verification email in staging.

---

# 17. Done Criteria

Phase B is done when **all** of the following are true.

### Documentation alignment

* Phase A §17 entry criteria remain satisfied (no documents drifted out of alignment).
* Codex review confirms no documents conflict with the §15 locks.
* Operations doc §13.4 (cleanup workers) reflects the registered B-phase jobs (even if empty in B).

### Stack and scaffolding

* Repository structure matches §13.5.
* Tech stack matches §13.4 lock (Next.js App Router / TypeScript / Node.js LTS / Prisma / pnpm / Vitest+Playwright / ESLint+Prettier).
* `.env.example` covers every required variable in §13.7; app bootstrap fails fast on missing required vars.
* `prisma migrate deploy` succeeds in Staging from a clean DB.

### Functional

* §16 checklist passes end-to-end in Staging (Vitest + Playwright + manual smoke).
* Production deployment succeeds with the §14 migrations.
* The single container image builds from the repo and runs as Web/API or Worker by command with the same env contract.

### CI

* Type-check, ESLint, Prettier check, Vitest, Playwright all run in CI on every PR.
* PRs cannot merge to `develop` with a red CI.

---

# 18. Risks and Mitigations

| Risk | Description | Mitigation |
| --- | --- | --- |
| Last-Admin enforcement gap | A code path that mutates memberships could bypass the trigger / invariant | Apply at both DB and application layers; cover all four operations (demote / disable / remove / transfer) in §16.4 tests |
| Session leak via Disabled user | Disabled users with an unexpired session could keep using the app | Force-expire sessions on disable; the next request re-checks `users.status` |
| Cross-org leak via invite | Accepting an invite while already active elsewhere could create a second active membership | Enforce single-active-membership at API and DB; reject early in `POST /invitations/{token}/accept` |
| Email verification skipped | A bug or edge case lets an unverified user create an organization | Make org creation depend on `users.status = Active`; deny at the API and at the DB constraint level |
| `NOT_FOUND` vs `FORBIDDEN` drift | Mixed conventions across endpoints leak existence | Centralize resource-permission denials in the Permission Module; default `NOT_FOUND`; lint via test cases |
| Redis introduced too early | Operational complexity with no business use yet | Deploy Redis but keep B-phase free of business writes; only healthcheck + readiness in B |
| Cleanup worker pre-arming risk | A misconfigured cron could run a destructive job in B before C / D land | Default all jobs to dry-run; require an explicit env flag to enable destructive operations |
| Audit log skeleton drifts from Phase G | Phase B writes a subset; Phase G might want different schema | Lock `activity_logs` schema now per DB design §12.1; Phase G adds writers, not columns |
| Multi-team migration cost | Customer pulls multi-team forward | Schema change is bounded (add `membership_teams` join table) but permission rewrites are wide; require explicit Phase A §15 update first |
| Prisma schema vs DB design drift | The Prisma schema and the DB design doc could diverge silently | DB design doc is the single source; implementation PRs must cite the matching DB design section and Codex verifies schema alignment |
| Container image bloat | Web + Worker shared image could grow large | Build a single image with multiple entrypoints; verify image size stays under a budget (define in B-phase infra implementation) |
| CI minutes vs Playwright cost | E2E suite slows PR feedback | Run Playwright in a separate job; gate on a smaller smoke set per PR, full suite on `develop` merges |
| Env validation gaps | Missing env var only fails deep into a request path | Validate at app bootstrap (§13.7); fail fast and log which key is missing |

---

# 19. Handoff to C

Phase C (Document Management) starts when Phase B is done.

Phase C will assume the following are in place:

* Authenticated request context with `user_id`, `organization_id`, `team_id`, `role`.
* Permission Module with the §9.6 error convention and last-Admin protection in place.
* `activity_logs` writer interface (Phase C will add document-related events).
* Cleanup worker framework (Phase C registers the soft-delete purge job).
* Redis short-term store (Phase C does not consume yet; D does).

Phase C must not modify any Phase-B entity or schema without a documented reason and a permission-policy review.

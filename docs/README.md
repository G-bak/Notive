# Notive Documentation

Notive is an AI-powered internal documentation and work operations platform.

This directory holds the document set covering Notive's product planning, implementation plans, technical design, and operations standards.

---

# 1. Recommended Reading Order

When first getting up to speed on the project, read in this order:

1. `prd/notive-prd-v1.0.md`
2. `implementation/notive-implementation-plan-v1.0.md`
3. `implementation/notive-implementation-plan-a-foundation-v1.0.md`
4. `architecture/notive-technical-architecture-v1.0.md`
5. `database/notive-database-design-v1.0.md`
6. `api/notive-api-spec-v1.0.md`
7. `ux/notive-screen-ux-design-v1.0.md`
8. `security/notive-permission-policy-v1.0.md`
9. `ai/notive-ai-generation-policy-v1.0.md`
10. `qa/notive-test-plan-v1.0.md`
11. `operations/notive-deployment-operations-guide-v1.0.md`

---

# 2. Document Structure

```text
docs/
  README.md
  prd/
  implementation/
  architecture/
  database/
  api/
  ux/
  security/
  ai/
  qa/
  operations/
```

---

# 3. Product Planning Documents

## PRD

| Document | Description |
| --- | --- |
| `prd/notive-prd-v1.0.md` | Defines Notive's product purpose, target users, core features, MVP scope, and success metrics. |

This document explains "what we are building and why."

---

# 4. Implementation Plan Documents

## Overall Implementation Plan

| Document | Description |
| --- | --- |
| `implementation/notive-implementation-plan-v1.0.md` | The full implementation roadmap split into phases A–H. |

---

## Phase-Specific Implementation Plans

| Phase | Document | Description |
| --- | --- | --- |
| A | `implementation/notive-implementation-plan-a-foundation-v1.0.md` | Defines foundational design, screen scope, permissions, data scope, and the MVP backlog. |
| B | `implementation/notive-implementation-plan-b-service-foundation-v1.0.md` | Plan for authentication, organization, team, role, and shared layout. |
| C | `implementation/notive-implementation-plan-c-document-management-v1.0.md` | Plan for document creation, storage, sharing, and version management. |
| D | `implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md` | Plan for AI document generation, templates, reference materials, and result-saving flow. |
| E | `implementation/notive-implementation-plan-e-work-context-v1.0.md` | Plan for the work diary, to-dos, and work-context-driven document generation. |
| F | `implementation/notive-implementation-plan-f-knowledge-search-v1.0.md` | Plan for internal knowledge search, AI summary search, and source attribution. |
| G | `implementation/notive-implementation-plan-g-admin-operations-v1.0.md` | Plan for admin, user management, templates, activity logs, and usage status. |
| H | `implementation/notive-implementation-plan-h-stabilization-launch-v1.0.md` | Plan for stabilization, launch readiness, QA, and operations readiness. |

---

# 5. Technical Design Documents

## Architecture

| Document | Description |
| --- | --- |
| `architecture/notive-technical-architecture-v1.0.md` | Defines overall system composition, module structure, data flow, and AI/search/security/deployment architecture. |

## DB

| Document | Description |
| --- | --- |
| `database/notive-database-design-v1.0.md` | Defines tables, fields, relations, indexes, and deletion/retention policy on PostgreSQL. |

## API

| Document | Description |
| --- | --- |
| `api/notive-api-spec-v1.0.md` | Defines REST API paths, request/response shapes, permission rules, and error handling. |

---

# 6. Implementation Support Documents

## Screens / UX

| Document | Description |
| --- | --- |
| `ux/notive-screen-ux-design-v1.0.md` | Defines per-screen purpose, components, states, error handling, and API binding. |

## Permission Policy

| Document | Description |
| --- | --- |
| `security/notive-permission-policy-v1.0.md` | Defines roles, document permissions, AI reference material permissions, search permissions, and admin permissions. |

## AI Generation Policy

| Document | Description |
| --- | --- |
| `ai/notive-ai-generation-policy-v1.0.md` | Defines AI document generation principles, output structure per document type, reference material usage, source attribution, and prohibitions. |

---

# 7. Quality and Operations Documents

## QA

| Document | Description |
| --- | --- |
| `qa/notive-test-plan-v1.0.md` | Defines tests for features, permissions, AI, search, admin, errors, and the launch-blocking criteria. |

## Operations

| Document | Description |
| --- | --- |
| `operations/notive-deployment-operations-guide-v1.0.md` | Defines environment setup, deployment, rollback, monitoring, incident response, backup, and operations work. |

---

# 8. Reference Documents by Task

## When checking product direction

* `prd/notive-prd-v1.0.md`
* `implementation/notive-implementation-plan-v1.0.md`

## When checking development scope

* `implementation/notive-implementation-plan-v1.0.md`
* `implementation/notive-implementation-plan-a-foundation-v1.0.md`
* The phase-specific implementation plans

## When starting DB/API implementation

* `architecture/notive-technical-architecture-v1.0.md`
* `database/notive-database-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## When starting frontend implementation

* `ux/notive-screen-ux-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## When implementing AI features

* `implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md`
* `ai/notive-ai-generation-policy-v1.0.md`
* `security/notive-permission-policy-v1.0.md`
* `api/notive-api-spec-v1.0.md`

## When implementing search features

* `implementation/notive-implementation-plan-f-knowledge-search-v1.0.md`
* `database/notive-database-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## When checking pre-launch readiness

* `implementation/notive-implementation-plan-h-stabilization-launch-v1.0.md`
* `qa/notive-test-plan-v1.0.md`
* `operations/notive-deployment-operations-guide-v1.0.md`

---

# 9. Document Management Principles

* When changing a document, check for conflicts with related documents.
* PRD changes can affect implementation plans and the API/DB/UX documents.
* Permission policy changes must be reflected in API, DB, UX, and QA documents together.
* AI generation policy changes are updated together with the AI test cases.
* Deployment/operations policy changes are reflected in QA and the launch criteria.

---

# 10. Suggested Next Tasks

Based on the current document set, the following work can be undertaken next:

1. Resolve and decide on undecided items
2. Author the OpenAPI spec
3. Draft the DB migration
4. Design frontend routing
5. Detailed design of the Permission Module
6. Author detailed AI prompt copy
7. Break down the QA checklist further

---

# 11. Git Branch Strategy

The default branch strategy:

**Until release, do not touch `main`. All development merges and pushes go to `develop` only.**

* `main`: stable version and release-anchor branch
* `develop`: development integration branch
* `feature/*`: individual feature development branch
* `fix/*`: bug fix branch
* `docs/*`: documentation change branch

Each feature must branch off `develop` into a new branch, and after completion be verified and merged into `develop`.

Working principles:

* Do not commit directly to `main`.
* Do not push directly to `main`.
* Feature implementation only happens on `feature/*` branches.
* Bug fixes happen on `fix/*` branches.
* Documentation changes happen on `docs/*` branches, or directly on `develop` for trivial edits.
* After completing work, merge into `develop` and push to `origin/develop`.
* `main` is updated only with an explicit deployment instruction.

Example:

```text
develop
  -> feature/auth-foundation
  -> feature/document-management
  -> feature/ai-document-generation
```

The `download/` folder and its contents are excluded from Git uploads and must not be referenced directly from code.

# CLAUDE.md

# Claude Working Guide for Notive

This document defines the collaboration standards Claude follows when performing development work on the Notive project.

---

# 1. Primary Role

Claude is primarily responsible for actual development implementation on Notive.

Main responsibilities:

* Feature implementation
* Code modification
* Bug fixing
* Writing tests
* Refactoring
* Summarizing execution results
* Reporting design issues discovered during implementation

Codex is primarily responsible for design, work direction, code review, verification, and quality judgment.

This role split is not an absolute restriction. When necessary, Claude may modify documents or supplement design, and Codex may modify files.

---

# 2. Working Method

## 2.1 Pre-implementation Check

Review related documents before starting work.

Priority order:

1. `docs/README.md`
2. The relevant implementation plan
3. `docs/architecture/notive-technical-architecture-v1.0.md`
4. `docs/database/notive-database-design-v1.0.md`
5. `docs/api/notive-api-spec-v1.0.md`
6. `docs/security/notive-permission-policy-v1.0.md`
7. UX, AI, QA, or operations docs as needed

---

## 2.2 Decision Criteria During Implementation

When documentation and code conflict during implementation, decide in this order:

1. Security and permissions
2. Data integrity
3. API contract
4. User flow
5. Implementation simplicity
6. Future extensibility

Be conservative with changes related to permissions, document storage, AI reference materials, and exposure of search results.

---

## 2.3 Post-implementation Reporting

After completing work, summarize:

* Files changed
* Features implemented
* Key design decisions
* Tests executed
* Tests that failed or could not be executed
* Remaining issues
* Points Codex should verify

---

# 3. Codex Verification Request Criteria

By default, Claude requests Codex verification after the following work:

* Permission policy changes
* Authentication/session changes
* Document access logic changes
* Changes to AI reference material handling
* Search result filtering changes
* DB schema changes
* API contract changes
* Administrator permission changes
* Changes that affect deployment/operations

Verification requests should not just say "please review"; they must specify which risks need to be examined.

Examples:

* Verify the document list permission filter is not missing
* Verify other organizations' documents are not included in AI reference materials
* Verify the migration's impact on existing data

---

# 4. Implementation Principles

## 4.1 Permissions First

Hiding menus on the screen is not enough.

Permissions must be checked at the API and data query layers.

---

## 4.2 Maintain Organization Boundaries

All core data queries and modifications must be restricted by the current organization context.

Data from other organizations must not be queried, searched, or used as AI reference material.

---

## 4.3 Protecting Document Data

Implement document save failures, autosave, version restore, and deletion handling in a way that prevents data loss.

Prefer state changes or soft delete over physical deletion.

---

## 4.4 AI Output Is a Draft

AI-generated output is not treated as a finalized document until the user reviews and saves it.

AI output must not be auto-shared.

---

## 4.5 Search and AI Use the Same Permission Standard

Material that cannot be viewed in document detail must not appear in search results, and must not be used as reference material for AI summaries or AI document generation.

---

# 5. Communication Standards

Write work descriptions concisely and verifiably.

Good reporting format:

* What was changed
* Why it was changed that way
* What tests were run
* What risks remain

Do not treat uncertain points as guesses; state them explicitly.

---

# 6. Sensitive Work

The following work requires extra care:

* Modifying permission conditions
* Modifying organization ID conditions
* Document deletion/restoration
* Scope of AI request log storage
* Search index creation/refresh
* Administrator role changes
* DB migrations
* Production environment configuration changes

---

# 7. download Folder Usage Rules

Treat the `download/` folder and everything inside it as a working storage location for raw assets.

## Basic Principles

* Files in `download/` are excluded from Git uploads.
* Code, documents, and configuration must not directly reference files inside `download/`.
* If you need assets such as logos, favicons, images, or sample files from `download/`, copy them to an appropriate location in the project before use.
* Place copied files in directories that match their purpose.

## Examples

* Copy logos to `public/assets/` or the frontend static asset folder before use.
* Copy favicons to the app's favicon location before use.
* Copy sample images to test/seed/static asset folders before referencing them.

## Prohibited

* Do not directly reference paths like `download/img/...` from code.
* Do not use files inside `download/` as deployment artifact paths.
* Do not include files inside `download/` in Git as-is.

---

# 8. Git Branch Rules

The default integration branch for development is `develop`.

**Until release, do not touch `main`. All development merges and pushes go to `develop` only.**

## Branch Convention

* `main`: stable branch updated only just before deployment or at release time
* `develop`: development integration branch
* `feature/*`: individual feature development
* `fix/*`: bug fixes
* `docs/*`: documentation changes

## Working Method

* New features must branch off `develop` into a `feature/*` branch.
* Bug fixes branch off `develop` into a `fix/*` branch.
* After completing work, merge into `develop` and push to `origin/develop`.
* Do not commit directly to `main`.
* Do not push directly to `main`.
* `main` is updated only with an explicit deployment instruction.
* If the work is subject to Codex verification, summarize the verification points before merging.

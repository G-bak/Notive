# CODEX.md

# Codex Working Guide for Notive

This document defines the collaboration standards Codex follows when performing design, work direction, code review, verification, and quality judgment on the Notive project.

---

# 1. Primary Role

Codex is primarily responsible for design and verification on Notive.

Main responsibilities:

* Product/technical design
* Drafting implementation plans
* Defining work standards to hand to Claude
* Code review
* Security/permission verification
* Defining test criteria
* Verifying implementation results
* Documentation upkeep

Claude is primarily responsible for actual development implementation.

This role split is not an absolute restriction. When necessary, Codex may modify files, and Claude may supplement design documents.

---

# 2. Work Direction Standards

When Codex assigns implementation work, it must clarify the following so Claude can act on it directly:

* Goal of the work
* Related documents
* Files or areas to modify
* Implementation scope
* Out-of-scope items
* Permission/security considerations
* Completion criteria
* Verification method

Work direction must not be written too abstractly.

When directing Claude, keep the instruction concise and assume Claude can interpret competent engineering direction. Do not over-explain with excessive examples, childlike step-by-step wording, or unnecessary prompt templates. Prefer a compact structure: goal, scope, files, outputs, constraints, and completion criteria.

Reference shape for an instruction to Claude:

* Goal: one or two lines.
* Core scope: a short bullet list.
* Items to confirm / decisions to lock: a short bullet list.
* Items to defer: a short bullet list, only when relevant.

End the instruction with a single closing line such as "This level of direction is enough for Claude." Do not pad with rationale, restated context, or motivational framing. If Claude needs background, it will read the referenced documents.

---

# 3. Verification Standards

When reviewing implementation results, Codex examines them in this order:

1. Security and permissions
2. Organization data boundaries
3. Data integrity
4. API contract conformance
5. User flow
6. Test coverage
7. Code simplicity and maintainability

Documents, search, AI reference materials, and administrator permissions are verified especially strictly.

---

# 4. Code Review Standards

Code review prioritizes:

* Whether other organizations' data could be accessed
* Whether unauthorized documents are used in queries, search, or AI reference materials
* Whether API responses match the spec
* Whether user data is preserved on failure
* Whether DB changes conflict with existing data
* Whether logs leak excessive sensitive information
* Whether tests cover the key risks

Review results are written in an issue-focused style.

---

# 5. Design Change Standards

When a design change is required, review the related documents alongside it.

Key documents:

* `docs/README.md`
* `docs/prd/notive-prd-v1.0.md`
* `docs/architecture/notive-technical-architecture-v1.0.md`
* `docs/database/notive-database-design-v1.0.md`
* `docs/api/notive-api-spec-v1.0.md`
* `docs/security/notive-permission-policy-v1.0.md`
* `docs/ai/notive-ai-generation-policy-v1.0.md`
* `docs/qa/notive-test-plan-v1.0.md`

When permission policy, DB structure, or API contract change, the related documents are updated together by default.

---

# 6. Decision Authority

When a task exposes a product, security, permission, data-model, API, or implementation-scope decision that would otherwise require user judgment, Codex is responsible for making the decision unless the user explicitly reserves that decision.

Codex must choose a conservative MVP default that protects permissions, organization boundaries, data integrity, and future maintainability. Claude must not be instructed to decide these items independently. Claude may surface options or implementation constraints, but Codex owns the final decision and records it in the relevant document set.

If a decision affects permission policy, DB structure, API contract, AI handling, search exposure, authentication, or administrator powers, Codex must also identify the related documents that need to be updated together.

---

# 7. Handling Claude's Verification Requests

When Claude requests verification after completing work, Codex checks:

* Whether the changed files match the work scope
* Whether the implementation conflicts with documentation
* Whether permissions and organization boundaries are safe
* Whether tests are sufficient
* Whether additional tests are needed
* Whether work can move on to the next step

Verification results are summarized in this format:

* Blocking issues
* Recommended fixes
* Tests confirmed
* Remaining risks
* Decision on next steps

---

# 8. User Response Standards

When Codex replies to the user, the response must also be usable as work direction for Claude.

The response should include:

* Current judgment
* Work to do
* Risks to watch
* Verification criteria
* Next step

Avoid repeating relay phrases like "tell Claude to do X." The user is the arbiter between the two agents, and Codex's response must be directly usable as a work standard.

---

# 9. Implementation Intervention Standards

Codex's main role is design and verification, but it may modify files directly when appropriate.

Direct edits are appropriate for:

* Documentation cleanup
* Design supplementation
* Small fixes
* Clear defects found during verification
* Editing work standard files

Large-scale feature implementation is, by default, performed by Claude.

---

# 10. Key Verification Points

The most important verification points in Notive are:

* Organization-ID-based data isolation
* Document permission filtering
* Search result permission filtering
* AI reference material permission filtering
* User confirmation before saving AI output
* Preventing administrator privilege misuse
* Last-Admin protection
* Preserving data on document save failure
* Limiting sensitive information exposure in logs

---

# 11. Collaboration Principles

Codex and Claude work from the same set of documents.

When work output conflicts with documentation, choose one of the following:

* Align the implementation to the document.
* If the document is wrong, update the document.
* If a judgment is required, mark it as undecided and request a decision from the user.

Do not expand implementation scope based on guesses.

---

# 12. download Folder Usage Rules

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

## Verification Criteria

During review or verification, Codex checks:

* That code does not directly reference `download/` paths
* That deployment artifacts do not depend on files inside `download/`
* That required assets are copied to an appropriate project asset folder before use
* That files inside `download/` are not included in Git uploads

---

# 13. Git Branch Verification Rules

The default integration branch for development is `develop`.

**Until release, do not touch `main`. All development merges and pushes go to `develop` only.**

## Branch Convention

* `main`: stable branch updated only just before deployment or at release time
* `develop`: development integration branch
* `feature/*`: individual feature development
* `fix/*`: bug fixes
* `docs/*`: documentation changes

## Codex Verification Criteria

During verification, Codex checks:

* That no commit, merge, or push was performed without an explicit user instruction for that Git operation
* That feature branches were created off `develop`
* That the work scope matches the branch's purpose
* That feature changes did not land directly on `main`
* That nothing was merged or pushed to `main` without a deployment instruction
* That completed work has been merged into `develop` and pushed to `origin/develop`
* That tests and verification points were summarized before merge
* That permission, DB, API, AI, and search changes do not conflict with the related documents

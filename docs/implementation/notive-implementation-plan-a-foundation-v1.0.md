# A. Foundation Design Detailed Plan v1.0

# Notive Foundation Design

---

# 1. Purpose

This document defines the detailed plan for Phase A (Foundation Design) of Notive's overall implementation plan.

The goal of Phase A is to lock product structure, screen scope, user flows, permission criteria, data scope, and the MVP backlog before development begins. It serves as the reference document for Phase B (service foundation) and Phases C–H (feature implementation).

---

# 2. Phase A Goals

By the end of Phase A, we must be able to answer:

* What is the user's flow through the first MVP?
* Which screens are built first, and which are deferred?
* What features and data are accessible per user role?
* What core data is required for documents, templates, work records, to-dos, and search?
* What is the input → processing → output flow for AI document generation?
* How are work items prioritized across Phases B–H?

---

# 3. Phase A Deliverables

When Phase A completes, the following deliverables must be ready:

| Deliverable | Description | Downstream use |
| --- | --- | --- |
| MVP user-flow definition | Core flows and exception flows | Screen design, QA criteria |
| Screen list and priorities | Split MVP screens vs. later screens | UI implementation scope |
| Information architecture | Menus, navigation, screen-to-screen movement | Layout implementation |
| Permission matrix | Per-role feature and data access | Auth / permission implementation |
| Key data definitions | Core data entities and field-level scope | DB design, API design |
| AI generation flow | AI request, reference materials, result-save flow | AI feature implementation |
| MVP backlog | Implementation items by phase with priorities | Phases B–H execution |
| Launch criteria draft | Definition of "MVP done" | Stabilization and launch |

---

# 4. Design Principles

## 4.1 MVP-first

The initial product does not target full work automation. It focuses on validating repeated document authoring and work-context-driven document generation.

---

## 4.2 User confirmation in the loop

Features that auto-finalize or auto-share AI output are minimized. The default flow is: AI generates → user reviews → user edits → user saves → user (optionally) shares.

---

## 4.3 Permissions first

Documents and work records are internal organizational data, so screen design and data design include permission criteria from the start.

---

## 4.4 Simple organizational structure

Initial design centers on company, team, user, and role (Department is unified into Team for MVP — see §15). Complex structures (subsidiaries, multi-org membership, granular position hierarchies) are deferred to later phases.

---

## 4.5 Extensible document-centric structure

Notive's central asset is the document. Work diary, to-do, templates, search, and AI generation are designed as supporting structures that help create and use documents better.

---

# 5. Core User Flows

## 5.1 New organization onboarding

### Default flow

1. The user enters via signup or an invitation link.
2. The user creates a new organization or accepts an invitation to an existing one.
3. The user sets name, job title, and team information.
4. A default role is assigned.
5. The user lands on the home screen.

### Decisions locked in this phase (see §15)

* Signup mode (public / invite / both)
* Who may create an organization
* Whether the organization creator becomes the first Admin
* Whether email verification is required

---

## 5.2 AI document generation

### Default flow

1. The user enters the AI document generation screen.
2. The user picks a document type.
3. The user picks a template.
4. The user enters a natural-language request.
5. The user picks reference materials if needed.
6. The AI generates a draft.
7. The user reviews the result and moves to the editor.
8. The user saves the document.
9. The user shares the document with a team or specific users if needed.

### Exception flow

* On AI generation failure, retry or guide the user to edit the request.
* If no reference materials are picked, fall back to template-only generation.
* If the user selects unauthorized materials, block the selection.
* If the result is unsatisfactory, regenerate or hand off to the editor for direct editing.

---

## 5.3 Document authoring and management

### Default flow

1. The user creates a new document or opens an existing one.
2. The user edits the document.
3. The user saves (or autosave kicks in).
4. The user sets metadata.
5. The user sets the share scope.
6. The user later returns via document list, search, or recent documents.

### Decisions locked in this phase (see §15)

* Autosave interval
* Role split between explicit save and autosave
* Default document share scope
* Document deletion policy
* Version restore scope

---

## 5.4 Report generation from the work diary

### Default flow

1. The user authors per-day work records.
2. The user links a project, tags, and related documents to each entry.
3. The user requests report generation.
4. The AI uses the selected period's work records as context.
5. The AI generates a report draft.
6. The user edits and saves the report.

### Decisions locked in this phase (see §15)

* How personal vs. team-shared work records are distinguished
* User consent model when work records are used as AI context
* Period-selection model
* How done / not-done work is represented

---

## 5.5 Internal document search

### Default flow

1. The user enters a search query.
2. The system searches only documents the user has permission to access.
3. Results show title, summary, author, date, and tags.
4. The user opens a result document.
5. For natural-language search, the user also sees a related-document summary with source attribution.

### Decisions locked in this phase (see §15)

* Whether plain search and AI search live on the same screen
* Result sort order
* Summary length shown in results
* Whether the existence of unauthorized documents is hidden

---

## 5.6 Admin operations

### Default flow

1. An Admin enters the admin screen.
2. The Admin invites or deactivates users.
3. The Admin creates teams and assigns users.
4. The Admin adjusts roles and permissions.
5. The Admin creates or edits document templates.
6. The Admin checks key activity logs.

### Decisions locked in this phase (see §15)

* What a Manager can manage
* What only an Admin can do
* How a deactivated user's documents are handled
* Whether template edits affect existing documents

---

# 6. Screen List and Priority

## 6.1 P0 screens

P0 screens are required for the MVP core flows.

| Area | Screen | Purpose |
| --- | --- | --- |
| Auth | Login | User entry |
| Auth | Signup / accept invite | Join an organization |
| Onboarding | Organization create / select | Start using under an organization |
| Home | Dashboard | Quick access to recent documents and key actions |
| AI generation | Generation request | Start an AI document generation |
| AI generation | Generation preview | Review result and switch to editor |
| Documents | Document list | Browse stored documents |
| Documents | Document editor | Author and edit |
| Documents | Document detail | View a document |
| Documents | Share settings | Control access scope |
| Work | Work diary | Author work records |
| Admin | User management | Invite users and manage status |
| Admin | Template management | Manage document templates |

---

## 6.2 P1 screens

P1 screens improve MVP quality and operability.

| Area | Screen | Purpose |
| --- | --- | --- |
| Documents | Version history | Inspect history and restore |
| Search | Unified search | Find documents |
| Work | To-do list | Basic work item management |
| Admin | Team management | Manage organization structure |
| Admin | Permission management | Roles and access control |
| Admin | Activity log | Audit and operations |
| Settings | Personal settings | Personal info and defaults |
| Settings | Organization settings | Per-organization configuration |

---

## 6.3 P2 screens

P2 screens are built later or expanded based on customer demand.

| Area | Screen | Purpose |
| --- | --- | --- |
| Reports | Usage dashboard | Usage and outcome analytics |
| Search | AI search detail | Richer summaries and source attribution |
| Work | Project detail | Project-centric work management |
| Admin | Advanced security settings | Enterprise-grade security |
| Integrations | External service integrations | Connect external tools |

---

# 7. Information Architecture

## 7.1 Base navigation

The initial navigation follows this structure:

* Home
* AI document generation
* Documents
* Work diary
* To-do
* Search
* Admin
* Settings

---

## 7.2 Screen access

| Menu | Access |
| --- | --- |
| Home | All logged-in users |
| AI document generation | Editor and above |
| Documents | All logged-in users |
| Work diary | Editor and above |
| To-do | Editor and above |
| Search | All logged-in users |
| Admin | Manager (partial) and Admin (full) |
| Settings | All logged-in users |

---

## 7.3 Home composition

The home screen exists to chain the user into their next action quickly.

### Main blocks

* "New AI document" button
* Recent documents
* Recent work records
* My to-dos
* Documents shared with me
* Operations notices visible only to admins

---

# 8. Permission Matrix

## 8.1 Role definitions

| Role | Description |
| --- | --- |
| Viewer | Read-only user limited to documents they are allowed to access |
| Editor | General user who can author and edit documents |
| Manager | Manages team documents and team members |
| Admin | Manages the entire organization |

---

## 8.2 Feature permissions

| Feature | Viewer | Editor | Manager | Admin |
| --- | --- | --- | --- | --- |
| View documents | Yes | Yes | Yes | Yes |
| Create documents | No | Yes | Yes | Yes |
| Edit documents | Permitted docs only | Permitted docs only | Team docs allowed | Within configured scope |
| Share documents | No | Limited / requested sharing | Team-scope sharing | Full sharing settings |
| AI generation | No | Yes | Yes | Yes |
| Author work diary | No | Yes | Yes | Yes |
| Author to-dos | No | Yes | Yes | Yes |
| Manage team users | No | No | Limited | Yes |
| Manage templates | No | No | Limited | Yes |
| Permission settings | No | No | No or limited | Yes |
| View activity log | No | No | Team scope | Yes |

---

## 8.3 Document access scope

A document carries one of these share scopes:

| Scope | Description |
| --- | --- |
| Private | Only the author |
| Team | Members of the assigned team |
| Organization | Everyone in the organization |
| Specific Users | Only explicitly listed users |

The "Department" scope is intentionally not present. Department is unified into Team for MVP (see §15 and §16).

---

## 8.4 Locked permission decisions

The MVP decisions on permissions are recorded in §15. In short:

* Default share scope: **Private**
* Manager share-approval: **Not in MVP** (Manager can share team-scope directly without an approval workflow)
* Editor external sharing: **Not in MVP** (no external link sharing)
* Document owner change: **Admin only**, audit-logged
* Deactivated user's documents: ownership transfers to the user's primary team's Manager; if none, to the organization's first Admin
* Admin organization-wide read of document bodies: **Not in MVP**. Admin sees metadata only across the organization. Body access requires the document to be shared at Organization scope or shared explicitly to the Admin.

---

# 9. Key Data Definitions

## 9.1 Core entities

| Data | Description | MVP necessity |
| --- | --- | --- |
| User | User account | Required |
| Organization | Company or organization | Required |
| Team | Team unit (Department unified into Team for MVP) | Required |
| Membership | A user's organization membership and role | Required |
| Role | Role types | Required |
| Invitation | Invite token for signup / org join | Required |
| Session | Auth session record | Required |
| Document | Document body and state | Required |
| DocumentVersion | Document revision history | P1 |
| DocumentShare | Document share scope | Required |
| Template | Document templates | Required |
| DiaryEntry | Work diary entries | Required |
| Todo | To-do items | P1 |
| Project | Work unit | P1 |
| ActivityLog | Key activity log | P1 |
| AIRequestLog | AI request records | Required |
| SearchIndex | Search target information | P1 |

---

## 9.2 User

### Key fields

* Name
* Email
* Profile image
* Status
* Last login timestamp

### Locked decisions

* Email is the unique account identifier.
* Social login is **not in MVP**.
* User deletion is **soft delete**; deactivation is a separate state. See deletion policy in §15.

---

## 9.3 Organization

### Key fields

* Organization name
* Organization identifier
* Plan / scope
* Default security settings
* Created at

### Locked decisions

* A user belongs to exactly one organization in MVP.
* Organization name change: Admin only.
* Organization deletion: Admin-initiated soft delete with a 30-day cooldown before purge.

---

## 9.4 Team

### Key fields

* Team name
* Parent organization
* Team manager
* Status

### Locked decisions

* Team and Department are unified under "Team" in MVP. The "Department" share scope is dropped (see §15).
* A user has exactly one primary team in MVP (stored as `memberships.team_id`; may be null for users not yet assigned). Multi-team membership is deferred (§16).
* Team deletion: documents owned by the team transfer to the organization-default team; if none exists, to the first Admin.

---

## 9.5 Document

### Key fields

* Title
* Body
* Document type
* Status
* Author
* Owning team
* Share scope
* Tags
* Generation source (manual / AI)
* Created at
* Updated at

### Status values

* Draft
* Active
* Archived
* Deleted

### Locked decisions

* Body storage format: structured JSON (block-based) plus rendered Markdown for preview / search indexing.
* Autosave: every 10 seconds while editing; explicit Save promotes Draft → Active.
* Deleted-document retention: 30 days, then hard-deleted by a background job. Owner or Admin can restore within the retention window.
* Default document type: "Note" (unstructured).
* File attachments: **deferred to post-MVP**.

---

## 9.6 Template

### Key fields

* Template name
* Document type
* Applied organization or team
* Body structure
* In-use flag
* Created by
* Updated at

### Locked decisions

* A small built-in template set ships with MVP (meeting notes, weekly report, project plan, decision memo).
* Team-scoped templates take priority over organization-scoped templates when both apply.
* Editing a template does **not** retroactively modify existing documents that used it. Existing docs keep their snapshotted structure.

---

## 9.7 DiaryEntry

### Key fields

* Author
* Date
* Content
* Related project
* Tags
* Visibility
* Related documents

### Locked decisions

* Default visibility: **Private** (author only).
* Author may opt to share an entry to **Team**.
* AI generation: an entry may be used as AI context only if the requesting user has read access to it under the same rules used by document detail and search.

---

## 9.8 Todo

### Key fields

* Title
* Description
* Owner
* Due date
* Status
* Priority
* Related document
* Related project

### Locked decisions

* MVP supports **personal to-dos only**. Assignment to other users is deferred.
* Status values in MVP: `todo`, `in_progress`, `done`.
* Reports can include a to-do as context only when its status is `done` within the selected period.

---

# 10. AI Document Generation Flow

## 10.1 Inputs

Available inputs at generation time:

* Document type
* Template
* Natural-language request
* Reference documents
* Work diary entries
* To-dos
* Project or tags
* Generation purpose

---

## 10.2 Generation flow

1. The user picks a document type.
2. The system shows applicable templates.
3. The user enters the request.
4. The user picks reference materials.
5. The system filters reference materials to those the user has permission to read.
6. The AI generates a draft.
7. The system shows the result with reference attributions.
8. The user moves to the editor.
9. On save, the draft becomes a registered document.

---

## 10.3 Result handling

AI output is treated as a draft, never an automatically finalized document.

### Result states

* Generating
* Generated
* Failed
* Editing
* Saved

---

## 10.4 AI logging

AI request records are stored to support quality improvement and incident investigation. Locked retention scope:

### Stored fields

* Requester
* Request timestamp
* Document type
* Selected template ID
* Reference material IDs (IDs only, not contents)
* Success / failure
* Error code
* Latency
* Token usage
* Whether the result was saved

### Not stored by default

* Full prompt body
* Full AI response body
* Document body content

If the user explicitly opts in via a "Report problem" / feedback flow, the prompt and response bodies for that single request are stored for 30 days for triage and then purged.

### Retention

* Standard records: 90 days.
* Opt-in problem-report payloads: 30 days.

---

# 11. MVP Backlog Draft

## 11.1 Epics

| Epic | Description | Priority |
| --- | --- | --- |
| Auth and organization | Login, organization creation, invites | P0 |
| Permissions | Roles, document access, menu access | P0 |
| Documents | Document list, editor, save, share | P0 |
| AI generation | Document type, template, request, result save | P0 |
| Templates | Built-in, organization / team templates | P0 |
| Work diary | Work-record authoring and use as AI context | P0 |
| Search | Document search, results | P1 |
| To-do | Basic personal to-dos | P1 |
| Admin | User, team, template management | P1 |
| Logs | Key activity and AI request records | P1 |

---

## 11.2 P0 backlog

* User login
* Accept invite
* Create organization
* Create team
* Assign user role
* View document list
* Author document
* Save document
* View document detail
* Set document share scope
* Submit AI document generation request
* Preview AI generation result
* Hand off to editor
* Pick template
* Register a built-in template
* Author work diary entry
* Generate a report from work records

---

## 11.3 P1 backlog

* Document version history
* Document restore
* Unified search
* Search filters
* Author to-do
* Mark to-do done
* Admin user list
* Admin team management
* Edit template
* View activity log
* View AI request log

---

## 11.4 P2 backlog

* Richer AI search summaries
* Project detail management
* Team-level reports
* Usage dashboard
* Advanced security settings
* External service integration scaffolding

---

# 12. Technical Direction Decisions

Phase A does not finalize detailed implementation choices, but the following directions must be locked before Phase B.

## Items to decide

* Web application framework
* Database
* Authentication method
* File and document storage
* AI API integration
* Deployment environment
* Logging and monitoring
* Dev / test / prod environment separation

---

## Decision criteria

* MVP development speed
* Team's existing skill set
* Operational complexity
* Security requirements
* Future enterprise expansion
* Cost predictability

---

# 13. Launch Criteria Draft

Phase A defines a draft of the launch criteria that Phase H will use.

## MVP launch criteria

* The user can enter an organization via signup or invite acceptance.
* Editor-and-above users can generate AI document drafts.
* Generated documents can be edited and saved.
* Saved documents are viewable in list and detail.
* Document access is restricted by share scope.
* Work diary entries can be used to generate documents.
* An Admin can manage users and templates.
* Key activities and AI requests are traceable.

---

# 14. Phase A Checklist

## Product scope

* Are the in-scope and out-of-scope features locked?
* Are P0, P1, P2 priorities agreed?
* Are core user flows documented?

---

## Screens and UX

* Is the P0 screen list locked?
* Is the base navigation locked?
* Are the home screen's main blocks locked?
* Are the input and result screens of the AI generation flow defined?

---

## Permissions

* Are per-role feature permissions locked?
* Is the document share scope locked?
* Is the Admin vs. Manager distinction clear?
* Are permission limits in search and AI generation defined?

---

## Data

* Are the core data entities locked?
* Are document states and share scopes defined?
* Is the MVP scope of work diary and to-do locked?
* Is the AI request log retention scope locked?

---

## Phase B readiness

* Are the decisions required to start Phase B locked?
* Is the MVP backlog organized by epic?
* Is the launch-criteria draft defined?
* Are deferred items tracked separately?

---

# 15. Locked MVP Decisions

The following decisions are locked for MVP. They are the contract Phase B builds against. Any change requires a new revision of this document and Codex verification.

| Topic | Decision | Why |
| --- | --- | --- |
| Signup mode | Self-serve signup with email verification. After signup, the user must either accept an invite or create a new organization. No discover / request-to-join flow. | Single bootstrap path keeps onboarding simple while still requiring email proof. |
| First Admin | The user who creates a new organization automatically becomes that organization's first Admin. The system enforces "last Admin" protection: removing or downgrading the only remaining Admin is rejected. | Removes a separate approval step in MVP and protects against accidental lockout. |
| Organization membership | One organization per user in MVP. Multi-org membership is deferred. | Avoids cross-org context-switching UI and a wider permission surface for MVP. |
| Team structure | Single-level teams. "Department" is unified into "Team"; the Department share scope is dropped. **A user belongs to exactly one primary team in MVP** (`memberships.team_id`, single value). Multi-team membership is deferred. | Matches the existing DB single-team model; "same-team" permission filters stay simple for MVP. |
| Default document share scope | Private (author only). Available scopes in MVP: Private, Team, Organization, Specific Users. | Conservative default; users opt in to broader visibility. |
| Admin document visibility | Admin sees metadata for all organization documents (title, owner, scope, sizes, timestamps). Admin reads body content only when the document is at Organization scope or has been shared with the Admin. Cross-organization body access is not granted in MVP. | Permissions-first principle and user trust. Compliance-style override is a post-MVP feature. |
| Work diary visibility | Default Private. Author may share an entry to Team. AI may use an entry as context only if the requesting user has read access to it under the same rule. | Mirrors document permission semantics; protects personal notes by default. |
| To-do MVP scope | Personal to-dos only. Statuses: `todo`, `in_progress`, `done`. No assignment to other users, no team to-dos. | Keeps E-phase scope small; team workflows are P2. |
| Document deletion policy | Soft delete with 30-day retention. Owner or Admin can restore within the window. A background job hard-deletes after 30 days. Hard delete from the trash before 30 days requires Admin "purge" with explicit confirmation. | Data-protection principle from CLAUDE.md §4.3. |
| AI log retention | Store metadata only by default (requester, timestamp, doc type, template ID, reference IDs, success / failure, error code, latency, token usage, save flag). Standard retention 90 days. Full prompt and response bodies are stored only via opt-in problem-report flow with 30-day retention. | Permissions-first and AI-output-is-draft principles; protects sensitive content from accidental retention. |
| Authentication method | Email + password with mandatory email verification. Server-side session storage. Password policy: 10+ chars, mixed character classes, breach check at signup and password change. | Lowest-friction baseline that still meets MVP security bar. SSO and 2FA are deferred. |
| P0 screens | Locked to the list in §6.1. | Fixed scope for Phases B–H. |
| Phase B minimum entities | `User`, `Organization`, `Membership`, `Team`, `Role` (enum: Viewer / Editor / Manager / Admin), `Invitation`, `Session`, plus an `AuditLog` skeleton (table + writer interface; full write coverage lands in Phase G). | Sufficient to build auth, org/team, role, invitation, and the base layout in Phase B without pulling in document or AI tables. |

---

# 16. Deferred Items (post-MVP)

These items are explicitly **not** in MVP. They must not be silently smuggled into Phase B–H scope.

| Item | Reason |
| --- | --- |
| Multi-organization membership | Adds context-switch UI and permission complexity; revisit after first customers. |
| Multi-team membership (one user in many teams) | Requires a `membership_teams` join table and a "primary team" concept; permission filters get more expensive. Revisit when a customer needs cross-team membership. |
| Department concept (separate from Team) | Single-level Team covers the MVP need; Department becomes meaningful at enterprise scale. |
| External link sharing of documents | Outside the controlled-access model in MVP. |
| Manager share-approval workflow | Adds workflow surface; Manager shares team-scope directly in MVP. |
| Admin organization-wide body read / compliance access | Trust-sensitive; design separately with audit + legal review. |
| Team-assigned to-dos | E-phase scope kept tight; depends on a clearer ownership model. |
| File attachments on documents | Storage, antivirus, preview pipeline; sized as its own phase. |
| Document version restore UI | Versioning storage lands in MVP, restore UI is P1. |
| SSO / SAML / OAuth | Enterprise sales requirement, post-MVP. |
| 2FA / TOTP | High priority post-MVP, not blocking launch. |
| Real-time collaborative editing | Out of MVP scope per §3 of the overall plan. |
| Autonomous AI agent execution | Out of MVP scope per §3 of the overall plan. |
| Mobile / desktop / on-premise | Out of MVP scope per §3 of the overall plan. |
| AI prompt and response body retention by default | Sensitive; opt-in only in MVP. |

---

# 17. Phase B Entry Criteria

Phase A is complete and Phase B may start when **all** of the following are true:

* §15 decisions are locked in this document.
* §16 deferred items are recorded and not in Phase B scope.
* P0 screen list (§6.1) is locked.
* Phase B minimum entities (§15) are reflected in the database design document.
* Authentication method, default share scope, deletion policy, and AI log retention from §15 are reflected in the security and AI policy documents.
* Codex has verified the §15 decisions against the permission policy and database design documents.

# C. Document Management Detailed Plan v1.0

# Notive Document Management

---

# 1. Purpose

This document defines the detailed plan for Phase C (Document Management) of Notive's overall implementation plan.

The goal of Phase C is to build the document management foundation through which a user can create, save, view, modify, share, and re-discover documents. The document structure produced in this phase becomes the central data for Phase D (AI document generation), Phase E (work context), and Phase F (in-house knowledge search).

---

# 2. Phase C Goals

When Phase C completes, the following must be possible.

* A user can create a new document.
* A user can save a document and re-open it.
* Basic document metadata — title, body, type, tags — can be managed.
* A user can edit a document and view its change history.
* A user can configure the document's visibility scope and access targets.
* Document access is restricted by role and share scope.
* A user can navigate documents by recent, favorite, and basic filters.
* The foundation is ready for storing AI-generated output as a document in later phases.

---

# 3. Phase C Scope

## 3.1 In scope

* Document list
* Document detail
* Document creation
* Document editing
* Manual save
* Draft save
* Basic auto-save
* Document state management
* Document type management
* Tag management
* Recent documents
* Favorites
* Document share-scope configuration
* Sharing with specific users
* Team sharing
* Document version history
* Viewing previous versions
* Basic restore
* Document delete or archive handling

---

## 3.2 Out of scope

* AI document generation
* AI-based document summarization
* Natural-language search
* Advanced attachment handling
* Real-time collaborative editing
* Comments and mentions
* Approval / review workflow
* External share links
* Electronic signatures
* Offline editing

---

# 4. Prerequisites

The following must be in place from Phase B before Phase C work begins.

## 4.1 User / organization identification and base UI

| Item | Reason |
| --- | --- |
| Logged-in user identification | Sets document author and owner |
| Current organization identification | Separates documents per organization |
| Team identification | Determines team-share and document ownership scope |
| Role check | Determines create / edit / share permissions |
| Base layout | Document screen entry and navigation |
| Access denial handling | Blocks access to documents the user has no permission for |

## 4.2 Phase B artifact dependencies

Phase C permission decisions, audit records, and response policies are written on top of the following Phase B artifacts.

| Item | Source | Reason |
| --- | --- | --- |
| `@notive/permissions` permission module | Phase B Step 6 | All permission decisions for the document list / detail / edit / share are delegated to a single module. Phase C extends this module with document-domain rules rather than introducing parallel checks. |
| `apps/web/lib/audit` audit writer skeleton | Phase B Step 8 | Success events for mutating actions (create / update / share-change / delete / restore) are written through the same writer. Phase C does not add new columns to `activity_logs`. |
| 1 user = 1 active organization constraint | Phase A §15 / Phase B Step 5 | Forms the context for document-owning organization and share-scope decisions. Concurrent multi-organization access is not assumed. |
| Single primary team via `memberships.team_id` | Phase A §15 / Phase B Step 5 | Single basis for document-owning team and team-share decisions. Multi-team ownership is not introduced until Phase A §15 is updated. |
| Last-Admin protection | Phase B Step 7 | Phase C document flows do not directly modify membership role / status. When document ownership transfer or share-manager assignment is coupled with a membership change flow, Phase B Last-Admin protection is not bypassed. |
| `NOT_FOUND` / `FORBIDDEN(reason_code)` response policy | Phase B Step 6 / §15.2 | Permission denials default to `NOT_FOUND` so that resource existence is not leaked. `FORBIDDEN(reason_code)` is used only when an explicit reason must be exposed. |

---

# 5. Primary user flows

## 5.1 New document creation

### Main flow

1. The user selects "Create new document" from the document menu.
2. The user picks a document type or starts with a generic document.
3. The user enters a title and body.
4. The user sets tags or owning team.
5. The user saves.
6. The save result is reflected in the document detail or editor screen.

### Exception flow

* Saving without a title falls back to a default title or prompts for input.
* An empty body is allowed for draft save.
* On save failure, the user is offered retry and draft-preservation guidance.
* If the user lacks create permission, entry to the create screen is blocked.

---

## 5.2 Document viewing

### Main flow

1. The user enters the document list.
2. The user sees the documents they have access to.
3. The user applies filter or sort.
4. The user picks a document.
5. The user views its content on the detail screen.

### Exception flow

* Documents the user has no access to are not shown in the list.
* Direct URL access without permission shows the access-denied screen.
* Deleted or archived documents show a state-appropriate message on access.

---

## 5.3 Document editing

### Main flow

1. The user selects "Edit" from the document detail screen.
2. Edit permission is checked.
3. The user modifies title, body, tags, and document metadata.
4. The user saves.
5. A change history record is written.

### Exception flow

* If the user lacks edit permission, the Edit button is hidden or entry is blocked.
* If a stale version is being saved over a newer one, a conflict notice is shown.
* On save failure, the user's in-progress content must not be lost.

---

## 5.4 Document sharing

### Main flow

1. The document owner or another permitted user opens the share dialog.
2. The user selects a share scope.
3. The user designates a specific team, user, or the entire organization (per Phase A §15, the Department share scope is consolidated into Team).
4. The user sets the access permission level.
5. The user saves.
6. The share targets see the document in their list or in their "Shared with me" view.

### Exception flow

* Users without share permission cannot open the share dialog.
* External sharing outside the organization is not provided in MVP.
* Whether Viewer can be granted edit permission follows the permission policy.

---

## 5.5 Version review and restore

### Main flow

1. The user opens the version history from the detail or editor screen.
2. The user reviews the saved version list.
3. The user previews a specific version.
4. The user restores it as the current document if needed.
5. The restore itself is recorded as a new change-history entry.

### Exception flow

* Users without restore permission cannot restore.
* Restoring versions of a deleted document follows the admin policy.
* Whether very old versions are retained follows the retention policy.

---

# 6. Screen composition

## 6.1 Phase C P0 screens

| Screen | Purpose | Audience |
| --- | --- | --- |
| Document list | Browse accessible documents | Logged-in users |
| Document detail | View document content | Users with access to the document |
| Document create | Create a new document | Editor and above |
| Document edit | Edit an existing document | Users with edit permission |
| Share settings | Configure document share scope | Owner, Manager, Admin |
| Access denied | Notice for documents the user has no permission for | Logged-in users |

---

## 6.2 Phase C P1 screens

| Screen | Purpose | Audience |
| --- | --- | --- |
| Version history | View document change history | Users with access to the document |
| Version preview | View a specific version's content | Users with access to the document |
| Deleted / archived list | View deleted or archived documents | Admin or document owner |
| Favorite documents | Quick access to frequently-used documents | Logged-in users |
| Recent documents | Quick access to recently viewed / edited documents | Logged-in users |

---

## 6.3 Document list composition

The document list is a recurring, high-traffic screen, so it focuses on fast browsing.

### Display elements

* Document title
* Document type
* Author
* Owning team
* Share scope
* Tags
* Last-modified date
* Favorite flag
* State

### Default filters

* My documents
* Shared with me
* Team documents
* Favorites
* Recently modified
* Document type
* Tag

---

## 6.4 Document detail composition

### Display elements

* Title
* Body
* Document type
* Author
* Owning team
* Share scope
* Tags
* Created date
* Last-modified date
* Version info

### Primary actions

* Edit
* Share settings
* Favorite
* Version history
* Duplicate
* Archive or delete

---

## 6.5 Document edit composition

### Edit elements

* Title input
* Body editor
* Document type selector
* Tag input
* Owning team selector
* Save button
* Draft save state
* Entry to share settings

### Edit UX principles

* Save state is clearly displayed.
* The user's in-progress content must not be lost.
* The structure must allow AI-generated output to flow into the editor in later phases.
* The screen must not become overly complex during long-form editing.

---

# 7. Data design scope

## 7.1 Phase C core data

| Data | Description | Priority |
| --- | --- | --- |
| Document | Document body and metadata | P0 |
| DocumentVersion | Document change history | P1 |
| DocumentShare | Document share targets and permissions | P0 |
| DocumentTag | Document tag | P0 |
| DocumentFavorite | Per-user favorites | P1 |
| DocumentViewHistory | Recent-document records | P1 |
| DocumentTrash | Deleted / archived state | P1 |

---

## 7.2 Document

### Primary fields

* ID
* Organization ID
* Title
* Body
* Document type
* State
* Author
* Owner
* Owning team
* Share scope
* Creation method
* Created at
* Updated at
* Deleted at

### Document type examples

* General document
* Report
* Meeting notes
* Proposal
* Plan
* SOP
* Email draft
* Policy document

### Document state

* Draft
* Active
* Archived
* Deleted

---

## 7.3 DocumentShare

### Primary fields

* ID
* Document ID
* Share-target type
* Share-target ID
* Access permission
* Created by
* Created at

### Share-target types

* User
* Team
* Organization

### Access permissions

* View
* Edit
* Manage

---

## 7.4 DocumentVersion

### Primary fields

* ID
* Document ID
* Version number
* Title
* Body snapshot
* Modified by
* Change summary
* Created at

### Version creation rules

* Created on explicit save
* Created on save of an AI-generated result
* Created when restoring (the restore itself is a new version)
* Auto-save may be decoupled from version history

---

## 7.5 DocumentTag

### Primary fields

* ID
* Organization ID
* Tag name
* Color or display attribute
* Created by
* Created at

### Design decisions

* Whether users can freely create tags
* Whether only admins manage tags
* Role separation between document type and tag

---

# 8. Permission design

## 8.1 Document permission decision basis

Document access is decided by combining the following.

* Current organization
* User's role
* Document author
* Document owner
* User's team
* Document's owning team
* Document share scope
* Individual share permission
* Document state

---

## 8.2 Default permissions per role

| Capability | Viewer | Editor | Manager | Admin |
| --- | --- | --- | --- | --- |
| Document list | Allowed | Allowed | Allowed | Allowed |
| Document detail | Permitted docs only | Permitted docs only | Team-permitted docs | Per policy |
| Create document | No | Allowed | Allowed | Allowed |
| Edit document | No or limited | Permitted docs only | Team-permitted docs | Per policy |
| Share document | No | Limited | Allowed | Allowed |
| Delete document | No | Own docs only (limited) | Team docs (limited) | Allowed |
| Restore version | No | Permitted docs (limited) | Allowed | Allowed |

---

## 8.3 Access by share scope

| Share scope | Audience |
| --- | --- |
| Private | Author or owner |
| Team | Designated team users |
| Organization | All users in the organization |
| Specific Users | Designated users |

MVP does not introduce a Department share scope; it is consolidated into Team (Phase A §15).

---

## 8.4 Permission exception rules

* Documents the user has no access to are not shown in the list.
* Direct URL access also re-checks permission.
* Deleted documents are excluded from the standard list.
* AI and search features apply the same permission basis.
* Admin does not have an implicit pass-through to all document bodies in the organization (Phase A §15). Admins can read metadata, but body access follows the standard permission rules (Organization-public or explicit share).

---

# 9. Save and version policy

## 9.1 Save modes

The following save modes are provided.

* Explicit save
* Draft save
* Basic auto-save

---

## 9.2 Explicit save

The user presses the Save button to commit document changes.

### Rules

* Persist body and metadata.
* Create a new version when applicable.
* Display save success / failure state.
* Update the last-modified timestamp on success.

---

## 9.3 Draft save

Draft save is provided so the user does not lose in-progress content.

### Rules

* Save is allowed without a title.
* Save is allowed without a body.
* Whether to show drafts in the document list is decided by policy.
* The user can resume editing later.

---

## 9.4 Auto-save

Auto-save is a UX convenience.

### Rules

* Triggered by elapsed time or significant change.
* Display auto-save state to the user.
* On auto-save failure, prompt the user to do a manual save.
* Not every auto-save produces a version record.

---

## 9.5 Version policy

### Principles

* Versions are written for meaningful save events.
* Restore writes a new version rather than overwriting in place.
* Each version records the modifier and timestamp.
* Version retention duration is adjustable through operational policy in later phases.

---

# 10. Delete and archive policy

## 10.1 Delete approach

In MVP, archive / trash semantics are preferred over immediate physical deletion.

### Recommended approach

* User-initiated delete moves the document to the Deleted state.
* Hidden from the standard list.
* Recoverable for a defined retention period.
* Admin or owner can recover.

---

## 10.2 Archive handling

Archive hides documents that are no longer actively used.

### Rules

* Set the document to the Archived state.
* Available via filter in search and list views.
* Permissions match the original document.

---

# 11. Template integration

In Phase C, the focus is on preparing the structure for documents to be created from a template, not on advancing the template feature itself.

## Integration rules

* A document may carry a selected template ID.
* Documents created from a template are editable like any other document.
* Changing a template does not retroactively change existing document bodies.
* In Phase D (AI document generation), templates are used as the document structure.

---

# 12. AI document generation integration

To support storing AI-generated output as a document in Phase D, Phase C prepares the following structure.

* Creation-method field
* Hook for linking the originating AI request ID
* Flow that hands generated output into the editor
* Draft save for AI-generated drafts
* Layout space for displaying source material citations

---

# 13. Search integration

For Phase F (in-house knowledge search), Phase C document data must be search-ready.

## Search-prep elements

* Title
* Body
* Document type
* Tags
* Author
* Owning team
* Share scope
* Created at
* Updated at

The search index itself is implemented in Phase F.

---

# 14. Errors and exceptions

## 14.1 Document save errors

* Network error
* Permission expired
* Session expired
* Document already deleted
* Concurrent-edit conflict

### UX rules

* The user's in-progress content must not be lost.
* The user must be able to retry.
* The unsaved state must be clearly visible.

---

## 14.2 Document access errors

* No permission
* Document does not exist
* Document is deleted
* Document belongs to another organization

### UX rules

* Do not leak unnecessary document existence info on denial.
* Provide a path back to home or document list.
* Permission-request flow can be deferred past MVP.

---

## 14.3 Share-settings errors

* Non-existent user or team
* Share attempt without permission
* Self-permission-removal attempt
* Admin-policy violation

---

# 15. Test plan

Phase C testing follows the Phase B closure pattern: items are split into **CI-gated** and **staging / manual smoke**. CI-gated items run on every PR via GitHub Actions. Staging / manual smoke items are confirmed once after a staging deploy.

---

## 15.1 CI-gated scenarios (Vitest unit + integration)

The following scenarios run on every PR via `pnpm test` + `pnpm test:integration`.

| Scenario | Verification |
| --- | --- |
| Create new document | Save succeeds with title and body |
| Draft save | Save succeeds with empty body or missing title |
| Document list | Only documents the user has access to are returned |
| Document detail | Body and metadata returned correctly |
| Document edit | Edit then save reflects changes |
| Share settings | After team / user share, the target gains access |
| Access denied | Unpermitted access returns `NOT_FOUND` (default) or `FORBIDDEN(reason_code)` |
| Version creation | Explicit save creates a version record |
| Version restore | Previous version can be restored; restore itself is recorded as a new version |
| Delete handling | After Deleted state transition, document is excluded from the standard list |

---

## 15.2 CI-gated permission tests

Permission branches are written on top of the Phase B `@notive/permissions` module. The following cases are covered as integration tests.

* Viewer cannot create documents.
* Editor can edit documents they own or have been shared with.
* Documents without permission do not appear in the list.
* Direct URL access is blocked.
* Manager can manage team documents.
* Admin does not have implicit pass-through to all document bodies; body access follows the standard rules (Organization-public or explicit share) per §8.4 / Phase A §15.
* Direct access to a document ID belonging to another organization returns the same `NOT_FOUND` response (no organization-boundary leak).

---

## 15.3 CI-gated save tests

* Manual save success.
* Manual save failure (write rejected, permission expired) does not lose in-progress content.
* After auto-save failure, manual save can recover.
* Save attempts during expired sessions are safely rejected.
* Concurrent-edit conflict surfaces a notice.

---

## 15.4 Audit record verification (CI-gated)

Phase C mutating actions reuse the Phase B audit writer skeleton (`apps/web/lib/audit`).

* Success events for create / update / share-change / delete (Deleted state transition) / restore are written to `activity_logs`.
* Each row populates `actor_user_id`, `target_type=document`, `target_id`, `action`, `result`, `metadata`, `created_at`.
* Failure events and population of `ip_address` / `user_agent` are deferred to Phase G as in Phase B; the schema is not extended.
* Writer failure is best-effort and does not break the user-facing action.

---

## 15.5 Staging / manual smoke items

The following are not adequately covered by CI (`embedded-postgres`, in-memory adapters), so they are confirmed once on staging.

* Concurrent-edit conflict UX with real multi-user sessions (real input patterns mixing auto-save and manual save).
* Save-state display under combined auto-save cadence and network latency.
* Cleanup-worker dry-run output for documents that have been archived / deleted past the retention window (real cron triggers in destructive mode are activated in Phase D).
* Share-notification wires (notification channels themselves arrive after Phase D; in Phase C the smoke check only verifies that the wire is intact).

---

# 16. Done criteria

Phase C is done when **all** of the following are true.

## 16.1 Functional (CI-gated)

* Editor and above users can create and save new documents.
* Users can view the documents they have access to in the list.
* Users can view document details.
* Users with edit permission can edit documents.
* Users can configure share scope (Private / Team / Organization / Specific Users).
* Users without permission cannot view or edit; responses follow the `NOT_FOUND` default / `FORBIDDEN(reason_code)` exception policy.
* Saving a document writes a change-history record (DocumentVersion).
* Previous versions can be reviewed and restored.
* Deleted or archived documents are excluded from the standard list.
* The §15.1 – §15.4 scenarios all pass via `pnpm test` + `pnpm test:integration`.

## 16.2 Integration with Phase B (CI-gated)

* All document permission decisions go through the `@notive/permissions` module (endpoints do not bypass it via direct Prisma `where` clauses).
* Success events for document mutating actions are written to `activity_logs` through the `apps/web/lib/audit` writer (no new columns).
* Document-owning organization and share-scope decisions operate under the 1-active-organization / 1-primary-team assumption.
* Phase C document flows do not directly modify membership role / status. When document ownership transfer or share-manager assignment is coupled with a membership change flow, Phase B Last-Admin protection is not bypassed.

## 16.3 Forward-readiness

* The structure for storing Phase D AI-generated output as a document (creation-method field, Draft save, editor entry flow) is in place.
* The metadata Phase F search will use (title, body, type, tags, author, owning team, share scope, dates) is fully present on Document / DocumentTag / DocumentShare.

## 16.4 Staging / manual smoke

* The §15.5 staging / manual smoke items are confirmed once after a staging deploy and the result is recorded outside the per-PR CI loop.

---

# 17. Key risks and mitigations

| Risk | Description | Mitigation |
| --- | --- | --- |
| Editor complexity creep | Adding too many advanced editor features early can delay schedule | Focus on basic document editing |
| Permission gap | A document could be exposed to the wrong audience | Apply permission checks across list, detail, edit, and share paths |
| Auto-save conflict | Auto-save and manual save can collide | Separate save state from version-creation rules |
| Version data growth | Each edit could pile up versions | Create versions only at meaningful save boundaries |
| Share-scope confusion | Users may not understand share scopes | Simplify the share UI and clarify defaults |
| Delete-recovery demand | Users may request recovery after delete | Prefer state changes over physical deletion |

---

# 18. Phase D handoff

Phase C completion leads into Phase D (AI document generation).

The following must be in place before Phase D starts.

* Document creation API or save flow
* Document edit screen
* Draft document save
* Document type
* Template-link field
* Document share permission
* Document version history
* Structure to flow AI-generated output into the document body

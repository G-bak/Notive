# Implementation Plan v1.0

# Notive Overall Implementation Plan

---

# 1. Purpose

This document defines Notive's overall implementation direction at a high level, from A to Z.

It is not a detailed task list or a detailed design spec. It serves as the reference document used to write a separate detailed plan for each phase later.

---

# 2. Implementation Goal

Notive's first-pass implementation goal is to validate the core hypothesis defined in the PRD.

> Can AI document generation that reflects a company's work context reduce the time spent writing real work documents and improve document quality and reusability?

The initial implementation focuses on the following goals:

* The user can generate a draft work document with AI.
* The generated document can be saved, edited, and shared.
* Company or team templates can be applied to document generation.
* Work records and existing documents can be used as context for document generation.
* Document access can be controlled within a basic permission model.
* Administrators can manage users, organization, templates, and permissions.

---

# 3. Implementation Scope Summary

## In scope (first pass)

* Web-based service
* User authentication
* Organization and team management
* Role-based permission management
* AI document generation
* Template-based document generation
* Document save, edit, and share
* Document search
* Work diary
* Limited to-do management
* Administrator features
* Basic usage and activity logs

---

## Out of scope (first pass)

* Mobile app
* Desktop app
* On-premise / VPC deployment
* Real-time voice meeting transcription
* Integrations with external collaboration tools
* Autonomous AI agent execution
* Complex approval / e-signature workflows
* Advanced BI dashboards

---

# 4. Phase Overview

The full implementation is split into phases A through H.

| Phase | Name | Purpose |
| --- | --- | --- |
| A | Foundation design | Lock product structure, screen structure, data scope, and technical direction |
| B | Service foundation | Implement authentication, organization, permissions, base layout |
| C | Document management | Implement document creation, save, edit, share, version management |
| D | AI document generation | Implement AI request, template application, and generated-result editing flow |
| E | Work-context features | Work diary, to-do, and document-generation context wiring |
| F | Internal knowledge search | Implement document search, natural-language search, and source attribution |
| G | Admin and operations | Admin screens, logs, settings, and usage status |
| H | Stabilization and launch | Quality checks, security checks, deployment, feedback collection setup |

---

# 5. Phase-by-phase Plan

## A. Foundation design

### Goal

Lock down product structure and implementation standards before development begins.

### Key work

* Lock core user flows
* Define the first MVP screen list
* Define user roles and permission scope
* Define data scope for documents, templates, organization, and work records
* Define the AI document generation flow
* Lock service operations approach and deployment direction

### Key deliverables

* Screen list
* User flow diagrams
* Permission matrix
* Key data list
* MVP backlog

---

## B. Service foundation

### Goal

Build a baseline environment where users can log in and use the service inside an organization.

### Key work

* Initial project structure
* User signup and login
* Organization creation and invitations
* Team / department structure management
* Role-based permission handling
* Base layout and navigation

### Key deliverables

* Login screen
* Organization select / create flow
* Basic user management
* Permission handling standard
* Shared UI layout

---

## C. Document management

### Goal

Make Notive's core asset — documents — creatable, savable, editable, and shareable.

### Key work

* Document list
* Document detail
* Document authoring and editing
* Draft / autosave
* Document version management
* Document share settings
* Document tags and categorization
* Recent documents and favorites

### Key deliverables

* Document list screen
* Document editor screen
* Document detail screen
* Share-settings feature
* Version history feature

---

## D. AI document generation

### Goal

Let users generate work-document drafts based on natural-language requests and templates.

### Key work

* AI document generation screen
* Document type selection
* Template selection
* Natural-language request input
* Generated-result preview
* Hand-off from preview to editor
* Saving the generated document
* Generation failure and retry handling

### Key deliverables

* AI generation request screen
* Generation flow per document type
* Template application feature
* Generated-result editing flow
* AI request/response logging standard

---

## E. Work-context features

### Goal

Build the minimum context data that work records can contribute to document generation.

### Key work

* Work-diary authoring
* Per-day work-record viewing
* Project / tag linking
* Limited to-do management
* Done / not-done state for work
* Selecting work records when generating an AI document

### Key deliverables

* Work-diary screen
* Basic to-do screen
* Reference-material selector during document generation
* Report-generation flow based on work records

---

## F. Internal knowledge search

### Goal

Make stored documents searchable and, when needed, provide AI summaries with source attribution.

### Key work

* Title / body search
* Author, tag, date filters
* Natural-language search
* Search-result summarization
* Jump from search result to source document
* Restrict search results based on the user's permissions

### Key deliverables

* Unified search screen
* Search results screen
* Document source attribution
* Permission-based search restriction

---

## G. Admin and operations

### Goal

Provide the minimum feature set for an organization administrator to operate the service.

### Key work

* User invite and deactivation
* Team / department management
* Role and permission settings
* Document template management
* Usage monitoring
* Key activity log viewing
* Basic security settings

### Key deliverables

* Admin dashboard
* User management screen
* Team / department management screen
* Template management screen
* Activity log screen

---

## H. Stabilization and launch

### Goal

Reach a quality, security, and operations level acceptable for delivery to early customers.

### Key work

* Critical user-flow testing
* Permission and document-access testing
* AI generation quality checks
* Document save and recovery checks
* Performance checks
* Error monitoring setup
* Operations policy
* Early customer feedback channel setup

### Key deliverables

* Test checklist
* Pre-launch checklist
* Operations guide
* Initial feedback collection form
* Known-issues list

---

# 6. Key Screen Composition

The screens needed for the first-pass implementation:

| Area | Screens |
| --- | --- |
| Auth | Login, signup, password reset |
| Onboarding | Organization create, organization invite, profile setup |
| Home | Dashboard, recent documents, recent work records |
| AI generation | Document generation request, template selection, generated-result preview |
| Documents | Document list, document detail, document editor, share settings, version history |
| Work | Work diary, to-do list |
| Search | Unified search, search-result detail |
| Admin | User management, team / department management, permission management, template management, activity log |
| Settings | Personal settings, organization settings, security settings |

---

# 7. Key Data Areas

The main data managed during implementation:

| Data | Description |
| --- | --- |
| User | User account information |
| Organization | Company or organization information |
| Team | Department or team information |
| Role | User role |
| Permission | Feature and document access permissions |
| Document | Document body and metadata |
| DocumentVersion | Document revision history |
| Template | Company or team document templates |
| DiaryEntry | Work diary records |
| Todo | Work items / to-dos |
| Project | Work unit grouping documents and work records |
| SearchIndex | Searchable document information |
| ActivityLog | Key user activity records |
| AIRequestLog | AI request and result records |

---

# 8. Permission Design Direction

The initial permission model starts simple and clear.

| Role | Key permissions |
| --- | --- |
| Viewer | Read documents they are allowed to access |
| Editor | Create, edit, and request sharing on documents |
| Manager | Manage team documents, approve sharing, manage team users |
| Admin | Organization settings, user management, permission management, log viewing |

Permission decisions also use the following criteria:

* Organization
* Team / department
* User role
* Document owner
* Document share scope
* Per-document exception permissions

---

# 9. AI Feature Direction

AI features do not aim for full automation from day one. The first goal is a stable flow where the user makes a request, reviews the result, and edits/saves it.

## First-pass AI features

* Document draft generation
* Document summarization
* Style / tone polishing
* Title and outline generation
* Report generation from work records
* Reuse / reference of similar existing documents

---

## AI feature principles

* AI output must always be editable by the user.
* The key sources used by the AI should be shown when feasible.
* Documents the user has no permission to read must not be used in AI generation or search.
* Important work documents are saved or shared only after the user confirms.
* Failures, delays, and inaccurate output must have retry and edit flows.

---

# 10. Technical Direction

Detailed technical design lives in separate documents. This document defines direction only.

## Baseline direction

* The initial product is implemented as a Web SaaS.
* Frontend and backend prioritize fast development and operations.
* The data model assumes per-organization isolation.
* Document files and body data must be stored reliably and recoverably.
* AI features are designed so that they can be separated from regular service features.
* Future enterprise expansion is considered, but the first pass avoids excessive complexity.

---

# 11. Quality and Test Plan

## Test priority

* Login and permission handling
* Document create, save, edit, share
* AI generation result-saving flow
* Permission restriction in search results
* Admin permission changes
* Document version restore
* Document generation from work records

---

## Acceptance criteria

* A general user can complete the core document-generation flow without getting stuck.
* Documents the user has no permission for cannot be viewed or searched.
* On AI generation failure, the user understands the next action.
* No document save failures or duplicate saves.
* An admin can manage users and permissions without errors.

---

# 12. Launch Preparation Plan

## Pre-launch preparation

* Pick early customers or an internal test group
* Set up test organizations and user accounts
* Prepare representative document templates
* Prepare sample document data
* Draft operations policy
* Prepare privacy and data-handling notices
* Prepare a feedback collection channel

---

## Initial launch criteria

* The core document-generation flow works end-to-end.
* Generated documents can be saved, edited, and shared.
* Document access is restricted by basic permissions.
* Admins can manage users and templates.
* Major errors are logged and observable.
* Early user feedback can be collected.

---

# 13. Key Risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| MVP scope creep | Feature growth could delay launch | Lock scope per phase |
| AI quality variance | Output may not be directly usable for work | Strengthen templates, examples, and user-edit flow |
| Permission errors | Sensitive documents may leak | Raise permission-test priority |
| Search quality gaps | Users may not find what they want | Iterate on search feedback and result quality |
| Data structure changes | Weak initial design causes rework | Lock key data scope in Phase A |
| Operations burden | AI cost, error response, and customer questions can grow | Prepare usage monitoring and operations policy |

---

# 14. Subsequent Detailed Plans

The following detailed plans are written using this overall plan as the reference.

| Document | Purpose |
| --- | --- |
| A. Foundation design detailed plan | Detail screens, data, permissions, and user flows |
| B. Service foundation detailed plan | Authentication, organization, permissions, shared layout |
| C. Document management detailed plan | Document save, edit, share, version management |
| D. AI document generation detailed plan | AI generation flow, templates, result editing |
| E. Work-context detailed plan | Work diary, to-do, document-generation context wiring |
| F. Internal knowledge search detailed plan | Search, summarization, source attribution, permission limits |
| G. Admin features detailed plan | User, organization, template, log management |
| H. Stabilization and launch detailed plan | Tests, deployment, operations, feedback collection |

---

# 15. Priority Summary

## Must build first

* Authentication
* Organization / users
* Basic permissions
* Document creation
* Document save
* AI document generation
* Templates

---

## Raises MVP completeness

* Document sharing
* Work diary
* Document search
* Admin screens
* Activity log

---

## Deferred for later

* Real-time voice
* External service integrations
* Mobile app
* Desktop app
* On-premise
* Autonomous AI agent execution

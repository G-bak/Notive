# Phase C Closure / Phase D Preflight 보고서

## 1. 보고 목적과 범위

본 보고서는 **Phase C(문서 관리)의 CI-gated backend/API 범위가 완료된 시점에 Phase D(AI 문서 생성)로 넘어가도 안전한지를 점검**하기 위한 closure / preflight 문서다. 단순 진행 요약이 아니라 다음 5개 축에서 closure 여부를 판단한다.

1. Phase C 모든 step의 산출물(코드 / 테스트 / 보고서)이 develop에 안정적으로 반영되어 있는지
2. 구현 계획서(`docs/implementation/notive-implementation-plan-c-document-management-v1.0.md`)의 §16 Done criteria를 모두 만족하는지
3. §18 Phase D handoff 목록의 사전 조건이 실제 코드에 갖춰져 있는지
4. 보안 / 권한 정책이 모든 라우트 표면에 일관되게 적용되어 있는지
5. CI 게이트(unit / integration / typecheck / whitespace)가 모두 통과하는지

비개발자도 따라갈 수 있게 풀어 썼다. Phase D 구현 코드는 본 step에서 작성하지 않는다 — 이번 작업은 closure 결정과 Phase D Step 1 추천이 목적이다.

선행 보고서:

- [Phase C Step 1 — DB schema](./step-1-db-schema.md)
- [Phase C Step 2 — document permissions](./step-2-document-permissions.md)
- [Phase C Step 3 — document service / API](./step-3-document-service-api.md)
- [Phase C Step 4 — document sharing API](./step-4-document-sharing-api.md)
- [Phase C Step 5 — document versions](./step-5-document-versions.md)
- [Phase C Step 6 — favorites / recent service](./step-6-favorites-recent.md)
- [Phase C Step 7 — tags / filters](./step-7-tags-filters.md)
- [Phase C Step 7 후속 — 라우트 smoke 인프라](./step-7-route-smoke-infra.md)
- [Phase C Step 8 — documents core route smoke](./step-8-route-smoke-core.md)
- [Phase C Step 9 — shares / versions route smoke](./step-9-route-smoke-shares-versions.md)
- [Phase C Step 10 — favorites / recent route smoke](./step-10-favorites-recent-route-smoke.md)

---

## 2. Phase C 완료 범위 요약

### 2.1 Step별 산출물

| Step | 주제 | 핵심 산출물 |
| --- | --- | --- |
| 1 | DB schema | `documents`, `document_versions`, `document_shares`, `document_tags`, `document_tag_links`, `document_favorites`, `document_view_histories` 7개 테이블 + 마이그레이션 `20260510000000_phase_c_documents`. `sourceType` / `templateId` / `aiRequestId` 컬럼 Phase D 예약. 모든 자식 테이블이 `organization_id` denormalisation으로 cross-org mix를 DB 차원에서 거부 |
| 2 | document permissions | `@notive/permissions` 모듈에 `evaluateDocumentPermission` / `requireDocumentView/Edit/Manage` 추가. View / Edit / Manage 3단 계, Private / Team / Organization / SpecificUsers 4가지 visibility 격자. unit 56 테스트 |
| 3 | document service / API | `createDocument` / `getDocument` / `updateDocument` / `softDeleteDocument` / `listDocuments` service + 4개 라우트. NOT_FOUND 기본 / FORBIDDEN(reason_code) 명시 분기 정책 확립 |
| 4 | sharing API | `replaceDocumentShares` (replace-all 정책) + GET/PUT shares 라우트. Manage gate. Step 3의 NOT_FOUND 정책과 결합 |
| 5 | versions | 자동 versionNumber max+1 발급, restore가 새 versionNumber 발급(되돌리기는 새 버전), audit `DOCUMENT_VERSION_RESTORED`. version_conflict reason_code |
| 6 | favorites / recent service | `setFavorite/unsetFavorite/listFavorites` + `recordDocumentView/listRecentDocuments`. PUT/DELETE에 View gate 강제(존재 누출 방지) |
| 7 | tags / filters | `document_tags` / `document_tag_links` service + 라우트. documents GET의 strict query parser 도입. tagId UUID 검증 |
| 7 후속 | route smoke infra | `vi.hoisted` 세션 mock + `next/headers` alias stub + `call()` helper. 라우트 핸들러 직접 호출 패턴 14 케이스 도입 |
| 8 | core route smoke | POST documents / GET detail / PATCH / DELETE 라우트 envelope 10 케이스 |
| 9 | shares / versions route smoke | shares GET/PUT, versions list/preview, restore POST 12 케이스. audit row 검증 포함 |
| 10 | favorites / recent route smoke | favorites GET/PUT/DELETE, recent GET 8 케이스. idempotency + per-user isolation + no-view NOT_FOUND |

### 2.2 develop 반영 상태

| 항목 | 값 |
| --- | --- |
| 현재 브랜치 | `docs/phase-c-closure-phase-d-preflight` (본 보고서 작성용) |
| develop 최신 commit | `92ef41f Merge docs/phase-c-step10-report into develop` |
| `develop ↔ origin/develop` | 동기 (push 완료) |
| `main` 상태 | Phase B closure 시점 이후 무변경 (Phase C 어떤 commit도 main에 흘러가지 않음) |
| 워킹트리 | clean (untracked / unstaged 모두 0건) |
| 보존 stash | `stash@{0} On develop: wip CODEX.md before phase-c step2` (의도 유지) |

Step 7 후속부터 10까지 모든 step이 feature → develop `--no-ff` 머지 / docs → develop `--no-ff` 머지의 2-pass 패턴으로 정리됐다 — feature commit과 docs commit이 다른 머지 그룹에 들어가 있어 git log에서 단계별 진행이 명확히 추적된다.

---

## 3. §16 Done criteria 대조

구현 계획서 §16.1 ~ §16.3 항목을 코드 / 테스트 위치와 함께 1:1 대조한다. §16.4(staging / manual smoke)는 본 CI-gated closure 범위 밖이다.

### 3.1 §16.1 Functional (CI-gated)

| Done criterion | 충족 여부 | 위치 / 근거 |
| --- | --- | --- |
| Editor 이상이 새 문서 생성 / 저장 | ✅ | `createDocument` (`apps/web/lib/services/document.ts`) + POST 라우트. smoke `POST /documents > happy path: Editor returns 201 ...` |
| 권한 있는 문서를 목록에서 본다 | ✅ | `listDocuments` + GET 라우트. smoke `GET /organizations/[id]/documents > happy path ...` + Step 3 permission filter |
| 문서 상세 조회 | ✅ | `getDocument` + GET detail 라우트. smoke `GET /organizations/[id]/documents/[documentId] > happy path ...` |
| Edit 권한 사용자가 수정 | ✅ | `updateDocument` + PATCH 라우트. smoke `PATCH ... > happy path: owner Editor returns 200 with updated title` + view-only 403 |
| Share scope 설정 (Private / Team / Organization / SpecificUsers) | ✅ | DocumentVisibility enum + `evaluateDocumentPermission`의 4-way 격자. `replaceDocumentShares` + PUT shares 라우트 |
| 권한 없는 사용자는 view/edit 불가, 응답은 NOT_FOUND 기본 / FORBIDDEN(reason_code) 예외 | ✅ | Step 3 정책 확립, 모든 라우트 smoke에서 no-view → `toEqual({ error: "NOT_FOUND" })` 정확 매칭. view-only 분기는 reason_code 명시(`document_edit_not_allowed`, `document_manage_not_allowed`, 등) |
| 저장 시 변경 이력 (DocumentVersion) 기록 | ✅ | Step 5의 `createDocument` / `updateDocument` 내부에서 자동 max+1 발급. Step 9 smoke가 `versions[].versionNumber == 1` 핀 |
| 이전 버전 검토 / 복원 | ✅ | versions GET / preview / restore 라우트. Step 9 smoke `POST restore > happy path: owner restores v1 ... newVersion.versionNumber == 3` + audit row 검증 |
| 삭제 / archive 문서는 표준 목록에서 제외 | ✅ | `listDocuments`가 `status: { not: "Deleted" }` + `deletedAt: null` 필터. Step 3 unit / Step 7 smoke가 cover |
| §15.1 – §15.4 시나리오가 `pnpm test` + `pnpm test:integration`로 통과 | ✅ | §5 검증 게이트 참조 |

### 3.2 §16.2 Integration with Phase B (CI-gated)

| Done criterion | 충족 여부 | 위치 / 근거 |
| --- | --- | --- |
| 모든 문서 권한 결정은 `@notive/permissions` 통과 | ✅ | service 7개 모두 `requireMembership` + `requireDocumentView/Edit/Manage` 또는 `evaluateDocumentPermission`으로 진입. 라우트 직접 Prisma `where` clause로 우회하지 않음 (Step 7 / 8 / 9 / 10 smoke가 envelope 분기로 간접 검증) |
| 성공한 변형 동작이 `activity_logs`에 기록 | ✅ | `apps/web/lib/audit`의 writer 사용. Step 9 smoke `POST restore > activityLog.findFirst(action: "document.version_restored")` 검증 |
| 1-active-organization / 1-primary-team 가정 하에 동작 | ✅ | Step 2의 `DocumentActor.organizationId`가 active membership에서 유래. cross-org mix는 DB composite FK가 거부 (Step 1 §denormalisation) |
| 문서 흐름이 membership role/status 직접 수정 안 함 | ✅ | service 어느 곳에서도 `prisma.membership.update` 직접 호출 없음. Step 4 share는 share row만 갱신 |
| Last-Admin 보호 우회 안 함 | ✅ | document 흐름이 membership을 안 만지므로 무관 (Phase B의 `uniq_active_membership_per_user` / `last_admin_protection` 트리거에 영향 없음) |

### 3.3 §16.3 Forward-readiness

| Done criterion | 충족 여부 | 위치 / 근거 |
| --- | --- | --- |
| AI 결과물을 문서로 저장할 구조 (생성-method 필드, Draft 저장, editor entry flow) | ✅ | `Document.sourceType` enum은 이미 `Manual` / `AI` / `Imported`를 갖고 있고 기본값은 `Manual`. `DocumentStatus.Draft` + `createDocument`가 Draft 기본. `templateId`/`aiRequestId` 컬럼 Phase D 예약 (`schema.prisma:374-378` 주석) |
| Phase F 검색 메타데이터 (title / body / type / tags / author / 소유 팀 / share scope / 날짜) 모두 Document / DocumentTag / DocumentShare에 존재 | ✅ | `Document` 모델에 8개 필드 모두 존재 (`title`, `content`, `documentType`, `authorUserId`, `ownerTeamId`, `visibility`, `createdAt`, `updatedAt`). `DocumentTag` + `DocumentTagLink`로 tag join. `DocumentShare`로 share scope 보강 |

### 3.4 §16.4 Staging / manual smoke

본 closure는 CI-gated 범위 한정. §15.5의 staging / manual smoke 항목은 staging 배포 시점에 별도로 확인하며 본 보고서 결정에 영향 없음.

---

## 4. §18 Phase D handoff 사전 조건 확인

§18에 명시된 "Phase D 시작 전에 갖춰져 있어야 할" 항목별로 코드 위치 확인.

| Handoff 항목 | 충족 | 코드 / 위치 |
| --- | --- | --- |
| Document creation API / save flow | ✅ | `createDocument` (`document.ts`) + POST `/organizations/[id]/documents`. Draft 기본 status |
| Document edit screen | ⚠️ | Phase C scope §3.1는 "Document editing"을 포함하나 본 CI-gated closure는 backend/API에 한정. 편집 화면 UI는 별도 단계에서 진행되며 본 closure의 게이트가 아님. Phase D 시작 시 백엔드 의존성은 모두 갖춰진 상태 |
| Draft document save | ✅ | `DocumentStatus.Draft` enum + `createDocument`가 Draft로 생성. `updateDocument`는 status를 보존하므로 Draft 유지 가능 |
| Document type | ✅ | `Document.documentType: String` 컬럼. `createDocument` / `updateDocument`가 받음. §7.2 등에 정의된 타입 라벨은 application 계층 책임 |
| Template-link field | ✅ | `Document.templateId: String? @db.Uuid`. Phase D에서 `templates` 테이블 + FK 추가 예정 (스키마 주석 명시) |
| Document share permission | ✅ | `DocumentShare` 모델 + `replaceDocumentShares`. Step 4 sharing API |
| Document version history | ✅ | `DocumentVersion` + `createDocumentVersion` / `restoreDocumentVersion`. Step 5 |
| AI 결과물을 document body로 저장할 구조 | ✅ | `Document.sourceType: DocumentSourceType` (default `Manual`, `AI` 값은 이미 존재하며 Phase D에서 사용 활성화) + `Document.aiRequestId: String? @db.Uuid` (Phase D에서 `ai_requests` 테이블 + FK 추가 예정) |
| sourceType, templateId, aiRequestId 등 Phase D 연결 필드 | ✅ | 위 3개 컬럼 모두 nullable / nullable Uuid로 예약. FK는 Phase D Step 1에서 추가. Phase C는 컬럼 형태만 확정해 미래 마이그레이션이 documents 본체 스키마를 다시 만지지 않게 한다 |

**판단**: §18 handoff 목록의 모든 백엔드 사전 조건이 충족됨. UI(편집 화면)는 본 closure 게이트 외 항목이며 Phase D 진입을 막지 않는다.

---

## 5. 보안 / 권한 검증 요약

### 5.1 조직 경계 격리

- DB 차원: `documents`/`document_versions`/`document_shares`/`document_tags`/`document_tag_links`/`document_favorites`/`document_view_histories` 7개 테이블 모두 `organization_id`를 자체 컬럼으로 가짐. 자식 테이블은 부모와 `(id, organization_id)` 복합 FK로 연결되어 cross-org mix가 Postgres에서 거부됨 (`schema.prisma:400-403` documents 복합 unique, `:427` versions 복합 FK 등).
- Service 차원: 모든 service 진입점이 `requireMembership(prisma, userId, organizationId)`로 시작. cross-org 액터에게 NOT_FOUND를 던짐 (Step 3 §정책).
- Route smoke 검증: Step 8 `GET /organizations/[id]/documents/[documentId] > cross-org actor returns 404 NOT_FOUND envelope without reason_code`, Step 7 `DELETE /tags/[tagId] cross-org returns 404 NOT_FOUND` 등으로 envelope-level 핀.

### 5.2 Visibility 격자 (Private / Team / Organization / SpecificUsers)

`evaluateDocumentPermission`(packages/permissions)이 4가지 visibility × actor role × share grants 조합에 대해 단일 진실 함수. unit 56 케이스(`tests/unit/document-permissions.test.ts`)가 격자 전체를 cover. Route smoke는 그 격자의 envelope 노출만 핀(상세 분기는 unit이 책임).

### 5.3 no-view 기본 404 NOT_FOUND

Step 3 정책에 따라 view 권한 없는 액터에게는 **존재 자체가 노출되지 않도록** 모든 라우트가 NOT_FOUND 응답. reason_code는 포함하지 않음. 모든 step의 route smoke가 `toEqual({ error: "NOT_FOUND" })` **정확 매칭**으로 핀해 reason_code 누출 회귀를 막는다 — Step 7 tags 1건, Step 8 documents 3건, Step 9 shares/versions/restore 4건, Step 10 favorites 2건.

### 5.4 FORBIDDEN(reason_code)은 명시 reason이 필요한 경우만

view 권한은 있지만 더 높은 권한(Edit / Manage)이 부족한 경우에만 403 + reason_code. 현재 사용 중 reason_code:

- `document_create_not_allowed` (Step 8)
- `document_edit_not_allowed` (Step 7 tags PUT, Step 8 PATCH, Step 9 restore)
- `document_manage_not_allowed` (Step 8 DELETE, Step 9 shares GET/PUT)
- `tag_create_not_allowed`, `tag_delete_not_allowed` (Step 7 tags 라우트)

각 route smoke가 view-only 액터에 대해 어떤 reason_code가 나오는지를 envelope에서 핀하므로 향후 reason_code 사전 외 새로운 값이 누출되면 smoke가 즉시 깨진다.

### 5.5 favorites / recent per-user isolation

PUT/DELETE favorite은 service 차원에서 View gate 강제(`document-favorite.ts:131-178`) — 임의 ID로의 favorite 시도가 200 vs NOT_FOUND oracle이 되지 않도록 함. listFavorites / listRecent는 `evaluateDocumentPermission`을 결과 row마다 다시 평가하므로 view를 잃은 문서는 결과에서 silent drop. Step 10 smoke가 `editorB`의 빈 목록으로 per-user isolation을 envelope-level로 핀.

### 5.6 shares / versions / restore 게이트 — 라우트별 분리

- shares GET / PUT: Manage required (`document-share.ts:226 / :256`)
- versions list / preview: View required (`document-version.ts:218 / :246`)
- restore POST: **Edit required** (`document-version.ts:295`) — Manage가 아님

Step 9 §5.1에서 "restore가 Edit인 것이 정책 결정이며 smoke는 현재 코드를 고정한다"고 명시. 정책 변경(Edit → Manage 격상)이 들어오면 smoke 1줄이 깨져 명시적 리뷰 신호가 됨.

### 5.7 audit 정책

- 문서 변형 동작(create / update / delete / share replace / version restore): `activity_logs`에 row 기록.
- favorite mark/unmark: **미기록** (개인 annotation, Step 6 §Audit 결정). smoke에서도 audit row 검증 없음.
- recent (view history): `documentViewHistory` 테이블 자체가 audit 등가물이라 `activity_logs` 이중 기록 안 함 (Step 6 §Audit 결정).

Step 9의 restore smoke만 `prisma.activityLog.findFirst`로 audit metadata(`restoredFromVersionNumber`, `newVersionNumber`)를 확인 — 가장 부수효과가 큰 동작에 대해 envelope 외 부수효과까지 핀.

---

## 6. CI 게이트 통과 결과

본 보고서 작성 직전(브랜치 `develop` @ `92ef41f` 시점)에 다시 실행한 결과.

| 명령 | 결과 |
| --- | --- |
| `pnpm test:integration` | **PASS — 14 files / 231 tests** (Phase B 7 file 78 tests + Phase C 7 file 153 tests, 모든 step 누적) |
| `pnpm typecheck` (workspace 전체) | **PASS — 9개 워크스페이스 모두 clean** (`apps/web`, `apps/worker`, `packages/auth`, `packages/db`, `packages/mail`, `packages/permissions`, `packages/redis`, `packages/shared`, `tests/integration`) |
| `pnpm test` (vitest unit) | **PASS — 6 files / 99 tests** (`example`, `env`, `permissions`, `document-permissions`, `auth-tokens`, `auth-password`) |
| `git diff --check` | **PASS — 출력 없음** (whitespace / 줄 끝 이슈 0건) |

Phase C 시작 시점(Phase B closure) 대비 증가량:

- Integration: 211 → 231 (+20). Step 9 +12, Step 10 +8.
- Unit: 99 (변동 없음, document-permissions 56 케이스는 Step 2에서 기 추가됨).
- Workspaces: 변동 없음.

Step 10 smoke 단독 실행 시간 ≈ 9.3초, 전체 integration ≈ 56초로 안정 범위.

---

## 7. Phase D 시작 전 남은 리스크와 결정 후보

Phase D 구현을 본격 시작하기 전 결정해야 할 정책 사항을 분리한다. 모두 본 closure의 게이트 항목은 아니지만 Phase D Step 1 작업 직전에 codex / 사용자 사전 합의가 필요하다.

### 7.1 AI request / result 저장 테이블의 Phase D Step 1 도입 여부

- 현 상태: `Document.aiRequestId`는 nullable Uuid로 예약돼 있으나 `ai_requests` 테이블 자체는 없음. FK 제약도 없음.
- 결정 후보:
  - **A. Phase D Step 1에서 `ai_requests` 테이블을 새로 만들고 동일 마이그레이션에서 `documents.ai_request_id`에 FK 추가** — 권장. Phase C 마이그레이션이 컬럼만 예약해 둔 의도(`schema.prisma:356-360` 주석)와 일치.
  - B. Step 1은 service / API만 만들고 FK는 후속 step. 단점: 컬럼이 또 다른 step에서 "추가 안 됨" 상태로 남아 헷갈림.
- 권장: A. Step 1 마이그레이션 하나로 테이블 + FK 동시 도입.

### 7.2 기존 `documents.ai_request_id`를 언제 FK로 연결할지

- §7.1에서 A를 택한다고 가정하면 본 항목과 동일 step에서 처리. Phase C에서 `documents` 본체를 다시 만지지 않는다는 보장이 그대로 유지된다.
- 데이터 무결성 측면: Phase C가 끝나는 시점에 `ai_request_id`가 NULL이 아닌 row가 있을 수 없음(Phase C에서 set 안 됨). FK 추가가 실패하지 않음.

### 7.3 AI provider adapter — mock-first vs 실제 provider 직결

- 결정 후보:
  - **A. Mock-first (`@notive/ai/adapters/mock`) — 권장**. Phase D Step 2 ~ Step 4가 envelope / persistence / audit 정책 확립에 집중할 수 있게 함. CI도 결정적.
  - B. 첫 step부터 실 provider(OpenAI / Anthropic 등) — 비결정적, CI에서 외부 호출이 게이트 흔듦.
- 권장: A. 실제 provider는 Phase D 종료 직전 별도 step에서 adapter swap.

### 7.4 Reference document permission filtering 강제 레이어

- 문제: AI 생성 시 "참고 문서 목록"을 input으로 받는다면 그 목록이 현재 사용자의 view 권한 격자를 통과해야 한다. CLAUDE.md §4.5 "검색과 AI는 같은 권한 기준" 원칙.
- 결정 후보:
  - **A. Service 진입점에서 강제** — 권장. AI 호출 service의 첫 단계에서 reference docId 목록을 `evaluateDocumentPermission`으로 필터링한 뒤 진입. 다른 호출자(예: Phase F 검색)가 같은 helper를 재사용 가능.
  - B. AI provider adapter 내부에서 강제. 단점: provider 교체 시 권한 검사 누락 위험.
- 권장: A. service-layer enforcement + 단위 테스트로 cross-org / no-view reference 차단 핀.

### 7.5 sourceType `AI` 값 사용 활성화 시점

- 현 상태: `DocumentSourceType` enum은 이미 `Manual` / `AI` / `Imported`를 갖고 있고, `documents.source_type` 기본값은 `Manual`.
- 결정 후보: Phase D Step 1 또는 Step 2에서 AI 결과 저장 흐름이 `sourceType: "AI"`를 명시하게 한다. enum 확장 마이그레이션은 필요 없다.
- 위험: 현재 `createDocument` 서비스는 sourceType을 외부 입력으로 받지 않고 `Manual`로 고정한다. Phase D에서 AI 저장 전용 entry point를 만들거나, 제한된 내부 옵션으로 `AI`를 주입하는 방식을 결정해야 한다.

### 7.6 Draft 자동 정리 정책

- 현 상태: Draft 문서는 무기한 보존.
- AI 생성 결과를 Draft로 던지는 시나리오에서 사용자가 Save / Discard 둘 다 안 누른 Draft가 쌓일 수 있음.
- 결정 후보: Phase D scope 안에서는 정책 미결정으로 둠. 단순히 "Draft는 누적된다"고 명시. 이후 Phase에서 TTL 또는 사용자 manual cleanup 도입.

---

## 8. Decision

### 8.1 Phase C CI-gated backend/API closure

**Phase C의 CI-gated backend/API scope는 완료(closed)로 본다.**

근거:

- §16.1 모든 functional 기준이 코드 + smoke + unit으로 cover됨 (§3.1 표).
- §16.2 모든 Phase B integration 기준 충족 (§3.2 표).
- §16.3 모든 forward-readiness 컬럼 / 구조 존재 (§3.3 표).
- §18 모든 Phase D handoff 사전 조건이 backend 차원에서 충족 (§4 표).
- CI 게이트(integration 231 / unit 99 / typecheck 9 워크스페이스 / git diff --check) 모두 PASS (§6 표).
- develop은 origin/develop과 동기, main 무변경, 워킹트리 clean.

§16.4 staging / manual smoke와 편집 화면 UI는 본 closure 게이트 외 항목으로 분리.

### 8.2 Phase D 진입 가능 여부

**Phase D 구현 착수 가능.** §7의 정책 후보 6개에 대해 codex / 사용자 사전 합의가 끝나면 즉시 Step 1 작업 가능.

### 8.3 Phase D Step 1 추천 작업

**추천: Phase D Step 1 — `ai_requests` 테이블 도입 + `documents.ai_request_id` FK 연결 + AI request/result 메타데이터 모델의 최소 서비스/테스트 골격 작성.**

이유:

- §7.1 / §7.2 / §7.5 세 결정이 한 마이그레이션으로 묶이는 게 가장 깔끔(Phase C의 "documents 본체 다시 안 만짐" 보장 유지).
- Service / API / smoke 없이 마이그레이션 + Prisma 모델 + unit 픽스처만 도입하면 Phase D 후속 step이 안정된 스키마 위에서 service / adapter / route를 차례로 쌓을 수 있음.
- Phase B → C 진입 패턴(Step 1이 DB 스키마 단독)과 일관.

대안: Phase D Step 1을 service 골격까지 묶는 안 — 비추. Phase C Step 1이 "테이블 7개만 도입하고 service는 Step 3"이었던 패턴이 회귀 추적성 / 리뷰 비용 측면에서 더 좋았음.

### 8.4 본 closure 보고서 처리

본 보고서는 `docs/report/phase-c/` 디렉터리에 위치하나 **개별 step 보고서가 아니라 Phase 종료 / 다음 Phase 진입 게이트 문서**다. 별도 commit으로 develop에 흡수하되 step 보고서와 동등한 무게로 다룬다. Phase D 시작 시점에 본 보고서가 Phase D Step 1의 출발선 참조로 인용된다.

---

## 9. 비개발자 요약 — 한 단락

Phase C는 "문서를 만들고 / 보고 / 수정하고 / 공유하고 / 옛 버전을 되돌리고 / 별표를 누르고 / 최근 본 문서를 모으는" 백엔드 기능을 끝내는 단계였다. 본 보고서는 그 단계가 다음 Phase D(AI가 문서를 자동으로 만들어 주는 기능)로 넘어가도 안전한 상태인지를 점검한다 — 구현 계획서가 미리 적어 둔 "끝났다고 부르려면 이게 다 돼 있어야 한다" 목록과 "Phase D 시작 전에 이게 다 준비돼 있어야 한다" 목록을 코드 / 자동 점검표 위치와 일대일로 맞춰 본 결과, 모든 항목이 충족되어 있음을 확인했다. 자동 점검표 게이트(전체 통합 테스트 231건, 단위 테스트 99건, 타입 검증 9개 묶음, 공백 검사)는 모두 통과한다. 다만 Phase D 첫 step을 시작하기 전에 몇 가지 정책(AI 요청 기록 테이블을 어떻게 도입할지, AI 모의 어댑터로 시작할지, 참고 문서의 권한 필터를 어디서 강제할지 등)을 사전에 합의해 둘 필요가 있으며 그 결정 후보들도 본 보고서에 정리했다. 결론으로, **Phase C는 backend/API 범위에서 완료**되었으며 **Phase D 구현 착수가 가능**하다. 첫 작업으로는 "AI 요청 테이블 + 문서 컬럼 FK 연결 + AI request/result 메타데이터 모델의 최소 서비스/테스트 골격"을 도입하는 방안을 권장한다.

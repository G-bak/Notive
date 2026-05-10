# Phase C — Step 2: 문서 권한 판단 모듈 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **2단계 — 문서 권한 판단 모듈 확장**이 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Phase B에서 구축한 `@notive/permissions` 모듈 위에 **문서 단위 권한 판단**(View / Edit / Manage)을 단일 기준으로 추가하는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- 직전 단계: [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md)
- Phase B 권한 모듈 출처: [Phase B Step 6 — Permission Module](../phase-b/step-6-permission-module.md)

---

## 2. Step 2의 목적

Phase C의 문서 API 라우트, 서비스, 그리고 Phase F 검색은 모두 "이 사용자가 이 문서를 볼 수 있나 / 고칠 수 있나 / 관리할 수 있나"를 끊임없이 판단해야 한다. 그 판단을 각 호출 지점에서 다시 짜면 같은 룰이 다섯 군데에서 살짝 다르게 적힐 위험이 매우 크다. **권한 누설은 코드가 다섯 군데에서 살짝씩 다를 때 발생**한다.

Step 2의 목적은 다음과 같다.

- `@notive/permissions` 패키지 안에 **문서 권한 판단 단일 함수**(`evaluateDocumentPermission`)를 둔다. 모든 호출자는 이 함수에 위임한다.
- View / Edit / Manage 의 **계층**을 명시적으로 정의한다(`Manage > Edit > View`).
- DocumentVisibility(`Private` / `Team` / `Organization` / `SpecificUsers`)와 DocumentSharePermission(`View` / `Edit` / `Manage`)을 단일 룰로 결합한다.
- **Phase A §15 잠금**(1 user = 1 active organization, single primary team, Admin 본문 묵시 접근 금지, Department → Team 통합)을 코드 레벨에서 강제한다.
- **에러 정책 표준화**: 권한 없음은 NOT_FOUND(존재 누설 방지), 기능 권한 부족은 FORBIDDEN(`reason_code`).
- 향후 Phase F 검색 결과 필터링도 같은 함수를 재사용하도록 **순수 함수**로 노출한다.

이 단계에서는 API 라우트, UI, DB schema, 검색 인덱스 어떤 것도 손대지 않는다. 그것들은 이후 Step에서 한다. Step 2는 **그 모든 호출자가 의지할 단일 진실의 함수**만 만든다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (2개)

| 파일 | 내용 |
| --- | --- |
| `packages/permissions/src/documents.ts` | 282 lines. `DocumentActor`, `DocumentContext`, `DocumentShareGrant` 타입과 `evaluateDocumentPermission`, `requireDocumentView/Edit/Manage`, `permissionAtLeast` 함수. |
| `tests/unit/document-permissions.test.ts` | 736 lines, 56 단위 테스트 케이스. cross-org, Private, Team, Organization, SpecificUsers, Manager, author, Viewer cap, Deleted, 에러 정책을 모두 커버. |

### 3.2 수정 (3개)

| 파일 | 변경 |
| --- | --- |
| `packages/permissions/src/index.ts` | 신규 함수 5개 + 타입 3개 export 추가. |
| `packages/permissions/src/errors.ts` | `KnownReasonCode`에 `document_edit_not_allowed`, `document_manage_not_allowed` 두 reason code 추가. |
| `packages/db/src/index.ts` | Document 관련 모델 7개와 enum 5개를 `@prisma/client`에서 재export. 호출자가 `@prisma/client`를 직접 의존하지 않게 한다(Phase B §13.5 잠금). |

이게 전부다. DB schema / migration / API route / UI / search / AI 어떤 영역도 이번 단계에서 손대지 않았다.

---

## 4. 권한 결정의 입력과 출력

### 4.1 입력

`evaluateDocumentPermission(actor, document, shares)`는 세 가지를 받는다.

| 입력 | 무엇 | 어디서 |
| --- | --- | --- |
| `actor: DocumentActor` | 요청자의 `userId` / `organizationId` / `role` / `teamId`. teamId는 Phase A §15의 단일 primary team. | `memberships` 행에서 추출 |
| `document: DocumentContext` | 문서의 `id` / `organizationId` / `status` / `authorUserId` / `ownerUserId` / `ownerTeamId` / `visibility` / `deletedAt`. | `documents` 행 projection |
| `shares: DocumentShareGrant[]` | 그 문서에 걸린 share 행들. 각 행은 `targetType` (User/Team/Organization), `targetId`, `permission` (View/Edit/Manage). | `document_shares` 조회 결과 |

### 4.2 출력

함수는 다음 중 하나를 반환한다.

| 반환 | 의미 |
| --- | --- |
| `"Manage"` | 가장 강한 권한. 본문 조회/수정/공유 설정/삭제 가능. |
| `"Edit"` | 본문 조회/수정 가능. 공유 설정 / 삭제 / 복원 등은 불가. |
| `"View"` | 본문 조회만 가능. |
| `null` | 접근 자체가 불가. 호출자는 NOT_FOUND로 변환한다 (존재 누설 방지). |

순수 함수다. 부수 효과 없음. throw 없음. 순수성 덕분에 Phase F 검색이 결과 행을 후처리하면서 "이 사용자가 못 보는 문서"를 걸러내는 용도로 그대로 재사용된다.

---

## 5. 권한 누적 알고리즘

`evaluateDocumentPermission`는 다음 순서로 동작한다.

### 5.1 게이트 (단축 회로)

1. **조직 경계**: `actor.organizationId !== document.organizationId` → 즉시 `null`. Phase A §15 — cross-org 접근은 "존재하지 않음"과 구분 불가.
2. **삭제 차단**: `status === "Deleted"` 또는 `deletedAt !== null` → 즉시 `null`. 소유자도 예외 없이 차단. Archived는 정상 권한 룰을 따른다(검색·아카이브 필터에서 보임).

### 5.2 Grant 누적

다음 경로 중 만족하는 것을 모두 수집한다(중복 허용).

| 경로 | 조건 | 부여 grant |
| --- | --- | --- |
| 소유자 | `ownerUserId === actor.userId` (둘 다 non-null) | `Manage` |
| 작성자 | `authorUserId === actor.userId` (둘 다 non-null) | `View` |
| Manager + Team 문서 | `actor.role === "Manager"` AND `visibility === "Team"` AND `actor.teamId === document.ownerTeamId` (둘 다 non-null) | `Manage` |
| Organization 공개 | `visibility === "Organization"` | `View` |
| Team 공개 | `visibility === "Team"` AND `actor.teamId === document.ownerTeamId` (둘 다 non-null) | `View` |
| Share row (User) | `share.targetType === "User"` AND `share.targetId === actor.userId` | `share.permission` |
| Share row (Team) | `share.targetType === "Team"` AND `share.targetId === actor.teamId` (non-null) | `share.permission` |
| Share row (Organization) | `share.targetType === "Organization"` AND `share.targetId === actor.organizationId` | `share.permission` |

`Private` / `SpecificUsers` 두 visibility는 그 자체로는 grant를 만들지 않는다. 그 두 케이스에서는 소유자 / 작성자 / share / (Team 문서면 Manager bump) 경로만 의미가 있다.

### 5.3 Rank-max 선택

수집된 grant 중 가장 강한 것을 고른다. `Manage > Edit > View`. grant가 0개면 `null` (접근 불가).

### 5.4 Role cap

`actor.role === "Viewer"` 인 경우 결과를 강제로 `View`로 강하한다. Phase C §8.2: Viewer 역할은 **본인이 소유 / 작성한 문서라도 수정 불가**. 이는 역할 자체의 정의이므로 grant 누적과 별도로 적용된다.

Editor / Manager / Admin에는 cap이 없다. Manager의 "Team 문서 Manage" 권한은 cap이 아니라 5.2의 grant 경로로 표현했다.

---

## 6. 에러 정책 — NOT_FOUND vs FORBIDDEN

권한 거부는 두 가지 의미가 다르다.

- **NOT_FOUND**: 존재 자체를 알리지 않는다. cross-org / Private + 권한 없음 / 다른 팀의 Team 문서 / 삭제된 문서 / SpecificUsers + share 없음 등 모든 "어떤 path로도 grant가 없는" 상황.
- **FORBIDDEN(`reason_code`)**: 사용자가 그 문서의 존재는 알지만 요청한 액션에 권한이 부족함. View 권한자가 Edit 시도 / Edit 권한자가 Manage 시도.

이 분리의 핵심은 **존재 누설 방지**다. 외부 공격자가 무작위로 UUID를 시도하면서 응답이 NOT_FOUND인지 FORBIDDEN인지를 비교해 "이 UUID는 실제로 문서다"를 추론하는 사고를 막는다. Phase A §15 잠금이다.

`requireDocumentView` / `requireDocumentEdit` / `requireDocumentManage`는 정확히 이 정책을 적용한다.

| 상황 | `requireView` | `requireEdit` | `requireManage` |
| --- | --- | --- | --- |
| Manage 권한 | "Manage" 반환 | "Manage" 반환 | "Manage" 반환 |
| Edit 권한 | "Edit" 반환 | "Edit" 반환 | **FORBIDDEN(document_manage_not_allowed)** |
| View 권한 | "View" 반환 | **FORBIDDEN(document_edit_not_allowed)** | **FORBIDDEN(document_manage_not_allowed)** |
| 권한 없음(`null`) | **NOT_FOUND** | **NOT_FOUND** | **NOT_FOUND** |

세 함수 모두 grant 0인 상황은 똑같이 NOT_FOUND로 응답한다. 즉 Edit를 시도하다 거부되더라도 사용자가 "이 문서는 적어도 존재한다"는 정보를 받지 않는다.

---

## 7. Codex 3-pass 검증 흐름

이 단계는 Codex 검증을 세 번 받았다. 매 회마다 정책의 미묘한 갭이 잡혔고, 그 자체가 schema보다 정책이 더 미묘한 영역임을 보여준다.

### 7.1 1차 검증 — REVISION REQUESTED (2건)

1. **Manager 팀 문서 권한 누락**: 1차 구현은 Manager에게 어떤 암묵 권한도 주지 않았다. 같은 팀 문서가 visibility=Team이어도 View까지만. 그러나 Phase C 계획서 §8.2와 보안 정책 §6.5–6.6은 Manager의 MVP 역할을 "팀 문서 모더레이션"으로 정의한다. → Manager bump 추가 필요.
2. **`authorUserId` 무시**: 1차 구현은 작성자 path를 만들지 않았다. 그러면 author와 owner가 분리된 흐름(예: AI 초안에서 작성자 = 사용자, 소유자 = 팀 리드)에서 작성자가 자신의 글을 못 본다. → author View grant 추가 필요.

### 7.2 2차 검증 — REVISION REQUESTED (1건)

Manager bump를 visibility 무관하게 적용했더니 너무 넓어졌다.

- 현재 구현이 `Private` / `SpecificUsers` 문서까지 같은 팀 소유면 Manager에게 Manage를 줘 본문을 보고 관리할 수 있게 만들었다.
- 하지만 Phase C 계획서 §8.3의 visibility 정의는 `Private = 작성자/소유자`, `SpecificUsers = 지정 사용자`로 좁혀져 있다. 보안 정책 §6.3 / §6.5 / §6.6도 Manager의 범위를 "팀 범위 문서"로 한정한다.
- 따라서 Manager의 암묵 Manage는 **`visibility === "Team"`** 일 때만 적용해야 맞다.

→ `evaluateDocumentPermission`의 Manager grant 조건에 visibility 게이트 추가. Private / SpecificUsers는 Manager라도 owner / author / explicit share 경로만.

### 7.3 3차 검증 — APPROVED

- Manager 암묵 Manage가 visibility=Team으로 제한됨
- Private / SpecificUsers는 Manager라도 owner / author / explicit share 없으면 접근 불가
- author는 owner가 아니어도 View만 (Edit/Manage 확대 없이 보수적)
- Admin 본문 암묵 접근 없음
- cross-org / deleted / no grant는 NOT_FOUND
- DB schema / migration / API / UI 변경 없음
- Codex 승인 — Step 2 commit / merge / push 진행 가능

이 3-pass 흐름은 **권한 모듈은 한 번에 정확히 굳혀야 한다**는 사실을 다시 확인했다. schema는 forward migration으로 살짝 고칠 여지라도 있지만, 권한 룰은 머지된 직후부터 모든 라우트가 그것을 호출하므로 후속 정정이 어렵다.

---

## 8. Unit test 56 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| `permissionAtLeast` rank 비교 | 3 |
| Cross-org NOT_FOUND (share row 가짜 매칭 포함) | 3 |
| Private (소유자 / share / Admin 차단) | 3 |
| Team visibility (같은 팀 / 다른 팀 / null teamId / null ownerTeamId / Team-target share bump) | 5 |
| Organization visibility + Admin 묵시 접근 금지 | 4 |
| SpecificUsers (View/Edit/Manage 계층, 다중 share max-wins, Org-target share) | 6 |
| Deleted / deletedAt / Archived 동작 | 3 |
| Viewer role cap (owned / Manage share / no grant) | 3 |
| `requireDocument*` 에러 정책 (NOT_FOUND vs FORBIDDEN) | 8 |
| **Manager team-document moderation (visibility=Team 경계)** | 11 |
| **author View grant + 보수적 Edit 거부** | 7 |

**합계 56건**. 모두 단위 테스트 — DB / Postgres / Prisma 의존 없음. 매 PR에서 `pnpm test`가 빠르게 (총 ~800ms) 실행한다.

---

## 9. 테스트 / 검증 결과

### 9.1 1차 검증

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/permissions typecheck` | PASS |
| `pnpm test` (unit) | PASS — 6 files / 81 tests (38 신규 document-permission) |
| `pnpm test:integration` | PASS — 8 files / 90 tests |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

### 9.2 2차 검증 (Manager bump + author 추가)

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/permissions typecheck` | PASS |
| `pnpm test` (unit) | PASS — 6 files / 96 tests (53 document-permission) |
| `pnpm test:integration` | PASS — 8 files / 90 tests |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

### 9.3 3차 검증 (Manager bump를 visibility=Team으로 한정)

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/permissions typecheck` | PASS |
| `pnpm typecheck` (10 워크스페이스) | PASS |
| `pnpm test` (unit) | PASS — **6 files / 99 tests (56 document-permission)** |
| `pnpm test:integration` | PASS — **8 files / 90 tests** |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

세 번째 검증에서 Codex가 승인했고 Step 2 코드는 develop으로 머지·푸시되었다(commit `75c01e1`, merge `12a7804`).

---

## 10. 이번 단계에서 일부러 하지 않은 것

| 미룬 것 | 이유 / 다음 단계 |
| --- | --- |
| API 라우트 (`POST /documents`, `GET /documents/:id`, 공유 설정 등) | 이후 Step. 이 모듈을 의존성으로 사용한다. |
| 문서 작성 / 편집 화면 / 편집기 | UI 단계 |
| `document_shares.target_id` 폴리몰픽 검증 (User/Team/Organization 존재 + 같은 조직) | 서비스 레이어 책임. Step 2는 share 행이 이미 정합한 상태로 들어온다고 가정하고 권한 판단만 한다. |
| audit writer 호출 | 서비스 레이어가 호출. 이 모듈은 권한 판단 결과만 반환. |
| Phase F 검색 결과 필터링 | Phase F. 다만 함수가 순수 / null-반환 형태라 그대로 재사용 가능하다. |
| Manager 외 역할의 visibility-기반 implicit bump | 보수적으로 미적용. 추가가 필요하면 향후 Phase A §15 갱신 + 권한 정책 갱신을 거쳐 도입. |

---

## 11. 다음 단계로 넘어가기 전에 알아야 할 주의사항

### 11.1 권한 판단은 항상 이 모듈을 경유한다

Phase C 이후의 모든 라우트와 서비스는 직접 SQL `WHERE` 절에서 권한 필터를 작성하지 말고 이 모듈에 위임한다. 비대칭이 발생하면 권한 누설 또는 과차단으로 이어진다. 라우트 코드 리뷰의 1순위 점검 항목이다.

### 11.2 service layer가 share 행의 폴리몰픽 무결성을 책임진다

`document_shares.target_id`는 `targetType`에 따라 `users.id` / `teams.id` / `organizations.id` 중 하나를 가리킨다. DB는 외래 키를 걸 수 없다. 권한 모듈은 share 행의 `targetId`가 실제로 존재하고 같은 조직인지 검증하지 않는다 — 단지 actor와 매치하면 grant를 부여한다. **서비스 레이어는 share 행을 쓰기 전에 target의 존재와 조직 일치를 검증해야 한다**. F 단계에서 `ai_references.target_type`도 같은 패턴으로 갈 예정이라 검증 헬퍼를 깔끔하게 빼두면 재사용된다.

### 11.3 Manager bump는 visibility=Team으로 좁혀져 있다

Manager가 같은 팀의 Private 문서나 SpecificUsers 문서를 자동으로 관리할 수 있다는 가정으로 코드를 짜면 안 된다. owner / author / explicit share만이 그 두 visibility의 경로다. "Manager 권한이 좀 좁네"라고 느껴지면 그건 의도된 동작이다 — Phase C 계획서 §8.3과 보안 정책 §6 계열의 직접적 결과.

### 11.4 author는 View만, Edit 확대는 명시적 share만

작성자가 Edit를 원하면 owner가 explicit share를 부여해야 한다. AI 초안 흐름(Phase D)에서 작성자에게 자동으로 Edit를 줄지는 그 단계에서 별도 결정이고, Step 2는 그 흐름이 결정되기 전까지 가장 보수적인 View 한정으로 둔다.

### 11.5 Viewer role cap은 ownership을 무시한다

Viewer 역할 사용자가 본인 문서를 가지더라도 Edit 못한다. 이는 plan §8.2의 명시적 잠금이다. UI에서 "왜 내 문서인데 수정이 안 되지"가 발생할 수 있으므로 클라이언트는 Viewer 역할일 때 편집 버튼을 별도로 숨기거나 안내해야 한다 — UI Step의 책임.

### 11.6 `requireDocumentEdit/Manage`도 grant 0이면 NOT_FOUND

직관적으로는 "Edit 시도가 거부됐으니 FORBIDDEN"이라고 생각하기 쉽지만, 실제로는 grant 자체가 없으면 NOT_FOUND가 우선이다. 디버깅 시 `reason_code`가 비어있다고 당황하지 말 것 — 그 자체가 정책이다(Phase A §15).

---

## 12. 비개발자 요약 — 한 단락

Step 2는 "이 사용자가 이 문서를 볼 수 있는가, 고칠 수 있는가, 관리할 수 있는가"를 결정하는 **단일 함수**를 만든 단계였다. 이 함수 하나가 앞으로 만들어질 모든 문서 화면, 모든 API, 검색 결과 노출의 권한 결정을 한다. 함수는 "다른 조직 문서는 존재 자체를 알리지 않는다", "삭제된 문서는 모두에게 보이지 않는다", "Viewer 역할은 자기 문서라도 수정 못한다", "Manager는 본인 팀의 Team-공개 문서만 자동으로 관리할 수 있고, Private이나 지정 사용자 문서까지는 자동으로 들어가지 못한다", "Admin이라도 다른 사람 문서 본문을 그냥 보지는 못한다" 같은 회사 정책을 코드로 박아 넣었다. 정책이 한 곳에 있으므로, 향후 라우트가 다섯 군데에서 살짝씩 다른 권한 검사를 하다가 누설을 만드는 사고가 구조적으로 차단된다. Codex 검증을 세 번 거치면서 Manager의 권한 범위를 정확한 좁기로 조정했다(처음엔 누락, 그다음엔 너무 넓음). 다음 단계는 이 함수를 호출하는 실제 문서 API 라우트를 만든다.

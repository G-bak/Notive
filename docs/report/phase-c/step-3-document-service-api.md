# Phase C — Step 3: 문서 서비스 / API 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **3단계 — 문서 서비스 / API**가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Phase C Step 1의 DB 스키마와 Step 2의 권한 판단 모듈을 묶어 **사용자가 실제로 호출할 수 있는 5개의 API**를 처음으로 노출하는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md)
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md)
- 권한 모듈 출처: [Phase B Step 6 — Permission Module](../phase-b/step-6-permission-module.md)
- 감사 로그 writer 출처: [Phase B Step 8 — Audit Log](../phase-b/step-8-audit-log.md)

---

## 2. Step 3의 목적

Step 1은 **문서를 보관할 자리**를 만들었고, Step 2는 **누가 어떤 권한을 갖는지 결정하는 함수**를 만들었다. 그러나 이 둘만으로는 사용자가 실제 문서를 만들거나 볼 수 없다. Step 3의 목적은 다음과 같다.

* **5개의 서비스 함수**(create / list / get / update / delete)를 작성한다. 이 함수들이 권한 판단 → DB 입출력 → 감사 기록을 한 흐름으로 묶는다.
* **5개의 API 라우트**를 노출한다. 라우트 자체는 얇게 — session 확인 → 서비스 호출 → 응답 변환 — 만 한다. 비즈니스 로직은 모두 서비스에 있다.
* **권한 판단은 100% Step 2 모듈을 경유**한다. 이 단계의 코드는 새로운 권한 룰을 만들지 않는다.
* **모든 mutating 액션은 audit 기록**된다. Phase B의 `apps/web/lib/audit` writer를 그대로 사용한다.
* **삭제는 항상 soft delete**다. 한 번 Deleted가 된 문서는 어떤 진입점에서도 누설되지 않는다 — 소유자 포함.

다음 단계에서 다룰 것이 아닌 것:

* 공유 설정 API
* 버전 복원 API
* 즐겨찾기 / 최근 본 문서 API
* UI / 편집기
* DB 스키마 / 마이그레이션 변경
* 검색 / AI 연동

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (4개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/document.ts` | ~490 라인. 5개 서비스 함수 + zod 입력 스키마 + helper. Step 2 권한 모듈에 100% 위임. |
| `apps/web/app/api/organizations/[id]/documents/route.ts` | GET (list) + POST (create). |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/route.ts` | GET (detail) + PATCH (update) + DELETE (soft). |
| `tests/integration/document-service.test.ts` | ~550 라인, **27 통합 테스트 케이스**. |

### 3.2 수정 (2개)

| 파일 | 변경 |
| --- | --- |
| `apps/web/lib/audit/index.ts` | `Actions.DOCUMENT_*` 3개(`document.created` / `document.updated` / `document.deleted`)와 `AuditTargetType += "document"` 추가. |
| `packages/permissions/src/errors.ts` | `KnownReasonCode += "document_create_not_allowed"` 추가. Step 2의 `document_edit_not_allowed` / `document_manage_not_allowed`와 묶여 Phase C 문서 reason code 3종 완성. |

DB schema / migration / UI / search / AI 어떤 영역도 이번 단계에서 손대지 않았다.

---

## 4. 5개의 서비스 함수 — 정책 매트릭스

각 함수는 동일한 형태를 따른다.

1. `requireMembership(prisma, userId, organizationId)` — 조직 경계 확인. cross-org는 NOT_FOUND.
2. (mutation일 경우) 역할 / 권한 게이트.
3. DB read (필요 시 share 행 조인).
4. Step 2 권한 helper로 grant 평가.
5. DB write.
6. `recordActivity` 호출 — 성공 이벤트 기록.

### 4.1 createDocument

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | `roleAtLeast(membership.role, "Editor")`. Viewer는 `FORBIDDEN(document_create_not_allowed)`. Editor / Manager / Admin 모두 통과. |
| 입력 | `title` (필수), `content` (선택, 기본 `""`), `documentType` (필수), `visibility` (선택, 기본 `Private`), `ownerTeamId` (선택). |
| 기본값 | `ownerUserId = authorUserId = actor.userId`, `ownerTeamId` 미지정 시 actor의 primary team, `status = Draft`, `sourceType = Manual`. |
| 보안 | `ownerTeamId`을 명시하면 같은 조직의 팀인지 service-layer에서 검증. DB의 composite FK가 한 번 더 보장. |
| Audit | `DOCUMENT_CREATED`, metadata: `{ title, documentType, visibility }`. |

### 4.2 listDocuments

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | requireMembership만. 모든 active 멤버(Viewer 포함)가 호출 가능. |
| 쿼리 | 같은 조직 + `status !== "Deleted"` + `deletedAt IS NULL`. share 행 조인. `updatedAt DESC` 정렬. |
| 필터 | 메모리 레이어에서 `evaluateDocumentPermission` 평가 → grant가 null이 아닌 행만 반환. |
| 출력 | 권한이 있는 문서 메타데이터 배열. content 포함. (목록 화면이 본문 미리보기를 보일 수 있도록.) |

### 4.3 getDocument

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | `requireDocumentView`. NOT_FOUND이 기본 응답. |
| 출력 | `{ document, permission }` — permission은 `"View" | "Edit" | "Manage"` 중 하나. 라우트가 클라이언트에 echo. |
| 효과 | 클라이언트가 같은 메타데이터에서 곧바로 편집 / 공유 / 삭제 버튼 노출 여부 결정 가능. |

### 4.4 updateDocument

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | 변경 필드에 따라 단계화. `title` / `content` / `documentType` / `status` (Draft↔Active)는 `requireDocumentEdit`. `visibility` / `ownerTeamId` / `status=Archived`는 `requireDocumentManage`. |
| 보안 | `ownerTeamId` 명시 시 같은 조직 검증 재실행. |
| Audit | `DOCUMENT_UPDATED`, metadata: `{ changed: ["title", "content", ...] }`. |

이 단계화의 의미: Edit share를 받은 사용자가 본문은 고칠 수 있지만 visibility를 바꿔 외부에 공개로 만들거나 소유 팀을 옮기는 행위는 Manage가 필요하다 — Phase C 계획서 §8.2의 "공유 = Manager 등급 액션" 해석.

### 4.5 deleteDocument

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | `requireDocumentManage`. |
| 동작 | **Soft delete**: `status = "Deleted"`, `deletedAt = now()`. row는 삭제하지 않는다. |
| Deleted 재조회 | 진입점 어디서든 NOT_FOUND. 소유자라도 동일 (Codex가 발견한 누설 차단 — 섹션 8 참조). |
| Audit | `DOCUMENT_DELETED`, metadata: `{ title }`. |

---

## 5. 5개의 API 라우트

라우트는 모두 Phase B의 라우트 패턴을 그대로 따른다 — `getCurrentSession(cookies()) → service 호출 → respondError(err)` 형태. 비즈니스 로직 0줄.

| Method | Path | Service | 응답 |
| --- | --- | --- | --- |
| GET | `/organizations/{id}/documents` | listDocuments | `{ documents: [...] }`, 200 |
| POST | `/organizations/{id}/documents` | createDocument | 직렬화된 row, 201 |
| GET | `/organizations/{id}/documents/{documentId}` | getDocument | row + `permission` 필드, 200 |
| PATCH | `/organizations/{id}/documents/{documentId}` | updateDocument | 갱신된 row, 200 |
| DELETE | `/organizations/{id}/documents/{documentId}` | deleteDocument | soft-deleted row, 200 |

응답 직렬화는 한 곳에 모았다(`serialize(d)`) — 향후 응답 스키마 변경이 필요하면 그 한 함수만 손보면 된다.

---

## 6. 권한 판단은 Step 2 모듈을 경유

Step 3의 코드 어디에도 `if (role === "Admin") ...` / `if (visibility === "Team" && ...) ...` 같은 권한 분기가 **없다**. 모든 결정은 다음 형태다.

```ts
const ctx = contextFromRow(row);
requireDocumentView(actor, ctx, row.shares);   // 또는 Edit / Manage
```

그리고 `actor`는:

```ts
const membership = await requireMembership(prisma, userId, organizationId);
const actor = actorFromMembership(membership);
```

이 패턴을 깨면(예: 라우트에서 SQL `WHERE` 절로 직접 권한 필터를 만들면) Step 2가 권한 모듈로 만든 의미가 사라진다. **PR 리뷰의 1순위 점검 항목**이다.

---

## 7. Audit 기록 정책

각 mutation은 다음을 따른다.

* **성공 이벤트만 기록** (Phase B step 8 skeleton 정책 그대로). 실패 / 거부 이벤트는 Phase G로 이연.
* **새 컬럼 추가 없음**. 기존 `activity_logs` 스키마 그대로 사용.
* **best-effort**: writer 실패가 사용자 액션 자체를 실패시키지 않는다 (`recordActivity`가 try/catch + stderr 로그).
* `targetType = "document"`, action 코드는 `document.created` / `document.updated` / `document.deleted` 세 가지 문자열.
* `metadata`:
  * created → `{ title, documentType, visibility }`
  * updated → `{ changed: ["field1", "field2", ...] }`
  * deleted → `{ title }`

`ip_address` / `user_agent` 컬럼은 Phase B와 동일하게 비워둔다 — Phase G에서 request-pipeline에서 주입.

---

## 8. Codex 검증 중 발견된 Deleted 문서 DELETE 누설과 수정

이 단계는 Codex 검증을 두 번 받았고, 한 가지 매우 의미 있는 정책 누설이 발견되었다.

### 8.1 1차 구현 (누설 있음)

`deleteDocument`가 idempotency를 위해 다음과 같았다.

```ts
if (row.status === "Deleted" || row.deletedAt !== null) {
  return row;   // <-- 누설
}
const ctx = contextFromRow(row);
requireDocumentManage(actor, ctx, row.shares);
```

의도는 "이미 삭제된 문서를 다시 DELETE하면 같은 결과를 돌려주자(idempotent)"였다. 그러나 이 분기는 **권한 검사 전에** row를 반환한다. 결과:

* 같은 조직의 어떤 멤버라도 Deleted 문서 ID만 알면 본문/메타데이터를 받을 수 있다.
* "Deleted = NOT_FOUND for everyone"이라는 다른 진입점(`getDocument`, `listDocuments`, `updateDocument`)의 정책과 모순.
* 존재 누설 방지(Phase A §15) 위반 — DELETE 응답이 NOT_FOUND인지 200인지로 ID 존재를 추론 가능.

### 8.2 Codex 1차 검증 — REVISION REQUESTED

Codex는 정확히 이 흐름을 짚었다.

> /apps/web/lib/services/document.ts:455의 idempotent delete 처리가 권한 정책을 깨고 있습니다. 같은 조직 멤버가 삭제된 문서 ID를 알면, 권한이 없어도 DELETE로 삭제된 문서의 본문/메타데이터를 다시 받을 수 있습니다.

수정 지시:
- 이미 Deleted이거나 `deletedAt !== null`이면 항상 `Errors.notFound()`를 던질 것.
- idempotent delete 테스트는 "second delete returns NOT_FOUND"로 변경.
- 비권한 사용자가 Deleted 문서 ID로 DELETE하면 NOT_FOUND인지 테스트 추가.

### 8.3 수정

```ts
// Already-Deleted rows are NOT_FOUND for everyone. Returning the row
// would (a) leak its body / metadata to anyone who guesses the id and
// (b) contradict the "Deleted document is NOT_FOUND" rule that
// getDocument and listDocuments enforce. Permission re-checks below
// would also reject — evaluateDocumentPermission gates on status —
// but we make the rejection explicit and skip the permission helper
// entirely so the response is uniform regardless of caller.
if (row.status === "Deleted" || row.deletedAt !== null) {
  throw Errors.notFound();
}
```

테스트도 두 개로 분리:

1. **`second delete on already-Deleted -> NOT_FOUND`**: 원래 소유자도 두 번째 DELETE에서 NOT_FOUND. row가 어떤 read path로도 도달 불가능함을 확인.
2. **`unrelated org member on already-Deleted id -> NOT_FOUND`** (신규): 처음부터 view 권한이 없던 사용자가 Deleted ID로 DELETE → NOT_FOUND, no reason_code (존재 누설 방지).

### 8.4 Codex 2차 검증 — APPROVED

수정 후 4가지 진입점이 Deleted 문서에 대해 **일관되게** NOT_FOUND를 응답한다.

| 진입점 | Deleted 문서에 대한 응답 |
| --- | --- |
| `getDocument` | NOT_FOUND (Step 2 helper의 status 게이트) |
| `listDocuments` | 결과에서 제외 (SQL 필터) |
| `updateDocument` | NOT_FOUND (Step 2 helper의 status 게이트) |
| `deleteDocument` | NOT_FOUND (이번 수정으로 명시적) |

Step 2 helper가 Deleted 게이트를 갖고 있어서 거의 다 막혔지만, `deleteDocument`의 early return이 그 게이트를 우회했던 것이 핵심 원인. **권한 모듈의 게이트를 우회하는 모든 short-circuit은 의심하라**가 이 사고에서 얻은 운영 교훈이다.

---

## 9. 검증 결과

### 9.1 1차 검증 (idempotent delete 누설 발견 전)

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | PASS — 10 워크스페이스 모두 |
| `pnpm test` (unit) | PASS — 6 files / 99 tests |
| `pnpm test:integration` | PASS — 9 files / 117 tests (90 → 117) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

이 시점의 통합 테스트는 "idempotent delete returns row" 케이스를 통과시켰기 때문에 정책 오류를 잡지 못한 상태였다. Codex 검증이 그 갭을 메웠다.

### 9.2 2차 검증 (NOT_FOUND 강제 후)

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | PASS — 10 워크스페이스 모두 |
| `pnpm test` (unit) | PASS — 6 files / 99 tests |
| `pnpm test:integration` | PASS — **9 files / 118 tests** (idempotent 케이스 1개 → 두 NOT_FOUND 케이스로 분리) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

Codex 2차 검증에서 승인되어 `develop`에 머지되었다(commit `5af021d`, merge `869478a`).

### 9.3 통합 테스트 27 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| createDocument (Editor/Manager/Admin OK, Viewer 차단, cross-org NOT_FOUND, INVALID_INPUT, audit) | 7 |
| getDocument + listDocuments (owner Manage, Private NOT_FOUND incl. Admin, cross-org, Manager Team, Manager Private 차단, author View vs Edit, list 필터, Deleted 제외) | 8 |
| updateDocument (owner OK, View-only 거부, no-view NOT_FOUND, Edit-no-Manage on visibility, archive, audit) | 6 |
| deleteDocument (owner Manage, Edit-share 거부, no-view NOT_FOUND, get afterward NOT_FOUND, second delete NOT_FOUND, unauthorized on Deleted id NOT_FOUND, audit) | 6 |

---

## 10. 다음 단계로 넘어가기 전 운영 주의사항

### 10.1 `ownerTeamId`는 같은 조직 내 다른 팀 지정도 허용된다

현재 `createDocument` / `updateDocument`는 `ownerTeamId`를 명시할 수 있고, service 레이어 검증과 DB의 composite FK가 모두 "같은 조직"까지만 검증한다. 즉 actor의 primary team과 다른 팀을 지정해 문서를 만들거나 옮길 수 있다. 보안 측면 위험은 없다(조직 경계는 여전히 안전). 다만 운영 정책이 더 보수적이어야 한다면(예: actor의 primary team 또는 Admin/Manage만 허용) 후속 Step에서 결정한다. **Codex가 이 정책을 인지하고 수용**한 상태다.

### 10.2 Route smoke test는 후속 Step에서 보강

이번 단계 통합 테스트는 service 직접 호출만 커버한다. Route 자체는 얇고 (session → service 위임 → respondError) Phase B 패턴을 그대로 사용해 위험이 낮지만, 최소 1–2개의 route smoke test(실제 HTTP 응답 확인)는 후속 Step에서 추가하는 것이 좋다.

### 10.3 `listDocuments`는 application-layer 필터링이다

조직 내 비-Deleted 문서를 SQL로 모두 가져온 뒤 메모리에서 `evaluateDocumentPermission`으로 거른다. 권한 모듈이 단일 진실의 함수라는 정책 일관성을 위한 결정이다. 조직이 커지면(수만 건) 비효율이 될 수 있다 — Phase F 검색이 도입되면 SQL-side 권한 필터로 옮길 수 있다. Step 3 단계에서는 정책 일관성이 우선.

### 10.4 `document_shares` 폴리몰픽 target 검증은 공유 API 단계에서

`target_id`는 `targetType`에 따라 `users.id` / `teams.id` / `organizations.id` 중 하나를 가리킨다. DB는 이 폴리몰픽 관계에 외래 키를 걸 수 없다. 이번 Step의 create/update payload schema는 share 필드를 받지 않으므로 잘못된 share가 service로 들어올 경로가 차단되어 있다. **공유 설정 API가 도입될 때**, 그 시점에서 target 존재 + 같은 조직 검증 helper가 추가되어야 한다.

### 10.5 Audit 실패 이벤트 / `ip_address` / `user_agent`는 Phase G로 이연

Phase B step 8과 동일한 정책: 성공만 기록, request-pipeline에서의 IP / UA 캡처는 Phase G가 담당. 스키마는 이미 Step 1에서 잡혀 있어 Phase G가 writer만 추가하면 된다.

### 10.6 한 번 Deleted가 된 문서는 모든 진입점에서 NOT_FOUND

소유자라도 다시 볼 수 없다. 복원이 필요하면 별도의 "Trash" / restore API를 만들어야 한다 (이번 단계 out of scope). UX 관점에서는 휴지통 화면이 Phase G admin 또는 별도 endpoint로 노출될 가능성이 높다.

---

## 11. 비개발자 요약 — 한 단락

Step 3은 Step 1의 "문서 자리"와 Step 2의 "누가 뭘 할 수 있는지 결정하는 함수"를 묶어 사용자가 실제로 호출할 수 있는 5개의 API(목록 / 작성 / 상세 / 수정 / 삭제)를 만든 단계였다. 모든 API는 같은 패턴으로 짜였다 — 조직 경계 확인 → 단일 권한 함수 호출 → DB 입출력 → 감사 로그. 새로운 권한 룰은 한 줄도 만들지 않았고, Step 2의 함수에 100% 위임한다. Codex 검증 중 한 가지 누설이 발견됐는데, 이미 삭제된 문서를 다시 DELETE하면 본문이 새어나가는 문제였다. "이미 삭제된 문서는 누구에게도 보이지 않는다"는 정책을 모든 진입점에 일관되게 박아 넣어 닫았다. 다음 단계는 이 위에 공유 설정 / 버전 복원 / 즐겨찾기 같은 부가 기능 API를 얹는다.

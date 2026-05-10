# Phase C — Step 7: 태그 도메인 / 문서 목록 필터 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **7단계 — 태그 도메인 + 문서 목록 필터**가 완료된 시점에 작성된 단계별 보고서다. Step 1에서 만든 `document_tags` / `document_tag_links` 두 테이블을 처음으로 backend API에 연결하고, Step 3에서 만든 `listDocuments`에 필터·페이징 표면을 추가한다. 동일 단계에서 도입된 **라우트 smoke 인프라 + 14 케이스**는 별도 보고서 [Step 7 — 라우트 smoke 인프라](./step-7-route-smoke-infra.md)로 분리해 작성한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md) — `document_tags` / `document_tag_links` 테이블, `(organizationId, name)` unique, ON DELETE CASCADE 설계
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md) — `requireDocumentEdit` / `requireDocumentView` / `evaluateDocumentPermission`
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — `listDocuments` 본체, Deleted = NOT_FOUND
- [Phase C Step 6 — 즐겨찾기 / 최근 문서](./step-6-favorites-recent.md) — favorite 토글 / `clampLimit` 정책

---

## 2. Step 7의 목적

Step 1에서 태그 어휘 테이블이 생겼지만 실제 row를 쓰거나 읽는 코드 경로가 없었다. 또한 Step 3의 `listDocuments`는 권한 필터만 적용한 단순 목록이라 UI에서 "내 팀 / 특정 작성자 / 특정 태그 / 검색어"로 좁힐 수 없었다. Step 7의 목적은 다음과 같다.

* **태그 어휘** CRUD 3개 API(list / create / delete) — 조직 단위 어휘.
* **문서별 태그 집합** 1개 API(replace-all PUT) — 문서 1건의 태그 멤버십 갱신.
* **문서 목록 필터** 확장 — `status` / `visibility` / `documentType` / `ownerTeamId` / `authorUserId` / `favorite` / `tagId` / `q` / `limit` 9개.
* 모든 read는 **권한 필터를 통과한 결과만** 반환 — 다른 조직의 태그·문서·작성자가 새지 않음.
* Audit: `setDocumentTags`만 활동 로그에 기록(diff 메타데이터 포함). 어휘 CRUD는 의도적으로 미기록.

다음 단계에서 다룰 것이 아닌 것:

* UI / 태그 칩 컴포넌트
* DB 스키마 / 마이그레이션 변경
* Phase F 검색 인덱스 (`q`는 단순 ILIKE 유지)
* 라우트 smoke test (같은 단계의 후속 작업으로 분리, 별도 보고서 참조)

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (5개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/document-tag.ts` | ~353 라인. `listTags` / `createTag` / `deleteTag` / `setDocumentTags` + zod 스키마. |
| `apps/web/app/api/organizations/[id]/documents/tags/route.ts` | GET (list) + POST (create, 201) |
| `apps/web/app/api/organizations/[id]/documents/tags/[tagId]/route.ts` | DELETE (204) |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/tags/route.ts` | PUT (replace-all) |
| `tests/integration/document-tags-filters.test.ts` | ~463 라인, **21 통합 테스트**. |

### 3.2 수정 (3개)

| 파일 | 변경 |
| --- | --- |
| `apps/web/lib/services/document.ts` | `listDocuments`에 `ListDocumentsOptions` 파라미터 9종 추가 + 기본 limit 20 / 최대 100 슬라이스. |
| `apps/web/app/api/organizations/[id]/documents/route.ts` | GET 핸들러에 엄격 query 파서 추가 — invalid 값은 INVALID_INPUT(400). |
| `apps/web/lib/audit/index.ts` | `Actions.DOCUMENT_TAGS_UPDATED = "document.tags_updated"` 추가. |
| `packages/permissions/src/errors.ts` | `KnownReasonCode`에 `tag_create_not_allowed` / `tag_delete_not_allowed` 추가. |

DB 스키마 / 마이그레이션은 손대지 않았다(Step 1에서 이미 설계됨).

---

## 4. 태그 어휘 API 3개

라우트는 모두 Phase B/C 패턴 — `getCurrentSession(cookies()) → service 호출 → respondError(err)`. 비즈니스 로직 0줄.

| Method | Path | Service | 권한 게이트 | 응답 |
| --- | --- | --- | --- | --- |
| GET | `/organizations/{id}/documents/tags` | `listTags` | `requireMembership` (Active 멤버 누구나) | `{ tags: [{ id, organizationId, name, createdAt }] }` |
| POST | `/organizations/{id}/documents/tags` | `createTag` | Editor 이상 | 201, tag row JSON |
| DELETE | `/organizations/{id}/documents/tags/{tagId}` | `deleteTag` | Manager 이상 | 204 No Content |

### 4.1 createTag — 멱등성

DB는 `(organizationId, name)`에 unique 인덱스를 가진다. service는 다음 순서로 동작한다:

1. 먼저 `findUnique({ organizationId, name })` 빠른 경로 — 이미 있으면 그 row 반환.
2. 없으면 `create` 시도.
3. 동시 호출로 P2002(unique violation)가 나면 다시 `findUnique`로 fallback.

결과: 같은 조직에서 같은 이름으로 두 번 POST를 보내도 같은 row가 한 번만 생성되며, 두 번째 호출도 200/201로 응답한다. 클라이언트는 "이미 있다"를 별도로 처리할 필요가 없다.

### 4.2 deleteTag — Manager 이상으로 가둔 이유

태그 어휘는 **조직 전체가 공유**하는 메타데이터다. 한 명의 Editor가 조직의 태그 하나를 지우면 그 태그를 사용하던 다른 사람들의 필터·검색 결과가 같이 사라진다. 태그 생성은 Editor에게 열어 주어 일반 작성 권한과 통일했지만, 삭제는 **Manager 이상**으로 좁혀 단일 Editor가 모두의 필터 어휘를 망가뜨릴 수 없게 한다. Phase C plan §8.3 정책 결정.

물리 삭제 시 `document_tag_links` 테이블의 연결 row는 ON DELETE CASCADE(Step 1 schema)로 자동 정리된다. 문서 본체는 영향 없음.

### 4.3 cross-org tagId 경로

다른 조직의 tagId를 추측해 자기 조직의 DELETE 라우트로 보내면 service의 `findUnique({ id, organizationId })` 결과가 null이 되어 NOT_FOUND가 나온다. envelope에 reason_code가 없어 "그 tagId가 다른 조직에 존재한다"는 정보는 새지 않는다(Phase A §15).

---

## 5. 문서별 태그 집합 PUT — replace-all + 검증

`PUT /organizations/{id}/documents/{documentId}/tags`의 동작은 다음과 같다.

| 단계 | 동작 |
| --- | --- |
| 1 | `requireDocumentEdit` — Edit 권한 없으면 403/404 분기. |
| 2 | 입력 `tagIds` 중복 제거 후 `findMany({ id: in, organizationId })`로 일괄 존재 검증. 누락된 ID가 있으면 NOT_FOUND(어떤 ID가 빠졌는지 echo하지 않음). |
| 3 | 트랜잭션 안에서 기존 link row 전부 삭제 → `createMany`로 새 set 삽입. |
| 4 | audit: `DOCUMENT_TAGS_UPDATED`, `metadata: { added, removed, total }`. |

응답: `{ tags: [...], diff: { added, removed, total } }`.

### 5.1 P2003 race translation (Codex 1차 보정 사항)

가장 까다로운 케이스: Manager가 같은 시점에 **요청에 포함된 tag 중 하나를 삭제**한다. 그러면:

* 2단계의 존재 검증은 통과(아직 삭제 직전).
* 3단계 `createMany` 직전에 Manager가 commit → tag row가 사라짐.
* `createMany`는 `document_tag_links.tag_id` FK 위반(P2003)으로 실패.

초기 구현은 P2003을 service에서 처리하지 않아 라우트가 `INTERNAL_ERROR`로 노출됐다. Codex 1차 검토에서 발견. 수정: service의 트랜잭션을 try/catch로 감싸 P2003을 `Errors.notFound()`로 번역. 결과적으로 클라이언트는 동시 race를 "그 태그 중 하나가 사라졌다"로 인지한다 — INTERNAL_ERROR가 아니라.

### 5.2 권한 분기

| 액터 | 응답 |
| --- | --- |
| Owner / Editable share grant | 200 + 갱신된 tag list |
| View-only(visibility=Organization 등으로 inherited View만 있음) | 403 `FORBIDDEN(document_edit_not_allowed)` |
| no-view (Private 문서) | 404 `{ error:"NOT_FOUND" }` |
| Deleted 문서 | 404 NOT_FOUND |
| cross-org documentId | 404 NOT_FOUND |
| cross-org tagId가 payload에 섞임 | 404 NOT_FOUND (cross-org tag 존재 자체를 echo하지 않음) |
| 같은 tagId 중복 입력 | 400 INVALID_INPUT (zod에서 거부) |

---

## 6. 문서 목록 필터 — 9종

`listDocuments(prisma, userId, organizationId, opts: ListDocumentsOptions)` 시그니처에 `opts` 추가. SQL where → 권한 필터(메모리) → limit slice 순으로 처리한다.

| 필터 | 의미 / 비고 |
| --- | --- |
| `status` | `Draft` / `Active` / `Archived` 중 하나. **Deleted는 어떤 입력에도 항상 제외**(존재 누설 방지). |
| `visibility` | `Private` / `Team` / `Organization` / `SpecificUsers` |
| `documentType` | 자유 문자열 — 예: `general` / `meeting-note` 등. 라우트 본체가 클라이언트와 합의한 어휘. |
| `ownerTeamId` | 팀 owner. UUID 검증을 통과한 값만. |
| `authorUserId` | 작성자. UUID 검증을 통과한 값만. |
| `favorite` | `true`만 의미가 있음 — 현재 actor의 favorite 행만 반환. `false`는 의미가 없어 옵션 미설정으로 동일 처리. |
| `tagId` | UUID 검증. 권한 필터는 SQL 이후에도 동작 — cross-org tagId가 섞이면 권한 필터에서 자동 제거. |
| `q` | 제목 / 본문 ILIKE contains. **Phase F 검색 인덱스가 도입되면 교체 예정**. |
| `limit` | 기본 20, 1–100. invalid 값은 INVALID_INPUT(엄격 파서). |

### 6.1 라우트 query 파서의 엄격성 (Codex 1차 보정 사항)

초기 구현은 invalid 값을 **silently 무시**하고 기본 목록을 반환했다. 예: `?status=Deleted` → 200 정상 목록, `?limit=abc` → 200 기본 limit 적용. Codex 검토는 이 동작을 **클라이언트 버그를 가리는 응답**으로 지적했다.

수정: 모든 query 파라미터를 명시적으로 파싱한다.

| 파서 | 거부 케이스 |
| --- | --- |
| `parseStatus` | `Draft` / `Active` / `Archived` 외 모두 INVALID_INPUT (Deleted 포함). |
| `parseVisibility` | 4종 외 INVALID_INPUT (`Department` 등 Phase A §15에서 제거된 값도 거부). |
| `parseFavorite` | `true` / `false` 외 INVALID_INPUT. |
| `parseLimit` | `Number(s)`가 finite가 아니면 INVALID_INPUT. |
| `parseUuid` (ownerTeamId / authorUserId / tagId) | UUID 정규식 실패 시 INVALID_INPUT. |

### 6.2 parseUuid를 추가한 이유 (Codex 2차 보정 사항)

UUID 검증 없이 `?tagId=abc` 같은 문자열이 Prisma의 `where` 절에 그대로 들어가면 Postgres가 uuid-parse 에러를 raise한다. Prisma는 이를 라우트로 propagate해 INTERNAL_ERROR(500)이 노출된다. 두 가지 문제:

1. 클라이언트 입력 실수가 5xx로 변환된다 — 운영 입장에서 "서버 장애"로 보임.
2. error message가 `column tag_id has type uuid` 형태로 내부 컬럼 정보를 노출.

`parseUuid`는 라우트 본체에서 **Prisma 도달 전**에 4xx로 차단한다. 동일 정규식을 ownerTeamId / authorUserId / tagId 세 파라미터가 공유 — `parseUuid(s, "ownerTeamId")` 형태로 필드명만 다르게 호출.

---

## 7. Audit 정책

| 액션 | audit row | 사유 |
| --- | --- | --- |
| `setDocumentTags` (PUT) | **YES** — `DOCUMENT_TAGS_UPDATED`, `metadata: { added, removed, total }` | 문서 메타데이터의 의미 있는 변경. 추후 "이 문서의 태그를 누가 언제 어떻게 바꿨는지" 추적 필요 가능. |
| `createTag` / `deleteTag` (어휘 CRUD) | NO | 조직 어휘 churn은 빈도가 매우 높을 수 있음. activity_logs 노이즈로 의미 있는 신호를 가림. Phase G에서 재검토 가능. |
| `listTags` / `listDocuments` (read) | NO | Phase B 정책 — read는 audit하지 않음. |

이 결정은 service 파일 헤더 주석에 명시되어 향후 변경자가 의도를 잃지 않는다.

---

## 8. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` (10 워크스페이스) | PASS |
| `pnpm test` (vitest unit) | PASS — 6 files / 99 tests (변동 없음) |
| `pnpm test:integration` | PASS — **13 files / 187 tests** (166 → 187, +21 신규 tags / filters 테스트) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

Step 7 tags-filters 코드는 `develop`에 머지되었다 (commit `5444a20`, merge `f44c78c`).

### 8.1 Integration test 21 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| Tag CRUD (Editor create OK / Viewer create FORBIDDEN / 빈 이름 INVALID / duplicate idempotent / list org-scoped / Editor delete FORBIDDEN / Manager delete cascades / cross-org delete NOT_FOUND) | 8 |
| `setDocumentTags` (Owner replace OK + diff / View-only FORBIDDEN / no-view NOT_FOUND / Deleted NOT_FOUND / cross-org tagId NOT_FOUND / duplicate tagId INVALID / audit row diff) | 7 |
| `listDocuments` 필터 (status / visibility / documentType / ownerTeamId / authorUserId / favorite / tagId / q / limit 기본 / clamp / invalid limit / forged cross-org tagId 권한 필터) — 케이스를 묶거나 쪼갠 결과 | 6 |

### 8.2 Codex 2-pass 검토 라운드 요약

* **1차** — 두 이슈 발견:
  - `setDocumentTags`가 P2003을 INTERNAL_ERROR로 노출(Manager race).
  - 라우트 query 파서가 invalid 값을 silent drop.
* **수정** — service에 P2003 → NOT_FOUND 번역 / 라우트에 엄격 파서 5종 추가.
* **2차** — 1건 보강 요청: ownerTeamId / authorUserId / tagId 세 파라미터에 UUID 검증 추가(Postgres uuid-parse 5xx leak 방지).
* **수정** — 공유 `parseUuid` 헬퍼 + 세 호출 지점.
* **3차** — 승인.

---

## 9. 다음 단계로 넘어가기 전 운영 주의사항

### 9.1 `q`는 임시 ILIKE

`q` 파라미터는 title / content에 대한 case-insensitive contains다. 본문이 길거나 컬렉션이 커지면 성능이 빠르게 나빠진다. Phase F 검색이 도입되면 ILIKE 경로를 검색 인덱스 호출로 교체한다. 그 시점까지의 성능 한계는 의도된 trade-off.

### 9.2 메모리 권한 필터의 한계

`listDocuments`는 SQL where로 좁힌 후보 set을 메모리에서 권한 필터링한다. limit*N(현재는 단순 limit) 윈도우보다 권한 통과한 행이 적으면 결과가 limit에 미달할 수 있다. 운영 데이터로 분포가 측정되면 SQL-side 권한 필터로 이전 검토. 같은 패턴이 Step 6의 `listFavorites` / `listRecentDocuments`에도 있어 함께 묶어 다룰 수 있다.

### 9.3 태그 어휘의 글로벌 잠금

`createTag` / `deleteTag`는 조직 단위 unique / FK CASCADE 정책에 의존한다. 한 조직 안에 동시 태그 생성·삭제가 빈번해지면 unique 인덱스 / FK 검증 락이 직렬화 지점이 될 수 있다. Phase C MVP 규모에서는 acceptable. 한 조직당 태그 수 / 태그 변경 빈도를 운영 데이터로 측정 후 escalation.

### 9.4 `setDocumentTags`의 replace-all 정책

PUT은 항상 전체 set 교체다. 클라이언트가 누락된 tag set을 보내면 그만큼 link가 사라진다. partial update(추가만 / 제거만)는 의도적으로 미지원 — Phase A의 일관 정책 "replace-all PUT, partial은 PATCH" 준수. 클라이언트는 항상 full set을 보내야 하며, 이는 audit metadata의 added / removed가 의미를 갖게 한다.

### 9.5 라우트 smoke 부채는 같은 단계 후속에서 처리

이 단계의 21 통합 테스트는 service 직접 호출이다. 같은 Step 7 안에서 후속 작업으로 라우트 smoke 인프라 + 14 케이스를 도입했다 — 별도 보고서 [Step 7 — 라우트 smoke 인프라](./step-7-route-smoke-infra.md) 참조.

---

## 10. 비개발자 요약 — 한 단락

Step 7은 문서에 "라벨" 같은 태그를 붙이고, 문서 목록을 "내 팀이 만든 / 작성자가 김철수인 / `meeting-note` 타입의 / `roadmap` 태그가 붙은 / 제목에 `2026`이 들어간" 식으로 좁혀 볼 수 있는 backend 기반을 만든 단계다. 태그 어휘는 조직 전체가 공유하는 메뉴이기 때문에 일반 작성자(Editor)는 새 태그를 만들 수는 있지만, 이미 만들어진 태그를 지우는 권한은 관리자급(Manager) 이상으로 좁혔다 — 한 사람이 모두의 필터 메뉴를 망가뜨리지 못하게 하기 위함이다. 같은 이름의 태그를 두 번 만들어도 자동으로 한 번만 저장되고(데이터베이스의 유일성 제약), 누가 동시에 같은 태그를 지우는 경합이 일어나도 사용자에게는 5xx 서버 오류가 아니라 "그 태그가 사라졌다"는 일관된 응답이 간다. 문서 목록 필터는 클라이언트가 잘못된 값(예: `?status=Deleted`, `?limit=abc`)을 보내면 조용히 기본 목록을 보여 주는 대신 명확히 400으로 거부하도록 강제했다 — 이는 클라이언트 버그가 200 응답 뒤에 숨는 것을 막기 위한 의도된 엄격함이다. 실제로 코덱스 1차 검토에서 이 두 가지(태그 동시 삭제 시 5xx 누출 / 잘못된 query 무시)가 모두 잡혀 보정됐고, 2차 검토에서는 잘못된 UUID가 그대로 데이터베이스에 도달해 5xx로 변환되는 또 한 가지 누락이 추가로 잡혀 보강됐다. 이번 단계는 모두 backend API만 노출하며, UI 상의 태그 칩 / 필터 UI는 다음 단계에서 구현된다.

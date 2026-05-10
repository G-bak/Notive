# Phase C — Step 6: 즐겨찾기 / 최근 문서 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **6단계 — 즐겨찾기 / 최근 문서 API**가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1에서 만든 `document_favorites` / `document_view_histories` 두 테이블을 처음으로 backend API에 연결한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md) — `document_favorites` / `document_view_histories` 테이블, composite FK
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md) — `requireDocumentView` / `evaluateDocumentPermission`
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — `getDocument` 본체, Deleted = NOT_FOUND 정책
- [Phase C Step 4 — 문서 공유 API](./step-4-document-sharing-api.md) — service 분리 / `target_id` 검증 패턴
- [Phase C Step 5 — 문서 버전 이력](./step-5-document-versions.md) — `version preview / share read는 view-history 미기록` 정책 근거

---

## 2. Step 6의 목적

Step 1에서 즐겨찾기와 최근 본 문서 테이블이 생겼지만, 실제로 row를 쓰거나 읽는 코드 경로는 없었다. Step 3가 이 두 테이블을 명시적으로 미구현으로 둔 채 보고서로 남겼다. Step 6의 목적은 다음과 같다.

* **즐겨찾기** 추가 / 제거 / 목록 3개 API.
* **최근 본 문서** 목록 1개 API + `getDocument` 성공 시 view-history append hook.
* 모든 read는 **현재 view 가능한 문서만** 반환 — 권한을 잃은 / Deleted 문서는 silently 누락.
* PUT / DELETE 즐겨찾기 모두 **idempotent**하지만 view 게이트는 통과해야 한다 — 존재 누설 방지.
* limit 파라미터 정책 (기본 20, 최대 100) 일관 적용.

다음 단계에서 다룰 것이 아닌 것:

* UI / 즐겨찾기 별 버튼
* DB 스키마 / 마이그레이션 변경
* 검색 / AI 연동
* route smoke test (지시 그대로 후속 결정 전까지 보류)
* view-history cleanup / 보존 정책 (Phase G operations 결정)

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (6개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/document-favorite.ts` | ~205 라인. `setFavorite` / `unsetFavorite` / `listFavorites` + `clampLimit`. |
| `apps/web/lib/services/document-view-history.ts` | ~190 라인. `recordDocumentView` (best-effort) + `listRecentDocuments` + `clampLimit`. |
| `apps/web/app/api/organizations/[id]/documents/favorites/route.ts` | GET (list) |
| `apps/web/app/api/organizations/[id]/documents/recent/route.ts` | GET (list) |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/favorite/route.ts` | PUT / DELETE |
| `tests/integration/document-favorites-recent.test.ts` | ~340 라인, **16 통합 테스트**. |

### 3.2 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `apps/web/lib/services/document.ts` | `getDocument` 성공 후 `recordDocumentView(prisma, userId, organizationId, documentId)` 호출 추가 (+8 라인). |

DB schema / migration / audit / errors / UI 어떤 영역도 이번 단계에서 손대지 않았다.

---

## 4. Favorites API 3개 요약

라우트는 모두 Phase B/C 패턴 — `getCurrentSession(cookies()) → service 호출 → respondError(err)`. 비즈니스 로직 0줄.

| Method | Path | Service | 권한 게이트 | 응답 |
| --- | --- | --- | --- | --- |
| GET | `/organizations/{id}/documents/favorites?limit=N` | `listFavorites` | requireMembership; 결과는 `evaluateDocumentPermission` 필터 | `{ favorites: [{ document, favoritedAt }] }` |
| PUT | `/organizations/{id}/documents/{documentId}/favorite` | `setFavorite` | `requireDocumentView` (Deleted = NOT_FOUND) | favorite row JSON |
| DELETE | `/organizations/{id}/documents/{documentId}/favorite` | `unsetFavorite` | `requireDocumentView` (Deleted = NOT_FOUND) | 204 No Content |

### 4.1 PUT / DELETE Idempotency 정책

| 케이스 | PUT 동작 | DELETE 동작 |
| --- | --- | --- |
| 첫 호출 | 새 row 생성 → 반환 | 행이 있으면 삭제, 없으면 no-op |
| 두 번째 호출 | 기존 row 반환 (중복 row 없음) | no-op 성공 |
| Deleted 문서 | NOT_FOUND | NOT_FOUND |
| Cross-org documentId | NOT_FOUND | NOT_FOUND |
| Private 문서 + view 권한 없음 | NOT_FOUND | NOT_FOUND |

DB의 `(userId, documentId)` unique 인덱스 (Step 1)가 idempotency를 보장 — application은 단지 "이미 있으면 그대로, 없으면 만들어"의 패턴.

### 4.2 DELETE도 View 게이트를 통과해야 하는 이유

직관적으로는 "DELETE는 행이 있으면 지우고 없으면 no-op이니까 권한 검사가 필요 없지 않나?"로 생각할 수 있다. 그러나:

* DELETE 응답이 200/204 vs NOT_FOUND로 갈리면 **존재 오라클**이 된다. 공격자가 무작위 documentId를 DELETE에 넣어 응답 차이로 "이 ID는 실제 문서다"를 추론할 수 있다.
* Phase A §15의 "권한 없는 자원의 존재를 알리지 않는다" 정책은 read만이 아니라 mutating 액션에도 적용된다.
* Step 3의 `deleteDocument`도 이미 같은 패턴(Deleted 문서 ID를 추측해도 NOT_FOUND)을 사용 — Codex 1차 검증에서 발견되어 fix됐다. 그 정책을 favorite DELETE에도 일관되게 적용.

따라서 favorite DELETE는 **idempotent + View 게이트** 두 정책을 동시에 만족한다.

### 4.3 listFavorites는 현재 view 가능한 문서만

`listFavorites`는 사용자의 모든 favorite을 fetch한 뒤 메모리에서 다음을 필터:

1. 문서 자체가 Deleted면 제외.
2. `evaluateDocumentPermission` 결과가 null이면 제외 (사용자가 view 권한을 잃은 경우).

결과: favorite 토글 후 시간이 흘러 권한이 변하더라도 사용자는 자신의 favorite list에서 "열어 봐도 NOT_FOUND가 뜨는 문서"를 보지 않는다. Step 3의 `listDocuments` 패턴과 동일.

---

## 5. Recent API + getDocument view-history hook

### 5.1 hook

`apps/web/lib/services/document.ts`의 `getDocument`가 권한 검사 통과 후 `recordDocumentView(prisma, userId, organizationId, documentId)`를 호출한다.

| Read 경로 | view-history 기록 |
| --- | --- |
| `getDocument` 성공 | **YES** — 새 row append |
| `getDocument` 실패 (NOT_FOUND / FORBIDDEN) | NO |
| `listDocuments` | NO |
| `listDocumentShares` | NO |
| `listDocumentVersions` / `getDocumentVersion` | NO |
| `listFavorites` / `listRecentDocuments` 자체 | NO |

이 결정의 의미: "사용자가 실제로 문서 상세를 열어 본 것"만 recent의 의미가 있다. 목록을 스크롤하거나 공유 패널을 잠시 본 것은 의미 없음. 이렇게 좁힘으로써 view-history가 의미 있는 신호로 유지된다.

### 5.2 best-effort 정책

`recordDocumentView`는 항상 try/catch로 감싸 INSERT 실패 시 `console.error` 로그만 남기고 `null`을 반환한다. 호출자(`getDocument`)는 이 결과를 사용하지 않는다 — 사용자에게 **"문서를 열 수 있다"** 가 **"view-history row를 성공적으로 썼다"** 에 의존하지 않게 만들기 위함이다. Phase B audit writer 패턴과 동일.

운영 모니터링은 stderr 로그 / 향후 Phase G의 logger 통합으로 한다.

### 5.3 listRecentDocuments

| Method | Path | Service | 응답 |
| --- | --- | --- | --- |
| GET | `/organizations/{id}/documents/recent?limit=N` | `listRecentDocuments` | `{ recent: [{ document, viewedAt }] }` |

내부 동작:

1. `documentViewHistory.groupBy({ by: ["documentId"], _max: { viewedAt }, orderBy: { _max: { viewedAt: "desc" } }, take: limit*5 })` — 같은 문서는 한 번만, 최신 viewedAt 기준 정렬, 권한 필터 후 부족할 가능성 대비 5배 윈도우 (최대 500).
2. groupBy 결과의 documentId 집합으로 `document.findMany`. status=Deleted / deletedAt 행은 제외. shares 조인.
3. 메모리에서 grouped 결과를 순회하며 각 문서를 `evaluateDocumentPermission`으로 검증. 권한 있는 항목만 결과에 추가, `limit` 도달 시 중단.

권한 잃은 / Deleted 문서는 silently 결과에서 누락. 같은 문서가 100번 view됐어도 결과에는 한 번만 등장.

---

## 6. Limit 파라미터 정책

`clampLimit(input)` 헬퍼 — favorites와 view-history 두 service에서 동일 구현.

| 입력 | 결과 |
| --- | --- |
| `undefined` / `null` | 20 (기본값) |
| `NaN` / `Infinity` | 20 |
| `< 1` (e.g., 0, -5) | 20 |
| `1..100` | 그 값 (정수로 floor) |
| `> 100` | 100 (clamp) |

쿼리 파라미터 `?limit=N`이 라우트에서 `Number()`로 변환된 뒤 service에 전달. 잘못된 입력은 silent fallback (기본값) — 라우트가 INVALID_INPUT을 던지지 않는다. UI 입력 실수에 너그러운 정책.

---

## 7. Audit 미기록 의도

이번 단계의 어떤 mutating 액션도 `activity_logs`에 기록하지 않는다. 즉:

* favorite PUT / DELETE: audit 미기록
* `recordDocumentView` 자체: audit 미기록 (view-history 테이블 자체가 view 기록 매체)

### 7.1 사유

| 액션 | 미기록 사유 |
| --- | --- |
| Favorite 토글 | 사용자 개인 annotation. 본문 / 권한에 영향 없음. 토글 빈도가 매우 높을 수 있어 audit 노이즈 우려. |
| view-history append | view-history 테이블 자체가 audit-equivalent "user looked at this document" 스트림. activity_logs에 동일 정보를 또 적으면 row 수가 한 자릿수 단위 폭증. |

### 7.2 Phase G 재검토 가능

규제 / 컴플라이언스 요구로 per-user favorite 또는 per-user view 트레일이 필요하면 Phase G operations 단계에서 다시 결정. 이번 단계는 **opt-in이 아닌 opt-out** 방향 — 기본은 미기록, 필요하면 추가.

이 결정은 두 service 파일의 헤더 주석에 명시되어 있어 향후 변경자가 의도를 잃지 않는다.

---

## 8. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` (10 워크스페이스) | PASS |
| `pnpm test` (vitest unit) | PASS — 6 files / 99 tests (변동 없음) |
| `pnpm test:integration` | PASS — **12 files / 166 tests** (150 → 166, +16 신규 favorites/recent 테스트) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

Step 6 코드는 `develop`에 머지되었다 (commit `193f001`, merge `0a8410d`).

### 8.1 Integration test 16 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| Favorites PUT / DELETE 권한·idempotency (View 충분 / PUT idempotent / Private NOT_FOUND incl. Admin / Deleted NOT_FOUND / cross-org NOT_FOUND / DELETE idempotent + View / DELETE no-view NOT_FOUND) | 7 |
| `listFavorites` (권한 잃으면 누락 / Deleted 누락) | 2 |
| getDocument view-history append (성공 시 append / 실패 시 미기록 / 다중 호출 다중 row) | 3 |
| `listRecentDocuments` (dedup by document / 권한+Deleted 필터 / limit 기본값/clamp / cross-org) | 4 |

Codex가 한 번에 승인 — Step 5와 같은 multi-pass 보정 라운드 없이 통과.

---

## 9. 다음 단계로 넘어가기 전 운영 주의사항

### 9.1 Route smoke test 부재

이번 단계 통합 테스트는 모두 service 직접 호출이다. Step 3 / 4 / 5 / 6에 걸쳐 누적되는 부채 — 최소 1–2개의 route smoke test (실제 HTTP 응답 확인)는 후속 Step에서 묶어 추가할 가치가 있다. 라우트는 모두 Phase B 패턴 그대로(session → service → respondError) 위험이 낮지만, 누적 부채로서 인지 필요.

### 9.2 `listFavorites` 메모리 필터링

`listFavorites`는 사용자의 모든 favorite을 fetch한 뒤 메모리에서 권한 필터링한다. 한 사용자가 10000+ favorite을 갖는 극단 케이스에선 메모리 / 응답 시간 비효율. Phase C MVP에서는 acceptable이며, 실 운영 데이터로 한 사용자당 favorite 분포를 측정한 뒤 필요하면 SQL-side 권한 필터로 이전 (Phase F 검색이 도입되면 재사용 가능).

### 9.3 `listRecentDocuments`의 limit*5 window

`limit * 5` (최대 500) 행을 fetch한 뒤 권한 필터 + dedup. 만약 사용자가 권한을 많이 잃은 문서를 많이 봤다면(예: 자기 팀 외 문서를 많이 봤지만 그 문서들이 모두 Private로 변경된 경우), 윈도우 안에서 권한 통과한 행이 limit보다 적어 결과가 limit에 미달할 수 있다.

이는 "최근 본 문서 = 지금 다시 볼 수 있는 것 위주"라는 정책의 부수효과. 사용자 경험상 "내가 옛날에 봤지만 지금 못 보는 문서"가 recent에 등장하지 않는 게 더 자연스럽다.

만약 limit 미달이 빈번하다면 윈도우 크기 조정 또는 streaming 페이징으로 escalation 가능.

### 9.4 view-history append-only / cleanup은 Phase G

같은 사용자가 같은 문서를 1000번 보면 1000개의 row가 쌓인다. listRecentDocuments는 groupBy로 dedup하지만 테이블 자체는 무한 증가. cleanup 정책 (예: 90일 이전 행 제거 / 사용자별 최근 N개만 유지)은 Phase G operations / Phase B의 cleanup-worker 결정 사항. Step 1의 schema는 추가 작업 없이 cleanup 정책을 받아들일 수 있도록 단순한 append-only 형태로 설계됨.

### 9.5 UI 없음

이번 단계는 backend API만 노출. 사용자가 실제로 즐겨찾기 별 버튼을 누르거나 "최근 본 문서" 화면을 보는 UI는 UI 단계에서 구현. 그때까지는 클라이언트(통합 테스트, curl, 관리 도구)만 이 API를 호출 가능.

### 9.6 Recent / Favorites는 한 화면에 합쳐 보일 수 있음

응답 schema가 `{ document, favoritedAt | viewedAt }` 형태로 일관되어 있어 클라이언트가 두 응답을 dropdown / sidebar의 같은 컴포넌트로 렌더링하기 쉽다. UI 결정.

---

## 10. 비개발자 요약 — 한 단락

Step 6은 사용자가 자기 계정으로 "이 문서를 즐겨찾기에 별표 표시" 와 "최근에 열어 본 문서 목록을 빠르게 다시 열어 보기" 를 할 수 있는 backend 기반을 만든 단계였다. 즐겨찾기는 같은 사용자가 같은 문서를 두 번 별표 눌러도 한 번만 기록되는 idempotent 동작이며(데이터베이스 unique 인덱스가 보장), 같은 사용자가 별표 누른 문서를 다른 사람이 비공개로 바꾸거나 삭제하면 사용자의 즐겨찾기 목록에서 자동으로 사라진다 — 사용자에게 "열려고 누르니까 안 열리네"의 혼란을 주지 않기 위함이다. "최근 본 문서"는 사용자가 문서 상세를 실제로 열어 본 경우만 기록하고(목록을 스크롤하거나 공유 패널을 본 것은 카운트되지 않는다), 같은 문서를 100번 봐도 목록에는 가장 최근 한 번만 나타난다. 권한 변화로 더 이상 못 보는 문서는 마찬가지로 자동 제외. 즐겨찾기 / view-history 모두 audit log에 기록하지 않는데, 이는 빈도가 너무 높아 의미 있는 audit 신호를 가리지 않기 위한 의도된 결정이다. UI는 다음 단계에서.

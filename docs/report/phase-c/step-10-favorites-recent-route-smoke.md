# Phase C — Step 10: 즐겨찾기 / 최근 본 문서 라우트 Smoke 테스트 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **10단계 — 즐겨찾기 / 최근 본 문서 라우트 smoke 확장**이 완료된 시점에 작성된 단계별 보고서다. Step 7 후속에서 도입된 라우트 smoke 인프라(`vi.hoisted` + `next/headers` alias stub)와 Step 8 / 9에서 documents core / shares / versions 라우트를 덮은 패턴을 그대로 이어 받아, **per-user 동작**이 핵심인 마지막 라우트 그룹(`favorites`, `favorite`, `recent`) 4개 라우트를 8 케이스로 얇게 고정한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 6 — 즐겨찾기 / 최근 본 문서 service](./step-6-favorites-recent.md) — `setFavorite`/`unsetFavorite`의 View 게이트(존재 누출 방지), `listRecentDocuments`의 dedupe + permission-filter
- [Phase C Step 7 후속 — 라우트 smoke 인프라](./step-7-route-smoke-infra.md) — `vi.hoisted` + `next/headers` alias stub 인프라
- [Phase C Step 8 — 문서 핵심 라우트 smoke](./step-8-route-smoke-core.md) — documents core 4개 라우트 smoke
- [Phase C Step 9 — 공유 / 버전 라우트 smoke](./step-9-route-smoke-shares-versions.md) — shares / versions / restore smoke

---

## 2. Step 10의 목적

Step 9까지 documents core와 권한 게이트가 복잡한 표면(shares / versions / restore)을 모두 라우트 envelope 레벨로 고정했다. 남은 라우트 그룹은 **per-user 동작이 본질**인 다음 4개다.

* **GET `/organizations/{id}/documents/favorites`** — 호출자 본인의 즐겨찾기 목록
* **PUT `/organizations/{id}/documents/{documentId}/favorite`** — 본인 기준 idempotent mark
* **DELETE `/organizations/{id}/documents/{documentId}/favorite`** — 본인 기준 idempotent unmark, 204 응답
* **GET `/organizations/{id}/documents/recent`** — 호출자 본인이 detail 라우트로 연 문서 이력

이 라우트들은 권한 분기(view-only / no-view) 자체는 단순하지만 **"내 favorite 목록에 남의 favorite이 새지 않는다"**, **"내 recent 목록은 내가 detail 라우트를 호출했을 때만 채워진다"** 처럼 userId 키로의 격리가 외부 관찰자 입장에서 envelope-level로 보장돼야 한다 — smoke가 그 격리를 고정한다. 더불어 PUT/DELETE는 idempotent 계약(같은 입력 두 번 호출 시 같은 결과)과 no-view 시 NOT_FOUND envelope 누출 방지도 같이 고정한다.

다음 단계에서 다룰 것이 아닌 것:

* invalid `limit` 파서 smoke — 현재 라우트가 strict parser가 아니라 service의 `clampLimit`이 silent clamp(NaN/음수/0 → DEFAULT_LIMIT=20). Step 10 지시에 따라 production 동작이 strict가 아닐 때는 smoke 추가 금지.
* 즐겨찾기/최근 본 문서를 잃은 view 상태에서 자동 필터링(`evaluateDocumentPermission === null` 분기) — service 단위 테스트(`document-favorites.test.ts`, `document-view-history.test.ts`)가 이미 덮음. smoke는 user-keyed isolation까지만 고정.
* favorite/recent의 audit 로깅 — Step 6에서 "favorite은 개인 annotation이라 audit 미기록" / "recent는 그 자체가 audit 등가물" 정책 결정. smoke로 검증할 audit row 없음.
* 게이트 정책 자체의 변경 — Step 10은 현재 코드를 고정만 함.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `tests/integration/document-routes-smoke.test.ts` | +249 / -0. import 3개 추가(`favoritesRoute`, `favoriteRoute`, `recentRoute`), describe 블록 4개(테스트 8개) 추가. |

### 3.2 신규 / 마이그레이션

없음. service / 라우트 / 스키마 / audit / errors 어떤 영역도 손대지 않았다 — **smoke test 확장만**.

### 3.3 보고서

| 파일 | 상태 |
| --- | --- |
| `docs/report/phase-c/step-10-favorites-recent-route-smoke.md` (본 문서) | 신규 작성 |

직전 세션에서 남긴 핸드오프 노트(`docs/report/phase-c/step-10-next-session-handoff.md`)는 untracked 상태로 남아 있으며 본 보고서와 무관하므로 **이번 commit 대상에서 분리**한다(Codex 합의).

---

## 4. 라우트별 게이트와 smoke 분포

라우트마다 게이트와 부수효과가 다르므로 happy / isolation / not-found 분기 응답이 달라진다.

| 라우트 | 게이트 | 부수효과 | 케이스 수 |
| --- | --- | --- | --- |
| GET favorites | membership only | — | 2 |
| PUT favorite | View on doc | `documentFavorite` row create-or-keep | 2 |
| DELETE favorite | View on doc | `documentFavorite` row delete-or-noop | 2 |
| GET recent | membership only | — | 2 |

GET favorites / GET recent가 **문서 View 게이트를 거치지 않는** 것이 흥미로운 점이다. service 내부에서 사용자의 favorite/view-history row를 가져온 뒤 각 문서에 대해 `evaluateDocumentPermission`을 다시 평가해 보이지 않는 문서는 결과에서 떨어트린다 — 그래서 라우트 차원에서는 "membership만 통과하면 200" 응답이 항상 정답이고, 격리는 row-set 자체의 userId 필터로 보장된다.

반대로 PUT / DELETE favorite은 **View 게이트를 강제로 통과시켜야** 한다 — 그렇지 않으면 임의 documentId를 favorite 시도하는 것만으로 그 ID가 실존하는지 / 내 권한 밖에 있는지를 200 vs NOT_FOUND로 구분할 수 있게 되어 **존재 누출 oracle**이 된다. Step 6 §Permission policy의 핵심 결정이며 smoke가 이걸 envelope 레벨로 고정한다.

### 4.1 GET favorites (2)

| 시나리오 | 액터 | 픽스처 | 기대 응답 |
| --- | --- | --- | --- |
| happy | editor | editor가 자신의 Private 문서를 favorite한 직후 | 200, `favorites[]`에 `document.id == doc.id` 포함 |
| user 격리 | editorB | editor가 Organization 문서를 favorite한 상태에서 editorB가 호출 | 200, `{ favorites: [] }` |

격리 케이스는 visibility=Organization으로 잡았다 — editorB도 그 문서에 대한 View는 있는 상태로 만들어 두면, 빈 배열은 "view 필터에 걸려서 빠진" 결과가 아니라 **"editorB의 favorite row가 0개라서"** 빠진 결과임이 확정된다. service 내부의 `evaluateDocumentPermission` 분기와 userId 키 분기를 smoke에서 명확히 분리한다.

### 4.2 PUT favorite (2)

| 시나리오 | 액터 | 문서 | 기대 응답 |
| --- | --- | --- | --- |
| happy + idempotent | editor | 본인 Private | 1차 200 `{ id, userId, organizationId, documentId, createdAt }`, 2차 200 동일 `id` |
| no-view → NOT_FOUND | editorB | editor의 Private | 404 `{ error: "NOT_FOUND" }` |

idempotency는 같은 케이스 안에서 같은 입력을 두 번 호출해 1차 응답의 `id`를 2차 응답의 `id`와 같게 검증한다. DB의 `(userId, documentId)` unique가 단일 row를 보장하므로 두 번째 호출은 신규 생성이 아니라 기존 row 반환이다 — 서비스의 `existing` 분기(`document-favorite.ts:144-146`)가 라우트 envelope까지 그대로 노출된다.

no-view 케이스에서 `requireDocumentView`가 던지는 에러는 envelope에서 **NOT_FOUND**로 매핑된다(Step 6 §Permission policy의 존재 누출 방지 — FORBIDDEN이면 그 자체가 "이 ID는 실존한다"는 신호). reason_code 누출 방지를 위해 `toEqual({ error: "NOT_FOUND" })` 정확 매칭을 사용했다.

### 4.3 DELETE favorite (2)

| 시나리오 | 액터 | 문서 | 기대 응답 |
| --- | --- | --- | --- |
| happy + idempotent | editor | 본인 Private (favorite 선행) | 1차 204 + null body, 2차 204 + null body |
| no-view → NOT_FOUND | editorB | editor의 Private | 404 `{ error: "NOT_FOUND" }` |

idempotency는 같은 케이스 안에서 favorite을 PUT으로 미리 깐 뒤 DELETE를 두 번 호출해, **존재하는 favorite을 지우는 경로**와 **존재하지 않는 favorite을 지우는 경로** 둘 다 동일하게 204 + null로 떨어지는 것을 한 번에 검증한다. `unsetFavorite`의 `deleteMany`(`document-favorite.ts:175-177`)가 row 0건이어도 throw하지 않는 silent no-op 동작이 라우트 envelope에서도 그대로 보장됨을 의미한다.

no-view 분기는 PUT과 동일 사유로 NOT_FOUND envelope. DELETE는 본문 자체에 의미 있는 데이터가 없지만 **"200 vs NOT_FOUND" oracle**을 만들지 않으려면 View 게이트가 그대로 적용돼야 한다(`document-favorite.ts` 헤더 §Permission policy).

### 4.4 GET recent (2)

| 시나리오 | 액터 | 픽스처 | 기대 응답 |
| --- | --- | --- | --- |
| happy | editor | editor가 자신의 Private 문서를 만들고 detail 라우트(`docByIdRoute.GET`)를 호출 | 200, `recent[]`에 `document.id == doc.id` 포함 |
| user 격리 | editorB | editor가 Organization 문서의 detail을 호출, editorB는 detail을 한 번도 호출하지 않음 | 200, `{ recent: [] }` |

view-history row를 만드는 방법으로 **service helper(`recordDocumentView`) 직접 호출이 아니라 실제 detail 라우트 핸들러를 호출**한 점이 핵심이다. `getDocument`(`document.ts:411`)가 `await recordDocumentView(...)`를 호출하므로 detail 라우트 응답이 200으로 떨어진 시점에 view-history row가 보장된다 — service 호출로 우회하면 라우트 어셈블리(`getCurrentSession` → `getDocument` → `recordDocumentView`)가 실제로 연결돼 있는지를 검증하지 못한다. smoke의 본질은 라우트 어셈블리 검증이므로 우회를 피했다.

격리 케이스는 favorites와 동일한 이유로 visibility=Organization을 사용 — editorB가 view 권한이 있는데도 빈 배열이 나오면 그건 **userId 키 격리** 효과지 view-filter 효과가 아니다.

---

## 5. 설계 결정

### 5.1 PUT / DELETE no-view → 404 NOT_FOUND 핀

PUT / DELETE가 no-view 시 FORBIDDEN이 아니라 NOT_FOUND로 떨어지는 것은 Step 6 §Permission policy의 **존재 누출 방지** 결정이다. service 코드(`document-favorite.ts:131-150 / :159-178`)가 `loadActiveDocumentWithShares`에서 row 자체가 안 보이거나 `requireDocumentView`에서 통과 실패하면 둘 다 같은 NOT_FOUND envelope로 떨어지도록 설계됐다. smoke는 그 결과를 `toEqual({ error: "NOT_FOUND" })`로 정확 매칭해 reason_code가 새지 않도록 고정한다. 만약 정책이 변경되어 FORBIDDEN을 노출하기로 결정되면 smoke 두 줄이 깨지고, 그게 바로 의도된 신호다.

### 5.2 per-user isolation 케이스의 visibility 선택

favorites / recent 격리 케이스에서 문서 visibility를 **Organization**으로 잡았다. Private으로 잡으면 editorB가 그 문서 자체에 View가 없으므로 빈 배열이 나와도 그게 "내 favorite/view-history가 0건이라서" 인지 "view-filter에 걸려서" 인지 구분이 안 된다 — 두 분기를 같은 케이스가 검증하면 어느 한 쪽이 깨졌을 때 신호가 흐려진다. Organization으로 두면 editorB가 View는 있는데도 빈 배열이라는 결과만 가능해지므로 격리 분기만 깨끗하게 검증된다(Codex 합의).

### 5.3 idempotency는 같은 케이스 안에서 두 번 호출

PUT/DELETE idempotency 검증을 별도 케이스로 쪼개지 않고 한 케이스 안에서 1차 / 2차 호출로 묶었다. 분리하면 픽스처가 두 배가 되고 케이스 수가 부풀어 smoke의 신호 대 비용비가 떨어진다 — Step 9의 audit row 검증을 happy 케이스 안에 같이 둔 패턴과 같은 결.

PUT 2차 호출은 `id`가 같음을 확정해 service의 `existing` 분기(신규 row 생성 X, 기존 row 반환)를 라우트 envelope에서 직접 본다. DELETE 2차 호출은 row가 없는 상태에서도 204 + null이 그대로 떨어짐을 확정해 `deleteMany`의 silent no-op이 envelope으로 노출됨을 본다.

### 5.4 recent는 service 우회 금지

view-history row를 만들기 위해 service helper(`recordDocumentView`)를 테스트가 직접 호출하는 우회를 의도적으로 피했다. 그렇게 하면 `getDocument`의 어셈블리(View 게이트 → `recordDocumentView` 호출)가 실제로 연결돼 있는지를 smoke가 검증하지 못한다 — 만약 detail 라우트의 view-history 로깅이 어떤 리팩토링에서 빠지면 smoke가 발견해야 할 회귀를 놓치게 된다.

대신 `docByIdRoute.GET`을 actor로 직접 호출한다. detail 라우트의 200 응답이 떨어진 시점에 view-history row가 보장되고, 그 시점부터 recent 라우트가 그 row를 본다 — 라우트 어셈블리의 실제 결합이 smoke 안에서 한 번 동작하게 만들었다.

### 5.5 limit strict parser smoke 미추가

지시문에 "strict parser가 production에 있으면 그것만 핀"이라 명시돼 있고, 두 라우트 모두 `Number(limitParam)` 변환 후 service `clampLimit`이 NaN/음수/0을 DEFAULT_LIMIT(20)로 silent clamp한다(`document-favorite.ts:54-60`, `document-view-history.ts:37-43`). 즉 현재 production 동작은 strict가 아니라 silent clamp이며, smoke에서 `limit=abc` → 400을 박으면 의도되지 않은 새로운 정책이 라우트로 들어가게 된다. Step 10에서는 추가하지 않는다.

`limit` 정책을 strict로 올릴지(현재 documents GET이 그렇게 되어 있다)는 별도 제품 결정이며 Step 10 범위 밖이다. 정책 변경 PR이 favorites/recent 라우트에 strict parser를 도입한다면 그 때 smoke에 400 케이스를 추가하면 된다.

### 5.6 audit row 검증 부재

Step 9에서는 restore happy 케이스가 `activity_logs` row를 확인했지만 Step 10은 audit 검증이 0건이다. 사유: Step 6에서 명시적으로 "favorite은 개인 annotation이라 audit 미기록", "recent는 view-history 테이블 자체가 audit 등가물이라 이중 기록 안 함"으로 결정됐다(`document-favorite.ts` 헤더 §Audit, `document-view-history.ts` 헤더 §Audit). smoke가 검증할 audit row가 애초에 없으므로 케이스 부재가 정상.

### 5.7 setup 픽스처 / mock 추가 없음

Step 7 후속의 `setup()` 헬퍼와 `vi.hoisted` + `vi.mock("@/lib/session")` 패턴을 그대로 재사용. 새 헬퍼 / 새 mock 0개. 신규 의존성 0개. import만 3개 추가(`favoritesRoute`, `favoriteRoute`, `recentRoute`).

---

## 6. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/tests-integration test -- document-routes-smoke.test.ts` | PASS — **44 tests** (Step 9의 36 + Step 10 신규 8) |
| `pnpm --filter @notive/tests-integration typecheck` | PASS |
| `pnpm test:integration` (전체) | PASS — **14 files / 231 tests** (223 → 231, +8 신규) |
| `pnpm typecheck` (workspace 전체) | PASS — 9개 워크스페이스 모두 clean |
| `pnpm test` (vitest unit) | PASS — 99 tests (변동 없음) |
| `git diff --check` | PASS — 출력 없음 |

본 보고서 작성 시점에 Step 10 코드는 아직 `develop`에 머지되지 않았다 — feature commit / merge / push는 사용자 명시 지시 후에만 진행한다.

### 6.1 Integration test 8 신규 케이스 분포

| 라우트 | happy | isolation | not-found | 합계 |
| --- | --- | --- | --- | --- |
| GET favorites | 1 | 1 (user 격리) | 0 | 2 |
| PUT favorite | 1 (+ idempotent) | 0 | 1 (no-view) | 2 |
| DELETE favorite | 1 (+ idempotent) | 0 | 1 (no-view) | 2 |
| GET recent | 1 | 1 (user 격리) | 0 | 2 |
| **합계** | **4** | **2** | **2** | **8** |

전체 smoke 파일은 44 케이스로 늘었다(Step 7 후속 14 + Step 8 신규 10 + Step 9 신규 12 + Step 10 신규 8).

---

## 7. 다음 단계로 넘어가기 전 운영 주의사항

### 7.1 Phase C 라우트 smoke 표면 정리

Step 7 후속 → 8 → 9 → 10으로 Phase C의 **모든 문서 라우트**가 envelope 레벨 smoke에 묶였다. 남은 작업은 외부 의존성이 있는 라우트(검색, AI 참조 등 Phase D 이후)이며, Phase C 내부에서 라우트 smoke로 추가할 표면은 더 없다. 후속 Phase에서 같은 패턴(`vi.hoisted` + alias stub + setup helper)을 이어 받아 확장하면 된다.

### 7.2 setup 픽스처 비용 추세 — 임계 도달

smoke 파일이 44 케이스가 되면서 단독 실행 시간이 약 9.3초(목격치)로 올라왔다. Step 9 보고서 §7.5에서 50+ 케이스 시 `beforeAll` + transaction rollback 전환 검토를 명시했는데, Step 10이 50을 살짝 밑돌긴 하지만 다음 Phase에서 라우트 smoke를 더 늘릴 계획이 있다면 이 시점에 fixture 공유 패턴 전환을 본격 검토할 가치가 있다. 본 Step의 범위는 아니다.

### 7.3 favorite의 View 게이트 변경 시 smoke 리뷰

§5.1에서 명시한 대로 PUT/DELETE favorite의 게이트가 View → membership-only로 완화되면(존재 누출 정책을 약화시키는 변경) smoke 두 줄이 깨진다 — no-view 케이스의 응답이 NOT_FOUND가 아니게 되기 때문이다. 정책 변경 PR이 smoke를 같이 갱신하는지 review checklist에 명시 가치 있음. Step 9의 restore 게이트와 같은 결.

### 7.4 limit parser strict 전환 가능성

§5.5에서 명시한 대로 favorites/recent의 `limit`은 현재 silent clamp 정책이다. documents GET이 strict parser를 쓰고 있어 일관성 측면에서 favorites/recent도 strict로 통일할 여지가 있다 — 그 결정이 별도 step으로 들어오면 smoke에 `limit=abc → 400 INVALID_INPUT` 케이스를 라우트별 1건씩 추가한다.

### 7.5 untracked 핸드오프 노트 처리

직전 세션에서 남긴 `docs/report/phase-c/step-10-next-session-handoff.md`는 본 step의 시작점 문서로서 역할을 다했다. 본 보고서가 Step 10 결과를 흡수했으므로 핸드오프 노트는 별도 docs commit으로 정리하거나(보관) 삭제하거나의 선택지가 있다 — 본 step의 commit에는 섞지 않는다(Codex 합의).

---

## 8. 비개발자 요약 — 한 단락

Step 10은 "별표(즐겨찾기) 누른 문서 목록 / 별표 켜기 / 별표 끄기 / 최근 본 문서 목록" 4개 화면에 대한 자동 점검표를 8건 새로 깐 단계다. 이 라우트들의 핵심은 **사용자별 격리** — 내가 별표 누른 문서가 옆자리 동료의 별표 목록에는 나타나면 안 되고, 내가 어제 본 문서가 동료의 최근 본 문서 목록에 나타나면 안 된다. 자동 점검표는 두 사용자(editor / editorB)를 같은 조직 / 같은 팀에 두고, editor가 별표를 누르거나 문서를 열어도 editorB의 목록은 빈 채로 남는지를 매번 확인한다. 별표 켜기 / 끄기는 "두 번 눌러도 한 번 누른 것과 같은 결과"라는 약속(같은 ID 반환, 같은 204 응답)이 있는데, 자동 점검표는 같은 케이스 안에서 두 번 연속 호출해 그 약속이 깨지지 않는지 본다. 또 권한이 없는 사용자가 임의로 문서 ID를 추측해 별표를 시도해도 시스템은 "그런 문서는 없다"라고 답하지(403 거부가 아님) — 만약 거부라고 답하면 그 답 자체가 "이 ID는 실존한다"는 정보가 새 나가는 셈이라, 자동 점검표는 "없다" 응답을 정확한 형태(`{"error":"NOT_FOUND"}`)로 핀해 둔다. 이번 작업은 모두 자동 점검 코드만 늘렸고 서비스 / 라우트 / 데이터베이스 어떤 코드도 손대지 않았다. 이로써 Phase C(문서 관리)의 라우트 자동 점검표는 documents core / 공유 / 변경 이력 / 별표 · 최근 본 문서까지 한 파일에 44건이 모이며, Phase D 이후 화면이 늘어나도 같은 패턴으로 점검표를 확장할 수 있는 기반이 마련됐다.

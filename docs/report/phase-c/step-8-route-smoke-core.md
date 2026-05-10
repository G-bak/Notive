# Phase C — Step 8: 문서 핵심 라우트 Smoke 테스트 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **8단계 — 문서 핵심 라우트 smoke 테스트 확장**이 완료된 시점에 작성된 단계별 보고서다. Step 7 후속(`411498b`)에서 깔린 라우트 smoke 인프라(`vi.hoisted` + `next/headers` alias stub)를 재사용해 `documents` core 4개 라우트(POST / GET detail / PATCH / DELETE)의 envelope를 service 계층과는 독립적으로 고정한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md)
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md)
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — `getDocument` / `updateDocument` / `deleteDocument`, Deleted = NOT_FOUND, idempotent delete leak fix
- [Phase C Step 6 — 즐겨찾기 / 최근 문서](./step-6-favorites-recent.md) — §9.1에서 라우트 smoke 부재를 누적 부채로 명시

Step 7 두 작업(tags & filters / route smoke 인프라)은 별도 보고서로 분리되지 않은 채 `develop`에 통합됐다. 본 보고서는 그 인프라가 누락 보고를 의미하지 않음을 부연하기 위해 Step 8 단독 결과만 다룬다.

---

## 2. Step 8의 목적

Step 6 §9.1에서 명시한 부채 — "Step 3/4/5/6 통합 테스트는 모두 service 직접 호출이라 실제 HTTP envelope를 고정하지 못한다" — 의 1차 상환이다. Step 7 후속에서 `documents` list / `tags` / `documents/[id]/tags` 라우트는 이미 smoke로 덮였다. Step 8은 그 다음으로 위험도가 가장 높은 **문서 핵심 4개 라우트**에 집중한다.

* **POST `/organizations/{id}/documents`** — 문서 생성 happy / Viewer 거부.
* **GET `/organizations/{id}/documents/{documentId}`** — 상세 조회 happy / no-view 404 / cross-org 404.
* **PATCH `/organizations/{id}/documents/{documentId}`** — 수정 happy / view-only 거부.
* **DELETE `/organizations/{id}/documents/{documentId}`** — 삭제 happy / view-only 거부 / no-view 404.

다음 단계에서 다룰 것이 아닌 것:

* shares / versions / favorites / recent 라우트 smoke (별도 follow-up — 같은 인프라로 1회 더 확장)
* 라우트 본체 / service 코드 변경 (이번 단계는 테스트 파일만 수정)
* invalid input 검증(empty title, malformed JSON 등) — "route validation smoke"로 별도 묶음 권장
* UI / 클라이언트 호출 통합

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `tests/integration/document-routes-smoke.test.ts` | +228 / -1. import 한 줄 추가(`docByIdRoute`), describe 블록 4개(테스트 10개) 추가. |

### 3.2 신규 / 삭제 / 마이그레이션

없음. 서비스 / 라우트 / 스키마 / audit / errors 어떤 영역도 손대지 않았다. **테스트만 추가하는 단계**다.

---

## 4. 라우트별 smoke 매트릭스

### 4.1 POST `/organizations/{id}/documents` (2 케이스)

| 시나리오 | 액터 | 입력 | 기대 응답 |
| --- | --- | --- | --- |
| happy | Editor | `{ title, documentType, visibility:"Private" }` | 201, `{ ownerUserId: editor, status:"Draft", visibility:"Private" }` |
| Viewer 거부 | Viewer | `{ title, documentType }` | 403 `FORBIDDEN(document_create_not_allowed)` |

Phase C plan §8.2의 "Viewer는 문서를 만들 수 없다" 정책이 라우트 envelope에서도 그대로 노출됨을 고정.

### 4.2 GET `/organizations/{id}/documents/{documentId}` (3 케이스)

| 시나리오 | 액터 | 문서 | 기대 응답 |
| --- | --- | --- | --- |
| happy | owner Editor | Private | 200, `{ id, ownerUserId, permission:"Manage" }` |
| no-view | editorB (별도 Editor) | Private (다른 사용자 소유) | 404 `{ error:"NOT_FOUND" }` (reason_code 없음) |
| cross-org | outsider org Admin | Organization (남의 org) | 404 `{ error:"NOT_FOUND" }` (reason_code 없음) |

Phase A §15의 "권한 없는 자원의 존재를 알리지 않는다" 정책이 라우트 envelope까지 일관됨을 고정.

### 4.3 PATCH `/organizations/{id}/documents/{documentId}` (2 케이스)

| 시나리오 | 액터 | 문서 | 입력 | 기대 응답 |
| --- | --- | --- | --- | --- |
| happy | owner Editor | Private | `{ title:"patched-title" }` | 200, `{ id, title:"patched-title" }` |
| view-only 거부 | editorB | Organization (남의 소유) | `{ title:"hijacked" }` | 403 `FORBIDDEN(document_edit_not_allowed)` |

조직 공개(visibility=Organization)인 남의 문서에 대해 다른 Editor는 View 권한만 갖는다는 Step 2 정책 결과가 라우트에서도 유지됨.

### 4.4 DELETE `/organizations/{id}/documents/{documentId}` (3 케이스)

| 시나리오 | 액터 | 문서 | 기대 응답 |
| --- | --- | --- | --- |
| happy | owner Editor | Private | 200, `{ id, status:"Deleted", deletedAt: 비-null }` |
| view-only 거부 | editorB | Organization | 403 `FORBIDDEN(document_manage_not_allowed)` |
| no-view | editorB | Private | 404 `{ error:"NOT_FOUND" }` (reason_code 없음) |

Step 3의 "view 게이트 통과 여부에 따라 403 vs 404 분기" — Manage 부족은 403, View 부족은 404 — 라우트 envelope에서 분리 고정.

---

## 5. 설계 결정

### 5.1 DELETE happy path은 200, 204 아님

`apps/web/app/api/organizations/[id]/documents/[documentId]/route.ts:65`의 DELETE 핸들러는 soft-delete된 row를 그대로 직렬화해 `NextResponse.json(serialize(doc))`로 반환한다. 따라서 happy path 상태 코드는 **200**이며 본문에 `status:"Deleted"`, `deletedAt: ISO 문자열`이 포함된다. 204를 기대하는 어서션은 의도적으로 사용하지 않았다.

대조: tags DELETE 라우트(`tagDeleteRoute.DELETE`)는 204 No Content를 반환한다. 라우트별 응답 코드 차이를 smoke가 분리해 보존한다.

### 5.2 NOT_FOUND envelope의 deep-equal 어서션

NOT_FOUND envelope에 `reason_code`가 추가되면 정보 누설(존재 오라클)이 된다. 이를 다음과 같이 강하게 고정:

```ts
expect(r.body).toEqual({ error: "NOT_FOUND" });
```

`toMatchObject`는 부분 매칭이라 `reason_code` 추가가 통과해 버린다. `toEqual`(deep equality)을 쓰면 어떤 추가 키도 실패시키므로 envelope 자체가 굳어진다. Codex 검토 의견 1번에서 "expect.not.toHaveProperty 보다 더 강하게 envelope를 고정한다"고 채택.

### 5.3 view-only 시뮬레이션 패턴

별도 share row를 만들지 않고 **visibility=Organization인 남의 문서**를 활용한다:

* owner = editor가 organization-public 문서를 만든다.
* 액터를 editorB(같은 조직, 같은 팀의 별도 Editor)로 바꾼다.
* `evaluateDocumentPermission` 결과: View only (조직 공개로 inherited), Edit / Manage 없음.

이 패턴은 Step 7 후속의 PUT tags smoke에서 도입돼 검증된 방식이다. 추가 픽스처가 없어 setup이 단순하고, 권한 매트릭스 변경 시 단일 진입점(Step 2 정책)에서 결과가 자동 갱신된다.

### 5.4 setup 픽스처 재사용

Step 7 후속이 만든 `setup()` 헬퍼(admin / editor / editorB / manager / viewer / outsider × 1 org)를 그대로 재사용했다. 새 사용자나 픽스처를 추가하지 않았으므로 신규 테스트 추가로 인한 런타임 증가는 미미(수 백 ms 단위, embedded-postgres bootstrap 비용 대비 무시 가능).

### 5.5 mock / stub 추가 없음

`vi.hoisted` 상태 슬롯, `next/headers` alias stub, `@/lib/session` mock 모두 Step 7 후속 그대로다. 신규 mock 0개. service / route 코드는 import만 추가했고 동작 변경 없음.

---

## 6. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/tests-integration test document-routes-smoke` | PASS — 24 tests (기존 14 + 신규 10) |
| `pnpm --filter @notive/tests-integration typecheck` | PASS |
| `pnpm test:integration` (전체) | PASS — **14 files / 211 tests** (201 → 211, +10 신규) |
| `pnpm typecheck` | PASS |
| `pnpm test` (vitest unit) | PASS — 99 tests (변동 없음) |
| `git diff --check` | PASS |

Step 8 코드는 `develop`에 머지되었다 (commit `bd3f341`, merge `981771e`, push `5422e86..981771e develop -> develop`).

### 6.1 Integration test 10 신규 케이스 분포

| 라우트 | happy | denial | not-found | 합계 |
| --- | --- | --- | --- | --- |
| POST documents | 1 | 1 (Viewer 403) | 0 | 2 |
| GET documents/[id] | 1 | 0 | 2 (no-view + cross-org) | 3 |
| PATCH documents/[id] | 1 | 1 (view-only 403) | 0 | 2 |
| DELETE documents/[id] | 1 | 1 (view-only 403) | 1 (no-view 404) | 3 |
| **합계** | **4** | **3** | **3** | **10** |

전체 smoke 파일은 24 케이스로 늘었다(Step 7 후속 14 + Step 8 신규 10). Codex 검토에서 blocker 없이 한 번에 통과했다.

---

## 7. 다음 단계로 넘어가기 전 운영 주의사항

### 7.1 남은 라우트 smoke 부채

이번 단계로 documents core 4개 라우트가 덮였다. 동일 인프라 위에서 다음 그룹은 **별도 follow-up Step**으로 묶기를 권한다:

* `shares` GET / PUT
* `versions` GET list / GET preview / POST restore
* `favorites` GET / `[documentId]/favorite` PUT/DELETE / `recent` GET

각 그룹의 smoke 케이스는 평균 2–4개로 추정되며 한 번의 follow-up에 모두 묶어도 파일 1개의 길이가 통제 가능 범위(~700 라인)다. 분할 vs 일괄은 Codex 판단.

### 7.2 invalid input smoke는 별도 묶음 권장

이번에 PATCH 빈 title, POST 누락 필드 등 input 검증 envelope는 다루지 않았다. 라우트 본체의 zod 검증이 INVALID_INPUT(400) envelope를 일관되게 내는지 한 번에 묶는 "route validation smoke" 단계가 자연스럽다. Step 7 후속에서 list 라우트의 query 검증은 이미 다룬 바 있다 — body 검증을 그 패턴으로 확장.

### 7.3 happy path 데이터 검증의 표면적

happy 케이스는 envelope의 핵심 키(`id`, `ownerUserId`, `status`, `visibility`, `permission`)만 검증한다. 모든 필드를 deep-equal로 굳히면 사소한 직렬화 변경(예: `createdAt` 추가/제거)에 대해 너무 엄격해진다. 직렬화 형태의 정확성은 service 단위 테스트 / 실제 클라이언트 통합에 위임.

### 7.4 view-only 시뮬레이션의 한계

§5.3의 패턴은 organization-public 문서의 inherited View 케이스만 다룬다. **share row를 통해 명시적으로 Edit를 부여받은 케이스 / Team-level visibility 케이스**는 별도 케이스로 남는다. shares smoke follow-up 시 함께 추가될 예정.

### 7.5 setup 비용

각 `it`이 `setup()`을 호출해 픽스처를 새로 만든다. embedded-postgres + 6 user / 2 org / 1 team 생성에 ~150–400 ms 소요. 24 케이스 × 평균 ~225 ms = ~5.4초가 smoke 파일 단독 실행 시간이다. 향후 케이스가 30+ 개로 늘면 `beforeAll`로 픽스처를 1회 만들고 transaction rollback / soft state reset 패턴으로 전환을 검토.

---

## 8. 비개발자 요약 — 한 단락

Step 8은 문서 만들기 / 보기 / 수정하기 / 삭제하기 4개 API를 실제 HTTP 호출 형태로 가짜 사용자를 끼워서 두드려 보고, 응답 코드와 본문 모양이 정책대로 나오는지 자동 점검표를 새로 10건 깐 단계다. 점검 항목은 다음을 포함한다 — Viewer 권한 사용자가 문서를 만들려고 하면 단순히 화면에 막히는 것이 아니라 서버가 403으로 거부해야 하고, 다른 조직 사용자가 남의 문서를 열어 보려 하면 "이 문서가 없다"는 응답만 받지 "이 문서가 있긴 한데 권한이 없다"는 정보가 새지 않아야 하며, 보기만 가능한 사용자가 수정하려 하면 403, 같은 사용자가 삭제하려 하면 그 역시 403, 그러나 처음부터 보지도 못하는 비공개 문서를 삭제하려 하면 404가 나와야 한다. 이 점검들은 모두 통과했고, 서비스 / 라우트 / 데이터베이스 어떤 코드도 손대지 않은 채 테스트 파일 한 개에만 변경이 들어갔다(228줄 추가, 1줄 수정). 다음 단계에서는 같은 방식으로 공유 / 버전 / 즐겨찾기 라우트도 동일 점검표에 묶을 예정이다.

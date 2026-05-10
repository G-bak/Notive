# Phase C — Step 9: 공유 / 버전 라우트 Smoke 테스트 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **9단계 — 공유 / 버전 라우트 smoke 확장**이 완료된 시점에 작성된 단계별 보고서다. Step 7 후속에서 도입된 라우트 smoke 인프라(`vi.hoisted` + `next/headers` alias stub)와 Step 8에서 documents core 4개 라우트를 덮은 패턴을 그대로 이어 받아, 권한 분기가 가장 복잡한 표면(`shares`, `versions`, `restore`) 5개 라우트를 12 케이스로 얇게 고정한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 4 — 문서 공유 API](./step-4-document-sharing-api.md) — `replaceDocumentShares` Manage 게이트, replace-all 정책
- [Phase C Step 5 — 문서 버전 이력](./step-5-document-versions.md) — `restoreDocumentVersion` Edit 게이트, max+1 versionNumber, version_conflict 정책
- [Phase C Step 7 후속 — 라우트 smoke 인프라](./step-7-route-smoke-infra.md) — `vi.hoisted` + `next/headers` alias stub 인프라
- [Phase C Step 8 — 문서 핵심 라우트 smoke](./step-8-route-smoke-core.md) — documents core 4개 라우트 1차 확장

---

## 2. Step 9의 목적

Step 8이 documents core(POST / GET detail / PATCH / DELETE)를 덮었지만 **권한 분기가 가장 복잡한 라우트들**은 여전히 service 직접 호출 통합 테스트만 갖는다. Step 4 / 5에서 도입된 다음 5개 라우트가 이번 단계의 대상이다.

* **GET / PUT `/organizations/{id}/documents/{documentId}/shares`** — Manage 게이트
* **GET `/organizations/{id}/documents/{documentId}/versions`** — View 게이트
* **GET `/organizations/{id}/documents/{documentId}/versions/{versionId}`** — View 게이트
* **POST `/organizations/{id}/documents/{documentId}/versions/{versionId}/restore`** — **Edit** 게이트 + audit 기록

각 라우트가 다른 게이트를 사용하므로, 같은 view-only 액터에 대해 서로 다른 reason_code를 반환해야 한다 — smoke로 이 분기를 envelope 레벨에서 고정한다.

다음 단계에서 다룰 것이 아닌 것:

* favorites / recent 라우트 smoke (Step 10 / 차기 follow-up — per-user 동작이라 분리)
* shares PUT의 `targetType: "Team"` / `"Organization"` happy 케이스 (target validation 세부, follow-up step에 적합)
* invalid input smoke(누락 필드, 잘못된 enum 값 등) — body validation smoke로 별도 묶음
* 게이트 정책 자체의 변경 (restore Edit vs Manage 등) — Step 9는 현재 코드를 고정만 함

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `tests/integration/document-routes-smoke.test.ts` | +319 / -1. import 5개 추가(`sharesRoute`, `versionsListRoute`, `versionPreviewRoute`, `versionRestoreRoute`, `updateDocument`), describe 블록 5개(테스트 12개) 추가. |

### 3.2 신규 / 마이그레이션

없음. service / 라우트 / 스키마 / audit / errors 어떤 영역도 손대지 않았다 — **smoke test 확장만**.

---

## 4. 라우트별 권한 게이트와 smoke 분포

라우트마다 게이트가 다르므로 view-only / no-view 분기 응답이 달라진다. smoke가 그 분기를 envelope에서 직접 고정한다.

| 라우트 | 게이트 | 출처(라인) | 케이스 수 |
| --- | --- | --- | --- |
| GET shares | `requireDocumentManage` | `document-share.ts:226` | 3 |
| PUT shares | `requireDocumentManage` | `document-share.ts:256` | 2 |
| GET versions list | `requireDocumentView` | `document-version.ts:218` | 2 |
| GET version preview | `requireDocumentView` | `document-version.ts:246` | 2 |
| POST restore | `requireDocumentEdit` | `document-version.ts:295` | 3 |

### 4.1 shares GET — Manage required (3)

| 시나리오 | 액터 | 문서 | 기대 응답 |
| --- | --- | --- | --- |
| happy | owner Editor | Private | 200, `{ shares: [] }` |
| view-only | editorB | Organization (다른 사람 소유) | 403 `FORBIDDEN(document_manage_not_allowed)` |
| no-view | editorB | Private | 404 `{ error:"NOT_FOUND" }` |

shares **list**가 View가 아닌 **Manage**를 요구하는 점이 핵심이다. 같은 문서를 볼 수 있는 사용자도 그 문서의 share grant 목록은 못 본다 — 누가 누구에게 어떤 권한을 줬는지가 그 자체로 민감 정보이기 때문. Step 4 §6의 정책 결정.

### 4.2 shares PUT — Manage required (2)

| 시나리오 | 액터 | 문서 | 입력 | 기대 응답 |
| --- | --- | --- | --- | --- |
| happy | owner Editor | Private | `{ shares: [{ targetType:"User", targetId: editorB.id, permission:"Edit" }] }` | 200, shares 배열에 신규 entry |
| view-only | editorB | Organization | (위와 동일 입력) | 403 `FORBIDDEN(document_manage_not_allowed)` |

`targetType:"User"`만 happy 케이스로 고정. `Team` / `Organization` target은 사전 픽스처(team row / org row가 다른 픽스처여야 하거나 cross-org 검증 분기)를 더 요구해 smoke 범위를 키운다 — share target validation의 세부 테스트로 분리하는 게 적절(Codex 합의).

### 4.3 versions list / preview — View required (각 2)

| 라우트 | 시나리오 | 액터 | 기대 응답 |
| --- | --- | --- | --- |
| GET versions | happy | owner Editor | 200, `versions[]`에 `{versionNumber: 1}` 포함 |
| GET versions | no-view | editorB on Private | 404 `{ error:"NOT_FOUND" }` |
| GET version preview | happy | owner Editor | 200, `{ titleSnapshot, contentSnapshot }`이 v1 본체와 일치 |
| GET version preview | no-view | editorB on Private | 404 `{ error:"NOT_FOUND" }` |

view-only 분기 케이스는 의도적으로 생략 — View 게이트는 view-only도 통과하므로 happy / no-view 두 갈래만 의미 있는 envelope 분기다.

### 4.4 restore POST — Edit required (3) + audit

| 시나리오 | 액터 | 픽스처 | 기대 응답 |
| --- | --- | --- | --- |
| happy | owner Editor | createDocument(v1) → updateDocument(v2) | 200, `document.{title,content}`가 v1으로 복귀, `newVersion.versionNumber == 3`, `activity_logs` row 1건(`metadata.{restoredFromVersionNumber:1, newVersionNumber:3}`) |
| view-only | editorB | Organization | 403 `FORBIDDEN(document_edit_not_allowed)` |
| no-view | editorB | Private | 404 `{ error:"NOT_FOUND" }` |

happy 케이스의 `versionNumber == 3` 검증은 **Step 5의 max+1 정책이 라우트 envelope까지 그대로 유지됨**을 확인한다 — restore가 새 versionNumber를 발급하는 방식(작은 숫자 재사용 X)이 Step 5의 `version_conflict` 정책 근간이다.

---

## 5. 설계 결정

### 5.1 restore의 Edit 게이트 — Manage 아님

지시문에 "Manage required, View required"로 적혀 있었으나 service 코드(`document-version.ts:295`)는 `requireDocumentEdit`를 사용한다. 코드와 주석 모두 명시적이라 **smoke는 현재 코드(Edit)를 그대로 고정**했다 — view-only 액터의 reason_code가 `document_edit_not_allowed`로 나오는 것이 그 결과.

정책을 Manage로 올릴지는 별도 제품/권한 결정이며 Step 9 범위 밖이다(Codex 검토에서 동일 합의). 만약 정책이 변경되면 smoke 1줄만 바뀐다(`document_edit_not_allowed` → `document_manage_not_allowed`) — 게이트와 envelope의 결합이 한 곳에 고정되어 있어 변경 비용이 명확.

### 5.2 audit row 검증의 깊이

`restore` happy 케이스는 `prisma.activityLog.findFirst`로 가장 최근 row를 조회한 뒤 `toMatchObject({ restoredFromVersionNumber:1, newVersionNumber:3 })`로 핵심 metadata만 고정한다.

대안으로 `count` 비교(정확히 1건만 emit)를 검토했지만 **smoke 목적보다 빡빡함**:

* 같은 픽스처 빌드 과정에서 `updateDocument`가 v2 audit row를 별도로 emit한다(`DOCUMENT_UPDATED`).
* 다른 픽스처가 같은 `targetId`로 audit를 남기는 미래 변경에 부서지기 쉽다.
* smoke의 본질은 "올바른 row가 emit됐는가"이지 "다른 row가 없는가"가 아니다.

따라서 `findFirst` + metadata `toMatchObject`로 충분(Codex 합의).

### 5.3 `Actions.DOCUMENT_VERSION_RESTORED` 상수 vs 리터럴

audit 검증에서 상수 import가 아니라 리터럴 `"document.version_restored"`를 직접 비교한다.

```ts
where: { action: "document.version_restored", ... }
```

의도: smoke가 "audit 상수와 emit 코드가 같이 동작한다"가 아니라 "**HTTP 외부 관찰자 입장에서** audit 테이블에 의도한 문자열이 적힌다"를 검증. 상수가 변경되면 smoke가 깨지고, 그게 바로 의도된 신호다. 라우트 본체가 어떤 import를 쓰든 외부에서 본 결과는 같아야 한다.

### 5.4 view-only 시뮬레이션 패턴 그대로

Step 7 후속 / Step 8과 동일 — owner = editor가 visibility=Organization 문서를 만들고 액터를 editorB(같은 조직, 같은 팀의 별도 Editor)로 바꾼다. organization-public이 inherited View만 부여하므로 editorB는 Edit / Manage 모두 부족. 신규 픽스처 / share row 0개.

### 5.5 setup 픽스처 / mock 추가 없음

Step 7 후속의 `setup()` 헬퍼와 `vi.hoisted` + `vi.mock("@/lib/session")` 패턴을 그대로 재사용. 새 헬퍼 / 새 mock 0개. 신규 의존성 0개.

### 5.6 PUT shares targetType의 단일 케이스

happy 케이스는 `targetType:"User"` 1건만 다룬다. `Team` / `Organization` target은 별도 사전 픽스처(team / org row)와 cross-org targetId 검증이 추가로 필요해 smoke 범위 초과. share target 검증 세부는 service 단위 테스트(Step 4의 `document-sharing.test.ts`)가 이미 덮고 있다.

---

## 6. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/tests-integration test document-routes-smoke` | PASS — 36 tests (24 + 12 신규) |
| `pnpm --filter @notive/tests-integration typecheck` | PASS |
| `pnpm test:integration` (전체) | PASS — **14 files / 223 tests** (211 → 223, +12 신규) |
| `pnpm typecheck` | PASS |
| `pnpm test` (vitest unit) | PASS — 99 tests (변동 없음) |
| `git diff --check` | PASS |

Step 9 코드는 `develop`에 머지되었다 (commit `10bde64`, merge `e61df92`, push `1b0a521..e61df92 develop -> develop`).

### 6.1 Integration test 12 신규 케이스 분포

| 라우트 | happy | denial | not-found | 합계 |
| --- | --- | --- | --- | --- |
| GET shares | 1 | 1 (view-only 403) | 1 | 3 |
| PUT shares | 1 | 1 (view-only 403) | 0 | 2 |
| GET versions list | 1 | 0 | 1 | 2 |
| GET version preview | 1 | 0 | 1 | 2 |
| POST restore | 1 (+ audit row 검증) | 1 (view-only 403) | 1 | 3 |
| **합계** | **5** | **3** | **4** | **12** |

전체 smoke 파일은 36 케이스로 늘었다(Step 7 후속 14 + Step 8 신규 10 + Step 9 신규 12). Codex 검토에서 blocker 없이 한 번에 통과했다.

---

## 7. 다음 단계로 넘어가기 전 운영 주의사항

### 7.1 favorites / recent는 Step 10으로 분리

남은 라우트 그룹 — `documents/favorites` GET / `documents/[documentId]/favorite` PUT/DELETE / `documents/recent` GET — 은 **per-user 동작**이라 Step 9의 권한 분기와 결이 다르다. 같은 단계에 묶으면 setup 픽스처에 favorite row pre-seed가 추가되고 idempotency 검증 케이스가 늘어 smoke의 의미가 흐려진다. Step 10으로 분리(Codex 추천 순서).

### 7.2 share target type 다양화는 별도 step

`Team` / `Organization` target 검증은 service 단위 테스트가 이미 충실히 덮는다. 라우트 smoke로는 단일 happy + 권한 분기만 충분. 만약 미래에 share target validation 자체가 라우트 레이어로 이동하거나 invalid target에 대한 envelope이 새로운 reason_code를 갖게 되면 그 때 별도 smoke step에서 다룬다.

### 7.3 audit row 검증의 부수효과

`activity_logs` 테이블에 row가 쌓이는 smoke 케이스가 처음 등장했다. 같은 테이블을 보는 다른 통합 테스트(`document-versions.test.ts` 등)에 영향 없는지는 확인됐다 — 각 케이스가 새 organization을 만들기 때문에 `organizationId` 필터로 격리됨. 향후 모든 케이스에서 audit를 검증하는 패턴으로 확장하려면 setup이 더 무거워지므로 의도적 자제.

### 7.4 restore 게이트 변경 시 smoke 리뷰

§5.1에서 명시한 대로 restore의 게이트가 Edit → Manage로 변경되면 smoke 1줄만 바뀐다 — 라우트 본체와 service의 게이트 호출 변경에 따라 reason_code 어서션도 함께 갱신해야 함. 정책 변경 PR이 smoke를 같이 수정하는지 review checklist로 명시 가치 있음.

### 7.5 setup 픽스처 비용 추세

smoke 파일의 단독 실행 시간은 현재 수 초대로 유지된다. Step 10 추가로 50+ 케이스가 되면 `beforeAll` + transaction rollback 패턴 전환을 본격 검토할 시점이 된다.

---

## 8. 비개발자 요약 — 한 단락

Step 9는 문서를 다른 사람과 공유하는 화면 / 누가 언제 무엇을 수정했는지 보는 변경 이력 화면 / 옛날 버전으로 되돌리는 동작에 대한 자동 점검표를 12건 새로 깐 단계다. 이 라우트들은 라우트마다 요구하는 권한 등급이 달라서, 같은 사용자가 같은 문서에 들어와도 — 본문은 보이지만 공유 목록은 안 보이고(공유 목록은 "관리자급" 권한 필요), 변경 이력은 보이지만 되돌리기 버튼은 못 누르는 식으로 — 권한별로 응답이 갈라진다. 자동 점검표는 이 갈라짐이 정확히 정책대로 일어나는지(403 거부 코드와 그 사유가 라우트마다 정확히 무엇인지, 권한이 아예 없는 사람에게는 "이 문서가 없다"로 응답하는지)를 점검한다. 옛 버전으로 되돌리는 동작은 데이터베이스의 활동 로그 테이블에 "누가 언제 어떤 버전으로 되돌렸다"는 기록이 자동으로 남게 되어 있는데, 이번 점검표는 그 기록이 실제로 남는지, 어떤 메타데이터(어느 버전에서 어느 새 버전으로 갔는지)가 적히는지까지 확인한다. 이번 작업은 모두 자동 점검 코드만 늘렸고 서비스 / 라우트 / 데이터베이스 어떤 코드도 손대지 않았다. 다음 단계에서는 즐겨찾기 / 최근 본 문서 라우트도 같은 방식으로 점검표에 묶을 예정이다.

# Phase C — Step 4: 문서 공유 API 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **4단계 — 문서 공유 API**가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1의 `document_shares` 테이블을 처음으로 클라이언트에 노출하는 단계로, 공유 목록을 조회하고 갱신하는 두 개의 API를 추가한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md) — `document_shares` 테이블, polymorphic `target_id` 컬럼
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md) — `requireDocumentManage` 등 권한 helper
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — service / route / audit 패턴, Deleted = NOT_FOUND 정책

---

## 2. Step 4의 목적

Step 1은 공유를 보관할 `document_shares` 테이블을 만들었다. Step 2의 `evaluateDocumentPermission`은 이미 share 행을 읽어 권한 결정에 사용하고 있다. 그러나 사용자가 share를 **추가하거나 변경할 길**은 아직 없었다 — Step 3의 create/update payload가 share 필드를 받지 않도록 명시적으로 차단했기 때문이다.

Step 4의 목적은 다음과 같다.

* **2개의 API**(GET / PUT shares)를 노출한다.
* 공유 조회와 변경 모두 **Manage 권한이 필요**하도록 설정한다.
* `target_id`의 폴리몰픽 값(User / Team / Organization)을 **service 레이어에서 검증**한다 — DB는 이 폴리몰픽 관계에 외래 키를 걸 수 없어 application 책임.
* PUT은 **replace-all** 의미: 요청 본문이 새 완전 상태가 되며, 기존 행은 적절히 추가 / 갱신 / 삭제된다.
* **Department 금지** 정책을 코드 레벨에서 강제한다(zod enum).
* mutating 액션은 `apps/web/lib/audit`로 기록한다.

다음 단계에서 다룰 것이 아닌 것:

* 공유 UI / 공유 패널
* DB 스키마 / 마이그레이션 변경
* 버전 복원 / 즐겨찾기 / 최근 본 문서 / 검색 / AI 연동
* route smoke test (서비스 직접 호출만 커버; 후속 Step에서 보강)

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (3개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/document-share.ts` | ~265 라인. 2개 서비스 함수 + zod 스키마 + target 검증 헬퍼. Step 2 권한 모듈 100% 위임. |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/shares/route.ts` | GET (list) + PUT (replace). |
| `tests/integration/document-sharing.test.ts` | ~410 라인, **17 통합 테스트 케이스**. |

### 3.2 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `apps/web/lib/audit/index.ts` | `Actions.DOCUMENT_SHARES_UPDATED = "document.shares_updated"` 추가. |

DB schema / migration / UI 어떤 영역도 이번 단계에서 손대지 않았다.

---

## 4. 2개의 API 라우트

| Method | Path | Service | 응답 |
| --- | --- | --- | --- |
| GET | `/organizations/{id}/documents/{documentId}/shares` | `listDocumentShares` | `{ shares: [...] }` |
| PUT | `/organizations/{id}/documents/{documentId}/shares` | `replaceDocumentShares` | `{ shares: [...] }` (새 상태) |

라우트는 Step 3 패턴 그대로 — `getCurrentSession(cookies()) → service 호출 → respondError(err)`. 비즈니스 로직 0줄. 응답 직렬화(`serialize(s)`)는 한 함수에 모았다.

---

## 5. 서비스 레이어 — 2개 entry point

### 5.1 `listDocumentShares`

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | `requireMembership` → Deleted 차단 → `requireDocumentManage` |
| 출력 | 해당 문서의 share 행 배열 |
| 실패 응답 | NOT_FOUND (cross-org / Deleted / no view) 또는 FORBIDDEN(`document_manage_not_allowed`) (View / Edit만 보유) |

### 5.2 `replaceDocumentShares`

| 항목 | 정책 |
| --- | --- |
| 권한 게이트 | 위와 동일 |
| 입력 검증 | zod schema → 중복 (targetType, targetId) 차단 → target 별 존재/조직 검증 |
| 동작 | `prisma.$transaction` 안에서 `deleteMany` (전체 삭제) → `createMany` (새 set 삽입) → `findMany` (결과 반환) |
| Audit | metadata `{ added, updated, removed, total }` — pre-replace 단계에서 옛 행과 새 행을 (targetType, targetId) 키로 비교한 diff |
| 출력 | 새 share 행 배열 (정렬: targetType ASC, targetId ASC) |

---

## 6. 공유 read/write 모두 Manage가 필요한 이유

`listDocumentShares`도 read 작업이지만 **Manage 권한**을 요구한다. 이유는 다음과 같다.

* share 목록 자체가 **"누가 이 문서에 접근권한을 갖는가"** 라는 민감 정보다. View 사용자가 "이 문서에 누구누구가 공유받았다"를 알면 그 자체로 사용자 관계가 노출된다.
* write API와 같은 게이트를 적용하면 권한 분기 로직이 단순해진다 — `requireDocumentManage`만 호출하면 된다.
* "공유는 owner / manager / Admin이 관리하는 영역" 이라는 Phase C 계획서 §8.2의 정책과 일치한다.

결과:

| 사용자 | listDocumentShares | replaceDocumentShares |
| --- | --- | --- |
| Owner | OK (Manage) | OK |
| Author (owner와 분리, share 없음) | NOT_FOUND (View 자체는 있지만 share read도 Manage 필요) | NOT_FOUND |
| Manager + visibility=Team + 본인 팀 | OK (Manage) | OK |
| Manager + 다른 팀 / 다른 visibility | NOT_FOUND | NOT_FOUND |
| Manage-share 보유자 | OK | OK |
| Edit-share 보유자 | FORBIDDEN(`document_manage_not_allowed`) | FORBIDDEN |
| View-share 보유자 / visibility=Organization 사용자 | FORBIDDEN | FORBIDDEN |
| Admin (explicit grant 없음) | NOT_FOUND on Private | NOT_FOUND |
| Cross-org 사용자 | NOT_FOUND | NOT_FOUND |
| Deleted 문서 | NOT_FOUND | NOT_FOUND |

NOT_FOUND vs FORBIDDEN 구분: 사용자가 **View 권한 자체가 있으면** FORBIDDEN(`document_manage_not_allowed`) — 문서의 존재는 알아도 공유 관리 권한은 없음. **View 권한도 없으면** NOT_FOUND — 존재 누설 방지.

---

## 7. Target 검증 정책

`document_shares.target_id` 컬럼은 `targetType`에 따라 `users.id` / `teams.id` / `organizations.id` 중 하나를 가리키는 **폴리몰픽** 컬럼이다. DB는 이 관계에 외래 키를 걸 수 없다. 따라서 **service 레이어 검증이 cross-org 누설 방지의 마지막 방어선**이다.

### 7.1 허용 범위

zod schema가 다음만 허용:

* `targetType ∈ {"User", "Team", "Organization"}`
* `permission ∈ {"View", "Edit", "Manage"}`
* `targetId`: UUID 문자열

`targetType=Department` 같은 시도는 zod 단계에서 INVALID_INPUT으로 거부된다. **Phase A §15의 Department → Team 통합 정책을 코드 레벨에서 강제**.

### 7.2 동일 조직 검증

| targetType | 검증 |
| --- | --- |
| `User` | 같은 `organizationId`에 **Active 멤버십** 보유. Disabled / Removed / Invited 멤버십은 거부. |
| `Team` | 같은 `organizationId`, `deletedAt = null`. |
| `Organization` | `targetId === document.organizationId` 만 허용. 다른 조직 ID는 NOT_FOUND. |

검증 실패는 모두 NOT_FOUND — Phase A §15의 cross-org 존재 누설 방지 정책. 다른 조직의 user / team / org ID를 응답에 echo하지 않는다.

### 7.3 중복 차단

요청 본문에 같은 `(targetType, targetId)`가 두 번 등장하면 INVALID_INPUT. permission 값이 다르더라도 — 어느 쪽을 따를지 불분명한 요청은 모두 거부.

---

## 8. PUT replace-all 의미

PUT의 시맨틱은 단순하다: **요청 본문 = 문서의 새 완전한 share 상태**.

```
request body: { shares: [ {targetType, targetId, permission}, ... ] }
result:        그 array가 이 문서의 모든 share가 된다.
```

내부 동작:

1. 새 payload를 zod로 파싱하고 검증한다.
2. 옛 share 행을 메모리에 로드 (Map 키: `${targetType}:${targetId}`).
3. 새 entry를 같은 키로 Map에 넣는다.
4. **Diff 계산**:
   - `added` = 새 키 - 옛 키
   - `updated` = 양쪽 키이면서 permission 변경
   - `removed` = 옛 키 - 새 키
5. `prisma.$transaction` 안에서 옛 행 전부 `deleteMany` → 새 행 전부 `createMany` → 결과 `findMany`.
6. audit metadata에 `{ added, updated, removed, total }` 기록.

**왜 delete-all + create-all로 구현했나**: per-row upsert / diff-then-mutate 보다 단순하고, 관찰 가능한 효과는 동일하다. transaction 안이라 중간 실패 시 롤백된다.

빈 배열을 PUT하면 모든 share가 제거된다.

---

## 9. Owner explicit share 허용 정책

Owner는 ownership만으로 이미 Manage 권한을 갖는다 — `evaluateDocumentPermission`에서 owner grant가 자동으로 Manage를 부여한다. 따라서 owner를 다시 share row에 추가하는 것은 **권한 결과에 영향 없음**.

그럼에도 이 케이스를 차단하지 않은 이유:

* 사용자 UX: 공유 패널을 열어 본인 이름이 안 보이면 "내가 안 들어 있나?"로 혼란 가능. UI가 owner를 implicit Manage로 표시하더라도, 사용자가 본인을 명시적으로 추가하는 것을 막을 필요 없음.
* 보안 위험 0: 같은 권한 결과를 만드는 두 경로가 공존할 뿐.
* 차단했을 경우의 비용: 검증 분기 추가, 에러 메시지 추가, 테스트 케이스 추가, 사용자가 이 차단을 학습해야 함.

따라서 **owner를 User-target share에 포함하는 것은 허용**. 이 결정은 Step 4 정책으로 명시한다.

---

## 10. Audit 기록 정책

* Action: `document.shares_updated` (Phase B step 8 audit writer skeleton의 16번째 코드)
* targetType: `"document"`, targetId: `documentId`
* metadata: `{ added: N, updated: N, removed: N, total: N }`
  - `total`: 새 set의 크기 (= payload.shares.length)
  - 빈 배열로 모두 비우면 `{ added: 0, updated: 0, removed: <원래 개수>, total: 0 }`
* result: `Success` (실패 audit은 Phase G 이연 — Phase B step 8 정책 그대로)
* `ip_address` / `user_agent`는 비워둠 (Phase G에서 request-pipeline이 채울 예정)

write 시점에서 audit이 실패해도 사용자 액션은 성공한다 (`recordActivity`가 try/catch + stderr).

---

## 11. Codex 검증 결과

Step 4는 **단일 패스로 승인**되었다 (Step 1, 2, 3과 달리 보정 라운드 없음). 이는 Step 1–3에서 굳혀진 패턴 — service + route + audit + Step 2 helper 위임 — 을 그대로 따른 결과로 보인다. 새 권한 룰이 0이고, 새 schema 변경도 0이고, target 검증만 service 레이어에 추가된 형태라 검증 영역이 좁았다.

Codex가 짚은 비-차단 메모 1건:

> `replaceDocumentShares`의 transaction 내부 `deleteMany` / `findMany`는 현재 `documentId`만으로 충분합니다. `documentId`가 PK라 보안 문제는 아니지만, report에는 "문서 ID 단일 PK에 기대고 있으며 서비스 진입 전 org 검증 완료" 정도로 적어두면 좋습니다.

→ 이 보고서 §13.1에 명시.

검증 통과 항목:

* `requireDocumentManage`가 read / write 양쪽에 적용
* Admin 묵시 접근 없음
* Deleted 문서 NOT_FOUND
* target 별 same-org 검증
* PUT replace-all 의미
* audit 기록

검증 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` (10 워크스페이스) | PASS |
| `pnpm test` (vitest unit) | PASS — 6 files / 99 tests (변동 없음) |
| `pnpm test:integration` | PASS — **10 files / 135 tests** (118 → 135, +17 sharing) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

Step 4 코드는 `develop`에 머지되었다 (commit `f625dd3`, merge `7aa42f7`).

---

## 12. Integration test 17 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| 권한 게이트 (Owner / Manager Team / Manage-share OK / Edit-share 거부 / View-only 거부 / Admin Private NOT_FOUND / cross-org / Deleted) | 8 |
| Target 검증 (User cross-org / Team cross-org / Org mismatch / Org match / 중복 / Department) | 6 |
| Replace-all + audit (diff add/update/remove / 빈 shares clear / audit metadata) | 3 |

---

## 13. 다음 단계로 넘어가기 전 운영 주의사항

### 13.1 `documentId` PK 단일 키에 의존한 transaction

`replaceDocumentShares`의 transaction은 다음 형태다:

```ts
await tx.documentShare.deleteMany({ where: { documentId } });
await tx.documentShare.createMany({ data: [...] });
return tx.documentShare.findMany({ where: { documentId }, ... });
```

세 호출 모두 `documentId`만으로 행을 식별한다. **organizationId를 추가로 걸지 않았다**.

이게 안전한 이유:

* `documents.id`는 PK이므로 (id) 만으로 단일 행이 결정됨.
* 서비스 진입 전 `loadDocumentForManage(prisma, organizationId, documentId)`가 이미 `where: { id: documentId, organizationId }`로 검증을 마쳤다 — 이 documentId가 진짜 이 조직의 것임을 확인.
* DB schema의 composite FK `(document_id, organization_id) → documents(id, organization_id)`가 cross-org 데이터 삽입을 차단.

따라서 단일 PK에 기대는 transaction 자체는 보안 문제가 아니다. 다만 향후 코드를 읽는 사람이 "왜 organizationId 안 걸었지?"로 혼란할 수 있으므로 위 두 보호 장치(서비스 진입 검증 + DB FK)에 의존한다는 점을 인지해야 한다.

향후 정책이 더 보수적이 되어 모든 query에 `organizationId`를 명시하는 컨벤션으로 가면 이 transaction도 그 패턴에 맞춰 변경.

### 13.2 Route smoke test는 아직 없음

이번 단계 통합 테스트는 모두 service 직접 호출이다. Route 자체는 얇고 Phase B/C 패턴 그대로 (session → service → respondError) 위험이 낮지만, 최소 1–2개의 route smoke test (실제 HTTP 응답 확인)는 후속 Step에서 추가할 가치가 있다. Step 3 report에서도 동일 메모를 남겼으므로 두 단계의 부채가 누적되지 않도록 다음 적절한 시점에 묶어 추가.

### 13.3 실패 audit / `ip_address` / `user_agent`는 Phase G로 이연

Phase B step 8과 동일한 정책. 성공 이벤트만 기록, request-pipeline에서의 IP / UA 캡처는 Phase G의 책임. `activity_logs` 스키마는 이미 컬럼을 갖고 있어 Phase G가 writer만 추가하면 된다.

### 13.4 공유 UI는 미구현

이번 단계는 backend API만 노출했다. 사용자가 실제로 공유를 추가/삭제할 화면은 UI 단계에서 구현된다. 그때까지는 클라이언트 (예: 관리자 도구, curl, 통합 테스트) 만 이 API를 호출 가능.

### 13.5 PUT만 제공, PATCH는 없음

PUT의 replace-all 시맨틱이 Phase C 단계의 share 관리를 단순하게 만든다. 향후 "한 share만 추가" / "한 share만 삭제" 같은 PATCH 패턴이 필요하면 그때 결정. 현재 UI가 없는 상황에서 미리 패턴을 늘릴 필요 없음.

### 13.6 Owner explicit share row의 의미

§9에서 다룬 것처럼 owner가 자기 자신을 share row에 명시적으로 추가하는 것은 허용된다. 권한 평가 결과에는 영향 없지만 행 자체는 DB에 남는다. 향후 데이터 분석 / migration 시 "owner가 자기 자신 share를 가진 경우"가 의도된 데이터임을 인지해야 한다.

---

## 14. 비개발자 요약 — 한 단락

Step 4는 "이 문서를 누구와 공유할지"를 사용자가 실제로 설정할 수 있는 2개의 API(공유 목록 보기 / 공유 전체 교체)를 만든 단계였다. 공유를 보는 것과 바꾸는 것 모두 Manage 권한이 필요한데, 이는 "공유 목록 자체가 이 문서에 누가 접근하는지를 누설하기 때문"이다. PUT은 단순한 약속을 따른다 — 보낸 배열이 새 완전한 공유 상태가 된다. 빠진 건 삭제, 새로 들어온 건 추가, 권한 값이 바뀐 건 갱신. 모든 변경은 감사 로그에 추가/갱신/삭제 카운트와 함께 기록된다. 다른 조직 사용자/팀에게 공유하려는 시도는 데이터베이스 외래 키 + service 레이어 검증 두 단계에서 막힌다. Department로 공유하려는 시도는 코드 레벨에서 거부 — Phase A에서 잠근 Department→Team 통합 정책을 어기지 못한다. 공유 UI는 다음 UI 단계에서 만든다.

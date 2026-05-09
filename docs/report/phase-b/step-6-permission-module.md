# Phase B — Step 6: 권한 모듈(Permission Module) 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **6단계 — Permission Module** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 5 까지 만들어진 조직/팀/멤버십/초대 API 의 권한 판정 로직을 한 곳으로 모아 **단일 출처(single source of truth)** 로 만드는 단계다. 비개발자도 이해할 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)
- [Step 4 — Auth / session](./step-4-auth-session.md)
- [Step 5 — Organization / Team / Membership](./step-5-org-team-membership.md)

---

## 2. Step 6의 목적

Step 5 까지의 권한 체크는 **편의상** `apps/web/lib/permissions.ts` 와 `apps/web/lib/api-error.ts` 에 모여 있었다. 이는 임시 위치다. Phase B 의 잠금 결정 중 하나는 "권한 판정은 한 곳에 모아 두고, 거기서만 거절을 만들도록 한다" 는 것이다. Step 6 의 목적은 다음과 같다.

- 권한 판정의 **단일 출처** 를 `packages/permissions` 로 옮긴다. 이후 모든 패키지(Step 7 의 관리자 화면, Step 8 의 활동 로그, Phase C 의 문서 / AI / Todo)가 같은 모듈을 통해 거절을 만든다.
- "왜 거절됐는가" 를 클라이언트가 **안정적인 식별자** 로 알 수 있게 만든다(`reason_code` 정책).
- "이 자원이 존재하는지조차 보여주지 않는다" 는 정책(`NOT_FOUND` 우선)을 코드 레벨에서 강제한다.
- Step 5 서비스 4개(조직 / 팀 / 멤버십 / 초대)를 새 모듈에 연결해서 **인라인 if 문이 한 줄도 남지 않도록** 정리한다.

기능을 새로 추가하지 않는다. 권한 모듈로 옮기는 작업과, 그 옮김이 기존 동작을 깨지 않는지 검증하는 통합 테스트만 수행한다.

---

## 3. 이번에 추가 / 수정 / 삭제한 파일

### 3.1 신규 (3개)

**권한 모듈 본체** (`packages/permissions/src/`)

| 파일 | 내용 |
| --- | --- |
| `errors.ts` | `ApiError` 클래스(404 / 403 / 409 / 400) + `Errors` factory(`notFound` / `forbidden` / `conflict` / `invalid`) + 잘 알려진 reason_code 목록을 문서화한 `KnownReasonCode` 타입. |
| `checks.ts` | `requireMembership` / `requireAdmin` / `requireActiveUser` / `assertNotLastAdmin` / `roleAtLeast` 헬퍼. Step 5 의 모든 권한 분기를 이 5개 함수로 표현. |

**테스트**

| 파일 | 내용 |
| --- | --- |
| `tests/unit/permissions.test.ts` | 권한 모듈 전용 단위 테스트 20 케이스. envelope 모양, 역할 비교, cross-org 숨김, Manager 차단, Last-Admin 사전 검사. |

### 3.2 수정 (10개)

| 파일 | 내용 |
| --- | --- |
| `packages/permissions/src/index.ts` | 빈 stub(`denyForbidden` / `denyNotFound` / `allow`)을 제거하고, 위 두 파일의 5개 함수와 ApiError / Errors / 타입을 공개 API 로 export. |
| `packages/permissions/package.json` | Prisma 타입을 쓰기 위해 `@notive/db` workspace 의존 추가. |
| `apps/web/lib/http.ts` | `ApiError` import 출처를 `@notive/permissions` 로 변경. NOT_FOUND 응답에 `reason_code` 키 자체를 포함하지 않는 정책을 코드로 강제. AuthError 매핑은 그대로 유지. |
| `apps/web/lib/services/organization.ts` | `Errors`·`requireActiveUser`·`requireAdmin`·`requireMembership` 을 모두 `@notive/permissions` 에서 import. 인라인 `if (status !== "Active")` / `if (role !== "Admin")` 제거. |
| `apps/web/lib/services/team.ts` | 동일. |
| `apps/web/lib/services/membership.ts` | 동일. `assertNotLastAdmin` 도 `@notive/permissions` 에서 import. |
| `apps/web/lib/services/invitation.ts` | 동일. `requireActiveUser` 사용. |
| `tests/integration/vitest.config.ts` | `@notive/permissions` alias 추가(통합 테스트가 서비스 레이어를 거쳐 권한 모듈을 들여다볼 수 있게). |
| `tests/integration/package.json` | `@notive/permissions` workspace 의존 추가. |
| `tests/integration/org-team-membership.test.ts` | `ApiError` import 출처를 `apps/web/lib/api-error.ts` → `@notive/permissions` 로 변경. |
| `tests/unit/example.test.ts` | 사라진 `denyForbidden` / `denyNotFound` 호출 제거하고 `APP_NAME` smoke test 만 남김. |
| `pnpm-lock.yaml` | workspace 의존 변경 잠금 갱신. |

### 3.3 삭제 (2개)

| 파일 | 사유 |
| --- | --- |
| `apps/web/lib/api-error.ts` | `packages/permissions/src/errors.ts` 로 이동. shim 을 두지 않고 import 경로를 모두 새 출처로 옮김. |
| `apps/web/lib/permissions.ts` | `packages/permissions/src/checks.ts` 로 이동. 같은 이유로 삭제. |

DB 스키마 / 마이그레이션 / Auth 흐름 변경 **없음.** Step 5 의 모든 동작이 그대로 유지된다.

---

## 4. 왜 권한 판단을 `packages/permissions` 로 중앙화했는가

이유는 세 가지다.

1. **정책의 한 줄짜리 출처.** "이 사용자가 이 작업을 할 수 있는가" 라는 질문의 답이 코드 베이스 곳곳에 흩어지면, 어느 한 곳을 고쳤을 때 다른 곳이 따라오지 않는 일이 생긴다. 권한이 어긋나면 데이터가 새거나 Admin 만 해야 할 일을 다른 사람이 하게 된다. Phase B 에서는 안전 측면에서 가장 중요한 부분이므로 한 곳에 모은다.
2. **이후 단계에서 같은 잣대.** Step 7 의 관리자 화면, Step 8 의 활동 로그, Phase C 의 문서 / AI / Todo 가 모두 같은 모듈을 통과해서 거절을 만든다. 그러면 새 라우트를 추가할 때마다 "여기서 admin_only 는 어떻게 표현하지?" 같은 고민을 다시 하지 않는다.
3. **테스트 가능성.** 권한 모듈이 한 곳에 있으면, "정책 자체가 맞는가" 를 단위 테스트로 한 번에 보장할 수 있다. 이번 단계에서 추가된 20개 단위 테스트가 그 역할을 한다.

`apps/web/lib/api-error.ts` 와 `apps/web/lib/permissions.ts` 는 Step 5 가 "임시로" 둔 위치였다. Step 6 에서 이 두 파일은 그대로 `packages/permissions` 로 옮겨졌고, **shim 으로 남기지 않고 삭제** 했다. 단일 출처를 강조하기 위해서다. 모든 import 경로는 `@notive/permissions` 로 일괄 변경됐다.

---

## 5. NOT_FOUND vs FORBIDDEN 구분

이 둘은 의도적으로 의미가 다르다. 권한 모듈은 코드 레벨에서 이 차이를 강제한다.

| 상황 | 응답 | 이유 |
| --- | --- | --- |
| 멤버가 아닌 조직에 접근 | `NOT_FOUND` | 다른 조직의 존재 자체를 노출하지 않는다. |
| 직접 ID 추측 (UUID 짐작) | `NOT_FOUND` | 추측이 맞았는지 확인할 수 있게 해서는 안 된다. |
| 비공개·다른 사람의 자원 | `NOT_FOUND` | 권한이 없다는 사실 자체를 숨긴다. |
| 인증은 됐고 그 자원은 보이지만, 이 작업을 할 역할이 아님 | `FORBIDDEN(reason_code)` | 클라이언트가 "권한 부족" 을 사용자에게 정직하게 보여줄 수 있어야 한다. |
| 마지막 Admin 보호 | `FORBIDDEN(last_admin_protection)` | 누가 봐도 막힐 수 있는 행동임을 reason_code 로 명시한다. |
| 이미 다른 조직 멤버라 새 조직 / 초대 수락 불가 | `CONFLICT(already_in_organization)` | 영구 권한 부족이 아니라 "지금 이 상태에서는 안 된다" 는 충돌. |

권한 모듈의 `Errors.notFound()` 는 **reason 인자를 받지 않는다.** 이 한 가지 디자인이 정책을 강제한다 — NOT_FOUND 응답에는 reason_code 가 들어갈 자리가 없다.

---

## 6. reason_code 가 언제 붙고 언제 빠지는가

응답 envelope 은 두 가지 모양뿐이다.

```json
// NOT_FOUND — reason_code 키 자체가 없다
{ "error": "NOT_FOUND" }

// 그 외 — reason_code 가 반드시 있다
{ "error": "FORBIDDEN", "reason_code": "admin_only" }
{ "error": "CONFLICT",  "reason_code": "already_in_organization" }
{ "error": "INVALID_INPUT", "reason_code": "INVALID_INPUT" }
```

규칙:

- **NOT_FOUND** — `reason_code` 없음. 응답을 본 사람이 "권한이 없는 것" 과 "처음부터 존재하지 않는 것" 을 구별할 수 없어야 한다.
- **FORBIDDEN** — `reason_code` 필수. `admin_only`, `manager_cannot_invite`, `last_admin_protection`, `account_not_active` 등 안정된 식별자로 응답한다.
- **CONFLICT** — `reason_code` 필수. `already_in_organization`, `slug_taken`, `invitation_pending`, `invitation_not_pending`, `invitation_expired` 등.
- **INVALID_INPUT** — `reason_code` 는 같은 코드(`INVALID_INPUT`)로 채우고, 사람용 메시지는 `error.message` 에 담는다(검증 실패 사유는 다양하므로 코드보다 메시지에 더 의존).

권한 모듈은 잘 알려진 reason_code 들을 `KnownReasonCode` 타입으로 문서화해 두었다. 새 reason_code 를 도입할 때 이 union 도 같이 업데이트하는 것이 규약이다.

---

## 7. Manager 가 B단계 관리 API 에서 왜 막히는가

Phase A §15 의 잠금 결정 중 하나가 **"Manager 의 MVP 역할은 Phase C 의 팀 문서 모더레이션에 한정된다"** 이다. 즉, B단계의 조직 / 팀 / 멤버십 / 초대 관리 API 는 Manager 가 진입할 수 없다.

권한 모듈에서 이 정책은 두 가지 도구로 표현된다.

1. **`requireAdmin(membership)`** — 기본 reason 은 `admin_only`. 팀 생성 / 수정 / 아카이브, 멤버 역할 / 팀 / 비활성·재활성, 초대 목록 / 취소 같은 mutation 에서 호출된다. Manager 가 호출하면 `FORBIDDEN(admin_only)`.
2. **`requireAdmin(membership, "manager_cannot_invite")`** — 두 번째 인자로 reason 을 바꿔 부른다. 초대 **생성** 라우트만 이 식별자를 쓴다. 클라이언트가 "Manager 라서 초대를 못 만든다" 고 정확히 표시할 수 있다.

이렇게 분리해 둔 이유는, Manager 가 막히는 곳이 여러 곳이지만 그중 사용자가 가장 자주 마주칠 곳은 "동료 초대" 이기 때문이다. 그 한 케이스만 reason 을 분리해서 UX 가 정확해진다.

`packages/permissions/src/checks.ts` 상단 주석에는 다음 잠금 사항이 명시돼 있다 — "Manager cannot invite, cannot manage templates, cannot enter the B-stage admin API. Only Admin may run any management mutation." 이 주석은 권한 모듈을 처음 보는 개발자가 "왜 이렇게 단순한 것을 모듈로 분리했는가" 를 따라올 수 있게 하는 닻이다.

---

## 8. Last-Admin 보호의 표현

권한 모듈에는 `assertNotLastAdmin(prisma, membership)` 이라는 단일 함수가 있다. 다음 4가지 변경 시도에 대해 같은 검사를 수행한다.

1. **마지막 Admin 의 역할을 다른 역할로 바꾸려 할 때** (강등) — `changeRole` 서비스가 호출 직전에 통과시킨다.
2. **마지막 Admin 의 상태를 Disabled / Removed 로 바꾸려 할 때** — `deactivateMembership` 서비스가 통과시킨다.
3. **마지막 Admin 행을 소프트 삭제하려 할 때** (`deletedAt` 설정) — Step 6 라우트는 노출하지 않지만 함수 자체는 같은 로직으로 막아둠.
4. **마지막 Admin 을 다른 조직으로 이전하려 할 때** (`organizationId` 변경) — Step 6 라우트는 노출하지 않음. 안전망 역할.

검사 로직은 단순하다 — 같은 조직에 자기 자신을 제외한 활성 Admin 이 한 명이라도 더 있으면 통과, 0명이면 `FORBIDDEN(last_admin_protection)` 으로 거절한다.

DB 트리거(`check_last_admin`)는 그대로 살아 있다. 트리거는 **마지막 안전망** 이다. 만약 어떤 새 라우트가 `assertNotLastAdmin` 호출을 빠뜨리고 mutation 을 시도하면, 트리거가 RAISE 한다. 사용자에게는 정제된 메시지 대신 데이터베이스 에러가 가지만, **데이터 자체는 안전하다.** Step 6 의 정책은 "트리거에 닿기 전에 권한 모듈이 먼저 막는다" 다.

---

## 9. Step 5 서비스들이 새 권한 모듈을 어떻게 쓰는가

전과 후가 한눈에 비교되도록 표로 정리한다.

| 위치 | Step 5 까지 | Step 6 부터 |
| --- | --- | --- |
| `services/organization.ts` 의 `createOrganization` | `if (user.status !== "Active") throw Errors.forbidden("account_not_active")` | `requireActiveUser(user)` |
| 같은 파일의 `updateOrganization` | `if (membership.role !== "Admin") throw Errors.forbidden("admin_only")` | `requireAdmin(membership)` |
| `services/team.ts` 모든 mutation | `requireAdmin(membership)` (이미 헬퍼 사용 중) | 동일 — import 출처만 `@notive/permissions` |
| `services/membership.ts` 모든 mutation | `requireAdmin(membership)`, `assertNotLastAdmin(...)` (로컬 헬퍼) | 동일 — import 출처만 `@notive/permissions` |
| `services/invitation.ts` 의 `createInvitation` | `requireAdmin(membership, "manager_cannot_invite")` (로컬 헬퍼) | 동일 — import 출처만 `@notive/permissions` |
| 같은 파일의 `acceptInvitation` | `if (actingUser.status !== "Active") throw Errors.forbidden("account_not_active")` | `requireActiveUser(actingUser)` |

결과적으로 서비스 레이어 4개 파일에 인라인 권한 분기 if 문이 **0개** 다. 모든 분기는 권한 모듈 함수 호출이다. Step 7 / Step 8 에서 새로운 라우트를 추가할 때 같은 패턴으로 시작할 수 있다.

---

## 10. 테스트 / 검증 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm install` | OK | workspace 의존 갱신 |
| `pnpm typecheck` | PASS | 10개 워크스페이스 |
| `pnpm lint` | PASS | ESLint 경고 / 에러 0 |
| `pnpm format` | PASS | Prettier `--check` 통과 |
| `pnpm test` (단위) | PASS | 5 파일 / 43 테스트 (Step 6 신규 20) |
| `pnpm test:integration` | PASS | 6 파일 / 61 테스트 (Step 5 의 28 + Codex 보정 3 + Step 4 의 16 + 기존 14, 모두 그대로 유지) |
| `pnpm build` | PASS | 16개 라우트 등록 그대로 |
| `prisma validate` | PASS | 스키마 무변경 |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

신규 단위 테스트 20 케이스 핵심:

- **envelope 모양**: NOT_FOUND 의 reason 은 `null` / FORBIDDEN, CONFLICT 의 reason 은 입력값 그대로 / INVALID_INPUT 의 message 노출
- **`roleAtLeast`**: Admin > Manager > Editor > Viewer 순서 정합
- **`requireActiveUser`**: Active 통과 / Pending·Disabled 는 `FORBIDDEN(account_not_active)`
- **`requireAdmin`**: Admin 통과 / Editor·Manager·Viewer 모두 `FORBIDDEN(admin_only)` / Manager + reason 인자 → `FORBIDDEN(manager_cannot_invite)`
- **`requireMembership`** (가짜 PrismaClient): 활성 멤버 통과 / 다른 조직 / 임의 ID 는 `NOT_FOUND` (reason `null`)
- **`assertNotLastAdmin`**: 비-Admin 무시 / 단독 Admin 차단 → `FORBIDDEN(last_admin_protection)` / 다른 활성 Admin 있으면 통과

기존 통합 테스트 61개가 새 권한 모듈 경유로도 모두 그대로 통과 — 즉 **외부 동작 변경 없음** 이 코드로 보장된다.

---

## 11. 이번 단계에서 일부러 하지 않은 것

| 항목 | 어디서 다룸 |
| --- | --- |
| Organization / Team / Membership / Invitation 기능 추가·확장 | 본 단계 범위 밖. Step 6 은 권한 판정 중앙화만. |
| 관리자 화면 골격 | Step 7. |
| 활동 로그 본 구현 | Step 8. 권한 모듈은 ActivityLog 를 직접 쓰지 않는다. |
| 문서 / AI / Todo 기능 | Phase C. |
| DB 스키마 / 마이그레이션 변경 | 변경 없음. Step 3 의 9-table 디자인 그대로. |
| Auth 흐름(가입 / 로그인 / 세션) 수정 | Step 4 동작 그대로 유지. |
| `requireMembership` 의 캐싱 / 동일 요청 내 메모이제이션 | 의도적 미구현. 매 호출이 명시적 DB 조회. 운영에서 N+1 이 보이면 Step 7~8 에서 도입. |
| 권한 매트릭스 데이터화 (역할 × 행동 → boolean 의 표) | 의도적 미구현. Phase B 의 권한 분기는 제한적이라 함수 5개로 충분. 매트릭스화는 Phase C 또는 그 이후 검토. |

---

## 12. 다음 단계로 넘어가기 전에 알아야 할 주의사항

1. **모든 새 mutation 라우트는 권한 모듈을 먼저 호출해야 한다.** Step 7 의 관리자 화면, Step 8 의 활동 로그가 새 라우트를 만들 때 권한 분기를 인라인으로 넣지 말고 `@notive/permissions` 함수를 통해서만 거절을 만든다. 이 규약이 깨지면 단일 출처가 무너진다.

2. **`reason_code` 는 클라이언트 / 운영 도구의 안정 인터페이스다.** 일단 외부에 나간 reason_code 는 없애지 말고 deprecate 만 한다. 새로 추가할 때는 `KnownReasonCode` 타입과 권한 모듈 주석에 같이 넣는다.

3. **NOT_FOUND 응답에는 절대 `reason_code` 를 붙이지 마라.** 코드 레벨에서 이미 막혀 있지만(`Errors.notFound()` 가 reason 인자를 받지 않음), 직접 `NextResponse.json({ error: "NOT_FOUND", reason_code: ... })` 같은 식으로 우회하는 코드는 정책 위반이다.

4. **DB 트리거는 권한 모듈이 빠뜨렸을 때를 위한 안전망일 뿐.** 트리거에 의존해 거절을 만들면 사용자에게 가는 응답이 정제되지 않는다. 새 mutation 을 만들 때 반드시 `assertNotLastAdmin` 같은 사전 검사를 호출한다.

5. **`@notive/permissions` 는 외부 의존이 거의 없다.** 현재 `@notive/db`(Prisma 타입)와 표준 라이브러리만 사용한다. 미래에 다른 패키지(`@notive/auth`, `@notive/mail` 등)에 의존하지 않도록 유지하는 것이 좋다 — 권한 모듈이 다른 도메인에 끌려 들어가면 단일 출처라는 가치가 약해진다.

6. **테스트 속도와 가짜 PrismaClient.** 단위 테스트는 가짜(in-memory) PrismaClient stub 으로 권한 함수를 검증한다. 권한 함수의 시그니처가 바뀌면 stub 도 같이 갱신해야 한다. 통합 테스트는 진짜 Postgres 위에서 같은 시나리오를 다시 본다 — 둘 다 통과해야 한다.

7. **import 경로를 절대 `apps/web/lib/api-error` / `apps/web/lib/permissions` 로 되돌리지 마라.** 두 파일은 삭제됐다. shim 을 다시 도입하면 단일 출처가 무너진다. 모든 신규 코드는 `@notive/permissions` 에서 import 한다.

이 7가지를 인지한 상태에서 Step 7(관리자 화면 골격) 로 넘어가면 된다.

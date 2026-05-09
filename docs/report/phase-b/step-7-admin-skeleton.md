# Phase B — Step 7: 관리자 골격(Admin skeleton) 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **7단계 — Admin skeleton** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 향후 관리자 화면이 붙을 자리에 **서버 쪽 골격(API)** 만 먼저 만들어 두는 단계다. 비개발자도 이해할 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)
- [Step 4 — Auth / session](./step-4-auth-session.md)
- [Step 5 — Organization / Team / Membership](./step-5-org-team-membership.md)
- [Step 6 — Permission Module](./step-6-permission-module.md)

---

## 2. Step 7의 목적

지금까지 Step 4·5·6 에서는 인증, 조직 / 팀 / 멤버십 / 초대, 그리고 권한 판정 모듈을 만들었다. Step 7 의 목적은 다음과 같다.

- 향후 관리자 화면(예: "조직 관리" 페이지) 이 붙을 자리에 **안정된 API 골격** 을 만든다.
- 그 API 들이 일관되게 **Admin 만 통과** 시키도록 한다(권한 모듈 경유).
- Step 5 에서 이미 만든 멤버 / 초대 관리 로직과 **중복 구현하지 않는다.** 같은 서비스 함수를 그대로 재사용한다.
- 관리자 응답에서 절대 노출하면 안 되는 민감 필드(비밀번호 해시, 각종 토큰 해시 등) 를 **응답 shape 자체에 들어가지 못하도록** 박는다.
- 이번 단계에서 **UI / React 페이지는 만들지 않는다.** 관리자 화면은 별도 단계에서, 이 API 골격 위에 얹는다.

이 단계가 끝나면 어떤 프론트엔드(React, 모바일, 외부 도구 등) 라도 같은 API 를 호출해 관리자 작업을 할 수 있다.

---

## 3. 추가된 파일 (10개)

기존 파일은 **하나도 수정하지 않았다.** Step 7 은 새 라우트와 새 서비스만 추가한다.

### 3.1 서비스 (1개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/admin.ts` | `getAdminHome()` (관리자 홈 placeholder) + `listAdminMembers()` (사용자 정보 조인 + 민감 필드 명시 제외) + `AdminSection` / `AdminHome` / `AdminMember` 타입. |

### 3.2 API 라우트 (8개)

모두 `apps/web/app/api/organizations/[id]/admin/` 아래에 위치한다.

| 파일 | 메서드 / 경로 | 동작 |
| --- | --- | --- |
| `admin/route.ts` | GET `/api/organizations/{id}/admin` | 관리자 홈 placeholder 응답. |
| `admin/members/route.ts` | GET `/api/organizations/{id}/admin/members` | 멤버 목록 + 사용자 일부 정보. |
| `admin/members/[membershipId]/role/route.ts` | PATCH `.../role` | Step 5 의 `changeRole` 에 위임. |
| `admin/members/[membershipId]/team/route.ts` | PATCH `.../team` | Step 5 의 `changeTeam` 에 위임. |
| `admin/members/[membershipId]/deactivate/route.ts` | POST `.../deactivate` | Step 5 의 `deactivateMembership` 에 위임. |
| `admin/members/[membershipId]/reactivate/route.ts` | POST `.../reactivate` | Step 5 의 `reactivateMembership` 에 위임. |
| `admin/invitations/route.ts` | GET, POST `/api/organizations/{id}/admin/invitations` | Step 5 의 `listInvitations` / `createInvitation` 에 위임. |
| `admin/invitations/[invitationId]/cancel/route.ts` | POST `.../cancel` | Step 5 의 `cancelInvitation` 에 위임. |

### 3.3 테스트 (1개)

| 파일 | 내용 |
| --- | --- |
| `tests/integration/admin-skeleton.test.ts` | 13 케이스. 관리자 홈 접근 매트릭스, 멤버 목록 민감 필드 제외, mutation wrapper 의 정책 유지. |

DB 스키마 / 마이그레이션 / Auth / Step 4·5·6 코드 변경은 **없다.**

---

## 4. Admin home placeholder 가 하는 일

`GET /api/organizations/{id}/admin` 은 관리자가 처음 진입할 때 받게 될 **요약 화면용 데이터** 를 돌려준다. 이번 단계에서는 다음 세 가지만 담는다.

```json
{
  "organization": {
    "id": "...",
    "name": "...",
    "slug": "...",
    "status": "Active"
  },
  "membership": {
    "id": "...",
    "role": "Admin"
  },
  "sections": [
    { "key": "members",     "label": "Members",     "href": "/admin/members" },
    { "key": "invitations", "label": "Invitations", "href": "/admin/invitations" }
  ]
}
```

세 가지가 들어가는 이유는 다음과 같다.

1. **organization** — 관리자가 어느 조직의 화면에 들어와 있는지 한눈에 보여 준다. slug / status 까지 노출하므로 화면 상단의 조직 표시줄을 만들 수 있다.
2. **membership** — "지금 화면을 보고 있는 나" 의 역할(role)이 무엇인지 확인용. UI 가 "Admin 권한으로 접속함" 같은 표시를 할 때 쓰인다.
3. **sections** — 좌측 사이드바 / 상단 탭에 어떤 항목을 띄울지 **서버가 결정** 한다. 클라이언트가 하드코딩하지 않고 이 목록을 받아 렌더한다. Step 8 이 활동 로그를 만들면 `{ key: "activity", label: "Activity", href: "/admin/activity" }` 한 줄을 추가하기만 하면 된다.

여기서는 통계, 문서 본문 미리보기, 최근 활동 목록 같은 **실제 데이터** 는 일부러 넣지 않는다. 그건 후속 단계에서 각 섹션별로 별도 endpoint 를 추가하면 된다.

---

## 5. Admin members list 가 반환하는 정보와 민감 필드 제외 정책

`GET /api/organizations/{id}/admin/members` 는 조직의 모든 멤버(소프트 삭제되지 않은 모든 행) 를 사용자 정보와 함께 돌려준다. 응답 shape 는 다음과 같다.

```json
{
  "members": [
    {
      "membership": {
        "id": "...",
        "role": "Admin",
        "status": "Active",
        "teamId": null,
        "joinedAt": "2026-05-09T..."
      },
      "user": {
        "id": "...",
        "name": "...",
        "email": "...",
        "status": "Active",
        "emailVerifiedAt": "2026-05-09T...",
        "lastLoginAt": "2026-05-09T..."
      }
    }
  ]
}
```

응답에 **명시적으로 6개 필드만** 담는다(`id`, `name`, `email`, `status`, `emailVerifiedAt`, `lastLoginAt`). 다음 필드들은 **절대로 응답에 들어가지 않는다.**

| 제외 필드 | 이유 |
| --- | --- |
| `passwordHash` | 비밀번호 검증값. 절대 노출 금지. |
| `emailVerificationTokenHash` | 이메일 인증 토큰의 해시. |
| `emailVerificationExpiresAt` | 같은 흐름의 만료 시각(토큰 존재 여부 추론 가능). |
| `passwordResetTokenHash` | 비밀번호 재설정 토큰의 해시. |
| `passwordResetExpiresAt` | 같은 이유. |
| 세션의 `tokenHash`, 초대의 `tokenHash` | 응답 자체에 세션 / 초대 토큰을 담지 않는다. |

이 정책은 **코드 모양 자체** 로 강제된다. 변환 함수 `toAdminMember()` 가 위 6개 필드를 **명시적으로 하나씩** 골라 담는다. 절대로 `...row.user` 같은 spread 를 쓰지 않는다. 그래서 미래에 schema 에 새 컬럼이 추가되더라도 자동으로 새는 일이 없다 — 새 컬럼을 응답에 노출하려면 누군가 `toAdminMember()` 를 명시적으로 고쳐야 한다.

통합 테스트는 응답에서 위 다섯 가지 토큰 / 해시 필드가 `undefined` 임을 직접 확인한다.

---

## 6. mutation wrapper 라우트가 Step 5 서비스를 재사용한다

mutation 6개(역할 / 팀 / 비활성 / 재활성 / 초대 생성·목록 / 초대 취소) 의 admin 라우트는 **자체 비즈니스 로직이 한 줄도 없다.** 각각 다음 흐름이다.

```ts
세션을 가져온다 → 입력 JSON 을 읽는다 → Step 5 서비스 함수에 그대로 위임 → 응답 모양만 만든다
```

예: `PATCH /api/organizations/{id}/admin/members/{membershipId}/role` 는 Step 5 의 `changeRole(prisma, user.id, params.id, params.membershipId, body)` 를 그대로 호출한다. 이 한 줄이 다음을 모두 통과한다.

- `requireMembership` (cross-org 접근은 NOT_FOUND)
- `requireAdmin` (Admin 외 역할은 FORBIDDEN(admin_only))
- `assertNotLastAdmin` (마지막 Admin 강등 차단)
- 단일 활성 멤버십 정책

즉 `/admin/members/{id}/role` 와 `/memberships/{id}/role` 두 endpoint 는 **같은 정책** 으로 작동한다. 클라이언트는 어느 쪽을 호출해도 같은 응답을 받는다. 한 곳에서 정책이 바뀌면 양쪽 다 바뀐다(중복이 없으니까).

이렇게 둔 이유는 두 가지다.

1. **버그가 한 곳에만 살 수 있다.** 정책 분기를 두 번 쓰면 한 곳을 고치고 다른 곳을 안 고쳐 정합성이 깨질 수 있다. 한 곳뿐이면 그런 일이 일어날 수 없다.
2. **클라이언트 호환성.** 향후 관리자 UI 는 `/admin/...` 라우트를 부른다. 외부 도구나 마이그레이션 스크립트는 `/memberships/...` 같은 일반 라우트를 부른다. 둘 다 같은 응답을 보장한다.

---

## 7. Admin 전용 접근 정책과 Permission Module 사용 방식

Step 7 의 모든 admin endpoint 는 다음 한 가지 흐름으로 진입을 막는다.

```ts
const membership = await requireMembership(prisma, userId, organizationId);
requireAdmin(membership);
```

이 두 줄은 모두 `@notive/permissions` 에서 import 된다. 인라인 if 문이 없다. 따라서 향후 정책이 바뀌어도(예: "admin_only" reason_code 를 다른 식별자로 변경) `packages/permissions` 한 곳만 손대면 된다.

mutation wrapper 들은 위 두 줄을 직접 호출하지 않는다. **Step 5 서비스가 이미 같은 두 줄을 호출하기 때문** 이다. 결과적으로 어느 admin endpoint를 거치든, 결국에는 같은 권한 모듈 함수가 한 번 통과되는 것이 보장된다.

---

## 8. Manager / Editor / Viewer 차단 정책

Phase A §15 에서 **Manager 의 MVP 역할은 Phase C 의 팀 문서 모더레이션** 으로 한정된다고 잠가 두었다. Step 7 의 모든 admin endpoint 는 다음 매트릭스로 응답한다.

| 호출자 역할 | admin home / members / mutations | invitations 생성 |
| --- | --- | --- |
| **Admin** | OK | OK |
| **Manager** | FORBIDDEN(`admin_only`) | FORBIDDEN(`manager_cannot_invite`) |
| **Editor** | FORBIDDEN(`admin_only`) | FORBIDDEN(`admin_only`) |
| **Viewer** | FORBIDDEN(`admin_only`) | FORBIDDEN(`admin_only`) |
| **다른 조직의 Admin / 비-멤버** | NOT_FOUND | NOT_FOUND |

Manager 가 초대 생성을 시도할 때만 `manager_cannot_invite` 라는 별도 reason_code 를 쓰는 이유는 사용자가 가장 자주 마주칠 곳이기 때문이다. 그 한 케이스만 reason 을 분리하면 클라이언트 / UI 가 "당신의 역할로는 동료를 초대할 수 없습니다" 같은 정확한 메시지를 보여줄 수 있다.

---

## 9. NOT_FOUND 와 FORBIDDEN 응답 기준

Step 6 에서 정한 envelope 정책을 Step 7 의 모든 admin endpoint 가 그대로 따른다.

| 상황 | 응답 본문 | HTTP |
| --- | --- | --- |
| 멤버가 아닌 조직 / 임의 UUID 추측 / 비공개 자원 직접 ID 추측 | `{ "error": "NOT_FOUND" }` (reason_code 없음) | 404 |
| 인증은 됐지만 Admin 이 아닌 역할 | `{ "error": "FORBIDDEN", "reason_code": "admin_only" }` | 403 |
| Manager 가 초대를 만들려 함 | `{ "error": "FORBIDDEN", "reason_code": "manager_cannot_invite" }` | 403 |
| 마지막 Admin 보호에 걸림 | `{ "error": "FORBIDDEN", "reason_code": "last_admin_protection" }` | 403 |
| 같은 사용자에 활성 membership 이 이미 있음 | `{ "error": "CONFLICT", "reason_code": "already_in_organization" }` | 409 |

**NOT_FOUND 응답에는 reason_code 키 자체가 들어가지 않는다.** 이는 Step 6 에서 코드 레벨로 막아 둔 정책 — `Errors.notFound()` 가 reason 인자를 받지 않으므로 우회가 어렵다.

---

## 10. 실행한 검증 명령과 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm install` | OK | 의존 변경 없음 |
| `pnpm typecheck` | PASS | 10 개 워크스페이스 |
| `pnpm lint` | PASS | ESLint 경고 / 에러 0 |
| `pnpm format` | PASS | Prettier `--check` 통과 |
| `pnpm test` (단위) | PASS | 5 파일 / 43 테스트 (기존 그대로) |
| `pnpm test:integration` | PASS | 7 파일 / 74 테스트 (Step 7 신규 13) |
| `pnpm build` | PASS | admin 라우트 8 개 등록 확인 |
| `prisma validate` | PASS | 스키마 무변경 |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

신규 통합 테스트 13 케이스 핵심:

- **admin home 접근 매트릭스**: Admin OK / Manager·Editor·Viewer 모두 FORBIDDEN(`admin_only`) / 비-멤버 NOT_FOUND / 임의 UUID NOT_FOUND
- **admin members list**: Admin 만 접근 / 응답에 password / token 계열 5 개 필드가 `undefined` 임을 명시 검증 / 비-멤버 NOT_FOUND
- **mutation wrapper 정책 유지**: 마지막 Admin 강등 차단 / 마지막 Admin 비활성 차단 / Manager 의 `manager_cannot_invite` / Admin 의 초대 생성 + 취소 정상 / 임의 membershipId·invitationId 추측 NOT_FOUND

기존 단위 43 + 통합 61 = 104 개의 Step 4·5·6 테스트가 새 admin 라우트 추가에도 **그대로 통과** 한다.

---

## 11. 일부러 하지 않은 것

| 항목 | 어디서 다룸 |
| --- | --- |
| UI / React 페이지 / `apps/web/app/(admin)/...` 페이지 | 본 단계 범위 밖. 관리자 화면은 별도 단계에서, 이 API 골격 위에 얹는다. |
| ActivityLog writer 본 구현 | Step 8. admin endpoint 가 실행하는 Step 5 서비스 함수에 한 줄을 추가하면 자동으로 모든 admin 작업이 로그된다. |
| DB 스키마 / 마이그레이션 변경 | 변경 없음. Step 3 의 9-table 디자인 그대로. |
| 문서 / AI / Todo 기능 | Phase C 이후. |
| 통계 / 대시보드 / 최근 활동 미리보기 | Step 8 이후. admin home placeholder 의 `sections` 를 늘리는 방식으로 추가. |
| 조직 설정 변경 화면용 endpoint (defaultRole 등) | 추후 별도 작업. 현재 organization_settings 는 생성 시 기본값만 들어감. |
| 회원 강제 로그아웃 / 세션 강제 종료 | 본 단계 범위 밖. Step 4 의 session helper 위에 얹어 추후 작업. |

---

## 12. 다음 단계로 넘어가기 전에 알아야 할 주의사항

1. **Admin endpoint 는 두 prefix 가 같은 동작을 한다.** `/admin/members/{id}/role` 와 `/memberships/{id}/role` 은 같은 Step 5 서비스를 호출한다. 정책 변경 시 한 곳만 고치면 된다 — wrapper 라우트에 비즈니스 로직을 다시 쓰지 말 것.

2. **응답에 새 필드를 추가할 때는 `toAdminMember()` 를 명시적으로 수정해야 한다.** spread 를 절대 쓰지 마라. 미래의 schema 컬럼이 자동으로 응답으로 새는 사고를 막기 위한 정책이다.

3. **`AdminSection` 목록은 클라이언트의 navigation 단일 출처다.** 새 섹션(예: `activity`, `documents`, `settings`)을 추가하려면 `apps/web/lib/services/admin.ts` 의 `ADMIN_SECTIONS` 배열에 한 줄 더 넣고, 각 섹션의 endpoint 를 별도로 만든다. 클라이언트는 자동으로 새 섹션을 보게 된다.

4. **권한 체크는 모두 `@notive/permissions` 를 거친다.** 새 admin endpoint 를 추가할 때 인라인 if 분기 / 직접 `findFirst` 검사를 넣지 말 것. `requireMembership` + `requireAdmin` 두 줄로 시작한다.

5. **ActivityLog 가 붙을 자리는 Step 5 서비스 함수 안쪽이다.** Step 8 에서 활동 로그를 추가하면 `changeRole`, `deactivateMembership` 등 함수 본체에 한 줄씩 추가될 가능성이 높다. admin wrapper 라우트는 손대지 않을 것이다 — 이미 위임만 하고 있기 때문이다.

6. **NOT_FOUND 와 FORBIDDEN 의 구분을 깨뜨리지 마라.** 새 admin endpoint 가 사용자 입력 ID(다른 조직의 자원, 다른 사람의 자원) 를 다룰 때는 권한 모듈을 거쳐 자동으로 NOT_FOUND 가 떨어지도록 만든다. 직접 응답 코드를 쓰는 일은 가급적 피한다.

이 6가지를 인지한 상태에서 Step 8(ActivityLog writer) 로 넘어가면 된다.

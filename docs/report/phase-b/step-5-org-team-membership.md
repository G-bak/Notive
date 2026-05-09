# Phase B — Step 5: 조직 / 팀 / 멤버십 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **5단계 — Organization / Team / Membership** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 4까지 만들어 둔 인증 위에 **사람들이 모일 수 있는 조직과 팀, 그리고 그 안에서의 역할** 을 다루는 통로를 만드는 단계다. 비개발자도 이해할 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)
- [Step 4 — Auth / session](./step-4-auth-session.md)

---

## 2. Step 5의 목적

Step 4까지의 사용자는 신원만 확인된 상태였다. 어디 소속도 없고, 무엇을 할 수 있는지도 정해지지 않은 상태다. Step 5의 목적은 다음과 같다.

- **조직(Organization)** 을 만들고 조회하고 이름을 바꾸는 통로를 만든다.
- 조직 안의 **팀(Team)** 을 만들고, 수정하고, 더 이상 쓰지 않는 팀을 아카이브한다.
- 조직 구성원의 **멤버십(Membership)** 을 관리한다 — 역할 변경, 팀 배정, 비활성화/재활성화.
- 새 사람을 들이는 **초대(Invitation)** 흐름 — 만들고, 보고, 취소하고, 수락한다.
- 위 모든 동작이 Phase A에서 이미 잠가둔 약속(1인 1조직, 1인 1주(主)팀, Manager 권한 제한, Last-Admin 보호 등)을 API 레벨에서도 지키도록 만든다.

권한 판정 본 구현, 화면, 활동 로그 기록은 이 단계에 들어가지 않는다. 그건 Step 6 / Step 7 / Step 8에서 한다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (22개)

**권한·에러 인프라** (`apps/web/lib/`)

| 파일 | 내용 |
| --- | --- |
| `api-error.ts` | NOT_FOUND / FORBIDDEN(reason_code) / CONFLICT(reason_code) / INVALID_INPUT 4종류의 통일된 에러. NOT_FOUND는 reason_code를 일부러 비우게 만들었다. |
| `permissions.ts` | `requireMembership`, `requireAdmin`, `assertNotLastAdmin` 같은 최소 권한 헬퍼. 단계 6에서 권한 모듈로 옮기기 쉽도록 분리. |

**서비스 레이어** (`apps/web/lib/services/`)

| 파일 | 내용 |
| --- | --- |
| `organization.ts` | 조직 생성 / 조회 / 수정. 자동 Admin 생성과 organization_settings 시드까지 한 트랜잭션. |
| `team.ts` | 팀 목록 / 생성 / 수정 / 아카이브. 외부 팀 ID 추측은 NOT_FOUND로 숨긴다. |
| `membership.ts` | 멤버십 목록(Admin 전용) / 역할 변경 / 팀 변경 / 비활성 / 재활성. Last-Admin 보호 사전 체크. |
| `invitation.ts` | 초대 생성 / 목록 / 취소 / 수락. 토큰은 sha256 해시로만 저장. |

**API 라우트** (`apps/web/app/api/`)

| 파일 | 내용 |
| --- | --- |
| `organizations/route.ts` | `POST /api/organizations` — 새 조직 만들기. |
| `organizations/[id]/route.ts` | `GET, PATCH /api/organizations/{id}`. |
| `organizations/[id]/teams/route.ts` | `GET, POST /api/organizations/{id}/teams`. |
| `organizations/[id]/teams/[teamId]/route.ts` | `PATCH /api/organizations/{id}/teams/{teamId}`. |
| `organizations/[id]/teams/[teamId]/archive/route.ts` | `POST .../teams/{teamId}/archive`. |
| `organizations/[id]/memberships/route.ts` | `GET .../memberships` (Admin 전용). |
| `organizations/[id]/memberships/[membershipId]/role/route.ts` | `PATCH .../role`. |
| `organizations/[id]/memberships/[membershipId]/team/route.ts` | `PATCH .../team`. |
| `organizations/[id]/memberships/[membershipId]/deactivate/route.ts` | `POST .../deactivate`. |
| `organizations/[id]/memberships/[membershipId]/reactivate/route.ts` | `POST .../reactivate`. |
| `organizations/[id]/invitations/route.ts` | `GET, POST .../invitations`. |
| `organizations/[id]/invitations/[invitationId]/cancel/route.ts` | `POST .../cancel`. |
| `invitations/accept/route.ts` | `POST /api/invitations/accept` — 로그인한 사용자가 자신의 초대를 수락. |

**테스트**

| 파일 | 내용 |
| --- | --- |
| `tests/integration/org-team-membership.test.ts` | 31 케이스. 조직 / 팀 / 멤버십 / 초대 모든 흐름과 정책을 실제 Postgres 위에서 검증. |

### 3.2 수정 (4개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/http.ts` | AuthError 외에 ApiError도 매핑하도록 `respondError` 도입. NOT_FOUND는 `reason_code`를 의도적으로 빼고 응답한다. |
| `apps/web/package.json` | `zod` 의존 추가. |
| `packages/mail/src/index.ts` | 초대 메일 템플릿(`buildInvitationMessage`) 추가. |
| `pnpm-lock.yaml` | 의존 변경 잠금 갱신. |

DB 스키마 / 마이그레이션 추가는 **없다.** Step 3의 9-table 디자인을 그대로 유지하면서 모든 기능을 구현했다.

---

## 4. 조직(Organization) 흐름

조직은 모든 권한과 데이터의 외곽 경계다. 한 사람은 동시에 한 조직에만 속할 수 있다.

### 4.1 생성 — `POST /api/organizations`

1. 로그인한 `Active` 사용자가 이름과(선택적으로) slug 를 보낸다.
2. 서버는 그 사용자가 이미 다른 조직에서 활성 멤버십을 가지고 있는지 확인한다. 있으면 `CONFLICT(already_in_organization)` 로 거절한다.
3. 한 트랜잭션 안에서 다음 세 가지가 같이 만들어진다.
   - `organizations` 행
   - 본인의 `Admin` 멤버십 (status = Active)
   - `organization_settings` 행 (defaultRole = `Editor`)
4. 결과적으로 **조직 생성자는 자동으로 Admin** 이 된다. 별도의 "처음 한 명을 Admin 으로 임명한다" 같은 단계가 없다.
5. slug 가 이미 다른 조직이 쓰고 있으면 `CONFLICT(slug_taken)` 으로 거절한다.

### 4.2 조회 — `GET /api/organizations/{id}`

- 그 조직의 활성 멤버만 볼 수 있다.
- 멤버가 아니거나 ID 자체가 존재하지 않으면 **둘 다 `NOT_FOUND`** 로 응답한다(Phase A §15: 다른 조직 자원은 존재 여부조차 노출하지 않는다).

### 4.3 수정 — `PATCH /api/organizations/{id}`

- Admin 만 가능. 그 외 역할은 `FORBIDDEN(admin_only)`.
- 현재는 이름 변경만 노출. slug 변경은 운영 방침상 보류.

---

## 5. 팀(Team) 흐름

팀은 조직 안의 작은 단위다. 부모 팀을 가질 수 있어 트리 구조가 가능하지만, **다른 종류의 부서(Department) 같은 것은 만들지 않는다.**

### 5.1 목록 — `GET .../teams`

- 그 조직의 활성 멤버라면 누구든 볼 수 있다.

### 5.2 생성 — `POST .../teams`

- Admin 만 가능. 이름 / 설명 / 부모 팀 / 매니저 사용자를 받는다.
- 부모 팀이나 매니저가 **다른 조직** 에 속한 ID 면 `NOT_FOUND` 로 숨긴다(직접 ID 추측 차단).

### 5.3 수정 — `PATCH .../teams/{teamId}`

- Admin 만 가능. 이름 / 설명 / 부모 팀 / 매니저를 부분 수정.
- 자기 자신을 부모 팀으로 지정하는 시도는 `INVALID_INPUT`.

### 5.4 아카이브 — `POST .../teams/{teamId}/archive`

- Admin 만 가능.
- 팀 행을 삭제하지 않고 `status = Archived` 로 바꾼다(데이터 보존). 이미 Archived 인 팀에 대해 다시 호출해도 그대로 반환(idempotent).

---

## 6. 멤버십(Membership) 흐름

멤버십은 "어떤 사용자가 어떤 조직에서 어떤 역할로 어떤 팀에 속해 있는가" 를 한 줄로 표현한 데이터다.

### 6.1 목록 — `GET .../memberships`

- **Admin 전용.** Phase B 의 멤버십 관리 API 는 운영 화면에 가깝기 때문에 Viewer / Editor / Manager 에게는 보여 주지 않는다(Codex 검증 단계에서 보정).

### 6.2 역할 변경 — `PATCH .../memberships/{id}/role`

- Admin 만 가능.
- Admin → 다른 역할로 강등하려는 시도는 다른 활성 Admin 이 한 명도 없으면 차단된다(Last-Admin 보호).

### 6.3 팀 변경 — `PATCH .../memberships/{id}/team`

- Admin 만 가능.
- `teamId` 는 **단일 컬럼**(`memberships.team_id`)이다. 이 단계에서는 다중-팀 조인 테이블을 만들지 않는다(1 user = 1 primary team).
- 외부 조직의 팀 ID 를 직접 넣는 시도는 `NOT_FOUND` 로 숨긴다(Codex 검증 단계에서 보정).

### 6.4 비활성화 — `POST .../memberships/{id}/deactivate`

- Admin 만 가능.
- `status = Disabled` 로 바꾼다(소프트 비활성, 데이터 보존).
- 비활성화 대상이 마지막 활성 Admin 이면 차단된다(Last-Admin 보호).

### 6.5 재활성화 — `POST .../memberships/{id}/reactivate`

- Admin 만 가능.
- 대상 사용자가 그동안 다른 조직의 활성 멤버가 됐다면 `CONFLICT(already_in_organization)` 로 거절한다. 1 user = 1 active membership 을 강제하기 위해서다.
- 그 외엔 `status = Active` 로 복원한다.

---

## 7. 초대(Invitation) 흐름

이메일 기반 1회용 초대 토큰을 사용한다. 토큰 자체는 메일 본문에만 한 번 들어가고, DB 에는 sha256 해시만 남는다(Step 4 와 같은 원칙).

### 7.1 생성 — `POST .../invitations`

- **Admin 만 가능.** Manager 가 호출하면 `FORBIDDEN(manager_cannot_invite)` 로 거절한다.
- 같은 이메일로 이미 Pending 초대가 있으면 `CONFLICT(invitation_pending)`.
- 그 이메일이 이미 그 조직의 활성 멤버이면 `CONFLICT(already_in_organization)`.
- 외부 조직의 팀 ID 를 teamId 로 넣는 시도는 `NOT_FOUND` (Codex 검증 단계에서 보정).
- 통과하면 32바이트 랜덤 토큰을 만들고, sha256 해시를 `invitations.token_hash` 에 저장하고, 원문 토큰은 메일 본문에 담아 전송한다.

### 7.2 목록 — `GET .../invitations`

- **Admin 전용.** Pending / Accepted / Expired / Revoked 모두 보여 준다.

### 7.3 취소 — `POST .../invitations/{invitationId}/cancel`

- **Admin 전용.**
- Pending 인 초대만 취소 가능. 그 외 상태에서 호출하면 `CONFLICT(invitation_not_pending)`.
- 취소되면 `status = Revoked` 로 바뀌고 토큰은 더 이상 수락되지 않는다.

### 7.4 수락 — `POST /api/invitations/accept`

1. 호출자는 **로그인한 Active 사용자** 여야 한다.
2. 토큰 원문을 받아 sha256 해시로 변환한 뒤 `invitations` 에서 찾는다.
   - 못 찾거나 **로그인한 사용자의 이메일이 초대 이메일과 다르면** 둘 다 `NOT_FOUND` 로 응답한다(토큰 enumeration 방지).
3. Pending 이 아니거나 만료됐으면 `FORBIDDEN(invitation_not_pending)` / `FORBIDDEN(invitation_expired)`.
   - 만료된 경우 그 자리에서 `status = Expired` 로 부수적으로 마킹한다.
4. 호출자가 이미 다른 조직의 활성 멤버이면 `CONFLICT(already_in_organization)`.
5. 통과하면 한 트랜잭션 안에서 다음이 같이 일어난다.
   - 새 멤버십 생성 (`status = Active`, 초대에 박혀 있던 role 과 teamId 그대로)
   - 초대를 `status = Accepted`, `acceptedAt = 지금` 으로 갱신
6. Pending 사용자(이메일 미확인)는 수락 자체가 막힌다(`FORBIDDEN(account_not_active)`).

---

## 8. Phase A / Phase B 잠금 결정의 API 레벨 강제

### 8.1 1 user = 1 active organization membership

데이터베이스에 이미 unique 인덱스(`uniq_active_membership_per_user`)가 있어 위반이 발생하면 막힌다. 다만 그것만 의존하면 사용자에게 가는 응답이 데이터베이스 에러 그대로가 된다. 그래서 다음 3 곳에서 API 레벨로 **사전** 체크한다.

- 조직 생성 시 — 이미 활성 멤버십이 있으면 `CONFLICT(already_in_organization)`.
- 멤버십 재활성화 시 — 대상 사용자에게 다른 활성 멤버십이 있으면 `CONFLICT(already_in_organization)`.
- 초대 수락 시 — 호출자에게 다른 활성 멤버십이 있으면 `CONFLICT(already_in_organization)`.

DB 인덱스는 그대로 두어 안전망 역할을 한다.

### 8.2 1 user = 1 primary team

`memberships.team_id` 라는 **단일 컬럼** 만 사용한다. 다중-팀 조인 테이블, Department 같은 다른 종류의 소속 객체는 만들지 않는다. 팀 변경 API 는 이 컬럼을 통째로 교체하거나 `null` 로 비울 뿐이다. 결과적으로 어떤 사용자도 동시에 두 팀의 "주(主)팀" 이 될 수 없다.

### 8.3 Manager 권한 제한

Phase A §15 에서 Manager 의 MVP 역할은 **Phase C 의 팀 문서 모더레이션** 으로 한정된다. Step 5(B 단계 관리 API)에서는 Manager 를 다음과 같이 막는다.

- 초대 생성 / 목록 / 취소 — Admin 전용 → Manager 호출 시 `FORBIDDEN(manager_cannot_invite)` 또는 `FORBIDDEN(admin_only)`.
- 팀 생성 / 수정 / 아카이브 — Admin 전용 → Manager `FORBIDDEN(admin_only)`.
- 멤버 역할 / 팀 / 비활성 / 재활성 — Admin 전용.
- 멤버십 목록 — Admin 전용.

Manager 는 본인 조직의 정보 일부(조직 조회, 팀 목록)만 읽을 수 있다. 변경은 어떤 것도 불가능하다.

### 8.4 Last-Admin 보호 (앱 레벨 4가지)

DB 트리거(`check_last_admin`)가 이미 막고 있지만, API 응답이 사람이 읽기 좋게 나가도록 같은 규칙을 앱 레벨에서도 사전 체크한다. 사전 체크가 통과하면 트리거에 도달하지 않고 정상 처리된다.

| 차단 대상 | 어디서 막히는가 |
| --- | --- |
| 마지막 Admin 강등 (`role` 변경) | `changeRole` 에서 `assertNotLastAdmin`. |
| 마지막 Admin 비활성화 (`status = Disabled`) | `deactivateMembership` 에서 `assertNotLastAdmin`. |
| 마지막 Admin 소프트 삭제 (`deletedAt` 설정) | 현재 Step 5 라우트는 노출하지 않지만, `assertNotLastAdmin` 헬퍼가 같은 로직으로 막아 둠. |
| 마지막 Admin 의 다른 조직 이전 (`organizationId` 변경) | API 가 노출하지 않는다(membership 의 organizationId 는 어떤 라우트도 수정 가능 항목으로 노출하지 않음). 트리거가 안전망. |

응답은 **항상** `FORBIDDEN(last_admin_protection)` 으로 통일한다.

---

## 9. NOT_FOUND vs FORBIDDEN 정책

이 두 가지는 의도적으로 의미가 다르다.

| 상황 | 응답 |
| --- | --- |
| 다른 조직의 자원 접근 (멤버가 아닌 조직 GET, 외부 조직의 멤버십 ID 추측, 외부 조직의 팀 ID 추측 등) | `NOT_FOUND` (reason_code 없음) |
| 비공개 / 권한 없는 리소스에 직접 ID 추측 | `NOT_FOUND` |
| 다른 사람의 초대 토큰 추측 또는 이메일이 일치하지 않는 토큰 수락 | `NOT_FOUND` |
| 로그인했지만 이 기능을 이 역할로는 못 함 (예: Editor 가 팀 생성) | `FORBIDDEN(admin_only)` 등 reason_code 명시 |
| Manager 가 초대 생성 | `FORBIDDEN(manager_cannot_invite)` |
| 마지막 Admin 보호에 걸림 | `FORBIDDEN(last_admin_protection)` |
| 이미 다른 조직 멤버라 새 조직/초대 수락 불가 | `CONFLICT(already_in_organization)` |

NOT_FOUND 응답은 **`reason_code` 자체를 일부러 빼고** `{ "error": "NOT_FOUND" }` 만 돌려준다. 그래야 클라이언트가 "권한이 없는 것" 과 "처음부터 존재하지 않는 것" 을 구별할 수 없다.

---

## 10. Codex 검증 중 보정한 내용

Codex 검증 단계에서 정책 일관성 관점에서 다음 4가지가 직접 보정됐다.

1. **`apps/web/lib/services/membership.ts` — 멤버십 목록을 Admin 전용으로 변경**
   - 기존: 활성 멤버라면 누구든 멤버 목록을 볼 수 있었음.
   - 보정 사유: 멤버십 목록은 Phase B 의 운영(관리) API 표면이다. Viewer / Editor / Manager 에게 노출하면 Manager 가 B 단계 관리 API 에 진입할 수 없다는 잠금 결정과 어긋난다.
   - 보정 후: `listMemberships` 가 `requireAdmin(acting)` 을 거치도록 변경.

2. **`apps/web/lib/services/team.ts` — 외부 조직의 parentTeamId / managerUserId 를 NOT_FOUND 로 변경**
   - 기존: 다른 조직의 팀 ID 또는 사용자 ID 가 입력되면 `INVALID_INPUT` 로 응답.
   - 보정 사유: `INVALID_INPUT` 은 "그런 ID 가 존재하지만 이 맥락에 맞지 않다" 처럼 들릴 수 있다. Phase A §15 의 직접 ID 추측 차단 정책에 따르면 외부 조직의 자원은 존재 여부 자체를 숨겨야 한다.
   - 보정 후: `assertTeamInOrg`, `assertActiveMember` 가 `Errors.notFound()` 를 던진다.

3. **`apps/web/lib/services/membership.ts` — 외부 teamId 를 NOT_FOUND 로 변경**
   - `changeTeam` 에서 외부 조직의 팀 ID 를 받았을 때 `NOT_FOUND` 로 응답하도록 동일하게 변경.

4. **`apps/web/lib/services/invitation.ts` — 외부 teamId 를 NOT_FOUND 로 변경**
   - `createInvitation` 에서 외부 조직의 팀 ID 를 받았을 때 `NOT_FOUND` 로 응답하도록 동일하게 변경.

또한 위 정책 보정을 검증하는 통합 테스트 3개가 추가됐다(테스트 총합 28 → 31). 보정 후 모든 검증 게이트가 다시 통과했다.

---

## 11. 테스트 / 검증 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm install` | OK | 의존 갱신 |
| `pnpm typecheck` | PASS | 10개 워크스페이스 |
| `pnpm lint` | PASS | ESLint 경고/에러 0 |
| `pnpm format` | PASS | Prettier `--check` 통과 |
| `pnpm test` (단위) | PASS | 4 파일 / 24 테스트 |
| `pnpm test:integration` | PASS | 6 파일 / 61 테스트 (이번 단계 신규 31) |
| `pnpm build` | PASS | 신규 16개 라우트 모두 등록 |
| `prisma validate` | PASS | 스키마 무변경 검증 |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

신규 통합 테스트 31 케이스 요약:

- 조직: Active 사용자 생성 + 자동 Admin + organization_settings 시드 / Pending·Disabled 사용자 차단 / 두 번째 활성 조직 차단 / 비-멤버 GET·PATCH 는 NOT_FOUND / 임의 ID 추측은 NOT_FOUND / Admin 만 이름 변경 가능
- 팀: Admin 의 생성·수정·아카이브 / Viewer 의 목록 조회 / Editor·Manager 의 변경 차단(admin_only) / 외부 조직 팀 작업은 NOT_FOUND
- 멤버십: 멤버십 목록은 Admin 전용 / 역할 변경 / 팀 변경 / 비활성·재활성 / 다른 조직 활성이면 재활성 차단 / Last-Admin 강등·비활성 차단 / 두 번째 Admin 이 있으면 강등 허용 / 외부 조직 멤버십 작업은 NOT_FOUND / 외부 teamId 는 NOT_FOUND
- 초대: Manager 의 생성 차단(manager_cannot_invite) / Admin 의 생성·목록·취소 / 메일 본문에 raw token 포함 / Editor 의 list·cancel 차단 / 본인 초대 수락 → membership Active + invitation Accepted / 다른 이메일 수락은 NOT_FOUND / Pending 사용자 수락 차단 / 이미 다른 조직 멤버는 CONFLICT / 만료된 초대 차단·Expired 마킹 / 알 수 없는 토큰은 NOT_FOUND / 외부 teamId 로 초대 생성 시 NOT_FOUND

---

## 12. 이번 단계에서 일부러 하지 않은 것

| 항목 | 어디서 다룸 |
| --- | --- |
| 권한 모듈(`packages/permissions`) 본 구현 | Step 6. 현재의 `apps/web/lib/permissions.ts` 헬퍼들을 그쪽으로 lift 하기 쉽도록 분리해 둠. |
| 관리자 화면 골격 | Step 7. |
| 활동 로그(ActivityLog) 본 구현 | Step 8. 현재 모든 mutation 은 활동 로그 기록 없이 진행됨. |
| 문서 / AI / Todo 기능 | 본 단계 범위 밖. |
| UI / 화면 / 폼 | Phase B 범위 밖. |
| DB 스키마 변경 | Step 3 의 9-table 디자인 그대로. 추가 / 변경 없음. |
| 조직 slug 변경 / 조직 삭제 / 조직 일시 정지 | 운영 정책 미정으로 보류. |
| 다중-팀 멤버십, Department, 부서별 권한 | Phase A §15 잠금 — 만들지 않음. |

---

## 13. 다음 단계로 넘어가기 전에 알아야 할 주의사항

1. **권한 체크는 현재 `apps/web/lib/permissions.ts` 한 곳에 모여 있다.** Step 6 에서 권한 모듈로 옮길 때 helper 시그니처(특히 `requireMembership`, `requireAdmin`, `assertNotLastAdmin`)를 유지하면서 `packages/permissions` 로 들어 올리는 방향이 가장 비용이 작다. 흩어진 if 문은 없다.

2. **활동 로그가 아직 비어 있다.** Step 5 의 mutation(조직 생성, 멤버십 변경, 초대 발송 등)은 아직 어떤 ActivityLog 행도 만들지 않는다. Step 8 에서 writer 가 들어가면, 이 단계에서 만든 모든 mutation 함수에 한 줄씩 호출이 추가된다(라우트 핸들러는 거의 손대지 않을 가능성이 높음).

3. **초대 메일은 여전히 진짜 발송이 아니다.** 개발 환경 / 테스트 환경에서는 콘솔 / 메모리 어댑터로 동작한다. staging / production 으로 넘어갈 때 `getMailAdapter()` 슬롯을 진짜 트랜잭셔널 메일 공급자로 갈아끼우면 된다(코드 변경 없음).

4. **조직 slug 는 한 번 정해지면 못 바꾼다.** Step 5 에서 PATCH 가 노출하는 필드는 이름뿐이다. URL / 외부 식별자로 slug 를 쓰는 운영 결정이 깔려 있다(Phase B). 이름 변경과 별개로 동작한다.

5. **Last-Admin 보호의 안전망은 DB 트리거다.** 앱 레벨 사전 체크가 빠지더라도 트리거가 RAISE 한다. 하지만 트리거가 보내는 에러 텍스트는 사용자에게 보여 줄 메시지가 아니므로, **새로운 mutation 라우트를 추가할 때 반드시 `assertNotLastAdmin` 을 먼저 호출해야 한다**(Step 6 권한 모듈로 옮길 때 이 규약을 유지할 것).

6. **NOT_FOUND 응답에는 `reason_code` 가 없다.** 이는 의도된 정책이다. 클라이언트 / 운영 도구가 `reason_code` 가 없는 응답을 처리할 때 "일반 NOT_FOUND" 로만 다루도록 합의해야 한다. NOT_FOUND 인데 reason_code 가 있으면 정책 위반이다.

7. **`pnpm build` 에 16개 라우트가 추가됐다.** 첫 빌드 후 페이지 트리에 `/api/organizations/...` 와 `/api/invitations/accept` 가 동적 라우트(`ƒ`)로 등록됐는지 확인하면 회귀를 빨리 잡을 수 있다.

이 7가지를 인지한 상태에서 Step 6(Permission Module)로 넘어가면 된다.

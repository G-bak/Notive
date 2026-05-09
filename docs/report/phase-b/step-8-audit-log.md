# Phase B — Step 8: 감사 로그 골격(Audit log skeleton) 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **8단계 — Audit log skeleton** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 4·5·6·7 에서 만든 인증·조직 관리 흐름이 **누가 언제 무엇을 했는가** 를 시스템에 남길 수 있도록, 기존 `activity_logs` 테이블 위에 골격 수준의 writer 와 조회 API 를 얹는 단계다. 비개발자도 이해할 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)
- [Step 4 — Auth / session](./step-4-auth-session.md)
- [Step 5 — Organization / Team / Membership](./step-5-org-team-membership.md)
- [Step 6 — Permission Module](./step-6-permission-module.md)
- [Step 7 — Admin skeleton](./step-7-admin-skeleton.md)

---

## 2. Step 8의 목적

Step 7 까지 만들어진 모든 mutation 흐름(가입, 로그인, 조직 생성, 팀 / 멤버십 / 초대 변경 등) 은 사용자에게 즉시 결과를 돌려준다. 그러나 시간이 지나서 "이 사용자가 어제 어떤 역할로 바뀌었지?" 같은 질문이 나올 때, 답을 찾을 곳이 없다. Step 8 의 목적은 다음과 같다.

- Step 4·5·7 에서 일어나는 **15가지 핵심 이벤트** 를 한 줄짜리 기록으로 남긴다.
- 기록은 **이미 Step 3 에서 만든 `activity_logs` 테이블** 만 쓴다. 새 테이블이나 마이그레이션은 없다.
- 기록 실패가 사용자 작업을 깨뜨리지 않게 만든다(**best-effort**).
- Admin 이 자기 조직의 기록을 조회할 수 있는 **단일 API endpoint** 를 만든다.
- Phase G 수준의 본격 감사 시스템(쿼리 가능한 분석 엔진, 재시도 큐, 보존 정책 등)으로 확장하지 않는다 — 이번 단계는 **골격(skeleton)** 까지만.

UI / 화면은 만들지 않는다. 운영자는 API 를 직접 호출하거나 후속 단계에서 붙을 화면을 통해 조회한다.

---

## 3. 추가 / 수정한 파일

### 3.1 신규 (4개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/audit/index.ts` | `Actions` 상수(15개 이벤트의 안정 식별자), `AuditEvent` / `AuditAction` / `AuditTargetType` 타입, `recordActivity` (best-effort 쓰기), `findActiveOrganizationForUser` (사용자의 활성 조직 해석). |
| `apps/web/lib/services/activity-log.ts` | `listActivityLogs` — Admin 전용 조회. cross-org / 비-멤버는 NOT_FOUND, 비-Admin 멤버는 FORBIDDEN(`admin_only`). limit 기본 100 / 상한 200 으로 clamp. |
| `apps/web/app/api/organizations/[id]/activity-logs/route.ts` | `GET` 핸들러. `?limit=N` 파라미터 지원. |
| `tests/integration/audit-log.test.ts` | 13 케이스 — 각 이벤트 기록 / 조회 권한 정책 / 정렬 / clamp 검증. |

### 3.2 수정 (7개) — Step 4·5·7 흐름에 audit 호출 부착

| 파일 | 추가된 호출 |
| --- | --- |
| `apps/web/lib/services/organization.ts` | `createOrganization` / `updateOrganization` 끝에 `recordActivity`. |
| `apps/web/lib/services/team.ts` | `createTeam` / `updateTeam` / `archiveTeam` 끝에. |
| `apps/web/lib/services/membership.ts` | `changeRole` / `changeTeam` / `deactivateMembership` / `reactivateMembership` 끝에. |
| `apps/web/lib/services/invitation.ts` | `createInvitation` / `cancelInvitation` / `acceptInvitation` 끝에. |
| `apps/web/app/api/auth/login/route.ts` | 로그인 성공 후 actor 의 활성 조직을 해석해 `auth.login` 기록. |
| `apps/web/app/api/auth/logout/route.ts` | 세션 revoke **이전** 에 actor 를 해석해 두고, 로그아웃 후 `auth.logout` 기록. |
| `apps/web/app/api/auth/password-reset/confirm/route.ts` | 재설정 성공 후 사용자의 활성 조직을 해석해 `auth.password_reset.completed` 기록. |

DB 스키마 / 마이그레이션 / Auth 패키지 / Permission 모듈 / Step 6 의 어떤 코드도 변경하지 않았다.

---

## 4. ActivityLog writer 구조

`apps/web/lib/audit/index.ts` 가 단일 진입점이다. 외부에 노출되는 표면은 두 가지뿐.

```ts
// 1) 기록하기 — 항상 실패해도 안전.
await recordActivity(prisma, {
  organizationId,           // 필수
  actorUserId,              // 필수 (없으면 null)
  action: Actions.TEAM_CREATED,  // 안정 식별자
  targetType: "team",       // 선택
  targetId: team.id,        // 선택
  result: "Success",        // 기본 Success
  metadata: { name: "Eng" } // 선택, JSON
});

// 2) actor 의 활성 조직 해석 — auth 이벤트용.
const orgId = await findActiveOrganizationForUser(prisma, userId);
```

`Actions` 상수는 **`category.verb` 형식의 dotted string** 15개로 고정돼 있다. 새 이벤트가 필요해지면 이 상수를 확장한다 — 기존 값 이름 변경은 외부 클라이언트와의 계약 위반이 되므로 금지한다.

write 시 `prisma.activityLog.create({ data })` 한 번만 호출한다. 결과적으로 `activity_logs` 한 행이 늘어난다 — 같은 트랜잭션이 아니라 **별개 쿼리** 로 이루어진다(아래 best-effort 정책 때문).

---

## 5. best-effort 기록 정책

`recordActivity` 의 본체는 다음과 같다.

```ts
try {
  return await prisma.activityLog.create({ data: { ... } });
} catch (err) {
  console.error("[audit] failed to record event", { action, err });
  return null;
}
```

이 정책은 다음을 보장한다.

1. **사용자 작업이 audit 실패로 인해 깨지지 않는다.** 예: DB 디스크가 가득 차서 audit 행 INSERT 가 실패해도, 사용자의 조직 생성 / 로그인 / 비밀번호 재설정은 정상적으로 끝난다.
2. **로그는 stderr 에 한 줄 남는다.** 운영자는 표준 로그 수집기로 이 줄을 잡아 alert 를 걸 수 있다.
3. **반환값으로 실패가 노출된다.** 테스트는 반환된 행이 `null` 인지로 audit 성공 여부를 직접 검증할 수 있다.

서비스 레이어에서는 `await recordActivity(...)` 를 그대로 호출한다 — try/catch 가 필요 없다. audit 호출이 본 트랜잭션 안에 들어가지 않는 이유도 이것 — 본 작업은 이미 commit 됐고, audit 만 별도로 떨어진 셈이다.

이 정책은 의도적으로 **약한 보장** 이다. Phase G 수준에서 "모든 변경은 반드시 감사 로그를 남긴다" 같은 강한 보장이 필요해지면 트랜잭션 안에 audit 를 넣거나, 실패 시 재시도 큐로 보내는 방식으로 강화한다. 본 단계는 골격 수준이라 거기까지 가지 않는다.

---

## 6. 기록하는 15개 이벤트

| Action 식별자 | 발생 위치 | 액터 | targetType / targetId | metadata |
| --- | --- | --- | --- | --- |
| `auth.login` | login 라우트 성공 후 | 로그인 사용자 | user / userId | (없음) |
| `auth.logout` | logout 라우트, revoke 전 actor 해석 후 | 로그아웃 사용자 | user / userId | (없음) |
| `auth.password_reset.completed` | password-reset/confirm 성공 후 | 사용자 | user / userId | (없음) |
| `organization.created` | createOrganization 끝 | 조직 생성자 (Admin 으로 자동 가입) | organization / org.id | `{ name, slug }` |
| `organization.updated` | updateOrganization 끝 | Admin | organization / org.id | `{ name }` |
| `team.created` | createTeam 끝 | Admin | team / team.id | `{ name }` |
| `team.updated` | updateTeam 끝 | Admin | team / team.id | `{ name }` |
| `team.archived` | archiveTeam 끝 | Admin | team / team.id | (없음) |
| `membership.role_changed` | changeRole 끝 | Admin | membership / id | `{ from, to }` |
| `membership.team_changed` | changeTeam 끝 | Admin | membership / id | `{ from, to }` |
| `membership.deactivated` | deactivateMembership 끝 | Admin | membership / id | (없음) |
| `membership.reactivated` | reactivateMembership 끝 | Admin | membership / id | (없음) |
| `invitation.created` | createInvitation 끝 | Admin | invitation / id | `{ email, role }` |
| `invitation.cancelled` | cancelInvitation 끝 | Admin | invitation / id | `{ email, role }` |
| `invitation.accepted` | acceptInvitation 트랜잭션 후 | 수락한 사용자 | membership / 신규 membership.id | `{ invitationId, role }` |

설계 결정 두 가지를 짚어둔다.

- **invitation.accepted 의 target 은 invitation 이 아니라 새 membership 이다.** 수락의 결과물(=새 멤버십) 이 가장 중요한 식별자이고, 원본 초대는 `metadata.invitationId` 로 남긴다.
- **모든 mutation 흐름의 actor 는 "변경을 일으킨 사람"** 이다. 즉 changeRole 의 actor 는 Admin, invitation.accepted 의 actor 는 수락한 본인이다. "대상이 누구인가" 는 targetType/targetId 로 구별한다.

---

## 7. auth 이벤트가 "활성 조직이 있는 사용자" 만 기록되는 이유

`activity_logs.organization_id` 컬럼은 Step 3 schema 에서 **NOT NULL** 로 박혀 있다(외래 키 + Phase A §15 의 "모든 자료는 조직 경계 안에서 기록된다" 잠금). 따라서 audit 한 행을 만들려면 항상 어떤 조직 ID 가 필요하다.

그런데 인증 이벤트(`auth.login`, `auth.logout`, `auth.password_reset.completed`) 는 사용자 단독 행위이지 조직 행위가 아니다. 사용자가 가입만 하고 어떤 조직에도 들어가기 전에 로그인하면, "어느 조직 아래에 이 로그를 남겨야 하는가?" 라는 답이 없다.

이번 단계의 결정은:

> 사용자에게 **활성 멤버십** 이 있으면, 그 조직 아래에 auth 이벤트를 기록한다. 없으면 기록하지 않는다.

`findActiveOrganizationForUser(prisma, userId)` 가 이 판정을 한다 — 결과가 `null` 이면 라우트 핸들러가 audit 호출을 건너뛴다. 사용자에게는 정상 응답이 나가지만 audit 행은 남지 않는다.

이렇게 한 이유:

1. **schema 변경 회피.** `organizationId` 를 nullable 로 바꾸려면 마이그레이션 + 인덱스 재정비 + 모든 조회 쿼리 갱신이 필요하다. 본 단계는 마이그레이션 금지이므로 schema 를 우회한다.
2. **Phase A §15 의 잠금 결정 정합.** 1 user = 1 active organization 이 정착되면 사실상 모든 운영 사용자는 활성 조직을 갖는다 — auth 이벤트가 대부분 기록된다.
3. **운영상 큰 손실이 없다.** 활성 멤버십 없는 사용자의 auth 활동은 본질적으로 "아직 시스템에 들어오지 않은 단계" 라 운영 분석 가치가 낮다.

남은 리스크는 §12 에서 다룬다.

---

## 8. GET /api/organizations/{id}/activity-logs

조회 API 의 명세:

| 항목 | 값 |
| --- | --- |
| 메서드 / 경로 | `GET /api/organizations/{id}/activity-logs` |
| 권한 | **Admin 전용**. Manager / Editor / Viewer 는 `FORBIDDEN(admin_only)`. |
| 비-멤버 / 임의 ID 추측 | `NOT_FOUND` (reason_code 없음). |
| 쿼리 파라미터 | `?limit=N` — 기본 100, 1 미만 / 비숫자는 100 으로 fallback, 200 초과는 200 으로 clamp. |
| 정렬 | `createdAt` 내림차순(최신순). |
| 응답 본문 | `{ "entries": [{ id, action, actorUserId, targetType, targetId, result, metadata, createdAt }, ...] }` |

응답 shape 는 명시 화이트리스트다. 미래에 `activity_logs` 컬럼이 추가되더라도 자동으로 노출되지 않는다 — 명시적으로 `listActivityLogs` 안의 매핑을 고쳐야 한다.

권한 진입은 Step 6 의 `requireMembership` + `requireAdmin` 두 줄로 끝난다 — 인라인 if 분기 없음. Admin 정책이 바뀌면 `@notive/permissions` 한 곳만 고치면 된다.

---

## 9. NOT_FOUND / FORBIDDEN 응답 기준

Step 6 envelope 정책을 그대로 따른다.

| 상황 | 응답 본문 | HTTP |
| --- | --- | --- |
| 비-멤버가 조회 시도 / 임의 UUID 추측 | `{ "error": "NOT_FOUND" }` (reason_code 없음) | 404 |
| Manager / Editor / Viewer 가 조회 시도 | `{ "error": "FORBIDDEN", "reason_code": "admin_only" }` | 403 |
| 세션이 없거나 만료 / 사용자 비활성 | `{ "error": "UNAUTHORIZED", "reason_code": "UNAUTHORIZED" }` | 401 |

NOT_FOUND 응답에 `reason_code` 가 없는 정책은 코드 레벨에서 강제된다 — `Errors.notFound()` 가 reason 인자를 받지 않으므로 우회가 어렵다.

---

## 10. DB 스키마 / 마이그레이션을 바꾸지 않은 이유

세 가지가 있다.

1. **지시 사항.** Step 8 작업 지시에서 "기존 `activity_logs` 테이블을 사용하고 DB 스키마/마이그레이션은 새로 추가하지 마라." 가 명시됐다.
2. **schema 가 이미 충분하다.** Step 3 에서 만든 `activity_logs` 는 `id, organizationId, actorUserId, action, targetType, targetId, result, metadata(Json), ipAddress, userAgent, createdAt` 컬럼을 가진다 — 이번 단계가 필요로 하는 모든 필드가 있다.
3. **schema 변경은 운영 부담.** 스테이징 / 프로덕션 DB 에 마이그레이션을 적용하려면 잠금 / 백업 / 회귀 검증이 필요하다. 골격 단계에서 그 부담을 지지 않고, 진짜 필요해질 때(Phase G 단계 등) 한 번에 처리한다.

`organization_id` 가 NOT NULL 이라 시스템-레벨 이벤트(특정 조직에 매이지 않는 로그) 는 기록할 수 없다 — 이는 §7 / §12 에서 다룬 의식적 한계다.

---

## 11. 실행한 검증 명령과 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm install` | OK | 의존 변경 없음 |
| `pnpm typecheck` | PASS | 10개 워크스페이스 |
| `pnpm lint` | PASS | ESLint 경고 / 에러 0 |
| `pnpm format` | PASS | Prettier `--check` 통과 |
| `pnpm test` (단위) | PASS | 5 파일 / 43 테스트 (기존 그대로) |
| `pnpm test:integration` | PASS | 8 파일 / 87 테스트 (Step 8 신규 13) |
| `pnpm build` | PASS | `/api/organizations/[id]/activity-logs` 등록 확인 |
| `prisma validate` | PASS | 스키마 무변경 검증 |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

신규 통합 테스트 13 케이스 핵심:

- **조직 / 팀 / 멤버십 / 초대 / 인증 5 도메인** × 각 이벤트 — 적절한 actor / targetType / targetId / metadata 가 기록되는지
- **invitation.accepted** 가 새 membership 을 target 으로 잡고 metadata 에 invitationId 를 넣는지
- **auth.login / auth.logout / auth.password_reset.completed** 가 사용자의 활성 organization 아래 기록되는지
- **listActivityLogs**: Admin 통과 / 비-Admin (Editor / Manager / Viewer) FORBIDDEN(`admin_only`) / 비-멤버·임의 UUID NOT_FOUND / 시간 역순 정렬 / cross-org 누설 없음 / `limit > 200` clamp

기존 단위 43 + 통합 74 = 117 개의 Step 4·5·6·7 테스트가 audit hook 추가에도 **그대로 통과** 한다 — Step 8 의 hook 이 기존 동작을 깨뜨리지 않음을 보장한다.

---

## 12. 일부러 하지 않은 것

| 항목 | 사유 |
| --- | --- |
| Phase G 수준 감사 시스템 | 본 단계는 골격 수준이다. 보존 정책 / 보안 모니터링 / 분석 엔진 / 검색 인덱스 등은 Phase G 또는 별도 보안 단계에서. |
| 재시도 큐 / 트랜잭션-보장 기록 | best-effort 정책상 의도적 미구현. audit 실패 시 stderr 만 찍는다. 강한 보장이 필요해지면 BullMQ / Outbox 패턴으로 확장. |
| IP / User-Agent 기록 | schema 컬럼은 있지만 본 단계에서 채우지 않는다. 요청 객체에서 추출하는 헬퍼 도입은 별도 작업(보안 / GDPR 검토 포함). 모든 행이 둘 다 NULL. |
| 실패 이벤트 (`result: Failed`) | 로그인 실패 / 권한 거절 / 스로틀링 같은 부정적 이벤트는 본 단계에서 로깅하지 않는다. 보안 모니터링 단계에서 추가 검토. |
| UI / 화면 / React 페이지 | 본 단계 범위 밖. 운영자는 API 직접 호출 또는 후속 단계에서 붙는 화면을 통해 조회. |
| DB schema / migration 추가 | §10 참조. |
| Document / AI / Todo 흐름의 audit hook | Phase B 범위 밖. 해당 흐름이 만들어질 때 같은 패턴(`recordActivity` 호출)을 따른다. |
| `findActiveOrganizationForUser` 의 캐싱 | 의도적 미구현. 매 audit 호출마다 한 번의 DB 조회가 일어남. 운영에서 hot path 로 드러나면 그때 메모이제이션. |
| `?cursor` 기반 페이지네이션 | 본 단계는 limit + 최신순까지만. 운영에서 페이지 요구가 생기면 cursor 파라미터로 확장. |

---

## 13. 남은 리스크와 다음 단계 주의사항

1. **활성 멤버십 없는 사용자의 auth 이벤트는 기록되지 않는다.** §7 의 의식적 한계. 가입 직후 / 초대 수락 전 / 비활성화된 사용자의 로그인·로그아웃은 audit 에 잡히지 않는다. 운영 / 보안 검토에서 시스템-레벨 이벤트 로깅이 필요해지면 schema 변경(`organizationId` nullable) 또는 별도의 `system_events` 테이블 도입이 필요하다.

2. **audit 호출이 라우트 / 서비스 레이어에 인라인** 으로 박혀 있다. `packages/auth` / Step 5 서비스 레이어가 audit 모듈에 의존하지 않게 라우트에서 호출하도록 둔 결정이다. 새 인증 흐름(2FA, OAuth, magic link 등) 또는 새 mutation 서비스가 추가될 때 **반드시 같은 패턴(말단에서 `recordActivity` 호출)을 따라야 한다.** 누락되면 그 이벤트는 영원히 기록되지 않는다.

3. **best-effort 정책**: audit DB 쓰기가 실패하면 stderr 에 `[audit] failed to record event` 한 줄만 남고 사용자 응답에는 영향이 없다. 운영 로그 수집기에서 이 패턴을 alert 로 걸어 두는 것을 권장한다.

4. **`Actions` 상수의 식별자는 안정 계약이다.** 새 값을 추가는 가능, 기존 값의 이름 변경은 금지. 변경 시 외부 분석 도구 / 운영자가 보던 값이 깨진다.

5. **`activity_logs` 의 보존 / 보관 정책이 없다.** 행 수가 무한히 늘어난다. 운영 단계에서 보존 기간(예: 1년) + 아카이빙 정책이 필요하다. 본 단계는 단순 INSERT 만 한다.

6. **invitation.accepted 의 actor 가 수락자(=새 멤버) 라는 결정은 의도적이다.** "초대를 만든 Admin" 이 actor 가 아님에 주의 — Admin 의 역할은 `invitation.created` 행에 이미 기록돼 있다. 두 행을 묶어 보면 초대의 전체 이력이 보인다.

7. **`limit` 상한 200 / 기본 100** 은 임의 결정. UI 설계가 굳어지면 적절한 값으로 조정한다. 클라이언트 입장에서는 `limit` 을 명시하지 않으면 100 개가 돌아온다고 가정해야 한다.

이 7가지를 인지한 상태에서 Phase B 의 마지막 9 단계로 넘어가거나, Phase B 종결 후 Phase C 로 진입하면 된다.

# Phase B — Step 9: 테스트 / CI 게이트 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **마지막 9단계 — Tests / CI gate** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1 ~ 8 에서 만들어 둔 기능 위에 **자동화된 품질 게이트** 를 얹고, Phase B §16 권한 테스트 체크리스트가 충분히 반영됐는지 점검·보강하는 단계다. 비개발자도 이해할 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)
- [Step 4 — Auth / session](./step-4-auth-session.md)
- [Step 5 — Organization / Team / Membership](./step-5-org-team-membership.md)
- [Step 6 — Permission Module](./step-6-permission-module.md)
- [Step 7 — Admin skeleton](./step-7-admin-skeleton.md)
- [Step 8 — Audit log skeleton](./step-8-audit-log.md)

Step 9 가 통과하면 **Phase B 의 9 단계가 모두 완료** 된다.

---

## 2. Step 9의 목적

Step 1 ~ 8 에서 만든 인증·조직·권한·관리·감사 기능은 각자 자체 통합 테스트를 가지고 있다. 그러나 다음 두 가지가 비어 있었다.

1. **자동 실행 환경.** 누군가 PR 을 올렸을 때 같은 검증이 자동으로 돌아가는 장치(CI) 가 없다 — 개발자 로컬에서만 실행되는 상태였다.
2. **§16 체크리스트의 마지막 누락.** Phase B 문서 §16 의 7 그룹 / 24 시나리오 중 **두 가지** 가 명시 테스트로 박혀 있지 않았다 — Disabled 사용자 로그인 차단, 세션 absolute TTL cap, cross-org 초대 생성 차단.

Step 9 의 목적은 다음과 같다.

- 위 두 가지 누락을 채우고, **§16 체크리스트가 코드로 검증되도록** 만든다.
- GitHub Actions 워크플로우 1 개를 만들어 **누구나 같은 게이트를 통과** 해야 develop / main 에 들어갈 수 있게 한다.
- 새 기능을 추가하거나 기존 동작을 리팩터링하지 않는다 — 본 단계의 표면은 **테스트 + CI 스크립트** 까지로 의도적으로 좁힌다.

---

## 3. 추가 / 수정 / 삭제한 파일

### 3.1 신규 (1개)

| 파일 | 내용 |
| --- | --- |
| `.github/workflows/ci.yml` | Notive 단일 CI 워크플로우. install / typecheck / lint / format / test / test:integration / build 를 한 job 으로 실행. |

### 3.2 수정 (2개) — §16 체크리스트 보강

| 파일 | 추가된 케이스 |
| --- | --- |
| `tests/integration/auth-flow.test.ts` | "login on a Disabled user reports ACCOUNT_DISABLED only after correct password", "session validation clamps renewal to the absolute TTL cap" — 2 개 신규. |
| `tests/integration/org-team-membership.test.ts` | "Admin of org A cannot create an invitation for org B (NOT_FOUND)" — 1 개 신규. |

### 3.3 삭제

없음.

DB 스키마 / 마이그레이션 / 서비스 / 라우트 / 권한 모듈 / Auth 패키지 변경은 **하나도 없다.** 새 기능 0 건.

---

## 4. CI workflow 구성

`.github/workflows/ci.yml` 한 파일이 모든 게이트를 담당한다. 핵심 설정은 다음과 같다.

| 항목 | 값 |
| --- | --- |
| 트리거 | `push` to `main` / `develop`, PR targeting `main` / `develop` |
| 동시성 제어 | 같은 ref 의 in-progress 실행은 자동 cancel (`concurrency.cancel-in-progress`). |
| 환경 | Ubuntu latest |
| Node | 20 LTS — `engines.node: ">=20.11.0"` 와 일치 |
| pnpm | `9.15.9` — `package.json` 의 `packageManager` 핀과 일치 |
| 타임아웃 | 20 분 |
| 외부 서비스 | **없음**. 통합 테스트가 `embedded-postgres` 로 자체 DB 를 부팅하므로 GitHub Actions secrets / Postgres service container 가 필요 없다. |

이 워크플로우는 개발자가 로컬에서 실행하는 명령 그대로 실행한다. CI 와 로컬의 결과가 **항상 같다** 는 점이 중요한 설계 결정이다 — "내 머신에서는 통과하는데" 같은 분기를 의도적으로 막는다.

---

## 5. CI 에서 실행하는 명령 순서

CI 가 실행하는 명령은 정확히 7 가지이며, 순서는 의도적으로 빠른 게이트가 먼저 떨어지도록 정렬됐다.

| 순번 | 명령 | 의도 |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 의존 변경이 lockfile 에 반영됐는지 확인. lockfile 과 다르면 실패. |
| 2 | `pnpm typecheck` | TypeScript 타입 오류가 없는지 (10 개 워크스페이스 모두). |
| 3 | `pnpm lint` | ESLint 룰 위반이 없는지. |
| 4 | `pnpm format` | Prettier `--check` — 포맷 어긋난 파일이 있으면 실패. |
| 5 | `pnpm test` | 단위 테스트 (vitest) — 5 파일 / 43 테스트. |
| 6 | `pnpm test:integration` | 통합 테스트 (vitest + embedded-postgres) — 8 파일 / 90 테스트. |
| 7 | `pnpm build` | Next.js + Worker 빌드. 라우트 등록 / SSR 환경에서의 임포트 오류 같은 런타임 가까운 문제를 잡는다. |

### 5.1 prisma migrate deploy 는 어디 있는가

전용 step 으로 분리하지 않았다. 그 이유는:

- 통합 테스트의 `global-setup` (`tests/integration/src/global-setup.ts`) 이 매 실행마다 **embedded-postgres 를 클린 DB 로 부팅** 하고, 그 위에 `prisma migrate deploy --schema packages/db/prisma/schema.prisma` 를 실행한다.
- 따라서 `pnpm test:integration` 한 단계가 곧 "마이그레이션이 깨끗한 DB 위에서 정상 적용되는지" 를 검증한다. 마이그레이션이 깨지면 통합 테스트 시작 단계에서 즉시 실패한다.
- 결과적으로 **prisma migrate deploy 게이트 + 통합 테스트 게이트** 가 한 명령에 묶여 있다.

별도 단계로 분리해도 무방하지만 본 단계에서는 명령 수를 늘리지 않는 쪽을 선택했다.

### 5.2 build 단계가 `.env` 없이 동작하는 이유

Step 4 의 Codex 보정으로 `apps/web/lib/env.ts` 는 **import 시점에 검증하지 않고**, 서버 시작 시점에 `instrumentation.ts` 가 명시적으로 `getEnv()` 를 호출해 검증한다. 따라서 `next build` 는 실제 환경 변수 없이도 통과한다 — CI 에 비밀 환경변수 주입이 필요 없다.

---

## 6. Phase B §16 체크리스트와 테스트 매핑

§16 의 7 그룹 / 24 시나리오 와 현재 통합 / 단위 테스트 매핑.

### 6.1 Auth (§16.1, 5 항목)

| 시나리오 | 매핑 |
| --- | --- |
| Cannot log in with unverified email | `auth-flow.test.ts` — "login on a Pending user reports EMAIL_NOT_VERIFIED only after correct password" |
| Cannot log in to a Disabled account | **`auth-flow.test.ts` (Step 9 신규)** — "login on a Disabled user reports ACCOUNT_DISABLED only after correct password" |
| Cannot log in with a password that fails policy | `auth-flow.test.ts` — "rejects weak passwords at signup" + 단위 `auth-password.test.ts` |
| Session expires after idle / absolute window | `auth-flow.test.ts` — "rejects an expired session" + **"clamps renewal to the absolute TTL cap" (Step 9 신규)** |
| Logout invalidates session both server-side and in cookie | `auth-flow.test.ts` — "login + /me + logout end to end" |

### 6.2 Cross-org isolation (§16.2, 3 항목)

| 시나리오 | 매핑 |
| --- | --- |
| Org A 사용자 → Org B 자원 NOT_FOUND | `org-team-membership.test.ts` — `getOrganization`, `updateTeam`, `changeRole` 등 다수 |
| Org A 사용자 → Org B 초대 생성 차단 | **`org-team-membership.test.ts` (Step 9 신규)** — "Admin of org A cannot create an invitation for org B (NOT_FOUND)" |
| Direct ID guess → NOT_FOUND | `org-team-membership.test.ts` + `admin-skeleton.test.ts` 다수 |

### 6.3 Role-based access (§16.3, 4 항목)

| 시나리오 | 매핑 |
| --- | --- |
| Viewer → AI 메뉴 차단 | (Phase B 범위 밖, AI 미존재 — Phase D 이후) |
| Editor → Admin 메뉴 차단 | `admin-skeleton.test.ts` — "Manager / Editor / Viewer all get FORBIDDEN(admin_only)" |
| Manager → admin endpoint 차단 | `admin-skeleton.test.ts` 동일 + `org-team-membership.test.ts` "Manager cannot create invitations" |
| Admin → org-management endpoint 통과 | `admin-skeleton.test.ts` + `org-team-membership.test.ts` 다수 |

### 6.4 Last-Admin protection (§16.4, 5 항목)

| 시나리오 | 매핑 |
| --- | --- |
| 마지막 Admin 강등 차단 | `org-team-membership.test.ts` + `admin-skeleton.test.ts` "blocks demotion" |
| 마지막 Admin 비활성 차단 | `org-team-membership.test.ts` + `admin-skeleton.test.ts` "blocks deactivation" |
| 마지막 Admin 멤버십 제거 차단 | `last-admin-protection.test.ts` (DB 트리거 직접 검증) |
| 마지막 Admin 다른 조직 이전 차단 | `last-admin-protection.test.ts` (DB 트리거) — 라우트는 organizationId 변경을 노출하지 않음 |
| 모두 FORBIDDEN(`last_admin_protection`) | 위 항목들에서 reason_code 일치 확인 |

### 6.5 Membership uniqueness (§16.5, 3 항목)

| 시나리오 | 매핑 |
| --- | --- |
| 다른 조직 활성 시 초대 수락 차단 | `auth-flow.test.ts` + `org-team-membership.test.ts` |
| (user_id, organization_id) DB 유니크 | `active-membership.test.ts` |
| 활성 멤버십 partial unique | `active-membership.test.ts` (Step 3 마이그레이션) |

### 6.6 Audit log writes (§16.6, 5 항목)

| 시나리오 | 매핑 |
| --- | --- |
| Login 성공 / 실패 이벤트 | `audit-log.test.ts` (성공만 — 실패 이벤트는 Step 8 §12 의식적 미구현) |
| Invite create / accept / revoke | `audit-log.test.ts` |
| Role change | `audit-log.test.ts` |
| User disable / enable | `audit-log.test.ts` (membership.deactivated / .reactivated) |
| 각 entry: actor / target / action / result / IP / UA / timestamp | `audit-log.test.ts` (IP / UA 미기록 — Step 8 §12 의식적 한계) |

### 6.7 Infra readiness (§16.7, 3 항목)

| 시나리오 | 매핑 |
| --- | --- |
| Redis healthcheck | (Phase D 에서 도입 예정 — Phase B 잠금에 따라 MVP 미연결) |
| Cleanup worker dry-run | `apps/worker` 골격 존재. 본격 dry-run 검증은 운영 단계 |
| Mail provider staging 배달 | (수동 smoke / 운영 단계 검증) |

§16.7 은 운영 / 스테이징 환경에서만 검증 가능한 항목이며 CI 게이트 범위 밖이다. 별도 운영 체크리스트로 관리한다.

---

## 7. 이번에 보강한 테스트 3 개

### 7.1 `login on a Disabled user reports ACCOUNT_DISABLED only after correct password`

**§16.1** "Cannot log in to a Disabled account."

- 사용자 가입 + 이메일 인증 + Disabled 로 상태 변경.
- 잘못된 비밀번호 → `INVALID_CREDENTIALS` (열거 차단 — Active 사용자와 동일한 응답).
- 올바른 비밀번호 → `ACCOUNT_DISABLED` (사용자에게 "비활성 계정" 임을 알림).

타이밍 차이로 이메일 존재 여부가 새지 않도록 `login()` 이 비밀번호 검증 후에만 상태를 본다는 정책 (Step 4) 을 코드로 박는 테스트.

### 7.2 `session validation clamps renewal to the absolute TTL cap`

**§16.1** "Session expires after the configured idle / absolute window."

세션 absolute TTL cap 의 동작을 정확히 박는 테스트.

- 세션 생성 후 `createdAt` 을 absolute cap (30 일) 너머로 옮김 (사용자가 30 일 이상 세션을 유지한 시나리오 시뮬레이션).
- `validateSession` 1 회 호출 → 갱신된 `expiresAt` 이 `createdAt + absoluteDays` 까지만 클램프됨을 검증 → 즉, 갱신된 expiresAt 은 과거가 됨.
- 다음 `validateSession` 호출 → 거절 (`UNAUTHORIZED`).

핵심: **현재 구현은 갱신 시점에 `createdAt + absoluteDays` 로 expiresAt 을 clamp 한다.** 정상적인 사용 경로에서 세션이 absolute cap 을 넘겨 유지될 수 없다 — 갱신을 거치는 모든 후속 요청은 즉시 거절된다.

### 7.3 `Admin of org A cannot create an invitation for org B (NOT_FOUND)`

**§16.2** "Trying to invite into org B from a user with active membership only in org A is rejected."

- 사용자 a 는 OrgA 의 Admin, 사용자 b 는 OrgB 의 Admin. 두 사람은 서로 다른 조직 소속.
- a 가 OrgB 에 초대 만들기 시도 → `NOT_FOUND` (FORBIDDEN 이 아님 — Phase A §15 직접 ID 추측 차단 정책).
- 메일도 발송되지 않음을 검증 (`mail.messages.length === 0`).

§16.2 는 cross-org 차단을 가장 명시적으로 박는 정책이다. 권한 모듈의 `requireMembership` 이 정확히 이 동작을 제공함을 라우트 레벨까지 확인하는 마지막 통합 테스트.

---

## 8. 실행한 검증 명령과 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm install` | OK | 의존 변경 없음 |
| `pnpm typecheck` | PASS | 10 개 워크스페이스 |
| `pnpm lint` | PASS | ESLint 경고 / 에러 0 |
| `pnpm format` | PASS | Prettier `--check` 통과 |
| `pnpm test` (단위) | PASS | 5 파일 / **43 테스트** (변동 없음) |
| `pnpm test:integration` | PASS | 8 파일 / **90 테스트** (Step 9 신규 3) |
| `pnpm build` | PASS | 라우트 등록 그대로 유지 |
| `prisma validate` | PASS | 스키마 무변경 |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

`.github/workflows/ci.yml` 의 **첫 실제 실행** 은 develop 으로 push 된 이후 GitHub Actions 에서 확인된다. 로컬에서는 동일한 명령을 같은 순서로 실행해 동등한 결과를 검증해 두었다.

---

## 9. 일부러 하지 않은 것

| 항목 | 사유 |
| --- | --- |
| 새 기능 구현 | 본 단계는 테스트 / CI 게이트만. 기능은 Step 1 ~ 8 에서 모두 완성. |
| UI / React 페이지 | Phase B 범위 밖. |
| DB 스키마 / 마이그레이션 변경 | 본 단계 지시상 금지. Step 3 9-table 디자인 그대로 유지. |
| 서비스 / Auth / 권한 / 감사 모듈 리팩터링 | 본 단계 지시상 금지. 기존 동작이 깨지면 안 되므로 코드 변경을 의도적으로 회피. |
| `prisma migrate deploy` 단독 CI step | §5.1 참조. 통합 테스트의 global-setup 이 같은 검증을 더 강하게 수행. |
| Playwright E2E 단계 | `tests/e2e` 골격은 존재하지만 시나리오 미구현. 본 단계 범위 밖. |
| Code coverage 게이트 | 의식적 미구현. 보존 정책 / 임계값 결정이 필요 — 별도 작업. |
| Bundle size budget | 의식적 미구현. UI 가 들어가는 단계에서 도입. |
| Lighthouse / a11y 검사 | UI 미존재로 의미 없음. |
| Docker 이미지 빌드 / 배포 단계 | Phase H (배포) 범위. CI 에서 일단 분리. |

---

## 10. 남은 리스크와 다음 단계 주의사항

1. **CI 첫 실행은 push 이후 GitHub Actions 에서 확인된다.** 로컬에서 모든 명령을 같은 순서로 통과시켰지만, GitHub Actions 환경 (Ubuntu, 외부 네트워크, embedded-postgres 첫 다운로드 등) 에서 처음 어떻게 동작할지는 push 후에야 100% 확정된다. 첫 PR / 첫 push 후 워크플로우 결과를 반드시 확인할 것.

2. **embedded-postgres 첫 실행은 바이너리 다운로드 때문에 느릴 수 있다.** CI 캐시에 잡히면 이후 실행은 빠르다. 첫 워크플로우가 평소보다 길게 걸려도 정상이다.

3. **§16 의 일부 시나리오는 코드 테스트 범위 밖이다.** §16.7 (Infra readiness — Redis / cleanup worker / Mail provider 의 실제 동작) 은 운영 / 스테이징 환경에서만 검증 가능하다. Phase B 의 Done Criteria 를 최종 선언하기 전에 별도의 운영 smoke 체크리스트로 확인해야 한다.

4. **CI 가 실패할 때 가장 빠르게 깨지는 단계는 typecheck / lint / format** 이다. 이 세 단계를 로컬 pre-commit 훅으로 묶어 두면 PR 회전 속도가 크게 빨라진다. 본 단계에서 pre-commit 훅을 도입하지는 않았다 — 별도 작업.

5. **Branch protection rule 은 GitHub repository settings 에서 별도 설정이 필요하다.** CI 워크플로우 자체는 develop / main 에 push 가 가능한 상태에서도 동작한다. `develop` / `main` 에 직접 push 를 막고 PR + 모든 체크 통과를 강제하려면 GitHub Settings → Branches 에서 protection rule 을 설정해야 한다 — 본 단계 범위 밖이다.

6. **테스트 추가는 항상 §16 매핑을 갱신하는 일과 같이 한다.** 새 시나리오가 §16 에 없는 영역(예: Phase C 문서 권한, Phase D AI 권한)을 다루면 테스트와 함께 §16 그룹을 확장하는 것이 자연스럽다.

7. **Phase B 9 단계가 모두 완료** 되었다. Phase B Done Criteria 의 마지막 한 줄(§17 의 "§16 checklist passes end-to-end in Staging") 은 staging 환경에서 §16.7 를 포함한 전체 체크가 한 번 통과해야 진짜 완료가 된다 — Phase C 진입 전에 이 staging 체크가 별도로 진행될 것이다.

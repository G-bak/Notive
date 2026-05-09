# Phase B 종료 정합성 패치 보고서

## 0. 보고 범위

본 문서는 Phase B 의 9 단계(Step 1 ~ 9)가 모두 머지된 후, **구현 결과** 와 **Phase B 계획 문서(`docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md`)** 사이의 정합성 검토에서 발견된 차이를 정리한 패치다. Step 10(=새 step) 이 아니라 **Phase B 종결 직전의 일관성 정리** 다.

검토 결과는 다음과 같이 요약된다.

- **PASS** — 구현, 테스트, CI 게이트는 안정적. (자세한 항목은 §1)
- **FAIL** — 4 건. 모두 "문서가 실제 skeleton 범위보다 더 큰 요건을 명시" 하는 케이스. (§2)
- **WARN** — 3 건. 운영 / 환경 의존 항목 또는 렌더러 의존 표시 이슈. (§3)

본 패치는 **문서 측 표현을 실제 MVP / B 단계 skeleton 범위에 맞게 보정** 하는 방향으로 진행한다. 코드 / 동작 변경은 없다.

---

## 1. 통과 (PASS) 정리

다음은 본 패치 시점에 이미 안정적으로 통과되어 있는 항목으로, 본 정합성 검토에서 변경하지 않는다.

- `develop` 이 `origin/develop` 과 동일하고 working tree 가 깨끗하다.
- `docs/report/phase-b/step-1-scaffold.md` ~ `step-9-tests-ci-gate.md` 9 개 보고서가 모두 존재한다.
- DB 의 핵심 9 개 엔티티 (`users`, `sessions`, `invitations`, `organizations`, `teams`, `roles`, `memberships`, `organization_settings`, `activity_logs`) 가 Step 3 schema 그대로 유지된다.
- Auth / Org / Team / Membership / Invitation / Admin skeleton / ActivityLog 의 API 가 등록되고, 라우트는 모두 권한 모듈을 거친다.
- 1 user = 1 active membership / 1 primary team / Last-Admin 보호의 3 잠금이 DB + 앱 + 테스트로 검증된다.
- Manager 의 admin 진입 차단, 초대 생성 차단(`manager_cannot_invite`), cross-org `NOT_FOUND`, 기능 권한 `FORBIDDEN(reason_code)` 정책이 통합 테스트에 박혀 있다.
- 9 가지 검증 명령 (`pnpm install --frozen-lockfile`, `typecheck`, `lint`, `format`, `test` (43), `test:integration` (90), `build`, `prisma validate`, `git diff --check`) 이 전부 PASS.

---

## 2. 실패 (FAIL) 항목과 적용한 보정

각 항목은 **문서가 실제로 구현한 skeleton 범위보다 더 큰 요건을 명시** 한 케이스다. 본 패치에서 문서를 실제 범위에 맞춰 수정했다 — 코드 / CI 동작은 그대로 유지된다.

### 2.1 Playwright 가 CI 의 Phase B 완료 기준에 들어가 있던 문제

**증상.** `docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md` §17 Done Criteria 가 "Type-check, ESLint, Prettier check, Vitest, Playwright all run in CI on every PR" 라고 적었다. 그러나 `.github/workflows/ci.yml` 은 `pnpm test:e2e` / `playwright test` 를 실행하지 않는다. **재검증 단계에서 같은 충돌 문구가 §13.6 Step 9 / §13.8 Playwright / §13.8 CI / §18 위험 표에도 남아 있음이 발견되어, 같은 회차에 모두 함께 정리했다.**

**근본 원인.** Step 9 (§9) 가 명시적으로 Playwright 시나리오를 미구현으로 두었다. `tests/e2e/` 는 골격일 뿐 실제 시나리오가 작성되지 않았다 — 시나리오는 후속 단계 (UI 가 생기는 단계) 에서 작성된다.

**적용한 패치.** 문서 5 곳을 동시에 보정.

- **§13.6 Step 9** — "Vitest (unit + integration) and Playwright (E2E auth + permission flows)" → "Vitest (unit + integration). GitHub Actions workflow runs install, typecheck, lint, format check, vitest unit, vitest integration, build. §16.7 (infra readiness) is a separate staging smoke" 로 변경. CI gate 정리가 Step 9 의 본질임을 명시.
- **§13.8 Playwright 섹션** — "E2E suites for the auth flow (...) and permission flow" → "Phase B installs Playwright and lays out `tests/e2e/` as **scaffold only**. No E2E scenarios are authored in B because Phase B does not ship UI ... Real E2E suites for the auth flow, invite flow, and permission flow are written in those follow-on phases" 로 변경.
- **§13.8 CI 섹션** — `playwright test` 요구를 제거. 실제 CI 와 동일한 명령 순서 (install → typecheck → lint → format → vitest unit → vitest integration → build) 로 다시 적고, integration test 의 global setup 이 `prisma migrate deploy` 를 매 실행마다 적용한다는 점도 명시.
- **§17 Done Criteria** — 스택 항목에서 "Vitest+Playwright" → "Vitest"; Playwright 는 "Phase B 의 done criteria 가 아님 — `tests/e2e/` 는 scaffolding only" 로 명시. Functional 항목은 "§16.1–§16.6 checklist passes via `pnpm test` + `pnpm test:integration` (CI-gated). §16.7 (Infra readiness) is a staging-only smoke check". CI 항목의 Playwright 언급 제거 + branch protection 은 GitHub repo settings 책임이라는 점 명시.
- **§18 Risks** — "CI minutes vs Playwright cost" 행을 Phase B 현재 위험에서 빼고, "Future E2E cost (deferred)" 로 낮춰 다시 작성. mitigation 도 "Revisit when the first UI phase introduces E2E scenarios — not a Phase B blocker" 로 명시.

### 2.2 Audit log 이 login failure / IP / User-Agent 까지 요구하던 문제

**증상.** §16.6 Audit log writes (skeleton) 가 "Login success / failure events are written" 와 "Each entry contains actor, target, action, result, IP, user agent, timestamp" 를 요구. 그리고 §13.6 Step 8 표현이 "last-Admin block" 까지 audit wired 라고 적혀 있었다. 그러나 Step 8 의 의도적 결정으로 실제 구현은 **success-only / IP·UA 미기록 / 실패 차단 이벤트 미기록** 이다(Step 8 §12 — 실패 이벤트와 IP·UA 캡처는 Phase G 로 이연).

**근본 원인.** §16.6 / §13.6 Step 8 의 표현이 Phase B skeleton 범위와 Phase G full audit 범위를 구분하지 않고 합쳐 적혀 있었다.

**적용한 패치.**

- **§16.6** 을 skeleton 범위에 맞게 다시 쓰기.
  - 도입부에 "Phase B writes a *skeleton* set of events ... full audit surface (failed events, IP / User-Agent capture, retention, queryable analytics) ships in Phase G; locking the `activity_logs` schema now means Phase G adds writers, not columns" 명시.
  - "Login success events are written. **Failed login events are deferred to Phase G** — skeleton is success-only so a failure of the audit writer never blocks login itself" — 실패 이벤트가 의도적 미구현임을 명시.
  - "**`ip_address` and `user_agent` columns exist on the table but are not populated in B** — capture is deferred to Phase G when the request-pipeline header extraction policy is set" — IP/UA 미기록 명시.
  - 사용자 disable / enable 표현이 membership-level deactivate / reactivate 임을 표시 (user-level disable 은 Phase G admin 작업).
  - best-effort 정책 (실패 시 stderr 만 찍고 계속) 명시.
  - 활성 멤버십 없는 사용자의 auth 이벤트가 기록되지 않는 이유 (NOT NULL `organization_id`) 명시.
- **§13.6 Step 8** 행을 다시 적기. 기록되는 success 이벤트들을 명확히 나열하고, "Failed-attempt events and last-Admin-block records are deferred to Phase G" 로 차단 이벤트가 skeleton 범위 밖임을 명시.

### 2.3 Infra readiness (Redis / worker / mail) 가 CI 게이트 처럼 적혀 있던 문제

**증상.** §16.7 가 "Redis healthcheck", "cleanup worker dry-run", "mail provider can deliver verification email in staging" 을 완료 기준으로 두지만, 현재 상태는 Redis env-validated only / worker dry-run skeleton / local mail adapter 수준 이라 "실행 앱에서 readiness 검증 완료" 라고 볼 수 없다.

**근본 원인.** §16.7 의 세 항목은 본질적으로 staging cluster 가 있어야 검증 가능한 것 — `embedded-postgres` 위의 CI 환경에서는 검증할 수 없다.

**적용한 패치.** §16.7 을 staging-only smoke checklist 로 재구성.

- 도입부에 "These three items are **staging-only smoke checks**, not CI gates" 를 명시.
- 각 항목별 현재 Phase B 의 도달 수준 (env validation / dry-run skeleton / console adapter) 과 staging 에서 한 번 통과해야 production-ready 로 선언된다는 점을 분리.

### 2.4 §13.6 Step 7 가 "role change UI" 라고 적혀 있던 문제

**증상.** §13.6 Phase B Implementation Order 표의 Step 7 출력이 "admin home placeholder, user list, role change UI, invite create/revoke" 라고 적혀 있었다. 그러나 실제 Step 7 의 결과물은 UI 가 아니라 **server-side admin API skeleton** 이다 — 라우트가 추가됐고 React / 화면은 추가되지 않았다.

**근본 원인.** "role change UI" 라는 단어가 §13.6 표에 그대로 남아 있어, 표만 본 사람은 Phase B 가 화면까지 만든다고 오해할 수 있었다.

**적용한 패치.** §13.6 표 Step 7 행을 "Admin skeleton (server-side API only) | admin home placeholder endpoint, member list endpoint, role-change / team-change / deactivate / reactivate endpoint wrappers around the Step 5 services, invite create / cancel wrappers. No React / UI in this step." 로 다시 작성.

### 2.5 §15 API 경로가 실제 구현과 다른 문제

**증상.**
- 문서 §15.5: `PATCH /organizations/{id}/members/{userId}`, `POST .../members/{userId}/disable`, `.../enable`.
- 실제 구현: `PATCH /organizations/{id}/memberships/{membershipId}/role`, `.../team`, `POST .../memberships/{membershipId}/deactivate`, `.../reactivate`.
- 문서 §15.6: `POST /invitations/{token}/accept` (token in URL).
- 실제 구현: `POST /api/invitations/accept` 본문에 `{ "token": "..." }`.

**근본 원인.** Phase B Step 5 / 7 구현 결정 두 가지가 §15 의 이전 기술과 어긋났다.
1. membership 행을 `userId` 가 아닌 `membershipId` 로 다루기로 한 결정 — 같은 사용자가 같은 조직에 과거 다른 membership 을 가진 적이 있을 때 ID 모호성을 피한다.
2. 초대 토큰을 URL segment 가 아닌 request body 로 받기로 한 결정 — 토큰이 server access log / referrer header 에 노출되지 않게 한다.

**적용한 패치.** §15.5 / §15.6 의 경로 표기와 동작을 실제 구현에 맞게 다시 쓰기.

- §15.5: 모든 멤버십 라우트를 `memberships/{membershipId}/...` 형태로 표기. role / team / deactivate / reactivate 각각이 별도 sub-resource 임을 명시. Step 7 의 `/admin/...` mirror 가 같은 서비스를 호출한다는 점도 추가.
- §15.6: invitation cancel 경로 (`revoke` → `cancel`, status `Revoked`) 보정. accept 경로를 `/invitations/accept` body-token 방식으로 보정 + 보안 의도 (토큰을 로그 / referrer 에 노출하지 않음) 명시.

### 2.6 Prisma migration 이 forward + backward 양방향 스크립트를 요구하던 문제

§14 가 "Forward + backward script" 를 요구. Prisma 의 표준 운영 방식은 forward-only 이며 rollback 은 새 forward migration 을 작성하는 것 — `prisma migrate deploy` 에 의도된 패턴이다.

**적용한 패치.** §14 를 Prisma 의 forward-only 컨벤션에 맞게 재서술. "rollback 이 필요하면 새 forward migration 으로 reverse" 라는 운영 정책을 명시.

---

## 3. 경고 (WARN) 항목 처리

### 3.1 § 가 짠, `??` 처럼 깨진 흔적

**소스 검사 결과.** 문서 파일은 UTF-8, BOM 없음, 572 줄에 다중 바이트 문자 (`§`, `→` 등) 가 정상적으로 들어가 있음. `grep` 으로 다음을 점검했다.

- 비프린터블 / replacement character (`�`) 검색 — **0 건**.
- 연속 `?` 패턴 — **0 건**.

**결론.** 소스 자체에는 깨짐이 없다. 일부 렌더러 / 에디터에서 `§` 가 `?` 로 표시되는 것은 환경 (폰트 / 인코딩 fallback) 의 문제이며, 본 patch 가 해결할 범위가 아니다. 깨짐이 다시 보이면 viewer 의 폰트 / 인코딩 설정을 확인하거나 raw view 로 본 내용을 비교해야 한다.

**적용한 패치.** 없음 (소스 변경 불필요).

### 3.2 CI 첫 실제 실행 / branch protection 은 로컬 검증 불가

`.github/workflows/ci.yml` 의 첫 실제 실행은 push 후 GitHub Actions 에서만 확인 가능. branch protection rule (PR + 모든 체크 통과 강제) 은 GitHub repository settings → Branches 에서 별도 설정해야 한다.

**적용한 패치.** §17 Done Criteria 의 CI 항목에 "이 정책의 enforcement 는 GitHub repository settings 에 있고 plan document 의 책임이 아니다" 를 명시. 첫 실행 / branch protection 활성화는 platform team 의 별도 작업.

### 3.3 Prisma migration 이 forward-only 인지 backward-script 인지

§2.6 과 합쳐 §14 보정으로 처리됨.

---

## 4. 변경 파일 요약

| 파일 | 변경 섹션 |
| --- | --- |
| `docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md` | **§13.6 Step 7** (role change UI → server-side API only 표현으로 정리), **§13.6 Step 8** (last-Admin block 표현 제거 + Phase G 이연 명시), **§13.6 Step 9** (Playwright E2E 요구 제거 + CI gate 정리 본질 명시), **§13.8 Playwright** (E2E 시나리오 미작성 = scaffold only 명시), **§13.8 CI** (`playwright test` 요구 제거 + 실제 CI 명령 순서로 다시 작성), **§14** (Prisma forward-only 컨벤션), **§15.5** (membership API 경로를 `memberships/{membershipId}/...` 형태로 보정), **§15.6** (invitation cancel 명칭 + body-token accept 보정), **§16.6** (audit skeleton 범위 명확화 — failed events / IP / UA 는 Phase G 이연), **§16.7** (staging-only smoke check 로 재분류), **§17 Done Criteria** (Playwright 요구 제거, prod 표현 완화, branch protection 책임 명시), **§18 Risks** (CI minutes vs Playwright cost → Future E2E cost (deferred) 로 낮춤). |
| `docs/report/phase-b/phase-b-closure-consistency.md` | 본 보고서 신규 + 재검증 회차에서 §13.6 / §13.8 / §18 추가 정리 반영. |

코드 / 테스트 / CI 워크플로우 / DB 스키마 / 마이그레이션 변경 **없음**.

---

## 5. 실행한 검증 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm format` | PASS |
| `pnpm test` (단위) | PASS — 5 파일 / 43 테스트 |
| `pnpm test:integration` | PASS — 8 파일 / 90 테스트 |
| `pnpm build` | PASS |
| `prisma validate` | PASS |
| `git diff --check` | PASS |

이번 패치는 문서만 수정했으므로 코드 검증 결과는 Step 9 종료 시점과 동일하다 — 회귀 없음.

---

## 6. Phase B 종결 선언 조건

본 패치 머지 후, Phase B 종결을 위해 남은 것은 다음 두 가지뿐이다.

1. **CI 첫 실제 실행 통과 확인** — develop 으로 push 된 본 patch 에 대해 `.github/workflows/ci.yml` 이 GitHub Actions 에서 처음 통과하는지 platform team 이 확인.
2. **§16.7 staging smoke** — Redis healthcheck, cleanup worker dry-run, mail provider verification email 의 staging 1 회 통과를 운영 / SRE 가 별도 체크리스트로 진행.

이 둘이 끝나면 Phase B 9-step 계획 + 종료 정합성까지 모두 통과 — Phase C 로 넘어갈 수 있다.

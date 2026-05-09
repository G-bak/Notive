# Phase B — Step 4: 인증 / 세션 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **4단계 — Auth / session** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1·2·3에서 만든 빈 골격과 데이터베이스 위에 **사람이 실제로 가입하고 로그인하는 통로**를 끼워 넣는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

이전 단계 보고서:

- [Step 1 — Repo / app scaffold](./step-1-scaffold.md)
- [Step 2 — Env / config](./step-2-env-config.md)
- [Step 3 — DB / Prisma](./step-3-db-prisma.md)

---

## 2. Step 4의 목적

서비스가 사람을 식별하려면 그 사람이 누구인지 한 번 확인하고(가입 + 이메일 인증), 매 요청마다 다시 한 번 확인하는 장치(세션)가 필요하다. Step 4의 목적은 다음과 같다.

- **회원가입 → 이메일 인증 → 로그인 → 로그아웃 → 비밀번호 재설정** 의 5가지 흐름을 끝까지 동작하도록 만든다.
- 이 흐름들이 다루는 **비밀번호 / 세션 토큰 / 이메일 인증 토큰 / 비밀번호 재설정 토큰** 을 데이터베이스에 원문 그대로 보관하지 않게 만든다.
- 사용자가 비활성/삭제/이메일 미확인 상태로 바뀐 순간, 그 사용자를 위한 모든 요청이 **다음 요청부터 즉시 차단** 되도록 만든다.
- 위 모든 동작을 실제 PostgreSQL 위에서 검증하는 통합 테스트로 박는다.

조직 만들기, 멤버 초대, 권한 판정, 화면(UI) 같은 이후 기능은 이 단계에 들어가지 않는다. 그건 Step 5 이후에서 한다. Step 4는 **누가 시스템에 들어와 있는가** 만 책임진다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (24개)

**인증 패키지** (`packages/auth/src/`)

| 파일 | 내용 |
| --- | --- |
| `errors.ts` | 인증 흐름이 던지는 8가지 에러 코드(예: 잘못된 비밀번호, 만료된 토큰, 비활성 계정 등). |
| `password.ts` | 비밀번호 해시(scrypt)와 비밀번호 정책 검증(최소 10자, 글자+숫자 1개 이상). |
| `tokens.ts` | 32바이트 랜덤 토큰 생성과 sha256 해시. 모든 토큰에 공통으로 쓰는 도구. |
| `session.ts` | 세션 생성 / 검증 / 폐기. 세션은 Postgres `sessions` 테이블 한 곳에만 산다. |
| `signup.ts` | 회원가입, 이메일 인증, 인증 메일 재발송. |
| `login.ts` | 로그인, 로그아웃. |
| `password-reset.ts` | 비밀번호 재설정 요청, 재설정 확정. |

**메일 어댑터** (`packages/mail/src/`)

| 파일 | 내용 |
| --- | --- |
| `index.ts` | 메일 인터페이스 + 콘솔 어댑터(개발) + 메모리 어댑터(테스트). 인증/재설정 메일 본문 템플릿. |

**웹 앱 — API 라우트** (`apps/web/app/api/`)

| 파일 | 내용 |
| --- | --- |
| `auth/signup/route.ts` | `POST /api/auth/signup` — 가입 시작. |
| `auth/verify-email/route.ts` | `POST /api/auth/verify-email` — 메일에 담긴 토큰을 받아 계정을 활성화. |
| `auth/resend-verification/route.ts` | `POST /api/auth/resend-verification` — 인증 메일 다시 보내기. |
| `auth/login/route.ts` | `POST /api/auth/login` — 로그인. |
| `auth/logout/route.ts` | `POST /api/auth/logout` — 로그아웃. |
| `auth/password-reset/request/route.ts` | `POST /api/auth/password-reset/request` — 재설정 메일 요청. |
| `auth/password-reset/confirm/route.ts` | `POST /api/auth/password-reset/confirm` — 새 비밀번호로 변경. |
| `me/route.ts` | `GET /api/me` — 현재 로그인 사용자 정보. |

**웹 앱 — 라이브러리** (`apps/web/lib/`)

| 파일 | 내용 |
| --- | --- |
| `session.ts` | 세션 쿠키(`notive_session`) 읽기/쓰기, 현재 사용자 조회 헬퍼. |
| `http.ts` | 인증 에러를 HTTP 응답으로 매핑(401/403/409 등)하고 `reason_code`를 붙인다. |
| `mail.ts` | 프로세스 전체에서 쓰는 메일 어댑터 슬롯. 테스트는 여기서 메모리 어댑터로 갈아끼운다. |

**마이그레이션** (`packages/db/prisma/migrations/`)

| 파일 | 내용 |
| --- | --- |
| `20260509101850_user_token_columns/migration.sql` | `users` 테이블에 이메일 인증 토큰 / 비밀번호 재설정 토큰 컬럼 4개를 추가. 새 테이블을 만들지 않아 Step 3의 9-table 디자인이 유지된다. |

**테스트**

| 파일 | 내용 |
| --- | --- |
| `tests/unit/auth-password.test.ts` | 비밀번호 정책과 해시/검증 단위 테스트(8 케이스). |
| `tests/unit/auth-tokens.test.ts` | 토큰 생성 / 해시 단위 테스트(3 케이스). |
| `tests/integration/auth-flow.test.ts` | 회원가입부터 비밀번호 재설정까지 전체 흐름을 실제 Postgres 위에서 검증(16 케이스). |

### 3.2 수정 (11개)

| 파일 | 내용 |
| --- | --- |
| `packages/auth/src/index.ts` | 자리만 잡혀 있던 placeholder를 진짜 공개 API로 교체. |
| `packages/auth/package.json` | `@notive/db`, `@notive/mail`, `zod` 의존 추가. |
| `packages/db/prisma/schema.prisma` | `User` 모델에 토큰 4개 컬럼 추가(unique 인덱스 포함). |
| `packages/mail/src/index.ts` | placeholder 제거, 실제 어댑터/템플릿 도입. |
| `apps/web/package.json` | `@notive/auth`, `@notive/db`, `@notive/mail` 의존 추가. |
| `apps/web/lib/env.ts` | **(Codex 보정)** 모듈 import 즉시 검증하던 구조를 `getEnv()` 지연 호출 구조로 변경. |
| `apps/web/instrumentation.ts` | **(Codex 보정)** 서버 시작 시점에 `getEnv()`를 명시적으로 한 번 호출. |
| `tests/integration/vitest.config.ts` | `@notive/auth`, `@notive/mail` alias 추가. |
| `tests/integration/package.json` | `@notive/auth`, `@notive/mail` workspace 의존 추가. |
| `tests/unit/package.json` | `@notive/auth` 의존 추가. |
| `pnpm-lock.yaml` | 위 의존 변경의 잠금 갱신. |

---

## 4. 인증 흐름

5가지 흐름은 모두 같은 원칙을 따른다. **사용자에게는 한 번만 보여 주고, 데이터베이스에는 그 값을 그대로 두지 않는다.**

### 4.1 회원가입(signup)

1. 사용자가 이름 / 이메일 / 비밀번호를 보낸다.
2. 서버는 비밀번호가 정책(최소 10자, 글자+숫자 포함)을 통과하는지 본다. 통과하면 비밀번호를 scrypt로 해시한다.
3. 32바이트 랜덤 인증 토큰을 만든다. 토큰의 sha256 해시를 `users.email_verification_token_hash`에 넣고, 만료 시각을 `email_verification_expires_at`에 넣는다.
4. 사용자 레코드는 `status = 'Pending'` 으로 만들어진다. 이 상태에서는 로그인되지 않는다.
5. 토큰의 **원문**은 메일 본문 안에서 사용자에게 한 번만 전달된다. 서버 어디에도 따로 저장되지 않는다.

### 4.2 이메일 인증(verify-email)

1. 사용자가 메일 안의 링크를 누르면 토큰 원문이 서버로 들어온다.
2. 서버는 들어온 토큰을 sha256으로 해시해서 `users` 테이블에서 같은 해시를 가진 사용자를 찾는다.
3. 만료가 지나지 않았고, 계정이 비활성/삭제 상태가 아니면 `status = 'Active'`, `email_verified_at = 지금` 으로 바꾸고, 토큰 컬럼들을 비운다.
4. 토큰은 한 번 쓰면 사라진다. 같은 토큰으로 다시 시도하면 실패한다.

### 4.3 인증 메일 재발송(resend-verification)

1. 사용자가 이메일만 보낸다.
2. 서버는 그 이메일의 사용자를 찾되, **있는지 없는지 응답으로 절대 노출하지 않는다.** 응답은 항상 같다(202 OK).
3. 실제로 `Pending` 사용자가 있으면 새 토큰을 만들어 메일을 다시 보낸다. 이전 토큰은 더 이상 쓸 수 없다.

### 4.4 로그인 / 로그아웃(login / logout)

1. 사용자가 이메일과 비밀번호를 보낸다.
2. 서버는 이메일이 없거나 비밀번호가 다르면 똑같이 `INVALID_CREDENTIALS` 를 돌려준다. 이메일 존재 여부를 외부에서 알 수 없게 만든다.
3. 비밀번호가 맞고 사용자가 `Active` 상태면 32바이트 랜덤 세션 토큰을 만들고, sha256 해시만 `sessions.token_hash`에 저장한다.
4. 토큰의 **원문**은 HttpOnly 쿠키(`notive_session`)에 담겨 브라우저로 한 번만 나간다.
5. 비밀번호는 맞지만 `status` 가 `Pending` 이면 `EMAIL_NOT_VERIFIED`, `Disabled/Deleted` 면 `ACCOUNT_DISABLED` 로 응답한다.
6. 로그아웃은 쿠키의 토큰을 sha256 해시한 뒤 그 세션을 폐기 시각으로 표시한다. 같은 토큰이 다시 들어와도 거절된다.

### 4.5 비밀번호 재설정(password-reset)

1. 요청 단계: 사용자가 이메일을 보낸다. 응답은 항상 202다(존재 여부 비공개).
2. 실제로 `Active` 사용자가 있으면 토큰을 만들어 메일로 보내고, 해시는 `users.password_reset_token_hash` 에 저장한다.
3. 확정 단계: 사용자가 메일의 토큰과 새 비밀번호를 보낸다.
4. 토큰이 유효하면 새 비밀번호를 scrypt 해시로 저장하고, 토큰 컬럼을 비운다.
5. 그 사용자의 **모든 기존 세션을 일괄 폐기** 한다. 어떤 디바이스에서 로그인 중이었든 다음 요청부터 다시 로그인해야 한다.

---

## 5. 세션을 Redis가 아니라 Postgres에 저장하는 이유

세션을 어디에 둘지는 두 가지 선택지가 있었다.

- **Redis** — 빠르다. 자동으로 만료를 처리해 준다. 그 대신 데이터가 휘발성이고 별도의 서버를 운영해야 한다.
- **Postgres** — 사용자/조직 정보가 이미 들어 있는 데이터베이스 안에 같이 둔다. 운영 대상이 하나 줄고, 사용자 상태 변화(비활성/삭제)와 세션 검증을 한 번의 쿼리로 같이 묶을 수 있다.

Phase A §15 결정 사항은 **MVP에서 세션은 Postgres에 저장한다** 는 것이다. 이유는 세 가지다.

1. **운영 단순화** — Redis 클러스터를 별도로 띄우지 않아도 된다. MVP는 동시 접속 규모가 작아 Redis가 주는 속도 이득보다 운영 비용이 더 크다.
2. **사용자 상태와의 정합성** — 사용자가 비활성/삭제된 순간을 세션 검증과 같은 트랜잭션 컨텍스트에서 본다. Redis에 세션이 따로 살면 "비활성으로 바꿨는데 어떤 디바이스는 아직 로그인되어 있다" 같은 시간차가 생기기 쉽다.
3. **감사 추적** — 세션 생성/폐기가 모두 같은 DB 안에 있으므로 추후 활동 로그(Step 8)와 연결하기 쉽다.

Redis 자체는 다른 용도(작업 큐, 캐시)로 Phase D에서 쓸 예정이고 그때 처음 실제로 연결한다. Step 4에서는 환경 변수만 검증하고 실제 사용은 하지 않는다.

---

## 6. 비밀번호 / 토큰을 원문으로 저장하지 않는 방식

데이터베이스가 유출되더라도 **원문이 거기 없도록** 만든다는 단순한 원칙을 모든 비밀에 동일하게 적용한다.

| 비밀의 종류 | 사용자에게 가는 것 | 데이터베이스에 남는 것 | 보관 방식 |
| --- | --- | --- | --- |
| 비밀번호 | 사용자가 직접 기억 | `users.password_hash` | scrypt(임의 16바이트 salt + N=16384). 같은 비밀번호도 매번 다른 해시. |
| 세션 토큰 | HttpOnly 쿠키 (한 번) | `sessions.token_hash` | sha256(token). |
| 이메일 인증 토큰 | 메일 본문 (한 번) | `users.email_verification_token_hash` | sha256(token). 사용 후 즉시 비움. |
| 비밀번호 재설정 토큰 | 메일 본문 (한 번) | `users.password_reset_token_hash` | sha256(token). 사용 후 즉시 비움. |

토큰 종류별 추가 보호:

- **만료** — 인증 토큰 24시간(`MAIL_VERIFY_TTL_HOURS`), 재설정 토큰 60분(`PASSWORD_RESET_TTL_MINUTES`), 세션 idle 14일 / 절대 30일(`SESSION_IDLE_TTL_DAYS`, `SESSION_ABSOLUTE_TTL_DAYS`). 모두 환경 변수로 조정 가능.
- **재발급 시 무효화** — 재발송 / 재요청을 하면 같은 종류의 이전 토큰은 즉시 못 쓰게 된다(같은 컬럼이 덮어 써지므로).
- **로그 비포함** — 메일 본문은 로그에 남지 않는다. 어떤 코드 경로도 비밀번호 / 토큰 원문을 콘솔에 출력하지 않는다.
- **타이밍 동등화** — 로그인 시 이메일이 아예 없는 경우에도 가짜 비밀번호 검증을 한 번 돌려서 응답 시간 차이로 이메일 존재 여부가 새지 않게 한다.

---

## 7. Disabled / Deleted / Pending 상태에서의 차단

사용자 상태가 바뀌면 그 다음 요청부터 즉시 거절되어야 한다. 이 동작은 **로그인** 과 **세션 검증** 두 곳 모두에 박혀 있다.

### 7.1 로그인 시점

1. 이메일을 찾고 비밀번호를 검증한다.
2. 이때까지는 모든 사용자가 같은 코드 경로를 탄다(`Pending` 도, `Disabled` 도 비밀번호 비교까지는 한다). 이 덕분에 외부 관찰자는 "이 이메일은 등록돼 있고 단지 비활성일 뿐" 이라는 사실을 응답 시간이나 코드로 추론할 수 없다.
3. 비밀번호가 맞을 때만 상태를 본다.
   - `status = 'Pending'` → `EMAIL_NOT_VERIFIED` (403)
   - `status = 'Disabled'` 또는 `'Deleted'` → `ACCOUNT_DISABLED` (403)
   - `status = 'Active'` → 세션을 발급한다.

### 7.2 세션 검증 시점(매 요청)

1. 쿠키의 토큰을 sha256으로 해시해 `sessions` 테이블에서 찾는다.
2. 못 찾거나, `revoked_at` 이 차 있거나, `expires_at` 이 지났으면 → `UNAUTHORIZED` (401).
3. 사용자 레코드를 같이 가져와서 `status` 를 본다. `Active` 가 아니면 → `UNAUTHORIZED` (401).
4. 즉, 관리자가 어떤 사용자를 `Disabled` 로 바꾸면 **그 사용자의 다음 요청부터** 세션이 통하지 않는다. 별도의 로그아웃 호출이 필요 없다.

### 7.3 비밀번호 재설정 직후

비밀번호가 바뀌면 **모든 기존 세션** 이 일괄 폐기된다. 도난당한 쿠키가 어딘가에 살아 있더라도, 비밀번호를 바꾸는 순간 더 이상 쓸 수 없다.

---

## 8. API 엔드포인트 목록

| 메서드 | 경로 | 용도 | 성공 응답 | 실패 응답 (대표) |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/signup` | 회원가입 | 201 `{ userId, status: "PENDING_VERIFICATION" }` | 400(`INVALID_INPUT`), 409(`EMAIL_TAKEN`) |
| POST | `/api/auth/verify-email` | 이메일 인증 | 200 `{ ok: true }` | 400(`TOKEN_INVALID`/`TOKEN_EXPIRED`) |
| POST | `/api/auth/resend-verification` | 인증 메일 재발송 | 202 `{ ok: true }` | 400(`INVALID_INPUT`) — 그 외엔 항상 202 |
| POST | `/api/auth/login` | 로그인 | 200 `{ ok: true }` + `Set-Cookie: notive_session=…` | 401(`INVALID_CREDENTIALS`), 403(`EMAIL_NOT_VERIFIED`/`ACCOUNT_DISABLED`) |
| POST | `/api/auth/logout` | 로그아웃 | 200 `{ ok: true }` + 쿠키 삭제 | (없음) |
| POST | `/api/auth/password-reset/request` | 재설정 메일 요청 | 202 `{ ok: true }` | 400(`INVALID_INPUT`) — 그 외엔 항상 202 |
| POST | `/api/auth/password-reset/confirm` | 새 비밀번호 확정 | 200 `{ ok: true }` | 400(`TOKEN_INVALID`/`TOKEN_EXPIRED`/`INVALID_INPUT`) |
| GET | `/api/me` | 현재 사용자 조회 | 200 `{ id, name, email, status, emailVerifiedAt }` | 401(`UNAUTHORIZED`) |

응답 본문에는 **토큰, 비밀번호, 다른 사용자의 이메일 같은 비밀이 절대 들어가지 않는다.** 실패는 항상 짧은 `reason_code` 만 돌려준다.

---

## 9. Codex 검증 중 보정한 3가지

Codex 검증 단계에서 운영/배포 관점에서 깨질 수 있는 3가지가 발견되어 직접 보정되었다.

1. **`apps/web/lib/http.ts` — 응답에 `reason_code` 추가**
   - 기존: `{ "error": "EMAIL_TAKEN" }` 형태로만 응답.
   - 보정: `{ "error": "EMAIL_TAKEN", "reason_code": "EMAIL_TAKEN" }` 형태로 변경. 클라이언트와 운영 도구가 일관된 키(`reason_code`)로 실패 종류를 식별할 수 있게 한다(API 스펙 §에러 응답 규약 정합).

2. **`apps/web/lib/session.ts` — 확장자 없는 import**
   - 기존: `import { env } from "./env.js";` (TS 소스 + Node ESM 호환을 위한 `.js` 명시).
   - 보정: Next 빌드(번들러 환경)에서 이 형태가 깨졌다. `import { getEnv } from "./env";` 로 변경.

3. **`apps/web/lib/env.ts` + `apps/web/instrumentation.ts` — 빌드 시 env 검증을 일으키지 않게 분리**
   - 기존: `apps/web/lib/env.ts` 가 import 되는 즉시 `loadWebEnv()` 가 실행됐다. `next build` 가 라우트 모듈을 import 하는 과정에서 매번 실제 `.env` 가 필요해 CI 빌드가 깨졌다.
   - 보정: `env.ts` 는 `getEnv()` 라는 게으른 진입점만 제공하도록 바꾸고, 실제 검증은 서버가 시작될 때 `instrumentation.ts` 가 `getEnv()` 를 한 번 호출해서 일으킨다. 결과적으로 `pnpm build` 는 `.env` 없이도 통과하고, 실서버는 시작 즉시 누락된 환경 변수를 명확한 메시지로 거부한다.

이 3가지는 Codex가 직접 적용했고, 적용 후 모든 검증 게이트가 다시 통과하는 것을 확인했다.

---

## 10. 테스트 / 검증 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | 9개 워크스페이스 모두 통과 |
| `pnpm lint` | PASS | ESLint 경고/에러 0 |
| `pnpm format` | PASS | Prettier `--check` 전부 통과 |
| `pnpm test` (단위) | PASS | 4 파일 / 24 테스트 |
| `pnpm test:integration` | PASS | 5 파일 / 30 테스트 (이번 단계에서 16 케이스 신규) |
| `pnpm build` | PASS | `.env` 없이도 빌드 성공 (Codex 보정 후) |
| `prisma validate` | PASS | 스키마 정합성 OK |
| `git diff --check` | PASS | 공백 / 줄바꿈 깨짐 없음 |

신규 통합 테스트 16 케이스 요약:

- 회원가입이 `Pending` 사용자를 만들고 인증 토큰의 **해시만** 저장하는지 확인
- 같은 이메일로 두 번 가입 시 `EMAIL_TAKEN` 응답
- 정책 미달 비밀번호 거절
- 인증 토큰으로 계정이 `Active` 가 되고 토큰 컬럼이 비워지는지 확인
- 알 수 없는 / 만료된 인증 토큰 거절
- 가입 → 인증 → 로그인 → `/api/me` → 로그아웃 전체 흐름이 통과하고, DB는 토큰 원문이 아닌 해시만 보관함을 확인
- 비밀번호 오류, 알 수 없는 이메일이 둘 다 `INVALID_CREDENTIALS` 로 같게 응답(이메일 enumeration 방지)
- `Pending` 사용자에게 잘못된 비밀번호 → `INVALID_CREDENTIALS` / 올바른 비밀번호 → `EMAIL_NOT_VERIFIED` 만 노출
- 로그인 후 사용자 `Disabled` 처리 시 다음 검증부터 거절
- 만료된 세션 거절
- 비밀번호 재설정 전체 흐름: 새 비밀번호 적용, 기존 세션 일괄 폐기, 옛 비밀번호 사용 불가
- 알 수 없는 이메일에 대한 재설정 요청은 메일을 보내지 않고 silent
- 만료된 재설정 토큰 거절
- 인증 메일 재발송 시 새 토큰 발급 + 옛 토큰 무효화, 알 수 없는 이메일은 silent

---

## 11. 이번 단계에서 일부러 하지 않은 것

| 항목 | 어디서 다룸 |
| --- | --- |
| 조직 / 팀 / 멤버십 API | Step 5 |
| 권한 모듈의 실제 판정 로직 | Step 6 |
| 관리자 화면 골격 | Step 7 |
| 활동 로그 기록기(Activity log writer) | Step 8 |
| Redis 기반 세션 | (Phase A §15 결정으로 MVP에는 도입 안 함. Phase D에서 Redis는 작업 큐 / 캐시 용도로 처음 사용) |
| UI / 화면 / 폼 | Phase B 범위 밖. UI는 별도 단계에서 다룸 |

또한 **로그인 시 IP / User-Agent 로깅, 비밀번호 시도 횟수 제한, 잠금 정책** 도 의도적으로 Step 4 범위에서 빠졌다. 이는 Step 8(활동 로그)과 운영 단계에서 함께 처리한다.

---

## 12. 다음 단계로 넘어가기 전에 알아야 할 주의사항

1. **Step 4까지의 사용자는 아직 어떤 조직에도 속하지 않는다.** `/api/me` 는 사용자의 기본 정보만 돌려주고, 멤버십이나 권한 정보는 비어 있다. 권한이 필요한 API를 보호하려면 Step 5에서 만드는 조직 컨텍스트와 Step 6의 권한 모듈이 함께 있어야 한다. 즉, Step 4의 인증은 **신원 확인까지** 만 끝낸 상태다.

2. **메일 어댑터는 아직 진짜 발송이 아니다.** 개발 환경에서는 콘솔에 제목만 찍고, 테스트에서는 메모리에 담는다. 실제 트랜잭셔널 메일 공급자 연결은 운영 문서 §4.1에서 다루고, Step 7~8 즈음에 환경 변수만 채우면 동작하도록 설계되어 있다. 그래서 지금 `pnpm dev` 에서 가입을 해도 실제 메일은 도착하지 않는다.

3. **세션 idle 갱신은 60초 단위 throttling 이 들어가 있다.** 매 요청마다 `expires_at` 을 쓰지 않고, 갱신 폭이 60초 이상일 때만 DB에 쓴다. 운영 모니터링 / 활동 로그 설계 시 이 정책을 알고 있어야 "왜 마지막 활동 시각이 정확히 일치하지 않는가" 를 오해하지 않는다.

4. **`Set-Cookie` 의 `Secure` 플래그는 `NODE_ENV !== 'development'` 일 때만 켜진다.** 따라서 staging / production 으로 배포할 때 반드시 HTTPS 가 종단까지 적용돼 있어야 한다. 평문 HTTP 로 staging 을 띄우면 쿠키가 브라우저에서 거절된다.

5. **`pnpm build` 는 더 이상 실제 `.env` 가 필요 없다.** 다만 `pnpm dev` / `pnpm start` 는 여전히 필수다. CI 빌드 컨테이너에서 빌드 단계와 실행 단계의 환경 변수 정책을 다르게 잡아도 된다는 것이 Codex 보정의 의도다.

6. **DB 마이그레이션 추가 1개.** 새 테이블은 만들지 않았지만 `users` 테이블에 컬럼 4개와 unique 인덱스 2개가 늘었다. 이미 운영 중인 환경에 적용할 때는 `prisma migrate deploy` 로 무중단 적용 가능하나(테이블 잠금 시간이 짧음), 동시성이 매우 높은 환경이라면 점검 시간을 미리 잡는 편이 안전하다.

이 6가지를 인지한 상태에서 Step 5(조직 / 팀 / 멤버십) 로 넘어가면 된다.

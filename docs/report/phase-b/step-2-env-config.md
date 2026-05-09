# Phase B — Step 2: 환경 변수 / 설정 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **2단계 — Env / config** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1에서 만든 빈 골격에 "어떤 환경 변수가 반드시 있어야 하고, 없으면 즉시 멈춘다"는 안전장치를 박아 넣는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있게 풀어 썼다.

이전 단계 보고서: [Step 1 — Repo / app scaffold](./step-1-scaffold.md)

---

## 2. Step 2의 목적

서비스가 동작하려면 외부 정보가 필요하다. 데이터베이스 주소, Redis 주소, 세션 비밀 키, 메일 발송 키 같은 것들이다. 이런 정보는 코드에 박지 않고 **환경 변수**라는 외부 통로로 주입한다. 운영 환경마다 값이 다르고, 노출되면 곤란한 비밀값도 섞여 있기 때문이다.

문제는 **환경 변수가 없거나 잘못 설정되어도 서비스가 일단 켜지면** 한참 뒤에야 이상 증상이 나타난다는 것이다. "DB가 안 붙어요" 같은 에러를 디버깅하다 보니 사실은 `DATABASE_URL` 오타였다는 식이다.

Step 2의 목적은 이 함정을 차단하는 것이다.

* 필요한 환경 변수가 무엇인지 한 곳에 정리한다.
* 서비스가 시작될 때 이 목록을 점검한다.
* 빠진 게 있으면 **서비스를 띄우지 않는다**. 즉시, 명확한 에러 메시지와 함께 멈춘다.
* "일단 켜놓고 나중에 깨지는" 패턴을 원천 차단한다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (6개)

| 파일 | 내용 |
| --- | --- |
| `packages/shared/src/env.ts` | 환경 변수 검증 본체. 어떤 변수가 필요하고 어떤 형식이어야 하는지를 zod 스키마로 정의하고, 검증 함수(`loadWebEnv` / `loadWorkerEnv`)와 명확한 에러 클래스(`EnvValidationError`)를 함께 둔다. |
| `apps/web/instrumentation.ts` | Next.js가 서버를 시작할 때 한 번 호출하는 훅. 여기서 env 모듈을 import해 검증을 발동시킨다. |
| `apps/web/lib/env.ts` | Web 앱이 사용하는 검증된 env 객체. import만 하면 자동으로 검증된다. |
| `apps/worker/src/env.ts` | 워커가 사용하는 검증된 env 객체. 워커 entrypoint가 가장 먼저 import한다. |
| `tests/unit/env.test.ts` | 검증 로직 단위 테스트 11개(정상 / 누락 / 잘못된 형식 / 기본값 적용 / 숫자 변환 / 워커 전용 변수 처리 등). |
| `.gitattributes` | 운영체제마다 다른 줄바꿈 문자(LF / CRLF) 때문에 Prettier 검사가 흔들리던 문제를 차단. 모든 텍스트 파일을 LF로 고정한다. |

### 3.2 수정 (7개)

| 파일 | 변경 |
| --- | --- |
| `packages/shared/package.json` | 환경 변수 검증에 사용하는 라이브러리 `zod`를 의존성으로 추가. |
| `packages/shared/src/index.ts` | env 모듈을 외부에 노출. 다른 패키지는 `@notive/shared`를 통해 검증 함수를 가져다 쓴다. |
| `apps/web/next.config.mjs` | Next.js의 `instrumentationHook`을 켬. Next 14에서는 실험 기능 플래그로 켜야 instrumentation이 동작한다. |
| `apps/web/package.json` | dev / start 스크립트가 루트 `.env` 파일을 명시적으로 읽도록 수정 (Codex 보정 — §7 참조). |
| `apps/worker/package.json` | dev / start 스크립트에 `--env-file-if-exists=../../.env`를 추가해 루트 `.env` 파일을 자동으로 읽도록 수정. dotenv 같은 추가 라이브러리는 사용하지 않고 Node.js 20.6+의 내장 기능을 활용. |
| `apps/worker/src/index.ts` | 직접 `process.env`를 읽던 부분을 모두 검증된 `env` 객체로 교체. 부팅 로그도 검증된 값을 출력하도록 보강. |
| `vitest.config.ts` | 테스트 수집 제외 패턴이 중첩된 `node_modules` 안의 zod 내부 테스트 파일을 잘못 잡아오던 버그 수정. |
| `pnpm-lock.yaml` | zod 추가 반영. |

---

## 4. 환경 변수 검증이 왜 필요한가

세 가지 구체적인 이유가 있다.

### 4.1 부팅 시점에 사고를 잡는다

검증이 없으면, `SESSION_SECRET`이 빠진 채로 서버가 켜지고, 사용자가 로그인을 시도한 순간에야 "session secret missing" 같은 에러가 터진다. 사용자는 이미 영향을 받은 뒤다. 검증을 부팅 시점에 두면 **서버가 켜지기 전에** 문제가 드러나고, 운영자가 곧장 고친다.

### 4.2 어떤 변수가 빠졌는지 한 번에 보여준다

zod로 검증하면 빠진 / 잘못된 변수를 **모두 한꺼번에** 모아 메시지에 넣는다. 변수 하나 빠질 때마다 서버를 재시작하면서 다음 누락을 발견하는 일이 없다. 예를 들어 다음 같은 메시지가 나온다.

```
[env] invalid environment for worker:
  - APP_BASE_URL: Required
  - DATABASE_URL: Required
  - DIRECT_DATABASE_URL: Required
  - REDIS_URL: Required
```

### 4.3 운영자와 개발자가 같은 계약을 본다

`packages/shared/src/env.ts` 한 파일에 "이 서비스는 이 변수들이 필요하다"라는 사실이 코드로 적혀 있다. 운영 가이드 문서(`docs/operations/notive-deployment-operations-guide-v1.0.md` §4.2)와 1:1로 맞아야 한다. 코드와 문서가 같은 말을 하면 운영자가 어떤 변수를 세팅해야 하는지 헷갈리지 않는다.

---

## 5. Web과 Worker가 언제 환경 변수를 검증하는가

두 앱은 검증 시점이 약간 다르다.

### 5.1 Web — Next.js 서버 시작 시점

Web은 Next.js의 `instrumentation.ts` 훅에서 env 모듈을 import한다. Next.js는 서버 프로세스가 시작될 때 이 파일의 `register()` 함수를 한 번 호출한다.

흐름:

1. 서버 프로세스 시작
2. Next.js가 `instrumentation.ts`의 `register()` 호출
3. `register()`가 `lib/env.ts`를 import
4. `lib/env.ts`가 `loadWebEnv()`를 호출 → 검증 발동
5. 검증 통과: 서버가 요청을 받기 시작
6. 검증 실패: `EnvValidationError`가 던져져 서버가 부팅 실패

중요한 점: `next build`(빌드 명령)는 instrumentation을 호출하지 않는다. 그래서 CI에서 빌드만 할 때는 `.env`가 없어도 빌드가 통과한다. 실제 서버를 띄우는 `next dev` / `next start`만 검증을 거친다.

### 5.2 Worker — entrypoint 모듈 로드 시점

Worker는 부팅이 더 단순하다. `apps/worker/src/index.ts`의 첫 줄이 `import { env } from "./env.js"`다. 이 import 자체가 `loadWorkerEnv()`를 실행시키고, 그 결과를 `env` 객체로 모아둔다.

흐름:

1. 워커 프로세스 시작
2. `index.ts` 로드
3. `env.ts` 모듈 평가 → `loadWorkerEnv()` 호출 → 검증 발동
4. 검증 통과: `runWorker()` 실행
5. 검증 실패: 프로세스가 즉시 종료(exit code 1)

---

## 6. 루트 .env 파일을 Web과 Worker가 모두 읽도록 맞춘 이유

이 결정이 Step 2에서 가장 신경 쓴 부분 중 하나다.

### 6.1 문제 상황

처음 `.env.example`은 모노레포 **루트**에 두었다(`docs/operations/notive-deployment-operations-guide-v1.0.md` §4.2 그대로). 개발자는 이 파일을 `.env`로 복사해서 실제 값을 채워 쓴다.

문제는 명령을 실행하는 위치에 따라 `.env`를 읽는 경로가 달라진다는 점이다.

* `pnpm --filter @notive/web dev` → 실행 위치는 `apps/web`. Next.js는 자기 디렉터리의 `.env`를 찾는다 → 루트 `.env`를 못 본다.
* `pnpm --filter @notive/worker dev` → 실행 위치는 `apps/worker`. 명시적으로 알려주지 않으면 마찬가지로 루트 `.env`를 못 본다.

루트 `.env`를 두라고 가이드해 놓고, 실제로는 두 앱이 다 못 읽으면 개발자가 `apps/web/.env`와 `apps/worker/.env`를 따로 만들어야 한다. **세 군데에 같은 비밀값을 복사**하게 되는데, 이건 사고의 원천이다.

### 6.2 해결

두 앱 모두 **명시적으로 루트 `.env`를 읽도록** 스크립트를 고쳤다.

* Worker (Step 2 본 작업) — `node --env-file-if-exists=../../.env dist/index.js`
* Web (Codex 보정) — `node --env-file-if-exists=../../.env node_modules/next/dist/bin/next dev`

`--env-file-if-exists`는 Node.js 20.6+의 내장 옵션이다. dotenv 같은 추가 의존성이 필요 없다. 파일이 없으면 조용히 넘어가고(운영 환경에서는 오케스트레이터가 env vars를 직접 주입하므로 `.env` 파일 자체가 없어야 정상), 파일이 있으면 자동 로드한다.

결과:

* 개발자는 루트에 `.env` 하나만 두면 된다.
* Web도, Worker도, 같은 비밀값을 한 군데서 읽는다.
* 운영에서는 `.env` 없이 시작해도 정상 동작(env vars는 컨테이너 / 오케스트레이터가 주입).

---

## 7. Codex 검증 중 보정된 `apps/web/package.json`

본 단계의 첫 작업분만으로는 Worker의 `.env` 로딩만 잡혀 있었다. Codex가 검증 과정에서 **Web도 동일하게 루트 `.env`를 읽어야 일관성이 맞는다**는 점을 짚어 `apps/web/package.json`을 직접 보정했다.

보정 전:

```json
"dev": "next dev",
"start": "next start"
```

보정 후:

```json
"dev": "node --env-file-if-exists=../../.env node_modules/next/dist/bin/next dev",
"start": "node --env-file-if-exists=../../.env node_modules/next/dist/bin/next start"
```

`--env-file-if-exists`는 Node가 직접 처리해야 하는 옵션이라, `next` 명령을 직접 호출하는 대신 `node`로 Next의 CLI 진입점을 호출하는 형태로 바꾼 것이다. 결과적으로 Next.js가 `process.env`로 값을 받기 전에 Node가 먼저 `.env`를 로드해 둔다.

이 보정 덕분에 README가 안내하는 흐름(루트에 `.env` 하나)대로 따라가도 Web과 Worker가 모두 정상 동작한다.

---

## 8. 필수 env가 없거나 잘못되면 어떤 일이 생기는가

세 가지 시나리오로 정리한다.

### 8.1 필수 변수가 누락된 경우

예: `SESSION_SECRET`을 빼고 Web을 띄우면 다음과 같은 에러가 던져지고 서버가 부팅을 멈춘다.

```
EnvValidationError: [env] invalid environment for web:
  - SESSION_SECRET: Required
  ...
```

운영자는 메시지의 변수명만 보고 곧장 어디를 고쳐야 할지 알 수 있다.

### 8.2 형식이 잘못된 경우

예: `MAIL_FROM_ADDRESS=not-an-email`처럼 이메일 형식이 아닌 값을 넣으면

```
EnvValidationError: [env] invalid environment for web:
  - MAIL_FROM_ADDRESS: Invalid email
```

부팅 단계에서 잡힌다. 이메일을 발송하려고 시도한 순간에 실패하는 것이 아니다.

### 8.3 기본값이 있는 변수

`SESSION_IDLE_TTL_DAYS` 같은 변수는 기본값(14일)이 있다. 비워두면 기본값이 적용된다. "빈 값" 자체로는 에러가 나지 않는다.

`WORKER_DESTRUCTIVE_OPS`는 정확히 문자열 `"true"`일 때만 동작한다. 빈 값, `"false"`, 다른 문자열은 모두 dry-run(아무것도 삭제하지 않음)이다. **운영 사고 방지**를 위해 기본값이 안전한 쪽으로 잡혀 있다.

---

## 9. 테스트 / 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 통과 (zod 1개 추가, 1초) |
| `pnpm typecheck` | 통과 (앱 2개 + 패키지 6개) |
| `pnpm lint` | 통과 (0 issues) |
| `pnpm test` | 통과 — **13개 / 13개** (env 11 + scaffold 2) |
| `pnpm build` | 통과 (Next.js + worker 컴파일 + 패키지) |
| `pnpm format` | 통과 |
| 정상 env로 워커 실행 | 통과 — `[notive/worker] starting (env=development, log_level=info)` 출력 |
| `REDIS_URL` 빼고 워커 실행 | 의도대로 실패 — `EnvValidationError`로 누락 변수 4개를 한 번에 보고하고 종료 |
| 루트 `.env` 경로 로딩 (Web / Worker 모두) | Codex 검증에서 통과 확인 |
| `git diff --check` | 통과 (whitespace 충돌 없음) |

env 검증의 핵심 케이스 11가지를 단위 테스트로 잡았다.

* 정상 env가 통과되는지
* `SESSION_SECRET`이 32자 미만이면 거부되는지
* `MAIL_FROM_ADDRESS`가 이메일 형식이 아니면 거부되는지
* `DATABASE_URL`이 빠지면 거부되는지
* 에러 객체에 누락 항목 리스트가 들어 있는지
* 숫자 변수가 문자열로 들어와도 자동 변환되는지
* 워커 baseline이 통과되는지
* `WORKER_DESTRUCTIVE_OPS`가 정확히 `"true"`일 때만 boolean true로 바뀌는지
* `WORKER_DESTRUCTIVE_OPS`가 알 수 없는 값(`"yes"` 등)이면 거부되는지
* `WORKER_RUN_INTERVAL_OVERRIDE`의 빈 문자열이 `undefined`로 정규화되는지
* 워커 스키마가 Web 전용 변수(`SESSION_SECRET` 등)를 요구하지 않는지

---

## 10. 이번 단계에서 일부러 하지 않은 것

| 미룬 것 | 이유 / 다음 단계 |
| --- | --- |
| Prisma 스키마 / DB 마이그레이션 | Step 3 — DB 작업이 시작되는 지점 |
| Redis / Postgres / 메일에 대한 **실제 연결** | 본 단계 지시는 config validation / readiness 수준만. 비즈니스 연결은 후속 |
| 로거 모듈 구현 | `LOG_LEVEL`은 검증되지만 실제 로그 출력 제어는 사용처가 생기는 단계에서 추가 |
| 인증 / 세션 로직 | Step 4 |
| 권한 모듈 실제 로직 (Step 1의 타입 스텁만 있음) | Step 6 |
| `apps/web/.env` 같은 앱별 .env 파일 | 루트 `.env` 하나로 통일했음. 앱별 분리는 향후 운영 요구가 생길 때 검토 |

---

## 11. 다음 단계로 넘어가기 전에 알아야 할 주의사항

### 11.1 `.env`가 없으면 부팅 실패는 정상

Step 2 작업 후, `.env` 파일이 없는 상태로 `pnpm dev:web`이나 `pnpm dev:worker`를 실행하면 즉시 실패한다. **이건 Step 2의 목적 그대로다**. "필수 env 없으면 바로 실패"가 본 단계에서 의도한 동작이다.

처음 환경을 세팅하는 개발자는 다음 한 줄로 시작한다.

```
cp .env.example .env
```

`.env.example`은 dev에서 바로 동작하는 안전한 기본값들을 담고 있어서, 복사 후 별도 수정 없이 워커는 dry-run, 웹은 로컬 dev로 켜진다. 운영에서는 오케스트레이터가 env vars를 컨테이너에 주입하므로 `.env` 파일 자체가 필요 없다.

### 11.2 `instrumentationHook`은 Next 14의 실험 기능

`apps/web/next.config.mjs`에 `experimental.instrumentationHook: true`를 켠 상태다. Next 14는 이 플래그가 필요하지만, Next 15부터는 stable로 승격되어 플래그 없이도 동작한다. **Next 15 업그레이드 시 이 플래그를 제거해야 한다**. 지금 코드 주석에도 그 점이 적혀 있다.

### 11.3 `NODE_ENV=staging`은 관례적으로 애매

env 스키마에서 `NODE_ENV`는 `development` / `staging` / `production` / `test` 네 값을 허용한다. 그런데 Node.js와 Next.js의 일부 라이브러리는 `NODE_ENV`를 production / development 두 값으로만 가정하는 경우가 있다. Staging 환경을 별도로 구분하고 싶을 때 `NODE_ENV=staging`이 의도대로 동작하지 않을 가능성이 있다. **장기적으로 `APP_ENV` 같은 별도 변수로 환경을 표현하는 것을 검토**해야 한다. 본 단계 차단 사항은 아니다.

### 11.4 `.gitattributes` 도입의 후속 영향

이번에 `.gitattributes`를 추가해 모든 텍스트 파일의 줄바꿈을 LF로 고정했다. 이전에 Windows에서 체크아웃되면서 CRLF로 변환되어 있던 파일들은, 다음에 누군가 그 파일을 수정해 커밋할 때 **자동으로 LF로 정규화**된다. 이는 정상적인 동작이다. 만약 한 번에 전체 정규화가 필요하다면 별도 normalization 커밋을 만들면 되는데, 이번 Step 2에서는 의도된 변경 파일만 깨끗하게 커밋하기 위해 그 정리는 후속으로 미뤘다.

---

## 12. 비개발자 요약 — 한 단락

Step 2는 "방을 만들기 전에 출입 카드를 검증하는 단계"였다. 서비스가 켜지려면 외부에서 받아야 하는 값(데이터베이스 주소, 비밀번호 같은 것)이 있는데, 이 값이 빠지거나 잘못된 채로 서비스가 일단 켜지면 한참 뒤에 사고가 난다. Step 2는 서비스가 부팅하는 그 순간에 모든 값을 점검하고, 빠진 게 있으면 곧바로 서비스를 멈추도록 만들었다. 운영자는 어떤 값이 빠졌는지 한 번에 알 수 있고, 사용자가 영향을 받기 전에 고칠 수 있다. 다음 단계(Step 3 — 데이터베이스)는 이 골격 위에 진짜 데이터를 다루는 코드를 얹는 단계다.

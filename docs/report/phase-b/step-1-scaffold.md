# Phase B — Step 1: 프로젝트 스캐폴딩 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **1단계 — Repo / app scaffold** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 실제 기능 코드를 짜기 전에 "코드를 짤 수 있는 빈 골격"을 만드는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

이후 단계(2 — Env / config 부터 9 — Tests까지)는 각 단계가 끝나는 시점에 별도 보고서로 다룬다.

---

## 2. Step 1은 무엇이고 왜 필요한가

Notive를 만들 때 가장 먼저 부딪히는 문제는 "어떤 도구로, 어떤 폴더 구조로, 어떻게 빌드하고 어떻게 테스트할지" 다. 이걸 정해두지 않으면 개발자마다 다른 방식으로 코드를 짜고, 빌드 파이프라인이 흔들리고, CI가 무엇을 체크해야 할지 합의가 안 된다.

Step 1의 목적은 다음과 같다.

* **빌드 / 테스트 / 린트 / 기본 앱 실행**이 되는 가장 작은 골격을 만든다.
* 기능 구현은 하지 않는다. 빈 페이지 한 장과 빈 워커 한 줄만 동작하면 된다.
* 다음 단계(2~8)가 이 골격 위에 차근차근 얹어지도록 출입구를 정확히 만들어 둔다.

이 단계가 끝나면 누구든 저장소를 받아 `pnpm install`을 한 번 돌리면 곧장 개발 환경이 준비되도록 보장한다.

---

## 3. Step 1 직전에 잠긴 기준 (사전 작업)

Step 1 작업은 다음 문서들의 결정 위에서 이루어졌다. Step 1 자체에서 새로 결정된 항목은 없고, 잠긴 결정을 코드로 옮긴 것이다.

* `docs/implementation/notive-implementation-plan-b-service-foundation-v1.0.md` §13.4 — 기술 스택 잠금(Next.js / TypeScript / Prisma / pnpm 등 12개 영역)
* 같은 문서 §13.5 — 프로젝트 디렉터리 구조 잠금
* 같은 문서 §13.6 — 9단계 구현 순서 잠금
* 같은 문서 §13.7 — 환경 변수 목록 잠금
* 같은 문서 §13.8 — 테스트 기준 잠금
* `docs/architecture/notive-technical-architecture-v1.0.md` §5.1 — 기술 스택 아키텍처 관점 정리
* `docs/operations/notive-deployment-operations-guide-v1.0.md` §4.1–§4.2 — 운영 / 배포 관점에서 인프라 구성 요소와 환경 변수 정리

---

## 4. 만든 것 — 큰 그림

Step 1에서 만든 것을 한 줄로 요약하면, **"빈 페이지 하나와 빈 워커 하나가 돌고, 빌드 / 린트 / 테스트가 모두 그린인 모노레포"** 다.

크게 다섯 갈래로 나뉜다.

| 갈래 | 무엇 |
| --- | --- |
| 워크스페이스 골격 | 모노레포 설정, TypeScript / ESLint / Prettier / Vitest / Playwright 공통 설정, 환경 변수 템플릿 |
| 앱 두 개 | 사용자 화면을 다룰 `apps/web`(Next.js)과 정리 작업 같은 백그라운드를 다룰 `apps/worker`(Node.js) |
| 패키지 여섯 개 | 여러 앱이 공유하는 코드의 자리를 미리 잡아둔 placeholder 패키지들 |
| 테스트 구조 | 단위 / 통합 / E2E 세 종류의 테스트가 들어갈 자리 |
| 컨테이너 / 로컬 dev 환경 | Docker 단일 이미지 초안과 로컬 개발용 docker-compose(Postgres / Redis / 메일 목 서버) |

총 51개 파일이 신규 생성됐고, 기존 파일 2개(README와 .gitignore)에 변경이 들어갔다.

---

## 5. 디렉터리 구조 — 실제로 만든 것

```
notive/
├─ apps/
│  ├─ web/                      Next.js 앱. 빈 홈 페이지와 /api/health만 있음
│  └─ worker/                   Node.js 워커. dry-run 모드로 한 번 돌고 종료
├─ packages/
│  ├─ shared/                   공통 타입 / 에러 코드 / 상수
│  ├─ db/                       Prisma 클라이언트 자리 (placeholder)
│  ├─ auth/                     인증 로직 자리 (placeholder)
│  ├─ permissions/              권한 모듈 자리 — 타입 스텁만 작성됨
│  ├─ mail/                     메일 어댑터 자리 (placeholder)
│  └─ redis/                    Redis 클라이언트 자리 (placeholder)
├─ tests/
│  ├─ unit/                     Vitest 단위 테스트 — 스모크 테스트 1개
│  ├─ integration/              Postgres against 통합 테스트 자리 (Step 3에서 채움)
│  └─ e2e/                      Playwright E2E 자리 — 스모크 테스트 1개
├─ docker/
│  ├─ Dockerfile                단일 이미지 초안 (web / worker 둘 다 빌드)
│  └─ docker-compose.yml        로컬 dev: Postgres + Redis + 메일 목
├─ docs/                        (기존 문서 — 변경 없음)
├─ .env.example                 환경 변수 템플릿
├─ .eslintrc.cjs                ESLint 설정
├─ .prettierrc                  Prettier 설정
├─ playwright.config.ts         Playwright 설정
├─ pnpm-workspace.yaml          pnpm 모노레포 등록
├─ tsconfig.base.json           TypeScript 공통 설정
├─ vitest.config.ts             Vitest 설정
└─ package.json                 루트 명령어 (pnpm 스크립트)
```

핵심 제약 세 가지가 코드와 설정으로 강제된다.

* **권한 거부 응답은 `packages/permissions`에서만 만든다.** 다른 패키지는 거기 있는 함수를 호출해야 한다.
* **`packages/db`에서만 Prisma 클라이언트를 import한다.** 앱 코드가 ORM에 직접 매달리지 않는다.
* **`apps/worker`는 Next.js를 import하지 않는다.** 워커는 평범한 Node.js 프로세스다.

이 제약은 패키지 분리와 의존성 선언으로 보장된다.

---

## 6. 사용한 기술 스택

Phase B 문서 §13.4의 잠금을 그대로 옮겼다.

| 영역 | 결정 |
| --- | --- |
| Web 프레임워크 | Next.js 14 App Router |
| 언어 | TypeScript |
| 런타임 | Node.js LTS (20.x) |
| 패키지 매니저 | pnpm 9 |
| 단위 / 통합 테스트 | Vitest |
| E2E 테스트 | Playwright |
| 린트 / 포맷 | ESLint + Prettier |
| DB | PostgreSQL (Step 3에서 본격 도입) |
| ORM / 마이그레이션 | Prisma (Step 3에서 본격 도입) |
| 단기 스토리지 | Redis-compatible (Step 1에선 컨테이너만 띄움) |
| 메일 | 로컬 dev에서는 MailHog, 운영에서는 메일 프로바이더 (Step 4에서 도입) |

이 스택은 한 번 잠갔으니 Step 2부터 9까지 흔들지 않는다. 변경이 필요하면 Phase B 문서 §13.4를 먼저 갱신하고 Codex 재검증을 거친다.

---

## 7. 환경 변수와 Docker

### 7.1 환경 변수 템플릿 (`.env.example`)

Phase B에서 필요한 모든 환경 변수의 키를 `.env.example`에 박아 두었다(값은 빈 칸 또는 안전한 기본값). 개발자는 `.env.example`을 `.env`로 복사해서 채우기만 하면 된다.

들어 있는 그룹:

* 런타임 / 앱 일반 (`NODE_ENV`, `APP_BASE_URL`, `LOG_LEVEL`)
* 데이터베이스 (`DATABASE_URL`, `DIRECT_DATABASE_URL`)
* 단기 스토리지 (`REDIS_URL`)
* 인증 / 세션 (`SESSION_SECRET`, idle / absolute TTL, 비밀번호 재설정 TTL)
* 메일 (`MAIL_PROVIDER_API_KEY`, 발신 주소, 인증 / 초대 링크 TTL)
* 워커 (`WORKER_DESTRUCTIVE_OPS` — 기본 `false`로 dry-run 잠금)
* 후속 단계 예약 (Storage / AI 관련 키들 — 주석 처리)

### 7.2 Docker

* `docker/Dockerfile` — 단일 이미지에서 web과 worker를 모두 빌드한다. 컨테이너가 시작될 때 어떤 명령(`pnpm --filter @notive/web start` 또는 `pnpm --filter @notive/worker start`)을 실행할지에 따라 web 컨테이너가 되거나 worker 컨테이너가 된다. 한 이미지를 두 용도로 쓰는 방식이다.
* `docker/docker-compose.yml` — 로컬 개발용. 명령 한 줄로 Postgres / Redis / MailHog가 같이 뜬다. 개발자는 앱과 워커를 자기 머신에서 직접 실행하고, 데이터 저장소만 컨테이너로 띄운다.

Step 1에서는 이미지 빌드까지 시도하지 않았다(`docker build` 미실행). B단계 인프라 구현 단계에서 별도로 검증한다.

---

## 8. 권한 모듈 타입 스텁 — Step 1에서 유일하게 손댄 실제 코드

Phase B 문서가 잠근 가장 중요한 제약 중 하나는 **"권한 거부 응답은 `packages/permissions`에서만 만든다"** 다. Step 1은 이 약속이 코드 레벨에서도 강제되도록 권한 모듈에 다음 세 가지를 미리 넣어 두었다.

* `denyNotFound(message)` — 권한이 없거나 존재하지 않는 리소스 응답을 만드는 함수. **기본은 `NOT_FOUND`** 라는 보안 정책 §15 잠금을 그대로 따른다.
* `denyForbidden(reason, message)` — 인증되었지만 기능 권한이 없는 경우의 응답. `reason_code`(예: `role_required`, `last_admin_protection`)를 함께 받는다.
* `allow` — 명시적인 허용 상수.

또한 권한 판단에 쓰일 컨텍스트 타입(`PermissionContext` — 사용자 ID / 조직 ID / 팀 ID / 역할), 결정 결과 타입(`PermissionDecision`), 검사 함수 타입(`PermissionCheck`)도 함께 선언했다.

다음 단계(특히 Step 6)가 이 모듈을 채워나간다. Step 1은 **"형태"** 만 잡았다.

---

## 9. 검증한 것

다음 명령이 모두 그린 상태로 통과한 것을 확인했다.

| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 성공 (372 패키지, 13.9초) |
| `pnpm typecheck` | 성공 (앱 2개 + 패키지 6개 모두) |
| `pnpm lint` | 성공 (0 issues) |
| `pnpm test` | 성공 (Vitest, 단위 테스트 2 / 2 통과) |
| `pnpm build` | 성공 (Next.js 프로덕션 빌드 + 워커 컴파일 + 패키지) |
| `pnpm format` | 성공 (Prettier check) |
| `pnpm exec playwright test --list` | 성공 (E2E 테스트 2개 발견됨) |
| `pnpm --filter @notive/worker typecheck` | 성공 (워커 단독 타입체크) |

검증되지 않은 것 한 가지: `docker build`로 실제 컨테이너 이미지를 만들어보지는 않았다. 컨테이너 빌드 검증은 Phase B 인프라 구현 단계에서 별도로 한다.

---

## 10. 의도적으로 안 한 것 (다음 단계로 미룬 것)

Step 1의 범위는 좁게 잡혀 있었다. 다음은 일부러 손대지 않은 것들이다.

| 미룬 것 | 다음 단계 |
| --- | --- |
| Prisma 스키마와 DB 마이그레이션 | Step 3 |
| 회원가입 / 로그인 / 세션 처리 | Step 4 |
| 조직 / 팀 / 멤버십 데이터 모델 | Step 5 |
| 권한 모듈의 실제 판단 로직 (Step 1은 타입 스텁만) | Step 6 |
| 관리자 화면 골격 | Step 7 |
| 활동 로그 작성 인터페이스 | Step 8 |
| 통합 테스트 (실 Postgres) | Step 3 이후 |
| Playwright의 실제 시나리오 (인증 / 초대 / 권한 흐름) | Step 4–7 |

각 단계가 자기 테스트를 함께 짜기 때문에 **"마지막에 테스트만 몰아 짜는 단계"** 는 따로 없다. Step 9는 이전 단계들이 누적해 놓은 테스트가 모두 그린이라는 것을 확인하는 게이트 역할이다.

---

## 11. 검증 중 Codex가 직접 손본 부분

Step 1 작업이 끝난 뒤 Codex가 검증하면서 다음 부분을 직접 보정했다.

* **워커가 `@notive/shared`의 TypeScript 원본을 직접 import하던 문제**를 해결했다. 패키지들의 `package.json`에서 `main`을 `dist/index.js`로 바꾸고 `exports`를 정리해서, 빌드 산출물을 사용하도록 만들었다. 이게 정리되지 않으면 컨테이너에서 워커가 실행 시점에 깨진다.
* **워커 entrypoint**의 "직접 실행" 가드를 제거하고 `runWorker()`를 항상 호출하도록 단순화했다. `node dist/index.js`로 실행되는 것을 기준으로 잡았다.
* **루트 `.dockerignore`** 를 추가하고 중복으로 만들어졌던 `docker/.dockerignore`를 제거했다.
* **Next.js ESLint 설정**을 `apps/web/.eslintrc.cjs`에 별도로 두어 빌드 시 떴던 "ESLint 플러그인 미감지" 경고를 없앴다.

이 보정은 Step 1을 머지할 수 있는 상태로 만드는 데 필요한 부분이었다. 보정 후 모든 검증이 그대로 그린이었다.

---

## 12. 남은 리스크와 다음 단계 입구

### 12.1 비차단 리스크 (Step 1 머지를 막지는 않음)

* **Docker 이미지 빌드는 미수행**. 인프라 구현 단계에서 검증한다.
* **Vitest의 Vite CJS API deprecation 경고**. 기능에는 영향 없음. Vite 메이저 업그레이드 시점에 처리한다.
* **ESLint v8 deprecation 경고**. v9는 flat config 전환을 동반하므로 별도 작업으로 미룬다.
* **`tests/integration`은 아직 정식 패키지가 아님**(.gitkeep만). Step 3에서 Prisma가 들어올 때 정식 패키지로 승격된다.

### 12.2 다음 단계(Step 2 — Env / config) 입구

Step 2는 다음을 한다.

* `.env.example`이 정의한 환경 변수들이 앱 부팅 시점에 실제로 검증되도록 만든다(누락되면 즉시 에러).
* 환경별(개발 / 스테이징 / 운영) 시크릿 로딩 방식을 정한다.
* 로깅 / 로그 레벨 기본 설정을 잡는다.

Step 1이 만든 골격 위에 이 검증 코드를 덧붙이는 작업이라, 별도 새로운 도구가 들어오지는 않는다.

---

## 13. 비개발자 요약 — 한 단락

Step 1은 "빈 집 짓기" 단계였다. 가구는 하나도 안 들였지만, 전기·수도가 들어오고 문이 열리고 닫히는 빈 집이다. 들어올 가구(인증·조직·권한·관리자 기능)는 Step 2부터 9까지 차근차근 들인다. Step 1이 제대로 끝났기 때문에, 이제 가구를 들이는 작업이 어디서 시작해 어디서 끝나는지 모두가 같은 도면 위에서 합의할 수 있다.

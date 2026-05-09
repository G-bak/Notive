# Phase B — Step 3: 데이터베이스 / Prisma 보고서

## 1. 보고 범위

본 보고서는 Phase B(서비스 기반 구축) 9단계 중 **3단계 — DB / Prisma schema** 가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1·2에서 만든 빈 골격에 **데이터를 보관할 그릇**(데이터베이스 스키마)과 그 그릇을 안전하게 다룰 도구(Prisma)를 끼워 넣는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

이전 단계 보고서: [Step 1 — Repo / app scaffold](./step-1-scaffold.md), [Step 2 — Env / config](./step-2-env-config.md)

---

## 2. Step 3의 목적

서비스가 사용자, 조직, 권한 같은 데이터를 다루려면 그것들을 어떤 모양으로 어디에 저장할지 정해야 한다. Step 3의 목적은 다음과 같다.

* **9개의 핵심 테이블**(사용자 / 세션 / 초대 / 조직 / 팀 / 역할 / 멤버십 / 활동 로그 / 조직 설정)을 PostgreSQL에 만든다.
* 각 테이블의 컬럼 / 인덱스 / 외래 키를 DB 설계 문서와 1:1로 맞춘다.
* **Phase A에서 잠근 결정**(1인 1조직, 1인 1팀, 마지막 Admin 보호 등)을 데이터베이스 자체가 강제하도록 박는다.
* 시스템 역할(Viewer / Editor / Manager / Admin) seed를 자동으로 깐다.
* 실제 Postgres를 띄워서 **통합 테스트**가 위 약속들을 동작 수준으로 검증한다.

기능(인증, 조직 만들기, 멤버 초대 등)은 이 단계에 들어가지 않는다. 그건 Step 4·5에서 한다. Step 3은 **그 기능들이 발 딛고 설 데이터 토대**만 만든다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (16개)

**Prisma 본체**

| 파일 | 내용 |
| --- | --- |
| `packages/db/prisma/schema.prisma` | 9개 테이블 + 7개 enum 정의. DB 설계 문서를 코드로 옮긴 단일 소스. |
| `packages/db/prisma/seed.ts` | 시스템 역할 4개를 idempotent하게 (몇 번 돌려도 같은 결과) 깐다. |
| `packages/db/src/prisma-error-codes.ts` | DB 트리거가 일으킨 last-Admin 보호 에러를 애플리케이션이 인식하기 위한 헬퍼. |

**마이그레이션 4개** (`packages/db/prisma/migrations/`)

| 파일 | 내용 |
| --- | --- |
| `migration_lock.toml` | Prisma 마이그레이션 락(공급자 = postgresql). |
| `20260509101810_init/migration.sql` | 9개 테이블, 7개 enum, 모든 인덱스와 외래 키를 만든다. Prisma가 schema.prisma를 보고 자동 생성한 SQL. |
| `20260509101820_active_membership_unique/migration.sql` | "한 사용자는 활성 멤버십을 하나만 가진다"는 규칙을 데이터베이스 인덱스로 강제. |
| `20260509101830_last_admin_protection/migration.sql` | 마지막 Admin을 강등 / 비활성 / 삭제 / 이전하지 못하게 막는 데이터베이스 트리거. |
| `20260509101840_system_role_unique/migration.sql` | 시스템 역할(`organization_id` 없는 역할)이 코드별로 정확히 1개만 존재하도록 강제. |

**통합 테스트 패키지** (`tests/integration/`)

| 파일 | 내용 |
| --- | --- |
| `package.json` / `tsconfig.json` / `vitest.config.ts` | `@notive/tests-integration` 워크스페이스 패키지로 승격. |
| `src/global-setup.ts` | 테스트 시작 시 임베디드 Postgres를 띄우고 마이그레이션을 적용. |
| `src/test-setup.ts` | 매 테스트 시작 전 모든 테이블을 비우고 시스템 역할을 다시 깐다. |
| `src/helpers.ts` | User / Org / Team / Membership을 빠르게 만드는 팩토리. |
| `scripts/bootstrap-migration.mjs` | 새 마이그레이션을 만들 때 임베디드 Postgres 위에서 `prisma migrate dev`를 한 번 돌려주는 일회성 도구. |
| `role-seed.test.ts` / `active-membership.test.ts` / `primary-team.test.ts` / `last-admin-protection.test.ts` | 4개 시나리오 통합 테스트, 총 14개 케이스. |

### 3.2 수정 (6개)

| 파일 | 변경 |
| --- | --- |
| `package.json` | `db:generate` / `db:migrate:dev` / `db:migrate:deploy` / `db:seed` / `test:integration` 스크립트 추가. |
| `packages/db/package.json` | `@prisma/client` / `prisma` / `dotenv-cli` / `tsx` 추가. `postinstall` 훅으로 자동 client 생성. |
| `packages/db/src/index.ts` | placeholder를 지우고 Prisma 싱글톤 클라이언트 + 타입 재export + last-Admin 검출 헬퍼로 교체. |
| `vitest.config.ts` | 루트 `pnpm test`는 단위 테스트만. 통합 테스트는 따로 `pnpm test:integration`으로 분리. |
| `.gitignore` | `.pgdata/` / `.bootstrap-pg/`(임베디드 Postgres 작업 디렉터리) 제외. |
| `pnpm-lock.yaml` | 새 의존성 반영. |

---

## 4. Prisma는 무엇이고 왜 도입했는가

Prisma는 **데이터베이스를 다루는 도구**다. 두 가지를 자동으로 해 준다.

### 4.1 스키마와 마이그레이션 관리

직접 SQL을 손으로 짜는 대신, `schema.prisma` 한 파일에 "어떤 테이블이 있고 어떤 컬럼이 있고 어떤 관계인지"를 적으면 Prisma가 그 변경을 따라가는 마이그레이션 SQL을 자동으로 만든다. 운영자는 그 SQL을 검수만 하면 된다. 사람이 만들 때 발생하는 자잘한 실수가 줄어든다.

### 4.2 타입 안전한 클라이언트

스키마를 기준으로 **TypeScript 클라이언트 코드**를 자동 생성한다. `prisma.user.create({ data: { name: "..." } })` 같은 식으로 코드를 짜면, 컴파일 단계에서 컬럼 이름이 맞는지 / 타입이 맞는지 검증된다. 런타임에 "그런 컬럼은 없다" 같은 사고가 컴파일 시점에 잡힌다.

### 4.3 한계

Prisma 스키마는 모든 데이터베이스 기능을 다 표현하지는 못한다. 특히:

* "특정 조건일 때만 유일해야 한다"는 **부분 유니크 인덱스**(partial unique index)
* DB 자체에서 어떤 동작을 막는 **트리거**

이 두 가지는 Prisma 스키마에 못 적는다. 그래서 **raw SQL 마이그레이션**을 별도 파일로 추가했다. Step 3에서 `last_admin_protection`, `active_membership_unique`, `system_role_unique` 세 마이그레이션이 그것이다.

---

## 5. 이번에 만든 9개 테이블 — 각각 무엇을 저장하는가

각 테이블 옆에 평이한 한 문장 설명과 어떤 권한 / 보안 결정과 연결되는지 적었다.

| 테이블 | 무엇 | 어디에 연결되나 |
| --- | --- | --- |
| `users` | 사용자 계정. 이름 / 이메일 / 비밀번호 해시 / 상태(`Pending` → 이메일 인증 후 `Active`) / 마지막 로그인 시각. | Phase A §15 인증 결정 — 이메일 인증 안 되면 사용 불가. |
| `sessions` | 로그인 세션 본체. Postgres에 보관(Phase A §15 결정 — Redis 미사용). 토큰은 해시로만 저장(원본은 쿠키에만). | 로그아웃 / 강제 만료 / 감사 로그 일관성. |
| `invitations` | 조직 초대장. 누가 누구를 어떤 역할로 어떤 팀으로 초대했는지, 토큰 / 만료 / 상태. | Phase B §11 — Admin만 초대 가능. |
| `organizations` | 회사 단위. 이름 / slug(URL용 식별자) / 상태 / 만든 사람. | 모든 데이터의 조직 격리 기준. |
| `teams` | 조직 안의 팀. MVP는 단일 단계(상위 팀 / 하위 팀 없음 — Phase A §15). | Phase A §15 — 부서 없이 팀으로 통합. |
| `roles` | 역할 정의. 시스템 역할 4개(Viewer / Editor / Manager / Admin)와 향후 도입할 조직별 커스텀 역할의 자리. | Phase B §9 권한 모델. |
| `memberships` | "이 사용자가 이 조직에 이 팀으로 이 역할로 속한다"는 연결 행. Phase B의 핵심 보호 대상. | Phase A §15 — 1인 1조직, 1인 1팀, 마지막 Admin 보호. |
| `organization_settings` | 조직별 기본 설정. 기본 역할, 기본 팀 같은 운영 옵션. | 초대 받은 사용자의 기본 배정 등. |
| `activity_logs` | 누가 언제 무엇을 했는지의 감사 로그. Step 3에서는 골격만(컬럼만 만들어 둠), 실제 기록은 Step 8에서 본격적으로. | Phase B §16 감사 / 운영 추적. |

---

## 6. "한 사용자 = 한 활성 멤버십" 제약은 어떻게 막는가

### 6.1 결정의 출처

Phase A §15는 **MVP에서 한 사용자는 정확히 한 조직에만 속한다**고 잠갔다. 같은 사용자가 두 조직 모두에서 활성 멤버 상태가 되는 것을 막아야 한다.

### 6.2 단순한 방법으로는 부족하다

`memberships` 테이블에 이미 `(user_id, organization_id)` 유니크 제약이 있다. 그건 같은 사용자가 같은 조직에서 두 줄을 가질 수 없게만 막는다. **다른 조직** 두 곳에서 활성 멤버가 되는 것은 막지 못한다.

### 6.3 부분 유니크 인덱스로 강제

`active_membership_unique` 마이그레이션이 다음 SQL을 추가한다.

```sql
CREATE UNIQUE INDEX uniq_active_membership_per_user
ON memberships (user_id)
WHERE status = 'Active' AND deleted_at IS NULL;
```

해석:

* `user_id` 하나당 **최대 1행**만 허용한다.
* 단, 그 행이 `status = 'Active'` 이고 소프트 삭제되지 않은 경우에만.

따라서:

* 활성 멤버십 1개 + 다른 조직에 또 활성 멤버십 1개 → DB가 거부.
* 활성 멤버십 1개 + 다른 조직에 `Removed` / `Disabled` 멤버십 → 허용.
* `Removed` 멤버십을 `Active`로 되돌리려는데 다른 곳에 활성이 있으면 → DB가 거부.

이 동작은 통합 테스트 4개 케이스로 모두 검증됐다(`active-membership.test.ts`).

---

## 7. `memberships.team_id` 단일 primary team 구조

### 7.1 무엇

`memberships` 테이블에는 `team_id` 컬럼이 **하나만** 있다. 한 사용자의 한 조직 안 멤버십은 정확히 하나의 팀(또는 미배정 → null)을 가리킨다.

### 7.2 왜 단일 컬럼인가

Phase A §15에서 처음에는 "한 사용자가 여러 팀에 속할 수 있다"고 적었지만, 그 모델은:

* 별도 조인 테이블(`membership_teams`)이 필요하고,
* 권한 쿼리가 "이 사용자의 팀들 중 하나라도 ..." 형태로 복잡해지며,
* "주 팀"이라는 부가 개념을 또 만들어야 한다.

MVP 일정에서 그만큼의 가치가 없어 **단일 primary team**으로 강하했다.

### 7.3 데이터베이스가 강제하는 부분

* `memberships.team_id`는 `Team` 테이블의 `id`를 가리키는 단일 컬럼이다.
* 미배정 사용자를 위해 null을 허용한다.
* 통합 테스트 `primary-team.test.ts`가 다음을 검증한다.
  * `team_id`에 단일 값만 들어간다.
  * 다른 팀으로 바꾸면 단일 값이 교체된다.
  * `membership_teams` 같은 조인 테이블이 **존재하지 않음**(향후 누군가 실수로 추가하면 테스트가 실패).

---

## 8. Last-Admin 보호 — 왜 필요하고 어떤 동작을 막는가

### 8.1 왜 필요한가

조직에 활성 Admin이 한 명도 없으면:

* 사용자 초대 / 역할 변경 / 조직 설정 변경이 불가능해진다.
* 사실상 **조직이 잠긴다**. 복구하려면 데이터베이스에 직접 접근해야 한다.

따라서 마지막 Admin이 사라지는 모든 경로를 막아야 한다.

### 8.2 막아야 하는 4가지 동작

1. **강등** — 마지막 Admin의 역할을 Editor / Viewer / Manager 등으로 바꾸기
2. **비활성화** — 상태를 `Disabled` 등으로 바꾸기
3. **소프트 삭제** — `deleted_at`을 채우거나 멤버십 행을 DELETE하기
4. **이전** — `organization_id`를 다른 조직으로 바꾸기 (1인 1조직 규칙 때문에 사실상 발생 안 하지만 방어적으로)

### 8.3 어떻게 강제하는가

`last_admin_protection` 마이그레이션이 `memberships` 테이블에 **트리거**를 단다. 트리거는 이 4가지 동작이 시도될 때마다:

1. 같은 조직의 다른 활성 Admin이 몇 명인지 센다.
2. 0명이면 동작을 거부하고 `NTV-LAST-ADMIN: ...` 메시지의 예외를 발생시킨다.

애플리케이션은 이 메시지 prefix를 보고 **FORBIDDEN(reason_code=last_admin_protection)** 응답으로 변환한다(Codex 결정). 변환 헬퍼는 `packages/db/src/prisma-error-codes.ts`의 `isLastAdminProtectionError()`다.

### 8.4 검증

통합 테스트 `last-admin-protection.test.ts`가 5가지 케이스를 검증.

* 강등 차단
* 비활성화 차단
* 소프트 삭제 차단
* DELETE 차단
* 두 명 중 한 명 강등은 허용(나머지가 Admin으로 남아 있으므로)

각 차단 케이스는 `isLastAdminProtectionError()`가 `true`로 응답하는지도 함께 확인한다.

---

## 9. 시스템 역할 4개 seed

### 9.1 무엇

`prisma/seed.ts`가 다음 4개의 시스템 역할을 `roles` 테이블에 만든다.

| 코드 | 이름 | 설명 |
| --- | --- | --- |
| `Viewer` | Viewer | 읽기 전용 접근 |
| `Editor` | Editor | 문서 작성 / 수정 |
| `Manager` | Manager | 팀 범위 모더레이션 |
| `Admin` | Admin | 조직 관리자 |

이들은 `organization_id`가 null이고 `is_system = true`다. 즉 **모든 조직이 공유하는** 시스템 기본 역할이다. 향후 조직별 커스텀 역할은 `organization_id`를 채워서 추가할 수 있다(post-MVP).

### 9.2 멱등(idempotent)이어야 하는 이유

seed는 운영 / 스테이징 / 개발에서 여러 번 돌 수 있다. 같은 코드의 시스템 역할을 두 번 만들면 충돌해야 한다. 이 충돌은:

* 코드 레벨에서 **find-then-create** 패턴으로 한 번 막고
* DB 레벨에서 **partial unique index** `uniq_system_role_code`로 한 번 더 막는다.

DB 레벨 보호가 있으므로 동시에 두 개의 seed가 실행되어도 한 쪽은 실패한다.

---

## 10. 통합 테스트가 실제 Postgres를 사용한 이유

### 10.1 Phase B 잠금

Phase B 문서 §13.8과 사용자 지시는 명시적이다.

> 통합 테스트는 실제 Postgres를 대상으로. Prisma mock 사용 금지.

### 10.2 왜 이게 중요한가

Prisma의 동작을 mock으로 흉내 내면 다음을 검증할 수 없다.

* **트리거**(last_admin_protection) 같은 DB 측 로직 — mock에는 없다.
* **partial unique index**(active_membership_unique, system_role_unique) — mock은 단순 메모리 비교라 부분 조건을 모른다.
* **외래 키 / 캐스케이드** — mock은 보통 단일 테이블 응답만 흉내 낸다.

이 단계는 정확히 위 세 가지를 검증해야 하는 단계다. mock으로 했다면 트리거가 망가져도 테스트가 통과하는, 가장 위험한 사고가 발생할 수 있다.

### 10.3 Postgres를 어디서 가져왔는가

Docker가 깔리지 않은 환경에서도 통합 테스트가 자체적으로 돌도록 **embedded-postgres**(npm 패키지)를 도입했다. 이 패키지는 PostgreSQL 16.13 바이너리를 번들로 가져와 Node.js가 직접 띄운다. 테스트 시작 시 자동으로 시작되고, 테스트 끝나면 자동으로 정리된다.

테스트 흐름:

1. `tests/integration/src/global-setup.ts` 가 임베디드 Postgres를 띄운다.
2. `prisma migrate deploy`로 4개 마이그레이션을 모두 적용한다.
3. Vitest가 4개 테스트 파일을 차례로 실행한다(단일 프로세스).
4. 매 테스트마다 모든 테이블을 truncate하고 시스템 역할을 다시 깐다.
5. 테스트 종료 시 임베디드 Postgres가 정리된다.

---

## 11. Codex 검증 중 보정된 주석 내용

Codex가 검증 과정에서 `packages/db/prisma/schema.prisma`의 `Role` 모델 주석 한 곳을 손봤다. 기능 코드는 변경되지 않았고 주석만 정정됐다.

### 11.1 보정 전

이전 주석은 PostgreSQL이 NULL을 어떻게 다루는지에 대한 설명이 부정확했다. 정확히 말하면, "PostgreSQL은 NULL을 distinct로 취급하므로 `(code, NULL)`이 유일성을 자동으로 강제한다"는 식의 표현이 들어 있었는데, 이는 사실과 반대다. PostgreSQL은 NULL을 **서로 다른 값**으로 취급하므로 `(code, NULL)` 행이 **여러 개** 만들어질 수 있다.

### 11.2 보정 후

정확한 동작 — "이 tuple 제약은 시스템 역할 유일성을 보장하지 않으므로 별도의 `system_role_unique` partial unique 마이그레이션이 그 보호를 제공한다" — 로 주석을 수정했다.

문서가 코드의 실제 동작과 일치하지 않으면 향후 변경자가 잘못된 가정으로 작업할 수 있다. Codex의 보정은 그 위험을 사전에 차단했다.

---

## 12. 테스트 / 검증 결과

| 명령 | 결과 |
| --- | --- |
| `prisma validate` (DATABASE_URL 주입 후) | 통과 |
| `prisma generate` | 통과 |
| `prisma migrate deploy` (임베디드 Postgres) | 통과 — 4개 마이그레이션 모두 적용 |
| `pnpm install` (postinstall이 client 자동 생성) | 통과 |
| `pnpm typecheck` | 통과 — 10개 워크스페이스 모두 |
| `pnpm lint` | 통과 — 0 issues |
| `pnpm test` (단위) | 통과 — **13 / 13** |
| `pnpm test:integration` | 통과 — **14 / 14** |
| `pnpm build` | 통과 — Next.js + worker + 모든 패키지 |
| `pnpm format` | 통과 |
| `git diff --check` | 통과 |

### 통합 테스트 14개 상세

**`role-seed.test.ts` (2)**
* 시스템 역할 4개가 모두 존재하고 `is_system=true`, `organization_id=null`
* 같은 코드의 시스템 역할을 두 번 만들려는 시도 거부

**`active-membership.test.ts` (4)**
* 활성 멤버십 1개 허용
* 다른 조직에 두 번째 활성 멤버십 거부
* `Removed` 멤버십은 활성과 공존 가능
* `Removed`를 `Active`로 되돌릴 때 다른 활성이 있으면 거부

**`primary-team.test.ts` (3)**
* `team_id`는 단일 컬럼 + `membership_teams` 테이블 부재
* `team_id`에 null 허용
* 다른 팀으로 변경 시 단일 값 교체

**`last-admin-protection.test.ts` (5)**
* 마지막 Admin 강등 차단 + `isLastAdminProtectionError()` 검출
* 마지막 Admin 비활성화 차단
* 마지막 Admin 소프트 삭제 차단
* 마지막 Admin DELETE 차단
* 두 명 중 한 명 강등은 허용

---

## 13. 이번 단계에서 일부러 하지 않은 것

| 미룬 것 | 이유 / 다음 단계 |
| --- | --- |
| Auth API (signup / login / logout / 이메일 인증 / 비밀번호 재설정) | Step 4 |
| Organization / Team / Membership API 라우트 | Step 5 |
| Permission Module의 실제 판단 로직 | Step 6 (`isLastAdminProtectionError()` 헬퍼만 도구로 제공) |
| Admin skeleton 화면 | Step 7 |
| ActivityLog writer 인터페이스 본 구현 | Step 8 (테이블만 만들어 둠) |
| Redis / Mail의 실제 비즈니스 연결 | Step 4 이후 |

---

## 14. 다음 단계로 넘어가기 전에 알아야 할 주의사항

### 14.1 Prisma 클라이언트는 install 시점에 자동 생성된다

`packages/db/package.json`의 `postinstall` 훅이 `prisma generate`를 자동 실행한다. CI나 신규 개발자 환경에서 `pnpm install` 한 줄이면 클라이언트가 준비된다. 다만 `--ignore-scripts`로 install하면 이 훅이 안 돌아 클라이언트가 없는 채로 빌드 실패가 난다.

### 14.2 마이그레이션은 절대 손으로 수정하지 않는다

이미 `develop`에 머지된 마이그레이션 SQL은 운영 / 스테이징에 적용된 SQL이다. 수정 시 staging과 production이 다른 상태가 된다. **수정이 필요하면 새 마이그레이션을 추가**해야 한다(예: `20260601000000_fix_xxxx`).

### 14.3 임베디드 Postgres는 통합 테스트 전용

`embedded-postgres`는 통합 테스트 격리를 위해 도입한 것이고, 운영에서는 절대 사용하지 않는다. 운영은 managed PostgreSQL 사용(Phase B §13.4 잠금).

### 14.4 Last-Admin 트리거 메시지 의존성

애플리케이션은 트리거가 던지는 에러의 `NTV-LAST-ADMIN:` prefix로 last-Admin 보호 위반을 인식한다. 이 prefix는 코드(`packages/db/src/prisma-error-codes.ts:LAST_ADMIN_PROTECTION_PREFIX`)와 마이그레이션 SQL 양쪽에 동시에 적혀 있다. **둘이 일치해야 한다**. 하나만 바꾸면 검출이 깨진다.

### 14.5 시스템 역할 seed는 idempotent

`pnpm db:seed`를 여러 번 돌려도 안전하다. 단, "역할의 description을 바꾸고 싶다"면 seed의 매핑을 바꾸고 한 번만 다시 돌리면 된다. seed가 row를 추가하지는 않고 `name`/`description`/`is_system`을 update한다.

### 14.6 통합 테스트 첫 실행은 느리다

embedded-postgres는 첫 실행 시 Postgres 16.13 바이너리를 작업 디렉터리에 풀어놓는다. 그 첫 시작이 5–10초 정도 걸린다. 두 번째부터는 빠르다. CI 빌드 캐시가 있으면 첫 실행 시간도 1초대로 줄어든다.

---

## 15. 비개발자 요약 — 한 단락

Step 3은 "데이터를 어떤 모양으로 어디에 보관할지" 설계도(스키마)를 데이터베이스에 박아 넣은 단계였다. 사용자, 조직, 팀, 역할, 멤버십 같은 9개의 테이블을 만들고, "한 사람은 한 조직에만 속한다"·"마지막 관리자는 사라지면 안 된다" 같은 핵심 규칙을 데이터베이스가 직접 거부하도록 만들었다. 코드가 실수하든 운영자가 직접 SQL을 치든, 이 규칙들은 데이터베이스 단계에서 깨질 수 없다. 다음 단계(Step 4 — 인증)는 이 토대 위에 회원가입 / 로그인 / 이메일 인증 같은 사용자가 실제로 보는 기능을 얹는다.

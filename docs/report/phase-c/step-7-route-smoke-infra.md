# Phase C — Step 7 후속: 라우트 Smoke 인프라 + 14 케이스 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **7단계 후속 — 라우트 smoke 테스트 인프라**가 완료된 시점에 작성된 단계별 보고서다. 같은 Step 7 안에서 두 머지로 분할된 작업 중 두 번째에 해당한다 — 첫 번째(태그 어휘 + 목록 필터)는 [Step 7 — 태그 도메인 / 문서 목록 필터](./step-7-tags-filters.md)로 분리해 작성된다. 본 보고서는 **테스트 인프라 + 14 smoke 케이스만** 다룬다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md)
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — service 직접 호출 통합 테스트의 시작점
- [Phase C Step 6 — 즐겨찾기 / 최근 문서](./step-6-favorites-recent.md) — §9.1에서 라우트 smoke 부재를 누적 부채로 명시
- [Phase C Step 7 — 태그 도메인 / 필터](./step-7-tags-filters.md) — 본 보고서가 smoke로 덮는 라우트 본체

---

## 2. Step 7 후속의 목적

Step 3 / 4 / 5 / 6 / 7(앞 머지)까지의 통합 테스트는 모두 **service 함수 직접 호출**이다. 이 방식은 비즈니스 로직 검증으로는 충분하지만, **라우트 본체**(query 파서, FORBIDDEN / NOT_FOUND envelope 매핑, 상태 코드)는 수동 검토에만 의존했다. Step 6 §9.1이 이 부채를 명시했고, Step 7 (앞) 검토에서 다시 환기되었다.

Step 7 후속의 목적은 다음과 같다.

* Next.js 라우트 핸들러를 **직접 호출하는 통합 테스트 인프라**를 구축한다 — Next 런타임을 띄우지 않고도 `route.GET(req, { params })` 형태로 라우트를 두드릴 수 있게.
* Step 7 (앞)에서 도입된 가장 위험도 높은 표면 — `documents` GET 엄격 query 파서 + tags 라우트 — 를 14 smoke로 우선 덮는다.
* **production 코드는 한 줄도 손대지 않는다** — service / 라우트 / 스키마는 그대로. 테스트 인프라와 테스트 파일만 추가.

다음 단계에서 다룰 것이 아닌 것:

* 그 외 라우트(documents POST/GET detail/PATCH/DELETE / shares / versions / favorites / recent)의 smoke — Step 8 / follow-up으로 분할.
* invalid body 검증(POST 빈 title 등) — body validation smoke로 별도 묶음.
* UI / 클라이언트 통합 테스트.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (2개)

| 파일 | 내용 |
| --- | --- |
| `tests/integration/src/next-headers-stub.ts` | ~21 라인. `cookies()` / `headers()` 호출 안전 stub. |
| `tests/integration/document-routes-smoke.test.ts` | ~408 라인, **14 smoke 케이스**. |

### 3.2 수정 (2개)

| 파일 | 변경 |
| --- | --- |
| `tests/integration/vitest.config.ts` | `@/` → `apps/web/` alias + `next/headers` → stub alias 추가. |
| `tests/integration/tsconfig.json` | `paths` 매핑 `"@/*": ["../../apps/web/*"]` 추가(tsc --noEmit이 라우트 import를 타입 체크하도록). |

production 코드 변경 0줄.

---

## 4. 인프라 설계 — 왜 이렇게 했는가

### 4.1 Next.js 라우트 핸들러를 직접 호출하는 것의 장벽

라우트 핸들러는 다음 두 가지에 의존한다.

1. **`getCurrentSession(cookies())`** — `next/headers`의 `cookies()`가 활성 request scope의 async-local-storage를 요구. test에서는 이 scope이 없어 `cookies()` 자체가 throw.
2. **`@/lib/...` 경로 import** — `apps/web/tsconfig.json`의 `paths` 매핑. `tests/integration` 워크스페이스에서는 이 매핑이 없어 라우트 모듈을 import할 수 없음.

두 장벽 모두 Next 런타임 / 빌드 파이프라인을 띄우지 않고 vitest만으로 해결해야 했다.

### 4.2 `next/headers`를 alias로 stub 교체

첫 시도는 `vi.mock("next/headers", ...)` 였다. **pnpm workspace에서 신뢰성 있게 가로채지 못했다** — 라우트가 거치는 동적 resolution chain을 vi.mock이 일관되게 잡지 못하는 사례를 발견. 같은 테스트 파일 안에서 일부 케이스는 stub을 보고 일부는 실제 모듈을 보는 비결정적 동작.

대신 vitest의 resolve alias로 `next/headers` 자체를 stub 파일로 redirect했다 — 모듈 시스템 레벨에서 redirect되므로 동적 resolution chain의 어느 지점에서 import해도 같은 stub이 나온다. stub은 두 함수만 노출:

```ts
export function cookies(): { get: () => undefined } { return { get: () => undefined }; }
export function headers(): { get: () => undefined } { return { get: () => undefined }; }
```

라우트는 `cookies()`를 호출해 그 결과를 `getCurrentSession(...)`에 넘기지만, `getCurrentSession` 자체가 별도 mock이라 stub의 반환값은 사용되지 않는다 — **call-safe**만 보장하면 충분.

### 4.3 `getCurrentSession`은 vi.mock으로 사용자 주입

`@/lib/session`을 mock해서 `getCurrentSession`이 미리 설정한 user / session 페어를 반환하도록 한다. user는 **실제 DB row**여야 service 코드가 정상 동작한다 — embedded-postgres에 미리 createUser / createMembership으로 만들어 두고, mock factory가 그 row를 들고 와 `ValidatedSession` shape로 감싼다.

### 4.4 `vi.hoisted`로 사용자 슬롯 공유

vitest는 `vi.mock(...)` 호출을 모든 import 위로 hoist한다. 그래서 mock factory가 closure로 캡처한 변수는 hoist된 시점에 TDZ(temporal dead zone)에 있어 접근 불가. 해결: `vi.hoisted(() => ({ state: { user: null } }))`로 hoist-safe 슬롯을 만들고, 각 `it`이 `hoisted.state.user = s.editor` 식으로 갈아끼운다.

```ts
const hoisted = vi.hoisted(() => ({ state: { user: null as ... } }));
vi.mock("@/lib/session", () => ({
  getCurrentSession: async () => {
    if (hoisted.state.user === null) throw new AuthError("UNAUTHORIZED", "no mock user");
    return { user: hoisted.state.user, session: { ... } };
  },
}));
```

각 `it`이 끝날 때 `beforeEach`에서 `null`로 리셋해 mock leak을 방지.

### 4.5 `@/` alias

`apps/web/tsconfig.json`의 `"@/*": ["./*"]`를 통합 테스트에서도 동일하게 보이게 하기 위해 두 파일에 매핑 추가:

* **vitest.config.ts** — 런타임 모듈 resolution용.
* **tsconfig.json** — `tsc --noEmit` 타입 체크용 (`paths` + `compilerOptions.paths`).

이로써 smoke 테스트가 `import * as docsRoute from "../../apps/web/app/api/.../route"` 형태로 라우트를 import하면, 라우트가 다시 `@/lib/...`로 import할 때도 정상 해석된다.

---

## 5. 14 smoke 케이스 분포

| 라우트 그룹 | 케이스 |
| --- | --- |
| `documents` GET 엄격 query 파서 | happy 200 / `?status=Deleted` 400 / `?visibility=Department` 400 / `?limit=abc` 400 / `?tagId=not-a-uuid` 400 (Postgres uuid-parse 500 leak 방지) — **5** |
| tags 라우트 | GET 200 (member) / POST 201 Editor / POST 403 Viewer (`tag_create_not_allowed`) / DELETE 204 Manager / DELETE 403 Editor (`tag_delete_not_allowed`) / DELETE 404 cross-org (no reason_code) — **6** |
| `documents/[documentId]/tags` PUT | 200 Owner + diff / 403 view-only (`document_edit_not_allowed`) / 404 no-view (no reason_code) — **3** |

### 5.1 ownerTeamId / authorUserId가 직접 케이스를 갖지 않는 이유

세 query 파라미터(`ownerTeamId` / `authorUserId` / `tagId`)는 service / route 본체에서 **같은 `parseUuid` 헬퍼**를 공유한다. 헬퍼 한 곳을 검증하면 세 호출 지점이 같이 검증된다는 판단 — `tagId` 케이스(`?tagId=not-a-uuid` → 400)가 대표 케이스. Codex 검토에서 비-blocker note로 지적되었으며, 향후 헬퍼 분리 시 별도 케이스를 추가하기로 합의.

### 5.2 NOT_FOUND envelope deep-equal

cross-org / no-view / Deleted 케이스는 `expect(r.body).toEqual({ error: "NOT_FOUND" })`로 envelope를 deep-equal로 고정한다. `toMatchObject`는 reason_code가 추가돼도 통과해 envelope leak을 잡지 못함 — 이 패턴은 Step 8 후속에서도 재사용됐다.

---

## 6. 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` (10 워크스페이스) | PASS |
| `pnpm test` (vitest unit) | PASS — 6 files / 99 tests (변동 없음) |
| `pnpm test:integration` | PASS — **14 files / 201 tests** (187 → 201, +14 신규 smoke) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

Step 7 후속 코드는 `develop`에 머지되었다 (commit `411498b`, merge `5422e86`).

### 6.1 Codex 검토 라운드

* **1차** — 승인. 비-blocker note 1건: ownerTeamId / authorUserId가 transitively 덮인다는 사실은 README나 코멘트에 명시 가치 있음(향후 헬퍼 분리 시 별도 케이스 추가 약속).

수정 / 재검토 라운드 없이 첫 패스에 통과 — Step 5 / Step 7 (앞) 같은 multi-pass와 대비.

---

## 7. 다음 단계로 넘어가기 전 운영 주의사항

### 7.1 누적 부채 상환은 부분적

본 단계는 Step 7 (앞)이 도입한 라우트만 우선 덮었다. Step 3 / 4 / 5 / 6의 라우트는 여전히 service 직접 호출 통합 테스트만 갖는다. **Step 8**이 documents core 4개 라우트(POST / GET detail / PATCH / DELETE)로 1차 확장하며, 그 다음 follow-up으로 shares / versions / favorites / recent를 묶기로 한다(Step 8 보고서 §7.1 참조).

### 7.2 `vi.mock("next/headers")`의 비결정성 기록

본 보고서 §4.2는 향후 다른 라우트를 추가로 smoke할 때 같은 함정에 빠지지 않도록 명시한 운영 노트다. **새 라우트가 `next/headers` 외 다른 Next 런타임 모듈에 의존**(예: `next/cache`, `next/server`의 일부 유틸)하면 같은 alias 패턴을 적용해 stub을 추가해야 한다. `vi.mock` 단독은 신뢰하지 말 것.

### 7.3 setup 픽스처 비용

각 `it`이 `setup()`을 호출해 admin / editor / editorB / manager / viewer × 1 org + outsider × 1 org를 매번 새로 만든다. embedded-postgres의 transactional 격리에 의존하지 않고 매 케이스가 새 row를 생성. 14 케이스 × 평균 ~225 ms = ~3.2초가 smoke 파일 단독 실행 시간. 케이스 수가 30+로 늘면 `beforeAll` + transaction rollback 패턴으로 전환 검토.

### 7.4 mock leak 방지

`beforeEach(() => { hoisted.state.user = null; })`로 mock leak을 명시적으로 리셋. 어떤 케이스가 user를 설정한 채 끝나도 다음 케이스의 `getCurrentSession`은 UNAUTHORIZED로 throw — 의도치 않은 권한 누설 방지.

### 7.5 라우트 본체의 일관성

이번 smoke가 통과한다는 것은 라우트 본체가 **모두 동일 패턴(session → service → respondError)**을 따른다는 사실의 cross-check이기도 하다. 향후 라우트가 이 패턴을 벗어나면(예: 라우트에서 비즈니스 로직 직접 작성) 같은 smoke 인프라로 곧장 검출 가능.

---

## 8. 비개발자 요약 — 한 단락

Step 7 후속은 사람이 손으로 일일이 호출하지 않고도 컴퓨터가 자동으로 "주소창에 이 URL을 치고 이 사용자가 들어왔을 때 서버가 어떻게 응답하느냐"를 확인하는 자동 점검 장치를 처음으로 깐 단계다. 지금까지 자동 점검은 **서버 안쪽의 함수**를 직접 부르는 식이라, 서버의 바깥쪽 입구(URL · query · 응답 코드 · 응답 본문 모양)는 사람이 코드 리뷰로만 점검해 왔다. 이는 그동안 누적된 부채로, Step 6 보고서에서도 명시적으로 "다음 어딘가에서 갚아야 한다"고 적어 두었던 항목이다. 이번 후속에서 그 입구를 두드리는 방식 자체를 만들었고(가짜 사용자 한 명을 교체하면서 같은 URL을 두드리는 도구), 그중 가장 위험도가 높은 14가지 응답을 우선 자동 점검표에 올렸다 — 예컨대 잘못된 값으로 호출했을 때 서버가 5xx 장애가 아니라 4xx로 깔끔히 거부하는지, "이 자원이 없다"는 응답 안에 "사실은 있긴 하다"는 정보가 새지 않는지. 자동 점검 장치는 모두 통과했고, 이번 작업으로 서비스 / 라우트 / 데이터베이스 어떤 코드도 손대지 않은 채 점검 인프라와 점검표만 추가됐다. 나머지 입구(문서 만들기 / 보기 / 수정 / 삭제 / 공유 / 버전 / 즐겨찾기 / 최근)에 대한 점검표는 Step 8 / 그 후속에서 같은 도구로 차례차례 채울 예정이다.

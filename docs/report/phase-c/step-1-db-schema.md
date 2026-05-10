# Phase C — Step 1: 문서 데이터베이스 스키마 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **1단계 — 문서 DB 스키마**가 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Phase B(서비스 기반 구축)에서 만든 사용자 / 조직 / 팀 / 권한 토대 위에 **문서를 보관할 자리**(documents / document_versions / document_shares / document_tags / document_tag_links / document_favorites / document_view_histories 7개 테이블)를 끼워 넣는 단계다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- Phase B 마무리: [Phase B closure consistency](../phase-b/phase-b-closure-consistency.md)
- 직전 단계: [Phase C preflight 정합성 정리](../phase-b/phase-b-closure-consistency.md) 이후 Phase C 진입 전 [문서 정합성 패치](../../implementation/notive-implementation-plan-c-document-management-v1.0.md) (commit `c8fed48`).

---

## 2. Step 1의 목적

서비스가 문서를 다루려면 그 문서들을 어떤 모양으로 어디에 저장할지 정해야 한다. Step 1의 목적은 다음과 같다.

- **7개의 문서 테이블**(documents / document_versions / document_shares / document_tags / document_tag_links / document_favorites / document_view_histories)을 PostgreSQL에 만든다.
- 각 테이블의 컬럼 / 인덱스 / 외래 키를 DB 설계 문서 §7과 1:1로 맞춘다.
- **Phase A에서 잠근 결정**(Department 미도입 / Team 단일 통합 / Admin 본문 묵시 접근 금지)을 데이터베이스가 강제하도록 박는다.
- **조직 경계 누설**을 DB 레벨에서 막는다. 자식 행이 부모 문서와 다른 조직을 가리키는 사고가 어플리케이션 버그로도 발생할 수 없도록 composite FK로 강제한다.
- **권한 조회 인덱스**(DB 설계 §14.2)를 모두 생성한다.
- D / F 단계에서 결합될 forward-reference 컬럼(`template_id`, `ai_request_id`)의 자리를 미리 잡되, FK 부착은 D 단계로 이연한다.

기능(문서 작성 API, 편집 화면, 공유 UX, 권한 판단 로직)은 이 단계에 들어가지 않는다. 그건 이후 Step에서 한다. Step 1은 **그 기능들이 발 딛고 설 데이터 토대**만 만든다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (1개)

| 파일 | 내용 |
| --- | --- |
| `packages/db/prisma/migrations/20260510000000_phase_c_documents/migration.sql` | 5개 enum, 7개 신규 테이블, 18개 인덱스(중 6개는 unique), 22개 FK, `teams` 테이블에 composite unique 1개 추가. Forward-only. |

### 3.2 수정 (1개)

| 파일 | 변경 |
| --- | --- |
| `packages/db/prisma/schema.prisma` | 5개 enum + 7개 모델 추가, `User` / `Organization` / `Team`에 back-relation 13개 추가, `Team` / `Document` / `DocumentTag`에 composite unique `(id, organization_id)` 추가, 자식 모델의 document/tag 관계를 composite FK로 전환. +267 / −22 라인. |

이게 전부다. seed / CI / 통합 테스트 코드 / API 라우트 / UI는 이 단계에서 손대지 않았다.

---

## 4. 이번에 만든 7개 문서 테이블 — 각각 무엇을 저장하는가

각 테이블 옆에 평이한 한 문장 설명과 어떤 권한 / 보안 결정과 연결되는지 적었다.

| 테이블 | 무엇 | 어디에 연결되나 |
| --- | --- | --- |
| `documents` | 문서 본문 + 메타데이터(제목 / 본문 / 유형 / 상태 / 작성자 / 소유자 / 소유 팀 / 공유 범위 / 생성 방식 / 일자). 소프트 삭제는 `deleted_at` 컬럼과 `status='Deleted'`로 표현. | Phase C 전체 흐름의 중심. AI 생성 결과 저장(D), 사내 검색 인덱싱(F)의 입력. |
| `document_versions` | 문서 변경 이력의 스냅샷(제목 / 본문 / 변경자 / 변경 요약). | §9.5 버전 정책 — 의미 있는 저장 단위로 새 버전 생성. 복원도 새 버전으로 기록. |
| `document_shares` | 문서별 공유 대상 목록. `target_type=User|Team|Organization`과 `target_id` 조합으로 누구에게 어떤 권한(View / Edit / Manage)을 줬는지 저장. | Phase C 권한 판단 — `documents.visibility=SpecificUsers`와 결합되어 누가 볼 수 있는지 결정. |
| `document_tags` | 조직 단위 태그 사전. `(organization_id, name)`이 유일. | §7.5 — 조직별 태그 관리. 검색(F)이 사용. |
| `document_tag_links` | 문서와 태그의 연결. 한 문서에 여러 태그를 다는 다대다 조인. | 문서 목록 필터, 검색(F). |
| `document_favorites` | 사용자별 즐겨찾기. 한 사용자가 같은 문서를 두 번 즐겨찾기할 수 없도록 `(user_id, document_id)` 유일. | 화면 구성 §6.2 / §6.3 — 즐겨찾기 필터. |
| `document_view_histories` | "이 사용자가 이 문서를 언제 봤다"의 기록. 하나의 (user, document) 조합이 여러 행을 가질 수 있다(시점별). | 최근 문서 화면 / 활동 분석. |

---

## 5. 5개의 새 enum

| enum | 값 | 의미 |
| --- | --- | --- |
| `DocumentStatus` | Draft / Active / Archived / Deleted | 문서 상태. 일반 목록은 Active만, 보관함은 Archived, 휴지통은 Deleted를 본다. |
| `DocumentVisibility` | Private / Team / Organization / SpecificUsers | 문서의 기본 공개 범위. **Department 값 없음** — Phase A §15가 Department를 Team으로 통합. |
| `DocumentSourceType` | Manual / AI / Imported | 문서가 어떻게 생성됐는지. D 단계 AI 결과 저장 흐름이 `AI`를 사용. |
| `DocumentShareTargetType` | User / Team / Organization | `document_shares.target_id`가 어떤 종류의 ID인지 구분. **Department 없음**. |
| `DocumentSharePermission` | View / Edit / Manage | 공유 대상에게 부여한 권한 단계. |

`DocumentVisibility`와 `DocumentShareTargetType` enum **양쪽 모두에 Department 값을 만들지 않았다**. Phase A §15의 잠금을 데이터베이스 레벨에서 못 박은 것이다. 향후 누군가가 Department를 다시 도입하려면 enum 변경이 필요해 그 자체로 정책 검토 트리거가 된다.

---

## 6. "조직 경계 누설" — Phase C가 가장 무서워한 사고

### 6.1 무엇이 문제인가

C 단계 데이터는 모두 `organization_id`로 격리된다. 그런데 자식 테이블들이 두 가지 컬럼을 동시에 갖고 있다.

- `document_id` — 어떤 문서에 속하는지
- `organization_id` — 어떤 조직에 속하는지

만약 어플리케이션 버그로 `document_versions` 행 하나가 **A 조직의 documents.id**를 가리키면서 **B 조직의 organization_id**를 가지면, 권한 필터(`WHERE organization_id = $current_org`)가 그 행을 **B 조직 사용자에게 노출**시킨다. 권한이 누설된다.

### 6.2 단순한 외래 키로는 막지 못한다

기존 `document_id → documents(id)` 외래 키는 "참조하는 문서가 존재한다"는 것만 보장한다. 그 문서의 조직과 자식 행의 조직이 일치하는지는 보장하지 않는다.

### 6.3 composite FK로 강제

이 단계에서 다음 unique 인덱스 / FK들을 추가했다.

**부모 쪽 unique:**

```sql
CREATE UNIQUE INDEX documents_id_organization_id_key
  ON documents(id, organization_id);

CREATE UNIQUE INDEX document_tags_id_organization_id_key
  ON document_tags(id, organization_id);

CREATE UNIQUE INDEX teams_id_organization_id_key
  ON teams(id, organization_id);
```

**자식 쪽 composite FK 7개:**

| FK | 거는 곳 |
| --- | --- |
| `(document_id, organization_id) → documents(id, organization_id)` | document_versions / document_shares / document_tag_links / document_favorites / document_view_histories |
| `(tag_id, organization_id) → document_tags(id, organization_id)` | document_tag_links |
| `(owner_team_id, organization_id) → teams(id, organization_id)` | documents |

이제 자식 행이 부모와 다른 조직을 가리키면 PostgreSQL이 INSERT 자체를 거부한다. 권한 필터가 신뢰하는 `organization_id`는 데이터베이스가 직접 보증한다.

### 6.4 owner_team_id의 NO ACTION 결정

`documents.(owner_team_id, organization_id) → teams(id, organization_id)` 외래 키는 `ON DELETE NO ACTION`으로 설정했다. 일반적인 외래 키처럼 `SET NULL`을 쓰지 못한 이유는:

- composite FK의 `SET NULL`은 **참조하는 두 컬럼을 모두 null로 만들어야** 동작한다.
- `owner_team_id`는 nullable이지만 `organization_id`는 NOT NULL이다.
- 따라서 SET NULL은 invalid.

실무적 의미:

- 팀이 **소프트 삭제**(`deleted_at` 채움 + `status='Deleted'`)되는 일반 경로에서는 이 외래 키가 발동하지 않는다. 팀 행은 여전히 존재한다.
- 팀이 **하드 삭제**(DELETE)되는 드문 경로에서는 외래 키가 거부한다. 어플리케이션이 먼저 그 팀을 가리키는 모든 문서의 `owner_team_id`를 null로 만들어야 한다.
- Phase B의 팀 운영은 기본적으로 소프트 삭제이므로 이 정책이 정상적인 운영 흐름을 막지 않는다. 하드 삭제는 운영 / 데이터 정리 시나리오에서만 발생하며 그때는 application 책임으로 명시.

이 트레이드오프는 schema.prisma의 `Document` 모델 위에 주석으로 박혀 있어 향후 변경자가 정책을 모르는 채로 SetNull로 되돌리는 사고를 막는다.

---

## 7. 권한 조회 인덱스 (DB 설계 §14.2)

C / F 단계의 권한 필터는 다음 패턴으로 들어간다.

```sql
SELECT * FROM documents
WHERE organization_id = $current_org
  AND (visibility = 'Organization' OR ...);
```

이런 쿼리가 인덱스 없이 풀 스캔을 돌면 조직이 커질수록 느려진다. DB 설계 §14.2는 이 단계에서 만들 인덱스를 명시했다.

| 인덱스 | 용도 |
| --- | --- |
| `documents(organization_id, status)` | 일반 목록(Active만), 보관함(Archived), 휴지통(Deleted) |
| `documents(organization_id, visibility)` | 공개 범위별 권한 필터 |
| `documents(organization_id, owner_user_id)` | 내 문서 / 본인 소유 문서 |
| `documents(organization_id, owner_team_id)` | 팀 문서 |
| `documents(organization_id, document_type)` | 유형별 필터 |
| `documents(organization_id, updated_at)` | 최근 수정 정렬 |
| `document_shares(organization_id, target_type, target_id)` | "이 사용자/팀에게 공유된 문서" 역방향 조회 |
| `document_versions(organization_id, document_id)` | 버전 목록 |
| `document_tag_links(organization_id, tag_id)` | 태그별 문서 |
| `document_favorites(organization_id, user_id)` | 사용자별 즐겨찾기 |
| `document_view_histories(organization_id, user_id, viewed_at)` | 최근 본 문서 정렬 |
| `document_view_histories(document_id)` | 문서 단위 시청자 분석(F) |

`documents(organization_id, visibility)`는 1차 PR에서 누락됐다가 Codex 1차 검증에서 지적되어 2차에 추가됐다(섹션 9 참조).

---

## 8. forward-reference 컬럼 — `template_id`와 `ai_request_id`

`documents` 테이블에는 다음 두 컬럼이 있다.

```sql
"template_id"   UUID,
"ai_request_id" UUID,
```

이들은 외래 키 없이 nullable UUID 스칼라로만 존재한다. 이유:

- `templates` 테이블은 Phase D 1단계에서 도입 예정.
- `ai_requests` 테이블도 Phase D에서 도입 예정.
- 두 테이블이 아직 없으므로 외래 키를 걸 수 없다.

선택할 수 있었던 다른 길:

- (a) 컬럼 자체를 Phase D로 미루기 → C / D 사이에 schema migration이 한 번 더 필요
- (b) **이번에 컬럼을 미리 잡고 FK는 D에서 부착** ← 채택

(b)를 택한 이유는 컬럼 추가 / FK 부착이 별도의 forward-only 마이그레이션으로 깔끔하게 분리되며, C 단계 어플리케이션 코드가 이 컬럼을 먼저 채울 수 있어 D 단계 진입이 더 부드러워지기 때문이다.

schema.prisma와 migration.sql 양쪽에 "이 두 컬럼은 Phase D forward migration에서 FK가 부착된다"는 주석을 박아 향후 변경자가 컬럼을 보고 혼란하지 않도록 했다.

---

## 9. Codex 검증 흐름 — 1차 지적 → 2차 승인

이 단계는 Codex 검증을 두 번 받았다.

### 9.1 1차 검증 (REVISION REQUESTED)

3개의 blocking 항목이 지적됐다.

1. 자식 테이블의 `(document_id, organization_id)`가 부모 문서와 일치하도록 DB 레벨에서 강제되지 않음 — 권한 필터가 신뢰하는 `organization_id`가 어플리케이션 버그로 깨질 위험
2. `documents.owner_team_id`도 같은 조직의 팀인지 DB 강제 없음
3. DB 설계 §14.2가 요구하는 `documents(organization_id, visibility)` 인덱스 누락

### 9.2 2차 검증 (APPROVED)

4건을 모두 반영하고 재검증을 받았다(추가로 `document_tag_links.(tag_id, organization_id) → document_tags(id, organization_id)` composite FK도 같이 추가). Codex는 다음을 확인하고 승인했다.

- 자식 테이블의 composite FK 7개가 모두 `documents(id, organization_id)` 또는 `document_tags(id, organization_id)`를 참조
- `documents.owner_team_id`가 `teams(id, organization_id)`로 묶여 소유 팀 조직 불일치를 DB가 차단
- visibility 인덱스 추가됨
- Department 모델 / 컬럼 / enum 추가 없음 (잔존 4건은 모두 정당화 주석)
- `owner_team_id` composite FK의 `NO ACTION` 정책이 합리적
- `organization_id` 단일 FK + composite FK를 함께 두는 구조도 합리적

이 2단계 검증 흐름은 **DB schema는 한 번 굳으면 되돌리기 어렵다**는 사실 때문에 의도된 절차였다. 1차에서 발견된 무결성 갭 3건은 이후 수백 곳에서 신뢰될 `organization_id` 컬럼의 정합성과 직결되는 항목이라 schema가 머지되기 전에 잡혀야 했다.

---

## 10. Migration SQL은 어떻게 만들었는가

이번 마이그레이션은 손으로 짜지 않았다. Prisma CLI의 `migrate diff`를 통해 다음 절차로 생성했다.

1. embedded-postgres에 Phase B의 5개 마이그레이션만 적용 (Phase C 마이그레이션 디렉토리는 일시 stash).
2. `prisma migrate diff --from-url <embedded> --to-schema-datamodel schema.prisma --script` 실행.
3. Prisma가 출력한 SQL을 `20260510000000_phase_c_documents/migration.sql`에 그대로 저장.
4. 파일 상단에 한국어 의도 주석 블록만 수동 추가.

이 절차는 **schema.prisma와 migration.sql이 정확히 일치**하는 것을 보장한다. 손으로 SQL을 짜면 enum 이름 / 인덱스 이름 / FK 이름 등이 Prisma의 컨벤션과 미묘하게 어긋나 향후 `prisma migrate diff`가 "drift detected"를 보고하는 사고가 발생할 수 있다.

생성에 사용한 일회성 helper 스크립트(`tests/integration/scripts/gen-phase-c-migration.mjs`)는 작업 후 삭제했다. 이 단계의 변경 범위는 `schema.prisma` 1개 + 새 migration 디렉토리 1개로 제한된다.

---

## 11. 테스트 / 검증 결과

### 11.1 1차 검증 (Codex 1차 지적 전)

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/db db:generate` | 통과 |
| `pnpm typecheck` | 통과 — 10개 워크스페이스 모두 |
| `pnpm test` (단위) | 통과 — 5 files / 43 tests |
| `pnpm test:integration` | 통과 — 8 files / **90 tests** (embedded-postgres에서 새 migration 적용됨) |
| `pnpm format` | 통과 |
| `git diff --check` | 통과 |

### 11.2 2차 검증 (composite FK 반영 후)

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/db db:generate` | 통과 |
| `pnpm typecheck` | 통과 — 10개 워크스페이스 모두 |
| `pnpm test` (단위) | 통과 — 5 files / 43 tests |
| `pnpm test:integration` | 통과 — 8 files / **90 tests** |
| `pnpm format` | 통과 |
| `git diff --check` | 통과 |

### 11.3 통합 테스트가 자동으로 검증한 것

`tests/integration/src/global-setup.ts`가 매 실행마다 임베디드 Postgres를 띄우고 `prisma migrate deploy`로 모든 마이그레이션을 처음부터 적용한다. 따라서 새 Phase C 마이그레이션이:

- 기존 5개 Phase B 마이그레이션 위에 깨끗이 적용된다는 것
- 기존 90개 통합 테스트(active-membership, last-admin-protection, primary-team, role-seed, admin-skeleton, audit-log, auth-flow, org-team-membership)가 새 schema 추가로 깨지지 않는다는 것

이 두 가지가 자동으로 검증됐다.

---

## 12. 이번 단계에서 일부러 하지 않은 것

| 미룬 것 | 이유 / 다음 단계 |
| --- | --- |
| 문서 권한 판단 로직(`@notive/permissions` 모듈에 문서 룰 추가) | Step 2 이후. Step 1은 schema가 권한 판단을 방해하지 않는 것까지가 책임. |
| Document API 라우트(`POST /documents`, `GET /documents/:id` 등) | Step 3 이후 |
| 문서 작성 / 편집 화면 / 편집기 | UI 단계 |
| `template_id`, `ai_request_id` 외래 키 부착 | Phase D forward migration |
| 문서 mutating 액션 → audit writer 연결 | Phase B audit writer skeleton(`apps/web/lib/audit`)을 그대로 사용. 이 단계에서는 호출자(서비스 레이어) 자체가 없으므로 연결 시점은 Step 2 이후. |
| `documents.content`의 full-text 인덱스 | Phase F 검색 단계. 이번에는 컬럼만 TEXT로 잡아 둠. |

---

## 13. 다음 단계로 넘어가기 전에 알아야 할 주의사항

### 13.1 마이그레이션은 절대 손으로 수정하지 않는다

Phase B closure 합의(forward-only) 그대로다. 이미 `develop`에 머지된 마이그레이션 SQL은 운영 / 스테이징에 적용된 SQL이다. 수정 시 staging과 production이 다른 상태가 된다. 수정이 필요하면 새 forward 마이그레이션을 추가한다.

### 13.2 자식 테이블에 INSERT할 때 `organization_id`를 빠뜨리지 않는다

자식 테이블의 composite FK는 부모 문서와 같은 조직만 허용한다. 즉 Step 2 이후 어플리케이션이 `prisma.documentVersion.create()`를 호출할 때 `organization_id`도 명시적으로 채워야 한다. 자동으로 부모에서 끌어오지 않는다(Prisma의 동작이 그렇다). 헬퍼 함수를 만들 때 이 점을 강제하면 사고를 줄일 수 있다.

### 13.3 폴리몰픽 `document_shares.target_id`는 application이 검증해야 한다

`target_type=User|Team|Organization`에 따라 `target_id`가 가리키는 테이블이 달라진다. 이 다형 컬럼은 외래 키를 걸 수 없다. 따라서 `document_shares.create()` 직전에 application이 `target_id`가 실제로 존재하고 같은 조직인지 검증해야 한다. F 단계에서 `ai_references`도 같은 패턴으로 갈 예정이라 이번에 검증 헬퍼를 깔끔하게 빼두면 재사용된다.

### 13.4 `template_id` / `ai_request_id`는 D 단계 전까지는 application이 채우지 않는다

이번에 컬럼만 만들고 FK는 미부착이다. C 단계 application이 이 컬럼에 임의의 UUID를 채우면 D 단계에서 FK를 부착할 때 정합성 검증이 깨질 수 있다. C 단계 동안은 항상 NULL을 유지한다. AI 결과 저장 흐름은 D 단계가 들어와서 `templates` / `ai_requests`가 생긴 시점에 한꺼번에 활성화된다.

### 13.5 visibility=`SpecificUsers`만으로는 누가 볼 수 있는지 모른다

`documents.visibility=SpecificUsers`는 "공개 범위가 지정 사용자다"라고만 표시한다. 실제 대상 목록은 `document_shares` 행으로 표현된다. 권한 판단 시 visibility와 share를 **항상 함께** 봐야 한다. Step 2 이후의 권한 모듈은 이 두 자료를 한 번에 평가하는 단일 함수로 노출하는 것이 사고 예방에 좋다.

### 13.6 통합 테스트 첫 실행은 여전히 느리다

embedded-postgres의 첫 시작은 5–10초 걸린다. 이번 Phase C 마이그레이션 추가가 이 시간을 늘리지는 않았다. CI 캐시가 있으면 두 번째 실행부터 빠르다.

---

## 14. 비개발자 요약 — 한 단락

Step 1은 "문서를 어떤 모양으로 어디에 보관할지" 설계도(스키마)를 데이터베이스에 박아 넣은 단계였다. 문서 본문 / 버전 / 공유 대상 / 태그 / 즐겨찾기 / 조회 기록을 위한 7개 테이블을 만들고, "다른 조직의 문서가 우연히 섞여 들어오지 않는다" / "Department 같은 옛 개념은 데이터베이스에 자리도 없다" / "공유 권한과 공개 범위가 항상 같은 조직 안에서만 묶인다" 같은 안전 규칙을 데이터베이스가 직접 거부하도록 만들었다. 코드가 실수하든 운영자가 직접 SQL을 치든, 이 규칙들은 데이터베이스 단계에서 깨질 수 없다. 다음 단계(Step 2 이후)는 이 토대 위에 문서 작성 / 조회 / 공유 / 버전 복원 같은 사용자가 실제로 보는 기능을 얹는다.

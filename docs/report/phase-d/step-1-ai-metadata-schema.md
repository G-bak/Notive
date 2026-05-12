# Phase D — Step 1: AI 메타데이터 스키마 보고서

## 1. 보고 범위

본 보고서는 Phase D(AI 문서 생성) 구현의 **1단계 — AI 메타데이터 스키마**가 완료된 시점에 작성한 단계별 보고서다. 이 단계는 실제 AI provider 호출이나 생성 결과 본문 저장을 만들지 않고, AI 생성 요청과 결과를 추적할 수 있는 **메타데이터 토대**만 데이터베이스와 서비스 계층에 추가했다.

선행 보고서:

- [Phase C Closure / Phase D Preflight](../phase-c/phase-c-closure-phase-d-preflight.md)

이번 단계의 핵심 판단은 단순하다.

- AI 요청 원문(prompt / request body)은 `ai_requests`에 영구 저장하지 않는다.
- AI 응답 본문(title / content / response body)은 `ai_results`에 영구 저장하지 않는다.
- 생성 결과 본문은 사용자가 명시적으로 문서로 저장할 때만 `documents`에 들어간다.
- 생성 요청과 결과 조회 / 상태 변경은 기본적으로 요청자 본인에게만 허용한다.
- 조직 경계는 DB FK와 서비스 게이트를 함께 사용해 막는다.

---

## 2. Step 1의 목적

Phase D는 사용자가 자연어 요청과 참조 문서를 바탕으로 업무 문서 초안을 만드는 단계다. 그 기능을 바로 만들기 전에, 시스템은 최소한 다음 정보를 안전하게 기록할 수 있어야 한다.

- 누가 어떤 조직에서 AI 생성을 요청했는가
- 어떤 문서 유형 / 템플릿 / 목적 / 대상 / 톤으로 요청했는가
- 요청 상태가 Pending / Processing / Completed / Failed / Cancelled 중 어디인가
- 생성 결과 메타데이터가 남았는가
- 어떤 참조 자료가 사용되었는가
- 토큰 / 지연 시간 / 성공 여부 같은 운영 메타데이터를 추적할 수 있는가

Step 1은 이 토대만 만든다. 다음 항목은 의도적으로 범위 밖이다.

- 실제 AI provider 호출
- mock provider adapter
- prompt 조립
- Redis 기반 preview body 저장
- AI 생성 API route / UI
- 생성 결과를 문서 editor로 넘기는 flow
- opt-in 문제 신고용 `ai_request_payloads`
- admin / operations AI log 조회

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 / 수정된 핵심 파일

| 파일 | 내용 |
| --- | --- |
| `packages/db/prisma/migrations/20260511000000_phase_d_ai_metadata/migration.sql` | AI metadata enum 4개, AI metadata table 4개, 인덱스, FK, `documents.ai_request_id` FK 추가. |
| `packages/db/prisma/schema.prisma` | `AiRequest`, `AiResult`, `AiReference`, `AiUsageLog` 모델과 enum / relation 추가. |
| `apps/web/lib/services/ai-request.ts` | 최소 AI metadata service 추가. 요청 생성, 상태 전환, 결과 metadata 기록, reference snapshot 기록. |
| `tests/integration/ai-request-metadata.test.ts` | metadata-only persistence, 권한 / requester ownership, FK 경계, cross-org rejection 통합 테스트. |
| `packages/permissions/src/errors.ts` | `ai_request_create_not_allowed`, `ai_request_status_transition_invalid` reason code 추가. |

이번 단계는 DB / service / integration test 중심이다. API route와 UI는 추가하지 않았다.

---

## 4. 새로 추가된 AI 메타데이터 테이블

| 테이블 | 무엇을 저장하나 | 본문 저장 여부 |
| --- | --- | --- |
| `ai_requests` | 요청자, 조직, 문서 유형, 템플릿 ID, 목적 / 대상 / 톤, 상태, token / latency / error code. | prompt / request text 없음 |
| `ai_results` | 요청별 결과 metadata, 저장된 문서 연결 ID, result status, error code. | title / content / response text 없음 |
| `ai_references` | AI 생성에 사용되었거나 시도된 reference snapshot. 대상 종류 / ID / 제목 / accessAllowed. | reference 본문 없음 |
| `ai_usage_logs` | 운영 / 사용량 분석용 metadata. 조직, 사용자, 요청 ID, 문서 유형, 성공 여부, duration. | 본문 없음 |

이 네 테이블은 생성 flow를 추적하기 위한 metadata 계층이다. 문서 본문을 저장하는 계층이 아니다.

---

## 5. 새 enum

| enum | 값 | 의미 |
| --- | --- | --- |
| `AiRequestStatus` | Pending / Processing / Completed / Failed / Cancelled | AI 요청 lifecycle. |
| `AiResultStatus` | Generated / Selected / Saved / Discarded / Failed | 생성 결과가 preview / 선택 / 저장 / 폐기 / 실패 중 어디에 있는지. |
| `AiReferenceTargetType` | Document / Template / DiaryEntry / Todo | 참조 자료 종류. Phase E 이후 work context까지 받을 수 있도록 열어 둠. |
| `AiUsageStatus` | Success / Failed / Cancelled | usage log의 처리 결과. |

`DocumentSourceType`은 변경하지 않았다. Phase C에서 이미 `Manual` / `AI` / `Imported` 값을 만들어 두었기 때문이다.

---

## 6. AI 본문 보존 정책

이번 단계에서 가장 중요한 결정은 **AI 요청 / 응답 본문을 영구 metadata table에 넣지 않는 것**이다.

### 6.1 저장하지 않는 데이터

`ai_requests`에는 다음 컬럼이 없다.

- `request_text`
- `prompt`
- `prompt_text`
- `content`
- `body`

`ai_results`에는 다음 컬럼이 없다.

- `title`
- `content`
- `body`
- `response_text`
- `error_message`

통합 테스트는 `information_schema.columns`를 직접 조회해서 위 컬럼들이 존재하지 않는지 확인한다. 즉, 이 정책은 단순 코드 관례가 아니라 schema-level 테스트로 고정되어 있다.

### 6.2 어디에 저장되는가

Phase D 후속 단계에서 preview title / body는 session-bound short-term storage에만 둔다. 사용자가 명시적으로 저장을 선택하면 그때 일반 문서 저장 flow를 통해 `documents`에 들어간다.

문제 신고 같은 opt-in 흐름에서만 원문 payload를 별도 테이블 `ai_request_payloads`에 30일 한도로 저장하는 정책은 문서에 존재하지만, 이번 Step 1에서는 아직 구현하지 않았다.

### 6.3 error message 미저장

free-text `error_message`도 저장하지 않는다. AI provider나 내부 오류 메시지에 민감 정보가 섞일 수 있기 때문이다. 이번 단계는 짧은 `error_code`만 저장한다.

---

## 7. 조직 경계와 FK 결정

### 7.1 `ai_requests`의 조직 경계

`ai_requests`는 `organization_id`를 직접 가진다. 또한 `(id, organization_id)` composite unique를 추가했다.

이 unique는 자식 테이블이 다음 composite FK를 걸기 위한 기반이다.

- `ai_results.(ai_request_id, organization_id) -> ai_requests.(id, organization_id)`
- `ai_references.(ai_request_id, organization_id) -> ai_requests.(id, organization_id)`

따라서 다른 조직의 AI request ID를 가져와 결과나 reference를 섞으려 하면 PostgreSQL이 거부한다.

### 7.2 `ai_results.saved_document_id` composite FK

`ai_results`는 생성 결과가 문서로 저장되었을 때 `saved_document_id`를 가질 수 있다. 이 값은 단순히 `documents(id)`만 참조하지 않고 다음 composite FK를 사용한다.

```text
ai_results(saved_document_id, organization_id)
  -> documents(id, organization_id)
```

의미는 명확하다. AI 결과 row와 저장된 문서 row는 반드시 같은 조직에 있어야 한다. application bug로 다른 조직 문서를 saved result로 연결하려 해도 DB가 막는다.

삭제 정책은 `NO ACTION`이다. Phase C 문서는 일반적으로 hard delete가 아니라 `status=Deleted`와 `deleted_at`을 사용하는 soft delete이다. 운영상 hard delete가 필요하면 application이 먼저 `saved_document_id`를 null로 정리해야 한다.

### 7.3 `documents.ai_request_id`는 단일 FK + `SET NULL`

Phase C에서 `documents.ai_request_id`는 nullable UUID로 예약되어 있었다. 이번 단계에서 다음 FK를 추가했다.

```text
documents.ai_request_id -> ai_requests.id
ON DELETE SET NULL
```

composite FK를 쓰지 않은 이유는 실제 삭제 정책 때문이다. AI metadata는 90일 보존 후 정리될 수 있다. 이때 AI request row가 삭제되어도 사용자가 저장한 문서는 삭제되면 안 된다. 따라서 `documents.ai_request_id`는 null로 떨어져야 한다.

`(ai_request_id, organization_id)` composite FK에 `SET NULL`을 걸면 PostgreSQL / Prisma 제약상 `organization_id`까지 null 처리 대상이 된다. 그러나 `documents.organization_id`는 NOT NULL이다. 그래서 이 관계는 단일 FK + `SET NULL`을 선택했고, cross-org 정합성은 저장 service에서 강제하는 구조로 남겼다.

### 7.4 `ai_usage_logs.ai_request_id`도 `SET NULL`

usage log도 `ai_request_id` 단일 FK + `SET NULL`이다. AI request metadata가 retention cleanup으로 삭제되어도 사용량 집계와 운영 분석용 row는 남아야 하기 때문이다.

---

## 8. 서비스 entry point

신규 service는 `apps/web/lib/services/ai-request.ts`에 있다.

| 함수 | 역할 | 주요 권한 정책 |
| --- | --- | --- |
| `createAiRequest` | `Pending` 상태의 AI request metadata row 생성. | `requireMembership`; Viewer는 `FORBIDDEN(ai_request_create_not_allowed)`. |
| `transitionAiRequestStatus` | Pending -> Processing -> Completed / Failed / Cancelled 상태 전환. | 요청자 본인만 가능. invalid transition은 `CONFLICT(ai_request_status_transition_invalid)`. |
| `recordAiResult` | 생성 결과 metadata row 기록. title / content 저장 없음. | 요청자 본인만 가능. |
| `recordAiReferences` | 사용된 reference snapshot row 기록. | 요청자 본인만 가능. reference permission filtering은 호출 전 책임. |

모든 entry point는 `requireMembership`로 시작한다. cross-org actor는 `NOT_FOUND`를 받는다.

---

## 9. requester ownership gate

이번 단계는 AI request result / status 조작을 **요청자 본인 전용**으로 잠갔다.

정책:

- 요청자가 아니면 같은 조직의 Editor라도 `NOT_FOUND`
- 다른 조직 사용자도 `NOT_FOUND`
- Admin / operations log 조회는 별도 후속 단계

same-org non-requester에게 `FORBIDDEN`을 주지 않는 이유는 요청 ID 존재 자체를 알려주지 않기 위해서다. Phase C에서 문서 no-view 기본 응답을 `NOT_FOUND`로 둔 것과 같은 existence-leak guard다.

---

## 10. reference 기록 정책

`recordAiReferences`는 권한 판단 함수가 아니다. 이 함수는 이미 필터링된 reference 목록을 받아 audit snapshot으로 기록한다.

따라서 호출자는 반드시 다음 순서를 지켜야 한다.

1. 사용자가 reference document ID 목록을 제출한다.
2. service layer에서 각 document에 대해 `evaluateDocumentPermission` 또는 document view gate를 적용한다.
3. 권한 없는 reference는 AI provider 호출 전에 제외하거나 실패 처리한다.
4. 실제 사용된 reference만 `recordAiReferences`에 넘긴다.

이 결정을 서비스 파일 주석과 handoff에 모두 남겼다. Phase D Step 2의 핵심 검증 포인트는 바로 이 순서가 지켜지는지다.

---

## 11. 테스트 커버리지

신규 통합 테스트 파일은 `tests/integration/ai-request-metadata.test.ts`다.

주요 검증 항목:

| 영역 | 검증 내용 |
| --- | --- |
| schema body retention | `ai_requests`에 prompt / body 컬럼이 없는지, `ai_results`에 title / content / response 컬럼이 없는지 확인. |
| table existence | `ai_requests`, `ai_results`, `ai_references`, `ai_usage_logs` 존재 확인. |
| create gate | Editor 생성 가능, Viewer는 `FORBIDDEN(ai_request_create_not_allowed)`, cross-org actor는 `NOT_FOUND`. |
| lifecycle | Pending -> Processing -> Completed, Pending -> Cancelled, terminal status 재전환 거부. |
| ownership | 같은 조직의 다른 Editor가 result / reference 기록 시 `NOT_FOUND`. |
| document FK | 존재하지 않는 `ai_request_id`를 문서에 연결하면 FK 실패. parent 삭제 시 `documents.ai_request_id`는 null. |
| composite FK | 다른 조직의 `ai_request_id`로 `ai_results`를 만들면 DB가 거부. |
| saved document FK | `ai_results.saved_document_id`가 다른 조직 문서를 가리키면 DB가 거부. |

handoff 기준으로 다음 검증이 통과한 상태로 보고되었다.

```powershell
pnpm db:generate
pnpm --filter @notive/tests-integration test -- ai-request-metadata.test.ts
pnpm --filter @notive/tests-integration typecheck
pnpm test:integration
pnpm typecheck
pnpm test
git diff --check
```

---

## 12. 남은 위험과 후속 작업

### 12.1 reference permission filtering은 아직 호출자 책임

이번 단계의 `recordAiReferences`는 gate가 아니라 recorder다. Phase D Step 2에서 generation service를 만들 때 reference document filtering을 service 진입점에 강제해야 한다.

완료 기준:

- no-view document가 AI provider input에 들어가지 않는다.
- cross-org document ID가 reference로 들어오면 provider 호출 전에 차단된다.
- `recordAiReferences`에는 실제 사용된 reference snapshot만 들어간다.

### 12.2 preview body 저장소 미구현

AI 결과 본문을 DB에 저장하지 않기로 했으므로, 후속 단계는 preview title / body를 session-bound short-term storage에 둬야 한다. Phase B에서 Redis-compatible short-term storage 방침은 잡혀 있지만, 실제 business write는 아직 없다.

완료 기준:

- preview title / body는 permanent DB table에 들어가지 않는다.
- 미저장 preview는 24시간 또는 discard 시 삭제되는 경로를 갖는다.
- 사용자가 save를 눌러야 `documents`에 들어간다.

### 12.3 saved document linkage service 미구현

`ai_results.saved_document_id` FK는 있지만, AI 결과를 문서로 저장하면서 `resultSaved`, `savedDocumentId`, `documents.aiRequestId`, `DocumentSourceType.AI`를 함께 갱신하는 application flow는 아직 없다.

후속 단계에서 저장 flow를 만들 때 확인할 점:

- saved document는 같은 조직이어야 한다.
- 저장 후 `sourceType = AI`가 명시되어야 한다.
- 문서 저장 실패 시 AI result metadata만 반쯤 저장되는 상태를 피해야 한다.

### 12.4 Admin / operations AI log 조회 미구현

이번 단계의 service entry point는 requester-only다. Admin이 조직의 AI usage나 request metadata를 보는 화면 / API는 별도 정책과 별도 service로 만들어야 한다.

그때도 본문 조회는 기본 금지다. 일반 Admin도 prompt / response body를 제품 UI/API에서 볼 수 없어야 한다.

---

## 13. 다음 단계 추천

다음 작업은 **Phase D Step 2 — mock-first AI generation service skeleton**이 적절하다.

권장 범위:

- mock AI provider adapter만 추가한다.
- generation service가 `createAiRequest` -> `Processing` -> mock result -> `Completed` -> `recordAiResult` -> `recordAiReferences` 흐름을 묶는다.
- reference document permission filtering을 provider 호출 전에 강제한다.
- preview title / body는 permanent DB table에 저장하지 않는다.
- 실제 provider 호출은 아직 하지 않는다.
- route / UI는 별도 선택이 있기 전까지 범위 밖으로 둔다.

검증 기준:

- prompt / response body가 `ai_requests` / `ai_results` / `ai_references` / `ai_usage_logs`에 들어가지 않는다.
- no-view / cross-org reference는 AI provider input에 들어가지 않는다.
- requester-only 접근 정책이 유지된다.
- 실패 / 취소 transition이 Step 1 lifecycle과 충돌하지 않는다.

---

## 14. Decision

Phase D Step 1은 AI 생성 기능의 영구 데이터 경계를 만든 단계로 완료 판단 가능하다.

완료로 보는 이유:

- AI metadata table과 FK가 추가되었다.
- 본문 미저장 정책이 schema와 test로 고정되었다.
- requester-only service gate가 구현되었다.
- 조직 경계가 composite FK와 service gate로 방어된다.
- Phase D Step 2가 의존할 최소 service entry point가 준비되었다.

다음에는 보고서 commit / merge / push를 사용자 명시 지시 후 진행하고, 그 다음 Phase D Step 2 mock-first generation service로 넘어간다.

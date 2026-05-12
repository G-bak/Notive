# Phase D — Step 2: Mock-first AI 생성 서비스 보고서

## 1. 보고 범위

본 보고서는 Phase D(AI 문서 생성) 구현의 **2단계 — mock-first AI generation service skeleton**이 완료된 시점의 단계별 보고서다. Step 1에서 만든 AI metadata service 위에 실제 생성 lifecycle을 묶되, 외부 AI provider 호출은 아직 하지 않는다.

선행 보고서:

- [Phase D Step 1 — AI 메타데이터 스키마](./step-1-ai-metadata-schema.md)

이번 단계의 핵심은 다음 네 가지다.

- mock provider만 사용해 CI에서 결정적으로 AI 생성 흐름을 검증한다.
- reference document는 provider 호출 전에 문서 View 권한으로 필터링한다.
- preview title / content는 함수 반환값으로만 노출하고 영구 DB table에 저장하지 않는다.
- 실패도 Step 1 lifecycle 안에서 `Failed` 상태와 `ai_results.status=Failed`로 정리한다.

---

## 2. Step 2의 목적

Step 1은 `ai_requests`, `ai_results`, `ai_references`, `ai_usage_logs`와 최소 service entry point를 만들었다. 그러나 그 entry point들은 아직 하나의 생성 흐름으로 연결되어 있지 않았다.

Step 2의 목적은 다음과 같다.

- `createAiRequest` → `Processing` → provider 호출 → `Completed` / `Failed` → result / references 기록 흐름을 하나의 service로 묶는다.
- 실제 provider 대신 deterministic mock provider를 사용한다.
- reference document 권한 필터링을 provider 호출 전에 강제한다.
- 차단된 reference는 `accessAllowed=false` audit snapshot으로 남기되 provider input에는 넣지 않는다.
- preview body가 permanent DB에 들어가지 않는 것을 테스트로 고정한다.

다음 항목은 이번 단계 범위 밖이다.

- 실제 OpenAI / Anthropic provider 연동
- API route / UI
- Redis 기반 preview body 저장
- AI 결과를 document editor / save flow에 연결
- admin / operations AI log 조회

---

## 3. 이번에 추가한 파일

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/ai/provider/mock.ts` | `AiProvider` interface, deterministic mock provider, `MockProviderError`. |
| `apps/web/lib/services/ai-generation.ts` | `generateAiDocument` orchestration service. Step 1 metadata service와 provider / reference filtering을 결합. |
| `tests/integration/ai-generation.test.ts` | 12개 통합 테스트. lifecycle, 권한, reference filtering, body retention, failure path 검증. |

DB schema / migration은 변경하지 않았다. Step 1의 service signature도 변경하지 않았다.

---

## 4. 생성 lifecycle

`generateAiDocument`는 다음 순서로 동작한다.

1. reference 개수와 UUID 형식을 검증한다.
2. `requireMembership`로 actor를 구성한다.
3. `createAiRequest`로 `Pending` 요청을 만든다.
4. reference document ID 목록을 조직 / 권한 기준으로 resolve한다.
5. AI request를 `Processing`으로 전환한다.
6. mock provider를 호출한다.
7. 성공 시 `Completed` 전환 후 `Generated` result와 reference snapshot을 기록한다.
8. 실패 시 `Failed` 전환 후 `Failed` result와 reference snapshot을 기록한다.

Viewer 차단과 requester-only write gate는 Step 1 metadata service의 entry point를 그대로 통과한다. Step 2는 별도의 우회 write path를 만들지 않았다.

---

## 5. Reference 권한 필터링

reference filtering은 provider 호출 전에 실행된다.

정책:

- `prisma.document.findMany`는 먼저 `organizationId`로 좁힌다.
- 찾은 row는 `evaluateDocumentPermission`으로 View 가능 여부를 평가한다.
- 허용된 reference만 provider input에 들어간다.
- cross-org / missing / no-view reference는 `accessAllowed=false`, `targetTitle=null`로 기록된다.

이 구조의 의미:

- 사용자가 볼 수 없는 문서는 AI prompt context에 들어가지 않는다.
- 차단된 ID의 제목도 preview body에 섞이지 않는다.
- audit snapshot은 “사용자가 어떤 reference를 시도했고 무엇이 차단되었는지”를 남긴다.

Codex 검증 중 reference ID가 UUID 형식이 아닐 때 DB uuid parse 오류가 lifecycle 중간에 발생할 수 있는 위험을 발견했다. 이를 막기 위해 `referenceDocumentIds` 형식 검증을 AI request 생성 전에 추가했다. invalid UUID는 `INVALID_INPUT`이며 `ai_requests` row를 만들지 않는다.

---

## 6. Body retention

이번 단계도 Step 1의 body retention 정책을 유지한다.

저장하지 않는 것:

- assembled prompt
- provider response title
- provider response content
- preview body

`recordAiResult`에는 status / errorCode만 전달한다. `transitionAiRequestStatus`에는 latency / token / errorCode metadata만 전달한다. preview `{ title, content }`는 `generateAiDocument` 반환값에만 존재한다.

테스트는 다음을 확인한다.

- `ai_requests` row JSON에 preview title / content가 없다.
- `ai_results` row JSON에 preview title / content가 없다.
- `ai_results` row key에 `title`, `content`, `body`가 없다.
- `documents` row가 side effect로 생성되지 않는다.

---

## 7. 실패 처리

provider가 throw하면 service는 예외를 다시 던지지 않는다. generation failure는 사용자가 재시도하거나 요청을 수정할 수 있는 정상 실패 상태이기 때문이다.

실패 결과:

- `ai_requests.status = Failed`
- `ai_requests.errorCode = provider error code`
- `ai_results.status = Failed`
- `ai_results.errorCode = provider error code`
- `preview = null`
- reference snapshot은 그대로 기록

`MockProviderError`는 자체 `errorCode`를 보존한다. 일반 `Error`는 `provider_unknown_error`로 매핑한다.

정책 위반은 여전히 throw한다. 예를 들어 Viewer 생성 시도, cross-org actor, invalid reference input은 ApiError로 중단된다.

---

## 8. 테스트 커버리지

신규 통합 테스트는 `tests/integration/ai-generation.test.ts`다.

| 영역 | 케이스 |
| --- | --- |
| happy path | allowed reference 포함 성공, reference 없는 성공 |
| role gate | Viewer `FORBIDDEN(ai_request_create_not_allowed)`, cross-org actor `NOT_FOUND` |
| reference filtering | cross-org 차단, same-org no-view 차단, allowed + blocked 혼합 |
| input validation | reference 10개 초과 `INVALID_INPUT`, invalid UUID `INVALID_INPUT` |
| body retention | preview body가 `ai_requests` / `ai_results` / `documents`에 남지 않음 |
| failure path | mock provider failure, 일반 Error failure |

검증 결과:

```powershell
pnpm --filter @notive/tests-integration test -- ai-generation.test.ts
# PASS — 12 tests

pnpm test:integration
# PASS — 16 files / 266 tests

pnpm test
# PASS — 6 files / 99 tests

pnpm typecheck
# PASS — 9 workspaces clean

pnpm exec prettier --check apps/web/lib/ai/provider/mock.ts apps/web/lib/services/ai-generation.ts tests/integration/ai-generation.test.ts
# PASS

git diff --check
# PASS
```

---

## 9. 남은 위험과 후속 작업

### 9.1 Preview storage 미구현

현재 preview body는 함수 반환값에만 있다. API route / UI가 추가되면 Redis-compatible short-term storage에 저장하는 흐름이 필요하다.

검증 기준:

- Redis preview body는 permanent DB가 아니다.
- discard / idle timeout 정리 정책을 가져야 한다.
- preview ID는 requester/session 경계로 보호되어야 한다.

### 9.2 Save-to-document flow 미구현

AI 결과를 문서로 저장하는 flow는 아직 없다. 후속 단계에서 `DocumentSourceType.AI`, `documents.ai_request_id`, `ai_results.saved_document_id`, `ai_requests.result_saved`를 일관되게 묶어야 한다.

검증 기준:

- 저장 전 preview는 draft일 뿐이다.
- 사용자가 명시적으로 저장해야 `documents`에 들어간다.
- 저장 실패 시 metadata와 document가 반쯤 연결된 상태로 남지 않아야 한다.

### 9.3 실제 provider 미구현

실제 provider adapter가 들어오면 prompt assembly, token accounting, provider error mapping, timeout / retry 정책을 별도로 검증해야 한다.

가장 중요한 유지 조건:

- provider input에는 허용된 reference만 들어간다.
- prompt / response body는 영구 metadata table에 저장하지 않는다.
- provider error message free text를 DB에 저장하지 않는다.

---

## 10. Decision

Phase D Step 2는 완료 판단 가능하다.

완료로 보는 이유:

- mock-first generation service가 Step 1 metadata service 위에서 lifecycle을 끝까지 실행한다.
- reference 권한 필터링이 provider 호출 전에 고정되었다.
- cross-org / no-view reference가 provider input에 들어가지 않는 테스트가 있다.
- preview body 미저장 정책이 테스트로 고정되었다.
- failure path가 `Failed` lifecycle로 정리된다.
- 모든 게이트가 통과했다.

다음 권장 작업은 Phase D Step 3이다. 후보는 둘 중 하나다.

- API route를 붙이고 route-level envelope / session boundary smoke를 추가한다.
- 또는 Redis 기반 preview body short-term storage를 먼저 구현한다.

Codex 판단으로는 **Redis preview storage를 먼저 구현**하는 편이 안전하다. route / UI가 preview body를 다루기 전에 “본문은 어디에 얼마나 보관되는가”를 먼저 잠가야 하기 때문이다.

# Phase D — Step 5: AI Preview를 Draft 문서로 저장 보고서

## 1. 보고 범위

본 보고서는 Phase D(AI 문서 생성) 구현의 **5단계 — AI preview save-to-document**가 완료된 시점의 단계별 보고서다. Step 2/3에서 만든 generation service와 preview short-term storage, Step 4의 route 표면 위에, 사용자가 명시적으로 preview를 permanent `documents` row로 승격시키는 backend flow를 추가했다.

선행 보고서:

- [Phase D Step 1 — AI 메타데이터 스키마](./step-1-ai-metadata-schema.md)
- [Phase D Step 2 — Mock-first AI 생성 서비스](./step-2-mock-ai-generation-service.md)
- [Phase D Step 3 — AI Preview 단기 저장소](./step-3-ai-preview-short-term-storage.md)
- [Phase D Step 4 — AI preview API route smoke](./step-4-ai-preview-api-route-smoke.md)

이번 단계의 핵심은 다음과 같다.

- preview body가 처음으로 permanent `documents` row에 들어가는 단계다.
- save는 명시적 사용자 액션이고, route는 body를 받지 않는다.
- 한 트랜잭션 안에서 document / version #1 / ai_results / ai_requests 갱신이 모두 commit되거나 모두 rollback된다.
- 중복 save는 `resultSaved=false` 전제조건으로 막아서 두 번째 document가 만들어지지 않는다.
- save 성공 후 preview store entry는 discard된다(best-effort).

---

## 2. 이번에 추가한 파일

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/ai-document-save.ts` | `saveAiPreviewAsDocument` service. 한 트랜잭션에서 document 생성 → version #1 → `ai_results.status=Saved` + `savedDocumentId` → `ai_requests.resultSaved=true`. |
| `apps/web/app/api/organizations/[id]/ai/requests/[aiRequestId]/save/route.ts` | `POST` save route. session user / URL param만 사용. body는 받지 않는다. |
| `tests/integration/ai-save-routes-smoke.test.ts` | save route smoke 12개 케이스. |
| `docs/report/phase-d/step-5-ai-preview-save-document.md` | 본 보고서. |

기존 Step 1~4 코드는 변경하지 않았다.

---

## 3. Service 동작 (`saveAiPreviewAsDocument`)

### 3.1 시그니처

```ts
async function saveAiPreviewAsDocument(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  aiRequestId: string,
  opts?: { previewStore?: AiPreviewStore },
): Promise<{ document: Document; aiRequest: AiRequest; aiResult: AiResult }>;
```

### 3.2 권한 / 상태 gate

| 조건 | 결과 |
| --- | --- |
| 비멤버 (cross-org) | `NOT_FOUND` (`requireMembership`) |
| `aiRequest`가 없거나 `requestedByUserId !== userId` | `NOT_FOUND` (existence-leak guard) |
| requester의 현재 멤버십 role이 Editor 미만 | `FORBIDDEN(document_create_not_allowed)` |
| `aiRequest.status !== "Completed"` | `CONFLICT(ai_request_not_saveable)` |
| `aiRequest.resultSaved === true` | `CONFLICT(ai_request_already_saved)` |
| preview store에 entry 없음 (만료 / discard 후) | `NOT_FOUND` |
| 위 모든 gate 통과 | 트랜잭션 진입 |

같은 조직의 peer 사용자도 같은 `aiRequestId`로 들어오면 `requestedByUserId` 미일치로 `NOT_FOUND`다. Viewer가 다른 사용자의 request를 저장하려고 해도 같은 이유로 `NOT_FOUND`다 (Viewer 본인은 Step 1 gate에 의해 자기 request를 만들 수 없으므로, 본인 save가 발생할 수 없다).

### 3.3 트랜잭션 내부 동작

```text
prisma.$transaction(async (tx) => {
  1. tx.document.create({
       sourceType: "AI",
       aiRequestId,
       status: "Draft",
       visibility: "Private",
       ownerUserId / authorUserId = session user,
       ownerTeamId = membership.teamId,
       title / content / documentType = preview + aiRequest,
     })
  2. createDocumentVersionInTx(tx, document, version 1 snapshot)
  3. tx.aiResult.findMany({
       where: { aiRequestId, organizationId, status: "Generated", savedDocumentId: null },
     })
     정확히 1건이 아니면 → throw CONFLICT(ai_result_not_saveable)
  4. tx.aiRequest.updateMany({
       where: { id, organizationId, resultSaved: false },
       data: { resultSaved: true },
     })
     count === 0 → throw CONFLICT(ai_request_already_saved)
  5. tx.aiResult.updateMany({
       where: { id: saveableResult.id, aiRequestId, organizationId, status: "Generated", savedDocumentId: null },
       data: { status: "Saved", savedDocumentId: document.id },
     })
     count === 0 → throw CONFLICT(ai_result_not_saveable)
})
```

`resultSaved=false` 전제조건은 동시 double-save에 대한 race guard다. 두 번째 트랜잭션이 진입해도 update count가 0이라 throw → 전체 트랜잭션 rollback → tentative하게 만든 document도 함께 사라진다. half-linked 상태는 발생하지 않는다.

### 3.4 트랜잭션 외부 (commit 이후)

1. `store.discard({ aiRequestId, organizationId, userId })` — best-effort. 실패해도 24h TTL로 자연 만료된다.
2. `recordActivity` — `DOCUMENT_CREATED` 액션을 `metadata.source = "ai"`, `metadata.aiRequestId`와 함께 기록한다. 기존 manual 생성 audit 컨슈머와 호환되면서 AI 소스를 구분할 수 있다.

---

## 4. Route 동작

### 4.1 시그니처

```text
POST /api/organizations/[id]/ai/requests/[aiRequestId]/save
```

- Request body는 받지 않는다. body가 와도 service에 전달되지 않으므로 `userId`, `sourceType`, `aiRequestId`, `content`, `title` 등 어떤 client-supplied 필드도 무시된다.
- `params.id`(organizationId) 와 `params.aiRequestId`만 사용.
- `params.aiRequestId`는 진입 시 UUID validation을 거친다 (Postgres `uuid-parse` 500 leak 방지).
- session user는 `getCurrentSession(cookies())`에서만 얻는다.

### 4.2 응답 envelope (201)

```ts
{
  document: {
    id, organizationId, title, content, documentType, status: "Draft",
    ownerUserId, authorUserId, ownerTeamId, visibility: "Private",
    sourceType: "AI", aiRequestId, createdAt, updatedAt
  },
  aiRequest: { id, status: "Completed", resultSaved: true },
  aiResult: { id, status: "Saved", savedDocumentId }
}
```

### 4.3 에러 envelope

기존 `respondError` 매핑을 그대로 사용한다.

| 상태 | envelope |
| --- | --- |
| unauthenticated | 401 `{ error: "UNAUTHORIZED", reason_code: "UNAUTHORIZED" }` |
| malformed `aiRequestId` | 400 `{ error: "INVALID_INPUT", reason_code: "INVALID_INPUT" }` |
| cross-org / peer / not requester / missing | 404 `{ error: "NOT_FOUND" }` (no reason_code) |
| requester의 현재 role이 Viewer | 403 `{ error: "FORBIDDEN", reason_code: "document_create_not_allowed" }` |
| Failed 또는 미완료 request | 409 `{ error: "CONFLICT", reason_code: "ai_request_not_saveable" }` |
| 이미 저장된 request | 409 `{ error: "CONFLICT", reason_code: "ai_request_already_saved" }` |
| preview entry 없음 (만료 / 이미 discard) | 404 `{ error: "NOT_FOUND" }` |

---

## 5. 추가한 smoke test (`ai-save-routes-smoke.test.ts`)

12개 케이스 모두 embedded-postgres + 실제 service 호출.

| # | 케이스 | 기대 |
| --- | --- | --- |
| 1 | unauthenticated | 401 UNAUTHORIZED |
| 2 | requester happy path | 201, document(sourceType=AI, aiRequestId=요청, status=Draft, content=preview content), version #1, `aiResult.status=Saved`+`savedDocumentId`, `aiRequest.resultSaved=true`, save 후 `loadAiPreview` → NOT_FOUND |
| 3 | client가 body에 `userId`/`sourceType`/`aiRequestId`/`content`/`title`을 spoof | 모두 무시. session user / `sourceType=AI` / URL param / preview body가 그대로 적용 |
| 4 | same-org peer save | 404 NOT_FOUND, `resultSaved=false` 유지, document 생성 안 됨 |
| 5 | cross-org actor save | 404 NOT_FOUND |
| 6 | viewer가 타인의 request 저장 | 404 NOT_FOUND |
| 7 | requester가 생성 후 Viewer로 강등된 상태에서 save | 403 `document_create_not_allowed`, document 생성 안 됨 |
| 8 | failed AI request save | 409 `ai_request_not_saveable`, document 생성 안 됨 |
| 9 | Generated `ai_results`가 여러 개 있는 비정상 상태 | 409 `ai_result_not_saveable`, document 생성 안 됨, `resultSaved=false` 유지 |
| 10 | duplicate save | 첫 번째 201 + 두 번째 409 `ai_request_already_saved`. `documents`는 1건만 존재, `aiResult.savedDocumentId`는 그대로 첫 번째 document, `resultSaved=true` 유지 → **half-linked 상태 없음** |
| 11 | malformed aiRequestId (`not-a-uuid`) | 400 INVALID_INPUT (500 leak 없음) |
| 12 | non-existent aiRequestId (`00000000-...`) | 404 NOT_FOUND |

---

## 6. 권한 / 보안 정합성 (Codex 검증 포인트 매핑)

| Codex 포인트 | 본 단계에서의 보장 |
| --- | --- |
| preview body가 사용자 save 전까지 DB에 안 들어감 | save service는 첫 번째 DB write 전에 store에서 load. 다른 진입점은 그대로 두었다. |
| save 시점에는 오직 requester preview만 문서화 | store key가 `(org, user, aiRequest)`이고 service가 session userId로 lookup. peer / cross-org는 lookup miss로 NOT_FOUND. (테스트 #4, #5) |
| 중복 저장 방지 | `resultSaved=false` 전제조건 + `aiResult.savedDocumentId=null` 전제조건. 두 번째 시도는 트랜잭션 rollback. (테스트 #8) |
| DB transaction 원자성 | document, version, ai_result, ai_request이 한 `prisma.$transaction` 안에서 처리. 어느 단계든 throw하면 전체 rollback. |
| sourceType=AI, aiRequestId, savedDocumentId, resultSaved 연결 정합성 | 응답 + DB read 양쪽으로 happy path에서 검증. (테스트 #2) |
| route가 client input 신뢰 안 함 | route는 body를 전혀 service에 넘기지 않음. (테스트 #3) |
| 저장 시점의 문서 생성 권한 유지 | requester가 생성 후 Viewer로 강등되면 save 불가. (테스트 #7) |
| 비정상 다중 result 방어 | saveable `ai_results`가 정확히 1건일 때만 Saved로 전환. (테스트 #9) |

---

## 7. Out of Scope (Step 5 외)

- UI / editor page
- 실제 AI provider
- Redis adapter
- 이미 존재하는 document에 overwrite / merge 저장
- admin / operations용 AI 로그 조회
- opt-in `ai_request_payloads`

---

## 8. 실행한 검증

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @notive/tests-integration test -- ai-save-routes-smoke.test.ts` | 12 pass |
| `pnpm --filter @notive/tests-integration test -- ai-routes-smoke.test.ts ai-preview.test.ts ai-generation.test.ts` | 모두 pass |
| `pnpm test:integration` | 모든 integration suite pass |
| `pnpm test` | 전체 unit suite pass |
| `pnpm typecheck` | 모든 workspace project pass |
| `pnpm exec prettier --check` (신규 4개 파일) | pass (format 적용 후) |
| `git diff --check` | clean |

상세 결과는 작업 보고에 첨부.

---

## 9. 다음 단계 후보

Step 5까지로 backend save flow는 완결되었다. 다음 권장 단계는 둘 중 하나다.

- Step 6 후보 A: AI generation lifecycle Cancel route + service. 사용자가 처리 중인 request를 취소할 수 있도록 한다.
- Step 6 후보 B: UI / editor handoff. 본 단계의 save route 위에 실제 editor 페이지에서 "AI 결과 저장" 버튼을 연결한다.

선택은 Codex와 사용자가 한다.

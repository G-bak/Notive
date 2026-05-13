# Phase D — Step 4: AI preview API route smoke 보고서

## 1. 보고 범위

본 보고서는 Phase D(AI 문서 생성) 구현의 **4단계 — AI preview API route smoke**가 완료된 시점의 단계별 보고서다. Step 2/3에서 만든 AI generation service와 preview short-term storage 위에 session 기반 API route를 추가하고, route level에서 actor/source 경계가 깨지지 않는지 smoke test로 고정했다.

선행 보고서:

- [Phase D Step 1 — AI 메타데이터 스키마](./step-1-ai-metadata-schema.md)
- [Phase D Step 2 — Mock-first AI 생성 서비스](./step-2-mock-ai-generation-service.md)
- [Phase D Step 3 — AI Preview 단기 저장소](./step-3-ai-preview-short-term-storage.md)

이번 단계의 핵심은 다음과 같다.

- route는 `userId`를 request body / query / params에서 받지 않는다.
- actor는 오직 `getCurrentSession(cookies())`의 session user다.
- AI generation route는 Step 2/3 `generateAiDocument` service를 호출한다.
- preview load / discard route는 Step 3 `loadAiPreview` / `discardAiPreview` service를 호출한다.
- requester-only preview 경계는 route smoke로 고정한다.
- provider failure는 preview를 만들지 않는다.

---

## 2. 이번에 추가한 파일

| 파일 | 내용 |
| --- | --- |
| `apps/web/app/api/organizations/[id]/ai/generate/route.ts` | `POST /api/organizations/[id]/ai/generate` route. Session user로 AI generation service 호출. |
| `apps/web/app/api/organizations/[id]/ai/requests/[aiRequestId]/preview/route.ts` | `GET` / `DELETE` preview route. Session user로 preview load / discard service 호출. |
| `tests/integration/ai-routes-smoke.test.ts` | AI route smoke 13개 케이스. Session actor, requester-only preview, blocked reference 미노출, failure preview 미생성 검증. |

기존 service / store 구현은 변경하지 않았다. Codex 검증 중 새 파일의 주석 인코딩만 ASCII로 정리했다.

---

## 3. Route 동작

### 3.1 Generation

```text
POST /api/organizations/[id]/ai/generate
```

입력:

```ts
{
  documentType: string;
  templateId?: string | null;
  purpose?: string | null;
  audience?: string | null;
  tone?: string | null;
  referenceDocumentIds?: string[];
}
```

`userId`가 body에 포함되어도 읽지 않는다. route는 session user id와 path의 organization id만 service에 넘긴다.

성공 응답은 `201`이다. `Completed`와 provider `Failed` lifecycle 모두 AI request가 terminal state까지 정상 기록된 것으로 보며, failure는 `aiRequest.status === "Failed"`와 `preview: null`로 구분한다.

응답 envelope:

```ts
{
  aiRequest: {
    id: string;
    organizationId: string;
    requestedByUserId: string;
    status: "Completed" | "Failed";
    documentType: string;
    templateId: string | null;
    purpose: string | null;
    audience: string | null;
    tone: string | null;
    errorCode: string | null;
    latencyMs: number | null;
    tokenCountInput: number | null;
    tokenCountOutput: number | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  aiResult: {
    id: string;
    aiRequestId: string;
    status: "Generated" | "Failed";
    errorCode: string | null;
    createdAt: string;
  };
  references: Array<{
    id: string;
    targetType: "Document";
    targetId: string;
    targetTitle: string | null;
    accessAllowed: boolean;
  }>;
  preview: {
    aiRequestId: string;
    title: string;
    content: string;
    expiresAt: string;
  } | null;
}
```

### 3.2 Preview load

```text
GET /api/organizations/[id]/ai/requests/[aiRequestId]/preview
```

응답:

```ts
{
  aiRequestId: string;
  organizationId: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  expiresAt: string;
}
```

same-org peer / cross-org actor / expired / discarded / missing preview는 `{ error: "NOT_FOUND" }`로 응답한다.

### 3.3 Preview discard

```text
DELETE /api/organizations/[id]/ai/requests/[aiRequestId]/preview
```

요청자가 discard하면 `204`다. same-org peer도 idempotent `204`를 받을 수 있지만, store key가 session user id를 포함하므로 원 요청자의 preview는 삭제되지 않는다. cross-org actor는 membership gate에서 `404 NOT_FOUND`다.

---

## 4. Smoke test 커버리지

`tests/integration/ai-routes-smoke.test.ts`는 다음 13개 케이스를 고정한다.

| 영역 | 케이스 |
| --- | --- |
| POST generate | unauthenticated `401 UNAUTHORIZED` |
| POST generate | Editor happy path `201` + full envelope |
| POST generate | Viewer `403 FORBIDDEN(ai_request_create_not_allowed)` + DB row 미생성 |
| POST generate | client-supplied `userId` 무시, session user로 DB row 생성 |
| POST generate | cross-org actor `404 NOT_FOUND` |
| POST generate | provider failure `201`, `preview: null`, 후속 preview load `404` |
| POST generate | cross-org reference는 `accessAllowed=false`, blocked title이 preview에 미노출 |
| GET preview | requester `200` |
| GET preview | same-org peer `404 NOT_FOUND` |
| GET preview | cross-org actor `404 NOT_FOUND` |
| DELETE preview | requester discard `204`, 후속 load `404` |
| DELETE preview | peer discard `204`, 원 requester preview 보존 |
| DELETE preview | cross-org discard `404`, 원 preview 보존 |

---

## 5. Codex 검증 결과

Codex 검증에서 확인한 사항:

- `POST` route의 `parseInput`은 body의 `userId`를 읽지 않는다.
- `generateAiDocument(prisma, user.id, params.id, input)` 호출로 session user만 actor로 사용한다.
- `GET` / `DELETE` preview route도 session user만 `loadAiPreview` / `discardAiPreview`에 전달한다.
- route layer가 preview title/content를 별도 DB write path로 저장하지 않는다.
- blocked reference title은 reference snapshot에서 `targetTitle: null`로 남고 preview body에 들어가지 않는다.
- malformed `aiRequestId`는 route entry에서 `INVALID_INPUT`으로 막아 Postgres uuid parse error가 500으로 노출되지 않는다.

Provider failure의 HTTP status는 `201`로 유지한다. 현재 service contract가 provider failure를 thrown exception이 아니라 `Failed` lifecycle result로 반환하기 때문에 route에서는 성공적으로 생성된 AI request envelope로 보는 것이 일관된다. UI는 `aiRequest.status`와 `preview === null`로 실패 상태를 구분한다.

---

## 6. 검증 명령

Codex가 재실행한 검증:

```powershell
pnpm --filter @notive/tests-integration test -- ai-routes-smoke.test.ts
pnpm --filter @notive/tests-integration test -- ai-preview.test.ts ai-generation.test.ts
pnpm exec prettier --check apps/web/app/api/organizations/[id]/ai/generate/route.ts apps/web/app/api/organizations/[id]/ai/requests/[aiRequestId]/preview/route.ts tests/integration/ai-routes-smoke.test.ts
pnpm test:integration
pnpm test
pnpm typecheck
git diff --check
```

결과:

- `ai-routes-smoke.test.ts`: 13 passed
- `ai-preview.test.ts` + `ai-generation.test.ts`: 26 passed
- `pnpm test:integration`: 18 files / 293 tests passed
- `pnpm test`: 6 files / 99 tests passed
- `pnpm typecheck`: 10 workspace projects passed
- `prettier --check`: passed
- `git diff --check`: clean

---

## 7. 남은 위험과 후속 작업

### 7.1 실제 provider 미구현

이번 route는 mock provider 기반 service default를 사용한다. 실제 provider adapter가 들어오면 timeout, retry, provider error mapping, token accounting, prompt assembly의 body retention 정책을 별도로 검증해야 한다.

### 7.2 Redis adapter 미구현

preview store는 여전히 in-memory default다. production 다중 인스턴스에서는 Redis adapter가 필요하다.

### 7.3 Save-to-document flow 미구현

AI preview를 사용자가 명시적으로 문서로 저장하는 흐름은 아직 없다. 다음 단계에서는 `DocumentSourceType.AI`, `documents.aiRequestId`, `ai_results.savedDocumentId`, `ai_requests.resultSaved`를 원자적으로 연결해야 한다.

---

## 8. Decision

Phase D Step 4는 완료 판단 가능하다.

완료로 보는 이유:

- session user만 actor로 사용하는 route 경계가 구현되었다.
- `userId` client spoofing이 route smoke와 DB row 검증으로 고정되었다.
- requester-only preview load / discard 경계가 route smoke로 고정되었다.
- provider failure는 preview를 만들지 않는다.
- blocked reference title이 preview로 누출되지 않는다.
- 기존 Step 2/3 service tests와 전체 integration / unit / typecheck가 통과했다.

다음 권장 작업은 Phase D Step 5다. 후보는 AI preview를 document save/editor handoff로 연결하는 단계이며, 저장 전 preview body가 permanent DB에 들어가지 않는 현재 경계를 유지해야 한다.

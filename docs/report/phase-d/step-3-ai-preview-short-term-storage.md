# Phase D — Step 3: AI Preview 단기 저장소 보고서

## 1. 보고 범위

본 보고서는 Phase D(AI 문서 생성) 구현의 **3단계 — AI preview short-term storage**가 완료된 시점의 단계별 보고서다. Step 2의 mock-first generation service가 반환하는 preview `{ title, content }`를 permanent DB에 저장하지 않고, TTL이 있는 Redis-shaped short-term store에 보관 / 조회 / 폐기할 수 있게 만든다.

선행 보고서:

- [Phase D Step 1 — AI 메타데이터 스키마](./step-1-ai-metadata-schema.md)
- [Phase D Step 2 — Mock-first AI 생성 서비스](./step-2-mock-ai-generation-service.md)

이번 단계의 핵심은 다음과 같다.

- preview title / content는 `ai_requests`, `ai_results`, `ai_references`, `ai_usage_logs`, `documents`에 저장하지 않는다.
- preview body는 `(organizationId, userId, aiRequestId)`로 scoped된 short-term key에만 저장한다.
- 조회와 폐기는 `requireMembership`과 key boundary로 requester-only를 유지한다.
- TTL 기본값은 24시간이고, discard 시 즉시 접근이 끊긴다.

---

## 2. Step 3의 목적

Step 2는 generation service가 preview body를 반환하게 만들었지만, route / UI가 붙기 전에 preview body를 어디에 둘지 잠겨 있지 않았다. Step 3의 목적은 다음과 같다.

- AI preview body를 permanent DB 밖의 short-term storage에 저장한다.
- Redis adapter를 나중에 붙일 수 있도록 store interface를 먼저 만든다.
- 테스트에서는 clock-controllable in-memory store로 TTL / discard를 검증한다.
- generation 성공 시에만 preview를 저장한다.
- generation 실패 시에는 preview entry를 만들지 않는다.
- requester 본인만 preview를 조회 / 폐기할 수 있게 한다.

다음 항목은 이번 단계 범위 밖이다.

- 실제 Redis client adapter
- API route / UI
- AI 결과를 document로 저장하는 editor handoff
- 실제 AI provider 연동
- admin / operations AI log 조회
- opt-in `ai_request_payloads`

---

## 3. 이번에 추가 / 수정한 파일

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/ai/preview/store.ts` | `AiPreviewStore` interface, record/input/lookup type, canonical key builder, in-memory implementation, 24h TTL 상수. |
| `apps/web/lib/ai/preview/default.ts` | default singleton preview store. 현재는 in-memory, 후속 Redis adapter에서 같은 export를 교체 가능. |
| `apps/web/lib/services/ai-preview.ts` | `loadAiPreview`, `discardAiPreview` service entry point. `requireMembership` + store lookup/discard. |
| `apps/web/lib/services/ai-generation.ts` | `previewStore` option 추가. Completed 분기에서 preview 저장, 반환 preview에 `expiresAt` 추가. |
| `tests/integration/ai-preview.test.ts` | 14개 통합 테스트. key shape, success/failure save, requester-only, TTL, discard, body retention 검증. |

DB schema / migration은 변경하지 않았다.

---

## 4. Store interface와 key 구조

canonical key:

```text
notive:ai:preview:org:{organizationId}:user:{userId}:req:{aiRequestId}
```

이 key는 다음 경계를 갖는다.

- 다른 조직은 다른 prefix를 사용한다.
- 같은 조직의 peer도 user segment가 달라 다른 key를 조회한다.
- `aiRequestId`는 preview handle로 재사용한다.

`AiPreviewStore`는 세 가지 메서드만 가진다.

| 메서드 | 의미 |
| --- | --- |
| `save(input)` | preview body를 저장하고 `{ aiRequestId, expiresAt }`를 반환한다. |
| `load(lookup)` | 존재하고 만료되지 않은 record를 반환한다. miss / expired / discarded는 `null`. |
| `discard(lookup)` | key를 삭제한다. 없는 key도 성공하는 idempotent operation. |

현재 기본 구현은 in-memory `Map`이다. 실제 Redis adapter가 들어오면 같은 interface 뒤에서 `SET ... EX`, `GET`, `DEL`로 교체하면 된다.

---

## 5. Generation service 연결

`generateAiDocument`의 성공 분기만 preview를 저장한다.

성공 분기:

1. AI request를 `Completed`로 전환한다.
2. `ai_results` metadata row를 기록한다.
3. reference snapshot을 기록한다.
4. preview store에 title / content를 저장한다.
5. 반환 preview에 `{ title, content, expiresAt }`를 포함한다.

실패 분기:

- `Failed` transition
- `ai_results.status = Failed`
- reference snapshot 기록
- `preview = null`
- preview store 저장 없음

따라서 provider failure로 생성된 body가 없거나 실패한 요청은 short-term store에도 남지 않는다.

---

## 6. Preview 조회 / 폐기 권한

`loadAiPreview`와 `discardAiPreview`는 모두 같은 정책을 따른다.

1. `requireMembership(prisma, userId, organizationId)`로 active membership을 확인한다.
2. store key를 `{ organizationId, userId, aiRequestId }`로 만든다.
3. missing / expired / discarded는 모두 `NOT_FOUND`.

이 구조에서 same-org peer가 다른 사용자의 `aiRequestId`를 알고 있어도 peer 자신의 `userId`로 key를 만들기 때문에 원본 key를 찾지 못한다. cross-org actor는 membership 단계에서 `NOT_FOUND`다.

discard도 같은 key boundary를 사용한다. peer의 discard는 peer key를 삭제하려고 할 뿐이므로 원본 requester's preview는 그대로 남는다.

---

## 7. TTL / Discard 정책

기본 TTL은 24시간이다.

```text
DEFAULT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000
```

in-memory store는 timer를 만들지 않고 `load` 시점에 lazy expiry를 수행한다.

- `expiresAt <= now`이면 map에서 삭제하고 `null` 반환
- Redis adapter는 server-side `EXPIRE` / `SET EX`로 같은 의미를 구현하면 된다

discard는 즉시 `DEL` 의미다. 없는 key도 성공한다. API route가 붙을 때는 이 idempotency를 그대로 204로 매핑하는 것이 자연스럽다.

---

## 8. Body retention 검증

이번 단계에서도 permanent DB에는 preview body가 들어가지 않는다.

테스트는 다음을 확인한다.

- preview title / content는 store에서 조회된다.
- 같은 문자열이 `ai_requests` JSON에 없다.
- 같은 문자열이 `ai_results` JSON에 없다.
- 같은 문자열이 `ai_references` JSON에 없다.
- `documents` row가 side effect로 생성되지 않는다.

이 검증은 Step 1 / Step 2의 body-retention contract를 유지한다.

---

## 9. 테스트 커버리지

신규 통합 테스트 파일은 `tests/integration/ai-preview.test.ts`다.

| 영역 | 케이스 |
| --- | --- |
| key shape | org/user/request segment 포함, org가 다르면 다른 key, user가 다르면 다른 key |
| successful generation | Completed generation 후 preview 저장 / 조회 roundtrip |
| failed generation | provider failure 후 preview 미저장 |
| load boundary | same-org peer `NOT_FOUND`, cross-org actor `NOT_FOUND`, missing request `NOT_FOUND` |
| TTL | clock 주입으로 만료 후 `NOT_FOUND` |
| discard | requester discard 후 `NOT_FOUND`, missing discard idempotent, peer/cross-org discard가 원본 보존 |
| body retention | preview body가 store에만 있고 permanent DB에는 없음 |

검증 결과:

```powershell
pnpm --filter @notive/tests-integration test -- ai-preview.test.ts ai-generation.test.ts
# PASS — 26 tests

pnpm test:integration
# PASS — 17 files / 280 tests

pnpm test
# PASS — 6 files / 99 tests

pnpm typecheck
# PASS — 9 workspaces clean

pnpm exec prettier --check apps/web/lib/ai/preview/store.ts apps/web/lib/ai/preview/default.ts apps/web/lib/services/ai-preview.ts apps/web/lib/services/ai-generation.ts tests/integration/ai-preview.test.ts
# PASS

git diff --check
# PASS
```

---

## 10. 남은 위험과 후속 작업

### 10.1 실제 Redis adapter 미구현

현재 default store는 in-memory singleton이다. 개발 / 테스트에는 충분하지만 production 다중 인스턴스에서는 공유되지 않는다. 후속 단계에서 `@notive/redis`가 실제 client를 제공하면 `createRedisAiPreviewStore(client)`를 추가해야 한다.

필요한 동작:

- `save` → Redis `SET key serialized EX 86400`
- `load` → Redis `GET`, 없으면 `null`
- `discard` → Redis `DEL`

### 10.2 Route / session boundary 미구현

아직 API route가 없다. route가 추가되면 `userId`는 반드시 session에서 가져와야 한다. 클라이언트가 userId를 제출하게 만들면 requester-only key boundary가 깨질 수 있다.

### 10.3 Save-to-document flow 미구현

preview body는 아직 문서 저장 flow와 연결되지 않았다. 후속 단계에서 저장을 만들 때는 사용자가 명시적으로 저장을 선택한 경우에만 `documents`에 들어가야 한다.

확인할 점:

- `sourceType = AI`
- `documents.aiRequestId = aiRequest.id`
- `ai_results.savedDocumentId`와 `ai_requests.resultSaved` 갱신
- 실패 시 반쯤 연결된 상태 방지

---

## 11. Decision

Phase D Step 3은 완료 판단 가능하다.

완료로 보는 이유:

- preview body가 permanent DB 밖 short-term store에 저장된다.
- key가 organization / user / request 경계로 구성되어 requester-only 조회가 가능하다.
- TTL과 discard가 테스트로 고정되었다.
- 실패 generation은 preview를 남기지 않는다.
- 기존 reference permission filtering과 body retention contract가 깨지지 않았다.
- 모든 게이트가 통과했다.

다음 권장 작업은 **Phase D Step 4 — AI preview API route smoke**다. 이제 short-term storage boundary가 잠겼으므로 route를 붙여도 된다. route에서는 session user만 사용하고, userId를 request body/query에서 받지 않는 것을 최우선 검증 포인트로 둔다.

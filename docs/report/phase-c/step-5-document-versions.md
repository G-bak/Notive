# Phase C — Step 5: 문서 버전 이력 / 복원 보고서

## 1. 보고 범위

본 보고서는 Phase C(문서 관리) 구현의 **5단계 — 문서 버전 이력 / 복원**이 완료된 시점에 작성된 단계별 보고서다. 이 단계는 Step 1에서 만든 `document_versions` 테이블을 처음으로 실제 저장 / 복원 흐름에 연결한다. 비개발자도 어떤 작업이 왜 이루어졌는지 따라갈 수 있도록 풀어 썼다.

선행 보고서:

- [Phase C Step 1 — 문서 데이터베이스 스키마](./step-1-db-schema.md) — `document_versions` 테이블 / `(document_id, version_number)` unique
- [Phase C Step 2 — 문서 권한 판단 모듈](./step-2-document-permissions.md) — `requireDocumentView` / `requireDocumentEdit`
- [Phase C Step 3 — 문서 서비스 / API](./step-3-document-service-api.md) — service / route / audit 패턴
- [Phase C Step 4 — 문서 공유 API](./step-4-document-sharing-api.md) — service 분리 패턴, transaction 사용 사례

---

## 2. Step 5의 목적

Step 1에서 `document_versions` 테이블이 만들어졌지만, 실제로 행이 쓰이는 코드 경로는 없었다. Step 3가 명시적으로 share / version / favorite / view-history 모두 미구현임을 보고서로 남겼다. Step 5의 목적은 다음과 같다.

* 문서 **저장 흐름에 version 생성**을 묶는다 — create는 항상, update는 의미 있는 변경(title / content / documentType)에 대해.
* **버전 목록 / 미리보기 / 복원** 3개 API를 노출한다.
* **복원 정책**을 코드로 박는다: 기존 version row는 절대 수정하지 않고, 복원 자체를 새 version으로 기록한다 (Phase C 계획서 §5.5 / §9.5).
* `version_number` **동시성 정책**을 명확히 정한다 — Phase C는 auto-save가 없어 단순한 `max+1`이면 충분하지만, 정확한 실패 응답(`CONFLICT(version_conflict)`)을 정의한다.
* `document_versions.organization_id` **정합성을 한 곳에서 강제**한다.

---

## 3. 이번에 추가 / 수정한 파일

### 3.1 신규 (5개)

| 파일 | 내용 |
| --- | --- |
| `apps/web/lib/services/document-version.ts` | ~270 라인. `createDocumentVersionInTx` 헬퍼 + 3개 entry point (list / get / restore). |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/versions/route.ts` | GET (list) |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/versions/[versionId]/route.ts` | GET (preview) |
| `apps/web/app/api/organizations/[id]/documents/[documentId]/versions/[versionId]/restore/route.ts` | POST (restore) |
| `tests/integration/document-versions.test.ts` | ~360 라인, **15 통합 테스트**. |

### 3.2 수정 (3개)

| 파일 | 변경 |
| --- | --- |
| `apps/web/lib/services/document.ts` | `createDocument`를 `$transaction`으로 감싸 version #1 생성. `updateDocument`는 title / content / documentType 변경 시 transaction 안에서 새 version 생성. metadata에 `newVersionNumber` 추가. |
| `apps/web/lib/audit/index.ts` | `Actions.DOCUMENT_VERSION_RESTORED = "document.version_restored"` 추가. |
| `packages/permissions/src/errors.ts` | `KnownReasonCode += "version_conflict"` 추가 (CONFLICT). |

DB schema / migration 변경 0건. UI 0건. auto-save endpoint 0건.

---

## 4. 어디서 version row가 만들어지는가

`document_versions` 테이블에 **write하는 단일 경로**는 `createDocumentVersionInTx` 헬퍼다. 다른 어떤 코드도 이 테이블에 직접 쓰지 않는다.

| 트리거 | 호출 지점 | changeSummary | 추가 동작 |
| --- | --- | --- | --- |
| `createDocument` 성공 | document.create와 같은 transaction 안 | `"initial"` | 한 번도 version 없는 document는 절대 존재하지 않음 |
| `updateDocument` + title/content/documentType 변경 | doc.update와 같은 transaction 안 | `null` | DOCUMENT_UPDATED audit metadata에 `newVersionNumber` 추가 |
| `updateDocument` + visibility/ownerTeamId/status-only 변경 | — | (생성 안 함) | 본문이 아닌 메타데이터만 변경되었으므로 version 미생성 |
| `restoreDocumentVersion` | document.update + 새 version 한 transaction | `"restored from version N"` | DOCUMENT_VERSION_RESTORED audit |

### 4.1 documentType-only 변경도 새 version

Phase C 계획서가 "title / content / documentType 변경이 있으면 새 버전 생성"으로 명시했다. snapshot 필드는 `title_snapshot` / `content_snapshot`만 있으므로 documentType 자체는 snapshot에 반영되지 않는다 — 그래도 spec 그대로 새 version row가 만들어진다.

이 결과:

* documentType-only 변경 후 version preview는 이전과 같은 title/content를 보여준다.
* 변경 자체는 audit `DOCUMENT_UPDATED.metadata.changed = ["documentType"]`로 추적된다.

미묘하지만 의도된 동작. 후속에 documentType_snapshot 컬럼을 추가하기로 결정하면 forward migration으로 가능.

---

## 5. 3개의 API 라우트

| Method | Path | Service | 권한 |
| --- | --- | --- | --- |
| GET | `/organizations/{id}/documents/{documentId}/versions` | `listDocumentVersions` | `requireDocumentView` |
| GET | `/organizations/{id}/documents/{documentId}/versions/{versionId}` | `getDocumentVersion` | `requireDocumentView` |
| POST | `/organizations/{id}/documents/{documentId}/versions/{versionId}/restore` | `restoreDocumentVersion` | `requireDocumentEdit` |

라우트는 Step 3/4 패턴 그대로 — `getCurrentSession(cookies()) → service 호출 → respondError(err)`. 비즈니스 로직 0줄. restore 응답은 `{ document, newVersion }` 두 필드를 담아 클라이언트 follow-up fetch를 줄인다.

### 5.1 List/Preview는 View, Restore는 Edit

이는 Phase C 계획서 §16.1 그대로다. 의미:

| 권한 | list | preview | restore |
| --- | --- | --- | --- |
| 권한 없음 | NOT_FOUND | NOT_FOUND | NOT_FOUND |
| View only | OK | OK | FORBIDDEN(`document_edit_not_allowed`) |
| Edit | OK | OK | OK |
| Manage | OK | OK | OK |

NOT_FOUND vs FORBIDDEN 구분: "View 자체를 못 하면 NOT_FOUND" — Phase A §15 존재 누설 방지 그대로.

---

## 6. Restore 정책 — 기존 row는 절대 수정하지 않는다

복원의 핵심 원칙은 **"version 이력은 forward-only"** 다. 기존 version row를 덮어쓰거나 삭제하지 않는다.

### 6.1 동작 흐름

1. Edit 권한 검증 (`requireDocumentEdit`).
2. Source version row 로드 — `(id, documentId, organizationId)`로 anchor. cross-doc / cross-org versionId는 NOT_FOUND.
3. `$transaction` 안에서:
   - `document.update`: title = source.titleSnapshot, content = source.contentSnapshot
   - `createDocumentVersionInTx`: 새 version row, `changeSummary = "restored from version N"`
4. `recordActivity`: `DOCUMENT_VERSION_RESTORED` (transaction 외부, best-effort)

### 6.2 status 보존 (보수적 정책)

복원 시 document의 `status`(Draft / Active / Archived)는 **그대로 유지**한다. Archived 문서를 복원해도 Archived. 의도:

* status는 lifecycle 메타데이터, restore는 body 작업. 두 축이 섞이면 사용자가 Archive한 문서를 "옛 내용 보고 싶어서" 복원했더니 갑자기 일반 목록으로 돌아오는 사고가 발생.
* 사용자가 status를 바꾸려면 별도 `PATCH { status: ... }` 호출.
* 향후 UI가 "복원 + 활성화" 같은 묶음 액션이 필요하면 그건 UI 단계 결정.

이 결정은 Phase C 계획서가 "Archived 문서 restore 정책 보수적으로"라고 명시한 것을 그대로 반영.

### 6.3 새 version의 versionNumber

`max(versionNumber) + 1`. Source version의 number는 변하지 않음. 예: v1, v2, v3가 있고 v1을 복원하면 v4가 새로 만들어지며 (v4.titleSnapshot, v4.contentSnapshot) === (v1.titleSnapshot, v1.contentSnapshot), changeSummary = "restored from version 1".

이력으로 보면 "v1 → v2 → v3 → v4(=v1 복원)" 형태로 line이 늘어난다. 시간 역행 없음.

---

## 7. `createDocumentVersionInTx` versionNumber 정책

### 7.1 기본 흐름

```ts
const max = await client.documentVersion.aggregate({
  where: { documentId },
  _max: { versionNumber: true },
});
const next = (max._max.versionNumber ?? 0) + 1;
return client.documentVersion.create({
  data: { documentId, organizationId, versionNumber: next, ... }
});
```

`organization_id`는 caller가 명시 전달하는 `document.organizationId`를 그대로 박는다. Step 1의 composite FK `(document_id, organization_id) → documents(id, organization_id)`가 cross-org 정합성의 마지막 방어선.

### 7.2 P2002 → CONFLICT(`version_conflict`)

두 transaction이 동시에 같은 documentId의 version을 만들려고 하면 `(document_id, version_number)` unique 인덱스가 한쪽 transaction에서 P2002를 발생시킨다. 헬퍼는 이를 즉시 `Errors.conflict("version_conflict")`로 변환한다.

**같은 transaction client에서 retry하지 않는다**. PostgreSQL에서 unique violation이 발생한 transaction은 aborted 상태가 되어 후속 statement가 모두 "current transaction is aborted, commands ignored until end of transaction block"을 받는다. 따라서 같은 client로 `aggregate()`를 다시 호출해 fresh max를 읽으려는 시도는 동작하지 않는다.

이전 Codex 검증 라운드에서 이 점이 발견되어 retry loop가 제거됐다 (§9 참조).

### 7.3 escalation 경로 (현재는 불필요)

Phase C는 auto-save endpoint가 없어 같은 문서에 대한 동시 PATCH가 매우 드물다. 따라서 P2002 → 409 → 사용자 재시도 패턴이 충분히 깨끗한 UX다.

향후 Phase D에서 AI 결과 저장 / auto-save / 다중 동시 편집이 도입되어 빈도가 높아지면 다음 중 하나로 escalation:

1. **Outer transaction retry**: service 호출 전체를 재시도. 1차 attempt가 P2002로 rollback되면 2차 attempt가 fresh max를 읽고 새 version을 만든다.
2. **PostgreSQL advisory lock**: documentId를 키로 lock 획득. lock 보유자만 max+1 → create. 동시성을 직렬화.
3. **Per-document SEQUENCE**: 각 문서마다 PostgreSQL SEQUENCE 객체를 만들어 next 값을 받음. SEQUENCE는 트랜잭션 단위가 아니라 monotonic.
4. **`documents.next_version_number` 컬럼**: documents 테이블에 컬럼 추가, 그 컬럼을 update하면서 잠금. version 생성과 같은 트랜잭션에서 atomic.

위 네 옵션은 trade-off가 다르며 Phase D 시점에 동시성 측정 후 결정. 헬퍼 함수의 docstring에 이 escalation 경로가 적혀 있어 후속 작업자가 정책 의도를 잃지 않는다.

---

## 8. Audit 정책

| Event | Action | metadata |
| --- | --- | --- |
| 일반 update + version 생성 | `DOCUMENT_UPDATED` (기존 action 재사용) | `{ changed: [...], newVersionNumber: N }` (newVersionNumber는 version 생성된 경우에만) |
| 일반 update + version 미생성 | `DOCUMENT_UPDATED` | `{ changed: [...] }` |
| Restore | `DOCUMENT_VERSION_RESTORED` (신규 action) | `{ restoredFromVersionId, restoredFromVersionNumber, newVersionNumber }` |

**왜 일반 update에 새 action을 만들지 않았나**: spec 그대로다. "일반 update의 version 생성은 기존 document.updated audit과 중복되므로 새 audit action을 추가하지 말고, 필요하면 기존 update metadata에 versionNumber를 포함하는 정도로 제한". metadata에 `newVersionNumber`를 추가하는 정도로 충분.

**왜 Restore는 새 action**: 사용자 의도가 다르다. "타이핑해서 수정한 사람"과 "옛 버전으로 되돌린 사람"을 audit consumer가 구분할 수 있어야 한다. 별도 action으로 분리.

기존 정책 그대로:

* 성공만 기록 (실패 audit은 Phase G로 이연).
* `ip_address` / `user_agent`는 비워둠 (Phase G에서 request-pipeline이 채울 예정).
* writer 실패는 best-effort — 사용자 액션을 실패시키지 않음.

---

## 9. Codex 검증 중 발견된 retry-loop 문제와 수정 내용

이 단계는 Codex 검증을 두 번 받았고, PostgreSQL 동작에 대한 미묘한 가정이 잘못된 부분이 발견됐다.

### 9.1 1차 구현 (잘못된 retry 가정)

`createDocumentVersionInTx`는 다음과 같은 형태였다.

```ts
const MAX_ATTEMPTS = 3;
for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
  const max = await client.documentVersion.aggregate({...});
  const next = (max._max.versionNumber ?? 0) + 1;
  try {
    return await client.documentVersion.create({...});
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      continue; // race; retry with fresh max
    }
    throw err;
  }
}
throw Errors.conflict("version_conflict");
```

**의도**: P2002가 발생하면 max를 다시 읽어 더 큰 next로 재시도. 3번 한도 내에서 수렴.

**실제 동작 (잘못됨)**: PostgreSQL은 unique violation이 발생한 transaction을 **aborted** 상태로 마킹한다. 같은 transaction client로 보낸 후속 query는 `current transaction is aborted, commands ignored until end of transaction block` 에러를 받는다. 즉:

* `attempt 0`의 `create`가 P2002로 실패.
* transaction이 aborted됨.
* `attempt 1`의 `aggregate()`는 aborted 에러를 받음 — fresh max를 읽지 못함.
* loop는 결국 `version_conflict`를 throw하지만, "3번 시도해 봤다"는 설명은 거짓.

### 9.2 Codex 1차 검증 — REVISION REQUESTED

Codex가 정확히 이 점을 짚었다.

> PostgreSQL에서는 unique violation이 발생하면 해당 transaction이 aborted 상태가 되므로, 같은 transaction 안에서 retry가 정상 동작한다고 보면 안 됩니다. 즉 "3회 retry 후 clean 409"라는 설명과 실제 동작이 어긋납니다.

수정 지시:

* retry loop 제거. P2002 즉시 `Errors.conflict("version_conflict")`.
* 주석을 "bounded retry"에서 "Phase D/auto-save 동시성 커지면 outer transaction retry / advisory lock / sequence / next_version_number 검토"로 수정.
* `KnownReasonCode`에 `version_conflict` 추가 (Phase B 규약).

### 9.3 수정

```ts
const max = await client.documentVersion.aggregate({...});
const next = (max._max.versionNumber ?? 0) + 1;
try {
  return await client.documentVersion.create({...});
} catch (err) {
  if (isUniqueConstraintError(err)) {
    throw Errors.conflict("version_conflict");
  }
  throw err;
}
```

함수 docstring을 §7.2 / §7.3에서 설명한 정책으로 갱신. `KnownReasonCode`에 `version_conflict`를 CONFLICT 카테고리로 추가하고 인라인 주석으로 escalation 경로(이 헬퍼 docstring 참조)를 명시.

### 9.4 Codex 2차 검증 — APPROVED

* Transaction 내부 retry 제거 확인
* `version_conflict`이 KnownReasonCode에 추가됨
* P2002 발생 시 outer transaction 전체 rollback이 create / update / restore 모두에서 정합성을 유지함 (atomicity 보존)
* DB schema 변경 없음
* 모든 검증 통과

이 사고에서 얻은 운영 교훈: **PostgreSQL의 transaction 의미를 ORM 추상화가 가리지 않는다**. Prisma의 `$transaction` 콜백 안에서 P2002를 잡고 같은 client로 query를 계속 하려는 모든 코드는 의심해야 한다. 어떤 unique 제약이라도 동일한 결함이 있을 수 있다.

---

## 10. 검증 결과

### 10.1 1차 검증 (retry-loop 발견 전)

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | PASS — 10 워크스페이스 모두 |
| `pnpm test` (unit) | PASS — 6 files / 99 tests |
| `pnpm test:integration` | PASS — 11 files / 150 tests (+15 신규 version 테스트) |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

이 시점의 통합 테스트는 retry 가정에 의존하지 않았기 때문에 모두 통과했고, 정책 오류를 잡지 못했다. Codex 검증이 그 갭을 메웠다.

### 10.2 2차 검증 (retry 제거 후)

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | PASS — 10 워크스페이스 모두 |
| `pnpm test` (unit) | PASS — 6 files / 99 tests |
| `pnpm test:integration` | PASS — **11 files / 150 tests** |
| `pnpm format` | PASS |
| `git diff --check` | PASS |

`version_conflict` 직접 재현 테스트는 추가하지 않음 — 동시성 재현이 flaky해질 위험이 있어 Codex가 명시적으로 권고했음. 코드 구조와 주석 정합성 중심으로 처리.

Step 5 코드는 `develop`에 머지되었다 (commit `ec0822e`, merge `8169814`).

### 10.3 통합 테스트 15 케이스 분포

| 그룹 | 케이스 수 |
| --- | --- |
| Version 생성 hook (create #1, update title/content, documentType-only, visibility-only no version, status-only no version, per-document numbering) | 6 |
| list/preview 권한 (View OK / no-view NOT_FOUND / Admin Private NOT_FOUND / cross-org docId / cross-doc/cross-org versionId / Deleted) | 6 |
| Restore (View-only 거부 / Owner restore status 보존 + 기존 row 불변 + 새 version 추가 / audit 기록) | 3 |

---

## 11. 다음 단계로 넘어가기 전 운영 주의사항

### 11.1 Route smoke test는 아직 없음

Step 3 / 4와 동일한 부채. 이번 단계 통합 테스트도 service 직접 호출만 커버한다. Route는 Phase B 패턴 그대로 (session → service → respondError) 위험이 낮지만, 최소 1–2개의 route smoke test를 후속 Step에서 묶어 추가할 가치가 있다. Step 3 → 4 → 5에 걸쳐 쌓이는 부채.

### 11.2 일반 update의 `changeSummary`는 `null`

`updateDocument`가 만드는 version row의 `changeSummary`는 `null`이다. UI / API가 명시적 메시지를 받기 시작하면 이 필드를 채우는 흐름을 추가해야 한다. 현재 명시적 changeSummary가 채워지는 경로는 다음 두 곳:

* `createDocument` → `"initial"`
* `restoreDocumentVersion` → `"restored from version N"`

### 11.3 Deleted / trash document restore는 out of scope

이번 단계는 **버전** 복원이지, **삭제된 문서 자체** 복원이 아니다. Step 3에서 `deleteDocument`는 soft delete (`status = Deleted`, `deletedAt = now`)로 동작하지만, 이 행을 다시 살리는 endpoint는 아직 없다. 사용자가 "휴지통에서 복원"하려면 별도 trash restore endpoint가 필요. Phase G admin / 별도 endpoint로 노출될 가능성. 이번 단계의 모든 version endpoint는 **active document에 한정**해 동작한다 — Deleted 문서는 모두 NOT_FOUND.

### 11.4 UI 없음

이번 단계는 backend API만 노출. 사용자가 실제로 버전 timeline을 보거나 미리보기 / 복원 버튼을 누를 화면은 UI 단계에서 구현. 그때까지는 클라이언트(통합 테스트, curl, 관리 도구)만 이 API를 호출 가능.

### 11.5 documentType-only 변경의 redundant version

§4.1에서 다룬 것처럼 documentType-only 변경도 새 version row를 만들지만 snapshot은 이전과 동일. 후속 Step에서 documentType_snapshot을 추가하기로 결정하면 forward migration으로 가능.

### 11.6 `version_conflict` 발생 시 클라이언트 동작

응답은 409 + `reason_code = "version_conflict"`. Phase C UI가 도입되면 다음 중 하나를 결정:

* 자동 재시도 (한도 + backoff)
* "다른 사람이 동시에 저장했습니다. 다시 시도해 주세요." 메시지 + 사용자 수동 재시도
* 충돌 미리보기 (양쪽 변경 보여주기 — 더 정교하지만 복잡)

이번 단계는 backend 동작만 결정 — 정확하고 재현 가능한 409. UI 결정은 UI 단계.

---

## 12. 비개발자 요약 — 한 단락

Step 5는 Step 1에서 만들었던 "버전 이력 보관 자리"를 실제 저장/복원 흐름에 처음으로 연결한 단계였다. 이제 사용자가 문서를 만들면 자동으로 version 1이 함께 만들어지고, 본문/제목/유형을 수정할 때마다 새 version이 쌓인다(공유 범위나 보관/삭제 같은 메타데이터만 바꾸는 경우는 새 version을 만들지 않는다 — 본문 변경이 아니므로). 사용자가 "옛 버전으로 되돌리기"를 누르면 그 옛 버전의 내용이 현재 문서로 복원되는데, 옛 버전 자체는 절대 수정되지 않고 "복원 행위"가 새로운 버전으로 또 한 줄 쌓인다. 시간을 거스르는 게 아니라 앞으로 한 걸음 더 나아가는 형태다. Codex 검증 중 한 가지 PostgreSQL 동작 가정 오류가 발견됐는데, 동시 저장 충돌이 났을 때 같은 transaction 안에서 다시 시도하려고 했던 부분이다. PostgreSQL은 그런 transaction을 망가진 상태로 처리하므로, 충돌 시 깨끗하게 409 응답을 돌려주는 형태로 정정했다. 다음 단계에서는 이 위에 즐겨찾기 / 최근 본 문서 같은 부가 기능 또는 UI가 얹힌다.

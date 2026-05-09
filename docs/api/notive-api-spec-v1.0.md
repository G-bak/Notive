# API 명세서 v1.0

# Notive API Specification

---

# 1. 문서 목적

본 문서는 Notive MVP 구현을 위한 API 명세의 기준을 정의한다.

이 문서는 실제 OpenAPI 파일이나 최종 구현 코드가 아니다. 구현 전 API 경로, 요청/응답 구조, 권한 기준, 오류 처리 기준을 합의하기 위한 기준 문서다.

---

# 2. API 설계 원칙

## 2.1 기본 스타일

MVP API는 REST 스타일을 기준으로 설계한다.

---

## 2.2 공통 원칙

* 모든 보호 API는 인증된 사용자만 호출할 수 있다.
* 조직 데이터 API는 `organization_id` 컨텍스트를 반드시 가진다.
* 서버는 클라이언트가 보낸 조직 ID를 신뢰하지 않고 세션과 멤버십으로 검증한다.
* 권한 검사는 API 요청 단계와 데이터 조회 단계에서 모두 수행한다.
* 목록 API는 페이지네이션을 기본으로 한다.
* 삭제는 기본적으로 soft delete 또는 상태 변경으로 처리한다.
* AI, 검색, 로그 API는 민감 정보 노출을 최소화한다.

---

# 3. 공통 규격

## 3.1 Base Path

```text
/api/v1
```

---

## 3.2 인증

보호 API는 세션 기반 또는 토큰 기반 인증을 사용한다.

```http
Authorization: Bearer <token>
```

또는 쿠키 세션 기반 인증을 사용할 수 있다. 실제 방식은 구현 단계에서 확정한다.

---

## 3.3 공통 응답 형식

### 성공

```json
{
  "data": {},
  "meta": {}
}
```

### 실패

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "사용자에게 표시 가능한 메시지",
    "details": {}
  }
}
```

---

## 3.4 페이지네이션

목록 API는 기본적으로 cursor 또는 page 기반 페이지네이션을 사용한다.

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalCount": 100
  }
}
```

---

## 3.5 공통 오류 코드

| 코드 | 설명 |
| --- | --- |
| UNAUTHORIZED | 세션 없음 또는 만료 |
| FORBIDDEN | 인증되었으나 기능 권한 부족 (예: Viewer가 AI 생성 호출) |
| NOT_FOUND | 리소스 없음 또는 권한 없음 (보안 정책 §15에 따라 권한 거부 기본 코드) |
| VALIDATION_ERROR | 입력값 오류 |
| CONFLICT | 상태 충돌 |
| RATE_LIMITED | 요청 제한 |
| INTERNAL_ERROR | 서버 오류 |
| SERVICE_UNAVAILABLE | 외부 서비스 또는 내부 서비스 장애 |

### 권한 거부 응답 규칙 (Codex 결정 / 보안 정책 §15)

* 기본은 `NOT_FOUND`. 다른 조직 리소스, 권한 없는 Private 자원, 직접 ID 추측 접근 등은 모두 `NOT_FOUND`로 응답한다.
* 인증된 사용자가 기능 권한이 없어 차단되는 경우만 `FORBIDDEN`을 사용한다(Viewer가 AI 생성, Editor가 관리자 화면, Manager가 Admin 전용 작업 등).
* `FORBIDDEN` 응답은 `reason_code`(예: `role_required:admin`, `last_admin_protection`)를 포함한다.
* 마지막 Admin 보호 위반은 `FORBIDDEN`(`reason_code=last_admin_protection`)으로 고정한다.

---

# 4. 인증 API

## 4.1 회원가입

```http
POST /auth/signup
```

### 요청

```json
{
  "name": "홍길동",
  "email": "user@example.com",
  "password": "password123"
}
```

### 응답

```json
{
  "data": {
    "userId": "user_id",
    "email": "user@example.com",
    "status": "Pending"
  }
}
```

### 오류

* `VALIDATION_ERROR`
* `CONFLICT`

---

## 4.2 로그인

```http
POST /auth/login
```

### 요청

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### 응답

```json
{
  "data": {
    "token": "access_token",
    "user": {
      "id": "user_id",
      "name": "홍길동",
      "email": "user@example.com"
    },
    "organizations": []
  }
}
```

---

## 4.3 로그아웃

```http
POST /auth/logout
```

### 응답

```json
{
  "data": {
    "success": true
  }
}
```

---

## 4.4 내 정보 조회

```http
GET /auth/me
```

### 응답

```json
{
  "data": {
    "id": "user_id",
    "name": "홍길동",
    "email": "user@example.com",
    "currentOrganization": {
      "id": "org_id",
      "name": "Acme"
    },
    "role": "Editor",
    "team": {
      "id": "team_id",
      "name": "Product"
    }
  }
}
```

---

# 5. 조직/팀 API

## 5.1 조직 생성

```http
POST /organizations
```

### 요청

```json
{
  "name": "Acme"
}
```

### 응답

```json
{
  "data": {
    "id": "org_id",
    "name": "Acme",
    "role": "Admin"
  }
}
```

---

## 5.2 내 조직 목록

```http
GET /organizations
```

### 응답

```json
{
  "data": [
    {
      "id": "org_id",
      "name": "Acme",
      "role": "Admin",
      "status": "Active"
    }
  ]
}
```

---

## 5.3 팀 목록

```http
GET /organizations/{organizationId}/teams
```

### 권한

* 로그인 사용자
* 해당 조직 멤버

### 응답

```json
{
  "data": [
    {
      "id": "team_id",
      "name": "Product",
      "status": "Active"
    }
  ]
}
```

---

## 5.4 팀 생성

```http
POST /organizations/{organizationId}/teams
```

### 권한

* Admin

### 요청

```json
{
  "name": "Product",
  "description": "제품팀"
}
```

---

# 6. 초대 API

## 6.1 사용자 초대

```http
POST /organizations/{organizationId}/invitations
```

### 권한

* Admin

### 요청

```json
{
  "email": "new-user@example.com",
  "role": "Editor",
  "teamId": "team_id"
}
```

### 응답

```json
{
  "data": {
    "id": "invitation_id",
    "email": "new-user@example.com",
    "status": "Pending",
    "expiresAt": "2026-05-16T00:00:00Z"
  }
}
```

---

## 6.2 초대 수락

```http
POST /invitations/{token}/accept
```

### 응답

```json
{
  "data": {
    "organizationId": "org_id",
    "role": "Editor",
    "status": "Active"
  }
}
```

---

## 6.3 초대 취소

```http
POST /organizations/{organizationId}/invitations/{invitationId}/revoke
```

### 권한

* Admin

---

# 7. 문서 API

## 7.1 문서 목록

```http
GET /organizations/{organizationId}/documents
```

### 권한

* 로그인 사용자
* 접근 가능한 문서만 반환

### Query

| 파라미터 | 설명 |
| --- | --- |
| page | 페이지 |
| pageSize | 페이지 크기 |
| type | 문서 유형 |
| status | 문서 상태 |
| tag | 태그 |
| owner | 소유자 |
| team | 팀 |
| sort | updatedAt, createdAt |

### 응답

```json
{
  "data": [
    {
      "id": "document_id",
      "title": "주간 업무 보고서",
      "documentType": "report",
      "status": "Active",
      "ownerUserId": "user_id",
      "ownerTeamId": "team_id",
      "visibility": "Team",
      "updatedAt": "2026-05-09T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalCount": 1
  }
}
```

---

## 7.2 문서 생성

```http
POST /organizations/{organizationId}/documents
```

### 권한

* Editor 이상

### 요청

```json
{
  "title": "주간 업무 보고서",
  "content": "본문",
  "documentType": "report",
  "status": "Draft",
  "ownerTeamId": "team_id",
  "visibility": "Private",
  "tagIds": []
}
```

### 응답

```json
{
  "data": {
    "id": "document_id",
    "title": "주간 업무 보고서",
    "status": "Draft"
  }
}
```

---

## 7.3 문서 상세

```http
GET /organizations/{organizationId}/documents/{documentId}
```

### 권한

* 문서 접근 권한 보유 사용자

---

## 7.4 문서 수정

```http
PATCH /organizations/{organizationId}/documents/{documentId}
```

### 권한

* 문서 수정 권한 보유 사용자

### 요청

```json
{
  "title": "수정된 제목",
  "content": "수정된 본문",
  "documentType": "report",
  "tagIds": []
}
```

---

## 7.5 문서 삭제

```http
DELETE /organizations/{organizationId}/documents/{documentId}
```

### 권한

* 소유자, Manager, Admin 정책에 따름

### 처리

* 물리 삭제가 아니라 `Deleted` 상태 또는 `deleted_at` 처리

---

## 7.6 문서 공유 설정

```http
PUT /organizations/{organizationId}/documents/{documentId}/shares
```

### 권한

* 문서 소유자
* Manager
* Admin

### 요청

```json
{
  "visibility": "Team",
  "shares": [
    {
      "targetType": "Team",
      "targetId": "team_id",
      "permission": "View"
    }
  ]
}
```

---

## 7.7 문서 버전 목록

```http
GET /organizations/{organizationId}/documents/{documentId}/versions
```

### 권한

* 문서 접근 권한 보유 사용자

---

## 7.8 문서 버전 복원

```http
POST /organizations/{organizationId}/documents/{documentId}/versions/{versionId}/restore
```

### 권한

* 문서 수정 권한 보유 사용자

---

# 8. 템플릿 API

## 8.1 템플릿 목록

```http
GET /organizations/{organizationId}/templates
```

### Query

| 파라미터 | 설명 |
| --- | --- |
| documentType | 문서 유형 |
| teamId | 팀 |
| status | 상태 |

---

## 8.2 템플릿 생성

```http
POST /organizations/{organizationId}/templates
```

### 권한

* Admin

### 요청

```json
{
  "name": "주간 보고서 템플릿",
  "documentType": "report",
  "teamId": "team_id",
  "structure": "템플릿 본문 구조",
  "description": "제품팀 주간 보고서"
}
```

---

## 8.3 템플릿 수정

```http
PATCH /organizations/{organizationId}/templates/{templateId}
```

### 권한

* Admin

---

## 8.4 템플릿 비활성화

```http
POST /organizations/{organizationId}/templates/{templateId}/deactivate
```

### 권한

* Admin

---

# 9. AI 문서 생성 API

본 절의 요청/응답 본문(`requestText`, `title`, `content`)은 Phase A §15와 DB 설계 §9에 따라 `ai_requests`/`ai_results` 영구 테이블에 저장되지 않는다. 미리보기/편집 단계의 본문은 세션 바운드 단기 스토리지에만 보관되며, 사용자가 §9.4로 저장해야 `documents`에 영속화된다. 미저장 24시간 또는 폐기 시 단기 스토리지에서 즉시 삭제한다.

## 9.1 AI 문서 생성 요청

```http
POST /organizations/{organizationId}/ai/generate-document
```

### 권한

* Editor 이상

### 요청

```json
{
  "documentType": "report",
  "templateId": "template_id",
  "requestText": "이번 주 업무 보고서 작성해줘",
  "purpose": "팀 공유",
  "audience": "팀 리더",
  "tone": "business",
  "references": [
    {
      "targetType": "Document",
      "targetId": "document_id"
    },
    {
      "targetType": "DiaryEntry",
      "targetId": "diary_entry_id"
    }
  ]
}
```

`requestText`는 `ai_requests`에 영구 저장되지 않는다. 사용자가 "문제 신고" opt-in 흐름을 사용한 경우에만 `ai_request_payloads`에 30일 한도로 저장된다.

### 응답

```json
{
  "data": {
    "aiRequestId": "ai_request_id",
    "status": "Processing"
  }
}
```

---

## 9.2 AI 생성 상태 조회

```http
GET /organizations/{organizationId}/ai/requests/{aiRequestId}
```

### 권한

* 요청 사용자
* Admin은 정책에 따라 제한 조회

### 응답

```json
{
  "data": {
    "id": "ai_request_id",
    "status": "Completed",
    "documentType": "report",
    "createdAt": "2026-05-09T00:00:00Z"
  }
}
```

---

## 9.3 AI 생성 결과 조회

```http
GET /organizations/{organizationId}/ai/requests/{aiRequestId}/results
```

### 응답

```json
{
  "data": [
    {
      "id": "ai_result_id",
      "title": "주간 업무 보고서",
      "content": "생성된 본문",
      "status": "Generated",
      "references": []
    }
  ]
}
```

---

## 9.4 AI 결과를 문서로 저장

```http
POST /organizations/{organizationId}/ai/results/{aiResultId}/save-document
```

### 권한

* 요청 사용자

### 요청

```json
{
  "status": "Draft",
  "visibility": "Private",
  "ownerTeamId": "team_id"
}
```

### 응답

```json
{
  "data": {
    "documentId": "document_id",
    "status": "Draft"
  }
}
```

---

# 10. 업무 맥락 API

## 10.1 업무 다이어리 목록

```http
GET /organizations/{organizationId}/diary-entries
```

### Query

| 파라미터 | 설명 |
| --- | --- |
| from | 시작일 |
| to | 종료일 |
| authorId | 작성자 |
| teamId | 팀 |
| visibility | 공개 범위 |

---

## 10.2 업무 다이어리 작성

```http
POST /organizations/{organizationId}/diary-entries
```

### 권한

* Editor 이상

### 요청

```json
{
  "entryDate": "2026-05-09",
  "content": "A 고객사 미팅 진행",
  "visibility": "Private",
  "tagIds": [],
  "links": [
    {
      "targetType": "Document",
      "targetId": "document_id"
    }
  ]
}
```

---

## 10.3 업무 다이어리 수정

```http
PATCH /organizations/{organizationId}/diary-entries/{entryId}
```

### 권한

* 작성자

---

## 10.4 To-do 목록

MVP는 개인 To-do만 지원한다(Phase A §15). 응답은 항상 요청 사용자가 생성한 항목으로 한정된다.

```http
GET /organizations/{organizationId}/todos
```

### Query

| 파라미터 | 설명 |
| --- | --- |
| status | 상태 (`todo`, `in_progress`, `done`) |
| dueFrom | 마감 시작 |
| dueTo | 마감 종료 |

---

## 10.5 To-do 생성

```http
POST /organizations/{organizationId}/todos
```

### 권한

* Editor 이상. 생성자가 곧 소유자다(개인 To-do).

### 요청

```json
{
  "title": "제안서 초안 작성",
  "description": "A 고객사 제안서 초안 작성",
  "dueDate": "2026-05-15",
  "priority": "Medium",
  "relatedDocumentId": "document_id"
}
```

---

## 10.6 To-do 상태 변경

```http
PATCH /organizations/{organizationId}/todos/{todoId}
```

### 권한

* 생성자 본인만.

### 요청

```json
{
  "status": "done"
}
```

`status` 값은 `todo`, `in_progress`, `done` 중 하나다.

---

# 11. 검색 API

## 11.1 통합 검색

```http
GET /organizations/{organizationId}/search
```

### Query

| 파라미터 | 설명 |
| --- | --- |
| q | 검색어 |
| mode | All, Document, DiaryEntry, Todo |
| documentType | 문서 유형 |
| tag | 태그 |
| authorId | 작성자 |
| teamId | 팀 |
| from | 시작일 |
| to | 종료일 |

### 권한

* 로그인 사용자
* 접근 가능한 결과만 반환

### 응답

```json
{
  "data": [
    {
      "targetType": "Document",
      "targetId": "document_id",
      "title": "보안 정책",
      "summary": "문서 일부 요약",
      "updatedAt": "2026-05-09T00:00:00Z"
    }
  ],
  "meta": {
    "query": "보안 정책",
    "resultCount": 1
  }
}
```

---

## 11.2 AI 요약 검색

```http
POST /organizations/{organizationId}/search/answer
```

### 요청

```json
{
  "question": "작년 보안 정책 문서 요약해줘",
  "filters": {
    "documentType": "policy"
  }
}
```

### 응답

```json
{
  "data": {
    "answer": "요약 답변",
    "sources": [
      {
        "targetType": "Document",
        "targetId": "document_id",
        "title": "보안 정책"
      }
    ]
  }
}
```

### 기준

* 출처 없는 답변은 제공하지 않거나 제한 안내
* 권한 없는 문서는 출처로 사용하지 않음

---

## 11.3 검색 피드백

```http
POST /organizations/{organizationId}/search/feedback
```

### 요청

```json
{
  "searchQueryLogId": "search_log_id",
  "satisfied": false,
  "feedbackText": "원하는 문서가 나오지 않았음"
}
```

---

# 12. 관리자 API

## 12.1 관리자 대시보드

```http
GET /organizations/{organizationId}/admin/dashboard
```

### 권한

* Admin

---

## 12.2 사용자 목록

```http
GET /organizations/{organizationId}/admin/users
```

### 권한

* Admin

---

## 12.3 사용자 역할 변경

```http
PATCH /organizations/{organizationId}/admin/users/{userId}/role
```

### 권한

* Admin

### 요청

```json
{
  "role": "Manager"
}
```

### 기준

* 마지막 Admin 제거 차단
* 활동 로그 기록

---

## 12.4 사용자 비활성화

```http
POST /organizations/{organizationId}/admin/users/{userId}/disable
```

### 권한

* Admin

---

## 12.5 활동 로그 목록

```http
GET /organizations/{organizationId}/admin/activity-logs
```

### Query

| 파라미터 | 설명 |
| --- | --- |
| action | 활동 유형 |
| actorUserId | 수행 사용자 |
| from | 시작일 |
| to | 종료일 |

---

## 12.6 조직 설정 조회

```http
GET /organizations/{organizationId}/admin/settings
```

### 권한

* Admin

---

## 12.7 조직 설정 수정

```http
PATCH /organizations/{organizationId}/admin/settings
```

### 권한

* Admin

### 요청

```json
{
  "defaultRole": "Editor",
  "defaultDocumentVisibility": "Private",
  "aiEnabled": true,
  "searchEnabled": true
}
```

---

# 13. 권한 기준 요약

| 영역 | Viewer | Editor | Manager | Admin |
| --- | --- | --- | --- | --- |
| 문서 조회 | 허용 문서 | 허용 문서 | 팀 범위 + 허용 문서 | 메타데이터 전체 / 본문은 일반 권한 규칙 |
| 문서 작성 | 불가 | 가능 | 가능 | 가능 |
| AI 생성 | 불가 | 가능 | 가능 | 가능 |
| 업무 기록 | 불가 | 가능 | 가능 | 가능 |
| To-do | 불가 | 본인 전용 | 본인 전용 | 본인 전용 |
| 검색 | 가능 | 가능 | 가능 | 가능 |
| 사용자 초대 | 불가 | 불가 | 불가 (Codex 결정) | 가능 |
| 템플릿 관리 | 불가 | 불가 | 불가 (Codex 결정) | 가능 |
| 관리자 화면 | 불가 | 불가 | 불가 (MVP) | 가능 |
| 조직 설정 | 불가 | 불가 | 불가 | 가능 |

---

# 14. 주요 보안 기준

## 14.1 조직 검증

모든 조직 API는 다음을 확인한다.

* 사용자가 해당 조직의 멤버인지
* 멤버십 상태가 Active인지
* 요청한 리소스가 해당 조직에 속하는지

---

## 14.2 문서 권한 검증

문서 API, 검색 API, AI 참고 자료 API는 동일한 문서 권한 정책을 사용한다.

---

## 14.3 AI 참고 자료 검증

AI 생성 요청 시 선택된 모든 참고 자료는 생성 직전에 다시 권한을 확인한다.

---

## 14.4 로그 노출 제한

관리자 API에서도 AI 요청 본문, 검색어, 문서 본문 등 민감 정보는 필요한 범위에서만 노출한다.

---

# 15. 후속 작업

본 API 명세서를 기준으로 다음 작업을 진행한다.

| 작업 | 설명 |
| --- | --- |
| OpenAPI 작성 | 실제 API 스펙 파일 작성 |
| API DTO 정의 | 요청/응답 타입 정의 |
| API 테스트 케이스 작성 | 인증, 권한, 성공/실패 케이스 정의 |
| 화면/UX 설계서 연결 | 각 화면에서 호출할 API 매핑 |
| 권한 정책 명세서 연결 | 엔드포인트별 권한 판단 상세화 |


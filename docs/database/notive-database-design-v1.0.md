# DB 설계서 v1.0

# Notive Database Design

---

# 1. 문서 목적

본 문서는 Notive MVP 구현을 위한 데이터베이스 논리 설계를 정의한다.

이 문서는 실제 마이그레이션 SQL 또는 ORM 모델 파일이 아니다. 구현 전 데이터 구조, 테이블 관계, 주요 필드, 인덱스, 보존 정책을 합의하기 위한 기준 문서다.

---

# 2. 설계 기준

## 2.1 기본 DB

Notive MVP의 기본 데이터베이스는 PostgreSQL을 기준으로 설계한다.

ORM과 마이그레이션은 **Prisma**를 사용한다(아키텍처 §5.1 잠금). Prisma 스키마(`prisma/schema.prisma`)는 본 문서의 테이블 정의를 그대로 반영한다. **본 DB 설계 문서가 단일 소스**이며, Prisma 스키마는 이 문서에서 파생된다. 두 문서가 충돌할 경우 본 문서를 기준으로 Prisma 스키마를 갱신한다.

마이그레이션은 `prisma migrate`를 사용한다. 운영 배포는 `prisma migrate deploy`로 적용한다. 개발에서는 `prisma migrate dev`를 사용해도 되지만, 그 결과물(마이그레이션 SQL)은 반드시 코드 저장소에 커밋한다.

---

## 2.2 공통 원칙

* 모든 핵심 업무 데이터는 `organization_id`를 가진다.
* 권한 판단에 필요한 필드는 명시적으로 저장한다.
* 삭제는 물리 삭제보다 상태 변경 또는 `deleted_at` 처리를 우선한다.
* 주요 변경 이력은 별도 로그 또는 버전 테이블에 남긴다.
* AI 요청, 검색어, 활동 로그는 민감 정보를 포함할 수 있으므로 보존 기간과 조회 권한을 제한한다.
* MVP에서는 지나친 정규화보다 명확한 구현과 권한 처리를 우선한다.

---

# 3. 테이블 그룹

| 그룹 | 테이블 |
| --- | --- |
| 인증/사용자 | users, sessions, invitations |
| 조직/권한 | organizations, teams, memberships, roles |
| 문서 | documents, document_versions, document_shares, document_tags, document_tag_links, document_favorites, document_view_histories |
| 템플릿 | templates, template_versions |
| AI | ai_requests, ai_results, ai_references, ai_request_payloads, prompt_presets, ai_usage_logs |
| 업무 맥락 | diary_entries, diary_entry_links, todos, projects, work_tags, work_tag_links |
| 검색 | search_indexes, search_query_logs, search_sources, search_feedbacks |
| 운영/관리 | activity_logs, organization_settings, security_settings, usage_summaries |

---

# 4. 공통 필드 규칙

## 4.1 기본 필드

대부분의 테이블은 다음 필드를 가진다.

| 필드 | 설명 |
| --- | --- |
| id | 기본 식별자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 처리 시각 |

---

## 4.2 조직 범위 필드

조직에 종속되는 테이블은 `organization_id`를 가진다.

### 대상 예시

* teams
* memberships
* documents
* templates
* diary_entries
* todos
* search_indexes
* activity_logs

---

## 4.3 상태 필드

상태가 중요한 테이블은 `status` 필드를 가진다.

### 예시

* users.status
* organizations.status
* memberships.status
* invitations.status
* documents.status
* ai_requests.status
* todos.status

---

# 5. 인증/사용자 테이블

## 5.1 users

사용자 계정 정보를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 사용자 ID |
| name | 사용자 이름 |
| email | 이메일 |
| password_hash | 비밀번호 해시 |
| profile_image_url | 프로필 이미지 |
| status | Active, Pending, Disabled, Deleted |
| email_verified_at | 이메일 인증 시각 |
| last_login_at | 마지막 로그인 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `email` unique
* `status` index

---

## 5.2 sessions

로그인 세션을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 세션 ID |
| user_id | 사용자 ID |
| token_hash | 세션 토큰 해시 |
| expires_at | 만료 시각 |
| revoked_at | 폐기 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `user_id` index
* `expires_at` index
* `token_hash` unique

---

## 5.3 invitations

조직 초대 정보를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 초대 ID |
| organization_id | 조직 ID |
| email | 초대 이메일 |
| role | 초대 역할 |
| team_id | 초대 팀 |
| invited_by_user_id | 초대자 |
| token_hash | 초대 토큰 해시 |
| status | Pending, Accepted, Expired, Revoked |
| expires_at | 만료 시각 |
| accepted_at | 수락 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, email, status` index
* `token_hash` unique
* `expires_at` index

---

# 6. 조직/권한 테이블

## 6.1 organizations

조직 정보를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 조직 ID |
| name | 조직명 |
| slug | 조직 식별자 |
| status | Active, Suspended, Deleted |
| created_by_user_id | 생성자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `slug` unique
* `status` index

---

## 6.2 teams

팀 또는 부서 정보를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 팀 ID |
| organization_id | 조직 ID |
| name | 팀명 |
| description | 설명 |
| parent_team_id | 상위 팀 |
| manager_user_id | 팀 관리자 |
| status | Active, Archived, Deleted |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `organization_id, name` index
* `organization_id, status` index

---

## 6.3 memberships

사용자의 조직 소속과 역할을 저장한다.

MVP는 사용자당 단일 팀 소속만 지원한다(Phase A §15). 다중 팀 소속은 후속 단계에서 별도 `membership_teams` 조인 테이블로 도입한다(Phase A §16). MVP에서 "같은 팀" 권한 판단은 `memberships.team_id` 단일 컬럼으로 한다.

| 필드 | 설명 |
| --- | --- |
| id | 멤버십 ID |
| user_id | 사용자 ID |
| organization_id | 조직 ID |
| team_id | 기본 팀 ID (MVP에서는 사용자가 속한 단일 팀, 미배정 사용자는 null 허용) |
| role | Viewer, Editor, Manager, Admin |
| status | Active, Invited, Disabled, Removed |
| joined_at | 가입 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `user_id, organization_id` unique
* `user_id` partial unique where `status = 'Active'` (MVP single active organization membership)
* `organization_id, role` index
* `organization_id, team_id` index
* `organization_id, status` index

---

## 6.4 roles

역할 정의를 저장한다.

MVP에서는 코드 상수로 관리할 수 있지만, 향후 커스텀 역할 확장을 위해 테이블 구조를 둘 수 있다.

| 필드 | 설명 |
| --- | --- |
| id | 역할 ID |
| organization_id | 조직 ID, 기본 역할은 null 가능 |
| code | Viewer, Editor, Manager, Admin |
| name | 표시명 |
| description | 설명 |
| is_system | 시스템 기본 역할 여부 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

---

# 7. 문서 테이블

## 7.1 documents

문서 본문과 메타데이터를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 문서 ID |
| organization_id | 조직 ID |
| title | 제목 |
| content | 본문 |
| document_type | report, meeting_note, proposal 등 |
| status | Draft, Active, Archived, Deleted |
| owner_user_id | 소유자 |
| author_user_id | 최초 작성자 |
| owner_team_id | 소유 팀 |
| visibility | Private, Team, Organization, SpecificUsers |
| source_type | Manual, AI, Imported |
| template_id | 사용 템플릿 |
| ai_request_id | 원본 AI 요청 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `organization_id, status` index
* `organization_id, owner_user_id` index
* `organization_id, owner_team_id` index
* `organization_id, document_type` index
* `organization_id, updated_at` index

---

## 7.2 document_versions

문서 변경 이력을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 버전 ID |
| document_id | 문서 ID |
| organization_id | 조직 ID |
| version_number | 버전 번호 |
| title_snapshot | 제목 스냅샷 |
| content_snapshot | 본문 스냅샷 |
| changed_by_user_id | 변경자 |
| change_summary | 변경 요약 |
| created_at | 생성 시각 |

### 제약/인덱스

* `document_id, version_number` unique
* `organization_id, document_id` index

---

## 7.3 document_shares

문서 공유 대상과 권한을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 공유 ID |
| document_id | 문서 ID |
| organization_id | 조직 ID |
| target_type | User, Team, Organization |
| target_id | 대상 ID |
| permission | View, Edit, Manage |
| created_by_user_id | 공유 설정자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `document_id, target_type, target_id` unique
* `organization_id, target_type, target_id` index

---

## 7.4 document_tags

문서 태그를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 태그 ID |
| organization_id | 조직 ID |
| name | 태그명 |
| color | 색상 |
| created_by_user_id | 생성자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, name` unique

---

## 7.5 document_tag_links

문서와 태그의 연결을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 연결 ID |
| document_id | 문서 ID |
| tag_id | 태그 ID |
| organization_id | 조직 ID |
| created_at | 생성 시각 |

### 제약/인덱스

* `document_id, tag_id` unique
* `organization_id, tag_id` index

---

## 7.6 document_favorites

사용자별 즐겨찾기 문서를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 즐겨찾기 ID |
| user_id | 사용자 ID |
| organization_id | 조직 ID |
| document_id | 문서 ID |
| created_at | 생성 시각 |

### 제약/인덱스

* `user_id, document_id` unique
* `organization_id, user_id` index

---

## 7.7 document_view_histories

최근 문서 조회 기록을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 조회 기록 ID |
| user_id | 사용자 ID |
| organization_id | 조직 ID |
| document_id | 문서 ID |
| viewed_at | 조회 시각 |

### 제약/인덱스

* `organization_id, user_id, viewed_at` index
* `document_id` index

---

# 8. 템플릿 테이블

## 8.1 templates

문서 템플릿을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 템플릿 ID |
| organization_id | 조직 ID |
| name | 템플릿명 |
| document_type | 문서 유형 |
| team_id | 적용 팀, 전체 적용 시 null |
| structure | 템플릿 구조 |
| description | 설명 |
| status | Active, Inactive, Archived |
| created_by_user_id | 생성자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, document_type` index
* `organization_id, team_id` index
* `organization_id, status` index

---

## 8.2 template_versions

템플릿 변경 이력을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 템플릿 버전 ID |
| template_id | 템플릿 ID |
| organization_id | 조직 ID |
| version_number | 버전 번호 |
| structure_snapshot | 구조 스냅샷 |
| changed_by_user_id | 변경자 |
| change_summary | 변경 요약 |
| created_at | 생성 시각 |

---

# 9. AI 테이블

AI 본문 보관 정책은 Phase A §15와 docs/ai/notive-ai-generation-policy-v1.0.md §12에 따라 다음 원칙을 따른다.

* `ai_requests`와 `ai_results`는 **메타데이터만** 영구 저장한다.
* 사용자 요청 원문(prompt body)과 AI 응답 본문(response body)은 본 DB에 영구 저장하지 않는다.
* 생성 직후 미리보기/편집 단계의 본문은 세션 바운드 단기 스토리지(예: Redis 등)에 보관하며, 사용자가 저장하면 `documents` 테이블로 영속화되고 미저장 상태에서 24시간이 지나거나 사용자가 폐기하면 즉시 정리한다.
* 사용자가 "문제 신고" opt-in 흐름을 거친 경우에만 해당 단일 요청의 prompt/response 본문을 `ai_request_payloads`에 30일 한도로 저장한다.

## 9.1 ai_requests

AI 생성 요청 메타데이터를 저장한다. 사용자 요청 원문은 저장하지 않는다.

| 필드 | 설명 |
| --- | --- |
| id | AI 요청 ID |
| organization_id | 조직 ID |
| requested_by_user_id | 요청 사용자 |
| document_type | 문서 유형 |
| template_id | 템플릿 ID |
| purpose | 문서 목적 (구조 태그) |
| audience | 대상 독자 (구조 태그) |
| tone | 톤앤매너 (구조 태그) |
| status | Pending, Processing, Completed, Failed, Cancelled |
| error_code | 오류 코드 |
| latency_ms | 생성 소요 시간 |
| token_count_input | 입력 토큰 수 |
| token_count_output | 출력 토큰 수 |
| result_saved | 결과가 문서로 저장되었는지 여부 |
| started_at | 시작 시각 |
| completed_at | 완료 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, requested_by_user_id, created_at` index
* `organization_id, status` index

### 비저장 필드

* `request_text` — Phase A §15에 따라 영구 저장하지 않음. opt-in 시 `ai_request_payloads`에 분리 저장.

---

## 9.2 ai_results

AI 생성 결과 메타데이터를 저장한다. 결과 제목과 본문은 저장하지 않는다.

| 필드 | 설명 |
| --- | --- |
| id | AI 결과 ID |
| ai_request_id | AI 요청 ID |
| organization_id | 조직 ID |
| status | Generated, Selected, Saved, Discarded, Failed |
| saved_document_id | 저장된 문서 ID (저장 시) |
| error_code | 오류 코드 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `ai_request_id` index
* `organization_id, status` index

### 비저장 필드

* `title`, `content` — Phase A §15에 따라 영구 저장하지 않음. 미리보기/편집 중에는 세션 바운드 단기 스토리지에 보관, 저장 시 `documents`로 이전, 미저장 24시간 또는 폐기 시 즉시 삭제.
* `error_message` 자유 텍스트는 저장하지 않으며, `error_code` 코드값만 저장한다. 자세한 디버그 페이로드가 필요한 경우 `ai_request_payloads`(opt-in)에 저장한다.

---

## 9.3 ai_references

AI 생성에 사용된 참고 자료를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 참고 자료 ID |
| ai_request_id | AI 요청 ID |
| organization_id | 조직 ID |
| target_type | Document, Template, DiaryEntry, Todo |
| target_id | 대상 ID |
| target_title | 생성 시점 제목 |
| access_allowed | 생성 시점 접근 가능 여부 |
| created_at | 생성 시각 |

### 제약/인덱스

* `ai_request_id, target_type, target_id` index
* `organization_id, target_type` index

---

## 9.4 ai_request_payloads

opt-in "문제 신고" 흐름에서만 채워지는 단기 보관 페이로드 테이블. 기본 흐름에서는 비어 있다.

| 필드 | 설명 |
| --- | --- |
| id | 페이로드 ID |
| organization_id | 조직 ID |
| ai_request_id | AI 요청 ID |
| ai_result_id | AI 결과 ID (응답 페이로드인 경우) |
| payload_type | Prompt, Response, ReferenceSnapshot |
| payload_text | 본문 (사용자 신고 시점 스냅샷) |
| reported_by_user_id | 신고 사용자 |
| reason_code | 신고 사유 코드 |
| retain_until | 자동 정리 시각 (created_at + 30일) |
| created_at | 생성 시각 |

### 제약/인덱스

* `ai_request_id, payload_type` index
* `organization_id, retain_until` index (정리 작업용)

### 보존

* `retain_until` 도달 시 백그라운드 작업이 물리 삭제한다.
* 제품 Admin 화면과 일반 API에는 본문을 노출하지 않는다.
* 본문 접근은 권한 정책 §9.5의 운영 break-glass 절차로만 허용한다.

---

## 9.5 prompt_presets

문서 유형별 기본 생성 구조를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 프리셋 ID |
| organization_id | 조직 ID, 시스템 기본값은 null 가능 |
| document_type | 문서 유형 |
| name | 프리셋명 |
| structure | 기본 구조 |
| default_tone | 기본 톤 |
| status | Active, Inactive |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

---

## 9.6 ai_usage_logs

AI 사용량과 결과 상태를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 사용량 로그 ID |
| organization_id | 조직 ID |
| user_id | 사용자 ID |
| ai_request_id | AI 요청 ID |
| document_type | 문서 유형 |
| status | Success, Failed, Cancelled |
| duration_ms | 생성 소요 시간 |
| created_at | 생성 시각 |

### 제약/인덱스

* `organization_id, created_at` index
* `organization_id, user_id, created_at` index

---

# 10. 업무 맥락 테이블

## 10.1 diary_entries

업무 다이어리 기록을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 업무 기록 ID |
| organization_id | 조직 ID |
| author_user_id | 작성자 |
| team_id | 팀 ID |
| entry_date | 기록 날짜 |
| content | 내용 |
| visibility | Private, Team, Organization |
| status | Active, Deleted |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `organization_id, author_user_id, entry_date` index
* `organization_id, team_id, entry_date` index
* `organization_id, visibility` index

---

## 10.2 diary_entry_links

업무 기록과 문서/프로젝트/To-do 연결을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 연결 ID |
| organization_id | 조직 ID |
| diary_entry_id | 업무 기록 ID |
| target_type | Document, Project, Todo |
| target_id | 대상 ID |
| created_at | 생성 시각 |

---

## 10.3 todos

To-do를 저장한다.

MVP는 개인 To-do만 지원한다(Phase A §15). 담당자 할당, 팀 공개, Cancelled 상태는 후속 단계로 미룬다.

| 필드 | 설명 |
| --- | --- |
| id | To-do ID |
| organization_id | 조직 ID |
| title | 제목 |
| description | 설명 |
| owner_user_id | 소유자 (생성자 = 담당자, MVP에서 단일 사용자) |
| due_date | 마감일 |
| priority | Low, Medium, High |
| status | todo, in_progress, done |
| related_document_id | 관련 문서 |
| project_id | 관련 프로젝트 (P1) |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

### 제약/인덱스

* `organization_id, owner_user_id, status` index
* `organization_id, owner_user_id, due_date` index

### 후속 확장 시 추가 예정 필드

다중 사용자 협업 To-do 도입 시: `assignee_user_id`, `team_id`, `visibility`, 추가 상태(`cancelled`).

---

## 10.4 projects

문서와 업무 기록을 묶는 업무 단위를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 프로젝트 ID |
| organization_id | 조직 ID |
| name | 프로젝트명 |
| description | 설명 |
| owner_team_id | 소유 팀 |
| status | Active, Archived, Deleted |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |
| deleted_at | 삭제 시각 |

---

## 10.5 work_tags

업무 기록용 태그를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 태그 ID |
| organization_id | 조직 ID |
| name | 태그명 |
| color | 색상 |
| created_by_user_id | 생성자 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, name` unique

---

## 10.6 work_tag_links

업무 기록 또는 To-do와 업무 태그의 연결을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 연결 ID |
| organization_id | 조직 ID |
| tag_id | 태그 ID |
| target_type | DiaryEntry, Todo |
| target_id | 대상 ID |
| created_at | 생성 시각 |

---

# 11. 검색 테이블

## 11.1 search_indexes

검색 대상 메타데이터와 검색용 본문을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 검색 인덱스 ID |
| organization_id | 조직 ID |
| target_type | Document, DiaryEntry, Todo |
| target_id | 대상 ID |
| title | 제목 |
| summary | 요약 |
| searchable_text | 검색 본문 |
| author_user_id | 작성자 |
| team_id | 팀 ID |
| document_type | 문서 유형 |
| tags | 태그 목록 |
| visibility | 공개 범위 |
| status | Active, Archived, Deleted |
| indexed_at | 인덱싱 시각 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

### 제약/인덱스

* `organization_id, target_type, target_id` unique
* `organization_id, target_type` index
* `organization_id, team_id` index
* `organization_id, indexed_at` index
* `searchable_text` full-text index 검토

---

## 11.2 search_query_logs

검색 요청 기록을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 검색 로그 ID |
| organization_id | 조직 ID |
| user_id | 사용자 ID |
| query_text | 검색어 |
| search_mode | All, Document, DiaryEntry, Todo |
| filters | 필터 조건 |
| result_count | 결과 수 |
| created_at | 검색 시각 |

### 제약/인덱스

* `organization_id, user_id, created_at` index
* `organization_id, created_at` index

---

## 11.3 search_sources

AI 요약 검색에 사용된 출처를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 출처 ID |
| search_query_log_id | 검색 로그 ID |
| organization_id | 조직 ID |
| target_type | Document, DiaryEntry, Todo |
| target_id | 대상 ID |
| title | 출처 제목 |
| excerpt | 사용된 범위 요약 |
| created_at | 생성 시각 |

---

## 11.4 search_feedbacks

검색 결과 피드백을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 피드백 ID |
| search_query_log_id | 검색 로그 ID |
| organization_id | 조직 ID |
| user_id | 사용자 ID |
| satisfied | 만족 여부 |
| feedback_text | 피드백 내용 |
| created_at | 생성 시각 |

---

# 12. 운영/관리 테이블

## 12.1 activity_logs

사용자와 관리자 활동 로그를 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 활동 로그 ID |
| organization_id | 조직 ID |
| actor_user_id | 수행 사용자 |
| action | 활동 유형 |
| target_type | 대상 유형 |
| target_id | 대상 ID |
| result | Success, Failed |
| metadata | 부가 정보 |
| ip_address | IP |
| user_agent | 사용자 환경 |
| created_at | 발생 시각 |

### 제약/인덱스

* `organization_id, created_at` index
* `organization_id, actor_user_id, created_at` index
* `organization_id, action, created_at` index

---

## 12.2 organization_settings

조직 기본 설정을 저장한다.

| 필드 | 설명 |
| --- | --- |
| organization_id | 조직 ID |
| default_role | 기본 역할 |
| default_team_id | 기본 팀 |
| default_document_visibility | 기본 문서 공개 범위 |
| ai_enabled | AI 기능 사용 여부 |
| search_enabled | 검색 기능 사용 여부 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

---

## 12.3 security_settings

조직 보안 설정을 저장한다.

| 필드 | 설명 |
| --- | --- |
| organization_id | 조직 ID |
| external_sharing_enabled | 외부 공유 허용 여부 |
| download_enabled | 다운로드 허용 여부 |
| activity_log_retention_days | 활동 로그 보존 기간 |
| search_log_retention_days | 검색 로그 보존 기간 |
| ai_log_policy | AI 로그 저장 정책 |
| invite_policy | 초대 정책 |
| created_at | 생성 시각 |
| updated_at | 수정 시각 |

---

## 12.4 usage_summaries

기간별 사용량 요약을 저장한다.

| 필드 | 설명 |
| --- | --- |
| id | 요약 ID |
| organization_id | 조직 ID |
| period_type | Daily, Weekly, Monthly |
| period_start | 기간 시작 |
| period_end | 기간 종료 |
| active_user_count | 활성 사용자 수 |
| document_count | 문서 수 |
| ai_request_count | AI 요청 수 |
| ai_failed_count | AI 실패 수 |
| search_query_count | 검색 수 |
| diary_entry_count | 업무 기록 수 |
| todo_count | To-do 수 |
| created_at | 생성 시각 |

### 제약/인덱스

* `organization_id, period_type, period_start` unique

---

# 13. 주요 관계 요약

## 13.1 사용자/조직

```text
users 1 - N memberships
organizations 1 - N memberships
organizations 1 - N teams
teams 1 - N memberships
```

---

## 13.2 문서

```text
organizations 1 - N documents
documents 1 - N document_versions
documents 1 - N document_shares
documents N - N document_tags
users 1 - N document_favorites
```

---

## 13.3 AI

```text
users 1 - N ai_requests
ai_requests 1 - N ai_results
ai_requests 1 - N ai_references
ai_results 0..1 - 1 documents
```

---

## 13.4 업무 맥락

```text
users 1 - N diary_entries
users 1 - N todos
projects 1 - N todos
projects 1 - N diary_entry_links
diary_entries N - N work_tags
todos N - N work_tags
```

---

## 13.5 검색

```text
documents / diary_entries / todos 1 - 1 search_indexes
search_query_logs 1 - N search_sources
search_query_logs 1 - N search_feedbacks
```

---

# 14. 인덱스 설계 기준

## 14.1 공통 인덱스

조직 범위 조회가 많으므로 주요 테이블에는 다음 패턴의 인덱스를 둔다.

* `organization_id`
* `organization_id, status`
* `organization_id, created_at`
* `organization_id, updated_at`

---

## 14.2 권한 조회 인덱스

문서와 업무 기록은 권한 기반 조회가 많다.

### 주요 인덱스

* `documents.organization_id, owner_user_id`
* `documents.organization_id, owner_team_id`
* `documents.organization_id, visibility`
* `document_shares.document_id, target_type, target_id`
* `diary_entries.organization_id, author_user_id`
* `diary_entries.organization_id, team_id`
* `todos.organization_id, owner_user_id`

---

## 14.3 검색 인덱스

검색은 MVP에서는 단순 구조로 시작하되, 다음 확장을 고려한다.

* 제목 검색 인덱스
* 본문 full-text index
* 태그 필터 인덱스
* 작성자/팀/날짜 필터 인덱스
* 향후 벡터 검색용 별도 인덱스

---

# 15. 삭제 및 보존 정책

## 15.1 Soft Delete

다음 데이터는 즉시 물리 삭제하지 않는다.

* users
* organizations
* teams
* documents
* diary_entries
* todos
* projects

삭제 시 `deleted_at` 또는 `status`를 변경한다.

---

## 15.2 로그 보존

| 로그 | 기본 보존 방향 |
| --- | --- |
| activity_logs | 조직 보안 정책에 따라 보존 |
| ai_usage_logs | 비용/품질 분석을 위해 보존 |
| search_query_logs | 민감 정보 가능성이 있어 기간 제한 |
| sessions | 만료 후 정리 |
| invitations | 만료 또는 수락 후 일정 기간 보존 |

---

## 15.3 AI 본문 보존

AI 요청과 결과에는 민감한 업무 정보가 포함될 수 있다.

MVP의 결정 사항(Phase A §15):

* AI 요청 원문(prompt body)과 결과 본문(response body)은 `ai_requests`/`ai_results`에 영구 저장하지 않는다.
* 미리보기/편집 중인 본문은 세션 바운드 단기 스토리지(예: Redis)에 보관하며, 사용자가 저장하면 `documents`로 이전된다. 미저장 상태에서 24시간이 지나거나 사용자가 폐기하면 즉시 삭제한다.
* `ai_requests`/`ai_results`/`ai_usage_logs`/`ai_references`의 메타데이터는 90일 보존한다.
* 사용자가 "문제 신고" opt-in 흐름을 사용한 경우에만 해당 단일 요청의 본문이 `ai_request_payloads`에 30일 보존된다.
* Admin 화면에서도 본문은 기본 노출하지 않는다. 메타데이터만 노출한다.

---

# 16. MVP에서 결정된 항목 (Phase A §15)

| 항목 | 결정 |
| --- | --- |
| 다중 팀 소속 | 미허용. `memberships.team_id` 단일. 다중 팀은 `membership_teams` 조인 테이블로 후속 도입. |
| AI 요청 원문 저장 | 기본 미저장. opt-in `ai_request_payloads`에 30일 한도. |
| 첨부 파일 | 후속. |

---

# 16.1 미결정 항목

| 항목 | 선택지 | 영향 |
| --- | --- | --- |
| ID 타입 | UUID, bigint | 마이그레이션과 분산 확장 |
| 문서 본문 형식 | Markdown, HTML, JSON document | 편집기와 검색 처리 |
| 템플릿 구조 형식 | Markdown, JSON schema | AI 생성과 편집기 |
| roles 테이블 | 코드 상수, DB 관리 | 커스텀 역할 확장 |
| 검색 인덱스 | DB 기반, 별도 검색 엔진 | 검색 품질과 운영 |

---

# 17. 후속 문서 연결

본 DB 설계서를 기준으로 다음 문서를 작성한다.

| 문서 | 연결 내용 |
| --- | --- |
| API 명세서 | 각 테이블을 다루는 요청/응답 구조 정의 |
| 권한 정책 명세서 | 테이블별 접근 조건과 권한 판단 로직 정의 |
| 화면/UX 설계서 | 화면별 필요한 데이터와 상태 정의 |
| AI 프롬프트/생성 정책 문서 | AIRequest, AIReference, AIResult 사용 기준 정의 |
| 검색 설계 상세 문서 | SearchIndex와 자연어 검색 고도화 기준 정의 |

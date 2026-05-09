# Notive Documentation

Notive는 AI 기반 사내 문서 및 업무 운영 플랫폼이다.

이 디렉터리는 Notive의 제품 기획, 구현 계획, 기술 설계, 운영 기준을 정리한 문서 모음이다.

---

# 1. 권장 읽기 순서

처음 프로젝트를 파악할 때는 아래 순서로 읽는다.

1. `prd/notive-prd-v1.0.md`
2. `implementation/notive-implementation-plan-v1.0.md`
3. `implementation/notive-implementation-plan-a-foundation-v1.0.md`
4. `architecture/notive-technical-architecture-v1.0.md`
5. `database/notive-database-design-v1.0.md`
6. `api/notive-api-spec-v1.0.md`
7. `ux/notive-screen-ux-design-v1.0.md`
8. `security/notive-permission-policy-v1.0.md`
9. `ai/notive-ai-generation-policy-v1.0.md`
10. `qa/notive-test-plan-v1.0.md`
11. `operations/notive-deployment-operations-guide-v1.0.md`

---

# 2. 문서 구조

```text
docs/
  README.md
  prd/
  implementation/
  architecture/
  database/
  api/
  ux/
  security/
  ai/
  qa/
  operations/
```

---

# 3. 제품 기획 문서

## PRD

| 문서 | 설명 |
| --- | --- |
| `prd/notive-prd-v1.0.md` | Notive의 제품 목적, 타깃 사용자, 핵심 기능, MVP 범위, 성공 지표를 정의한다. |

이 문서는 “무엇을 왜 만들 것인가”를 설명한다.

---

# 4. 구현 계획 문서

## 전체 구현 계획

| 문서 | 설명 |
| --- | --- |
| `implementation/notive-implementation-plan-v1.0.md` | A-H 단계로 나눈 전체 구현 로드맵이다. |

---

## 단계별 세부 구현 계획

| 단계 | 문서 | 설명 |
| --- | --- | --- |
| A | `implementation/notive-implementation-plan-a-foundation-v1.0.md` | 기반 설계, 화면 범위, 권한, 데이터 범위, MVP 백로그를 정의한다. |
| B | `implementation/notive-implementation-plan-b-service-foundation-v1.0.md` | 인증, 조직, 팀, 역할, 공통 레이아웃 구축 계획이다. |
| C | `implementation/notive-implementation-plan-c-document-management-v1.0.md` | 문서 작성, 저장, 공유, 버전 관리 구현 계획이다. |
| D | `implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md` | AI 문서 생성, 템플릿, 참고 자료, 결과 저장 흐름 구현 계획이다. |
| E | `implementation/notive-implementation-plan-e-work-context-v1.0.md` | 업무 다이어리, To-do, 업무 맥락 기반 문서 생성 구현 계획이다. |
| F | `implementation/notive-implementation-plan-f-knowledge-search-v1.0.md` | 사내 지식 검색, AI 요약 검색, 출처 표시 구현 계획이다. |
| G | `implementation/notive-implementation-plan-g-admin-operations-v1.0.md` | 관리자, 사용자 관리, 템플릿, 활동 로그, 사용 현황 구현 계획이다. |
| H | `implementation/notive-implementation-plan-h-stabilization-launch-v1.0.md` | 안정화, 출시 준비, QA, 운영 준비 계획이다. |

---

# 5. 기술 설계 문서

## 아키텍처

| 문서 | 설명 |
| --- | --- |
| `architecture/notive-technical-architecture-v1.0.md` | 전체 시스템 구성, 모듈 구조, 데이터 흐름, AI/검색/보안/배포 아키텍처를 정의한다. |

## DB

| 문서 | 설명 |
| --- | --- |
| `database/notive-database-design-v1.0.md` | PostgreSQL 기준 테이블, 필드, 관계, 인덱스, 삭제/보존 정책을 정의한다. |

## API

| 문서 | 설명 |
| --- | --- |
| `api/notive-api-spec-v1.0.md` | REST API 경로, 요청/응답 구조, 권한 기준, 오류 처리 기준을 정의한다. |

---

# 6. 제품 구현 지원 문서

## 화면/UX

| 문서 | 설명 |
| --- | --- |
| `ux/notive-screen-ux-design-v1.0.md` | 화면별 목적, 구성 요소, 상태, 오류 처리, API 연결 기준을 정의한다. |

## 권한 정책

| 문서 | 설명 |
| --- | --- |
| `security/notive-permission-policy-v1.0.md` | 역할, 문서 권한, AI 참고 자료 권한, 검색 권한, 관리자 권한을 정의한다. |

## AI 생성 정책

| 문서 | 설명 |
| --- | --- |
| `ai/notive-ai-generation-policy-v1.0.md` | AI 문서 생성 원칙, 문서 유형별 출력 구조, 참고 자료 사용, 출처 표시, 금지 사항을 정의한다. |

---

# 7. 품질 및 운영 문서

## QA

| 문서 | 설명 |
| --- | --- |
| `qa/notive-test-plan-v1.0.md` | 기능, 권한, AI, 검색, 관리자, 오류 테스트와 출시 차단 기준을 정의한다. |

## 운영

| 문서 | 설명 |
| --- | --- |
| `operations/notive-deployment-operations-guide-v1.0.md` | 환경 구성, 배포, 롤백, 모니터링, 장애 대응, 백업, 운영 업무를 정의한다. |

---

# 8. 작업 목적별 참고 문서

## 제품 방향을 확인할 때

* `prd/notive-prd-v1.0.md`
* `implementation/notive-implementation-plan-v1.0.md`

## 개발 범위를 확인할 때

* `implementation/notive-implementation-plan-v1.0.md`
* `implementation/notive-implementation-plan-a-foundation-v1.0.md`
* 각 단계별 세부 구현 계획서

## DB/API 구현을 시작할 때

* `architecture/notive-technical-architecture-v1.0.md`
* `database/notive-database-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## 프론트엔드 구현을 시작할 때

* `ux/notive-screen-ux-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## AI 기능을 구현할 때

* `implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md`
* `ai/notive-ai-generation-policy-v1.0.md`
* `security/notive-permission-policy-v1.0.md`
* `api/notive-api-spec-v1.0.md`

## 검색 기능을 구현할 때

* `implementation/notive-implementation-plan-f-knowledge-search-v1.0.md`
* `database/notive-database-design-v1.0.md`
* `api/notive-api-spec-v1.0.md`
* `security/notive-permission-policy-v1.0.md`

## 출시 전 점검할 때

* `implementation/notive-implementation-plan-h-stabilization-launch-v1.0.md`
* `qa/notive-test-plan-v1.0.md`
* `operations/notive-deployment-operations-guide-v1.0.md`

---

# 9. 문서 관리 원칙

* 문서 변경 시 관련 문서의 충돌 여부를 확인한다.
* PRD 변경은 구현 계획과 API/DB/UX 문서에 영향을 줄 수 있다.
* 권한 정책 변경은 API, DB, UX, QA 문서에 함께 반영해야 한다.
* AI 생성 정책 변경은 AI 테스트 케이스와 함께 갱신한다.
* 배포/운영 정책 변경은 QA와 출시 기준에 반영한다.

---

# 10. 다음 추천 작업

현재 문서 세트 기준으로 다음 작업을 진행할 수 있다.

1. 미결정 사항 정리 및 의사결정
2. OpenAPI 스펙 작성
3. DB 마이그레이션 초안 작성
4. 프론트엔드 라우팅 설계
5. Permission Module 상세 설계
6. AI 프롬프트 상세 문안 작성
7. QA 체크리스트 세분화

---

# 11. Git 브랜치 전략

기본 브랜치 전략은 다음과 같다.

**배포 전까지 `main`은 건드리지 않는다. 모든 개발 머지와 푸시는 `develop` 기준으로만 진행한다.**

* `main`: 안정 버전과 릴리즈 기준 브랜치
* `develop`: 개발 통합 브랜치
* `feature/*`: 개별 기능 개발 브랜치
* `fix/*`: 버그 수정 브랜치
* `docs/*`: 문서 수정 브랜치

개별 기능은 반드시 `develop`에서 새 브랜치를 만들어 작업하고, 완료 후 검증을 거쳐 `develop`에 머지한다.

작업 원칙:

* `main`에 직접 커밋하지 않는다.
* `main`에 직접 푸시하지 않는다.
* 기능 구현은 `feature/*` 브랜치에서만 진행한다.
* 버그 수정은 `fix/*` 브랜치에서 진행한다.
* 문서 수정은 `docs/*` 브랜치 또는 단순 변경 시 `develop`에서 진행할 수 있다.
* 작업 완료 후 `develop`에 머지하고 `origin/develop`에 푸시한다.
* `main` 반영은 명시적인 배포 지시가 있을 때만 진행한다.

예:

```text
develop
  -> feature/auth-foundation
  -> feature/document-management
  -> feature/ai-document-generation
```

`download/` 폴더와 내부 파일은 Git 업로드 대상에서 제외하며, 코드에서 직접 참조하지 않는다.

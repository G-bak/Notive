# 화면/UX 설계서 v1.0

# Notive Screen & UX Design

---

# 1. 문서 목적

본 문서는 Notive MVP 구현을 위한 화면/UX 설계 기준을 정의한다.

이 문서는 시각 디자인 최종안이나 상세 와이어프레임이 아니다. 화면별 목적, 주요 구성 요소, 사용자 액션, 상태, 오류 처리, API 연결 기준을 정리하여 이후 UI 구현과 상세 디자인의 기준으로 사용한다.

---

# 2. UX 설계 원칙

## 2.1 업무 도구다운 밀도

Notive는 업무용 SaaS다. 화면은 장식보다 정보 탐색, 작성, 검토, 공유가 빠르게 이뤄지는 구조를 우선한다.

---

## 2.2 문서 작성 흐름 우선

사용자는 Notive에서 빠르게 문서를 만들고 저장해야 한다.

주요 화면은 “새 문서 생성”, “AI 문서 생성”, “최근 문서”, “업무 기록 기반 보고서 생성”으로 빠르게 이어져야 한다.

---

## 2.3 AI 결과는 초안

AI가 생성한 결과는 확정 결과가 아니라 사용자가 검토하고 수정할 초안으로 표현한다.

---

## 2.4 권한 상태 명확화

사용자가 할 수 없는 작업은 숨기거나 비활성화한다.

단, 중요한 제한 상황은 “권한 없음”, “관리자에게 문의”처럼 명확히 안내한다.

---

## 2.5 빈 상태와 오류 상태 제공

초기 사용자는 데이터가 없는 상태에서 시작한다.

빈 문서 목록, 빈 업무 기록, 검색 결과 없음, AI 생성 실패 상태를 별도 UX로 제공해야 한다.

---

# 3. 전체 정보 구조

## 3.1 기본 내비게이션

사이드 내비게이션은 다음 구조를 기준으로 한다.

* 홈
* AI 문서 생성
* 문서
* 업무 다이어리
* To-do
* 검색
* 관리자
* 설정

---

## 3.2 역할별 메뉴 노출

| 메뉴 | Viewer | Editor | Manager | Admin |
| --- | --- | --- | --- | --- |
| 홈 | 표시 | 표시 | 표시 | 표시 |
| AI 문서 생성 | 숨김 | 표시 | 표시 | 표시 |
| 문서 | 표시 | 표시 | 표시 | 표시 |
| 업무 다이어리 | 숨김 | 표시 | 표시 | 표시 |
| To-do | 숨김 | 표시 | 표시 | 표시 |
| 검색 | 표시 | 표시 | 표시 | 표시 |
| 관리자 | 숨김 | 숨김 | 제한 표시 | 표시 |
| 설정 | 표시 | 표시 | 표시 | 표시 |

---

## 3.3 공통 레이아웃

### 구성

* 사이드 내비게이션
* 상단 바
* 현재 조직 표시
* 사용자 프로필 메뉴
* 메인 콘텐츠 영역
* 토스트/알림 영역

---

# 4. 공통 화면 상태

## 4.1 로딩 상태

### 사용 위치

* 문서 목록 조회
* 문서 저장
* AI 생성 진행
* 검색 실행
* 관리자 대시보드 조회

### UX 기준

* 사용자가 기다려야 하는 이유를 알 수 있어야 한다.
* AI 생성처럼 시간이 걸리는 작업은 단순 스피너보다 진행 상태 문구를 제공한다.

---

## 4.2 빈 상태

### 예시

| 화면 | 빈 상태 메시지 방향 |
| --- | --- |
| 문서 목록 | 아직 작성된 문서가 없습니다. 새 문서를 만들어보세요. |
| 업무 다이어리 | 오늘 기록된 업무가 없습니다. 업무 기록을 추가해보세요. |
| To-do | 등록된 할 일이 없습니다. |
| 검색 | 검색어를 입력해 문서를 찾아보세요. |
| 관리자 사용자 목록 | 아직 초대된 사용자가 없습니다. |

---

## 4.3 오류 상태

### UX 기준

* 오류 원인을 사용자 언어로 설명한다.
* 재시도 가능한 경우 재시도 버튼을 제공한다.
* 권한 오류와 시스템 오류를 구분한다.
* 작성 중 데이터가 있는 경우 사라지지 않도록 한다.

---

## 4.4 접근 제한 상태

### 표시 요소

* 접근할 수 없다는 안내
* 필요한 권한
* 돌아가기 버튼
* 관리자 문의 안내

---

# 5. 인증/온보딩 화면

## 5.1 로그인

### 목적

기존 사용자가 서비스에 진입한다.

### 구성 요소

* 이메일 입력
* 비밀번호 입력
* 로그인 버튼
* 회원가입 이동
* 비밀번호 재설정 이동
* 오류 메시지

### API

* `POST /auth/login`

---

## 5.2 회원가입

### 목적

신규 사용자가 계정을 생성한다.

### 구성 요소

* 이름 입력
* 이메일 입력
* 비밀번호 입력
* 약관 동의 영역
* 회원가입 버튼
* 로그인 이동

### API

* `POST /auth/signup`

---

## 5.3 초대 수락

### 목적

초대받은 사용자가 조직에 가입한다.

### 구성 요소

* 초대 조직명
* 초대 이메일
* 부여될 역할
* 수락 버튼
* 로그인/회원가입 안내
* 초대 만료 상태

### API

* `POST /invitations/{token}/accept`

---

## 5.4 조직 생성/선택

### 목적

사용자가 작업할 조직을 생성하거나 선택한다.

### 구성 요소

* 조직명 입력
* 조직 생성 버튼
* 내 조직 목록
* 조직 선택 버튼

### API

* `POST /organizations`
* `GET /organizations`

---

# 6. 홈 대시보드

## 6.1 목적

홈은 사용자가 다음 작업으로 빠르게 이동하는 시작 화면이다.

---

## 6.2 구성 요소

* 새 AI 문서 생성 버튼
* 새 문서 작성 버튼
* 최근 문서
* 공유받은 문서
* 오늘의 업무 기록
* 내 To-do
* 관리자용 운영 요약

---

## 6.3 역할별 차이

| 역할 | 홈 표시 우선순위 |
| --- | --- |
| Viewer | 최근 문서, 공유받은 문서, 검색 |
| Editor | AI 생성, 새 문서, 업무 기록, To-do |
| Manager | 팀 문서, 팀 업무, 제한 관리자 요약 |
| Admin | 조직 운영 요약, 사용자 초대, 템플릿 관리 |

---

# 7. 문서 화면

## 7.1 문서 목록

### 목적

접근 가능한 문서를 탐색한다.

### 구성 요소

* 새 문서 버튼
* 검색 입력
* 필터
* 정렬
* 문서 목록 테이블
* 즐겨찾기 토글
* 빈 상태

### 목록 컬럼

* 제목
* 문서 유형
* 작성자
* 팀
* 공유 범위
* 태그
* 최근 수정일
* 상태

### API

* `GET /organizations/{organizationId}/documents`

---

## 7.2 문서 상세

### 목적

문서 내용을 읽고 주요 액션을 수행한다.

### 구성 요소

* 제목
* 본문
* 문서 메타데이터
* 편집 버튼
* 공유 설정 버튼
* 버전 기록 버튼
* 즐겨찾기
* 삭제/보관

### API

* `GET /organizations/{organizationId}/documents/{documentId}`

---

## 7.3 문서 편집

### 목적

문서를 작성하거나 수정한다.

### 구성 요소

* 제목 입력
* 본문 편집기
* 문서 유형 선택
* 태그 입력
* 소유 팀 선택
* 저장 버튼
* 자동 저장 상태
* 공유 설정 진입

### API

* `POST /organizations/{organizationId}/documents`
* `PATCH /organizations/{organizationId}/documents/{documentId}`

---

## 7.4 공유 설정

### 목적

문서 접근 범위를 설정한다.

### 구성 요소

* 현재 공유 범위
* 공유 대상 선택
* 권한 수준 선택
* 저장 버튼
* 위험 변경 안내

### API

* `PUT /organizations/{organizationId}/documents/{documentId}/shares`

---

## 7.5 버전 기록

### 목적

문서 변경 이력을 확인하고 복원한다.

### 구성 요소

* 버전 목록
* 변경자
* 변경 시각
* 미리보기
* 복원 버튼

### API

* `GET /organizations/{organizationId}/documents/{documentId}/versions`
* `POST /organizations/{organizationId}/documents/{documentId}/versions/{versionId}/restore`

---

# 8. AI 문서 생성 화면

## 8.1 AI 생성 홈

### 목적

AI 문서 생성을 시작한다.

### 구성 요소

* 문서 유형 카드
* 최근 생성 기록
* 추천 템플릿
* 요청 예시

---

## 8.2 생성 요청 입력

### 목적

AI에게 전달할 요청 조건을 입력한다.

### 구성 요소

* 문서 유형 선택
* 템플릿 선택
* 요청 내용 입력
* 문서 목적
* 대상 독자
* 톤앤매너
* 참고 자료 선택
* 생성 버튼

### API

* `POST /organizations/{organizationId}/ai/generate-document`

---

## 8.3 참고 자료 선택

### 목적

AI 생성에 사용할 자료를 선택한다.

### 탭

* 문서
* 업무 기록
* To-do

### UX 기준

* 접근 가능한 자료만 표시한다.
* 선택된 자료 개수를 표시한다.
* 권한 없는 자료는 노출하지 않는다.

---

## 8.4 생성 진행

### 목적

AI 생성 중임을 사용자에게 알린다.

### 표시 요소

* 생성 중 메시지
* 선택 문서 유형
* 취소 또는 돌아가기
* 지연 안내

### API

* `GET /organizations/{organizationId}/ai/requests/{aiRequestId}`

---

## 8.5 생성 결과 미리보기

### 목적

AI 결과를 확인하고 다음 행동을 선택한다.

### 구성 요소

* 생성 제목
* 생성 본문
* 참고 자료 출처
* 편집하기
* Draft 저장
* 재생성
* 요청 수정

### API

* `GET /organizations/{organizationId}/ai/requests/{aiRequestId}/results`
* `POST /organizations/{organizationId}/ai/results/{aiResultId}/save-document`

---

# 9. 업무 다이어리 화면

## 9.1 업무 다이어리 목록

### 목적

날짜별 업무 기록을 확인한다.

### 구성 요소

* 날짜 선택
* 새 기록 버튼
* 기록 목록
* 태그 필터
* 프로젝트 필터
* 보고서 생성 버튼

### API

* `GET /organizations/{organizationId}/diary-entries`

---

## 9.2 업무 기록 작성/수정

### 목적

업무 맥락 데이터를 입력한다.

### 구성 요소

* 날짜
* 내용
* 공개 범위
* 태그
* 관련 문서
* 저장 버튼

### API

* `POST /organizations/{organizationId}/diary-entries`
* `PATCH /organizations/{organizationId}/diary-entries/{entryId}`

---

# 10. To-do 화면

## 10.1 To-do 목록

### 목적

개인 또는 팀 할 일을 관리한다.

### 구성 요소

* 새 To-do 버튼
* 상태 필터
* 담당자 필터
* 마감일 필터
* To-do 목록

### API

* `GET /organizations/{organizationId}/todos`

---

## 10.2 To-do 작성/수정

### 구성 요소

* 제목
* 설명
* 담당자
* 마감일
* 우선순위
* 상태
* 관련 문서
* 저장 버튼

### API

* `POST /organizations/{organizationId}/todos`
* `PATCH /organizations/{organizationId}/todos/{todoId}`

---

# 11. 검색 화면

## 11.1 통합 검색

### 목적

문서와 업무 맥락을 검색한다.

### 구성 요소

* 검색 입력
* 검색 모드
* 필터
* 정렬
* 결과 목록
* AI 요약 검색 버튼
* 결과 없음 상태

### API

* `GET /organizations/{organizationId}/search`

---

## 11.2 검색 결과

### 표시 요소

* 제목
* 요약
* 대상 유형
* 작성자
* 팀
* 수정일
* 원문 열기
* AI 문서 생성에 사용

---

## 11.3 AI 요약 검색

### 목적

검색 결과를 기반으로 요약 답변을 제공한다.

### 구성 요소

* 질문
* 요약 답변
* 출처 목록
* 원문 이동
* 만족/불만족 피드백

### API

* `POST /organizations/{organizationId}/search/answer`
* `POST /organizations/{organizationId}/search/feedback`

---

# 12. 관리자 화면

## 12.1 관리자 대시보드

### 목적

조직 운영 현황을 확인한다.

### 구성 요소

* 사용자 수
* 문서 수
* AI 요청 수
* 검색 요청 수
* 초대 대기 수
* 최근 활동

### API

* `GET /organizations/{organizationId}/admin/dashboard`

---

## 12.2 사용자 관리

### 구성 요소

* 사용자 목록
* 초대 버튼
* 역할 변경
* 팀 변경
* 비활성화
* 초대 상태

### API

* `GET /organizations/{organizationId}/admin/users`
* `POST /organizations/{organizationId}/invitations`
* `PATCH /organizations/{organizationId}/admin/users/{userId}/role`
* `POST /organizations/{organizationId}/admin/users/{userId}/disable`

---

## 12.3 팀/부서 관리

### 구성 요소

* 팀 목록
* 새 팀 생성
* 팀명 수정
* 팀 사용자 확인

### API

* `GET /organizations/{organizationId}/teams`
* `POST /organizations/{organizationId}/teams`

---

## 12.4 템플릿 관리

### 구성 요소

* 템플릿 목록
* 새 템플릿
* 문서 유형
* 적용 팀
* 템플릿 본문
* 활성/비활성

### API

* `GET /organizations/{organizationId}/templates`
* `POST /organizations/{organizationId}/templates`
* `PATCH /organizations/{organizationId}/templates/{templateId}`
* `POST /organizations/{organizationId}/templates/{templateId}/deactivate`

---

## 12.5 활동 로그

### 구성 요소

* 기간 필터
* 사용자 필터
* 활동 유형 필터
* 로그 목록

### API

* `GET /organizations/{organizationId}/admin/activity-logs`

---

# 13. 설정 화면

## 13.1 개인 설정

### 구성 요소

* 이름
* 이메일
* 프로필 이미지
* 비밀번호 변경
* 로그아웃

### API

* `GET /auth/me`

---

## 13.2 조직 설정

### 구성 요소

* 조직명
* 기본 역할
* 기본 문서 공개 범위
* AI 사용 여부
* 검색 사용 여부

### API

* `GET /organizations/{organizationId}/admin/settings`
* `PATCH /organizations/{organizationId}/admin/settings`

---

# 14. 주요 사용자 여정

## 14.1 첫 문서 생성

1. 로그인
2. 홈 진입
3. AI 문서 생성 선택
4. 문서 유형 선택
5. 요청 입력
6. 생성 결과 확인
7. 편집
8. 저장
9. 문서 목록에서 확인

---

## 14.2 업무 보고서 생성

1. 업무 다이어리 작성
2. To-do 완료 처리
3. AI 문서 생성 진입
4. 업무 기록과 To-do 선택
5. 보고서 생성
6. 편집 후 저장
7. 팀 공유

---

## 14.3 사내 문서 검색

1. 검색 진입
2. 검색어 입력
3. 필터 적용
4. 결과 확인
5. AI 요약 확인
6. 출처 문서 열람
7. 필요 시 AI 문서 생성 참고 자료로 사용

---

# 15. 후속 작업

본 화면/UX 설계서를 기준으로 다음 작업을 진행한다.

| 작업 | 설명 |
| --- | --- |
| 상세 와이어프레임 | 화면별 배치와 컴포넌트 상세화 |
| 디자인 시스템 정의 | 색상, 타이포그래피, 컴포넌트 스타일 정의 |
| 프론트엔드 라우팅 설계 | 화면 경로와 접근 권한 정의 |
| 상태 관리 설계 | 화면별 로딩, 오류, 저장 상태 정의 |
| QA 시나리오 작성 | 사용자 여정 기반 테스트 케이스 작성 |


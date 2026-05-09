# Phase A 작업 보고서 모음

이 폴더는 Phase A(기반 설계) 작업이 완료된 시점에 작성된 문서별 작업 보고서다. 각 보고서는 어떤 문서를 왜 그렇게 바꿨는지 비개발자도 이해할 수 있게 정리한다.

## 보고서 목록

| 보고서 | 대상 문서 | 한 줄 요약 |
| --- | --- | --- |
| [01](./01-implementation-plan-overall.md) | `docs/implementation/notive-implementation-plan-v1.0.md` | 전체 구현 계획서를 영어로 정리하고 부서/팀 표기를 통일했다. |
| [02](./02-implementation-plan-a-foundation.md) | `docs/implementation/notive-implementation-plan-a-foundation-v1.0.md` | Phase A 세부 계획서를 영어로 정리하고 MVP 결정 12개 항목을 잠갔다. |
| [03](./03-permission-policy.md) | `docs/security/notive-permission-policy-v1.0.md` | Admin이 문서 본문을 마음대로 보지 못하게 하고 To-do를 개인 전용으로 좁혔다. |
| [04](./04-database-design.md) | `docs/database/notive-database-design-v1.0.md` | AI 요청/결과 본문을 DB에 영구 저장하지 않도록 스키마를 다시 설계했다. |
| [05](./05-ai-generation-policy.md) | `docs/ai/notive-ai-generation-policy-v1.0.md` | AI 로그 보관 기준을 "메타데이터 90일 + 신고 시 본문 30일"로 잠갔다. |
| [06](./06-api-spec.md) | `docs/api/notive-api-spec-v1.0.md` | AI 본문이 영구 저장되지 않는다는 점과 To-do API의 개인 전용 범위를 반영했다. |
| [07](./07-implementation-plan-c.md) | `docs/implementation/notive-implementation-plan-c-document-management-v1.0.md` | C단계 문서 관리 계획에서 부서 공유 범위를 제거하고 Admin 권한을 정정했다. |
| [08](./08-implementation-plan-d.md) | `docs/implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md` | D단계 AI 문서 생성 계획의 데이터 모델을 메타데이터 전용으로 줄였다. |
| [09](./09-implementation-plan-e.md) | `docs/implementation/notive-implementation-plan-e-work-context-v1.0.md` | E단계 업무 맥락 계획의 To-do 모델을 개인 전용으로 정정했다. |

## 이 보고서들이 다루지 않는 것

- 협업 가이드 변경(`CLAUDE.md`, `CODEX.md`)은 제품 문서가 아니므로 별도 보고서로 작성하지 않았다.
- B단계 이후 작업 중 발생한 변경은 다음 단계 보고서에서 다룬다.

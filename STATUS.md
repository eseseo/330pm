# Project Status

기준 시각: 2026-03-16

## 현재 상태

`3:30` MVP 핵심 흐름 완성. 코드 품질과 완성도 전반 개선 완료.

## 구현 완료

- 홈 화면 UI 및 홈 피드 API
- 종목 검색 API와 검색 UI
- 종목 상세 페이지
- 장 마감 후 익명 한마디 작성
- 공감 기능
- 감정 태그 선택
- 장중 읽기 전용 / 마감 후 작성 가능 정책
- 시간당 작성 제한, 중복 글 제한, 링크 차단
- 익명 쿠키 기반 해시 처리
- Supabase 테이블 및 기본 인덱스 구성
- 시드 데이터 (주식 11개 + 게시글 24개 + 반응)

## 2026-03-16 개선 내용

### 버그 픽스
- **Privacy 버그 수정**: `app/api/stocks/[stockId]/route.ts`에서 `select("*")`로 `anonymous_writer_hash`가 클라이언트에 노출되던 문제 수정 → 필요한 컬럼만 명시적으로 선택

### 코드 품질
- **중복 로직 제거**: `SENTIMENT_GROUPS`와 `bestLineScore`가 두 API 라우트에 복붙되어 있던 것을 `lib/scoring.ts`로 추출하여 단일 출처(SSOT) 확보
- **홈 피드 API 쿼리 최적화**: 3개 병렬 쿼리 → 2개로 축소 (mention source와 recent posts를 단일 쿼리로 통합)

### 기능 완성
- **Surge(Momentum) 섹션 구현**: `change_rate >= 3% 또는 <= -3%` 조건의 KR 종목을 언급 수와 함께 표시. 기존 하드코딩 `[]` 제거
- **공감 카운트 원자성 개선**: `increment_post_empathy` PostgreSQL RPC 추가 (`supabase/schema.sql`). 배포 시 RPC가 없으면 fallback 동작으로 안전하게 처리
- **시드 데이터 보강**: 주식 5개 추가 (카카오, 현대차, 셀트리온, MSFT, META) + 게시글 24개 + 반응 시드

### UX 개선
- **검색 debounce**: 키 입력마다 API 호출하던 문제 → 280ms debounce 적용 (AbortController와 조합)
- **Textarea 자동 크기 조절**: 고정 높이 56px → 내용에 따라 자동 확장 (useEffect + scrollHeight)
- **로딩 스켈레톤**: 홈 피드 로딩 중 pulse 애니메이션 카드 표시 (기존 "Loading..." 텍스트 대체)
- **종목 상세 로딩 스켈레톤**: `LoadingSkeleton` 컴포넌트 추가

## 남은 작업

- `supabase/schema.sql`의 `increment_post_empathy` RPC를 Supabase Dashboard에서 실행
- 실제 배포 환경에서 작성/공감 end-to-end 확인
- 삭제/숨김/신고 등 운영용 moderation 흐름 (optional)
- 주가 데이터 정기 업데이트 자동화 (`scripts/update_stock_prices.py` 활용)

## 우선순위

1. Supabase에서 RPC 함수 실행 (schema.sql 참고)
2. 시드 데이터 Supabase에 반영
3. 배포 전 최종 QA

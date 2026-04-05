# 3:30 MVP

**3:30은 장중에 떠드는 곳이 아니라, 장마감 후 종목에 한마디 남기는 곳입니다.**

한국 투자자를 위한 한국어 기반 웹앱 MVP로, 한국주식/미국주식 종목 페이지에서 마감 후 익명 한마디를 남기고 공감할 수 있습니다.

## 구현 범위

- 종목 검색
- 종목별 페이지
- 종목 페이지 상단 최근 종가/등락률 표시 (KR만)
- 장 마감 후 한마디 작성 (장중 읽기 전용)
- 글자 수 120자 제한
- 감정 태그(선택)
- 완전 익명 노출 + 내부 abuse 방지 해시
- 공감 기능
- 종목별 글 목록 (최신순/공감순)
- 홈 피드
  - 오늘의 한마디
  - 많이 언급된 종목 (KR/US)
  - 공감 많이 받은 글
  - 최근 마감 시장 정보

## 기술 스택

- Next.js (App Router + TypeScript)
- Tailwind CSS
- Supabase
- Vercel 배포 기준

## 로컬 실행

1. 의존성 설치

```bash
npm install
```

2. 환경 변수 설정

```bash
cp .env.example .env.local
```

`.env.local` 예시:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ANON_HASH_SALT=some-random-secret
```

- `SUPABASE_SERVICE_ROLE_KEY`는 쓰기 API에서 우선 사용됩니다.
- 키가 없으면 MVP에서는 anon key로 폴백 시도합니다.
- anon role에 INSERT/UPDATE 권한이 없으면 저장이 실패하므로, 로컬 개발에서는 service role key 설정을 권장합니다.

3. Supabase SQL 실행

- [`supabase/schema.sql`](./supabase/schema.sql) 실행
- [`supabase/seed.sql`](./supabase/seed.sql) 실행 (샘플 종목)

4. 개발 서버 실행

```bash
npm run dev
```

브라우저: `http://localhost:3000`

## 시간 정책

- 한국 종목: 평일 09:00~15:30(KST) 장중 작성 금지
- 미국 종목: 평일 09:30~16:00(ET, DST 자동 반영) 장중 작성 금지
- 장중에는 읽기 전용, 마감 후 작성 가능
- `market_sessions` 데이터가 있으면 해당 세션을 우선 사용
- 세션 데이터가 없으면 앱이 평일 기본 장시간 규칙으로 폴백

## 세션 운영

기본 세션 시드는 `supabase/seed.sql`에 포함되어 있습니다.

향후 45일 기본 세션 생성:

```bash
npm run sessions:update
```

옵션 예시:

```bash
python3 scripts/update_market_sessions.py --start 2026-03-21 --days 90
```

휴장일/조기폐장 오버라이드는 [market_calendar_overrides.json](/Users/jy/projects/3-30/scripts/market_calendar_overrides.json)에서 관리합니다.

형식:

```json
{
  "markets": {
    "KR": {
      "closed_dates": ["2026-05-05"],
      "early_closes": {
        "2026-12-31": "13:00"
      }
    },
    "US": {
      "closed_dates": ["2026-11-26"],
      "early_closes": {
        "2026-11-27": "13:00"
      }
    }
  }
}
```

주의:

- 현재 스크립트는 평일 기본 세션만 생성합니다.
- 공휴일, 조기 폐장, 임시 휴장은 오버라이드 파일로 반영합니다.
- 오버라이드 파일을 비워두면 평일 기본 세션만 생성됩니다.

## 도배/스팸 방지

- 시간당 작성 횟수 제한
- 동일 종목 동일 내용 24시간 재등록 제한
- 링크 첨부 차단
- 일일 공감 요청 제한
- 중복 공감 방지

## 폴더 구조

```text
3-30/
├─ app/
│  ├─ api/
│  │  ├─ feed/home/route.ts
│  │  ├─ posts/[id]/empathy/route.ts
│  │  └─ stocks/
│  │     ├─ search/route.ts
│  │     └─ [stockId]/
│  │        ├─ route.ts
│  │        └─ posts/route.ts
│  ├─ components/
│  │  ├─ home-client.tsx
│  │  └─ stock-client.tsx
│  ├─ stocks/[stockId]/page.tsx
│  ├─ globals.css
│  ├─ layout.tsx
│  └─ page.tsx
├─ lib/
│  ├─ anon.ts
│  ├─ constants.ts
│  ├─ env.ts
│  ├─ market.ts
│  ├─ spam.ts
│  ├─ supabase.ts
│  └─ types.ts
├─ supabase/
│  ├─ schema.sql
│  └─ seed.sql
├─ .env.example
└─ README.md
```

## 배포 (Vercel)

1. Git 저장소를 Vercel에 연결
2. Vercel Project Settings에 `.env.local`과 동일한 환경 변수 등록
3. 배포

## 운영 메모

- `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용이며 클라이언트에 노출하면 안 됩니다.
- 공감 카운트는 SQL 함수 기반으로 원자 처리됩니다.
- `market_sessions`를 운영하면 휴장일/특별 세션을 앱 정책에 직접 반영할 수 있습니다.
- 미국 종목은 현재 가격/등락률을 노출하지 않습니다.

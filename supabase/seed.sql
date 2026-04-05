-- Seed stocks
insert into public.stocks (symbol, name, market_type, exchange, last_close, change_rate)
values
  ('005930', '삼성전자',   'KR', 'KRX',   186200,  4.37),
  ('000660', 'SK하이닉스', 'KR', 'KRX',   186500, -0.82),
  ('035420', 'NAVER',     'KR', 'KRX',   211000,  0.48),
  ('035720', '카카오',    'KR', 'KRX',    47600, -1.34),
  ('005380', '현대차',    'KR', 'KRX',   214500,  3.12),
  ('068270', '셀트리온',  'KR', 'KRX',   176000, -2.50),
  ('TSLA',   'Tesla',     'US', 'NASDAQ', 172.63, -2.15),
  ('NVDA',   'NVIDIA',    'US', 'NASDAQ', 903.56,  1.74),
  ('AAPL',   'Apple',     'US', 'NASDAQ', 191.25,  0.31),
  ('MSFT',   'Microsoft', 'US', 'NASDAQ', 417.80,  0.92),
  ('META',   'Meta',      'US', 'NASDAQ', 502.40,  4.35)
on conflict (symbol, market_type) do nothing;

-- Seed posts (references stocks by symbol via CTE)
with stock_ids as (
  select symbol, market_type, id from public.stocks
)
insert into public.posts (stock_id, content, emotion_tag, anonymous_writer_hash, market_date, market_type, empathy_count)
select s.id, p.content, p.emotion_tag, p.hash, p.market_date::date, p.market_type, p.empathy_count
from (values
  -- 삼성전자
  ('005930', 'KR', '반도체 사이클 반등 시작이다',       '확신',    'seed_h01', '2026-03-13', 18),
  ('005930', 'KR', '20만 안착하면 20만 후반도 열릴 수 있다', '상승예상', 'seed_h02', '2026-03-13', 12),
  ('005930', 'KR', '변동성 너무 커서 지금 추격은 좀 무섭다',  '후회',    'seed_h03', '2026-03-13',  9),
  ('005930', 'KR', 'HBM 수혜 본격화되면 20만 위도 다시 본다','확신',   'seed_h04', '2026-03-12',  7),
  -- SK하이닉스
  ('000660', 'KR', 'AI 수요 꺾이면 얘가 제일 먼저 빠짐', '불안',   'seed_h05', '2026-03-13', 15),
  ('000660', 'KR', '엔비디아 실적 좋으면 연동해서 오를 것', '상승예상', 'seed_h06', '2026-03-13', 11),
  ('000660', 'KR', '20만 돌파하면 물량 절반 던진다',    '확신',    'seed_h07', '2026-03-13',  5),
  -- NAVER
  ('035420', 'KR', '커머스 성장률 둔화가 너무 걱정된다', '불안',    'seed_h08', '2026-03-13',  8),
  ('035420', 'KR', '하이퍼클로바X 기업 도입이 변수다',  '상승예상', 'seed_h09', '2026-03-13',  6),
  -- 카카오
  ('035720', 'KR', '지배구조 리스크 언제 끝나냐',       '분노',    'seed_h10', '2026-03-13', 21),
  ('035720', 'KR', '3만원대 오면 조금씩 모아볼 생각',   '불안',    'seed_h11', '2026-03-13',  4),
  -- 현대차
  ('005380', 'KR', '미국 공장 가동 시작하면 다시 본다', '상승예상', 'seed_h12', '2026-03-13', 13),
  ('005380', 'KR', '전기차 캐즘이 오히려 기회다',       '확신',    'seed_h13', '2026-03-13',  9),
  -- 셀트리온
  ('068270', 'KR', '바이오시밀러 미국 점유율 올라간다', '상승예상', 'seed_h14', '2026-03-13',  7),
  ('068270', 'KR', '2분기까지 더 빠질 수도 있음',       '끝났다',  'seed_h15', '2026-03-13',  3),
  -- TSLA
  ('TSLA',   'US', 'FSD 유료화가 진짜 게임체인저다',    '상승예상', 'seed_h16', '2026-03-13', 10),
  ('TSLA',   'US', '사이버트럭 리콜 악재 과도하게 반영', '확신',   'seed_h17', '2026-03-13',  8),
  ('TSLA',   'US', 'Musk 리스크가 너무 크다',           '불안',    'seed_h18', '2026-03-13', 16),
  -- NVDA
  ('NVDA',   'US', 'Blackwell 수요 여전히 공급 못 따라감','확신',   'seed_h19', '2026-03-13', 24),
  ('NVDA',   'US', '1000 넘으면 분할매수 멈춘다',        '후회',   'seed_h20', '2026-03-13',  6),
  -- AAPL
  ('AAPL',   'US', 'iPhone 17 사이클 기대 이하면 실망매물', '불안', 'seed_h21', '2026-03-13',  9),
  ('AAPL',   'US', '인도 생산 확대로 관세 리스크 헤지됨','확신',   'seed_h22', '2026-03-13',  5),
  -- META
  ('META',   'US', 'Ray-Ban 판매 폭발적이다 메타버스 드디어', '상승예상', 'seed_h23', '2026-03-13', 14),
  ('META',   'US', '광고 단가 계속 오른다 실적 문제없음', '확신',  'seed_h24', '2026-03-13', 11)
) as p(symbol, market_type, content, emotion_tag, hash, market_date, empathy_count)
join stock_ids s on s.symbol = p.symbol and s.market_type = p.market_type
on conflict do nothing;

-- Seed reactions (attach to the highest-empathy posts via CTE)
with target_posts as (
  select p.id, row_number() over (order by p.empathy_count desc) as rn
  from public.posts p
  where p.anonymous_writer_hash like 'seed_h%'
  limit 10
)
insert into public.reactions (post_id, reaction_type, session_hash)
select
  tp.id,
  'empathy',
  'seed_reaction_' || tp.rn || '_' || gs.n
from target_posts tp
cross join (
  select generate_series(1, 5) as n
) gs
on conflict do nothing;

-- Seed market sessions (sample weekdays only)
insert into public.market_sessions (market_type, session_date, write_open_at, write_close_at, is_write_open)
values
  ('KR', '2026-03-13', '2026-03-13T06:30:00Z', '2026-03-14T00:00:00Z', true),
  ('KR', '2026-03-16', '2026-03-16T06:30:00Z', '2026-03-17T00:00:00Z', true),
  ('KR', '2026-03-17', '2026-03-17T06:30:00Z', '2026-03-18T00:00:00Z', true),
  ('US', '2026-03-13', '2026-03-13T20:00:00Z', '2026-03-14T13:30:00Z', true),
  ('US', '2026-03-16', '2026-03-16T20:00:00Z', '2026-03-17T13:30:00Z', true),
  ('US', '2026-03-17', '2026-03-17T20:00:00Z', '2026-03-18T13:30:00Z', true)
on conflict (market_type, session_date) do update
set
  write_open_at = excluded.write_open_at,
  write_close_at = excluded.write_close_at,
  is_write_open = excluded.is_write_open;

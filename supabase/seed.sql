-- Seed stocks
insert into public.stocks (symbol, name, market_type, exchange, last_close, change_rate)
values
  ('005930', '삼성전자',   'KR', 'KRX',   186200,  4.37),
  ('000660', 'SK하이닉스', 'KR', 'KRX',   186500, -0.82),
  ('035420', 'NAVER',     'KR', 'KRX',   211000,  0.48),
  ('035720', '카카오',    'KR', 'KRX',    47600, -1.34),
  ('005380', '현대차',    'KR', 'KRX',   214500,  3.12),
  ('068270', '셀트리온',  'KR', 'KRX',   176000, -2.50),
  ('069500', 'KODEX 200', 'KR', 'KRX',    39250,  1.12),
  ('122630', 'KODEX 레버리지', 'KR', 'KRX', 16340,  2.21),
  ('114800', 'KODEX 인버스', 'KR', 'KRX',   4325, -1.10),
  ('252670', 'KODEX 200선물인버스2X', 'KR', 'KRX', 2760, -2.35),
  ('360750', 'TIGER 미국S&P500', 'KR', 'KRX', 19865, 0.94),
  ('133690', 'TIGER 미국나스닥100', 'KR', 'KRX', 12040, 1.38),
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
  ('005930', 'KR', 'HBM 기대가 유지되면 20만 초반은 지지 가능해 보인다', '확신',    'seed_h01', '2026-04-07', 18),
  ('005930', 'KR', '외국인 수급만 붙으면 20만 후반 재도전도 가능하다',   '상승예상', 'seed_h02', '2026-04-07', 12),
  ('005930', 'KR', '단기 급등 뒤라 19만 초반 눌림은 열어둬야 한다',      '후회',    'seed_h03', '2026-04-07',  9),
  ('005930', 'KR', '파운드리보다 메모리 업황 회복이 주가를 더 끌고 간다','확신',   'seed_h04', '2026-04-07',  7),
  -- SK하이닉스
  ('000660', 'KR', '고점 부담은 있지만 HBM 모멘텀이 쉽게 꺾일 구간은 아니다', '불안',   'seed_h05', '2026-04-07', 15),
  ('000660', 'KR', '엔비디아 주문 흐름 살아 있으면 실적 추정치도 더 올라갈 수 있다', '상승예상', 'seed_h06', '2026-04-07', 11),
  ('000660', 'KR', '20만 부근에서는 차익 매물 나와도 추세는 아직 위쪽이다', '확신',    'seed_h07', '2026-04-07',  5),
  -- NAVER
  ('035420', 'KR', '광고보다 커머스 회복 속도가 주가 반등의 핵심이다', '불안',    'seed_h08', '2026-04-07',  8),
  ('035420', 'KR', 'AI 서비스 매출이 숫자로 찍히면 밸류 재평가 가능하다', '상승예상', 'seed_h09', '2026-04-07',  6),
  -- 카카오
  ('035720', 'KR', '실적보다 지배구조 할인 해소가 먼저 보여야 반등이 나온다', '분노',    'seed_h10', '2026-04-07', 21),
  ('035720', 'KR', '콘텐츠보다 광고 체력 회복이 먼저 확인돼야 들어갈 수 있다', '불안',    'seed_h11', '2026-04-07',  4),
  -- 현대차
  ('005380', 'KR', '하이브리드 수요가 계속 버텨주면 이익 체력은 생각보다 강하다', '상승예상', 'seed_h12', '2026-04-07', 13),
  ('005380', 'KR', '주주환원 기대가 붙는 구간이라면 재평가 여지도 남아 있다',       '확신',    'seed_h13', '2026-04-07',  9),
  -- 셀트리온
  ('068270', 'KR', '미국 처방 데이터만 따라오면 숫자로 확인될 구간이 온다', '상승예상', 'seed_h14', '2026-04-07',  7),
  ('068270', 'KR', '실적 확인 전까지는 변동성 큰 흐름을 버텨야 한다',       '끝났다',  'seed_h15', '2026-04-07',  3),
  -- 추가 KR 샘플
  ('005930', 'KR', '배당 기대보다는 메모리 회복 기대가 주가를 더 세게 움직인다', '상승예상', 'seed_h25', '2026-04-07', 10),
  ('000660', 'KR', 'HBM 증설 뉴스 한 번 더 나오면 신고가 시도도 가능하다',    '확신',    'seed_h26', '2026-04-07',  8),
  ('035420', 'KR', '검색 점유율보다 광고 단가 방어가 훨씬 더 중요해 보인다',   '불안',    'seed_h27', '2026-04-07',  5),
  ('005380', 'KR', '완성차 중에서는 실적 가시성이 제일 편한 쪽이다',          '확신',    'seed_h28', '2026-04-07',  6),
  ('068270', 'KR', '단기 실망 매물은 나와도 중장기 파이프라인 기대는 살아 있다', '상승예상', 'seed_h29', '2026-04-07',  4),
  ('035720', 'KR', '반등 나오더라도 이벤트성인지 체질 개선인지 구분해야 한다',   '분노',    'seed_h30', '2026-04-07',  5),
  -- ETF
  ('122630', 'KR', '장 막판까지 수급 붙으면 지수보다 두 배로 탄력이 붙는다',   '확신',    'seed_h31', '2026-04-07',  9),
  ('252670', 'KR', '지수 밀릴 때는 결국 곱버스 거래대금이 심리를 먼저 보여준다', '불안',    'seed_h32', '2026-04-07',  7),
  ('069500', 'KR', '애매한 장에서는 결국 KODEX 200이 제일 무난한 선택이다',    '상승예상', 'seed_h33', '2026-04-07',  6),
  ('114800', 'KR', '하락 베팅은 짧게 보고 아니면 빨리 접는 게 맞다',          '후회',    'seed_h34', '2026-04-07',  5),
  ('360750', 'KR', '환율 흔들려도 장기 적립은 결국 S&P500으로 모인다',        '확신',    'seed_h35', '2026-04-07',  8),
  ('133690', 'KR', '나스닥 눌릴 때마다 분할로 모으는 사람이 꾸준히 붙는다',     '상승예상', 'seed_h36', '2026-04-07',  7),
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
  ('KR', '2026-04-07', '2026-04-07T06:30:00Z', '2026-04-08T00:00:00Z', true),
  ('KR', '2026-04-08', '2026-04-08T06:30:00Z', '2026-04-09T00:00:00Z', true),
  ('KR', '2026-04-09', '2026-04-09T06:30:00Z', '2026-04-10T00:00:00Z', true),
  ('US', '2026-03-13', '2026-03-13T20:00:00Z', '2026-03-14T13:30:00Z', true),
  ('US', '2026-03-16', '2026-03-16T20:00:00Z', '2026-03-17T13:30:00Z', true),
  ('US', '2026-03-17', '2026-03-17T20:00:00Z', '2026-03-18T13:30:00Z', true)
on conflict (market_type, session_date) do update
set
  write_open_at = excluded.write_open_at,
  write_close_at = excluded.write_close_at,
  is_write_open = excluded.is_write_open;

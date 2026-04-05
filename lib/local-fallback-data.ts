import type { HomeFeed, MarketStatus, MarketType, MentionedStock, Post, Stock } from "@/lib/types";
import { SENTIMENT_GROUPS, bestLineScore, sentimentCounts } from "@/lib/scoring";

export const FALLBACK_STOCKS: Stock[] = [
  { id: "kr-005930", symbol: "005930", name: "삼성전자", market_type: "KR", exchange: "KRX", last_close: 186200, change_rate: 4.37 },
  { id: "kr-000660", symbol: "000660", name: "SK하이닉스", market_type: "KR", exchange: "KRX", last_close: 186500, change_rate: -0.82 },
  { id: "kr-035420", symbol: "035420", name: "NAVER", market_type: "KR", exchange: "KRX", last_close: 211000, change_rate: 0.48 },
  { id: "kr-035720", symbol: "035720", name: "카카오", market_type: "KR", exchange: "KRX", last_close: 47600, change_rate: -1.34 },
  { id: "kr-005380", symbol: "005380", name: "현대차", market_type: "KR", exchange: "KRX", last_close: 214500, change_rate: 3.12 },
  { id: "kr-068270", symbol: "068270", name: "셀트리온", market_type: "KR", exchange: "KRX", last_close: 176000, change_rate: -2.5 },
  { id: "us-tsla", symbol: "TSLA", name: "Tesla", market_type: "US", exchange: "NASDAQ", last_close: 172.63, change_rate: -2.15 },
  { id: "us-nvda", symbol: "NVDA", name: "NVIDIA", market_type: "US", exchange: "NASDAQ", last_close: 903.56, change_rate: 1.74 },
  { id: "us-aapl", symbol: "AAPL", name: "Apple", market_type: "US", exchange: "NASDAQ", last_close: 191.25, change_rate: 0.31 },
  { id: "us-msft", symbol: "MSFT", name: "Microsoft", market_type: "US", exchange: "NASDAQ", last_close: 417.8, change_rate: 0.92 },
  { id: "us-meta", symbol: "META", name: "Meta", market_type: "US", exchange: "NASDAQ", last_close: 502.4, change_rate: 4.35 },
];

function stockBySymbol(symbol: string, market: MarketType) {
  return FALLBACK_STOCKS.find((stock) => stock.symbol === symbol && stock.market_type === market)!;
}

export const FALLBACK_POSTS: Post[] = [
  { id: "post-1", stock_id: "kr-005930", content: "반도체 사이클 반등 시작이다", emotion_tag: "확신", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T18:00:00Z", empathy_count: 18, stock: stockBySymbol("005930", "KR") },
  { id: "post-2", stock_id: "kr-005930", content: "20만 안착하면 20만 후반도 열릴 수 있다", emotion_tag: "상승예상", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T17:10:00Z", empathy_count: 12, stock: stockBySymbol("005930", "KR") },
  { id: "post-3", stock_id: "kr-005930", content: "변동성 너무 커서 지금 추격은 좀 무섭다", emotion_tag: "후회", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T16:20:00Z", empathy_count: 9, stock: stockBySymbol("005930", "KR") },
  { id: "post-4", stock_id: "kr-000660", content: "AI 수요 꺾이면 얘가 제일 먼저 빠짐", emotion_tag: "불안", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T18:20:00Z", empathy_count: 15, stock: stockBySymbol("000660", "KR") },
  { id: "post-5", stock_id: "kr-000660", content: "엔비디아 실적 좋으면 연동해서 오를 것", emotion_tag: "상승예상", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T17:45:00Z", empathy_count: 11, stock: stockBySymbol("000660", "KR") },
  { id: "post-6", stock_id: "kr-035420", content: "커머스 성장률 둔화가 너무 걱정된다", emotion_tag: "불안", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T17:30:00Z", empathy_count: 8, stock: stockBySymbol("035420", "KR") },
  { id: "post-7", stock_id: "kr-035720", content: "지배구조 리스크 언제 끝나냐", emotion_tag: "분노", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T18:30:00Z", empathy_count: 21, stock: stockBySymbol("035720", "KR") },
  { id: "post-8", stock_id: "kr-005380", content: "미국 공장 가동 시작하면 다시 본다", emotion_tag: "상승예상", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T17:40:00Z", empathy_count: 13, stock: stockBySymbol("005380", "KR") },
  { id: "post-9", stock_id: "kr-068270", content: "바이오시밀러 미국 점유율 올라간다", emotion_tag: "상승예상", market_type: "KR", market_date: "2026-03-13", created_at: "2026-03-13T16:50:00Z", empathy_count: 7, stock: stockBySymbol("068270", "KR") },
  { id: "post-10", stock_id: "us-tsla", content: "FSD 유료화가 진짜 게임체인저다", emotion_tag: "상승예상", market_type: "US", market_date: "2026-03-13", created_at: "2026-03-13T22:00:00Z", empathy_count: 10, stock: stockBySymbol("TSLA", "US") },
  { id: "post-11", stock_id: "us-tsla", content: "Musk 리스크가 너무 크다", emotion_tag: "불안", market_type: "US", market_date: "2026-03-13", created_at: "2026-03-13T23:00:00Z", empathy_count: 16, stock: stockBySymbol("TSLA", "US") },
  { id: "post-12", stock_id: "us-nvda", content: "Blackwell 수요 여전히 공급 못 따라감", emotion_tag: "확신", market_type: "US", market_date: "2026-03-13", created_at: "2026-03-13T22:30:00Z", empathy_count: 24, stock: stockBySymbol("NVDA", "US") },
  { id: "post-13", stock_id: "us-aapl", content: "iPhone 17 사이클 기대 이하면 실망매물", emotion_tag: "불안", market_type: "US", market_date: "2026-03-13", created_at: "2026-03-13T21:30:00Z", empathy_count: 9, stock: stockBySymbol("AAPL", "US") },
  { id: "post-14", stock_id: "us-meta", content: "Ray-Ban 판매 폭발적이다 메타버스 드디어", emotion_tag: "상승예상", market_type: "US", market_date: "2026-03-13", created_at: "2026-03-13T22:45:00Z", empathy_count: 14, stock: stockBySymbol("META", "US") },
];

function latestDate(market: MarketType) {
  return FALLBACK_POSTS.filter((post) => post.market_type === market)
    .map((post) => post.market_date ?? "")
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function topMentioned(market: MarketType): MentionedStock[] {
  const bucket = new Map<string, { stock: MentionedStock; posts: Post[] }>();
  for (const post of FALLBACK_POSTS) {
    if (post.market_type !== market || !post.stock) continue;
    const prev = bucket.get(post.stock.id);
    if (prev) {
      prev.posts.push(post);
      continue;
    }
    bucket.set(post.stock.id, {
      stock: {
        ...post.stock,
        line_count: 0,
        bullish_count: 0,
        bearish_count: 0,
        neutral_count: 0,
        dominant_ratio: 0,
        sentiment_tone: "mixed",
      },
      posts: [post],
    });
  }
  return [...bucket.values()]
    .map(({ stock, posts }) => ({ ...stock, ...sentimentCounts(posts) }))
    .sort((a, b) => b.line_count - a.line_count || b.dominant_ratio - a.dominant_ratio || a.name.localeCompare(b.name, "ko"))
    .slice(0, 10);
}

function marketSentiment(market: MarketType) {
  const scoped = FALLBACK_POSTS.filter((post) => post.market_type === market && post.emotion_tag);
  const total = scoped.length;
  return Object.entries(SENTIMENT_GROUPS)
    .map(([tag, sourceTags]) => {
      const count = scoped.filter((post) => post.emotion_tag && sourceTags.includes(post.emotion_tag)).length;
      return { tag, count, ratio: total > 0 ? Math.round((count / total) * 100) : 0 };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}

export function fallbackSearchStocks(query: string, market: "ALL" | MarketType) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FALLBACK_STOCKS.filter((stock) => {
    if (market !== "ALL" && stock.market_type !== market) return false;
    return stock.name.toLowerCase().includes(q) || stock.symbol.toLowerCase().includes(q);
  })
    .sort((a, b) => {
      const aStarts = Number(a.name.startsWith(query) || a.symbol.startsWith(query.toUpperCase()));
      const bStarts = Number(b.name.startsWith(query) || b.symbol.startsWith(query.toUpperCase()));
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.name.localeCompare(b.name, "ko");
    })
    .slice(0, 20);
}

export function fallbackHomeFeed(marketStatus: Record<MarketType, MarketStatus>): HomeFeed {
  const krPosts = FALLBACK_POSTS.filter((post) => post.market_type === "KR");
  const hotLines = [...krPosts].sort((a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 9);
  const quoteOfTheDay = hotLines[0] ?? null;
  return {
    quoteOfTheDay,
    topMentionedKR: topMentioned("KR"),
    topMentionedUS: [],
    hotLines,
    recentlyClosedMarket: "KR",
    quoteDate: quoteOfTheDay?.market_date ?? null,
    quoteIsFallback: true,
    topMentionedKRDate: latestDate("KR"),
    topMentionedUSDate: null,
    marketSentimentKR: marketSentiment("KR"),
    marketSentimentUS: [],
    marketStatus,
  };
}

export function cloneFallbackStocks() {
  return FALLBACK_STOCKS.map((stock) => ({ ...stock }));
}

export function cloneFallbackPosts() {
  return FALLBACK_POSTS.map((post) => ({
    ...post,
    stock: post.stock ? { ...post.stock } : undefined,
  }));
}

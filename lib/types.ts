export type MarketType = "KR" | "US";

export type Stock = {
  id: string;
  symbol: string;
  name: string;
  market_type: MarketType;
  exchange: string;
  last_close?: number | null;
  change_rate?: number | null;
};

export type Post = {
  id: string;
  stock_id: string;
  content: string;
  emotion_tag: string | null;
  market_type: MarketType;
  market_date?: string;
  created_at: string;
  empathy_count: number;
  stock?: Pick<Stock, "id" | "symbol" | "name" | "market_type">;
};

export type MentionedStock = Pick<Stock, "id" | "symbol" | "name" | "market_type"> & {
  line_count: number;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  dominant_ratio: number;
  sentiment_tone: "bullish" | "bearish" | "mixed";
  change_rate?: number | null;
};

export type EmotionDistribution = {
  tag: string;
  count: number;
  ratio: number;
};

export type MarketSentiment = EmotionDistribution;

export type SentimentTag = "Bullish" | "Neutral" | "Bearish" | "Angry";

export type MarketStatus = {
  marketDate: string;
  isMarketOpen: boolean;
  writeOpen: boolean;
  stateMessage: string;
  source: "schedule" | "fallback";
};

export type HomeFeed = {
  quoteOfTheDay: Post | null;
  topMentionedKR: MentionedStock[];
  topMentionedUS: MentionedStock[];
  hotLines: Post[];
  recentlyClosedMarket: MarketType;
  quoteDate: string | null;
  quoteIsFallback: boolean;
  topMentionedKRDate: string | null;
  topMentionedUSDate: string | null;
  marketSentimentKR: MarketSentiment[];
  marketSentimentUS: MarketSentiment[];
  marketStatus: Record<MarketType, MarketStatus>;
};

export const EMOTION_TAGS = ["확신", "후회", "분노", "불안", "상승예상", "끝났다"] as const;

export type EmotionTag = (typeof EMOTION_TAGS)[number];

export const EMOTION_EMOJI: Record<EmotionTag, string> = {
  확신: "😎",
  후회: "😭",
  분노: "😡",
  불안: "😨",
  상승예상: "🚀",
  끝났다: "💀",
};

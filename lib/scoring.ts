import type { MentionedStock, Post, SentimentTag } from "@/lib/types";

export const SENTIMENT_GROUPS: Record<SentimentTag, string[]> = {
  Bullish: ["확신", "상승예상"],
  Neutral: ["후회"],
  Bearish: ["불안", "끝났다"],
  Angry: ["분노"],
};

export function bestLineScore(post: Post, nowMs = Date.now()): number {
  const ageHours = Math.max((nowMs - new Date(post.created_at).getTime()) / (1000 * 60 * 60), 0);
  const timeDecayBoost = Math.max(24 - ageHours, 0) / 24;
  return post.empathy_count + timeDecayBoost;
}

export function sentimentCounts(posts: Array<Pick<Post, "emotion_tag">>) {
  const bullish_count = posts.filter((post) => post.emotion_tag && SENTIMENT_GROUPS.Bullish.includes(post.emotion_tag)).length;
  const bearish_count = posts.filter(
    (post) => post.emotion_tag && (SENTIMENT_GROUPS.Bearish.includes(post.emotion_tag) || SENTIMENT_GROUPS.Angry.includes(post.emotion_tag)),
  ).length;
  const neutral_count = posts.filter((post) => post.emotion_tag && SENTIMENT_GROUPS.Neutral.includes(post.emotion_tag)).length;
  const line_count = posts.length;
  const bullish_ratio = line_count > 0 ? Math.round((bullish_count / line_count) * 100) : 0;
  const bearish_ratio = line_count > 0 ? Math.round((bearish_count / line_count) * 100) : 0;
  const dominant_ratio = Math.max(bullish_ratio, bearish_ratio);
  const sentiment_tone: MentionedStock["sentiment_tone"] =
    bullish_ratio === bearish_ratio ? "mixed" : bullish_ratio > bearish_ratio ? "bullish" : "bearish";

  return {
    line_count,
    bullish_count,
    bearish_count,
    neutral_count,
    bullish_ratio,
    bearish_ratio,
    dominant_ratio,
    sentiment_tone,
  };
}

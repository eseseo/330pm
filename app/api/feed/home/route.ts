import { NextResponse } from "next/server";
import { fallbackHomeFeed } from "@/lib/local-fallback-data";
import { getAllMarketStatus } from "@/lib/market";
import { SENTIMENT_GROUPS, bestLineScore, sentimentCounts } from "@/lib/scoring";
import { serviceSupabase } from "@/lib/supabase";
import { type MarketSentiment, type MarketType, type MentionedStock, type Post, type SentimentTag } from "@/lib/types";


const POST_FIELDS =
  "id, stock_id, content, emotion_tag, market_type, market_date, created_at, empathy_count, stock:stocks!inner(id, symbol, name, market_type, is_active)";

type RawPostRow = {
  id: string;
  stock_id: string;
  content: string;
  emotion_tag: string | null;
  market_type: MarketType;
  market_date?: string | null;
  created_at: string;
  empathy_count: number;
  stock?:
    | { id: string; symbol: string; name: string; market_type?: MarketType; is_active?: boolean }
    | Array<{ id: string; symbol: string; name: string; market_type?: MarketType; is_active?: boolean }>
    | null;
};

function normalizePostRows(rows: RawPostRow[]): Post[] {
  return rows.map((row) => {
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    return {
      ...row,
      market_date: row.market_date ?? undefined,
      stock: stock
        ? {
            id: stock.id,
            symbol: stock.symbol,
            name: stock.name,
            market_type: (stock.market_type as MarketType | undefined) ?? row.market_type,
          }
        : undefined,
    };
  });
}

function latestAvailableDate(
  market: MarketType,
  rows: Array<{ market_type?: string | null; market_date?: string | null }>,
): string | null {
  const dates = rows
    .filter((row) => row.market_type === market && row.market_date)
    .map((row) => row.market_date as string)
    .sort((a, b) => b.localeCompare(a));
  return dates[0] ?? null;
}

function buildTopMentioned(
  market: MarketType,
  posts: Post[],
): MentionedStock[] {
  const bucket = new Map<string, { stock: MentionedStock; posts: Post[] }>();

  for (const post of posts) {
    if (post.market_type !== market || !post.stock) continue;
    const prev = bucket.get(post.stock.id);
    if (prev) {
      prev.posts.push(post);
      continue;
    }
    bucket.set(post.stock.id, {
      stock: {
        id: post.stock.id,
        symbol: post.stock.symbol,
        name: post.stock.name,
        market_type: market,
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
    .map(({ stock, posts: stockPosts }) => ({ ...stock, ...sentimentCounts(stockPosts) }))
    .sort((a, b) => b.line_count - a.line_count || b.dominant_ratio - a.dominant_ratio || a.name.localeCompare(b.name, "ko"))
    .slice(0, 10);
}

function buildMarketSentiment(posts: Post[], market: MarketType): MarketSentiment[] {
  const scoped = posts.filter((post) => post.market_type === market && post.emotion_tag);
  const total = scoped.length;

  return (Object.entries(SENTIMENT_GROUPS) as Array<[SentimentTag, string[]]>)
    .map(([tag, sourceTags]) => {
      const count = scoped.filter((post) => post.emotion_tag && sourceTags.includes(post.emotion_tag)).length;
      return {
        tag,
        count,
        ratio: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count || a.tag.localeCompare(b.tag, "en"));
}

function isCurrentMarketPost(
  post: Pick<Post, "market_type"> & { market_date?: string | null },
  currentDates: Record<MarketType, string>,
) {
  return post.market_date === currentDates[post.market_type];
}

function pickQuoteOfTheDay(
  posts: Array<Post & { market_date?: string | null }>,
  currentDates: Record<MarketType, string>,
  preferredMarket: MarketType,
) {
  const currentMarketPosts = posts
    .filter((post) => isCurrentMarketPost(post, currentDates))
    .sort((a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at));
  const preferredPost = currentMarketPosts.find((post) => post.market_type === preferredMarket);
  const fallbackMarketDate = latestAvailableDate(preferredMarket, posts);
  const fallbackPost =
    posts
      .filter((post) => post.market_type === preferredMarket && post.market_date === fallbackMarketDate)
      .sort((a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at))[0] ??
    null;

  return preferredPost ?? currentMarketPosts[0] ?? fallbackPost ?? posts[0] ?? null;
}

export async function GET() {
  const marketStatus = await getAllMarketStatus();
  const currentDates = {
    KR: marketStatus.KR.marketDate,
    US: marketStatus.US.marketDate,
  } satisfies Record<MarketType, string>;
  const preferredMarket: MarketType = "KR";
  const fallback = {
    ...fallbackHomeFeed(marketStatus),
  };

  try {
    const supabase = serviceSupabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const recentPostsRes = await supabase
      .from("posts")
      .select(POST_FIELDS)
      .eq("is_hidden", false)
      .is("deleted_at", null)
      .eq("market_type", "KR")
      .eq("stock.is_active", true)
      .order("created_at", { ascending: false })
      .gte("created_at", oneDayAgo)
      .limit(300);

    const fallbackPostsRes =
      recentPostsRes.error || (recentPostsRes.data?.length ?? 0) === 0
        ? await supabase
            .from("posts")
            .select(POST_FIELDS)
            .eq("is_hidden", false)
            .is("deleted_at", null)
            .eq("market_type", "KR")
            .eq("stock.is_active", true)
            .order("created_at", { ascending: false })
            .limit(300)
        : null;

    const sourceRows =
      !recentPostsRes.error && (recentPostsRes.data?.length ?? 0) > 0
        ? (recentPostsRes.data ?? [])
        : (fallbackPostsRes?.error ? [] : (fallbackPostsRes?.data ?? []));

    const sourcePosts = normalizePostRows(sourceRows);
    const hotLines = [...sourcePosts]
      .sort((a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 9);

    const quoteOfTheDay = pickQuoteOfTheDay(sourcePosts, currentDates, preferredMarket);
    const quoteIsFallback = quoteOfTheDay ? !isCurrentMarketPost(quoteOfTheDay, currentDates) : false;
    const topMentionedKRDate = latestAvailableDate("KR", sourceRows) ?? currentDates.KR;

    return NextResponse.json({
      quoteOfTheDay,
      topMentionedKR: buildTopMentioned("KR", sourcePosts),
      hotLines,
      recentlyClosedMarket: preferredMarket,
      quoteDate: quoteOfTheDay?.market_date ?? null,
      quoteIsFallback,
      topMentionedKRDate,
      marketSentimentKR: buildMarketSentiment(sourcePosts, "KR"),
      marketStatus,
    });
  } catch {
    return NextResponse.json(fallback);
  }
}

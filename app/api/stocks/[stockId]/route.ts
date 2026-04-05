import { NextResponse } from "next/server";
import { getMarketStatus } from "@/lib/market";
import { localStockPayload } from "@/lib/local-store";
import { SENTIMENT_GROUPS, bestLineScore } from "@/lib/scoring";
import { publicSupabase } from "@/lib/supabase";
import { type EmotionDistribution, type MarketType, type Post, type SentimentTag } from "@/lib/types";

export const dynamic = "force-dynamic";

async function fetchLivePrice(
  stock: { symbol: string; market_type: string },
): Promise<{ last_close: number; change_rate: number | null } | null> {
  if (stock.market_type !== "KR") return null;
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${encodeURIComponent(stock.symbol)}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data.closePrice?.replace(/,/g, "") ?? "");
    const changeRate = parseFloat(data.fluctuationsRatio ?? "");
    if (!isFinite(price)) return null;
    return { last_close: price, change_rate: isFinite(changeRate) ? changeRate : null };
  } catch {
    return null;
  }
}

const POST_FIELDS =
  "id, stock_id, content, emotion_tag, market_type, market_date, created_at, empathy_count";

function buildEmotionDistribution(posts: Post[]): EmotionDistribution[] {
  const total = posts.filter((post) => post.emotion_tag).length;

  return (Object.entries(SENTIMENT_GROUPS) as Array<[SentimentTag, string[]]>)
    .map(([tag, sourceTags]) => {
      const count = posts.filter((post) => post.emotion_tag && sourceTags.includes(post.emotion_tag)).length;
      const ratio = total > 0 ? Math.round((count / total) * 100) : 0;
      return { tag, count, ratio };
    })
    .filter((item) => item.count > 0);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ stockId: string }> },
) {
  const { stockId } = await context.params;
  try {
    const supabase = publicSupabase();

    const { data: stock, error: stockError } = await supabase
      .from("stocks")
      .select("id, symbol, name, market_type, exchange, last_close, change_rate")
      .eq("id", stockId)
      .single();

    if (stockError || !stock) {
      console.error("[stocks/:id] stock query failed", { stockId, stockError });
      return NextResponse.json(
        {
          error: "종목을 찾을 수 없습니다.",
          detail: stockError?.message ?? "stock_not_found",
          stock: null,
          posts: [],
        },
        { status: 404 },
      );
    }

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select(POST_FIELDS)
      .eq("stock_id", stockId)
      .is("deleted_at", null)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });

    let postsWarning: string | null = null;
    if (postsError) {
      console.error("[stocks/:id] posts query failed", { stockId, postsError });
      postsWarning = postsError.message ?? "posts_fetch_failed";
    }

    const livePrice = await fetchLivePrice({ symbol: stock.symbol, market_type: stock.market_type });
    if (livePrice) {
      stock.last_close = livePrice.last_close;
      stock.change_rate = livePrice.change_rate;
    }

    const market = stock.market_type as MarketType;
    const safePosts = postsError ? [] : ((posts ?? []) as Post[]);
    const status = await getMarketStatus(market);
    const representativePost =
      [...safePosts].sort(
        (a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at),
      )[0] ?? null;

    return NextResponse.json({
      stock,
      writeOpen: status.writeOpen,
      stateMessage: status.stateMessage,
      posts: safePosts,
      representativePost,
      emotionDistribution: buildEmotionDistribution(safePosts),
      postsWarning,
    });
  } catch (error) {
    console.error("[stocks/:id] unexpected error", { error });
    const status = await getMarketStatus("KR");
    const local = await localStockPayload(stockId, status);
    if (local) {
      return NextResponse.json(local);
    }
    return NextResponse.json({ error: "종목 데이터를 불러오지 못했습니다.", stock: null, posts: [] }, { status: 500 });
  }
}

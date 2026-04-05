import { NextRequest, NextResponse } from "next/server";
import { ANON_COOKIE, anonHash, getOrCreateAnonId } from "@/lib/anon";
import { MAX_POST_LENGTH, POST_LIMIT_PER_STOCK_PER_DAY } from "@/lib/constants";
import { containsBlockedKeyword, getClientIp, hitRateLimit, rejectTooFastRequest } from "@/lib/abuse";
import { localCreatePost } from "@/lib/local-store";
import { getMarketStatus } from "@/lib/market";
import { containsUrl } from "@/lib/spam";
import { writeSupabase } from "@/lib/supabase";
import { EMOTION_TAGS, type MarketType } from "@/lib/types";

type Body = {
  content?: string;
  emotionTag?: string | null;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ stockId: string }> },
) {
  const { stockId } = await context.params;
  const body = (await request.json()) as Body;
  const content = (body.content ?? "").trim();
  const emotionTag = body.emotionTag?.trim() || null;
  const clientIp = getClientIp(request);

  try {
    if (rejectTooFastRequest("post:create", clientIp)) {
      return NextResponse.json({ error: "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    if (hitRateLimit({ action: "post:create", ip: clientIp, limit: 3, windowMs: 60 * 1000 })) {
      return NextResponse.json({ error: "1분에 최대 3번까지만 작성 요청할 수 있습니다." }, { status: 429 });
    }

    if (content.length < 3 || content.length > MAX_POST_LENGTH) {
      return NextResponse.json(
        { error: `3자 이상 ${MAX_POST_LENGTH}자 이하로 작성해 주세요.` },
        { status: 400 },
      );
    }

    if (containsUrl(content) || containsBlockedKeyword(content)) {
      return NextResponse.json({ error: "링크 또는 제한된 단어는 입력할 수 없습니다." }, { status: 400 });
    }

    if (emotionTag && !EMOTION_TAGS.includes(emotionTag as (typeof EMOTION_TAGS)[number])) {
      return NextResponse.json({ error: "감정 태그가 올바르지 않습니다." }, { status: 400 });
    }

    const { client: supabase, usingServiceRole } = writeSupabase();
    const { data: stock, error: stockError } = await supabase
      .from("stocks")
      .select("id, market_type")
      .eq("id", stockId)
      .single();

    if (stockError || !stock) {
      return NextResponse.json({ error: "종목을 찾을 수 없습니다." }, { status: 404 });
    }

    const market = stock.market_type as MarketType;
    const status = await getMarketStatus(market);
    if (!status.writeOpen) {
      return NextResponse.json({ error: "장이 열려 있는 동안에는 작성할 수 없습니다." }, { status: 403 });
    }

    const { anonId, isNew } = getOrCreateAnonId(request);
    const writerHash = anonHash(anonId);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count, error: countError }, { data: dup, error: dupError }] = await Promise.all([
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("anonymous_writer_hash", writerHash)
        .eq("stock_id", stockId)
        .gte("created_at", oneDayAgo),
      supabase
        .from("posts")
        .select("id")
        .eq("anonymous_writer_hash", writerHash)
        .eq("stock_id", stockId)
        .eq("content", content)
        .gte("created_at", oneDayAgo)
        .limit(1),
    ]);

    if (countError || dupError) {
      return NextResponse.json({ error: "작성 제한을 확인하지 못했습니다." }, { status: 500 });
    }

    if ((count ?? 0) >= POST_LIMIT_PER_STOCK_PER_DAY) {
      return NextResponse.json(
        { error: "한 종목에는 24시간 동안 최대 3줄까지 작성할 수 있습니다." },
        { status: 429 },
      );
    }

    if ((dup ?? []).length > 0) {
      return NextResponse.json({ error: "같은 문장은 24시간 안에 다시 올릴 수 없습니다." }, { status: 409 });
    }

    const { data: post, error: insertError } = await supabase
      .from("posts")
      .insert({
        stock_id: stockId,
        content,
        emotion_tag: emotionTag,
        anonymous_writer_hash: writerHash,
        market_date: status.marketDate,
        market_type: market,
      })
      .select("id, stock_id, content, emotion_tag, market_type, created_at, empathy_count")
      .single();

    if (insertError || !post) {
      if (!usingServiceRole && insertError?.code === "42501") {
        return NextResponse.json(
          {
            error:
              "쓰기 권한이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 추가하거나 익명 insert 권한을 허용해 주세요.",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: "한줄 저장에 실패했습니다." }, { status: 500 });
    }

    const response = NextResponse.json({ post }, { status: 201 });
    if (isNew) {
      response.cookies.set(ANON_COOKIE, anonId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return response;
  } catch (error) {
    console.error("[stocks/:id/posts] unexpected error", { error });
    const marketType: MarketType = "KR";
    const status = await getMarketStatus("KR");
    if (!status.writeOpen) {
      return NextResponse.json({ error: "장이 열려 있는 동안에는 작성할 수 없습니다." }, { status: 403 });
    }
    const { anonId, isNew } = getOrCreateAnonId(request);
    const writerHash = anonHash(anonId);
    const created = await localCreatePost({
      stockId,
      content,
      emotionTag,
      writerHash,
      marketDate: status.marketDate,
      marketType,
    });
    if ("error" in created) {
      const createdError = created.error ?? "한줄 저장에 실패했습니다.";
      const statusCode =
        createdError.includes("최대 3줄") ? 429 : createdError.includes("같은 문장") ? 409 : 404;
      return NextResponse.json({ error: createdError }, { status: statusCode });
    }
    const response = NextResponse.json({ post: created.post }, { status: 201 });
    if (isNew) {
      response.cookies.set(ANON_COOKIE, anonId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  }
}

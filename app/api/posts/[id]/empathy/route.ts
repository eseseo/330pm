import { NextRequest, NextResponse } from "next/server";
import { ANON_COOKIE, anonHash, getOrCreateAnonId } from "@/lib/anon";
import { getClientIp, hasEmpathyByIp, hitRateLimit, markEmpathyByIp, rejectTooFastRequest } from "@/lib/abuse";
import { REACTION_LIMIT_PER_DAY } from "@/lib/constants";
import { localAddEmpathy } from "@/lib/local-store";
import { writeSupabase } from "@/lib/supabase";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const clientIp = getClientIp(request);
  try {
    if (rejectTooFastRequest("empathy:add", clientIp)) {
      return NextResponse.json({ error: "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    if (hitRateLimit({ action: "empathy:add", ip: clientIp, limit: 5, windowMs: 10 * 1000 })) {
      return NextResponse.json({ error: "공감 요청이 너무 많습니다." }, { status: 429 });
    }

    if (hasEmpathyByIp(clientIp, id)) {
      return NextResponse.json({ error: "이미 공감한 한줄입니다." }, { status: 409 });
    }

    const { anonId, isNew } = getOrCreateAnonId(request);
    const sessionHash = anonHash(anonId);
    const { client: supabase } = writeSupabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count, error: countError }, { data: duplicate, error: duplicateError }] = await Promise.all([
      supabase
        .from("reactions")
        .select("id", { count: "exact", head: true })
        .eq("session_hash", sessionHash)
        .gte("created_at", oneDayAgo),
      supabase
        .from("reactions")
        .select("id")
        .eq("post_id", id)
        .eq("session_hash", sessionHash)
        .eq("reaction_type", "empathy")
        .limit(1),
    ]);

    if (countError || duplicateError) {
      return NextResponse.json({ error: "공감 처리에 실패했습니다." }, { status: 500 });
    }

    if ((count ?? 0) >= REACTION_LIMIT_PER_DAY) {
      return NextResponse.json({ error: "공감 요청이 너무 많습니다." }, { status: 429 });
    }

    if ((duplicate ?? []).length > 0) {
      return NextResponse.json({ error: "이미 공감한 한줄입니다." }, { status: 409 });
    }

    const { data: empathyCount, error: rpcError } = await supabase.rpc("add_empathy_reaction", {
      p_post_id: id,
      p_session_hash: sessionHash,
    });

    if (rpcError) {
      if (rpcError.code === "42501") {
        return NextResponse.json(
          { error: "쓰기 권한이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 추가하거나 reactions 테이블의 익명 insert 권한을 허용해 주세요." },
          { status: 500 },
        );
      }
      if (rpcError.message?.includes("duplicate_reaction")) {
        return NextResponse.json({ error: "이미 공감한 한줄입니다." }, { status: 409 });
      }
      if (rpcError.message?.includes("post_not_found")) {
        return NextResponse.json({ error: "한줄을 찾을 수 없습니다." }, { status: 404 });
      }
      console.error("[posts/:id/empathy] rpc error", { code: rpcError.code, message: rpcError.message });
      return NextResponse.json({ error: "공감 저장에 실패했습니다.", detail: rpcError.message }, { status: 500 });
    }

    const response = NextResponse.json({ empathyCount });
    markEmpathyByIp(clientIp, id);
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
    console.error("[posts/:id/empathy] unexpected error", { error });
    const { anonId, isNew } = getOrCreateAnonId(request);
    const sessionHash = anonHash(anonId);
    const local = await localAddEmpathy({ postId: id, sessionHash });
    if ("error" in local) {
      const localError = local.error ?? "공감 처리에 실패했습니다.";
      const statusCode =
        localError.includes("이미 공감") ? 409 : localError.includes("너무 많") ? 429 : localError.includes("찾을 수 없") ? 404 : 500;
      return NextResponse.json({ error: localError }, { status: statusCode });
    }
    const response = NextResponse.json({ empathyCount: local.empathyCount });
    markEmpathyByIp(clientIp, id);
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

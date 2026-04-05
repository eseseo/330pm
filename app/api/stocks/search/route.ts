import { NextRequest, NextResponse } from "next/server";
import { localSearchStocks } from "@/lib/local-store";
import { serviceSupabase } from "@/lib/supabase";
import type { MarketType } from "@/lib/types";

const QUERY_ALIASES: Record<string, string[]> = {
  삼성: ["삼성전자"],
  삼전: ["삼성전자"],
  하이닉스: ["SK하이닉스"],
  엔비디아: ["NVIDIA", "NVDA"],
  테슬라: ["Tesla", "TSLA"],
  애플: ["Apple", "AAPL"],
  마소: ["Microsoft", "MSFT"],
  마이크로소프트: ["Microsoft", "MSFT"],
  알테오젠: ["알테오젠"],
};

function expandSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  const aliases = QUERY_ALIASES[trimmed] ?? [];
  return [...new Set([trimmed, ...aliases])];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  const market = (searchParams.get("market") ?? "ALL") as "ALL" | MarketType;

  try {
    if (!query) return NextResponse.json({ items: [] });

    if (market !== "ALL" && market !== "KR" && market !== "US") {
      return NextResponse.json({ error: "검색에 실패했습니다." }, { status: 400 });
    }

    const supabase = serviceSupabase();
    const terms = expandSearchTerms(query);
    const orFilter = terms
      .flatMap((term) => [`symbol.ilike.%${term}%`, `name.ilike.%${term}%`])
      .join(",");

    let dbQuery = supabase
      .from("stocks")
      .select("id, symbol, name, market_type, exchange")
      .eq("is_active", true)
      .or(orFilter)
      .limit(20);

    if (market === "KR" || market === "US") {
      dbQuery = dbQuery.eq("market_type", market);
    }

    const { data, error } = await dbQuery.order("name", { ascending: true });

    if (error) {
      console.error("[stocks/search] Supabase query failed", {
        query,
        market,
        error,
      });
      return NextResponse.json({ items: await localSearchStocks(query, market) });
    }

    const normalized = (data ?? []).sort((a, b) => {
      const aStarts = Number(a.name.startsWith(query) || a.symbol.startsWith(query.toUpperCase()));
      const bStarts = Number(b.name.startsWith(query) || b.symbol.startsWith(query.toUpperCase()));
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.name.localeCompare(b.name, "ko");
    });

    return NextResponse.json({ items: normalized });
  } catch (error) {
    console.error("[stocks/search] Unexpected error", {
      error,
      requestUrl: request.url,
    });
    return NextResponse.json({ items: await localSearchStocks(query, market) });
  }
}

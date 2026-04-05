import { NextRequest, NextResponse } from "next/server";
import { localSearchStocks } from "@/lib/local-store";
import { serviceSupabase } from "@/lib/supabase";

const QUERY_ALIASES: Record<string, string[]> = {
  삼성: ["삼성전자"],
  삼전: ["삼성전자"],
  하이닉스: ["SK하이닉스"],
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

  try {
    if (!query) return NextResponse.json({ items: [] });

    const supabase = serviceSupabase();
    const terms = expandSearchTerms(query);
    const orFilter = terms
      .flatMap((term) => [`symbol.ilike.%${term}%`, `name.ilike.%${term}%`])
      .join(",");

    const dbQuery = supabase
      .from("stocks")
      .select("id, symbol, name, market_type, exchange")
      .eq("is_active", true)
      .eq("market_type", "KR")
      .or(orFilter)
      .limit(20);

    const { data, error } = await dbQuery.order("name", { ascending: true });

    if (error) {
      console.error("[stocks/search] Supabase query failed", {
        query,
        error,
      });
      return NextResponse.json({ items: await localSearchStocks(query, "KR") });
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
    return NextResponse.json({ items: await localSearchStocks(query, "KR") });
  }
}

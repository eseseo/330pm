import { writeSupabase } from "@/lib/supabase";
import type { MarketStatus, MarketType } from "@/lib/types";

function marketTimeZone(market: MarketType): string {
  return market === "KR" ? "Asia/Seoul" : "America/New_York";
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: read("weekday"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function isWeekday(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

function fallbackIsMarketOpen(market: MarketType, now = new Date()): boolean {
  if (market === "KR") {
    const p = zonedParts(now, marketTimeZone(market));
    if (!isWeekday(p.weekday)) return false;
    const minutes = p.hour * 60 + p.minute;
    return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
  }

  const p = zonedParts(now, marketTimeZone(market));
  if (!isWeekday(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function fallbackMarketDate(market: MarketType, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: marketTimeZone(market),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function fallbackStateMessage(market: MarketType, now = new Date()): string {
  if (!fallbackIsMarketOpen(market, now)) {
    return "장이 마감됐습니다. 한마디 남겨보세요.";
  }

  return "장중에는 읽기만 가능합니다.";
}

export function secondsUntilKrClose(now = new Date()): number {
  const p = zonedParts(now, "Asia/Seoul");
  if (!isWeekday(p.weekday)) return 0;
  const nowSeconds = (p.hour * 60 + p.minute) * 60 + now.getSeconds();
  const closeSeconds = (15 * 60 + 30) * 60;
  return Math.max(closeSeconds - nowSeconds, 0);
}

function fallbackMarketStatus(market: MarketType, now = new Date()): MarketStatus {
  const isMarketOpen = fallbackIsMarketOpen(market, now);
  return {
    marketDate: fallbackMarketDate(market, now),
    isMarketOpen,
    writeOpen: !isMarketOpen,
    stateMessage: fallbackStateMessage(market, now),
    source: "fallback",
  };
}

type MarketSessionRow = {
  session_date: string;
  write_open_at: string;
  write_close_at: string;
};

export async function getMarketStatus(market: MarketType, now = new Date()): Promise<MarketStatus> {
  try {
    const { client: supabase } = writeSupabase();
    const { data, error } = await supabase
      .from("market_sessions")
      .select("session_date, write_open_at, write_close_at")
      .eq("market_type", market)
      .order("session_date", { ascending: false })
      .limit(7);

    if (error || !data?.length) {
      return fallbackMarketStatus(market, now);
    }

    const currentTime = now.getTime();
    const activeSession = (data as MarketSessionRow[]).find((session) => {
      const writeOpenAt = new Date(session.write_open_at).getTime();
      const writeCloseAt = new Date(session.write_close_at).getTime();
      return writeOpenAt <= currentTime && currentTime < writeCloseAt;
    });

    if (activeSession) {
      return {
        marketDate: activeSession.session_date,
        isMarketOpen: false,
        writeOpen: true,
        stateMessage: "장이 마감됐습니다. 한마디 남겨보세요.",
        source: "schedule",
      };
    }

    const fallback = fallbackMarketStatus(market, now);
    return {
      ...fallback,
      source: "schedule",
    };
  } catch {
    return fallbackMarketStatus(market, now);
  }
}

export async function getAllMarketStatus(now = new Date()): Promise<Record<MarketType, MarketStatus>> {
  const [kr, us] = await Promise.all([getMarketStatus("KR", now), getMarketStatus("US", now)]);
  return { KR: kr, US: us };
}

export function isMarketOpen(market: MarketType, now = new Date()): boolean {
  return fallbackIsMarketOpen(market, now);
}

export function marketDate(market: MarketType, now = new Date()): string {
  return fallbackMarketDate(market, now);
}

export async function isWriteOpen(market: MarketType, now = new Date()): Promise<boolean> {
  const status = await getMarketStatus(market, now);
  return status.writeOpen;
}

export async function marketStateMessage(market: MarketType, now = new Date()): Promise<string> {
  const status = await getMarketStatus(market, now);
  return status.stateMessage;
}

export async function recentlyClosedMarket(now = new Date()): Promise<MarketType> {
  const statuses = await getAllMarketStatus(now);

  if (statuses.KR.isMarketOpen && !statuses.US.isMarketOpen) return "US";
  if (!statuses.KR.isMarketOpen && statuses.US.isMarketOpen) return "KR";

  const seoul = zonedParts(now, "Asia/Seoul");
  return seoul.hour >= 15 ? "KR" : "US";
}

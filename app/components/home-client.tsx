"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { secondsUntilKrClose } from "@/lib/market";
import type { EmotionTag, HomeFeed, Stock } from "@/lib/types";

type SearchItem = Pick<Stock, "id" | "symbol" | "name" | "market_type" | "exchange">;

type ErrorPayload = {
  error?: string;
  detail?: string;
  items?: SearchItem[];
};

const SENTIMENT_BAR_COLOR: Record<string, string> = {
  Bullish: "bg-emerald-500",
  Neutral: "bg-slate-400",
  Bearish: "bg-blue-600",
  Angry: "bg-rose-500",
};

const STOCK_TONE_STYLE = {
  bullish: {
    chip: "bg-rose-100 text-rose-700",
    card: "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,241,243,0.98))] hover:border-rose-300",
    accent: "from-rose-500/12 via-rose-400/5 to-transparent",
    value: "text-rose-600",
    meta: "text-rose-500/80",
    bar: "bg-rose-500",
    label: "상승 우세",
  },
  bearish: {
    chip: "bg-blue-100 text-blue-800",
    card: "border-blue-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.98))] hover:border-blue-300",
    accent: "from-blue-600/12 via-blue-400/5 to-transparent",
    value: "text-blue-700",
    meta: "text-blue-600/75",
    bar: "bg-blue-600",
    label: "하락 우세",
  },
  mixed: {
    chip: "bg-slate-100 text-slate-600",
    card: "border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.98))] hover:border-slate-300",
    accent: "from-slate-400/12 via-slate-300/5 to-transparent",
    value: "text-slate-700",
    meta: "text-slate-500",
    bar: "bg-slate-400",
    label: "혼조",
  },
} as const;

const HOME_COPY = {
  badge: "3:30",
  title: "장마감 한줄 요약",
  subtitle: "짧게 남기고, 장 시간 동안은 읽기만 가능합니다.",
  searchPlaceholder: "한국 종목명 또는 종목코드 검색",
  highlightTitle: "오늘의 한줄",
  trendingTitle: "지금 분위기 종목",
  popularTitle: "지금 뜨는 한줄",
  sentimentTitle: "시장 분위기",
} as const;

const EMOTION_STYLE: Record<EmotionTag, string> = {
  확신: "bg-emerald-50 text-emerald-700",
  후회: "bg-slate-100 text-slate-700",
  분노: "bg-rose-50 text-rose-700",
  불안: "bg-amber-50 text-amber-700",
  상승예상: "bg-sky-50 text-sky-700",
  끝났다: "bg-slate-900 text-white",
};

const EMOTION_LABEL: Record<EmotionTag, string> = {
  확신: "떡상",
  후회: "후회",
  분노: "분노",
  불안: "불안",
  상승예상: "상승예상",
  끝났다: "끝났다",
};

const MARKET_SENTIMENT_LABEL: Record<string, string> = {
  Bullish: "떡상 우세",
  Neutral: "관망",
  Bearish: "하락 우세",
  Angry: "분노 과열",
};

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function defaultFeed(): HomeFeed {
  return {
    quoteOfTheDay: null,
    topMentionedKR: [],
    topMentionedUS: [],
    hotLines: [],
    recentlyClosedMarket: "KR",
    quoteDate: null,
    quoteIsFallback: false,
    topMentionedKRDate: null,
    topMentionedUSDate: null,
    marketSentimentKR: [],
    marketSentimentUS: [],
    marketStatus: {
      KR: {
        marketDate: "",
        isMarketOpen: false,
        writeOpen: true,
        stateMessage: "장이 마감됐습니다. 한마디 남겨보세요.",
        source: "fallback",
      },
      US: {
        marketDate: "",
        isMarketOpen: false,
        writeOpen: false,
        stateMessage: "",
        source: "fallback",
      },
    },
  };
}

function formatFeedDate(date: string | null) {
  return date ? date.replaceAll("-", ".") : null;
}

function marketLabel(item: SearchItem) {
  return item.exchange;
}

function stockToneMeta(tone: "bullish" | "bearish" | "mixed") {
  return STOCK_TONE_STYLE[tone];
}

function stockWriteHref(stockId: string) {
  return `/stocks/${stockId}#write-flow`;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
      <path d="M13.75 13.75 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.75" cy="8.75" r="5.25" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}


export function HomeClient() {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchItem[]>([]);
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntilKrClose());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trendingTop10 = feed?.topMentionedKR ?? [];
  const hotLines = feed?.hotLines ?? [];
  const searchOpen = query.trim().length > 0;
  const dominantSentiment = feed?.marketSentimentKR?.[0] ?? null;
  const totalSentimentLines = feed?.marketSentimentKR?.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const krMarketOpen = feed?.marketStatus.KR.isMarketOpen ?? false;
  const marketOpen = krMarketOpen;

  useEffect(() => {
    fetch("/api/feed/home", { cache: "no-store" })
      .then(async (res) => {
        const payload = await parseJsonSafe<HomeFeed & ErrorPayload>(res);
        if (!res.ok || !payload) {
          setFeed(defaultFeed());
          return;
        }
        setFeed(payload);
      })
      .catch(() => setFeed(defaultFeed()));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft(secondsUntilKrClose());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) return;

    const controller = new AbortController();

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const payload = await parseJsonSafe<{ items?: SearchItem[] } & ErrorPayload>(res);
        if (!res.ok) {
          setSearchResult(payload?.items ?? []);
          setMessage(payload?.error ?? "한국 종목 검색에 실패했습니다.");
          return;
        }
        setSearchResult(payload?.items ?? []);
        setHighlightIndex(0);
        setMessage(null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage("한국 종목 검색에 실패했습니다.");
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query]);

  const selectedItem = useMemo(() => searchResult[highlightIndex] ?? null, [searchResult, highlightIndex]);
  const countdownLabel = useMemo(() => {
    if (!krMarketOpen) return "한국장 마감";
    const hours = Math.floor(secondsLeft / 3600);
    const minutes = Math.floor((secondsLeft % 3600) / 60);
    const seconds = secondsLeft % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [krMarketOpen, secondsLeft]);

  return (
    <main className="mx-auto max-w-[640px] px-4 py-5 sm:px-5 sm:py-6">
      <header className="rounded-[32px] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,245,252,0.94))] px-4 py-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.32)] sm:px-6 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-slate-950 px-6 py-2.5 text-xl font-semibold tracking-[0.3em] text-white sm:px-7 sm:text-2xl">
            {HOME_COPY.badge}
          </span>
          <div className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {marketOpen ? "시장 상태" : "마감 후"}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${krMarketOpen ? "bg-slate-100 text-slate-900" : "bg-blue-50 text-blue-700"}`}>
              {countdownLabel}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">한국장 기준</span>
          </div>
        </div>

        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          {HOME_COPY.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base">{HOME_COPY.subtitle}</p>
        <p className="mt-2 text-xs font-medium text-slate-400 sm:text-sm">
          현재 상위 코스피200, 코스닥100 종목과 인기 ETF 기준으로 조회됩니다.
        </p>

        <div className="relative mt-6 rounded-[30px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.28)]">
          <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
                <SearchIcon />
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  if (!nextQuery.trim()) {
                    setSearchResult([]);
                    setMessage(null);
                    setHighlightIndex(0);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setHighlightIndex((prev) => Math.min(prev + 1, Math.max(searchResult.length - 1, 0)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlightIndex((prev) => Math.max(prev - 1, 0));
                  }
                  if (event.key === "Enter" && selectedItem) {
                    event.preventDefault();
                    window.location.href = stockWriteHref(selectedItem.id);
                  }
                }}
                placeholder={HOME_COPY.searchPlaceholder}
                className="h-[56px] w-full rounded-[22px] border border-slate-200/90 bg-white/95 pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200"
              />
          </div>

          <button
            type="button"
            onClick={() => searchInputRef.current?.focus()}
            className="mt-3 flex min-h-[58px] w-full items-center rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 text-left text-sm text-slate-500 transition hover:border-slate-400 hover:bg-white"
          >
            <span className="font-semibold text-slate-800">오늘 어떠셨나요?</span>
            <span className="ml-2 text-slate-500">종목을 검색하고 바로 한줄 남겨보세요.</span>
          </button>

          {searchOpen ? (
            <div className="absolute inset-x-0 top-[calc(100%+12px)] z-20 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.28)]">
              {searchResult.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-3 pb-2 pt-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">검색 결과</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setSearchResult([]);
                        setMessage(null);
                        setHighlightIndex(0);
                      }}
                      className="rounded-full px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      닫기
                    </button>
                  </div>
                  <ul className="grid max-h-[min(55vh,420px)] gap-1 overflow-y-auto pr-1">
                    {searchResult.map((stock, index) => (
                      <li key={stock.id}>
                        <Link
                          href={stockWriteHref(stock.id)}
                          className={`group block rounded-2xl border px-4 py-3 transition ${
                            highlightIndex === index
                              ? "border-slate-900 bg-slate-900 text-white shadow-[0_18px_34px_-24px_rgba(15,23,42,0.35)]"
                              : "border-transparent bg-white text-slate-900 hover:bg-slate-100"
                          }`}
                          onMouseEnter={() => setHighlightIndex(index)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className={`text-sm font-semibold ${highlightIndex === index ? "text-white" : "text-gray-900"}`}>
                                {stock.name}
                              </p>
                              <p className={`mt-1 text-xs ${highlightIndex === index ? "text-slate-200" : "text-gray-500"}`}>
                                {stock.symbol}
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                highlightIndex === index ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {marketLabel(stock)}
                            </span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                  {message ?? "일치하는 한국 종목이 없습니다."}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {(feed?.quoteOfTheDay?.stock || dominantSentiment) ? (
      <section className="mt-6 grid gap-4">
        {feed?.quoteOfTheDay?.stock ? (
        <article className="min-h-[220px] rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              🔥 오늘의 한줄
            </h2>
            {feed?.quoteIsFallback ? (
              <span className="text-xs text-slate-400">가장 최근에 등록된 한줄을 보여주고 있습니다</span>
            ) : null}
          </div>

            <Link
              href={stockWriteHref(feed.quoteOfTheDay.stock.id)}
              className="mt-5 block min-h-[148px] rounded-[28px] bg-[linear-gradient(160deg,#0b1324,#12213f_58%,#193259)] px-5 py-6 text-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-38px_rgba(15,23,42,0.95)] sm:px-6 sm:py-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">
                  {feed.quoteOfTheDay.stock.name} · {feed.quoteOfTheDay.stock.symbol}
                </p>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                  공감 {feed.quoteOfTheDay.empathy_count}
                </span>
              </div>
              <p className="mt-5 line-clamp-2 text-xl font-medium leading-8 text-white/95 sm:text-2xl sm:leading-10">{feed.quoteOfTheDay.content}</p>
            </Link>
        </article>
        ) : null}

        {dominantSentiment ? (
        <aside className="min-h-[220px] rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">오늘의 분위기</h2>
            <span className="text-xs text-slate-400">KR 기준</span>
          </div>
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">지배적 심리</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{MARKET_SENTIMENT_LABEL[dominantSentiment.tag] ?? dominantSentiment.tag}</p>
                </div>
                <p className="text-4xl font-semibold tracking-tight text-slate-950">{dominantSentiment.ratio}%</p>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${SENTIMENT_BAR_COLOR[dominantSentiment.tag] ?? "bg-slate-400"}`}
                  style={{ width: `${dominantSentiment.ratio}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-500">최근 {totalSentimentLines}개 한줄을 기준으로 집계했습니다.</p>
            </div>
        </aside>
        ) : null}
      </section>
      ) : null}

      {trendingTop10.length > 0 || hotLines.length > 0 ? (
      <section className="mt-4 grid gap-6">
        {trendingTop10.length > 0 ? (
        <article className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              {HOME_COPY.trendingTitle} · KR
            </h2>
            {feed?.topMentionedKRDate ? (
              <span className="text-xs text-slate-400">{formatFeedDate(feed.topMentionedKRDate)} · 최근 한줄 기준</span>
            ) : null}
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {trendingTop10.map((stock, index) => (
                  <li key={stock.id}>
                    <Link
                      href={stockWriteHref(stock.id)}
                      className={`group relative flex min-h-[164px] h-full items-center justify-between overflow-hidden rounded-[24px] border px-4 py-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.24)] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] ${stockToneMeta(stock.sentiment_tone).card}`}
                    >
                      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${stockToneMeta(stock.sentiment_tone).accent}`} />
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex rounded-full bg-slate-950 px-2 py-1 text-[10px] font-semibold text-white">
                              {index + 1}위
                            </span>
                            <p className="line-clamp-2 text-sm font-semibold text-slate-900">{stock.name}</p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{stock.symbol}</p>
                          <p className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${stockToneMeta(stock.sentiment_tone).chip}`}>
                            {stockToneMeta(stock.sentiment_tone).label}
                          </p>
                        </div>
                      </div>
                      <div className="relative text-right">
                        <p className={`mt-2 text-[2rem] font-semibold leading-none tracking-tight ${stockToneMeta(stock.sentiment_tone).value}`}>
                          {stock.dominant_ratio}%
                        </p>
                        <p className={`mt-1 text-xs font-medium ${stockToneMeta(stock.sentiment_tone).meta}`}>최근 한줄 {stock.line_count}개</p>
                        <div className="mt-3 ml-auto h-2 w-24 overflow-hidden rounded-full bg-white/70 ring-1 ring-black/5">
                          <div
                            className={`h-full rounded-full ${stockToneMeta(stock.sentiment_tone).bar}`}
                            style={{ width: `${stock.dominant_ratio}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
          </ul>
        </article>
        ) : null}

        {hotLines.length > 0 ? (
        <article className="rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              {HOME_COPY.popularTitle}
            </h2>
            <span className="text-xs text-slate-400">공감 수와 최신순 기준</span>
          </div>
          <div className="mt-5 grid gap-3">
            {hotLines.slice(0, 9).map((post) => (
                  <Link
                    key={post.id}
                    href={post.stock ? stockWriteHref(post.stock.id) : "#"}
                    className="block min-h-[132px] rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm transition hover:scale-[1.01] hover:bg-white hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.4)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {post.stock ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {post.stock.name} · {post.stock.symbol}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">알 수 없음</span>
                      )}
                      <div className="flex items-center gap-2">
                        {post.emotion_tag ? (
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${EMOTION_STYLE[post.emotion_tag as EmotionTag]}`}
                          >
                            {EMOTION_LABEL[post.emotion_tag as EmotionTag]}
                          </span>
                        ) : null}
                        <span className="text-xs font-semibold text-slate-600">공감 {post.empathy_count}</span>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-7 text-slate-900">{post.content}</p>
                  </Link>
                ))}
          </div>
        </article>
        ) : null}
      </section>
      ) : null}

      {feed?.marketSentimentKR.length ? (
      <section className="mt-8 rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            {HOME_COPY.sentimentTitle} · KR
          </h2>
          <span className="text-xs text-slate-400">최근 24시간</span>
        </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {feed.marketSentimentKR.map((item) => (
              <div key={item.tag} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
                  <span>{MARKET_SENTIMENT_LABEL[item.tag] ?? item.tag}</span>
                  <span>{item.ratio}%</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div
                    className={`h-2 rounded-full ${SENTIMENT_BAR_COLOR[item.tag] ?? "bg-slate-900"}`}
                    style={{ width: `${item.ratio}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">{item.count}개 한줄</p>
              </div>
            ))}
          </div>
      </section>
      ) : null}
    </main>
  );
}

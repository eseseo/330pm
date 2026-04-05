"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_POST_LENGTH } from "@/lib/constants";
import { type EmotionDistribution, type Post, type Stock } from "@/lib/types";

type StockResponse = {
  stock: Stock;
  writeOpen: boolean;
  stateMessage: string;
  posts: Post[];
  representativePost: Post | null;
  emotionDistribution: EmotionDistribution[];
  postsWarning?: string | null;
};

type ErrorPayload = {
  error?: string;
  detail?: string;
};

const SENTIMENT_OPTIONS = [
  { label: "떡상", value: "확신", emoji: "📈" },
  { label: "후회", value: "후회", emoji: "⏸" },
  { label: "불안", value: "불안", emoji: "📉" },
  { label: "분노", value: "분노", emoji: "😡" },
] as const;

const SENTIMENT_BAR_STYLE: Record<string, string> = {
  Bullish: "bg-emerald-500",
  Neutral: "bg-slate-400",
  Bearish: "bg-blue-600",
  Angry: "bg-rose-500",
};

const MARKET_SENTIMENT_LABEL: Record<string, string> = {
  Bullish: "떡상 우세",
  Neutral: "관망",
  Bearish: "하락 우세",
  Angry: "분노 과열",
};

const INPUT_STATE_STYLE = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-800",
  closed: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function formatClosePrice(stock: Stock) {
  if (stock.last_close == null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: stock.market_type === "KR" ? "KRW" : "USD",
    maximumFractionDigits: stock.market_type === "KR" ? 0 : 2,
  }).format(stock.last_close);
}

function formatChangeRate(rate?: number | null) {
  if (rate == null) return "보합";
  const sign = rate > 0 ? "+" : "";
  return `${sign}${rate.toFixed(2)}%`;
}

function showPriceBadge(stock: Stock) {
  return stock.market_type === "KR";
}

function formatPostDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

function isUserFacingMessage(message: string | null) {
  if (!message) return false;
  return message.includes("최대 3줄") || message.includes("같은 문장을 다시 올릴 수 없습니다");
}

function LoadingSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 animate-pulse">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-9 w-20 rounded-xl bg-slate-200" />
        <div className="h-7 w-16 rounded-full bg-slate-200" />
      </div>
      <div className="rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="h-8 w-48 rounded-lg bg-slate-200" />
        <div className="mt-3 h-4 w-64 rounded bg-slate-100" />
        <div className="mt-5 flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-20 rounded-full bg-slate-100" />
          ))}
        </div>
        <div className="mt-4 h-14 rounded-[18px] bg-slate-100" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6">
          <div className="h-4 w-20 rounded bg-slate-200" />
          <div className="mt-4 h-24 rounded-2xl bg-slate-100" />
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6">
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="mt-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-[22px] bg-slate-100" />
          ))}
        </div>
      </div>
    </main>
  );
}

export function StockClient({ stockId }: { stockId: string }) {
  const [payload, setPayload] = useState<StockResponse | null>(null);
  const [sort, setSort] = useState<"latest" | "likes">("latest");
  const [content, setContent] = useState("");
  const [emotionTag, setEmotionTag] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const posts = useMemo(() => {
    if (!payload) return [];
    if (sort === "latest") return payload.posts;
    return [...payload.posts].sort(
      (a, b) => b.empathy_count - a.empathy_count || +new Date(b.created_at) - +new Date(a.created_at),
    );
  }, [payload, sort]);

  const topLineId = payload?.representativePost?.id ?? null;
  const recentLines = useMemo(() => posts.filter((post) => post.id !== topLineId), [posts, topLineId]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/stocks/${stockId}`, { cache: "no-store" });
    const body = await parseJsonSafe<StockResponse & ErrorPayload>(res);

    if (!res.ok) {
      const detail = process.env.NODE_ENV === "development" && body?.detail ? ` (${body.detail})` : "";
      throw new Error(`${body?.error || "종목 데이터를 불러오지 못했습니다."}${detail}`);
    }

    if (!body || !body.stock) {
      throw new Error("종목 응답 형식이 올바르지 않습니다.");
    }

    setPayload(body as StockResponse);
    if (process.env.NODE_ENV === "development" && body.postsWarning) {
      console.warn("[stock-page] posts fetch warning", body.postsWarning);
    }
  }, [stockId]);

  useEffect(() => {
    load()
      .catch((error: Error) => {
        console.error("[stock-page] load failed", error);
        setMessage(error.message);
      })
      .finally(() => setLoading(false));
  }, [load]);

  // Auto-resize textarea on content change
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 56)}px`;
  }, [content]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPosting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/stocks/${stockId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, emotionTag: emotionTag || null }),
      });
      const body = await parseJsonSafe<{ error?: string; detail?: string }>(res);
      if (!res.ok) {
        const detail = process.env.NODE_ENV === "development" && body?.detail ? ` (${body.detail})` : "";
        const errorMessage = `${body?.error || "한줄 등록에 실패했습니다."}${detail}`;
        console.error("[stock-page] submit rejected", errorMessage);
        if (isUserFacingMessage(body?.error ?? null)) {
          setMessage(body?.error ?? null);
        }
        return;
      }

      setContent("");
      setEmotionTag("");
      await load();
      setMessage("한줄을 등록했습니다.");
    } catch (error) {
      console.error("[stock-page] submit failed", error);
    } finally {
      setPosting(false);
    }
  }

  async function like(postId: string) {
    try {
      const res = await fetch(`/api/posts/${postId}/empathy`, { method: "POST" });
      const body = await parseJsonSafe<{ error?: string; detail?: string; empathyCount?: number }>(res);
      if (!res.ok) {
        if (res.status === 409) return; // already liked — silent, not an error
        const detail = process.env.NODE_ENV === "development" && body?.detail ? ` (${body.detail})` : "";
        console.error("[stock-page] like rejected", `${body?.error || "공감 처리에 실패했습니다."}${detail}`);
        return;
      }

      setPayload((prev) => {
        if (!prev) return prev;
        const updatedPosts = prev.posts.map((post) =>
          post.id === postId ? { ...post, empathy_count: body?.empathyCount ?? post.empathy_count } : post,
        );
        const updatedRepresentative =
          prev.representativePost?.id === postId
            ? { ...prev.representativePost, empathy_count: body?.empathyCount ?? prev.representativePost.empathy_count }
            : prev.representativePost;

        return { ...prev, posts: updatedPosts, representativePost: updatedRepresentative };
      });
    } catch (error) {
      console.error("[stock-page] like failed", error);
    }
  }

  if (loading) return <LoadingSkeleton />;

  if (!payload) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12 text-sm text-rose-600">
        데이터를 불러오지 못했습니다. {message}
      </main>
    );
  }

  const isCounterWarning = content.length >= 45;
  const isSubmitDisabled = posting || !payload.writeOpen || content.trim().length === 0;
  const inputStateTone = payload.writeOpen ? INPUT_STATE_STYLE.open : INPUT_STATE_STYLE.closed;
  const submitHelp = !payload.writeOpen
    ? "지금은 읽기 전용입니다."
    : content.trim().length === 0
      ? "한줄을 입력하면 바로 올릴 수 있습니다."
      : "지금 바로 등록할 수 있습니다.";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/"
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
        >
          ← 돌아가기
        </Link>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          {payload.stock.exchange}
        </span>
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_-40px_rgba(15,23,42,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              {payload.stock.name}
              <span className="ml-2 text-base font-medium text-slate-400">{payload.stock.symbol}</span>
            </h1>
            <p className="mt-2 text-sm text-slate-600">{payload.stateMessage}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {showPriceBadge(payload.stock) ? (
              <>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700">
                  {formatClosePrice(payload.stock)}
                </span>
                <span
                  className={`rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold ${
                    (payload.stock.change_rate ?? 0) > 0
                      ? "text-rose-600"
                      : (payload.stock.change_rate ?? 0) < 0
                        ? "text-blue-700"
                        : "text-slate-700"
                  }`}
                >
                  {formatChangeRate(payload.stock.change_rate)}
                </span>
              </>
            ) : null}
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700">
              한줄 {posts.length}개
            </span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">작성</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">한줄 남기기</h2>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${payload.writeOpen ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {payload.writeOpen ? "작성 가능" : "잠김"}
          </span>
        </div>

        <div className={`mt-4 rounded-[22px] border px-4 py-4 ${inputStateTone}`}>
          <p className="text-sm font-semibold">
            {payload.writeOpen
              ? "한국장은 15시 30분 이후부터 다음 장 시작 전까지 작성할 수 있습니다."
              : "장중에는 읽기만 가능하고, 마감 후에만 작성할 수 있습니다."}
          </p>
          <p className="mt-2 text-xs opacity-80">{submitHelp}</p>
        </div>

        <form className="mt-4 space-y-3" onSubmit={submit}>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, MAX_POST_LENGTH))}
            maxLength={MAX_POST_LENGTH}
            disabled={!payload.writeOpen}
            placeholder={payload.writeOpen ? "짧고 선명하게 남겨보세요." : "장이 열려 있을 때는 읽기만 가능합니다."}
            required
            rows={1}
            className="w-full resize-none overflow-hidden rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
            style={{ minHeight: "56px" }}
          />

          <div className="flex flex-wrap items-center gap-2">
            {SENTIMENT_OPTIONS.map((tag) => (
              <button
                key={tag.label}
                type="button"
                disabled={!payload.writeOpen}
                onClick={() => setEmotionTag((prev) => (prev === tag.value ? "" : tag.value))}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  emotionTag === tag.value
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="flex items-center gap-1">
                  <span>{tag.emoji}</span>
                  <span>{tag.label}</span>
                </span>
              </button>
            ))}
            <span
              className={`ml-auto text-xs font-semibold ${isCounterWarning ? "text-rose-600" : "text-slate-500"}`}
            >
              {content.length}/{MAX_POST_LENGTH}
            </span>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? "등록 중..." : "한줄 올리기"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">대표 한줄</h2>
            {payload.representativePost ? (
              <span className="text-xs font-semibold text-slate-500">
                공감 {payload.representativePost.empathy_count}
              </span>
            ) : null}
          </div>
          {payload.representativePost ? (
            <div className="mt-4 rounded-[24px] bg-[linear-gradient(160deg,#0b1324,#12213f_58%,#193259)] px-5 py-5 text-white shadow-[0_20px_50px_-36px_rgba(15,23,42,0.85)]">
              {payload.representativePost.emotion_tag ? (
                <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white">
                  {SENTIMENT_OPTIONS.find((item) => item.value === payload.representativePost?.emotion_tag)?.label ??
                    payload.representativePost.emotion_tag}
                </span>
              ) : null}
              <p className="mt-4 text-xl leading-9 text-white/95">{payload.representativePost.content}</p>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              아직 대표 한줄이 없습니다.
            </div>
          )}
        </article>

        <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">시장 분위기</h3>
            {payload.emotionDistribution.length > 0 ? (
              <div className="mt-4 space-y-3">
                {payload.emotionDistribution.map((item) => (
                  <div key={item.tag}>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>{MARKET_SENTIMENT_LABEL[item.tag] ?? item.tag}</span>
                      <span>{item.ratio}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-200">
                      <div
                        className={`h-2.5 rounded-full ${SENTIMENT_BAR_STYLE[item.tag] ?? "bg-slate-900"}`}
                        style={{ width: `${item.ratio}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">아직 데이터가 부족합니다.</p>
            )}
          </div>
        </article>
      </section>

      <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_22px_70px_-44px_rgba(15,23,42,0.3)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">한줄</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">최근 한줄</h2>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
            {([
              { value: "latest", label: "최신순" },
              { value: "likes", label: "공감순" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSort(option.value)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  sort === option.value ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="mt-5 space-y-3">
          {recentLines.map((post) => (
            <li
              key={post.id}
              className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm transition hover:border-slate-300 hover:bg-white hover:shadow-[0_16px_34px_-28px_rgba(15,23,42,0.35)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {formatPostDate(post.created_at)}
                    </p>
                    {post.emotion_tag ? (
                      <p className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                        <span>{SENTIMENT_OPTIONS.find((item) => item.value === post.emotion_tag)?.emoji ?? "💬"}</span>
                        <span>
                          {SENTIMENT_OPTIONS.find((item) => item.value === post.emotion_tag)?.label ?? post.emotion_tag}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-900">{post.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => like(post.id)}
                  className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  👍 공감 {post.empathy_count}
                </button>
              </div>
            </li>
          ))}

          {recentLines.length === 0 ? (
            <li className="rounded-[24px] border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              아직 최근 한줄이 없습니다.
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}

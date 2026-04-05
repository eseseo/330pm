import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { bestLineScore, SENTIMENT_GROUPS, sentimentCounts } from "@/lib/scoring";
import { cloneFallbackPosts, cloneFallbackStocks } from "@/lib/local-fallback-data";
import type {
  EmotionDistribution,
  HomeFeed,
  MarketSentiment,
  MarketStatus,
  MarketType,
  MentionedStock,
  Post,
  Stock,
  SentimentTag,
} from "@/lib/types";

type Reaction = {
  id: string;
  post_id: string;
  session_hash: string;
  reaction_type: "empathy";
  created_at: string;
};

type LocalState = {
  stocks: Stock[];
  posts: Post[];
  reactions: Reaction[];
};

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const KR_CURATED_FILE = path.join(process.cwd(), "data", "kr-curated.json");

function initialState(): LocalState {
  return {
    stocks: cloneFallbackStocks(),
    posts: cloneFallbackPosts(),
    reactions: [],
  };
}

async function mergeCuratedStocks(state: LocalState) {
  try {
    const raw = await readFile(KR_CURATED_FILE, "utf8");
    const curated = JSON.parse(raw) as Stock[];
    const bucket = new Map<string, Stock>();
    for (const stock of state.stocks) bucket.set(`${stock.market_type}:${stock.symbol}`, stock);
    let changed = false;
    for (const stock of curated) {
      const key = `${stock.market_type}:${stock.symbol}`;
      if (!bucket.has(key)) {
        bucket.set(key, stock);
        changed = true;
      }
    }
    if (changed) {
      state.stocks = [...bucket.values()];
    }
    return changed;
  } catch {
    return false;
  }
}

async function ensureState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const state = JSON.parse(raw) as LocalState;
    const changed = await mergeCuratedStocks(state);
    if (changed) await saveState(state);
    return state;
  } catch {
    const state = initialState();
    await mergeCuratedStocks(state);
    await writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
    return state;
  }
}

async function saveState(state: LocalState) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function sortPosts(posts: Post[]) {
  return [...posts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

function buildEmotionDistribution(posts: Post[]): EmotionDistribution[] {
  const total = posts.filter((post) => post.emotion_tag).length;
  return (Object.entries(SENTIMENT_GROUPS) as Array<[SentimentTag, string[]]>)
    .map(([tag, sourceTags]) => {
      const count = posts.filter((post) => post.emotion_tag && sourceTags.includes(post.emotion_tag)).length;
      return { tag, count, ratio: total > 0 ? Math.round((count / total) * 100) : 0 };
    })
    .filter((item) => item.count > 0);
}

function buildTopMentioned(market: MarketType, posts: Post[]): MentionedStock[] {
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
        ...post.stock,
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

function latestDate(market: MarketType, posts: Post[]) {
  return (
    posts
      .filter((post) => post.market_type === market)
      .map((post) => post.market_date ?? "")
      .sort((a, b) => b.localeCompare(a))[0] ?? null
  );
}

function buildMarketSentiment(posts: Post[], market: MarketType): MarketSentiment[] {
  const scoped = posts.filter((post) => post.market_type === market && post.emotion_tag);
  const total = scoped.length;
  return (Object.entries(SENTIMENT_GROUPS) as Array<[SentimentTag, string[]]>)
    .map(([tag, sourceTags]) => {
      const count = scoped.filter((post) => post.emotion_tag && sourceTags.includes(post.emotion_tag)).length;
      return { tag, count, ratio: total > 0 ? Math.round((count / total) * 100) : 0 };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}

export async function localSearchStocks(query: string, market: "ALL" | MarketType) {
  const state = await ensureState();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return state.stocks
    .filter((stock) => {
      if (market !== "ALL" && stock.market_type !== market) return false;
      return stock.name.toLowerCase().includes(q) || stock.symbol.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aStarts = Number(a.name.startsWith(query) || a.symbol.startsWith(query.toUpperCase()));
      const bStarts = Number(b.name.startsWith(query) || b.symbol.startsWith(query.toUpperCase()));
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.name.localeCompare(b.name, "ko");
    })
    .slice(0, 20);
}

export async function localStockPayload(stockId: string, marketStatus: MarketStatus) {
  const state = await ensureState();
  const stock = state.stocks.find((item) => item.id === stockId) ?? null;
  if (!stock) return null;
  const posts = sortPosts(state.posts.filter((post) => post.stock_id === stockId));
  const representativePost =
    [...posts].sort(
      (a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at),
    )[0] ?? null;

  return {
    stock,
    writeOpen: marketStatus.writeOpen,
    stateMessage: marketStatus.stateMessage,
    posts,
    representativePost,
    emotionDistribution: buildEmotionDistribution(posts),
    postsWarning: null,
  };
}

export async function localCreatePost(input: {
  stockId: string;
  content: string;
  emotionTag: string | null;
  writerHash: string;
  marketDate: string;
  marketType: MarketType;
}) {
  const state = await ensureState();
  const stock = state.stocks.find((item) => item.id === input.stockId) ?? null;
  if (!stock) return { error: "종목을 찾을 수 없습니다." as const };

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const localWriterPosts = state.posts.filter((post) => {
    const writer = (post as Post & { anonymous_writer_hash?: string }).anonymous_writer_hash;
    return writer === input.writerHash && post.stock_id === input.stockId && +new Date(post.created_at) >= oneDayAgo;
  });

  if (localWriterPosts.length >= 3) {
    return { error: "한 종목에는 24시간 동안 최대 3줄까지 작성할 수 있습니다." as const };
  }
  if (localWriterPosts.some((post) => post.content === input.content)) {
    return { error: "같은 문장은 24시간 안에 다시 올릴 수 없습니다." as const };
  }

  const createdAt = new Date().toISOString();
  const post = {
    id: randomUUID(),
    stock_id: input.stockId,
    content: input.content,
    emotion_tag: input.emotionTag,
    market_type: input.marketType,
    market_date: input.marketDate,
    created_at: createdAt,
    empathy_count: 0,
    stock: { id: stock.id, symbol: stock.symbol, name: stock.name, market_type: stock.market_type },
    anonymous_writer_hash: input.writerHash,
  } as Post & { anonymous_writer_hash: string };

  state.posts.unshift(post);
  await saveState(state);
  return { post };
}

export async function localAddEmpathy(input: { postId: string; sessionHash: string }) {
  const state = await ensureState();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const count = state.reactions.filter(
    (reaction) => reaction.session_hash === input.sessionHash && +new Date(reaction.created_at) >= oneDayAgo,
  ).length;
  if (count >= 150) return { error: "공감 요청이 너무 많습니다." as const };
  if (state.reactions.some((reaction) => reaction.post_id === input.postId && reaction.session_hash === input.sessionHash)) {
    return { error: "이미 공감한 한줄입니다." as const };
  }

  const post = state.posts.find((item) => item.id === input.postId);
  if (!post) return { error: "한줄을 찾을 수 없습니다." as const };

  post.empathy_count += 1;
  state.reactions.push({
    id: randomUUID(),
    post_id: input.postId,
    session_hash: input.sessionHash,
    reaction_type: "empathy",
    created_at: new Date().toISOString(),
  });
  await saveState(state);
  return { empathyCount: post.empathy_count };
}

export async function localHomeFeed(
  marketStatus: Record<MarketType, MarketStatus>,
): Promise<HomeFeed> {
  const state = await ensureState();
  const posts = sortPosts(state.posts.filter((post) => post.market_type === "KR"));
  const hotLines = [...posts]
    .sort((a, b) => bestLineScore(b) - bestLineScore(a) || +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 9);
  const quoteOfTheDay = hotLines[0] ?? null;
  return {
    quoteOfTheDay,
    topMentionedKR: buildTopMentioned("KR", posts),
    topMentionedUS: [],
    hotLines,
    recentlyClosedMarket: "KR",
    quoteDate: quoteOfTheDay?.market_date ?? null,
    quoteIsFallback: true,
    topMentionedKRDate: latestDate("KR", posts),
    topMentionedUSDate: null,
    marketSentimentKR: buildMarketSentiment(posts, "KR"),
    marketSentimentUS: [],
    marketStatus,
  };
}

import type { NextRequest } from "next/server";

const BLOCKED_KEYWORDS = ["http", "www", "casino", "loan", "sex"];
const MIN_REQUEST_INTERVAL_MS = 1000;

const requestBuckets = new Map<string, number[]>();
const lastRequestAt = new Map<string, number>();
const empathyIpPostSeen = new Map<string, number>();

type RateLimitConfig = {
  action: string;
  ip: string;
  limit: number;
  windowMs: number;
};

function pruneTimestamps(map: Map<string, number[]>, key: string, now: number, windowMs: number) {
  const next = (map.get(key) ?? []).filter((value) => now - value < windowMs);
  map.set(key, next);
  return next;
}

export function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export function rejectTooFastRequest(action: string, ip: string) {
  const now = Date.now();
  const key = `${action}:${ip}`;
  const last = lastRequestAt.get(key) ?? 0;
  lastRequestAt.set(key, now);
  return now - last < MIN_REQUEST_INTERVAL_MS;
}

export function hitRateLimit({ action, ip, limit, windowMs }: RateLimitConfig) {
  const now = Date.now();
  const key = `${action}:${ip}`;
  const bucket = pruneTimestamps(requestBuckets, key, now, windowMs);
  bucket.push(now);
  requestBuckets.set(key, bucket);
  return bucket.length > limit;
}

export function containsBlockedKeyword(content: string) {
  const normalized = content.toLowerCase();
  return BLOCKED_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function hasEmpathyByIp(ip: string, postId: string) {
  const now = Date.now();
  const key = `${ip}:${postId}`;
  const seenAt = empathyIpPostSeen.get(key);
  if (!seenAt) return false;
  if (now - seenAt > 24 * 60 * 60 * 1000) {
    empathyIpPostSeen.delete(key);
    return false;
  }
  return true;
}

export function markEmpathyByIp(ip: string, postId: string) {
  empathyIpPostSeen.set(`${ip}:${postId}`, Date.now());
}

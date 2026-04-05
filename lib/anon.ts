import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";

export const ANON_COOKIE = "anon_330";

export function getOrCreateAnonId(request: NextRequest) {
  const existing = request.cookies.get(ANON_COOKIE)?.value;
  if (existing) return { anonId: existing, isNew: false };
  return { anonId: randomUUID(), isNew: true };
}

export function anonHash(anonId: string) {
  const env = getServerEnv();
  return createHash("sha256").update(`${anonId}:${env.ANON_HASH_SALT}`).digest("hex");
}

#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import os
import random
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")
ETF_PREFIXES = ("KODEX", "TIGER", "KOSEF", "KBSTAR", "RISE", "SOL", "ACE", "ARIRANG", "HANARO", "TIMEFOLIO")


@dataclass
class StockRow:
    id: str
    symbol: str
    name: str
    exchange: str
    last_close: float
    change_rate: float


def request_json(url: str, headers: dict[str, str], *, method: str = "GET", payload: Optional[object] = None) -> object:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, headers=headers, method=method, data=data)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def supabase_headers(service_key: str, *, minimal: bool = False) -> dict[str, str]:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    headers["Prefer"] = "return=minimal" if minimal else "return=representation"
    return headers


def fetch_kr_stocks(base_url: str, service_key: str) -> list[StockRow]:
    query = urllib.parse.urlencode(
        {
            "select": "id,symbol,name,exchange,last_close,change_rate",
            "market_type": "eq.KR",
            "is_active": "eq.true",
            "last_close": "not.is.null",
            "order": "created_at.asc",
            "limit": "1000",
        }
    )
    url = f"{base_url}/rest/v1/stocks?{query}"
    payload = request_json(url, supabase_headers(service_key))
    if not isinstance(payload, list):
        raise RuntimeError("failed to load KR stocks")

    rows: list[StockRow] = []
    for row in payload:
        try:
            rows.append(
                StockRow(
                    id=str(row["id"]),
                    symbol=str(row["symbol"]),
                    name=str(row["name"]),
                    exchange=str(row["exchange"]),
                    last_close=float(row["last_close"]),
                    change_rate=float(row.get("change_rate") or 0),
                )
            )
        except Exception:
            continue
    return rows


def fetch_existing_hashes(base_url: str, service_key: str, market_date: str) -> set[str]:
    pattern = f"daily_auto_{market_date.replace('-', '')}_*"
    query = urllib.parse.urlencode(
        {
            "select": "anonymous_writer_hash",
            "market_type": "eq.KR",
            "market_date": f"eq.{market_date}",
            "anonymous_writer_hash": f"like.{pattern}",
            "limit": "200",
        }
    )
    url = f"{base_url}/rest/v1/posts?{query}"
    payload = request_json(url, supabase_headers(service_key))
    if not isinstance(payload, list):
        return set()
    return {str(row["anonymous_writer_hash"]) for row in payload if isinstance(row, dict) and row.get("anonymous_writer_hash")}


def is_etf(stock: StockRow) -> bool:
    return stock.name.startswith(ETF_PREFIXES)


def price_text(price: float) -> str:
    rounded = int(round(price))
    if rounded >= 10000:
        man = rounded // 10000
        rest = rounded % 10000
        if rest == 0:
            return f"{man}만원"
        return f"{man}만 {rest:,}원"
    return f"{rounded:,}원"


def choose_emotion(change_rate: float, rng: random.Random) -> str:
    if change_rate >= 2:
      return rng.choice(["확신", "상승예상"])
    if change_rate >= 0.5:
      return "상승예상"
    if change_rate <= -2:
      return rng.choice(["불안", "후회"])
    if change_rate <= -0.5:
      return "불안"
    return rng.choice(["후회", "불안"])


def text_templates(stock: StockRow) -> dict[str, list[str]]:
    name = stock.name
    close = price_text(stock.last_close)
    rate = f"{stock.change_rate:+.2f}%"

    if is_etf(stock):
        return {
            "up": [
                f"{name}가 {close}까지 올라온 날이면 오늘은 수급이 꽤 선명했다",
                f"{close} 종가면 {name}은 눌려도 다시 보려는 자금이 붙는 자리다",
                f"{name}이 {rate} 오른 흐름이면 단기 탄력은 아직 살아 있다",
            ],
            "down": [
                f"{name}이 {close}까지 밀리면 추격보다 한 템포 쉬는 게 낫다",
                f"{rate} 빠진 날에는 {name}도 반등 확인 후 접근하는 편이 안전하다",
                f"{name}이 {close}면 오늘은 무리한 추종보다 현금 비중이 먼저다",
            ],
            "flat": [
                f"{name}이 {close} 근처면 방향보다 거래대금 확인이 먼저다",
                f"{name}이 크게 못 움직인 날은 서두르지 않아도 된다",
            ],
        }

    return {
        "up": [
            f"{name} 종가가 {close}면 오늘은 매수세가 분명히 살아 있었다",
            f"{name}이 {rate} 오른 흐름이면 눌려도 다시 보려는 수급이 남아 있다",
            f"{close}까지 올라온 종가면 {name}은 추세가 완전히 꺾인 자리는 아니다",
        ],
        "down": [
            f"{name}이 {close}까지 밀린 날이면 단기 매수는 한 템포 늦추는 게 낫다",
            f"{rate} 밀린 흐름이면 {name}은 반등보다 지지 확인이 먼저다",
            f"{name}이 {close}면 성급한 추격보다 다음 수급을 보는 편이 낫다",
        ],
        "flat": [
            f"{name}이 {close} 근처면 지금은 방향보다 수급 확인이 먼저다",
            f"{name}은 {close} 부근에서 눈치 보기 장세가 이어지는 느낌이다",
        ],
    }


def generate_content(stock: StockRow, rng: random.Random) -> tuple[str, str]:
    templates = text_templates(stock)
    if stock.change_rate >= 0.75:
        content = rng.choice(templates["up"])
    elif stock.change_rate <= -0.75:
        content = rng.choice(templates["down"])
    else:
        content = rng.choice(templates["flat"])
    emotion = choose_emotion(stock.change_rate, rng)
    return content[:120], emotion


def pick_stocks(stocks: list[StockRow], count: int, market_date: str) -> list[StockRow]:
    rng = random.Random(f"kr-daily-{market_date}")
    etfs = [stock for stock in stocks if is_etf(stock)]
    names = [stock for stock in stocks if not is_etf(stock)]

    names.sort(key=lambda row: (abs(row.change_rate), row.last_close), reverse=True)
    etfs.sort(key=lambda row: (abs(row.change_rate), row.last_close), reverse=True)

    picked: list[StockRow] = []
    name_quota = min(max(count - 5, 0), len(names))
    etf_quota = min(count - name_quota, len(etfs))

    if name_quota:
        picked.extend(rng.sample(names[: min(len(names), 80)], k=name_quota))
    if etf_quota:
        picked.extend(rng.sample(etfs[: min(len(etfs), 20)], k=etf_quota))

    if len(picked) < count:
        remaining = [stock for stock in stocks if stock.id not in {item.id for item in picked}]
        remaining.sort(key=lambda row: (abs(row.change_rate), row.last_close), reverse=True)
        picked.extend(remaining[: count - len(picked)])

    rng.shuffle(picked)
    return picked[:count]


def build_rows(stocks: list[StockRow], market_date: str, count: int) -> list[dict[str, object]]:
    chosen = pick_stocks(stocks, count, market_date)
    rows: list[dict[str, object]] = []
    rng = random.Random(f"kr-daily-copy-{market_date}")

    for index, stock in enumerate(chosen, start=1):
        content, emotion = generate_content(stock, rng)
        rows.append(
            {
                "stock_id": stock.id,
                "content": content,
                "emotion_tag": emotion,
                "anonymous_writer_hash": f"daily_auto_{market_date.replace('-', '')}_{index:02d}",
                "market_date": market_date,
                "market_type": "KR",
                "empathy_count": rng.randint(2, 9),
            }
        )

    return rows


def patch_post(base_url: str, service_key: str, anonymous_hash: str, row: dict[str, object]) -> None:
    query = urllib.parse.urlencode({"anonymous_writer_hash": f"eq.{anonymous_hash}"})
    url = f"{base_url}/rest/v1/posts?{query}"
    request_json(url, supabase_headers(service_key), method="PATCH", payload=row)


def insert_posts(base_url: str, service_key: str, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    url = f"{base_url}/rest/v1/posts"
    request_json(url, supabase_headers(service_key), method="POST", payload=rows)


def sync_posts(base_url: str, service_key: str, rows: list[dict[str, object]], existing_hashes: set[str]) -> dict[str, int]:
    inserted: list[dict[str, object]] = []
    updated = 0

    for row in rows:
        anonymous_hash = str(row["anonymous_writer_hash"])
        if anonymous_hash in existing_hashes:
            patch_post(base_url, service_key, anonymous_hash, row)
            updated += 1
        else:
            inserted.append(row)

    insert_posts(base_url, service_key, inserted)
    return {"inserted": len(inserted), "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    market_date = args.date or dt.datetime.now(KST).date().isoformat()
    stocks = fetch_kr_stocks(base_url, service_key)
    rows = build_rows(stocks, market_date, args.count)

    if args.dry_run:
        print(json.dumps({"market_date": market_date, "count": len(rows), "sample": rows[:3]}, ensure_ascii=False))
        return

    existing_hashes = fetch_existing_hashes(base_url, service_key, market_date)
    result = sync_posts(base_url, service_key, rows, existing_hashes)
    print(json.dumps({"market_date": market_date, "count": len(rows), **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()

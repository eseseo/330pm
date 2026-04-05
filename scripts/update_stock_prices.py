#!/usr/bin/env python3

import argparse
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from typing import Iterator, Optional


BATCH_SIZE = 100
UPSERT_CHUNK_SIZE = 500
KR_SYMBOL_PATTERN = re.compile(r"^\d{6}$")
US_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.\-]+$")


def request_json(url: str, headers: dict[str, str]) -> object:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_all_stocks(base_url: str, service_key: str) -> list[dict[str, object]]:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    page_size = 1000
    offset = 0
    rows: list[dict[str, object]] = []

    while True:
        url = f"{base_url}/rest/v1/stocks?select=id,symbol,market_type,exchange&order=created_at.asc&limit={page_size}&offset={offset}"
        batch = request_json(url, headers)
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def yahoo_symbol(row: dict[str, object]) -> str:
    symbol = str(row["symbol"])
    if row["market_type"] == "KR":
        suffix = ".KS" if row["exchange"] == "KOSPI" else ".KQ"
        return f"{symbol}{suffix}"
    return symbol


def is_supported_symbol(row: dict[str, object]) -> bool:
    symbol = str(row["symbol"]).upper()
    if row["market_type"] == "KR":
        return bool(KR_SYMBOL_PATTERN.fullmatch(symbol))
    return bool(US_SYMBOL_PATTERN.fullmatch(symbol))


def chunked(items: list[dict[str, object]], size: int) -> Iterator[list[dict[str, object]]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def parse_price_item(item: dict[str, object]) -> tuple[Optional[float], Optional[float]]:
    try:
        response = item["response"][0]
        meta = response.get("meta", {})
        last_close = meta.get("regularMarketPrice")
        previous_close = meta.get("chartPreviousClose")
        if last_close is None:
            quotes = response.get("indicators", {}).get("quote", [{}])
            closes = quotes[0].get("close") or []
            if closes:
                last_close = closes[-1]
        if last_close is None:
            return None, None

        if previous_close in (None, 0):
            last_close = float(last_close)
            if not math.isfinite(last_close):
                return None, None
            return last_close, None

        last_close = float(last_close)
        previous_close = float(previous_close)
        change_rate = ((last_close - previous_close) / previous_close) * 100
        if not math.isfinite(last_close) or not math.isfinite(change_rate):
            return None, None
        return last_close, round(change_rate, 2)
    except Exception:
        return None, None


def fetch_prices(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    updates: list[dict[str, object]] = []
    candidates = [row for row in rows if is_supported_symbol(row)]
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
    }

    total_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_index, batch in enumerate(chunked(candidates, BATCH_SIZE), start=1):
        mapping = {yahoo_symbol(row): row for row in batch}
        try:
            results = fetch_spark_results(mapping, headers)
        except HTTPError:
            results = []
            for row in batch:
                single_mapping = {yahoo_symbol(row): row}
                try:
                    results.extend(fetch_spark_results(single_mapping, headers))
                except HTTPError:
                    continue

        for item in results:
            symbol = item.get("symbol")
            if symbol not in mapping:
                continue
            last_close, change_rate = parse_price_item(item)
            if last_close is None:
                continue

            updates.append(
                {
                    "id": mapping[symbol]["id"],
                    "last_close": round(last_close, 2),
                    "change_rate": change_rate,
                }
            )

        if batch_index == 1 or batch_index % 10 == 0 or batch_index == total_batches:
            print(
                json.dumps(
                    {
                        "price_batch": batch_index,
                        "total_batches": total_batches,
                        "updates_so_far": len(updates),
                    }
                ),
                flush=True,
            )

        time.sleep(0.1)

    return updates


def fetch_spark_results(mapping: dict[str, dict[str, object]], headers: dict[str, str]) -> list[dict[str, object]]:
    symbols = ",".join(mapping.keys())
    url = f"https://query1.finance.yahoo.com/v7/finance/spark?symbols={urllib.parse.quote(symbols, safe=',')}&range=1d&interval=1d"
    payload = request_json(url, headers)
    return payload.get("spark", {}).get("result", []) if isinstance(payload, dict) else []


def upsert_prices(base_url: str, service_key: str, rows: list[dict[str, object]]):
    url = f"{base_url}/rest/v1/stocks?on_conflict=id"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    for batch in chunked(rows, UPSERT_CHUNK_SIZE):
        request = urllib.request.Request(
            url,
            data=json.dumps(batch).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status not in {200, 201, 204}:
                raise RuntimeError("Price upsert failed")


def fetch_price_coverage(base_url: str, service_key: str) -> dict[str, int]:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    queries = {
        "priced_total": "last_close=not.is.null",
        "priced_kr": "market_type=eq.KR&last_close=not.is.null",
        "priced_us": "market_type=eq.US&last_close=not.is.null",
    }
    counts: dict[str, int] = {}
    for label, query in queries.items():
        url = f"{base_url}/rest/v1/stocks?select=id&{query}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            counts[label] = int(response.headers["content-range"].split("/")[-1])
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=["ALL", "KR", "US"], default="ALL")
    args = parser.parse_args()

    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    stocks = fetch_all_stocks(base_url, service_key)
    if args.market != "ALL":
        stocks = [stock for stock in stocks if stock["market_type"] == args.market]
    print(json.dumps({"stocks": len(stocks)}), flush=True)
    updates = fetch_prices(stocks)
    print(json.dumps({"price_updates": len(updates)}), flush=True)
    upsert_prices(base_url, service_key, updates)
    print(json.dumps(fetch_price_coverage(base_url, service_key)), flush=True)


if __name__ == "__main__":
    main()

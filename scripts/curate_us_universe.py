#!/usr/bin/env python3

import json
import os
import re
import urllib.parse
import urllib.request
from html import unescape
from typing import Dict, List, Optional, Tuple


def fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def clean_number(raw: str) -> Optional[float]:
    value = raw.replace(",", "").replace("%", "").replace("(", "").replace(")", "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_slickcharts_index(url: str, limit: int) -> List[dict]:
    html = fetch_html(url)
    body_match = re.search(r"<tbody>(.*?)</tbody>", html, re.S)
    if not body_match:
        raise RuntimeError(f"Failed to parse table body from {url}")

    row_pattern = re.compile(
        r"<tr><td>\d+</td><td.*?><a href=\"/symbol/[^>]+\">(.*?)</a></td><td><a href=\"/symbol/([^\">]+)\">.*?</a></td><td>.*?</td><td class=\"text-nowrap\">.*?([0-9][0-9,]*\.?[0-9]*)</td><td class=\"text-nowrap\".*?>.*?</td><td class=\"text-nowrap\".*?>\(([-0-9.]+%)\)</td></tr>",
        re.S,
    )

    rows = []
    for name, symbol, price, change_rate in row_pattern.findall(body_match.group(1)):
        rows.append(
            {
                "symbol": symbol.strip(),
                "name": unescape(name).strip(),
                "last_close": clean_number(price),
                "change_rate": clean_number(change_rate),
            }
        )
        if len(rows) >= limit:
            break

    return rows


def request_json(url: str) -> object:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def request(url: str, method: str, service_key: str, data: Optional[bytes] = None, prefer: Optional[str] = None):
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read(), response.headers


def fetch_existing_us(base_url: str, service_key: str) -> Dict[str, dict]:
    payload, _ = request(
        f"{base_url}/rest/v1/stocks?select=id,symbol,name,exchange,market_type&market_type=eq.US",
        "GET",
        service_key,
    )
    rows = json.loads(payload.decode("utf-8"))
    return {row["symbol"]: row for row in rows}


def deactivate_us(base_url: str, service_key: str):
    payload = json.dumps({"is_active": False}).encode("utf-8")
    request(
        f"{base_url}/rest/v1/stocks?market_type=eq.US",
        "PATCH",
        service_key,
        payload,
    )


def upsert_rows(base_url: str, service_key: str, rows: List[dict]):
    payload = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    request(
        f"{base_url}/rest/v1/stocks?on_conflict=symbol,market_type",
        "POST",
        service_key,
        payload,
        "resolution=merge-duplicates,return=minimal",
    )


def fetch_active_summary(base_url: str, service_key: str) -> Dict[str, int]:
    summary = {}
    queries = {
        "US_active": "market_type=eq.US&is_active=eq.true",
        "ETF_active": "market_type=eq.US&exchange=eq.ETF&is_active=eq.true",
        "TOTAL_active": "is_active=eq.true",
    }
    for label, query in queries.items():
        _, headers = request(
            f"{base_url}/rest/v1/stocks?select=id&{query}",
            "GET",
            service_key,
            prefer="count=exact",
        )
        summary[label] = int(headers.get("content-range", "0-0/0").split("/")[-1])
    return summary


def main():
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    existing = fetch_existing_us(base_url, service_key)
    sp500 = parse_slickcharts_index("https://www.slickcharts.com/sp500", 500)
    nasdaq100 = parse_slickcharts_index("https://www.slickcharts.com/nasdaq100", 100)
    nasdaq100_symbols = {row["symbol"] for row in nasdaq100}

    combined: Dict[str, dict] = {}

    for row in sp500:
        symbol = row["symbol"]
        combined[symbol] = {
            "symbol": symbol,
            "name": row["name"],
            "market_type": "US",
            "exchange": existing.get(symbol, {}).get("exchange", "NASDAQ" if symbol in nasdaq100_symbols else "NYSE"),
            "last_close": row["last_close"],
            "change_rate": row["change_rate"],
            "is_active": True,
        }

    print(
        json.dumps(
            {
                "curated": {
                    "SP500": len(sp500),
                    "US_UNIQUE": len(combined),
                }
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    deactivate_us(base_url, service_key)
    upsert_rows(base_url, service_key, list(combined.values()))
    print(json.dumps({"active_summary": fetch_active_summary(base_url, service_key)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

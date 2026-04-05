#!/usr/bin/env python3

import json
import os
import re
import urllib.request
from html import unescape
from pathlib import Path
from typing import Optional


PAGE_SIZE = 50
KOSPI_TARGET = 200
KOSDAQ_TARGET = 100
EXTRA_KR_ETF_SYMBOLS = [
    "122630",  # KODEX 레버리지
    "233740",  # KODEX 코스닥150레버리지
    "252670",  # KODEX 200선물인버스2X
    "114800",  # KODEX 인버스
    "229200",  # KODEX 코스닥150
    "069500",  # KODEX 200
    "133690",  # TIGER 미국나스닥100
    "379810",  # KODEX 미국나스닥100
    "360750",  # TIGER 미국S&P500
    "379800",  # KODEX 미국S&P500
    "381180",  # TIGER 미국필라델피아반도체나스닥
    "091160",  # KODEX 반도체
]
CURATED_JSON_FILE = Path(__file__).resolve().parent.parent / "data" / "kr-curated.json"
EXTRA_KR_ETF_OVERRIDES = {
    "252670": "KODEX 200선물인버스2X",
    "114800": "KODEX 인버스",
}


def fetch_html(sosok: int, page: int) -> str:
    url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("euc-kr", errors="ignore")


def clean_number(raw: str) -> Optional[float]:
    value = raw.replace(",", "").replace("%", "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_page(html: str) -> list[dict[str, object]]:
    row_pattern = re.compile(r"<a href=\"/item/main\.naver\?code=(\w+)\" class=\"tltle\">(.*?)</a></td>(.*?)(?:</tr>)", re.S)
    number_pattern = re.compile(r"<td class=\"number\">(.*?)</td>", re.S)

    items: list[dict[str, object]] = []
    for code, name, tail in row_pattern.findall(html):
        numbers = number_pattern.findall(tail)
        if len(numbers) < 4:
            continue

        price = clean_number(re.sub(r"<.*?>", "", numbers[0]))
        change_rate = clean_number(re.sub(r"<.*?>", "", numbers[2]))
        if price is None:
            continue

        items.append(
            {
                "symbol": code,
                "name": unescape(re.sub(r"<.*?>", "", name)).strip(),
                "last_close": round(price, 2),
                "change_rate": change_rate,
            }
        )

    return items


def fetch_market_top(sosok: int, total: int) -> list[dict[str, object]]:
    pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    rows: list[dict[str, object]] = []
    for page in range(1, pages + 1):
        rows.extend(parse_page(fetch_html(sosok, page)))
    return rows[:total]


def fetch_mobile_basic(code: str) -> Optional[dict[str, object]]:
    url = f"https://m.stock.naver.com/api/stock/{code}/basic"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def load_extra_kr_etfs() -> list[dict[str, object]]:
    if not CURATED_JSON_FILE.exists():
        return []

    rows = json.loads(CURATED_JSON_FILE.read_text())
    extras: list[dict[str, object]] = []
    for symbol in EXTRA_KR_ETF_SYMBOLS:
        match = next((row for row in rows if row.get("symbol") == symbol), None)
        if not match:
            mobile = fetch_mobile_basic(symbol)
            if not mobile:
                continue
            extras.append(
                {
                    "symbol": symbol,
                    "name": mobile.get("stockName") or EXTRA_KR_ETF_OVERRIDES.get(symbol, symbol),
                    "market_type": "KR",
                    "exchange": "KOSPI",
                    "last_close": clean_number(str(mobile.get("closePrice", "")).replace(",", "")),
                    "change_rate": clean_number(str(mobile.get("fluctuationsRatio", ""))),
                    "is_active": True,
                }
            )
            continue
        extras.append(
            {
                "symbol": match["symbol"],
                "name": match["name"],
                "market_type": "KR",
                "exchange": match.get("exchange", "KOSPI"),
                "last_close": match.get("last_close"),
                "change_rate": match.get("change_rate"),
                "is_active": True,
            }
        )
    return extras


def request(
    url: str,
    method: str,
    service_key: str,
    data: Optional[bytes] = None,
    prefer: Optional[str] = None,
):
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


def deactivate_non_curated(base_url: str, service_key: str):
    payload = json.dumps({"is_active": False}).encode("utf-8")
    request(
        f"{base_url}/rest/v1/stocks?id=not.is.null",
        "PATCH",
        service_key,
        payload,
    )


def upsert_curated(base_url: str, service_key: str, rows: list[dict[str, object]]):
    payload = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    request(
        f"{base_url}/rest/v1/stocks?on_conflict=symbol,market_type",
        "POST",
        service_key,
        payload,
        "resolution=merge-duplicates,return=minimal",
    )


def fetch_active_summary(base_url: str, service_key: str) -> dict[str, int]:
    summary: dict[str, int] = {}
    queries = {
        "KOSPI_active": "market_type=eq.KR&exchange=eq.KOSPI&is_active=eq.true",
        "KOSDAQ_active": "market_type=eq.KR&exchange=eq.KOSDAQ&is_active=eq.true",
        "KR_total_active": "market_type=eq.KR&is_active=eq.true",
        "US_active": "market_type=eq.US&is_active=eq.true",
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

    kospi = fetch_market_top(0, KOSPI_TARGET)
    kosdaq = fetch_market_top(1, KOSDAQ_TARGET)
    extra_etfs = load_extra_kr_etfs()

    curated_rows = [
        {
            "symbol": row["symbol"],
            "name": row["name"],
            "market_type": "KR",
            "exchange": "KOSPI",
            "last_close": row["last_close"],
            "change_rate": row["change_rate"],
            "is_active": True,
        }
        for row in kospi
    ] + [
        {
            "symbol": row["symbol"],
            "name": row["name"],
            "market_type": "KR",
            "exchange": "KOSDAQ",
            "last_close": row["last_close"],
            "change_rate": row["change_rate"],
            "is_active": True,
        }
        for row in kosdaq
    ]

    existing_symbols = {row["symbol"] for row in curated_rows}
    curated_rows.extend([row for row in extra_etfs if row["symbol"] not in existing_symbols])

    print(
        json.dumps(
            {"curated": {"KOSPI": len(kospi), "KOSDAQ": len(kosdaq), "ETF_EXTRA": len(curated_rows) - len(kospi) - len(kosdaq), "TOTAL": len(curated_rows)}},
            ensure_ascii=False,
        ),
        flush=True,
    )
    deactivate_non_curated(base_url, service_key)
    upsert_curated(base_url, service_key, curated_rows)
    print(json.dumps({"active_summary": fetch_active_summary(base_url, service_key)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

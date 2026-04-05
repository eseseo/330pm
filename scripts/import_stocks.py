#!/usr/bin/env python3

import csv
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser


KRX_URLS = {
    "KOSPI": "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=stockMkt",
    "KOSDAQ": "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=kosdaqMkt",
}
NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
CHUNK_SIZE = 500


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_cell = False
        self.current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current_row = []
        elif tag in {"td", "th"}:
            self.in_cell = True
            self.current_row.append("")

    def handle_endtag(self, tag):
        if tag == "tr" and self.current_row:
            self.rows.append([cell.strip() for cell in self.current_row])
            self.current_row = []
        elif tag in {"td", "th"}:
            self.in_cell = False

    def handle_data(self, data):
        if self.in_cell and self.current_row:
            self.current_row[-1] += data


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request) as response:
        return response.read()


def parse_krx(exchange: str) -> list[dict[str, object]]:
    raw = fetch(KRX_URLS[exchange]).decode("euc-kr", errors="replace")
    parser = TableParser()
    parser.feed(raw)

    if not parser.rows:
        raise RuntimeError(f"{exchange} source did not return any rows")

    header = parser.rows[0]
    try:
        name_index = header.index("회사명")
        symbol_index = header.index("종목코드")
    except ValueError as exc:
        raise RuntimeError(f"{exchange} source header changed: {header[:5]}") from exc

    rows: list[dict[str, object]] = []
    for row in parser.rows[1:]:
        if len(row) <= max(name_index, symbol_index):
            continue
        name = row[name_index].strip()
        symbol = row[symbol_index].strip()
        if not name or not symbol:
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "market_type": "KR",
                "exchange": exchange,
                "is_active": True,
            }
        )

    return rows


def is_supported_nasdaq_issue(name: str) -> bool:
    blocked_terms = [
        " warrant",
        " warrants",
        " right",
        " rights",
        " unit",
        " units",
    ]
    lowered = name.lower()
    return not any(term in lowered for term in blocked_terms)


def parse_nasdaq() -> list[dict[str, object]]:
    raw = fetch(NASDAQ_URL).decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(raw), delimiter="|")

    rows: list[dict[str, object]] = []
    for row in reader:
        symbol = (row.get("Symbol") or "").strip()
        name = (row.get("Security Name") or "").strip()
        etf_flag = (row.get("ETF") or "").strip()
        test_issue = (row.get("Test Issue") or "").strip()

        if not symbol or symbol == "File Creation Time":
            continue
        if test_issue == "Y" or etf_flag == "Y":
            continue
        if not is_supported_nasdaq_issue(name):
            continue

        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "market_type": "US",
                "exchange": "NASDAQ",
                "is_active": True,
            }
        )

    return rows


def dedupe(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    bucket: dict[tuple[str, str], dict[str, object]] = {}
    for row in rows:
        bucket[(str(row["symbol"]), str(row["market_type"]))] = row
    return list(bucket.values())


def postgrest_upsert(base_url: str, service_key: str, rows: list[dict[str, object]]):
    encoded_conflict = urllib.parse.quote("symbol,market_type", safe=",")
    url = f"{base_url}/rest/v1/stocks?on_conflict={encoded_conflict}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    for index in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[index : index + CHUNK_SIZE]
        request = urllib.request.Request(
            url,
            data=json.dumps(chunk, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            if response.status not in {200, 201, 204}:
                raise RuntimeError(f"Upsert failed for chunk {index // CHUNK_SIZE + 1}")


def fetch_counts(base_url: str, service_key: str) -> dict[str, int]:
    summary: dict[str, int] = {}
    queries = {
        "KOSPI": "market_type=eq.KR&exchange=eq.KOSPI",
        "KOSDAQ": "market_type=eq.KR&exchange=eq.KOSDAQ",
        "NASDAQ": "market_type=eq.US&exchange=eq.NASDAQ",
        "TOTAL": "",
    }

    for label, query in queries.items():
        url = f"{base_url}/rest/v1/stocks?select=id"
        if query:
            url = f"{url}&{query}"

        request = urllib.request.Request(
            url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Prefer": "count=exact",
                "Range": "0-0",
            },
        )
        with urllib.request.urlopen(request) as response:
            content_range = response.headers.get("content-range", "0-0/0")
            total = int(content_range.split("/")[-1])
            summary[label] = total

    return summary


def main():
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    print("Fetching KOSPI...")
    kospi = parse_krx("KOSPI")
    print("Fetching KOSDAQ...")
    kosdaq = parse_krx("KOSDAQ")
    print("Fetching NASDAQ...")
    nasdaq = parse_nasdaq()

    all_rows = dedupe(kospi + kosdaq + nasdaq)
    print(
        json.dumps(
            {
                "fetched": {
                    "KOSPI": len(kospi),
                    "KOSDAQ": len(kosdaq),
                    "NASDAQ": len(nasdaq),
                    "TOTAL_UNIQUE": len(all_rows),
                }
            },
            ensure_ascii=False,
        )
    )

    postgrest_upsert(base_url, service_key, all_rows)
    counts = fetch_counts(base_url, service_key)
    print(json.dumps({"db_counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()

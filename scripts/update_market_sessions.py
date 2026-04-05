#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import os
import urllib.request
from urllib.error import HTTPError
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo


MARKET_TIMEZONES = {
    "KR": ZoneInfo("Asia/Seoul"),
    "US": ZoneInfo("America/New_York"),
}

DEFAULT_CLOSE_TIMES = {
    "KR": (15, 30),
    "US": (16, 0),
}

DEFAULT_NEXT_OPEN_TIMES = {
    "KR": (9, 0),
    "US": (9, 30),
}


def daterange(start: dt.date, end: dt.date):
    current = start
    while current <= end:
        yield current
        current += dt.timedelta(days=1)


def is_weekday(day: dt.date) -> bool:
    return day.weekday() < 5


def isoformat_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def load_calendar_overrides(path: Optional[str]) -> dict[str, object]:
    if not path:
        return {"markets": {}}

    raw = Path(path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise SystemExit("calendar override file must contain a JSON object")
    return payload


def market_overrides(payload: dict[str, object], market: str) -> dict[str, object]:
    markets = payload.get("markets", {})
    if not isinstance(markets, dict):
        return {}
    overrides = markets.get(market, {})
    return overrides if isinstance(overrides, dict) else {}


def is_closed_day(session_date: dt.date, overrides: dict[str, object]) -> bool:
    closed_dates = overrides.get("closed_dates", [])
    if not isinstance(closed_dates, list):
        return False
    return session_date.isoformat() in {value for value in closed_dates if isinstance(value, str)}


def next_open_datetime(market: str, session_date: dt.date) -> dt.datetime:
    next_day = session_date + dt.timedelta(days=1)
    hour, minute = DEFAULT_NEXT_OPEN_TIMES[market]
    return dt.datetime(next_day.year, next_day.month, next_day.day, hour, minute, tzinfo=MARKET_TIMEZONES[market])


def close_datetime(market: str, session_date: dt.date, overrides: dict[str, object]) -> dt.datetime:
    early_closes = overrides.get("early_closes", {})
    close_hour, close_minute = DEFAULT_CLOSE_TIMES[market]

    if isinstance(early_closes, dict):
        override = early_closes.get(session_date.isoformat())
        if isinstance(override, str):
            parts = override.split(":")
            if len(parts) == 2:
                close_hour = int(parts[0])
                close_minute = int(parts[1])

    return dt.datetime(
        session_date.year,
        session_date.month,
        session_date.day,
        close_hour,
        close_minute,
        tzinfo=MARKET_TIMEZONES[market],
    )


def write_window_for_market(market: str, session_date: dt.date, overrides: dict[str, object]) -> tuple[str, str]:
    write_open = close_datetime(market, session_date, overrides)
    write_close = next_open_datetime(market, session_date)
    return isoformat_utc(write_open), isoformat_utc(write_close)


def build_rows(start: dt.date, end: dt.date, calendar: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for session_date in daterange(start, end):
        if not is_weekday(session_date):
            continue
        for market in ("KR", "US"):
            overrides = market_overrides(calendar, market)
            if is_closed_day(session_date, overrides):
                continue
            write_open_at, write_close_at = write_window_for_market(market, session_date, overrides)
            rows.append(
                {
                    "market_type": market,
                    "session_date": session_date.isoformat(),
                    "write_open_at": write_open_at,
                    "write_close_at": write_close_at,
                    "is_write_open": True,
                }
            )
    return rows


def upsert_market_sessions(base_url: str, service_key: str, rows: list[dict[str, object]]) -> None:
    url = f"{base_url}/rest/v1/market_sessions?on_conflict=market_type,session_date"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    request = urllib.request.Request(url, data=json.dumps(rows).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status not in {200, 201, 204}:
                raise RuntimeError("market session upsert failed")
            return
    except HTTPError as error:
        body = error.read().decode("utf-8")
        if error.code != 400 or "ON CONFLICT" not in body:
            raise

    count_request = urllib.request.Request(
        f"{base_url}/rest/v1/market_sessions?select=id",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "count=exact",
            "Range": "0-0",
        },
    )
    with urllib.request.urlopen(count_request, timeout=30) as response:
        existing_rows = int(response.headers["content-range"].split("/")[-1])

    if existing_rows != 0:
        raise RuntimeError("market_sessions table needs the unique constraint before safe upserts can run")

    insert_request = urllib.request.Request(
        f"{base_url}/rest/v1/market_sessions",
        data=json.dumps(rows).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(insert_request, timeout=30) as response:
        if response.status not in {200, 201, 204}:
            raise RuntimeError("market session insert fallback failed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default=dt.date.today().isoformat())
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--calendar", default="scripts/market_calendar_overrides.json")
    args = parser.parse_args()

    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    start = dt.date.fromisoformat(args.start)
    end = start + dt.timedelta(days=max(args.days - 1, 0))
    calendar = load_calendar_overrides(args.calendar)
    rows = build_rows(start, end, calendar)
    upsert_market_sessions(base_url, service_key, rows)
    print(
        json.dumps(
            {
                "market_sessions_upserted": len(rows),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "calendar": args.calendar,
            }
        )
    )


if __name__ == "__main__":
    main()

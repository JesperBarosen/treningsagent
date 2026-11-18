"""Usage limits for the coach chat (#129, #130): one place for every limit,
price and time window.

Goal: the app never spends more than the Anthropic Console's hard limit
(10 USD a month), however many users there are. The app stops earlier, at
GLOBAL_BUDGET_USD_PER_MONTH, and fails gracefully. A turn can make up to
chat.MAX_STEPS model calls after the check passes, so the budget sits below
the Console limit on purpose.

Checked before POST /chat calls Claude, in this order (the first hit wins,
and Claude isn't called):
  1. invite-only: the email is in public.beta_invites (api.get_store, for
     every endpoint, so unlisted users can't use the API at all);
  2. the global budget for all users: month, then day;
  3. per user: tokens today, then messages in the last 60 minutes.
Logging sessions by hand never goes through these checks.

Everything is counted from the database (Vercel is serverless: nothing in
memory survives between requests). Days and months are in Europe/Oslo.
"""

import math
import os
from datetime import datetime, timedelta, timezone

# --- Limits: env vars, with these defaults -------------------------------------------

def _number(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def global_budget_month() -> float:
    return _number("GLOBAL_BUDGET_USD_PER_MONTH", 9)


def global_budget_day() -> float:
    return _number("GLOBAL_BUDGET_USD_PER_DAY", 1)


def messages_per_hour() -> int:
    return int(_number("CHAT_MESSAGES_PER_HOUR", 30))


def tokens_per_day() -> int:
    return int(_number("CHAT_TOKENS_PER_DAY", 50000))


def support_url() -> str | None:
    """Shown as "Support the app" when the monthly budget is used up; none if unset."""
    return os.environ.get("SUPPORT_URL") or None


# --- Prices ------------------------------------------------------------------------------
# USD per million tokens: (input, output). VERIFY against Anthropic's pricing page
# (https://www.anthropic.com/pricing) whenever the model or its price changes.
# Cache writes are billed at 1.25x input and cache reads at 0.1x input.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
}
CACHE_WRITE = 1.25
CACHE_READ = 0.1
# A model missing from PRICES is priced like the most expensive one listed, so
# the budget errs on the side of stopping early.
FALLBACK_PRICE = max(PRICES.values(), key=lambda p: p[0] + p[1])


def price(model: str) -> tuple[float, float]:
    return next((p for m, p in PRICES.items() if model.startswith(m)), FALLBACK_PRICE)


def cost(usage: dict) -> float:
    """USD for summed token usage of one model: input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens."""
    price_in, price_out = price(usage["model"])
    tokens_in = (usage.get("input_tokens", 0) + CACHE_WRITE * usage.get("cache_creation_input_tokens", 0)
                 + CACHE_READ * usage.get("cache_read_input_tokens", 0))
    return (tokens_in * price_in + usage.get("output_tokens", 0) * price_out) / 1e6


# --- Europe/Oslo days and months ----------------------------------------------------------
# Computed here (CET, CEST under the EU rule: last Sunday of March to last
# Sunday of October, at 01:00 UTC), so the serverless runtime needs no tz database.

def _last_sunday(year: int, month: int) -> datetime:
    first_next = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    last = first_next - timedelta(days=1)
    return last - timedelta(days=(last.weekday() + 1) % 7)


def oslo_offset(when: datetime) -> timedelta:
    """Oslo's offset from UTC at the UTC moment `when`."""
    start = _last_sunday(when.year, 3).replace(hour=1)
    end = _last_sunday(when.year, 10).replace(hour=1)
    return timedelta(hours=2) if start <= when < end else timedelta(hours=1)


def _oslo_midnight_utc(year: int, month: int, day: int) -> datetime:
    """The UTC moment Oslo's day year-month-day starts."""
    guess = datetime(year, month, day, tzinfo=timezone.utc) - timedelta(hours=1)
    # DST never changes at Oslo midnight, so the offset just before is the right one.
    return datetime(year, month, day, tzinfo=timezone.utc) - oslo_offset(guess)


def day_start(now: datetime) -> datetime:
    local = now + oslo_offset(now)
    return _oslo_midnight_utc(local.year, local.month, local.day)


def next_day_start(now: datetime) -> datetime:
    local = (now + oslo_offset(now)).date() + timedelta(days=1)
    return _oslo_midnight_utc(local.year, local.month, local.day)


def month_start(now: datetime) -> datetime:
    local = now + oslo_offset(now)
    return _oslo_midnight_utc(local.year, local.month, 1)


# --- The checks -----------------------------------------------------------------------------

class LimitHit(Exception):
    """A limit stops the request. `body` is the JSON the API returns."""

    def __init__(self, status: int, body: dict):
        super().__init__(body.get("limit"))
        self.status = status
        self.body = body


def _minutes_until(then: datetime, now: datetime) -> int:
    return max(1, math.ceil((then - now).total_seconds() / 60))


def check_invite(store, email: str | None) -> None:
    """Invite-only (#130): 403 {"limit": "closed_beta"} for an email that isn't listed."""
    if not email or not store.is_invited(email.strip().lower()):
        raise LimitHit(403, {"limit": "closed_beta"})


def check_chat(store, now: datetime | None = None) -> None:
    """Every limit before /chat calls Claude, in order; raises LimitHit for the
    first one hit. The last step records the message (it counts towards the
    hourly limit), so call this only right before calling Claude."""
    now = now or datetime.now(timezone.utc)
    month, day = month_start(now), day_start(now)

    # 2. The global budget, for all users together.
    spent_month, spent_day = 0.0, 0.0
    for row in store.global_usage(month, day):
        spent_month += cost({"model": row["model"], **row["month"]})
        spent_day += cost({"model": row["model"], **row["day"]})
    if spent_month >= global_budget_month():
        body = {"limit": "global_month"}
        if support_url():
            body["support_url"] = support_url()
        raise LimitHit(429, body)
    if spent_day >= global_budget_day():
        raise LimitHit(429, {"limit": "global_day",
                             "retry_after_minutes": _minutes_until(next_day_start(now), now)})

    # 3. Per user: tokens today, then messages in the last hour.
    if store.tokens_since(day) >= tokens_per_day():
        raise LimitHit(429, {"limit": "daily", "retry_after_minutes": _minutes_until(next_day_start(now), now)})
    hourly = messages_per_hour()
    if hourly <= 0:  # the coach switched off for everyone
        raise LimitHit(429, {"limit": "hourly", "retry_after_minutes": 60})
    oldest = store.claim_chat_request(hourly, now - timedelta(hours=1))
    if oldest is not None:
        raise LimitHit(429, {"limit": "hourly",
                             "retry_after_minutes": _minutes_until(oldest + timedelta(hours=1), now)})

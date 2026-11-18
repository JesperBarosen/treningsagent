"""Usage limits (#129, #130): closed beta, the global budget and per-user
limits, checked in order before /chat calls Claude. The counts come from the
in-memory store (conftest.FakeStore), standing in for the database."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import api
import auth
import db
import limits
from conftest import FakeClient, make_message

# 2026-11-18 12:00 in Oslo (CET, UTC+1).
NOON = datetime(2026, 11, 18, 11, 0, tzinfo=timezone.utc)


def call(when, model="claude-haiku-5-5", input_tokens=0, output_tokens=0, **cache) -> dict:
    return {"created_at": when, "model": model, "input_tokens": input_tokens,
            "output_tokens": output_tokens, "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0, **cache}


def usd(amount: float) -> int:
    """Output tokens costing `amount` USD on Haiku (0.50 per million)."""
    return round(amount / 0.50 * 1e6)


def check(store, now=NOON):
    store.now = now
    limits.check_chat(store, now)


def hit(store, now=NOON) -> dict:
    with pytest.raises(limits.LimitHit) as e:
        check(store, now)
    return {"status": e.value.status, **e.value.body}


# --- Config, prices and Oslo time --------------------------------------------------------

def test_defaults_and_env_overrides(monkeypatch):
    for name in ("GLOBAL_BUDGET_USD_PER_MONTH", "GLOBAL_BUDGET_USD_PER_DAY", "CHAT_MESSAGES_PER_HOUR",
                 "CHAT_TOKENS_PER_DAY", "SUPPORT_URL"):
        monkeypatch.delenv(name, raising=False)
    assert (limits.global_budget_month(), limits.global_budget_day()) == (9, 1)
    assert (limits.messages_per_hour(), limits.tokens_per_day()) == (30, 50000)
    assert limits.support_url() is None
    monkeypatch.setenv("GLOBAL_BUDGET_USD_PER_MONTH", "4.5")
    monkeypatch.setenv("CHAT_MESSAGES_PER_HOUR", "10")
    monkeypatch.setenv("CHAT_TOKENS_PER_DAY", "oops")  # a typo falls back to the default
    assert limits.global_budget_month() == 4.5 and limits.messages_per_hour() == 10
    assert limits.tokens_per_day() == 50000


def test_cost_uses_per_model_prices_and_cache_multipliers():
    usage = {"model": "claude-haiku-5-5-20261101", "input_tokens": 1_000_000, "output_tokens": 1_000_000,
             "cache_creation_input_tokens": 1_000_000, "cache_read_input_tokens": 1_000_000}
    assert limits.cost(usage) == pytest.approx(0.10 + 0.50 + 0.125 + 0.01)
    # An unknown model costs as much as the most expensive known one: stop early, not late.
    assert limits.cost({**usage, "model": "claude-unknown"}) == pytest.approx(limits.cost(usage))


@pytest.mark.parametrize("utc, offset", [
    (datetime(2026, 1, 15, 12, tzinfo=timezone.utc), 1),
    (datetime(2026, 7, 15, 12, tzinfo=timezone.utc), 2),
    (datetime(2026, 3, 29, 0, 59, tzinfo=timezone.utc), 1),   # just before summer time
    (datetime(2026, 3, 29, 1, 0, tzinfo=timezone.utc), 2),
    (datetime(2026, 10, 25, 0, 59, tzinfo=timezone.utc), 2),  # just before winter time
    (datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc), 1),
])
def test_oslo_offset_follows_the_eu_rule(utc, offset):
    assert limits.oslo_offset(utc) == timedelta(hours=offset)


def test_days_and_months_start_at_oslo_midnight():
    assert limits.day_start(NOON) == datetime(2026, 11, 17, 23, 0, tzinfo=timezone.utc)
    assert limits.next_day_start(NOON) == datetime(2026, 11, 18, 23, 0, tzinfo=timezone.utc)
    assert limits.month_start(NOON) == datetime(2026, 10, 31, 23, 0, tzinfo=timezone.utc)
    # 23:30 UTC on 18 Nov is already 19 Nov in Oslo.
    late = datetime(2026, 11, 18, 23, 30, tzinfo=timezone.utc)
    assert limits.day_start(late) == datetime(2026, 11, 18, 23, 0, tzinfo=timezone.utc)
    # In summer, Oslo midnight is 22:00 UTC; 1 July starts at 22:00 on 30 June.
    july = datetime(2026, 7, 10, 12, tzinfo=timezone.utc)
    assert limits.month_start(july) == datetime(2026, 6, 30, 22, 0, tzinfo=timezone.utc)
    # 30 Nov 23:30 UTC is 1 Dec in Oslo: a new month.
    assert limits.month_start(datetime(2026, 11, 30, 23, 30, tzinfo=timezone.utc)) == \
        datetime(2026, 11, 30, 23, 0, tzinfo=timezone.utc)


# --- 1. Closed beta -----------------------------------------------------------------------

def test_only_listed_emails_get_in(store):
    limits.check_invite(store, "me@example.com")
    limits.check_invite(store, "  Me@Example.COM ")  # compared lower-case
    for email in ("stranger@example.com", None, ""):
        with pytest.raises(limits.LimitHit) as e:
            limits.check_invite(store, email)
        assert (e.value.status, e.value.body) == (403, {"limit": "closed_beta"})


@pytest.fixture
def real_store_dependency(store, monkeypatch):
    """The real get_store, with the database swapped for the fake store and the
    signed-in user set per test, so the invite check runs as in production."""
    class Conn:
        def close(self):
            pass
    monkeypatch.setattr(db, "connect", lambda: Conn())
    monkeypatch.setattr(db, "PostgresStore", lambda conn, user_id: store)
    user = {"id": "u1", "email": "me@example.com"}
    api.app.dependency_overrides[auth.get_user] = lambda: user
    api.app.dependency_overrides[api.get_client] = lambda: FakeClient()
    yield TestClient(api.app), user
    api.app.dependency_overrides.clear()


def test_an_unlisted_user_can_use_no_endpoint(real_store_dependency):
    http, user = real_store_dependency
    assert http.get("/sessions").status_code == 200
    user["email"] = "stranger@example.com"
    for method, path in [("get", "/sessions"), ("get", "/plans"), ("post", "/chat")]:
        res = http.request(method, path, json={"message": "hi"} if method == "post" else None)
        assert (res.status_code, res.json()) == (403, {"limit": "closed_beta"}), path


# --- 2. The global budget -----------------------------------------------------------------

def test_under_budget_passes_and_counts_the_message(store):
    store.other_users_calls = [call(NOON - timedelta(hours=1), output_tokens=usd(0.5))]
    check(store)
    assert store.chat_requests == [NOON]


def test_at_the_daily_global_budget(store, monkeypatch):
    monkeypatch.delenv("GLOBAL_BUDGET_USD_PER_DAY", raising=False)
    store.other_users_calls = [call(NOON - timedelta(hours=2), output_tokens=usd(0.6)),
                               call(NOON - timedelta(hours=1), output_tokens=usd(0.4))]
    assert hit(store) == {"status": 429, "limit": "global_day", "retry_after_minutes": 12 * 60}
    assert store.chat_requests == []  # a blocked message isn't counted
    # The day resets at Oslo midnight; yesterday's spend no longer counts for today.
    check(store, datetime(2026, 11, 18, 23, 1, tzinfo=timezone.utc))


def test_at_the_monthly_global_budget_with_and_without_a_support_link(store, monkeypatch):
    monkeypatch.delenv("SUPPORT_URL", raising=False)
    # 9 USD over the month, spread over days so no day reaches 1 USD.
    store.other_users_calls = [call(NOON - timedelta(days=d, hours=1), output_tokens=usd(0.6))
                               for d in range(1, 16)]
    assert hit(store) == {"status": 429, "limit": "global_month"}
    monkeypatch.setenv("SUPPORT_URL", "https://example.com/support")
    assert hit(store)["support_url"] == "https://example.com/support"
    # The month resets on the 1st, Oslo time (1 Dec 00:01 is 30 Nov 23:01 UTC).
    check(store, datetime(2026, 11, 30, 23, 1, tzinfo=timezone.utc))


def test_the_month_is_checked_before_the_day(store):
    store.other_users_calls = [call(NOON - timedelta(hours=1), output_tokens=usd(9.5))]
    assert hit(store)["limit"] == "global_month"


def test_the_budget_counts_every_user_and_cache_tokens(store):
    """My own calls count too, and cache writes are billed at 1.25x."""
    store.model_calls = [call(NOON - timedelta(hours=1), input_tokens=4_000_000)]          # 0.40 USD
    store.other_users_calls = [call(NOON - timedelta(hours=1), cache_creation_input_tokens=5_600_000)]  # 0.70
    assert hit(store)["limit"] == "global_day"


# --- 3. Per user --------------------------------------------------------------------------

def test_at_the_hourly_limit_and_after_the_window(store, monkeypatch):
    monkeypatch.setenv("CHAT_MESSAGES_PER_HOUR", "3")
    for minutes in (50, 30, 10):
        check(store, NOON - timedelta(minutes=minutes))
    # The oldest of the three was 50 minutes ago: a slot frees in 10 minutes.
    assert hit(store) == {"status": 429, "limit": "hourly", "retry_after_minutes": 10}
    check(store, NOON + timedelta(minutes=11))  # 61 minutes after the oldest


def test_at_the_daily_token_limit_and_the_next_day(store, monkeypatch):
    monkeypatch.setenv("CHAT_TOKENS_PER_DAY", "50000")
    store.model_calls = [call(NOON - timedelta(hours=3), input_tokens=45_000, output_tokens=5_000)]
    assert hit(store) == {"status": 429, "limit": "daily", "retry_after_minutes": 12 * 60}
    assert store.chat_requests == []
    # Yesterday's tokens don't count: just after Oslo midnight it works again.
    check(store, datetime(2026, 11, 18, 23, 0, 30, tzinfo=timezone.utc))
    # Another user's tokens never count against me.
    store.model_calls = []
    store.other_users_calls = [call(NOON, input_tokens=60_000)]
    check(store)


def test_global_limits_win_over_per_user_ones(store, monkeypatch):
    monkeypatch.setenv("CHAT_MESSAGES_PER_HOUR", "0")
    store.other_users_calls = [call(NOON - timedelta(hours=1), output_tokens=usd(1.2))]
    assert hit(store)["limit"] == "global_day"


# --- Through the API -------------------------------------------------------------------------

@pytest.fixture
def chat_app(store):
    fake = FakeClient(make_message("end_turn", [{"type": "text", "text": "Hi!"}]))
    api.app.dependency_overrides[api.get_client] = lambda: fake
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app), fake
    api.app.dependency_overrides.clear()


def test_a_blocked_chat_never_calls_claude_and_logging_by_hand_still_works(chat_app, store):
    http, fake = chat_app
    store.other_users_calls = [call(datetime.now(timezone.utc) - timedelta(minutes=5), output_tokens=usd(9.5))]
    res = http.post("/chat", json={"message": "Hello"})
    assert res.status_code == 429 and res.json()["limit"] == "global_month"
    assert fake.requests == []
    run = {"sport": "running", "date": "2026-11-18", "duration_min": 30, "effort": 5}
    assert http.post("/sessions", json=run).status_code == 201


def test_an_allowed_chat_goes_through(chat_app):
    http, fake = chat_app
    assert http.post("/chat", json={"message": "Hello"}).json()["reply"] == "Hi!"
    assert len(fake.requests) == 1

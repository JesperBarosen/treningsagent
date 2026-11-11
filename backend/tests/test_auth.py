"""The API's Supabase JWT check, with a locally generated signing key (no network)."""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends
from fastapi.testclient import TestClient

import api
import auth

SUPABASE = "https://example.supabase.co"
ISSUER = f"{SUPABASE}/auth/v1"
USER = "11111111-1111-1111-1111-111111111111"
KID = "test-key"

KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class FakeJWKS(jwt.PyJWKClient):
    """A real PyJWKClient whose key set is our test key instead of an HTTP fetch."""

    def __init__(self, reachable: bool = True):
        super().__init__(f"{ISSUER}/.well-known/jwks.json", cache_keys=False)
        self.reachable = reachable

    def fetch_data(self):
        if not self.reachable:
            raise jwt.PyJWKClientConnectionError("down")
        jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(KEY.public_key()))
        return {"keys": [{**jwk, "kid": KID, "alg": "ES256", "use": "sig"}]}


def token(key=KEY, kid=KID, **overrides) -> str:
    now = int(time.time())
    claims = {"sub": USER, "aud": "authenticated", "role": "authenticated", "iss": ISSUER,
              "iat": now, "exp": now + 3600, "is_anonymous": False} | overrides
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": kid})


@pytest.fixture
def http(store, monkeypatch):
    """A client where get_store still runs the real auth check, but hands out
    the fake store and records which user it was for."""
    monkeypatch.setenv("SUPABASE_URL", SUPABASE)
    jwks = FakeJWKS()

    def fake_store(user_id: str = Depends(auth.get_user_id)):
        store.user_id = user_id
        return store

    api.app.dependency_overrides[auth.get_jwks_client] = lambda: jwks
    api.app.dependency_overrides[api.get_store] = fake_store
    client = TestClient(api.app)
    client.jwks = jwks
    yield client
    api.app.dependency_overrides.clear()


def get(http, bearer: str | None):
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    return http.get("/sessions", headers=headers)


def test_valid_token_runs_queries_as_that_user(http, store):
    res = get(http, token())
    assert res.status_code == 200
    assert store.user_id == USER


def test_missing_token_is_401(http):
    res = get(http, None)
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_expired_token_is_401(http):
    past = int(time.time()) - 60
    assert get(http, token(iat=past - 3600, exp=past)).status_code == 401


@pytest.mark.parametrize("bad", [
    pytest.param({"key": OTHER_KEY}, id="signed with another key"),
    pytest.param({"kid": "unknown"}, id="unknown key id"),
    pytest.param({"aud": "anon"}, id="wrong audience"),
    pytest.param({"iss": "https://evil.example/auth/v1"}, id="wrong issuer"),
    pytest.param({"exp": None}, id="no expiry"),
    pytest.param({"role": "anon"}, id="anon role"),
    pytest.param({"is_anonymous": True}, id="anonymous sign-in"),
])
def test_invalid_tokens_are_401(http, bad):
    assert get(http, token(**bad)).status_code == 401


def test_shared_secret_and_unsigned_tokens_are_rejected(http):
    now = int(time.time())
    claims = {"sub": USER, "aud": "authenticated", "role": "authenticated", "iss": ISSUER,
              "exp": now + 3600}
    hs256 = jwt.encode(claims, "x" * 32, algorithm="HS256", headers={"kid": KID})
    unsigned = jwt.encode(claims, None, algorithm="none", headers={"kid": KID})
    assert get(http, hs256).status_code == 401
    assert get(http, unsigned).status_code == 401
    assert get(http, "not-a-jwt").status_code == 401


def test_unreachable_jwks_is_503(http):
    http.jwks.reachable = False
    assert get(http, token()).status_code == 503


def test_every_data_endpoint_needs_a_token(http):
    for method, path in [("get", "/sessions"), ("get", "/training-load"),
                         ("get", "/progression"), ("post", "/chat")]:
        res = http.request(method, path, json={"message": "hi"} if method == "post" else None)
        assert res.status_code == 401, path
    assert http.get("/health").status_code == 200


def test_chat_daily_limit(http, store, monkeypatch):
    monkeypatch.setattr(api, "CHAT_DAILY_LIMIT", 0)
    res = http.post("/chat", json={"message": "hi"}, headers={"Authorization": f"Bearer {token()}"})
    assert res.status_code == 429
    assert "limit" in res.json()["detail"]

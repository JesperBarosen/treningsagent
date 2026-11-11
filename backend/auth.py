"""Verify Supabase access tokens (JWTs) sent by the frontend.

The token is signed with the project's asymmetric JWT signing key (ES256 or
RS256). The public keys come from the project's JWKS endpoint, so the backend
holds no shared secret. Only SUPABASE_URL is needed.
"""

import os
from functools import cache

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"


def supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is not set; see .env.example")
    return url.rstrip("/")


@cache
def get_jwks_client() -> jwt.PyJWKClient:
    """Fetches and caches the project's public signing keys."""
    return jwt.PyJWKClient(f"{supabase_url()}/auth/v1/.well-known/jwks.json",
                           cache_keys=True, lifespan=600)


def verify_token(token: str, jwks: jwt.PyJWKClient, issuer: str) -> str:
    """The user id (`sub`) of a valid, unexpired access token for a signed-in
    (not anonymous) user. Raises jwt.InvalidTokenError otherwise."""
    key = jwks.get_signing_key_from_jwt(token).key
    claims = jwt.decode(token, key, algorithms=ALGORITHMS, audience=AUDIENCE, issuer=issuer,
                        options={"require": ["exp", "sub", "aud", "iss"]})
    if claims.get("role") != "authenticated" or claims.get("is_anonymous"):
        raise jwt.InvalidTokenError("not a signed-in user")
    return claims["sub"]


_bearer = HTTPBearer(auto_error=False)


def get_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    jwks: jwt.PyJWKClient = Depends(get_jwks_client),
) -> str:
    """FastAPI dependency: the verified user's id, or 401."""
    if credentials is None:
        raise HTTPException(401, "Not signed in.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return verify_token(credentials.credentials, jwks, f"{supabase_url()}/auth/v1")
    except jwt.PyJWKClientConnectionError as e:
        raise HTTPException(503, "Can't reach Supabase to check the session.") from e
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as e:
        raise HTTPException(401, "Invalid or expired session. Sign in again.",
                            headers={"WWW-Authenticate": "Bearer"}) from e

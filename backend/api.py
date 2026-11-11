"""HTTP API for the training agent. Run: uv run uvicorn api:app --reload"""

import uuid
from collections.abc import Iterator
from functools import cache

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

import chat
import db

load_dotenv()  # ANTHROPIC_API_KEY and DATABASE_URL from .env

app = FastAPI(title="treningsagent")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    # The `history` returned by the previous /chat call, unchanged. The server
    # keeps no conversation state; it must include Claude's thinking blocks as-is.
    history: list[dict] = []
    # Returned by the first /chat call; send it back to group cost per conversation.
    conversation_id: uuid.UUID | None = None


class ChatResponse(BaseModel):
    reply: str
    history: list[dict]
    conversation_id: uuid.UUID


@cache
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # one client (and connection pool) for the process


def get_store() -> Iterator[db.PostgresStore]:
    conn = db.connect()
    try:
        # TODO: take the user id from the verified Supabase JWT once login exists.
        yield db.PostgresStore(conn, db.TEST_USER_ID)
    finally:
        conn.close()


@app.post("/chat")
def post_chat(
    req: ChatRequest,
    client: anthropic.Anthropic = Depends(get_client),
    store: db.PostgresStore = Depends(get_store),
) -> ChatResponse:
    conversation_id = req.conversation_id or uuid.uuid4()
    messages = [*req.history, {"role": "user", "content": req.message}]
    try:
        reply = chat.run_turn(client, store, messages, str(conversation_id))
    except anthropic.APIError as e:
        raise HTTPException(502, f"Claude API error: {e.message}") from e
    return ChatResponse(reply=reply, history=messages, conversation_id=conversation_id)

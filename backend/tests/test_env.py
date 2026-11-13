"""The backend reads its settings from the .env at the repo root."""

import os
from pathlib import Path

import env

ROOT = Path(__file__).resolve().parent.parent.parent


def test_env_file_is_the_root_one():
    assert env.ENV_FILE == ROOT / ".env"
    assert (ROOT / ".env.example").exists()  # its documented sibling


def test_load_reads_the_root_file(tmp_path, monkeypatch):
    fake = tmp_path / ".env"
    fake.write_text("SUPABASE_URL=https://from-root.example\nCHAT_DAILY_LIMIT=7\n")
    monkeypatch.setattr(env, "ENV_FILE", fake)
    for name in ("SUPABASE_URL", "CHAT_DAILY_LIMIT"):
        monkeypatch.setenv(name, "")  # so monkeypatch restores the real state afterwards
        monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path.parent)  # the working directory doesn't matter

    env.load()

    assert os.environ["SUPABASE_URL"] == "https://from-root.example"
    assert os.environ["CHAT_DAILY_LIMIT"] == "7"


def test_allowed_origins_default_to_the_dev_server(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert env.allowed_origins() == ["http://localhost:3000"]
    monkeypatch.setenv("ALLOWED_ORIGINS", "  ")
    assert env.allowed_origins() == ["http://localhost:3000"]


def test_allowed_origins_are_comma_separated_and_tidied(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS",
                       " https://treningsagent.vercel.app/ , http://localhost:3000,,")
    assert env.allowed_origins() == ["https://treningsagent.vercel.app",
                                     "http://localhost:3000"]

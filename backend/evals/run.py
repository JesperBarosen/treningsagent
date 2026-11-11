"""Run the eval cases against the real agent, Claude API and database.

    cd backend && uv run python -m evals.run [case_id ...]

For each case in evals/cases/: seed its sessions for a new throwaway user,
ask its question through the chat loop, check which tools were called, have a
cheap Claude judge grade the answer against the case's must / must_not lists,
then delete every row that user has. Prints pass/fail per case and the cost.

Needs ANTHROPIC_API_KEY and DATABASE_URL. Costs money and writes to the
database, so it is not part of `pytest` or CI.
"""

import json
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from pydantic import BaseModel

import chat
import db
import tools

CASES_DIR = Path(__file__).parent / "cases"
JUDGE_MODEL = "claude-haiku-5-5"
# USD per million input / output tokens (list prices, 2026-11). Cache writes
# are billed at 1.25x input and cache reads at 0.1x.
PRICES = {"claude-haiku-5-5": (0.10, 0.50)}

JUDGE_SYSTEM = """You grade a training assistant's answer against a checklist.
The tool results are the ground truth for every number and grade. Grade each
check on its own. A "must" check passes only if the answer clearly does it.
A "must_not" check passes only if the answer does not do the forbidden thing.
Keep each reason to one sentence and quote the answer where it matters."""


class Check(BaseModel):
    id: str
    passed: bool
    reason: str


class Grade(BaseModel):
    checks: list[Check]


class EvalStore(db.PostgresStore):
    """A store for one throwaway user that also keeps its model calls for costing."""

    def __init__(self, conn):
        super().__init__(conn, str(uuid.uuid4()))
        self.calls: list[dict] = []

    def log_model_call(self, call: dict) -> None:
        self.calls.append(call)
        super().log_model_call(call)


def load_case(path: Path) -> dict:
    case = json.loads(path.read_text(encoding="utf-8"))
    if "seed_from" in case:
        case["seed"] = json.loads((CASES_DIR / f"{case['seed_from']}.json")
                                  .read_text(encoding="utf-8"))["seed"]
    return case


def seed(store: tools.Store, seed: dict, today: date) -> None:
    """Log every seeded session through the real tool, dated relative to today."""
    for sport in tools.SPORTS:
        for entry in seed.get(sport, []):
            fields = {k: v for k, v in entry.items() if k != "days_ago"}
            day = (today - timedelta(days=entry["days_ago"])).isoformat()
            tools.log_session(store, sport, day, **fields)


def delete_user(conn, user_id: str) -> None:
    """Delete everything the throwaway user has. Runs as the connection's own
    role, which bypasses RLS, so it must never be pointed at a real user."""
    if user_id == db.TEST_USER_ID:
        raise RuntimeError("refusing to delete the test user's rows")
    with conn.transaction():
        conn.execute("delete from public.sessions where user_id = %s", (user_id,))  # climbs cascade
        conn.execute("delete from public.model_calls where user_id = %s", (user_id,))


def cost(usage: dict) -> float | None:
    """USD for one call's token usage, or None if the model's price is unknown."""
    model = next((m for m in PRICES if usage["model"].startswith(m)), None)
    if model is None:
        return None
    price_in, price_out = PRICES[model]
    tokens_in = (usage["input_tokens"] + 1.25 * usage["cache_creation_input_tokens"]
                 + 0.1 * usage["cache_read_input_tokens"])
    return (tokens_in * price_in + usage["output_tokens"] * price_out) / 1e6


def judge(client: anthropic.Anthropic, case: dict, answer: str,
          tool_results: list[str]) -> tuple[list[Check], dict]:
    checklist = [(f"must-{i}", text) for i, text in enumerate(case["expect"].get("must", []), 1)]
    checklist += [(f"must_not-{i}", text)
                  for i, text in enumerate(case["expect"].get("must_not", []), 1)]
    prompt = (
        f"<question>{case['question']}</question>\n"
        f"<tool_results>\n{chr(10).join(tool_results)}\n</tool_results>\n"
        f"<answer>{answer}</answer>\n"
        "<checklist>\n" + "\n".join(f"{id}: {text}" for id, text in checklist)
        + "\n</checklist>\nReturn one check per checklist id."
    )
    response = client.messages.parse(
        model=JUDGE_MODEL, max_tokens=16000, system=JUDGE_SYSTEM,
        messages=[{"role": "user", "content": prompt}], output_format=Grade,
    )
    usage = {"model": response.model, **response.usage.model_dump()}
    for key in ("cache_creation_input_tokens", "cache_read_input_tokens"):
        usage[key] = usage.get(key) or 0
    checks = response.parsed_output.checks if response.parsed_output else []
    got = {c.id for c in checks}
    for id, _ in checklist:  # a check the judge skipped counts as failed
        if id not in got:
            checks.append(Check(id=id, passed=False, reason="judge returned no verdict"))
    return checks, usage


def run_case(client: anthropic.Anthropic, conn, case: dict) -> tuple[bool, float | None]:
    store = EvalStore(conn)
    try:
        seed(store, case["seed"], date.today())
        messages = [{"role": "user", "content": case["question"]}]
        answer = chat.run_turn(client, store, messages, str(uuid.uuid4()))
    finally:
        delete_user(conn, store.user_id)

    blocks = [b for m in messages if isinstance(m["content"], list) for b in m["content"]]
    called = [b["name"] for b in blocks if b["type"] == "tool_use"]
    results = [b["content"] for b in blocks if b["type"] == "tool_result"]
    checks, judge_usage = judge(client, case, answer, results)
    missing = [t for t in case["expect"].get("tools_called", []) if t not in called]
    if missing:
        checks.insert(0, Check(id="tools_called", passed=False,
                               reason=f"not called: {missing}; called: {called}"))
    passed = all(c.passed for c in checks)

    agent_costs = [cost(c) for c in store.calls]
    judge_cost = cost(judge_usage)
    total = (None if None in agent_costs or judge_cost is None
             else sum(agent_costs) + judge_cost)
    price = "unknown" if total is None else f"${total:.4f}"
    print(f"{'PASS' if passed else 'FAIL'}  {case['id']}  ({len(store.calls)} agent calls "
          f"+ 1 judge call, {price})")
    for c in checks:
        print(f"    {'ok  ' if c.passed else 'FAIL'} {c.id}: {c.reason}")
    if not passed:
        print("    answer:\n" + "\n".join("      " + line for line in answer.splitlines()))
    return passed, total


def main(ids: list[str]) -> int:
    load_dotenv()
    paths = sorted(CASES_DIR.glob("*.json"))
    if ids:
        paths = [p for p in paths if p.stem in ids]
        unknown = set(ids) - {p.stem for p in paths}
        if unknown:
            print(f"unknown case(s): {sorted(unknown)}")
            return 2
    client = anthropic.Anthropic()
    conn = db.connect()
    results = []
    try:
        for path in paths:
            results.append(run_case(client, conn, load_case(path)))
    finally:
        conn.close()

    passed = sum(ok for ok, _ in results)
    costs = [c for _, c in results]
    total = "unknown" if None in costs else f"${sum(costs):.4f}"
    print(f"\n{passed}/{len(results)} passed, total cost {total}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

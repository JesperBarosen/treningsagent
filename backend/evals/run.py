"""Run the eval cases against the real agent, Claude API and database.

    cd backend && uv run python -m evals.run [case_id ...] [--repeat N]
    cd backend && uv run python -m evals.run --judge-check

For each case in evals/cases/: seed its sessions for a new throwaway user,
ask its question through the chat loop, check which tools were called, have a
cheap Claude judge grade the answer against the case's must / must_not lists,
then delete every row that user has. Prints pass/fail per run, a pass rate
per case with --repeat, and the cost.

--judge-check tests the judge instead: it grades each case's `known_bad`
answer (an answer with one planted mistake) and must fail the check that
mistake breaks. It makes judge calls only and computes the tool results from
the seed in memory, so it needs no database.

Needs ANTHROPIC_API_KEY and DATABASE_URL. Costs money and writes to the
database, so it is not part of `pytest` or CI.
"""

import argparse
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


class MemoryStore:
    """In-memory store for --judge-check: computes a case's tool results from
    its seed without touching the database."""

    def __init__(self):
        self.rows: list[dict] = []
        self.climbs: list[dict] = []

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int:
        session_id = len(self.rows) + 1
        self.rows.append({"id": session_id, **row})
        self.climbs += [{"id": len(self.climbs) + i + 1, "session_id": session_id, **c}
                        for i, c in enumerate(climbs)]
        return session_id

    def sessions_since(self, since: str) -> list[dict]:
        return sorted((r for r in self.rows if r["date"] >= since),
                      key=lambda r: (r["date"], r["id"]))

    def first_session_date(self) -> str | None:
        return min((r["date"] for r in self.rows), default=None)

    def climbs_since(self, since: str) -> list[dict]:
        ids = {r["id"] for r in self.sessions_since(since)}
        return [c for c in self.climbs if c["session_id"] in ids]

    def log_model_call(self, call: dict) -> None:
        pass


def total_cost(costs: list[float | None]) -> float | None:
    return None if None in costs else sum(costs)


def fmt(amount: float | None) -> str:
    return "unknown" if amount is None else f"${amount:.4f}"


def print_checks(checks: list[Check], answer: str | None = None) -> None:
    for c in checks:
        print(f"    {'ok  ' if c.passed else 'FAIL'} {c.id}: {c.reason}")
    if answer is not None:
        print("    answer:")
        for line in answer.splitlines():
            print("      " + line)


def run_case(client: anthropic.Anthropic, conn, case: dict,
             verbose: bool) -> tuple[bool, float | None]:
    """Ask the case's question once and grade the answer. Returns (passed, cost)."""
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
    amount = total_cost([cost(c) for c in store.calls] + [cost(judge_usage)])
    print(f"  {'PASS' if passed else 'FAIL'}  ({len(store.calls)} agent calls + 1 judge call, "
          f"{fmt(amount)})")
    if verbose or not passed:
        print_checks(checks, None if passed else answer)
    return passed, amount


def judge_check(client: anthropic.Anthropic, case: dict) -> tuple[bool, float | None]:
    """Feed the case's known-bad answer straight to the judge, with the tool
    results its seed produces. The judge is working only if it fails the
    check the planted mistake breaks (`should_fail`), not just any check."""
    store = MemoryStore()
    seed(store, case["seed"], date.today())
    results = [tools.run_tool(store, name, {}) for name in case["expect"]["tools_called"]]
    bad = case["known_bad"]
    checks, usage = judge(client, case, bad["answer"], results)
    caught = any(c.id == bad["should_fail"] and not c.passed for c in checks)
    amount = cost(usage)
    print(f"{'ok  ' if caught else 'MISS'}  {case['id']}: judge "
          f"{'failed' if caught else 'PASSED'} the known-bad answer ({fmt(amount)})")
    print(f"    planted: {bad['why']} (must fail {bad['should_fail']})")
    print_checks(checks)
    return caught, amount


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m evals.run", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cases", nargs="*", help="case ids (default: all)")
    parser.add_argument("--repeat", type=int, default=1, metavar="N",
                        help="ask each question N times and report a pass rate")
    parser.add_argument("--judge-check", action="store_true",
                        help="only check the judge fails each case's known-bad answer "
                             "(no agent calls, no database)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="print every check, not only failing ones")
    args = parser.parse_args(argv)
    if args.repeat < 1:
        parser.error("--repeat must be at least 1")

    load_dotenv()
    paths = sorted(CASES_DIR.glob("*.json"))
    if args.cases:
        unknown = set(args.cases) - {p.stem for p in paths}
        if unknown:
            parser.error(f"unknown case(s): {sorted(unknown)}")
        paths = [p for p in paths if p.stem in args.cases]
    cases = [load_case(p) for p in paths]
    client = anthropic.Anthropic()

    if args.judge_check:
        results = [judge_check(client, case) for case in cases]
        caught = sum(ok for ok, _ in results)
        print()
        print(f"judge failed {caught}/{len(results)} known-bad answers, "
              f"cost {fmt(total_cost([c for _, c in results]))}")
        return 0 if caught == len(results) else 1

    conn = db.connect()
    rates, costs = [], []
    try:
        for case in cases:
            print(case["id"])
            runs = [run_case(client, conn, case, args.verbose) for _ in range(args.repeat)]
            passed = sum(ok for ok, _ in runs)
            rates.append((case["id"], passed))
            costs += [c for _, c in runs]
    finally:
        conn.close()

    print()
    print("pass rate per case:")
    for case_id, passed in rates:
        print(f"  {passed}/{args.repeat}  {case_id}")
    print(f"total cost {fmt(total_cost(costs))}")
    return 0 if all(p == args.repeat for _, p in rates) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Run the eval cases against the real agent, Claude API and database.

    cd backend && uv run python -m evals.run [case_id ...] [--repeat N]
    cd backend && uv run python -m evals.run --judge-check

For each case in evals/cases/: seed its sessions for a new throwaway user,
ask its question through the chat loop, check which tools were called, have a
cheap Claude judge grade the answer against the case's must / must_not lists
(must_not checks shown as "The answer avoids: ...", so passed always means good),
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
import re
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import anthropic
from pydantic import BaseModel

import chat
import db
import env
import grades
import gyms
import limits
import plans
import tools

CASES_DIR = Path(__file__).parent / "cases"
JUDGE_MODEL = "claude-haiku-5-5"
# USD per million input / output tokens, kept in one place with the app's
# budget (limits.PRICES). Cache writes are billed at 1.25x input and cache reads at 0.1x.
PRICES = limits.PRICES

JUDGE_SYSTEM = """You grade a training assistant's answer against a checklist.
The tool results are the ground truth for every number and grade. Grade each
check on its own. Every check describes a good answer, so passed = true always
means the answer is good on that point. A check passes only if the answer
clearly does what it says; a check that starts "The answer avoids:" passes
when the answer never does the thing that follows, and fails when it does.
Keep each reason to one sentence, quote the answer where it matters, and make
the reason agree with passed."""

# must_not checks are shown to the judge as "The answer avoids: ...", so
# passed = true always means good. Asked "must not X, passed?", the judge
# sometimes answered with whether X happened (#158).
AVOIDS = "The answer avoids: "


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
        db.ensure_auth_user(conn, self.user_id)
        self.calls: list[dict] = []

    def log_model_call(self, call: dict) -> None:
        self.calls.append(call)
        super().log_model_call(call)


def load_case(path: Path, today: date | None = None) -> dict:
    """Load a case. "{today}" anywhere in it becomes today's date, so a case's
    optional `history` (earlier turns, sent before the question) and
    `expect.tool_inputs` can refer to sessions logged on the day it runs.
    "{monday+N}" becomes the date N days after next Monday (plans start on a
    Monday, #119)."""
    today = today or date.today()
    next_monday = today + timedelta(days=7 - today.weekday())
    text = path.read_text(encoding="utf-8").replace("{today}", today.isoformat())
    text = re.sub(r"\{monday\+(\d+)\}",
                  lambda m: (next_monday + timedelta(days=int(m.group(1)))).isoformat(), text)
    case = json.loads(text)
    if "seed_from" in case:
        # Through load_case, so the other case's placeholders are filled in too.
        case["seed"] = load_case(CASES_DIR / f"{case['seed_from']}.json", today)["seed"]
    return case


def seed(store: tools.Store, seed: dict, today: date) -> None:
    """Make the seeded gyms and templates, then log every seeded session through
    the real tool, dated relative to today (#102). A session's "template" and a
    climb's "gym" name a seeded template or gym; a gym's colours "my_gym" are
    the seven colours everyone had before gyms. Climbs without a gym go to the
    first seeded gym (or a new My gym)."""
    gym_ids = {}
    for g in seed.get("gyms", []):
        colours = g["colours"]
        if colours == "my_gym":
            colours = [{"name": n, "colour": c, "range": [grades.label("v", lo), grades.label("v", hi)]}
                       for n, c, lo, hi in grades.LEGACY_CIRCUIT]
        gym_ids[g["name"]] = gyms.create_gym(store, g["name"], g.get("range_system", "v"), colours)["id"]
    templates = {}
    for t in seed.get("templates", []):
        made = (tools.add_starters(store, [t["starter"]])[0] if "starter" in t
                else tools.create_template(store, t["name"], t["sport"], t["fields"],
                                           t.get("core_fields")))
        templates[made["name"]] = made["id"]
    for sport in tools.SPORTS:
        for entry in seed.get(sport, []):
            fields = {k: v for k, v in entry.items() if k not in ("days_ago", "template")}
            if "template" in entry:
                fields["template_id"] = templates[entry["template"]]
            if "climbs" in fields:
                fields["climbs"] = [{**{k: v for k, v in c.items() if k != "gym"},
                                     **({"gym_id": gym_ids[c["gym"]]} if "gym" in c else {})}
                                    for c in fields["climbs"]]
            day = (today - timedelta(days=entry["days_ago"])).isoformat()
            tools.log_session(store, sport, day, **fields)
    for g in seed.get("goals", []):  # after the sessions, so a pace goal gets its start
        tools.set_goal(store, **g, today=today)
    if "plan" in seed:  # an accepted plan (#131), e.g. to propose changes to
        plans.create_plan(store, {"source": "coach", **seed["plan"]}, today=today)


def delete_user(conn, user_id: str) -> None:
    """Delete the throwaway user and, by cascade, everything they have. Runs as
    the connection's own role, which bypasses RLS, so it must never be pointed
    at a real user: delete_auth_user only deletes users with no email."""
    db.delete_auth_user(conn, user_id)


def cost(usage: dict) -> float | None:
    """USD for one call's token usage, or None if the model's price is unknown."""
    model = next((m for m in PRICES if usage["model"].startswith(m)), None)
    if model is None:
        return None
    price_in, price_out = PRICES[model]
    tokens_in = (usage["input_tokens"] + 1.25 * usage["cache_creation_input_tokens"]
                 + 0.1 * usage["cache_read_input_tokens"])
    return (tokens_in * price_in + usage["output_tokens"] * price_out) / 1e6


def judge_checklist(case: dict) -> list[tuple[str, str]]:
    """(id, text) per check, as the judge sees it. The ids stay must-n and
    must_not-n (known_bad.should_fail names them); must_not texts read as
    what a good answer avoids."""
    checklist = [(f"must-{i}", text) for i, text in enumerate(case["expect"].get("must", []), 1)]
    checklist += [(f"must_not-{i}", AVOIDS + text)
                  for i, text in enumerate(case["expect"].get("must_not", []), 1)]
    return checklist


def judge(client: anthropic.Anthropic, case: dict, answer: str,
          tool_results: list[str]) -> tuple[list[Check], dict]:
    checklist = judge_checklist(case)
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

    # Gyms (#98): "My gym" is made on the first climb, as for a real user.
    def gyms(self) -> list[dict]:
        return [dict(g) for g in getattr(self, "_gyms", [])]

    def insert_gym(self, row: dict, colours: list[dict]) -> dict:
        gym_id = len(self.gyms()) + 1
        grades = [{"id": gym_id * 100 + c["position"], "gym_id": gym_id, "archived_at": None,
                   **{k: c[k] for k in ("position", "name", "colour", "range_low", "range_high")}}
                  for c in colours]
        self._gyms = [*self.gyms(), {"id": gym_id, **row, "archived_at": None, "grades": grades}]
        return dict(self._gyms[-1])

    def last_gym_id(self) -> int | None:
        return next((c["gym_id"] for c in reversed(self.climbs) if c.get("gym_id")), None)

    # Session templates (#102), so --judge-check can run list_templates and
    # templated drafts offline.
    def templates(self) -> list[dict]:
        return [json.loads(json.dumps(t)) for t in getattr(self, "_templates", [])]

    def insert_template(self, row: dict) -> dict:
        t = {"id": len(self.templates()) + 1, "archived_at": None, **row}
        self._templates = [*self.templates(), t]
        return json.loads(json.dumps(t))

    def template_value_keys(self, template_id: int) -> set[str]:
        return {k for r in self.rows if r.get("template_id") == template_id
                for k in (r.get("custom_values") or {})}

    # Goals (N2), so --judge-check can run set_goal and get_goals offline.
    def goals(self) -> list[dict]:
        return list(getattr(self, "_goals", []))

    def insert_goal(self, row: dict) -> dict:
        self._goals = [*self.goals(), {"id": len(self.goals()) + 1, "status": "active",
                                       "achieved_on": None, "start_pace": None, **row}]
        return dict(self._goals[-1])

    def update_goal(self, goal_id: int, changes: dict) -> dict | None:
        for g in self.goals():
            if g["id"] == goal_id:
                g.update(changes)
                return dict(g)
        return None

    # Plans (#119, #131): none unless the case seeds one, so propose_program,
    # get_plan and propose_plan_change can run offline.
    def plans(self) -> list[dict]:
        return [json.loads(json.dumps(p)) for p in getattr(self, "_plans", [])]

    def insert_plan(self, row: dict, sessions: list[dict]) -> dict:
        plan = {"id": len(self.plans()) + 1, "status": "active", "ended_on": None, **row}
        self._plans = [*self.plans(), plan]
        for s in sessions:
            self._planned = [*self.planned_sessions(), {
                "id": len(self.planned_sessions()) + 1, "plan_id": plan["id"], "status": "planned",
                "skip_reason": None, "session_id": None, **s}]
        return json.loads(json.dumps(plan))

    def planned_sessions(self, plan_id=None, since=None, until=None) -> list[dict]:
        return [json.loads(json.dumps(p)) for p in getattr(self, "_planned", [])
                if (plan_id is None or p["plan_id"] == plan_id) and (since is None or p["date"] >= since)
                and (until is None or p["date"] <= until)]


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
        history = case.get("history", [])
        messages = [*history, {"role": "user", "content": case["question"]}]
        # A case may turn on "Save without asking" (auto_save), e.g. to show
        # that a plan still needs Accept (Q5).
        answer = chat.run_turn(client, store, messages, str(uuid.uuid4()),
                               auto_save=case.get("auto_save", False))
    finally:
        delete_user(conn, store.user_id)

    # Grade only this turn: the earlier turns' tool calls aren't the answer's.
    this_turn = messages[len(history):]
    blocks = [b for m in this_turn if isinstance(m["content"], list) for b in m["content"]]
    called = [b["name"] for b in blocks if b["type"] == "tool_use"]
    results = [b["content"] for b in blocks if b["type"] == "tool_result"]
    checks, judge_usage = judge(client, case, answer, results)
    missing = [t for t in case["expect"].get("tools_called", []) if t not in called]
    if missing:
        checks.insert(0, Check(id="tools_called", passed=False,
                               reason=f"not called: {missing}; called: {called}"))
    checks[:0] = structural_checks(case, blocks)
    passed = all(c.passed for c in checks)
    amount = total_cost([cost(c) for c in store.calls] + [cost(judge_usage)])
    print(f"  {'PASS' if passed else 'FAIL'}  ({len(store.calls)} agent calls + 1 judge call, "
          f"{fmt(amount)})")
    if verbose or not passed:
        print_checks(checks, None if passed else answer)
    return passed, amount


def structural_checks(case: dict, blocks: list[dict]) -> list[Check]:
    """Checks that need no judge (#131): tools that must not be called, and
    the change types the last successful propose_plan_change proposed (e.g.
    exactly ["move"] for "move Thursday's run to Friday", not a new plan)."""
    out = []
    called = [b["name"] for b in blocks if b["type"] == "tool_use"]
    banned = [t for t in case["expect"].get("tools_not_called", []) if t in called]
    if banned:
        out.append(Check(id="tools_not_called", passed=False, reason=f"called: {banned}"))
    want = case["expect"].get("change_types")
    if want is not None:
        ids = {b["id"] for b in blocks if b["type"] == "tool_use" and b["name"] == "propose_plan_change"}
        got = [json.loads(b["content"]) for b in blocks if b["type"] == "tool_result"
               and b["tool_use_id"] in ids and not b.get("is_error")]
        types = [c["type"] for c in got[-1]["changes"]] if got else None
        if types != want:
            out.append(Check(id="change_types", passed=False,
                             reason=f"proposed {types}, expected exactly {want}"))
    return out


def judge_check(client: anthropic.Anthropic, case: dict) -> tuple[bool, float | None]:
    """Feed the case's known-bad answer straight to the judge, with the tool
    results its seed produces. The judge is working only if it fails the
    check the planted mistake breaks (`should_fail`), not just any check."""
    store = MemoryStore()
    seed(store, case["seed"], date.today())
    inputs = case["expect"].get("tool_inputs", {})  # for tools that need arguments
    results = [tools.run_tool(store, name, inputs.get(name, {}))
               for name in case["expect"]["tools_called"]]
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

    env.load()
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

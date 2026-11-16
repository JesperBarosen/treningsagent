"""Write frontend/e2e/fixtures/app-data.json: what the API returns for a user with
seed sessions, Strength and Other, a Fingerboard template and a Font gym, made by
the backend's own tools on the in-memory test store. The phone layout check
(frontend/e2e/layout, #110) answers every API call from it. Regenerate when the
API's shapes change:
    cd backend && uv run python e2e_fixture.py ../frontend/e2e/fixtures/app-data.json
"""
import json
import sys
from datetime import date, timedelta

sys.path.insert(0, ".")
sys.path.insert(0, "tests")

import gyms  # noqa: E402
import seed  # noqa: E402
import tools  # noqa: E402
from conftest import FakeStore  # noqa: E402

today = date.today()
day = lambda n: (today - timedelta(days=n)).isoformat()  # noqa: E731

store = FakeStore()
for s in seed.seed_sessions(today):
    tools.log_session(store, **s)
fb = tools.add_starters(store, ["Fingerboard", "Strength", "Intervals", "Mobility"])[0]
font = gyms.create_gym(store, "Fontainebleau Boulders Centre", "font", [
    {"name": "yellow", "colour": "yellow", "range": ["4", "5"]},
    {"name": "green", "colour": "green", "range": ["5+", "6A"]},
    {"name": "blue", "colour": "blue", "range": ["6A+", "6B+"]},
    {"name": "purple", "colour": "purple", "range": ["6C", "7A"]},
    {"name": "red", "colour": "red", "range": ["7A+", "7B+"]},
    {"name": "black", "colour": "black", "range": ["7C", "8A"]}])
tools.log_session(store, "climbing", day(1), 120, 8, climbs=[
    {"grade": g, "grade_system": "font", "style": "boulder", "sent": i % 2 == 0}
    for i, g in enumerate(["6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+"])])
tools.log_session(store, "climbing", day(2), 90, 7, climbs=[
    {"grade": "blue", "gym_id": font["id"], "style": "boulder", "sent": True, "attempts": 1}])
tools.log_session(store, "other", day(3), 40, 7, template_id=fb["id"], values={
    "protocol": "max_hangs", "grip": ["half_crimp", "open_hand"],
    "hangs": [{"sets": 6, "reps": 10, "edge_mm": 20, "load": 10}, {"sets": 3, "reps": 7, "edge_mm": 15, "load": -5}],
    "rest_s": 180, "finger_pain": False})
tools.log_session(store, "strength", day(4), 60, 7, notes="Squats and pull-ups")
tools.log_session(store, "other", day(5), 30, 3, notes="Yoga")

load = tools.get_training_load(store, 8, today)
load["by_sport"] = {s: tools.get_training_load(store, 8, today, sport=s) for s in tools.SPORTS}
data = {
    "sessions": tools.get_history(store, 56, today),
    "training_load": load,
    "progression": tools.calculate_progression(store, 8, today),
    "gyms": gyms.list_gyms(store),
    "templates": {"templates": tools.list_templates(store),
                  "starters": [{"name": n, "sport": s["sport"]} for n, s in __import__("forms").STARTERS.items()]},
    "goals": tools.list_goals(store, today),
    "made_on": today.isoformat(),
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print("written", sys.argv[1], len(data["sessions"]), "sessions")

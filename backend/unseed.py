"""Delete exactly the rows seed.py inserted, and nothing else.

    cd backend && uv run python unseed.py

Reads the session ids from seed.SEED_IDS_FILE. Climbs go with their session
(on delete cascade). The app's role may not delete, so this runs as the
connection's own role, limited to those ids and the test user.
"""

import json
import sys


import db
import env
from seed import SEED_IDS_FILE


def unseed(conn, user_id: str, session_ids: list[int]) -> int:
    """Delete these sessions (and their climbs) if they belong to the test user."""
    if user_id != db.TEST_USER_ID:
        raise RuntimeError("seed file is for another user; refusing to delete")
    with conn.transaction():
        cur = conn.execute("delete from public.sessions where user_id = %s and id = any(%s)",
                           (user_id, session_ids))
    return cur.rowcount


def main() -> int:
    env.load()
    if not SEED_IDS_FILE.exists():
        print("Nothing to unseed (no seed file).")
        return 0
    seeded = json.loads(SEED_IDS_FILE.read_text())
    conn = db.connect()
    try:
        deleted = unseed(conn, seeded["user_id"], seeded["session_ids"])
    finally:
        conn.close()
    SEED_IDS_FILE.unlink()
    print(f"Deleted {deleted} of {len(seeded['session_ids'])} seeded sessions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

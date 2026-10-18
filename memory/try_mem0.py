"""Store two tab trails in Mem0 and search one back.

This is the phase 3 check, outside the extension. It sends one plain sentence
per trail (label, one-liner, titles, URLs). It does not send page bodies.

Requires MEM0_API_KEY in the repo .env. Install with: pip install mem0ai
"""

from __future__ import annotations

import json
import os
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USER_ID = "local-user"

TRAILS = [
    {
        "label": "KrowdKraft",
        "one_liner": "A Chrome extension that groups open tabs into project trails.",
        "pages": [
            ("mem0 docs", "https://docs.mem0.ai"),
            ("Sarvam speech-to-text docs", "https://docs.sarvam.ai"),
        ],
    },
    {
        "label": "Weeknight pasta",
        "one_liner": "A simple tomato pasta recipe for dinner.",
        "pages": [
            ("tomato pasta recipe", "https://www.bbcgoodfood.com/recipes/tomato-pasta"),
        ],
    },
]

QUERY = "what was I looking up about speech to text?"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def trail_sentence(trail: dict) -> str:
    pages = " and ".join(title for title, _url in trail["pages"])
    urls = ", ".join(url for _title, url in trail["pages"])
    return (
        f"On {date.today().isoformat()} the user was working on {trail['label']}: "
        f"{trail['one_liner']} Open pages included {pages}. URLs: {urls}."
    )


def results_of(payload) -> list:
    if isinstance(payload, dict):
        rows = payload.get("results")
        if isinstance(rows, list):
            return rows
    if isinstance(payload, list):
        return payload
    return []


def brief(row: dict) -> dict:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "memory": row.get("memory") or row.get("text") or row.get("data"),
        "event": row.get("event"),
        "score": row.get("score"),
        "trail_label": metadata.get("trail_label") if isinstance(metadata, dict) else None,
        "kind": metadata.get("kind") if isinstance(metadata, dict) else None,
    }


def search_until(client, query: str, tries: int = 8, pause: float = 2.0):
    last = {}
    for attempt in range(1, tries + 1):
        last = client.search(query, filters={"user_id": USER_ID})
        if results_of(last):
            return last
        print(f"search attempt {attempt} returned no memories yet")
        time.sleep(pause)
    return last


def main() -> None:
    load_env(ROOT / ".env")
    # .env currently names the key MEMO_API_KEY. Accept the usual name too.
    api_key = os.environ.get("MEM0_API_KEY", "").strip() or os.environ.get("MEMO_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set MEM0_API_KEY in .env")
    os.environ["MEM0_API_KEY"] = api_key

    from mem0 import MemoryClient

    client = MemoryClient()
    for trail in TRAILS:
        sentence = trail_sentence(trail)
        print(f"\nADD {trail['label']}")
        print(sentence)
        added = client.add(
            sentence,
            user_id=USER_ID,
            metadata={
                "kind": "trail",
                "trail_label": trail["label"],
                "saved_at": date.today().isoformat(),
            },
        )
        print(json.dumps([brief(row) for row in results_of(added)] or added, indent=2, default=str))

    print(f"\nSEARCH {QUERY}")
    found = search_until(client, QUERY)
    rows = results_of(found)
    print(json.dumps([brief(row) for row in rows] or found, indent=2, default=str))

    texts = " ".join(str(row.get("memory") or "") for row in rows).lower()
    labels = {row.get("trail_label") for row in rows}
    if "speech" not in texts and "sarvam" not in texts and "KrowdKraft" not in labels:
        raise SystemExit("Search did not return the speech-to-text trail.")
    print("\nOK: the speech-to-text question found the KrowdKraft trail.")


if __name__ == "__main__":
    main()

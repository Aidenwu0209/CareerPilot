from __future__ import annotations

import argparse

from scripts.career_catalog.common import RAW_DIR, utc_now, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Record recruitment-source crawl policy")
    parser.add_argument("--output", default=str(RAW_DIR / "recruitment-crawl.json"))
    args = parser.parse_args()
    result = {
        "generated_at": utc_now(),
        "sources": [],
        "failures": [],
        "policy": "No commercial recruitment source is crawled without a licensed API or explicit permission.",
    }
    write_json(__import__("pathlib").Path(args.output), result)
    print("sources=0 commercial_crawl=disabled")


if __name__ == "__main__":
    main()

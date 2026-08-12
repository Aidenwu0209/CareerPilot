from __future__ import annotations

import argparse
from pathlib import Path

from scripts.career_catalog.common import AuditedFetcher, RAW_DIR, save_snapshot, write_json

OFFICIAL_SOURCES = {
    "moe-major-catalog-2026": "https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/t20260427_1434931.html",
    "mohrss-occupation-catalog-2022": "https://chinajob.mohrss.gov.cn/h5/c/2022-10-08/361551.shtml",
}


def crawl(*, delay: float, output: Path) -> dict:
    fetcher = AuditedFetcher(delay_seconds=delay)
    sources: list[dict] = []
    failures: list[dict[str, str]] = []
    for source_id, url in OFFICIAL_SOURCES.items():
        try:
            sources.append(save_snapshot(fetcher.fetch(url), source_id))
        except Exception as error:
            failures.append({"source_id": source_id, "url": url, "error": str(error)})
    result = {"sources": sources, "failures": failures}
    write_json(output, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Crawl official MOE and MHRSS catalog sources")
    parser.add_argument("--delay", type=float, default=1.25)
    parser.add_argument("--output", type=Path, default=RAW_DIR / "authority-crawl.json")
    args = parser.parse_args()
    result = crawl(delay=args.delay, output=args.output)
    print(f"fetched={len(result['sources'])} failures={len(result['failures'])} output={args.output}")


if __name__ == "__main__":
    main()

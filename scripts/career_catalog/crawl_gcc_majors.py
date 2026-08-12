from __future__ import annotations

import argparse
from pathlib import Path

from scripts.career_catalog.common import (
    AuditedFetcher,
    RAW_DIR,
    parse_html,
    resolve_url,
    read_json,
    save_snapshot,
    stable_id,
    write_json,
)

INDEX_URL = "https://zsb.gcc.edu.cn/zyjs/index.htm"
SCHOOL_PROFILE_URL = "https://www.gcc.edu.cn/xxgk/xxjj/index.htm"


def crawl(*, delay: float, output: Path) -> dict:
    previous_sources = {}
    if output.exists():
        previous = read_json(output)
        previous_sources = {source["url"]: source for source in previous.get("sources", [])}
    fetcher = AuditedFetcher(delay_seconds=delay)
    index_result = fetcher.fetch(INDEX_URL)
    sources = [save_snapshot(index_result, "gcc-major-index-2026")]
    failures: list[dict[str, str]] = []
    try:
        sources.append(save_snapshot(fetcher.fetch(SCHOOL_PROFILE_URL), "gcc-school-profile-2026"))
    except Exception as error:
        failures.append({"url": SCHOOL_PROFILE_URL, "error": str(error)})
        if cached := previous_sources.get(SCHOOL_PROFILE_URL):
            sources.append({**cached, "cache_status": "reused_after_fetch_failure"})
    index = parse_html(index_result.content)
    links = sorted(
        {
            resolve_url(INDEX_URL, href)
            for href, label in index.links
            if "2026年专业介绍" in label and href.endswith(".htm")
        }
    )
    for url in links:
        source_id = stable_id("gcc-major-page", url)
        try:
            sources.append(save_snapshot(fetcher.fetch(url), source_id))
        except Exception as error:  # failure belongs in the audit output
            failures.append({"url": url, "error": str(error)})
            if cached := previous_sources.get(url):
                sources.append({**cached, "cache_status": "reused_after_fetch_failure"})
    payload = {
        "index_url": INDEX_URL,
        "discovered_2026_pages": len(links),
        "sources": sources,
        "failures": failures,
    }
    write_json(output, payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Crawl official GCC 2026 major pages")
    parser.add_argument("--delay", type=float, default=1.25, help="minimum delay between requests")
    parser.add_argument("--output", type=Path, default=RAW_DIR / "gcc-crawl.json")
    args = parser.parse_args()
    result = crawl(delay=args.delay, output=args.output)
    print(f"fetched={len(result['sources'])} failures={len(result['failures'])} output={args.output}")


if __name__ == "__main__":
    main()

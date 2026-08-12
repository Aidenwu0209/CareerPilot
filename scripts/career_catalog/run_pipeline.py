from __future__ import annotations

import argparse

from scripts.career_catalog.build_china_major_graph import build
from scripts.career_catalog.common import CATALOG_DIR, RAW_DIR, write_json
from scripts.career_catalog.crawl_gcc_majors import crawl as crawl_gcc
from scripts.career_catalog.crawl_occupation_catalog import crawl as crawl_authorities
from scripts.career_catalog.crawl_china_standards import crawl as crawl_china
from scripts.career_catalog.parse_gcc_majors import parse_crawl
from scripts.career_catalog.validate_catalog import validate


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the auditable career catalog pipeline")
    parser.add_argument("--delay", type=float, default=1.25)
    args = parser.parse_args()
    crawl_gcc(delay=args.delay, output=RAW_DIR / "gcc-crawl.json")
    write_json(RAW_DIR / "gcc-parsed.json", parse_crawl(RAW_DIR / "gcc-crawl.json"))
    crawl_authorities(delay=args.delay, output=RAW_DIR / "authority-crawl.json")
    crawl_china(delay=args.delay, output=RAW_DIR / "china-standards-crawl.json")
    build(
        parsed_path=RAW_DIR / "gcc-parsed.json",
        china_crawl_path=RAW_DIR / "china-standards-crawl.json",
        output_dir=CATALOG_DIR,
    )
    errors = validate(CATALOG_DIR)
    if errors:
        raise SystemExit("\n".join(errors))
    print("pipeline=ok")


if __name__ == "__main__":
    main()

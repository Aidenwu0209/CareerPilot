from __future__ import annotations

import argparse

from scripts.career_catalog.build_major_job_graph import build
from scripts.career_catalog.common import CATALOG_DIR, RAW_DIR, write_json
from scripts.career_catalog.crawl_gcc_majors import crawl as crawl_gcc
from scripts.career_catalog.crawl_occupation_catalog import crawl as crawl_authorities
from scripts.career_catalog.normalize_job_titles import normalize
from scripts.career_catalog.parse_gcc_majors import parse_crawl
from scripts.career_catalog.validate_catalog import validate


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the auditable career catalog pipeline")
    parser.add_argument("--delay", type=float, default=1.25)
    args = parser.parse_args()
    crawl_gcc(delay=args.delay, output=RAW_DIR / "gcc-crawl.json")
    write_json(RAW_DIR / "gcc-parsed.json", parse_crawl(RAW_DIR / "gcc-crawl.json"))
    write_json(RAW_DIR / "normalized-titles.json", normalize(RAW_DIR / "gcc-parsed.json"))
    crawl_authorities(delay=args.delay, output=RAW_DIR / "authority-crawl.json")
    build(
        parsed_path=RAW_DIR / "gcc-parsed.json",
        titles_path=RAW_DIR / "normalized-titles.json",
        authority_path=RAW_DIR / "authority-crawl.json",
        output_dir=CATALOG_DIR,
    )
    errors = validate(CATALOG_DIR)
    if errors:
        raise SystemExit("\n".join(errors))
    print("pipeline=ok")


if __name__ == "__main__":
    main()

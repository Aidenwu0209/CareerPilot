from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from scripts.career_catalog.common import CATALOG_DIR, read_json
from scripts.career_catalog.validate_catalog import validate


def plan(catalog_dir: Path) -> dict:
    manifest = read_json(catalog_dir / "catalog_manifest.json")
    return {
        "catalog_version": manifest["catalog_version"],
        "publication_status": manifest["publication_status"],
        "scoring_safe": manifest["scoring_safe"],
        "counts": {name: details["count"] for name, details in manifest["files"].items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and plan a career catalog import")
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR)
    parser.add_argument("--database", type=Path, help="SQLite database target")
    parser.add_argument("--apply", action="store_true", help="explicitly allow a reviewed catalog import")
    args = parser.parse_args()
    errors = validate(args.catalog_dir)
    if errors:
        print("catalog validation failed", file=sys.stderr)
        sys.exit(1)
    import_plan = plan(args.catalog_dir)
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", **import_plan}, ensure_ascii=False, indent=2))
    if not args.apply:
        return
    if not args.database:
        parser.error("--database is required with --apply")
    if import_plan["publication_status"] != "approved" or not import_plan["scoring_safe"]:
        parser.error("refusing to apply: catalog requires human review and is not scoring-safe")
    # The reviewed contract is deliberately gated. Part 3 owns the transactional
    # schema-specific importer; this guard prevents the crawler from mutating a DB.
    with sqlite3.connect(f"file:{args.database}?mode=rw", uri=True) as connection:
        connection.execute("SELECT 1")
    parser.error("schema-specific apply is not available until Part 3 importer is installed")


if __name__ == "__main__":
    main()

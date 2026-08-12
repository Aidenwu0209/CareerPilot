from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from scripts.career_catalog.common import (
    AuditedFetcher,
    RAW_DIR,
    sha256_bytes,
    write_json,
)

ONET_VERSION = "30.3"
ONET_ZIP_URL = "https://www.onetcenter.org/dl_files/database/db_30_3_csv.zip"
REQUIRED_FILES = {
    "occupation_data.csv",
    "essential_skills.csv",
    "knowledge.csv",
    "job_zones.csv",
    "related_occupations.csv",
}


def _find_member(names: list[str], filename: str) -> str:
    matches = [name for name in names if name.lower().endswith("/" + filename) or name.lower() == filename]
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {filename} in O*NET archive; found {matches}")
    return matches[0]


def crawl(*, delay: float, output: Path, force: bool = False) -> dict:
    raw_onet = RAW_DIR / "onet-30.3"
    archive_path = raw_onet / "db_30_3_csv.zip"
    raw_onet.mkdir(parents=True, exist_ok=True)
    fetch_record: dict
    if archive_path.exists() and not force:
        content = archive_path.read_bytes()
        previous = {}
        if output.exists():
            previous = __import__("json").loads(output.read_text("utf-8")).get("archive", {})
        current_hash = sha256_bytes(content)
        if previous and previous.get("content_sha256") != current_hash:
            raise RuntimeError("Cached O*NET archive hash differs from its audited metadata; use --force to refetch")
        fetch_record = previous or {
            "id": "onet-30.3-csv-archive",
            "url": ONET_ZIP_URL,
            "title": "O*NET 30.3 Database CSV archive",
            "publisher": "National Center for O*NET Development",
            "source_type": "official_dataset",
            "published_at": None,
            "fetched_at": None,
            "content_sha256": current_hash,
            "http_status": None,
            "robots_status": "cached_unverified_metadata",
            "license_notes": "O*NET database is available under Creative Commons Attribution 4.0.",
            "raw_path": str(archive_path.relative_to(Path(__file__).resolve().parents[2])),
        }
        fetch_record = {**fetch_record, "cache_status": "hit"}
    else:
        result = AuditedFetcher(delay_seconds=delay, retries=3, timeout=60).fetch(ONET_ZIP_URL)
        archive_path.write_bytes(result.content)
        fetch_record = {
            "id": "onet-30.3-csv-archive",
            "url": result.url,
            "title": "O*NET 30.3 Database CSV archive",
            "publisher": "National Center for O*NET Development",
            "source_type": "official_dataset",
            "published_at": None,
            "fetched_at": result.fetched_at,
            "content_sha256": result.sha256,
            "http_status": result.status,
            "robots_status": result.robots_status,
            "license_notes": "O*NET database is available under Creative Commons Attribution 4.0.",
            "raw_path": str(archive_path.relative_to(Path(__file__).resolve().parents[2])),
            "cache_status": "miss",
        }
    extracted: list[dict] = []
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        for filename in sorted(REQUIRED_FILES):
            member = _find_member(names, filename)
            content = archive.read(member)
            target = raw_onet / filename
            target.write_bytes(content)
            extracted.append({
                "filename": filename,
                "archive_member": member,
                "content_sha256": sha256_bytes(content),
                "size": len(content),
                "raw_path": str(target.relative_to(Path(__file__).resolve().parents[2])),
            })
    payload = {
        "version": ONET_VERSION,
        "archive": fetch_record,
        "files": extracted,
        "failures": [],
    }
    write_json(output, payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and cache the official O*NET 30.3 CSV archive")
    parser.add_argument("--delay", type=float, default=1.25)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--output", type=Path, default=RAW_DIR / "onet-crawl.json")
    args = parser.parse_args()
    result = crawl(delay=args.delay, output=args.output, force=args.force)
    print(
        f"onet_version={result['version']} files={len(result['files'])} "
        f"cache={result['archive']['cache_status']} sha256={result['archive']['content_sha256']}"
    )


if __name__ == "__main__":
    main()

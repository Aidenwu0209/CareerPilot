from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.career_catalog.build_major_job_graph import build
from scripts.career_catalog.common import (
    CATALOG_DIR,
    AuditedFetcher,
    FIXTURE_DIR,
    parse_html,
    read_json,
    sha256_bytes,
    write_json,
)
from scripts.career_catalog.normalize_job_titles import candidate_titles, normalize
from scripts.career_catalog.parse_gcc_majors import parse_crawl
from scripts.career_catalog.validate_catalog import validate


class CatalogPipelineTests(unittest.TestCase):
    def test_allowlist_rejects_unknown_or_insecure_hosts(self) -> None:
        fetcher = AuditedFetcher(delay_seconds=0)
        with self.assertRaises(ValueError):
            fetcher.fetch("https://example.com/jobs")
        with self.assertRaises(ValueError):
            fetcher.fetch("http://zsb.gcc.edu.cn/zyjs/index.htm")

    def test_fixture_parse_normalize_build_validate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw = root / "raw"
            raw.mkdir()
            fixture = FIXTURE_DIR / "gcc_major_page.html"
            copied = raw / "fixture.html"
            copied.write_bytes(fixture.read_bytes())
            source = {
                "id": "fixture-source",
                "url": "https://zsb.gcc.edu.cn/fixture.htm",
                "title": "fixture",
                "publisher": "zsb.gcc.edu.cn",
                "source_type": "official_webpage",
                "published_at": "2026-01-01T00:00:00Z",
                "fetched_at": "2026-01-02T00:00:00Z",
                "content_sha256": sha256_bytes(copied.read_bytes()),
                "http_status": 200,
                "robots_status": "fixture",
                "license_notes": "offline fixture",
                "raw_path": str(copied),
            }
            crawl_path = raw / "crawl.json"
            write_json(crawl_path, {"sources": [source], "failures": []})
            parsed = parse_crawl(crawl_path)
            self.assertEqual(len(parsed["colleges"]), 1)
            self.assertEqual(len(parsed["majors"]), 1)
            parsed_path = raw / "parsed.json"
            write_json(parsed_path, parsed)
            normalized = normalize(parsed_path)
            self.assertGreaterEqual(len(normalized["candidate_aliases"]), 3)
            titles_path = raw / "titles.json"
            write_json(titles_path, normalized)
            authority_path = raw / "authority.json"
            write_json(authority_path, {"sources": [], "failures": []})
            catalog = root / "catalog"
            build(parsed_path=parsed_path, titles_path=titles_path, authority_path=authority_path, output_dir=catalog)
            self.assertEqual(validate(catalog), [])

    def test_candidate_titles_are_deterministic(self) -> None:
        value = "可从事平面设计师、数据分析师及软件工程师等工作。"
        self.assertEqual(candidate_titles(value), candidate_titles(value))

    def test_candidate_titles_reject_school_facility_and_award_noise(self) -> None:
        text = (
            "企业法务专员、数据分析师；"
            "教学设施 学院现有14间实验实训室；"
            "学院教师团队荣获优秀教学成果特等奖2项。"
        )
        self.assertEqual(candidate_titles(text), ["企业法务专员", "数据分析师"])

    def test_html_parser_extracts_links_and_text(self) -> None:
        parser = parse_html(b'<html><title>x</title><a href="/a">2026\xe4\xb8\x93\xe4\xb8\x9a</a></html>')
        self.assertEqual(parser.title, "x")
        self.assertEqual(parser.links, [("/a", "2026专业")])

    def test_committed_catalog_envelope_and_placeholder_safety(self) -> None:
        self.assertEqual(validate(CATALOG_DIR), [])
        manifest = read_json(CATALOG_DIR / "catalog_manifest.json")
        majors = read_json(CATALOG_DIR / "majors.json")
        occupations = read_json(CATALOG_DIR / "occupations.json")
        self.assertEqual(majors["schema_version"], "1.0.0")
        self.assertEqual(occupations["schema_version"], "1.0.0")
        self.assertEqual(majors["catalog_version"], occupations["catalog_version"])
        self.assertGreaterEqual(len(majors["items"]), 41)
        self.assertGreaterEqual(len(occupations["items"]), len(majors["items"]))
        self.assertEqual(manifest["publication_status"], "candidate")
        self.assertFalse(manifest["scoring_safe"])
        self.assertTrue(
            all(
                item["canonical_type"] == "unresolved_placeholder"
                and item["review_status"] == "review_required"
                and item["scoring_eligible"] is False
                for item in occupations["items"]
            )
        )


if __name__ == "__main__":
    unittest.main()

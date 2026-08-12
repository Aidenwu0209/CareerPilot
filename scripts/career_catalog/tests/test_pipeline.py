from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.career_catalog.build_china_major_graph import parse_dadian, parse_standard_skills
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

    def test_fixture_parse_and_normalize(self) -> None:
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

    def test_chinese_dadian_parser_keeps_official_tasks(self) -> None:
        sample = """2 - 0 6 - 0 3 - 0 0 会计专业人员
在单位中进行会计核算和监督的专业人员。
主要工作任务:
1 .进行会计核算;
2 .进行会计监督;
3 .制订内部会计制度;
4 .分析财务与业务信息。
"""
        parsed = parse_dadian(sample)
        self.assertEqual(parsed["2-06-03-00"]["name"], "会计专业人员")
        self.assertEqual(len(parsed["2-06-03-00"]["tasks"]), 4)

    def test_national_standard_parser_reads_entry_level_skills(self) -> None:
        sample = """1. 3 职业定义
从事测试工作的人员。
1. 4 职业技能等级
3. 工作要求
3. 1 四级/中级工
1. 1. 1 能识读设计文档
1. 1. 2 设计文档的结构
1. 1. 2 能分析模块需求
2. 1. 1 能编写程序代码
2. 1. 2 能进行功能测试
3. 2 三级/高级工
"""
        level, definition, skills = parse_standard_skills(sample)
        self.assertEqual(level, "四级/中级工")
        self.assertEqual(definition, "从事测试工作的人员")
        self.assertEqual(len(skills), 4)

    def test_committed_catalog_is_approved_traceable_and_scoreable(self) -> None:
        self.assertEqual(validate(CATALOG_DIR), [])
        manifest = read_json(CATALOG_DIR / "catalog_manifest.json")
        majors = read_json(CATALOG_DIR / "majors.json")
        occupations = read_json(CATALOG_DIR / "occupations.json")
        requirements = read_json(CATALOG_DIR / "occupation_requirements.json")["items"]
        edges = read_json(CATALOG_DIR / "major_occupation_edges.json")["items"]
        sources = read_json(CATALOG_DIR / "sources.json")["items"]
        self.assertEqual(majors["schema_version"], "1.0.0")
        self.assertEqual(occupations["schema_version"], "1.0.0")
        self.assertEqual(majors["catalog_version"], occupations["catalog_version"])
        self.assertEqual(len({item["name"] for item in majors["items"]}), 45)
        self.assertEqual(len(edges), len(majors["items"]) * 5)
        for major in majors["items"]:
            relation_types = [edge["relation_type"] for edge in edges if edge["major_id"] == major["id"]]
            self.assertEqual(relation_types.count("primary"), 1)
            self.assertEqual(relation_types.count("adjacent"), 2)
            self.assertEqual(relation_types.count("stretch"), 2)
        self.assertEqual(manifest["publication_status"], "approved")
        self.assertTrue(manifest["scoring_safe"])
        self.assertRegex(manifest["catalog_version"], r"^gcc-cn-2022-\d{8}-[0-9a-f]{10}$")
        self.assertIn("中华人民共和国职业分类大典", manifest["standard_system"])
        self.assertGreaterEqual(len(occupations["items"]), 90)
        self.assertTrue(
            all(
                item["canonical_type"] == "china_national_occupation"
                and item["review_status"] == "approved"
                and item["scoring_eligible"] is True
                for item in occupations["items"]
            )
        )
        for occupation in occupations["items"]:
            current = [item for item in requirements if item["occupation_code"] == occupation["code"]]
            self.assertGreaterEqual(len(current), 4)
            self.assertGreaterEqual(sum(item["requirement_type"] == "skill" for item in current), 3)
            self.assertRegex(occupation["code"], r"^[2-6]-\d{2}-\d{2}-\d{2}$")
            self.assertTrue(any(
                any(host in source["url"] for host in ("mohrss.gov.cn", "osta.mohrss.gov.cn", "srsj.cngy.gov.cn"))
                for source in sources if source["id"] in occupation["source_ids"]
            ))
        self.assertTrue(all(any("\u4e00" <= char <= "\u9fff" for char in item["ability_name"]) for item in requirements))
        self.assertTrue(all("不是官方考试分数" in item["description"] for item in requirements))
        self.assertFalse(any("O*NET" in item["description"] for item in requirements))

if __name__ == "__main__":
    unittest.main()

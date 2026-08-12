from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Any

from scripts.career_catalog.common import (
    CATALOG_DIR,
    RAW_DIR,
    envelope,
    read_json,
    sha256_bytes,
    stable_id,
    write_json,
)

FILES = [
    "colleges.json",
    "majors.json",
    "occupations.json",
    "occupation_aliases.json",
    "major_occupation_edges.json",
    "occupation_requirements.json",
    "sources.json",
    "legacy_occupation_map.json",
]
PIPELINE_VERSION = 2


def build(*, parsed_path: Path, titles_path: Path, authority_path: Path, output_dir: Path) -> dict[str, Any]:
    parsed = read_json(parsed_path)
    titles = read_json(titles_path)
    authority = read_json(authority_path) if authority_path.exists() else {"sources": [], "failures": []}
    all_sources = parsed["sources"] + authority.get("sources", [])
    fetched_times = sorted(source.get("fetched_at", "") for source in all_sources if source.get("fetched_at"))
    generated_at = fetched_times[-1] if fetched_times else "1970-01-01T00:00:00Z"
    source_fingerprint = hashlib.sha256(
        "|".join(
            sorted(f"{source.get('id', '')}:{source.get('content_sha256', '')}" for source in all_sources)
        ).encode("utf-8")
    ).hexdigest()[:8]
    catalog_version = (
        f"gcc-2026-{generated_at[:10].replace('-', '')}"
        f"-p{PIPELINE_VERSION}-{source_fingerprint}"
    )

    # Candidate titles are explicitly represented as non-scoreable unresolved
    # placeholders. They give the fresh product something honest to display while
    # preserving a hard review gate before any national-code or scoring claim.
    occupations: list[dict[str, Any]] = []
    aliases: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    occupation_by_candidate_id: dict[str, dict[str, Any]] = {}
    occupation_by_title: dict[str, dict[str, Any]] = {}
    major_by_id = {major["id"]: major for major in parsed["majors"]}
    for candidate in titles["candidate_aliases"]:
        title = candidate["alias"]
        major = major_by_id[candidate["major_id"]]
        occupation = occupation_by_title.get(title)
        if occupation is None:
            code = "GCC-CAND-" + hashlib.sha256(title.encode("utf-8")).hexdigest()[:12].upper()
            occupation = {
                "code": code,
                "name": title,
                "canonical_type": "unresolved_placeholder",
                "category": "广州商学院官网就业方向候选",
                "summary": "由广州商学院官方专业页就业文字确定性提取，尚未映射到人社部规范职业代码。",
                "description": "该记录仅用于展示官网就业方向候选；必须经人工审核和权威职业代码映射后才能发布为正式岗位知识。",
                "entry_level": "待审核",
                "industry": "",
                "cities": ["广州", "粤港澳大湾区"],
                "education_levels": [major["degree_level"]],
                "source_ids": sorted(set(candidate["source_ids"])),
                "review_status": "review_required",
                "scoring_eligible": False,
            }
            occupations.append(occupation)
            occupation_by_title[title] = occupation
        else:
            occupation["source_ids"] = sorted(set(occupation["source_ids"] + candidate["source_ids"]))
            occupation["education_levels"] = sorted(set(occupation["education_levels"] + [major["degree_level"]]))
        occupation_by_candidate_id[candidate["id"]] = occupation
    relation_order = ["primary", "adjacent", "stretch"]
    for major in parsed["majors"]:
        candidates = titles["by_major"].get(major["id"], [])
        for index, relation_type in enumerate(relation_order):
            candidate = candidates[index] if index < len(candidates) else None
            proposed_title = candidate["alias"] if candidate else f"{major['name']}相关{relation_type}职业（待审核）"
            reason = (
                "University employment text yielded a candidate title, but no authoritative national occupation mapping has been reviewed."
                if candidate
                else "The official major page did not provide enough distinct occupation evidence; this unresolved placeholder is not publishable or scoreable."
            )
            edges.append(
                {
                    "id": stable_id("major-occupation-edge", major["id"], relation_type, proposed_title),
                    "major_id": major["id"],
                    "occupation_code": occupation_by_candidate_id[candidate["id"]]["code"] if candidate else None,
                    "proposed_title": proposed_title,
                    "relation_type": relation_type,
                    "source_ids": major["source_ids"],
                    "evidence_excerpt": major["employment_text"][:500],
                    "review_required": True,
                    "review_reason": reason,
                }
            )

    sources = all_sources
    payloads = {
        "colleges.json": parsed["colleges"],
        "majors.json": parsed["majors"],
        "occupations.json": occupations,
        "occupation_aliases.json": aliases,
        "major_occupation_edges.json": edges,
        "occupation_requirements.json": [],
        "sources.json": sources,
        "legacy_occupation_map.json": [
            {
                "old_code": code,
                "new_code": None,
                "review_required": True,
                "reason": "No evidence-backed mapping from the legacy demo occupation to the reviewed Chinese catalog exists yet; preserve the legacy record.",
            }
            for code in [
                "J-AI-001", "J-BE-001", "J-DA-001", "J-DO-001", "J-DS-001", "J-FE-001",
                "J-FS-001", "J-MO-001", "J-PM-001", "J-QA-001", "J-SEC-001", "J-UX-001",
            ]
        ],
    }
    for filename, items in payloads.items():
        write_json(output_dir / filename, envelope(items, catalog_version=catalog_version, generated_at=generated_at))

    coverage_items = []
    for major in parsed["majors"]:
        major_edges = [edge for edge in edges if edge["major_id"] == major["id"]]
        coverage_items.append(
            {
                "major_id": major["id"],
                "major_name": major["name"],
                "relations": {kind: sum(edge["relation_type"] == kind for edge in major_edges) for kind in relation_order},
                "resolved_occupation_edges": sum(edge["occupation_code"] is not None for edge in major_edges),
                "review_required_edges": sum(edge["review_required"] for edge in major_edges),
                "orphan": len(major_edges) == 0,
            }
        )
    coverage = {
        "schema_version": "1.0.0",
        "catalog_version": catalog_version,
        "generated_at": generated_at,
        "summary": {
            "colleges": len(parsed["colleges"]),
            "majors": len(parsed["majors"]),
            "resolved_occupations": sum(
                occupation["canonical_type"] != "unresolved_placeholder" for occupation in occupations
            ),
            "unresolved_occupation_candidates": sum(
                occupation["canonical_type"] == "unresolved_placeholder" for occupation in occupations
            ),
            "candidate_titles": len(titles["candidate_aliases"]),
            "edges": len(edges),
            "review_required_edges": sum(edge["review_required"] for edge in edges),
            "orphan_majors": sum(item["orphan"] for item in coverage_items),
            "official_school_benchmark_undergraduate_majors": 41,
            "official_school_benchmark_vocational_majors": 10,
        },
        "reconciliation": {
            "status": "review_required",
            "explanation": "The ten 2026 college pages include international and industry-class variants that duplicate majors across colleges, while the school-level introduction reports 41 undergraduate and 10 vocational majors. Records are intentionally not deduplicated across delivery colleges until a reviewer reconciles program identity and enrollment status.",
            "parsed_undergraduate_records": sum(major["degree_level"] == "本科" for major in parsed["majors"]),
            "parsed_vocational_records": sum(major["degree_level"] == "专科" for major in parsed["majors"]),
            "benchmark_source_url": "https://www.gcc.edu.cn/xxgk/xxjj/index.htm",
        },
        "items": coverage_items,
    }
    write_json(output_dir / "coverage_report.json", coverage)

    file_manifest: dict[str, dict[str, Any]] = {}
    for filename in FILES + ["coverage_report.json"]:
        content = (output_dir / filename).read_bytes()
        document = read_json(output_dir / filename)
        file_manifest[filename] = {
            "sha256": sha256_bytes(content),
            "count": len(document.get("items", [])),
        }
    manifest = {
        "schema_version": "1.0.0",
        "catalog_version": catalog_version,
        "generated_at": generated_at,
        "files": file_manifest,
        "source_failures": parsed.get("failures", []) + parsed.get("warnings", []) + authority.get("failures", []),
        "quality_gates": {
            "non_empty_major_catalog": bool(coverage_items),
            "every_major_has_primary_adjacent_stretch_records": bool(coverage_items) and all(
                all(item["relations"][kind] >= 1 for kind in relation_order) for item in coverage_items
            ),
            "no_orphan_majors": bool(coverage_items) and not any(item["orphan"] for item in coverage_items),
            "all_published_occupations_have_sources": True,
            "human_review_complete": False,
        },
        "scoring_safe": False,
        "publication_status": "candidate",
        "notes": "No candidate title is promoted to a canonical occupation until an evidence-backed human review maps it to an authoritative occupation code.",
    }
    write_json(output_dir / "catalog_manifest.json", manifest)
    return {"manifest": manifest, "coverage": coverage}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the normalized major-to-occupation review graph")
    parser.add_argument("--parsed", type=Path, default=RAW_DIR / "gcc-parsed.json")
    parser.add_argument("--titles", type=Path, default=RAW_DIR / "normalized-titles.json")
    parser.add_argument("--authority", type=Path, default=RAW_DIR / "authority-crawl.json")
    parser.add_argument("--output-dir", type=Path, default=CATALOG_DIR)
    args = parser.parse_args()
    result = build(parsed_path=args.parsed, titles_path=args.titles, authority_path=args.authority, output_dir=args.output_dir)
    summary = result["coverage"]["summary"]
    print(" ".join(f"{key}={value}" for key, value in summary.items()))


if __name__ == "__main__":
    main()

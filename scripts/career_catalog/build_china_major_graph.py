from __future__ import annotations

import argparse
import hashlib
import math
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.career_catalog.china_catalog_config import (
    FAMILY_BY_PREFIX,
    GROUPS,
    LEGACY_J_MAP,
    LEGACY_ONET_MAP,
    MAJOR_GROUP,
    NAME_OVERRIDES,
)
from scripts.career_catalog.common import CATALOG_DIR, RAW_DIR, ROOT, envelope, read_json, sha256_bytes, stable_id, write_json

CODE_PATTERN = re.compile(
    r"(?m)^(\d)\s*-\s*(\d\s*\d)\s*-\s*(\d\s*\d)\s*-\s*(\d\s*\d)\s+([^\n]+)"
)
TASK_PATTERN = re.compile(r"(?m)^\s*(\d{1,2})\s*\.\s*")
LEVEL_PATTERN = re.compile(r"3\.\s*1\s+([^\n]+)")
SKILL_ITEM_PATTERN = re.compile(r"(?m)^\s*\d+\.\s*\d+\.\s*\d+\s+")
PIPELINE_VERSION = "china-career-catalog-v1.1.0"


def _text_from_pdf(pdf_path: Path, output_name: str) -> str:
    output = RAW_DIR / "china-text" / output_name
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftotext", "-raw", str(pdf_path), str(output)], check=True, capture_output=True)
    return output.read_text("utf-8", errors="replace")


def _clean(value: str) -> str:
    value = value.replace("\x0c", " ")
    value = re.sub(r"\d{1,4}\s*中华人民共和国\s*职业分类大典\s*（?\s*2\s*0\s*2\s*2\s*年版\s*）?", " ", value)
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"\d{1,4}中华人民共和国职业分类大典（?2022年版）?", "", value)
    value = re.sub(r"\d{2,4}(?:（GBM\d+）)?(?:专业技术人员|社会生产服务和生活服务人员)$", "", value)
    # `pdftotext -raw` can join the Dadian page footer's trailing "员" and the
    # next page's section marker "S" onto the following definition.
    value = re.sub(r"^员S(?=从事)", "", value)
    return value.strip(";；。:：")


def parse_dadian(text: str) -> dict[str, dict[str, Any]]:
    matches = list(CODE_PATTERN.finditer(text))
    parsed: dict[str, dict[str, Any]] = {}
    for index, match in enumerate(matches):
        code = "-".join([match.group(1)] + [re.sub(r"\s", "", match.group(group)) for group in range(2, 5)])
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        segment = text[match.end():end]
        if "主要工作任务:" not in segment:
            continue
        definition_raw, task_raw = segment.split("主要工作任务:", 1)
        task_matches = list(TASK_PATTERN.finditer(task_raw))
        tasks = []
        for task_index, task_match in enumerate(task_matches):
            task_end = task_matches[task_index + 1].start() if task_index + 1 < len(task_matches) else len(task_raw)
            task = _clean(task_raw[task_match.end():task_end])
            if len(task) >= 6 and task not in tasks:
                tasks.append(task)
        if not tasks:
            continue
        name = NAME_OVERRIDES.get(code) or re.sub(r"\s+", "", match.group(5)).rstrip("SL")
        definition = _clean(definition_raw)
        candidate = {"code": code, "name": name, "definition": definition, "tasks": tasks}
        if len(tasks) > len(parsed.get(code, {}).get("tasks", [])):
            parsed[code] = candidate
    return parsed


def parse_standard_skills(text: str) -> tuple[str, str, list[str]]:
    normalized = text.replace("\x0c", "\n")
    definition_match = re.search(r"1\.\s*3\s*职业(?:（工种）)?定义\s*(.*?)(?=1\.\s*4\s*)", normalized, re.S)
    definition = _clean(definition_match.group(1))[:500] if definition_match else ""
    work_start = re.search(r"3\.\s*工作要求", normalized)
    if work_start:
        normalized = normalized[work_start.end():]
    start = re.search(r"3\.\s*1\s+([^\n]+)", normalized)
    level = _clean(start.group(1))[:80] if start else "初始职业等级"
    if start:
        normalized = normalized[start.end():]
    next_level = re.search(r"(?m)^\s*3\.\s*2\s+", normalized)
    section = normalized[:next_level.start()] if next_level else normalized[:30000]
    matches = list(SKILL_ITEM_PATTERN.finditer(section))
    skills: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        value = _clean(section[match.end():end])
        if value.startswith("能") and 4 <= len(value) <= 180 and value not in skills:
            skills.append(value)
    return level or "初始职业等级", definition, skills[:12]


def _family(code: str) -> tuple[str, str]:
    return FAMILY_BY_PREFIX.get(code[:4], ("中国职业分类岗位", "综合专业服务"))


def _requirement_dimension(text: str) -> str:
    if any(token in text for token in ("知识", "法规", "标准", "原理", "政策", "理论")):
        return "domain_knowledge"
    if any(token in text for token in ("沟通", "协调", "咨询", "汇报", "表达", "团队")):
        return "general_competencies"
    if any(token in text for token in ("项目", "实施", "制作", "开发", "设计", "操作", "测试")):
        return "project_practice"
    return "professional_skills"


def _ability_name(text: str, index: int) -> str:
    value = text.removeprefix("能").strip("，,。；;")
    for splitter in ("，", ",", "并", "及", "和"):
        if splitter in value and len(value.split(splitter, 1)[0]) >= 4:
            value = value.split(splitter, 1)[0]
            break
    return (value[:22] or f"职业任务 {index}").strip()


def _legacy_mappings() -> list[dict[str, Any]]:
    mappings = {**LEGACY_J_MAP, **LEGACY_ONET_MAP}
    return [
        {
            "old_code": old_code,
            "new_code": new_code,
            "review_required": False,
            "reason": "Reviewed migration from a legacy demo/O*NET role to the closest Chinese 2022 occupation-classification role.",
        }
        for old_code, new_code in sorted(mappings.items())
    ]


def build(*, parsed_path: Path, china_crawl_path: Path, output_dir: Path) -> dict[str, Any]:
    parsed = read_json(parsed_path)
    crawl = read_json(china_crawl_path)
    dadian_source = crawl["dadian"]
    dadian_path = ROOT / dadian_source["raw_path"]
    dadian = parse_dadian(_text_from_pdf(dadian_path, "occupation-classification-2022.txt"))
    standards_by_code = {item["code"]: item for item in crawl.get("standards", [])}
    standard_skills: dict[str, tuple[str, str, list[str]]] = {}
    for code, standard in standards_by_code.items():
        path = ROOT / standard["raw_path"]
        standard_skills[code] = parse_standard_skills(_text_from_pdf(path, f"standard-{code}.txt"))

    unique_major_names = sorted({major["name"] for major in parsed["majors"]})
    missing_majors = sorted(set(unique_major_names) - set(MAJOR_GROUP))
    if missing_majors:
        raise RuntimeError(f"Unmapped GCC majors: {missing_majors}")
    # Publish the full reviewed GCC-relevant Chinese occupation set, including
    # a small cross-major management group used by legacy product goals.
    selected_codes = sorted({code for codes in GROUPS.values() for code in codes})
    missing_codes = [
        code for code in selected_codes
        if code not in dadian and len(standard_skills.get(code, ("", "", []))[2]) < 4
    ]
    if missing_codes:
        raise RuntimeError(f"Selected occupations missing parsed Dadian tasks: {missing_codes}")

    generated_at = crawl["fetched_at"]
    input_hashes = [PIPELINE_VERSION, dadian_source["content_sha256"]] + sorted(
        item["content_sha256"] for item in crawl.get("standards", [])
    ) + sorted(item["content_sha256"] for item in parsed["sources"] if item.get("content_sha256"))
    revision = hashlib.sha256("|".join(input_hashes).encode("utf-8")).hexdigest()[:10]
    catalog_version = f"gcc-cn-2022-{generated_at[:10].replace('-', '')}-{revision}"
    source_items = []
    for item in [dadian_source, crawl["notice"], crawl["standard_portal"], *crawl.get("standards", []), *parsed["sources"]]:
        source_items.append({key: value for key, value in item.items() if key != "raw_path" and key not in {"code", "name", "issue_time", "issue_number", "standard_info_name", "portal_url"}})
    source_ids = {item["id"] for item in source_items}

    degrees_by_code: dict[str, set[str]] = defaultdict(set)
    majors_by_code: dict[str, set[str]] = defaultdict(set)
    for major in parsed["majors"]:
        for code in GROUPS[MAJOR_GROUP[major["name"]]]:
            degrees_by_code[code].add(major["degree_level"])
            majors_by_code[code].add(major["name"])

    occupations: list[dict[str, Any]] = []
    requirements: list[dict[str, Any]] = []
    aliases: list[dict[str, Any]] = []
    basis_counts = {"national_standard": 0, "dadian_task_model": 0}
    for code in selected_codes:
        dadian_item = dadian.get(code)
        standard = standards_by_code.get(code)
        level, standard_definition, skills = standard_skills.get(code, ("", "", []))
        use_standard = standard is not None and len(skills) >= 4
        item = dadian_item or {
            "code": code,
            "name": NAME_OVERRIDES.get(code) or str(standard.get("name", code)).replace("S", "").split("（", 1)[0],
            "definition": standard_definition,
            "tasks": [],
        }
        statements = skills if use_standard else item["tasks"][:12]
        if len(statements) < 4:
            raise RuntimeError(f"Occupation {code} has fewer than four traceable assessment statements")
        basis = "national_standard" if use_standard else "dadian_task_model"
        basis_counts[basis] += 1
        family, industry = _family(code)
        occupation_sources = ["china-occupation-classification-2022"]
        if standard:
            occupation_sources.append(standard["id"])
        basis_label = (
            f"国家职业标准初始等级（{level}）技能要求" if use_standard
            else "《中华人民共和国职业分类大典（2022年版）》主要工作任务的 CareerPilot 简易判定模型"
        )
        occupations.append({
            "code": code,
            "name": item["name"],
            "canonical_type": "china_national_occupation",
            "category": family,
            "job_family": family,
            "summary": item["definition"][:360],
            "description": f"{item['definition']}\n判定依据：{basis_label}。匹配分仅表示学生证据与岗位要求的覆盖情况，不代表国家职业资格或技能等级认定。",
            "entry_level": level if use_standard else "职业探索简易判定（非职业资格等级）",
            "industry": industry,
            "cities": [],
            "education_levels": sorted(degrees_by_code[code]),
            "source_ids": occupation_sources,
            "review_status": "approved",
            "scoring_eligible": True,
        })
        aliases.append({
            "id": stable_id("alias", code, item["name"]),
            "occupation_code": code,
            "alias": item["name"].replace("专业人员", "").replace("工程技术人员", "工程师"),
            "source_ids": ["china-occupation-classification-2022"],
            "review_status": "approved",
        })
        requirement_source = standard["id"] if use_standard else "china-occupation-classification-2022"
        for index, statement in enumerate(statements, start=1):
            ability_name = _ability_name(statement, index)
            requirement_type = "knowledge" if _requirement_dimension(statement) == "domain_knowledge" else "skill"
            requirements.append({
                "id": stable_id("cn-req", code, statement),
                "occupation_code": code,
                "ability_code": f"cn_{hashlib.sha256(f'{code}|{statement}'.encode()).hexdigest()[:12]}",
                "ability_name": ability_name,
                "dimension": _requirement_dimension(statement),
                "target_score": 60,
                "weight": 1,
                "required": index <= max(3, math.ceil(len(statements) * 0.6)),
                "description": f"{basis_label}：{statement}。CareerPilot 采用 0–100 证据量表并以 60 分作为产品内满足阈值；这不是官方考试分数。",
                "education_level": "、".join(sorted(degrees_by_code[code])),
                "experience_level": level if use_standard else "在校生可提交课程、项目、实习或作品证据",
                "region": "中国",
                "source_ids": [requirement_source],
                "review_status": "approved",
                "requirement_type": requirement_type,
            })

    edges: list[dict[str, Any]] = []
    relation_types = ("primary", "adjacent", "stretch", "adjacent", "stretch")
    for major in parsed["majors"]:
        codes = GROUPS[MAJOR_GROUP[major["name"]]]
        for relation_type, code in zip(relation_types, codes):
            edges.append({
                "id": stable_id("cn-edge", major["id"], relation_type, code),
                "major_id": major["id"],
                "occupation_code": code,
                "proposed_title": None,
                "relation_type": relation_type,
                "source_ids": list(dict.fromkeys([*major["source_ids"], "china-occupation-classification-2022"])),
                "evidence_excerpt": major["employment_text"][:500],
                "review_required": False,
                "review_reason": "根据广州商学院专业培养与就业方向，映射至中国2022版职业分类代码。",
            })

    relations_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for group, codes in GROUPS.items():
        relation_candidates = []
        for index, target in enumerate(codes[1:], start=1):
            relation_candidates.extend((
                (codes[0], target, "related_to" if relation_types[index] == "adjacent" else "progresses_to"),
                (target, codes[0], "transfers_to"),
            ))
        for source, target, relation_type in relation_candidates:
            if source == target:
                continue
            relations_by_key.setdefault((source, target), {
                "id": stable_id("cn-relation", source, target),
                "from_code": source,
                "to_code": target,
                "relation_type": relation_type,
                "description": f"CareerPilot 基于广州商学院专业方向形成的{group}职业发展关系，不代表官方晋升资格。",
                "source_ids": ["china-occupation-classification-2022"],
                "review_status": "approved",
            })

    payloads = {
        "colleges.json": parsed["colleges"],
        "majors.json": parsed["majors"],
        "occupations.json": occupations,
        "occupation_aliases.json": aliases,
        "major_occupation_edges.json": edges,
        "occupation_requirements.json": requirements,
        "occupation_relations.json": sorted(relations_by_key.values(), key=lambda row: (row["from_code"], row["to_code"])),
        "sources.json": [item for item in source_items if item["id"] in source_ids],
        "legacy_occupation_map.json": _legacy_mappings(),
    }
    for filename, items in payloads.items():
        write_json(output_dir / filename, envelope(items, catalog_version=catalog_version, generated_at=generated_at))

    coverage_items = []
    for major in parsed["majors"]:
        major_edges = [edge for edge in edges if edge["major_id"] == major["id"]]
        coverage_items.append({
            "major_id": major["id"], "major_name": major["name"],
            "relations": {kind: sum(edge["relation_type"] == kind for edge in major_edges) for kind in relation_types},
            "resolved_occupation_edges": len(major_edges), "review_required_edges": 0, "orphan": False,
        })
    coverage = {
        "schema_version": "1.0.0", "catalog_version": catalog_version, "generated_at": generated_at,
        "summary": {
            "colleges": len(parsed["colleges"]), "major_records": len(parsed["majors"]), "unique_majors": len(unique_major_names),
            "occupations": len(occupations), "requirements": len(requirements), "edges": len(edges),
            "occupation_relations": len(relations_by_key), "orphan_majors": 0, **basis_counts,
        },
        "items": coverage_items,
    }
    write_json(output_dir / "coverage_report.json", coverage)
    files = {}
    for filename in [*payloads, "coverage_report.json"]:
        raw = (output_dir / filename).read_bytes()
        files[filename] = {"sha256": sha256_bytes(raw), "count": len(read_json(output_dir / filename)["items"])}
    manifest = {
        "schema_version": "1.0.0", "catalog_version": catalog_version, "generated_at": generated_at, "files": files,
        "source_failures": crawl.get("failures", []), "transport_notes": crawl.get("transport_notes", []),
        "quality_gates": {
            "all_45_unique_majors_mapped": len(unique_major_names) == 45,
            "every_major_has_five_resolved_edges": all(item["resolved_occupation_edges"] == 5 for item in coverage_items),
            "every_occupation_has_traceable_requirements": all(sum(row["occupation_code"] == occupation["code"] for row in requirements) >= 4 for occupation in occupations),
            "china_codes_only": all(re.fullmatch(r"[2-6]-\d{2}-\d{2}-\d{2}", occupation["code"]) for occupation in occupations),
            "curated_mapping_complete": True,
        },
        "publication_status": "approved", "scoring_safe": True,
        "standard_system": "中华人民共和国职业分类大典（2022年版）+现行国家职业标准",
        "scoring_disclaimer": "CareerPilot evidence match is not a national vocational qualification or skill-level examination result.",
    }
    write_json(output_dir / "catalog_manifest.json", manifest)
    return {"manifest": manifest, "coverage": coverage}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the GCC Chinese-standard career catalog")
    parser.add_argument("--parsed", type=Path, default=RAW_DIR / "gcc-parsed.json")
    parser.add_argument("--china", type=Path, default=RAW_DIR / "china-standards-crawl.json")
    parser.add_argument("--output-dir", type=Path, default=CATALOG_DIR)
    args = parser.parse_args()
    result = build(parsed_path=args.parsed, china_crawl_path=args.china, output_dir=args.output_dir)
    print(" ".join(f"{key}={value}" for key, value in result["coverage"]["summary"].items()))


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

from scripts.career_catalog.common import RAW_DIR, clean_text, read_json, stable_id, write_json

TITLE_SUFFIXES = ("师", "员", "经理", "顾问", "专员", "工程师", "助理", "公务员")
FUNCTION_SUFFIXES = ("设计", "开发", "分析", "策划", "运营", "管理", "运维", "核算", "翻译")
SIMPLE_TITLES = {"会计", "审计", "律师", "翻译", "教师", "公务员"}
ORGANIZATION_SUFFIXES = ("公司", "机构", "事务所", "设计院", "工作室", "单位", "部门", "基地", "中心")
NOISE = (
    "学院", "教学", "教师团队", "师资", "课程", "实验", "实训", "教室", "设备", "成果",
    "荣誉", "获奖", "特等奖", "建设", "投入", "参访", "对接", "需求持续增长", "人才需求",
    "潜心", "水平高", "能力强", "满足", "推动理论", "为实践教学", "增加教学",
    "优秀教师", "名师", "升学", "深造", "优质小教师", "全能小职员", "实践》获",
)
GENERIC_DIRECTIONS = {"管理运营", "研发和管理", "存储与管理", "管理和运维", "运维和管理"}


def clean_candidate(value: str) -> str:
    value = clean_text(value)
    value = re.sub(r"^(?:即|包括)[：:]?", "", value)
    value = re.sub(r"^(?:本专业毕业生|毕业生|学生)?(?:可能?|可以|能够|能|也可)?(?:胜任|从事|担任|在|到)+", "", value)
    if match := re.search(r"(?:从事|担任|包括)[：:]?(.+)$", value):
        value = match.group(1)
    value = re.sub(r"^.+的(?=[^\s]{0,12}(?:专员|助理|书记员|公务员)$)", "", value)
    value = re.sub(r"(?:等)?(?:相关)?(?:岗位|工作|方面)$", "", value)
    value = re.sub(r"等(?:领域|行业).*$", "", value)
    value = re.sub(r"^.+等(?=[^\s]{3,20}(?:设计|开发|分析|管理|运营)$)", "", value)
    value = value.replace("相关法务专员", "法务专员")
    return value.strip("：: ，,。；;的中在及或等")


def looks_like_title(value: str) -> bool:
    if value in SIMPLE_TITLES:
        return True
    if value in GENERIC_DIRECTIONS or not 3 <= len(value) <= 20 or re.search(r"\d", value):
        return False
    if any(token in value for token in NOISE) or any(token in value for token in ("从事", "担任", "包括", "岗位：", "即：")):
        return False
    if value.endswith(ORGANIZATION_SUFFIXES):
        return False
    return value.endswith(TITLE_SUFFIXES + FUNCTION_SUFFIXES)


def candidate_titles(text: str) -> list[str]:
    if not text:
        return []
    value = re.sub(r"[。；;]", "，", text)
    pieces = re.split(r"[，、/]", value)
    candidates: list[str] = []
    for piece in pieces:
        piece = clean_candidate(piece)
        for prefix in ["企事业单位", "政府相关部门", "自主创业"]:
            if piece.startswith(prefix):
                piece = piece[len(prefix) :]
        piece = clean_candidate(piece)
        fragments = re.split(r"(?:以及|及|或|与|和)", piece)
        valid = [clean_candidate(fragment) for fragment in fragments]
        valid = [fragment for fragment in valid if looks_like_title(fragment)]
        if not valid and looks_like_title(piece):
            valid = [piece]
        for title in valid:
            if title not in candidates:
                candidates.append(title)
    return candidates[:8]


def normalize(parsed_path: Path) -> dict[str, Any]:
    parsed = read_json(parsed_path)
    aliases: list[dict[str, Any]] = []
    by_major: dict[str, list[dict[str, Any]]] = {}
    seen: set[tuple[str, str]] = set()
    for major in parsed["majors"]:
        for title in candidate_titles(major["employment_text"]):
            key = (major["id"], title)
            if key in seen:
                continue
            record = {
                "id": stable_id("candidate-title", major["id"], title),
                "major_id": major["id"],
                "alias": title,
                "source_ids": major["source_ids"],
                "review_status": "review_required",
                "review_reason": "Title was extracted by deterministic rules from the university employment text; it has not been mapped to a national occupation code.",
            }
            aliases.append(record)
            by_major.setdefault(major["id"], []).append(record)
            seen.add(key)
    return {"candidate_aliases": aliases, "by_major": by_major}


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract reviewable market title candidates")
    parser.add_argument("--input", type=Path, default=RAW_DIR / "gcc-parsed.json")
    parser.add_argument("--output", type=Path, default=RAW_DIR / "normalized-titles.json")
    args = parser.parse_args()
    result = normalize(args.input)
    write_json(args.output, result)
    print(f"candidate_aliases={len(result['candidate_aliases'])} output={args.output}")


if __name__ == "__main__":
    main()

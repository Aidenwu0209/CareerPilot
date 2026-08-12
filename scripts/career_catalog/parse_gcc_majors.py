from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

from scripts.career_catalog.common import RAW_DIR, clean_text, parse_html, read_json, stable_id, write_json

COLLEGE_PATTERN = re.compile(r"2026年专业介绍[〗】]?\s*(.+?学院(?:（[^）]+）)?)")
NUMBERED_MAJOR_PATTERN = re.compile(
    r"^(?:(?:\d+|专业[一二三四五六七八九十]+)[、.．\s]|（[一二三四五六七八九十]+）)\s*(.+)$"
)
STOP_NAMES = {"学院简介", "学院介绍", "办学特色", "师资队伍", "教学设施", "成果与荣誉"}


def degree_for_lines(lines: list[str], line_index: int) -> str:
    for line in reversed(lines[max(0, line_index - 80) : line_index]):
        if "拟招生专科专业" in line:
            return "专科"
        if "拟招生本科专业" in line or "本科拟招生专业" in line:
            return "本科"
    return "本科"


def clean_major_name(value: str) -> str:
    value = NUMBERED_MAJOR_PATTERN.sub(lambda match: match.group(1) or "", clean_text(value))
    value = re.sub(r"^(?:专业[一二三四五六七八九十]+\s*)", "", value)
    value = re.sub(r"专业人才培养目标.*$", "", value)
    value = value.strip("：:，,。 ")
    return re.sub(r"专业$", "", value)


def looks_like_major_name(value: str) -> bool:
    if not 2 <= len(value) <= 45 or value in STOP_NAMES:
        return False
    blocked = [
        "目标", "课程", "前景", "方向", "特色", "队伍", "设施", "工作", "上一篇", "下一篇", "学院",
        "赋能", "育人", "人才", "建设", "机制", "合力", "新才",
    ]
    return not any(token in value for token in blocked)


def employment_from_section(section: str) -> str:
    match = re.search(
        r"(?:就业(?:前景|方向)|毕业生主要去向)[：:]?\s*(.+?)(?=\n(?:主要课程|培养目标|专业人才培养目标)|$)",
        section,
        re.S,
    )
    if match:
        return clean_text(match.group(1))
    match = re.search(r"(本专业毕业生可.+?)(?=\n|$)", section, re.S)
    return clean_text(match.group(1)) if match else ""


def offering_names(text: str) -> list[tuple[str, str]]:
    """Extract explicitly enumerated current-program lists without inventing codes."""
    results: list[tuple[str, str]] = []
    patterns = [
        (r"现有(.+?)12个本科专业，与(.+?)5个专科专业", ("本科", "专科")),
        (r"现开设有(.+?)六本科专业", ("本科",)),
        (r"设有(.+?)五个本科专业", ("本科",)),
        (r"开设(.+?)8个本科专业", ("本科",)),
    ]
    for pattern, levels in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        for index, level in enumerate(levels, start=1):
            raw = match.group(index)
            raw = raw.replace("以及", "、").replace("和", "、")
            for name in re.split(r"[、，,]", raw):
                name = clean_major_name(name)
                if looks_like_major_name(name):
                    results.append((name, level))
    return results


def parse_crawl(crawl_path: Path) -> dict[str, Any]:
    crawl = read_json(crawl_path)
    colleges: list[dict[str, Any]] = []
    majors: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    seen_colleges: set[str] = set()
    seen_majors: set[tuple[str, str, str]] = set()
    for source in crawl["sources"]:
        if source["id"] in {"gcc-major-index-2026", "gcc-school-profile-2026"}:
            continue
        raw_path = Path(__file__).resolve().parents[2] / source["raw_path"]
        parsed = parse_html(raw_path.read_bytes())
        text = parsed.text
        college_match = COLLEGE_PATTERN.search(parsed.title + "\n" + text[:400])
        if not college_match:
            warnings.append({"source_id": source["id"], "warning": "college name not parsed"})
            continue
        college_name = clean_text(college_match.group(1)).rstrip("-")
        college_id = stable_id("college", college_name)
        if college_id not in seen_colleges:
            colleges.append(
                {
                    "id": college_id,
                    "name": college_name,
                    "source_ids": [source["id"]],
                    "review_status": "reviewed",
                }
            )
            seen_colleges.add(college_id)
        lines = text.splitlines()
        discovered: list[tuple[int, str, str, bool]] = []
        # A short heading immediately before a training-goal paragraph is the most
        # reliable structure shared by these otherwise inconsistent official pages.
        for line_index, line in enumerate(lines):
            if line.startswith(("培养目标：", "培养目标:", "专业人才培养目标：", "专业人才培养目标:")):
                for previous in range(line_index - 1, max(-1, line_index - 5), -1):
                    name = clean_major_name(lines[previous])
                    if looks_like_major_name(name):
                        discovered.append((previous, name, degree_for_lines(lines, previous), True))
                        break
        # Digital-economy and modern-industry pages use numbered headings or lists
        # without a literal training-goal label.
        for line_index, line in enumerate(lines):
            match = NUMBERED_MAJOR_PATTERN.match(line)
            if not match:
                continue
            name = clean_major_name(match.group(1) or "")
            if not looks_like_major_name(name):
                continue
            preceding = "\n".join(lines[max(0, line_index - 20) : line_index])
            explicit_heading = bool(re.search(r"专业(?:（[^）]+）)?$", line)) and len(name) <= 28
            in_recruitment_list = "拟招生本科专业" in preceding or "拟招生专科专业" in preceding
            if explicit_heading or in_recruitment_list:
                discovered.append((line_index, name, degree_for_lines(lines, line_index), in_recruitment_list))
        # Some pages put a current-program list in prose; retain it with a visible
        # review gate if the page does not provide a machine-readable 2026 table.
        already_discovered = {clean_major_name(item[1]) for item in discovered}
        for name, level in offering_names(text):
            if sum(existing in name for existing in already_discovered if len(existing) >= 2) >= 2:
                continue
            discovered.append((len(lines), name, level, False))

        unique_discovered: dict[tuple[int, str, str], tuple[int, str, str, bool]] = {}
        for item in discovered:
            key = (item[0], clean_major_name(item[1]), item[2])
            previous = unique_discovered.get(key)
            unique_discovered[key] = (*item[:3], bool(item[3] or (previous and previous[3])))
        discovered = sorted(unique_discovered.values(), key=lambda item: item[0])
        for index, (line_index, raw_name, degree, explicitly_recruiting) in enumerate(discovered):
            name = clean_major_name(re.sub(r"（产教融合创新班）$", "", raw_name))
            next_line = discovered[index + 1][0] if index + 1 < len(discovered) else len(lines)
            section = "\n".join(lines[line_index:next_line]) if line_index < len(lines) else ""
            key = (college_id, name, degree)
            if key in seen_majors:
                continue
            employment_text = employment_from_section(section)
            excerpt = clean_text(section[:1200])
            majors.append(
                {
                    "id": stable_id("major", college_name, name, degree),
                    "college_id": college_id,
                    "name": name,
                    "degree_level": degree,
                    "is_currently_recruiting": explicitly_recruiting,
                    "admission_year": 2026,
                    "source_ids": [source["id"]],
                    "source_excerpt": excerpt,
                    "employment_text": employment_text,
                    "review_status": "reviewed" if employment_text and explicitly_recruiting else "review_required",
                }
            )
            seen_majors.add(key)
        if not any(major["college_id"] == college_id for major in majors):
            warnings.append({"source_id": source["id"], "warning": "no majors parsed"})
    return {
        "colleges": colleges,
        "majors": majors,
        "warnings": warnings,
        "failures": crawl.get("failures", []),
        "sources": crawl["sources"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse GCC major pages from saved raw snapshots")
    parser.add_argument("--input", type=Path, default=RAW_DIR / "gcc-crawl.json")
    parser.add_argument("--output", type=Path, default=RAW_DIR / "gcc-parsed.json")
    args = parser.parse_args()
    result = parse_crawl(args.input)
    write_json(args.output, result)
    print(
        f"colleges={len(result['colleges'])} majors={len(result['majors'])} "
        f"warnings={len(result['warnings'])} output={args.output}"
    )


if __name__ == "__main__":
    main()

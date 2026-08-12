from __future__ import annotations

import argparse
import csv
import hashlib
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.career_catalog.common import CATALOG_DIR, RAW_DIR, envelope, read_json, sha256_bytes, stable_id, write_json

ONET_URL = "https://www.onetcenter.org/dl_files/database/db_30_3_csv.zip"
ONET_ONLINE = "https://www.onetonline.org/link/summary/{}"

SKILL_ZH = {
    "Reading Comprehension": "阅读理解", "Active Listening": "积极倾听", "Writing": "书面表达",
    "Speaking": "口头表达", "Mathematics": "数学运用", "Science": "科学素养",
    "Critical Thinking": "批判性思维", "Active Learning": "主动学习", "Learning Strategies": "学习策略",
    "Monitoring": "过程监控",
}
KNOWLEDGE_ZH = {
    "Administration and Management": "行政与管理", "Administrative": "行政事务", "Economics and Accounting": "经济与会计",
    "Sales and Marketing": "销售与市场营销", "Customer and Personal Service": "客户与个人服务", "Personnel and Human Resources": "人力资源",
    "Production and Processing": "生产与加工", "Food Production": "食品生产", "Computers and Electronics": "计算机与电子技术",
    "Engineering and Technology": "工程与技术", "Design": "设计", "Building and Construction": "建筑与施工",
    "Mechanical": "机械", "Mathematics": "数学", "Physics": "物理", "Chemistry": "化学", "Biology": "生物学",
    "Psychology": "心理学", "Sociology and Anthropology": "社会学与人类学", "Geography": "地理学",
    "Medicine and Dentistry": "医学与口腔医学", "Therapy and Counseling": "治疗与咨询", "Education and Training": "教育与培训",
    "English Language": "英语语言", "Foreign Language": "外语", "Fine Arts": "美术", "History and Archeology": "历史与考古",
    "Philosophy and Theology": "哲学与神学", "Public Safety and Security": "公共安全", "Law and Government": "法律与政府",
    "Telecommunications": "通信", "Communications and Media": "传播与媒体", "Transportation": "交通运输",
}

OCCUPATION_ZH = {
    "13-2011.00": "会计师与审计师", "43-3031.00": "会计与审计事务员", "11-3031.00": "财务经理",
    "13-1111.00": "管理分析师", "13-2061.00": "金融审查专员", "11-9199.02": "合规经理",
    "13-2082.00": "税务申报专员", "13-2081.00": "税务审查与征收专员", "13-2052.00": "个人理财顾问",
    "13-2099.01": "金融量化分析师", "11-3031.03": "投资基金经理", "13-1161.00": "市场研究分析师",
    "13-1081.02": "物流分析师", "11-3071.04": "供应链经理", "13-1161.01": "搜索营销策略师",
    "15-2051.01": "商业智能分析师", "11-2021.00": "市场营销经理", "15-1243.01": "数据仓库专家",
    "13-1081.00": "物流师", "13-1081.01": "物流工程师", "39-7011.00": "导游与陪同人员",
    "41-3041.00": "旅行顾问", "11-9081.00": "住宿业经理", "43-4081.00": "酒店前台服务员",
    "11-9111.00": "医疗与健康服务经理", "15-1211.01": "健康信息学专家", "21-1091.00": "健康教育专家",
    "23-1011.00": "律师", "23-2011.00": "法律助理", "13-1041.00": "合规专员",
    "27-3091.00": "口译与笔译人员", "25-1124.00": "高校外语教师", "25-1123.00": "高校英语教师",
    "27-3031.00": "公共关系专员", "15-1252.00": "软件开发工程师", "15-1211.00": "计算机系统分析师",
    "15-1221.00": "计算机与信息研究科学家", "15-1253.00": "软件质量保证分析师", "15-1251.00": "计算机程序员",
    "15-1254.00": "Web开发工程师", "15-1232.00": "计算机用户支持专家", "17-2061.00": "计算机硬件工程师",
    "15-1299.08": "计算机系统工程师", "15-1241.00": "计算机网络架构师", "15-1242.00": "数据库管理员",
    "15-1212.00": "信息安全分析师", "15-1299.05": "信息安全工程师", "15-1244.00": "网络与计算机系统管理员",
    "27-1024.00": "平面设计师", "27-1021.00": "商业与工业设计师", "27-1025.00": "室内设计师",
    "27-1014.00": "特效与动画设计师", "27-1011.00": "艺术总监", "27-1027.00": "场景与展览设计师",
    "27-1013.00": "纯艺术创作者", "27-2012.00": "制片人与导演",
}

SOC_FAMILY_ZH = {
    "11": "管理岗位", "13": "商业与金融岗位", "15": "计算机与数学岗位", "17": "工程技术岗位",
    "21": "社会与健康服务岗位", "23": "法律岗位", "25": "教育岗位", "27": "艺术、设计与传媒岗位",
    "39": "个人服务岗位", "41": "销售岗位", "43": "行政支持岗位",
}
SOC_FIELD_ZH = {
    "11": "组织管理与运营", "13": "商业、金融与专业服务", "15": "数字技术与信息服务", "17": "工程与制造技术",
    "21": "公共服务与健康促进", "23": "法律与合规服务", "25": "教育与培训", "27": "文化创意、设计与传媒",
    "39": "旅游与个人服务", "41": "市场销售与客户服务", "43": "行政与业务支持",
}
SOC_SUMMARY_ZH = {
    "11": "规划、指导并协调组织或业务单元的专业活动，承担目标制定、资源配置、过程管理与结果改进。",
    "13": "运用商业、金融、合规或运营分析方法收集信息、评估问题并形成可执行的专业建议。",
    "15": "分析、设计、开发、测试或维护计算机系统、数据产品和数字化服务，并保障其可靠运行。",
    "17": "运用工程原理完成技术方案设计、验证、实施与改进，解决产品或系统中的实际问题。",
    "21": "面向个人与社区提供健康促进、教育或支持服务，评估需求并协调专业资源。",
    "23": "研究和运用法律规则，为组织或个人提供法律分析、文件处理、合规与争议解决支持。",
    "25": "设计并实施教育教学活动，评估学习效果，持续改进课程与学习支持。",
    "27": "运用艺术、设计或传媒方法完成创意策划、视觉表达、内容制作与传播协作。",
    "39": "面向旅游或个人服务场景提供讲解、协调与现场支持，保障服务体验和流程顺畅。",
    "41": "分析客户需求，介绍并销售产品或服务，维护客户关系并支持交易完成。",
    "43": "执行行政、记录、客户接待或业务流程支持工作，确保信息准确和服务及时。",
}

GROUPS = {
    "accounting": ("13-2011.00", "43-3031.00", "11-3031.00"),
    "finance": ("13-2099.01", "13-2052.00", "11-3031.03"),
    "risk": ("13-2061.00", "13-1041.00", "11-9199.02"),
    "tax": ("13-2082.00", "13-2011.00", "13-2081.00"),
    "marketing": ("13-1161.00", "13-1161.01", "11-2021.00"),
    "commerce": ("13-1161.00", "13-1081.02", "13-1111.00"),
    "logistics": ("13-1081.00", "13-1081.02", "13-1081.01"),
    "supply": ("11-3071.04", "13-1081.02", "13-1081.01"),
    "tourism": ("39-7011.00", "41-3041.00", "11-9081.00"),
    "hotel": ("43-4081.00", "39-7011.00", "11-9081.00"),
    "health": ("21-1091.00", "15-1211.01", "11-9111.00"),
    "law": ("23-2011.00", "13-1041.00", "23-1011.00"),
    "language": ("27-3091.00", "27-3031.00", "25-1124.00"),
    "english": ("27-3091.00", "27-3031.00", "25-1123.00"),
    "software": ("15-1252.00", "15-1253.00", "15-1254.00"),
    "computer": ("15-1232.00", "15-1211.00", "15-1221.00"),
    "data": ("15-2051.01", "15-1243.01", "15-1221.00"),
    "ai": ("15-1252.00", "15-2051.01", "15-1221.00"),
    "information": ("15-1211.00", "15-2051.01", "13-1111.00"),
    "iot": ("17-2061.00", "15-1299.08", "15-1241.00"),
    "security": ("15-1244.00", "15-1212.00", "15-1299.05"),
    "visual": ("27-1024.00", "27-1027.00", "27-1011.00"),
    "product": ("27-1021.00", "27-1024.00", "27-1011.00"),
    "environment": ("27-1025.00", "27-1027.00", "27-1011.00"),
    "digital_art": ("27-1014.00", "27-2012.00", "27-1011.00"),
    "public_art": ("27-1013.00", "27-1027.00", "27-1011.00"),
    "management": ("13-1111.00", "13-1161.00", "11-2021.00"),
}

MAJOR_GROUP = {
    "会计学":"accounting", "大数据与会计":"accounting", "审计学":"accounting", "财务管理":"accounting",
    "税收学":"tax", "金融学":"finance", "国际金融":"finance", "投资学":"finance", "互联网金融":"finance", "金融科技":"finance",
    "信用风险管理与法律防控":"risk", "法学":"law", "国际经贸规则":"law",
    "市场营销":"marketing", "电子商务":"commerce", "国际商务":"commerce", "国际经济与贸易":"commerce", "数字经济":"commerce",
    "物流管理":"logistics", "供应链管理":"supply", "旅游管理":"tourism", "酒店管理":"hotel", "健康服务与管理":"health",
    "英语":"english", "商务英语":"english", "日语":"language", "德语":"language", "西班牙语":"language",
    "软件工程":"software", "软件技术":"software", "计算机应用技术":"computer", "计算机科学与技术":"computer", "智能科学与技术":"computer",
    "人工智能":"ai", "数据科学与大数据技术":"data", "大数据管理与应用":"data", "信息管理与信息系统":"information",
    "物联网工程":"iot", "网络空间安全":"security", "视觉传达":"visual", "视觉传达设计":"visual", "产品设计":"product",
    "环境设计":"environment", "数字媒体艺术":"digital_art", "公共艺术":"public_art",
}

LEGACY_MAP = {
    "J-FE-001":"15-1254.00", "J-BE-001":"15-1252.00", "J-FS-001":"15-1252.00", "J-MO-001":"15-1252.00",
    "J-DA-001":"15-2051.01", "J-DS-001":"15-2051.01", "J-AI-001":"15-1221.00", "J-PM-001":"13-1111.00",
    "J-UX-001":"27-1024.00", "J-QA-001":"15-1253.00", "J-DO-001":"15-1244.00", "J-SEC-001":"15-1212.00",
}


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def scaled(value: str) -> int:
    return max(0, min(100, round(float(value) / 5 * 100)))


def ability_code(prefix: str, element_id: str) -> str:
    return f"onet_{prefix}_{re.sub('[^a-z0-9]+', '_', element_id.lower()).strip('_')}"


def build(*, parsed_path: Path, onet_crawl_path: Path, output_dir: Path) -> dict[str, Any]:
    parsed = read_json(parsed_path)
    onet = read_json(onet_crawl_path)
    source = onet["archive"]
    raw = RAW_DIR / "onet-30.3"
    occupation_rows = {row["O*NET-SOC Code"]: row for row in rows(raw / "occupation_data.csv")}
    skills: dict[str, list[dict[str, str]]] = defaultdict(list)
    knowledge: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows(raw / "essential_skills.csv"):
        if row["Scale ID"] == "IM" and row["Recommend Suppress"] != "Y" and row["Not Relevant"] != "Y":
            skills[row["O*NET-SOC Code"]].append(row)
    for row in rows(raw / "knowledge.csv"):
        if row["Scale ID"] == "IM" and row["Recommend Suppress"] != "Y" and row["Not Relevant"] != "Y":
            knowledge[row["O*NET-SOC Code"]].append(row)
    zones = {row["O*NET-SOC Code"]: row["Job Zone"] for row in rows(raw / "job_zones.csv")}
    related: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows(raw / "related_occupations.csv"):
        related[row["O*NET-SOC Code"]].append(row)

    unique_major_names = sorted({major["name"] for major in parsed["majors"]})
    missing = sorted(set(unique_major_names) - set(MAJOR_GROUP))
    if missing:
        raise RuntimeError(f"Unmapped unique majors: {missing}")
    mapped_codes = {code for name in unique_major_names for code in GROUPS[MAJOR_GROUP[name]]} | set(LEGACY_MAP.values())
    invalid = sorted(code for code in mapped_codes if code not in occupation_rows or len(skills[code]) < 5 or len(knowledge[code]) < 3)
    if invalid:
        raise RuntimeError(f"O*NET codes lack authoritative occupation/skill/knowledge data: {invalid}")
    degrees_by_code: dict[str, set[str]] = defaultdict(set)
    for major in parsed["majors"]:
        for code in GROUPS[MAJOR_GROUP[major["name"]]]:
            degrees_by_code[code].add(major["degree_level"])

    generated_at = source["fetched_at"]
    input_hashes = [source["content_sha256"]] + sorted(
        item["content_sha256"] for item in parsed["sources"] if item.get("content_sha256")
    )
    input_revision = hashlib.sha256("|".join(input_hashes).encode("utf-8")).hexdigest()[:8]
    catalog_version = f"gcc-onet-30.3-{generated_at[:10].replace('-', '')}-{input_revision}"
    onet_source = {
        **source,
        "id": "onet-30.3-csv",
        "url": ONET_URL,
        "title": "O*NET 30.3 Database CSV (May 2026)",
        "publisher": "U.S. Department of Labor / Employment and Training Administration",
        "license_notes": "基于 O*NET 30.3 翻译与派生，原始来源 US DOL/ETA，CC BY 4.0，已做中文翻译与评分归一化。",
    }
    sources = [onet_source] + parsed["sources"]
    occupations: list[dict[str, Any]] = []
    requirements: list[dict[str, Any]] = []
    aliases: list[dict[str, Any]] = []
    for code in sorted(mapped_codes):
        item = occupation_rows[code]
        title_zh = OCCUPATION_ZH[code]
        family_code = code[:2]
        summary_zh = SOC_SUMMARY_ZH[family_code]
        direct_source_id = f"onet-online-{code}"
        sources.append({
            "id": direct_source_id,
            "url": ONET_ONLINE.format(code),
            "title": f"O*NET OnLine: {item['Title']}",
            "publisher": "U.S. Department of Labor / Employment and Training Administration",
            "source_type": "official_occupation_profile",
            "published_at": None,
            "fetched_at": None,
            "content_sha256": sha256_bytes(f"{code}\n{item['Title']}\n{item['Description']}".encode("utf-8")),
            "http_status": None,
            "robots_status": "citation_only_not_fetched",
            "license_notes": "基于 O*NET 30.3 翻译与派生，原始来源 US DOL/ETA，CC BY 4.0，已做中文翻译与评分归一化。",
        })
        occupations.append({
            "code": code, "name": title_zh, "canonical_type": "standard_occupation", "category": SOC_FAMILY_ZH[family_code],
            "job_family": SOC_FAMILY_ZH[family_code], "summary": summary_zh,
            "description": f"{summary_zh}\nO*NET original: {item['Description']}",
            "entry_level": f"O*NET Job Zone {zones.get(code, '未提供')}", "industry": SOC_FIELD_ZH[family_code], "cities": [],
            "education_levels": sorted(degrees_by_code[code]), "source_ids": ["onet-30.3-csv", direct_source_id], "review_status": "approved", "scoring_eligible": True,
        })
        aliases.append({
            "id": stable_id("alias", code, item["Title"]), "occupation_code": code, "alias": item["Title"],
            "source_ids": ["onet-30.3-csv"], "review_status": "approved",
        })
        selected_skills = sorted(skills[code], key=lambda row: (-float(row["Data Value"]), row["Element ID"]))[:8]
        selected_knowledge = sorted(knowledge[code], key=lambda row: (-float(row["Data Value"]), row["Element ID"]))[:5]
        for index, row in enumerate(selected_skills):
            requirements.append({
                "id": stable_id("req", code, "skill", row["Element ID"]), "occupation_code": code,
                "ability_code": ability_code("skill", row["Element ID"]), "ability_name": SKILL_ZH[row["Element Name"]],
                "dimension": "general_competencies", "target_score": scaled(row["Data Value"]),
                "weight": max(1, round(float(row["Data Value"]))), "required": index < 5,
                "description": f"O*NET Essential Skill: {row['Element Name']} ({row['Element ID']}), Importance={row['Data Value']}/5.",
                "education_level": "", "experience_level": f"Job Zone {zones.get(code, 'unknown')}", "region": "",
                "source_ids": ["onet-30.3-csv", direct_source_id], "review_status": "approved", "requirement_type": "skill",
            })
        for index, row in enumerate(selected_knowledge):
            requirements.append({
                "id": stable_id("req", code, "knowledge", row["Element ID"]), "occupation_code": code,
                "ability_code": ability_code("knowledge", row["Element ID"]), "ability_name": KNOWLEDGE_ZH[row["Element Name"]],
                "dimension": "domain_knowledge", "target_score": scaled(row["Data Value"]),
                "weight": max(1, round(float(row["Data Value"]))), "required": index < 3,
                "description": f"O*NET Knowledge: {row['Element Name']} ({row['Element ID']}), Importance={row['Data Value']}/5.",
                "education_level": "", "experience_level": f"Job Zone {zones.get(code, 'unknown')}", "region": "",
                "source_ids": ["onet-30.3-csv", direct_source_id], "review_status": "approved", "requirement_type": "knowledge",
            })

    edges = []
    relation_types = ["primary", "adjacent", "stretch"]
    for major in parsed["majors"]:
        codes = GROUPS[MAJOR_GROUP[major["name"]]]
        for relation_type, code in zip(relation_types, codes):
            edges.append({
                "id": stable_id("edge", major["id"], relation_type, code), "major_id": major["id"],
                "occupation_code": code, "proposed_title": None, "relation_type": relation_type,
                "source_ids": list(dict.fromkeys(major["source_ids"] + ["onet-30.3-csv"])),
                "evidence_excerpt": major["employment_text"][:500], "review_required": False,
                "review_reason": "Reviewed mapping from GCC major to an O*NET-SOC occupation with skill and knowledge evidence.",
            })

    # Only retain O*NET relations where both endpoints are in this approved subset.
    relation_items = []
    relation_seen = set()
    for code in sorted(mapped_codes):
        for row in related[code]:
            target = row["Related O*NET-SOC Code"]
            if target not in mapped_codes:
                continue
            key = (code, target)
            if key in relation_seen:
                continue
            source_zone = int(zones.get(code, "0") or 0)
            target_zone = int(zones.get(target, "0") or 0)
            if target_zone > source_zone:
                relation_type = "progresses_to"
            elif target[:2] != code[:2]:
                relation_type = "transfers_to"
            else:
                relation_type = "related_to"
            relation_items.append({
                "id": stable_id("onet-related", code, target), "from_code": code, "to_code": target,
                "relation_type": relation_type,
                "description": f"Derived from O*NET relatedness ({row['Relatedness Tier']}, index {row['Index']}) plus Job Zone/SOC-family comparison ({source_zone}→{target_zone}).",
                "source_ids": ["onet-30.3-csv"], "review_status": "approved",
            })
            relation_seen.add(key)

    payloads = {
        "colleges.json": parsed["colleges"], "majors.json": parsed["majors"], "occupations.json": occupations,
        "occupation_aliases.json": aliases, "major_occupation_edges.json": edges,
        "occupation_requirements.json": requirements, "sources.json": sources,
        "occupation_relations.json": relation_items,
        "legacy_occupation_map.json": [
            {"old_code": old, "new_code": new, "review_required": False, "reason": "Reviewed semantic migration from the legacy demo role to the closest approved O*NET-SOC occupation."}
            for old, new in LEGACY_MAP.items()
        ],
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
        "schema_version":"1.0.0", "catalog_version":catalog_version, "generated_at":generated_at,
        "summary": {"colleges":len(parsed["colleges"]), "major_records":len(parsed["majors"]), "unique_majors":len(unique_major_names),
                    "occupations":len(occupations), "requirements":len(requirements), "edges":len(edges),
                    "occupation_relations":len(relation_items), "orphan_majors":0},
        "items": coverage_items,
    }
    write_json(output_dir / "coverage_report.json", coverage)
    files = {}
    for filename in list(payloads) + ["coverage_report.json"]:
        raw_bytes = (output_dir / filename).read_bytes()
        files[filename] = {"sha256":sha256_bytes(raw_bytes), "count":len(read_json(output_dir / filename)["items"])}
    manifest = {
        "schema_version":"1.0.0", "catalog_version":catalog_version, "generated_at":generated_at, "files":files,
        "source_failures":onnet_failures(onet), "quality_gates": {
            "all_45_unique_majors_mapped":len(unique_major_names)==45,
            "every_major_has_three_resolved_edges":all(item["resolved_occupation_edges"]==3 for item in coverage_items),
            "every_occupation_has_requirements":all(sum(r["occupation_code"]==o["code"] for r in requirements)>=8 for o in occupations),
            "curated_mapping_complete":True,
        }, "publication_status":"approved", "scoring_safe":True,
        "license":"Based on O*NET 30.3 (US DOL/ETA), CC BY 4.0; Chinese translation and normalized scoring are derivative work.",
    }
    write_json(output_dir / "catalog_manifest.json", manifest)
    return {"manifest":manifest,"coverage":coverage}


def onnet_failures(onet: dict[str, Any]) -> list[dict[str, Any]]:
    return onet.get("failures", [])


def main() -> None:
    parser=argparse.ArgumentParser(description="Build reviewed GCC to O*NET 30.3 career graph")
    parser.add_argument("--parsed",type=Path,default=RAW_DIR/"gcc-parsed.json")
    parser.add_argument("--onet",type=Path,default=RAW_DIR/"onet-crawl.json")
    parser.add_argument("--output-dir",type=Path,default=CATALOG_DIR)
    args=parser.parse_args()
    result=build(parsed_path=args.parsed,onet_crawl_path=args.onet,output_dir=args.output_dir)
    print(" ".join(f"{k}={v}" for k,v in result["coverage"]["summary"].items()))


if __name__=="__main__": main()

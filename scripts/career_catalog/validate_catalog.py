from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from scripts.career_catalog.common import CATALOG_DIR, read_json, sha256_bytes

REQUIRED_FILES = {
    "colleges.json",
    "majors.json",
    "occupations.json",
    "occupation_aliases.json",
    "major_occupation_edges.json",
    "occupation_requirements.json",
    "occupation_relations.json",
    "sources.json",
    "legacy_occupation_map.json",
    "coverage_report.json",
}
RELATIONS = {"primary", "adjacent", "cross_major", "stretch"}


def validate(catalog_dir: Path) -> list[str]:
    errors: list[str] = []
    manifest = read_json(catalog_dir / "catalog_manifest.json")
    if manifest.get("scoring_safe") is not True:
        errors.append("approved O*NET catalog must declare scoring_safe=true")
    if manifest.get("publication_status") != "approved":
        errors.append("approved O*NET catalog must declare publication_status=approved")
    missing = REQUIRED_FILES - set(manifest.get("files", {}))
    if missing:
        errors.append(f"manifest missing files: {sorted(missing)}")
    for filename, expected in manifest.get("files", {}).items():
        path = catalog_dir / filename
        if not path.exists():
            errors.append(f"missing file: {filename}")
            continue
        if sha256_bytes(path.read_bytes()) != expected.get("sha256"):
            errors.append(f"hash mismatch: {filename}")
        document = read_json(path)
        if len(document.get("items", [])) != expected.get("count"):
            errors.append(f"count mismatch: {filename}")
        if document.get("catalog_version") != manifest.get("catalog_version"):
            errors.append(f"catalog_version mismatch: {filename}")

    colleges = read_json(catalog_dir / "colleges.json")["items"]
    majors = read_json(catalog_dir / "majors.json")["items"]
    occupations = read_json(catalog_dir / "occupations.json")["items"]
    aliases = read_json(catalog_dir / "occupation_aliases.json")["items"]
    edges = read_json(catalog_dir / "major_occupation_edges.json")["items"]
    requirements = read_json(catalog_dir / "occupation_requirements.json")["items"]
    occupation_relations = read_json(catalog_dir / "occupation_relations.json")["items"]
    legacy_maps = read_json(catalog_dir / "legacy_occupation_map.json")["items"]
    sources = read_json(catalog_dir / "sources.json")["items"]
    college_ids = unique_ids(colleges, "college", errors)
    major_ids = unique_ids(majors, "major", errors)
    occupation_codes = unique_ids(occupations, "occupation", errors, field="code")
    source_ids = unique_ids(sources, "source", errors)

    if not colleges:
        errors.append("catalog has no colleges")
    if not majors:
        errors.append("catalog has no majors")
    if not occupations:
        errors.append("catalog has no occupations")
    gates = manifest.get("quality_gates", {})
    for gate in ["all_45_unique_majors_mapped", "every_major_has_three_resolved_edges", "every_occupation_has_requirements", "curated_mapping_complete"]:
        if gates.get(gate) is not True:
            errors.append(f"{gate} quality gate failed")

    for major in majors:
        if major.get("college_id") not in college_ids:
            errors.append(f"major {major.get('id')} references unknown college")
        check_sources(major, source_ids, errors)
    per_major: dict[str, set[str]] = {major_id: set() for major_id in major_ids}
    for edge in edges:
        major_id = edge.get("major_id")
        if major_id not in major_ids:
            errors.append(f"edge {edge.get('id')} references unknown major")
            continue
        relation = edge.get("relation_type")
        if relation not in RELATIONS:
            errors.append(f"edge {edge.get('id')} has invalid relation_type")
        else:
            per_major[major_id].add(relation)
        code = edge.get("occupation_code")
        if code is None:
            if edge.get("review_required") is not True or not edge.get("proposed_title"):
                errors.append(f"unresolved edge {edge.get('id')} must be explicit and review_required")
        elif code not in occupation_codes:
            errors.append(f"edge {edge.get('id')} references unknown occupation")
        check_sources(edge, source_ids, errors)
    for major_id, relations in per_major.items():
        required = {"primary", "adjacent", "stretch"}
        if not required <= relations:
            errors.append(f"major {major_id} lacks relation records: {sorted(required - relations)}")
    for alias in aliases:
        if alias.get("occupation_code") not in occupation_codes:
            errors.append(f"alias {alias.get('id')} references unknown occupation")
        check_sources(alias, source_ids, errors)
    requirement_counts: dict[str, dict[str, int]] = {
        code: {"skill": 0, "knowledge": 0, "total": 0} for code in occupation_codes
    }
    for requirement in requirements:
        if requirement.get("occupation_code") not in occupation_codes:
            errors.append(f"requirement {requirement.get('id')} references unknown occupation")
            continue
        kind = requirement.get("requirement_type")
        if kind not in {"skill", "knowledge"}:
            errors.append(f"requirement {requirement.get('id')} has invalid requirement_type")
        else:
            requirement_counts[requirement["occupation_code"]][kind] += 1
        requirement_counts[requirement["occupation_code"]]["total"] += 1
        check_sources(requirement, source_ids, errors)
        if requirement.get("review_status") != "approved":
            errors.append(f"requirement {requirement.get('id')} is not approved")
        if not isinstance(requirement.get("target_score"), int) or not isinstance(requirement.get("weight"), int):
            errors.append(f"requirement {requirement.get('id')} is not scoreable")
    for code, counts in requirement_counts.items():
        if counts["skill"] < 5 or counts["knowledge"] < 3 or counts["total"] < 8:
            errors.append(f"occupation {code} requirements below minimum: {counts}")
    for occupation in occupations:
        check_sources(occupation, source_ids, errors)
        if occupation.get("canonical_type") != "standard_occupation":
            errors.append(f"occupation {occupation.get('code')} is not canonical")
        if occupation.get("review_status") != "approved" or occupation.get("scoring_eligible") is not True:
            errors.append(f"occupation {occupation.get('code')} is not approved and scoring eligible")
        direct_sources = [source for source in sources if source.get("id") in occupation.get("source_ids", []) and "onetonline.org/link/summary/" in source.get("url", "")]
        if not direct_sources:
            errors.append(f"occupation {occupation.get('code')} lacks direct O*NET citation")
    for relation in occupation_relations:
        if relation.get("from_code") not in occupation_codes or relation.get("to_code") not in occupation_codes:
            errors.append(f"occupation relation {relation.get('id')} references unknown occupation")
        check_sources(relation, source_ids, errors)
    relation_type_counts = {
        relation_type: sum(relation.get("relation_type") == relation_type for relation in occupation_relations)
        for relation_type in {"progresses_to", "transfers_to", "related_to"}
    }
    for relation_type, count in relation_type_counts.items():
        if count == 0:
            errors.append(f"occupation graph has no {relation_type} relations")
    for mapping in legacy_maps:
        if mapping.get("new_code") not in occupation_codes or mapping.get("review_required") is not False:
            errors.append(f"legacy mapping {mapping.get('old_code')} is not resolved to an approved occupation")
    for source in sources:
        if not isinstance(source.get("url"), str) or not source["url"].startswith("https://"):
            errors.append(f"source {source.get('id')} URL is not traceable HTTPS")
    for major_id in major_ids:
        resolved = [edge for edge in edges if edge.get("major_id") == major_id and edge.get("occupation_code") in occupation_codes]
        if len(resolved) != 3 or any(edge.get("review_required") for edge in resolved):
            errors.append(f"major {major_id} must have exactly three resolved approved edges")
    return errors


def unique_ids(items: list[dict[str, Any]], label: str, errors: list[str], *, field: str = "id") -> set[str]:
    values: set[str] = set()
    for item in items:
        value = item.get(field)
        if not isinstance(value, str) or not value:
            errors.append(f"{label} missing {field}")
        elif value in values:
            errors.append(f"duplicate {label} {field}: {value}")
        else:
            values.add(value)
    return values


def check_sources(item: dict[str, Any], source_ids: set[str], errors: list[str]) -> None:
    ids = item.get("source_ids")
    if not isinstance(ids, list) or not ids:
        errors.append(f"{item.get('id', item.get('code'))} has no source_ids")
    elif unknown := set(ids) - source_ids:
        errors.append(f"{item.get('id', item.get('code'))} has unknown sources: {sorted(unknown)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate normalized career catalog")
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR)
    args = parser.parse_args()
    errors = validate(args.catalog_dir)
    if errors:
        print("validation failed:")
        for error in errors:
            print(f"- {error}")
        sys.exit(1)
    coverage = read_json(args.catalog_dir / "coverage_report.json")["summary"]
    print(
        f"validation=ok major_records={coverage['major_records']} unique_majors={coverage['unique_majors']} "
        f"occupations={coverage['occupations']} requirements={coverage['requirements']} edges={coverage['edges']}"
    )


if __name__ == "__main__":
    main()

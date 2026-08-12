# Career catalog data contract

This document defines the auditable hand-off between the Python source pipeline and the application importer. The crawler does not publish directly to the product database.

## Trust boundary

- Guangzhou College of Commerce (`zsb.gcc.edu.cn`, `gcc.edu.cn`) is authoritative for current colleges, majors, curriculum summaries, and stated employment directions.
- The Ministry of Education is authoritative for standard major names and codes.
- The Ministry of Human Resources and Social Security is authoritative for Chinese occupation classifications and codes.
- Commercial recruitment websites are not crawled without a licensed API or explicit permission.
- A deterministic parser output is still only a candidate. Extracted titles are marked `review_required` until a reviewer maps them to a national occupation.
- A `candidate` catalog may be activated for browse and discovery, but every unresolved record must remain `canonical_type=unresolved_placeholder`, `review_status=review_required`, and `scoring_eligible=false`. It must not be presented as a national occupation or used in matching scores.

## Commands

Run a real, rate-limited fetch and rebuild:

```bash
python3 -m scripts.career_catalog.run_pipeline --delay 1.25
```

Run offline tests and validation:

```bash
python3 -m unittest discover -s scripts/career_catalog/tests -v
python3 -m compileall -q scripts/career_catalog
python3 -m scripts.career_catalog.validate_catalog
python3 -m scripts.career_catalog.load_catalog
```

`load_catalog` is a crawler-side dry-run and never mutates the product database. The Part 3 application importer owns transactional stage/apply/rollback. It may activate a `candidate` catalog for browse and discovery, while enforcing that placeholders stay unapproved and non-scoreable. Only an `approved` catalog with `scoring_safe=true` may contribute structured requirements to matching scores.

## Storage

Raw HTML, caches, and temporary files are written below `careerpilot-data/raw`, `careerpilot-data/cache`, and `careerpilot-data/tmp`; these directories are ignored by Git. Compact reviewed outputs under `careerpilot-data/catalog` are versioned.

All normalized data files use this envelope:

```json
{
  "schema_version": "1.0.0",
  "catalog_version": "gcc-2026-YYYYMMDD-pN-SOURCEHASH",
  "generated_at": "ISO-8601 UTC",
  "items": []
}
```

## Files and fields

### `colleges.json`

`id`, `name`, `source_ids[]`, `review_status`.

### `majors.json`

`id`, `college_id`, `name`, `degree_level`, `is_currently_recruiting`, `admission_year`, `source_ids[]`, `source_excerpt`, `employment_text`, `review_status`.

### `occupations.json`

Reviewed canonical occupations and explicitly unresolved browse candidates belong here: `code`, `name`, `canonical_type` (`national_occupation`, reviewed market occupation, or `unresolved_placeholder`), `category`, `summary`, `description`, `entry_level`, `industry`, `cities[]`, `education_levels[]`, `source_ids[]`, `review_status`, `scoring_eligible`. A placeholder must remain `review_required` and `scoring_eligible=false` until authoritative mapping and review are complete.

### `occupation_aliases.json`

`id`, `occupation_code`, `alias`, `source_ids[]`, `review_status`. An unreviewed extracted title must not be inserted here because it has no canonical target.

### `major_occupation_edges.json`

`id`, `major_id`, `occupation_code` (nullable), `proposed_title` (nullable), `relation_type` (`primary`, `adjacent`, `cross_major`, `stretch`), `source_ids[]`, `evidence_excerpt`, `review_required`, `review_reason`.

An unresolved record uses a null `occupation_code` plus a visible `proposed_title`, reason, and `review_required=true`. It proves a coverage gap; it does not assert a real mapping.

### `occupation_requirements.json`

`id`, `occupation_code`, `ability_code`, `ability_name`, `dimension`, `target_score` (nullable), `weight` (nullable), `required`, `description`, `education_level`, `experience_level`, `region`, `source_ids[]`, `review_status`. No requirements are emitted until authoritative evidence exists.

### `sources.json`

`id`, `url`, `title`, `publisher`, `source_type`, `published_at`, `fetched_at`, `content_sha256`, `http_status`, `robots_status`, `license_notes`. `raw_path` is an audit pointer and is not a deploy-time dependency.

### `legacy_occupation_map.json`

`old_code`, `new_code` (nullable), `review_required`, `reason`. Null mappings instruct the importer to preserve legacy `J-*` rows and their user references.

### `coverage_report.json`

Contains total colleges, majors, canonical occupations, unresolved occupation candidates, extracted candidate titles, edge records, review-required edges, and orphan majors. Each major reports counts for relation types and resolved edges.

### `catalog_manifest.json`

Contains per-file SHA-256 and record counts, source failures, quality gates, `publication_status`, and `scoring_safe`. The importer must verify every hash before opening a transaction. Candidate data may be activated for browsing, but review-required placeholders must stay visibly non-canonical and must never enter scoring.

## Review and release

1. Run the crawler and retain raw snapshots locally.
2. Reconcile source failures and page-count inconsistencies.
3. Review major records and map extracted titles to authoritative occupation codes.
4. Add evidence-backed requirements and aliases.
5. Re-run validation.
6. A human reviewer changes the release manifest to `approved` and `scoring_safe=true` only when every scoring input is authoritative and supported. Until then, the candidate catalog is browse-only.
7. Use the Part 3 importer to preview, apply transactionally, and roll back by catalog version.

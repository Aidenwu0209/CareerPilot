# Career catalog data contract

This document defines the auditable hand-off between the Python source pipeline and the application importer. The crawler never writes directly to the product database.

## Chinese authority hierarchy

1. Guangzhou College of Commerce (`zsb.gcc.edu.cn`, `gcc.edu.cn`) is authoritative for its colleges, 2026 major pages, curriculum and stated employment directions.
2. The Ministry of Education is authoritative for current Chinese major names and codes.
3. The Ministry of Human Resources and Social Security's *Occupation Classification of the People's Republic of China (2022)* is authoritative for published occupation names, codes, definitions and major work tasks.
4. Current national occupation standards in the MHRSS national standard registry take priority when they contain at least four parseable entry-level skill requirements.
5. If no usable national occupation standard exists, CareerPilot builds a clearly labelled simple assessment from the Dadian's official work tasks. An occupation with fewer than four traceable assessment statements is not published for scoring.

O*NET is not a catalog, code, requirement, weight or score source in the active Chinese-standard release. Legacy O*NET-SOC and `J-*` values exist only in `legacy_occupation_map.json` so existing student goals can migrate without data loss.

## Reproducible commands

Run the real, rate-limited source pipeline:

```bash
python3 -m scripts.career_catalog.run_pipeline --delay 1.25
```

Refresh only the Chinese official occupation sources:

```bash
python3 -m scripts.career_catalog.crawl_china_standards --force --delay 1.25
python3 -m scripts.career_catalog.build_china_major_graph
```

Run offline checks and import previews:

```bash
python3 -m unittest discover -s scripts/career_catalog/tests -v
python3 -m compileall -q scripts/career_catalog
python3 -m scripts.career_catalog.validate_catalog
python3 -m scripts.career_catalog.load_catalog
catalog_tmp_dir="$(mktemp -d)"
SQLITE_PATH="$catalog_tmp_dir/catalog.db" pnpm career:catalog dry-run careerpilot-data/catalog
```

`load_catalog` is a Python-side dry-run. The application importer owns transactionally verified `dry-run`, `stage`, `apply` and `rollback` operations.

## Fetch controls and transport disclosure

- HTTPS host allowlisting, `robots.txt`, explicit User-Agent, timeout, retry, delay and byte SHA-256 are mandatory.
- `careerpilot-data/raw`, `cache` and `tmp` are ignored. Only normalized JSON under `careerpilot-data/catalog` is versioned.
- The MHRSS national standard portal currently has a hostname/certificate failure on its HTTPS download host. The crawler does not disable certificate validation. It records the failure, then uses the same official portal's HTTP download endpoint and stores the exact PDF hash. Catalog citations retain the canonical official HTTPS URL.
- A standard PDF is parsed only when it is a valid `%PDF` response. Individual failures remain visible in the manifest and cannot silently fall back to invented requirements.

All normalized files use:

```json
{
  "schema_version": "1.0.0",
  "catalog_version": "gcc-cn-2022-YYYYMMDD-INPUTHASH",
  "generated_at": "ISO-8601 UTC",
  "items": []
}
```

`INPUTHASH` is derived from the audited Dadian PDF, downloaded national-standard PDFs, GCC source bytes and the explicit pipeline/scoring-model version. Identical source inputs and pipeline rules reproduce the same immutable version; a parser or mapping-rule change always creates a new catalog version.

## Published entities and gates

- `colleges.json` and `majors.json` retain 10 colleges, 64 delivery records and 45 unique major names.
- `occupations.json` uses Chinese 2022 classification codes and `canonical_type=china_national_occupation` only.
- `major_occupation_edges.json` gives every major record five reviewed directions: one `primary`, two `adjacent` and two `stretch` occupations.
- `occupation_requirements.json` contains at least four traceable requirements per occupation. National-standard entry-level skills are preferred; otherwise official Dadian work tasks are used.
- Every product requirement uses a normalized 0–100 evidence scale, `target_score=60` and equal weight. This is a CareerPilot evidence threshold, not an official exam pass score, vocational qualification, skill-level decision or hiring outcome.
- `occupation_relations.json` contains reviewed product exploration paths derived from the GCC major mapping. These relations do not assert official promotion eligibility.
- `sources.json` preserves publisher, URL, publication/fetch time, HTTP/robots status and byte hash.
- `legacy_occupation_map.json` maps all previous `J-*` and active O*NET-SOC goal codes to the closest reviewed Chinese occupation.
- `coverage_report.json` and `catalog_manifest.json` record exact counts, hashes, failures, transport notes and quality gates.

The importer verifies every manifest hash before opening a transaction. Read APIs never seed or mutate the catalog.

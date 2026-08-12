# Career catalog data contract

This document defines the auditable hand-off between the Python source pipeline and the application importer. The crawler never writes directly to the product database.

## Authority and scope

- Guangzhou College of Commerce (`zsb.gcc.edu.cn`, `gcc.edu.cn`) is authoritative for its colleges, 2026 major pages, stated curricula and employment directions.
- The Ministry of Education is authoritative for Chinese major names and codes. The Ministry of Human Resources and Social Security is authoritative for Chinese occupation classifications.
- O*NET 30.3 is used as a structured standard-occupation and competency source. O*NET-SOC codes are **not** Chinese MHRSS occupation codes and the UI must label them accordingly.
- The downloaded O*NET database is a derivative-data source under CC BY 4.0. Product records retain US DOL/ETA attribution, direct O*NET OnLine citations, English source titles, Chinese translations and the normalization formula.
- Commercial recruitment sites are not crawled without a licensed API or explicit permission.

## Reproducible commands

Run the real, rate-limited source pipeline:

```bash
python3 -m scripts.career_catalog.run_pipeline --delay 1.25
```

Force a fresh official O*NET archive download when intentionally refreshing the source version:

```bash
python3 -m scripts.career_catalog.crawl_onet_catalog --force --delay 1.25
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

## Fetch controls and storage

- HTTPS host allowlist, `robots.txt`, explicit User-Agent, timeout, retry and request delay are mandatory.
- `careerpilot-data/raw`, `cache` and `tmp` are ignored by Git. Compact normalized JSON under `careerpilot-data/catalog` is versioned.
- The O*NET ZIP is downloaded once to a controlled cache path. A cache hit must match the previously audited SHA-256 and retains the original HTTP, robots and fetch metadata; it does not invent a new fetch time.
- The builder uses only `occupation_data.csv`, `essential_skills.csv`, `knowledge.csv`, `job_zones.csv` and `related_occupations.csv` extracted from the official O*NET 30.3 CSV archive.

All normalized entity files use:

```json
{
  "schema_version": "1.0.0",
  "catalog_version": "gcc-onet-30.3-YYYYMMDD-INPUTHASH",
  "generated_at": "ISO-8601 UTC",
  "items": []
}
```

`INPUTHASH` is the first eight hexadecimal characters of a SHA-256 over the audited O*NET archive hash plus sorted GCC source hashes. Identical inputs reproduce the same immutable version; any source-byte change creates a new version.

## Files

### `colleges.json` and `majors.json`

Colleges contain `id`, `name`, `source_ids[]`, and `review_status`. Majors contain `id`, `college_id`, `name`, `degree_level`, recruitment status, source excerpt, employment text and citations. The 64 delivery records resolve to 45 unique major names; cross-college and international/industry-class duplicates are intentionally retained.

### `occupations.json`

Each record has an actual O*NET-SOC `code`, reviewed Chinese `name`, `canonical_type=standard_occupation`, Chinese `job_family`, Chinese `summary`, bilingual `description`, `industry`, aggregated GCC `education_levels[]`, `source_ids[]`, `review_status=approved`, and `scoring_eligible=true`.

These are O*NET standard occupations, not Chinese nationally classified occupations. City data remains empty because O*NET does not provide Guangzhou demand evidence.

### `occupation_aliases.json`

Contains the exact official English O*NET occupation title as an approved alias of the matching code. Unmapped GCC title candidates are not published.

### `major_occupation_edges.json`

Every GCC major delivery record has exactly one resolved `primary`, `adjacent`, and `stretch` edge. Each edge references a real occupation code, the GCC source and O*NET source, and has `review_required=false`.

### `occupation_requirements.json`

Requirements are derived from O*NET Essential Skills and Knowledge Importance ratings. An occupation is publishable only when it has at least five skill and three knowledge requirements.

- `target_score = round(Data Value / 5 * 100)`, bounded to 0–100.
- `weight = max(1, round(Data Value))`.
- The top five skills and top three knowledge elements are `required=true`; remaining selected elements are preferred.
- `ability_name` is reviewed Chinese. `description` retains the O*NET English element name, element ID and original importance value.

### `occupation_relations.json`

Contains only O*NET related-occupation pairs whose endpoints are both published. Relation type is derived transparently:

- higher Job Zone → `progresses_to`;
- different SOC family at the same or lower zone → `transfers_to`;
- same SOC family at the same or lower zone → `related_to`.

The description preserves the O*NET relatedness tier/index and the compared Job Zones.

### `sources.json`

Contains the fetched official archive and GCC pages plus direct O*NET OnLine citation URLs. Direct profile links marked `citation_only_not_fetched` do not claim an HTTP response or fetch timestamp. Every derived O*NET record cites the archive and its direct occupation profile.

### `legacy_occupation_map.json`

Contains reviewed mappings from the 12 former `J-*` demo codes to approved O*NET-SOC records so existing goals can continue. Historical match snapshots remain immutable.

### `coverage_report.json` and `catalog_manifest.json`

Coverage proves all 45 unique majors and all 64 delivery records are mapped, with three resolved edges per record. The manifest records exact byte SHA-256 and count for every file, source failures and quality gates. This release is `publication_status=approved` and `scoring_safe=true` only because every published occupation has O*NET occupation, skill and knowledge evidence.

The importer must verify all manifest hashes before opening a transaction.

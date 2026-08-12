from __future__ import annotations

import argparse
import json
import ssl
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from scripts.career_catalog.china_catalog_config import GROUPS
from scripts.career_catalog.common import AuditedFetcher, RAW_DIR, ROOT, USER_AGENT, save_snapshot, sha256_bytes, utc_now, write_json

DADIAN_PDF = "https://srsj.cngy.gov.cn/Files/UploadFile/SiteFile/20160720104022026/2026/04/14/8a8384d8e7d34d90b1a8e191a4f585cb.pdf"
DADIAN_NOTICE = "https://www.mohrss.gov.cn/wap/xw/rsxw/202207/t20220714_457800.html"
STANDARD_PORTAL = "https://osta.mohrss.gov.cn/skillStandard"
STANDARD_API_HTTPS = "https://osta.mohrss.gov.cn/api/public/skillStandardList?pageSize=1000&pageNum=1&nameCode=&status=1"
STANDARD_API_HTTP = STANDARD_API_HTTPS.replace("https://", "http://", 1)
STANDARD_DOWNLOAD_HTTP = "http://osta.mohrss.gov.cn/api/sys/downloadFile/decrypt?fileName={}"


def _request(url: str, *, referer: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Referer": referer, "Accept": "application/json,application/pdf,*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _latest_by_code(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for record in records:
        code = str(record.get("code", "")).strip()
        if not code:
            continue
        current = selected.get(code)
        if current is None or str(record.get("issueTime", "")) > str(current.get("issueTime", "")):
            selected[code] = record
    return selected


def crawl(*, delay: float, output: Path, force: bool = False) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    selected_codes = sorted({code for codes in GROUPS.values() for code in codes})
    cached: dict[str, Any] = {}
    if output.exists() and not force:
        cached = json.loads(output.read_text("utf-8"))
        if (
            cached.get("dadian")
            and cached.get("standards")
            and cached.get("requested_codes") == selected_codes
        ):
            print(f"china_catalog_cache=hit standards={len(cached['standards'])}")
            return cached
    cached_standards = {item["code"]: item for item in cached.get("standards", []) if item.get("code")}

    fetcher = AuditedFetcher(delay_seconds=delay, retries=2, timeout=90)
    failures: list[dict[str, str]] = []
    transport_notes: list[str] = []
    notice = save_snapshot(fetcher.fetch(DADIAN_NOTICE), "mohrss-dadian-2022-notice")
    dadian_result = fetcher.fetch(DADIAN_PDF)
    dadian_path = RAW_DIR / "china-occupation-classification-2022.pdf"
    dadian_path.write_bytes(dadian_result.content)
    dadian = {
        "id": "china-occupation-classification-2022",
        "url": DADIAN_PDF,
        "title": "中华人民共和国职业分类大典（2022年版）",
        "publisher": "中华人民共和国人力资源和社会保障部",
        "source_type": "official_occupation_classification",
        "published_at": "2022-09-27T00:00:00Z",
        "fetched_at": dadian_result.fetched_at,
        "content_sha256": dadian_result.sha256,
        "http_status": dadian_result.status,
        "robots_status": dadian_result.robots_status,
        "license_notes": "政府公开职业分类资料；目录仅保留必要的岗位定义与主要工作任务摘录。",
        "raw_path": str(dadian_path.relative_to(RAW_DIR.parent.parent)),
    }

    try:
        _request(STANDARD_API_HTTPS, referer=STANDARD_PORTAL, timeout=20)
    except (ssl.SSLError, URLError, HTTPError) as error:
        transport_notes.append(f"OSTA HTTPS certificate/request failed; official HTTP endpoint used without disabling TLS verification: {type(error).__name__}")
    raw_list = _request(STANDARD_API_HTTP, referer=STANDARD_PORTAL)
    api_payload = json.loads(raw_list)
    records = api_payload.get("body", {}).get("list", [])
    latest = _latest_by_code(records)
    standards: list[dict[str, Any]] = []
    for code in selected_codes:
        record = latest.get(code)
        if not record or not record.get("standardInfo"):
            continue
        cached_standard = cached_standards.get(code)
        cached_path = ROOT / cached_standard["raw_path"] if cached_standard and cached_standard.get("raw_path") else None
        if (
            not force
            and cached_standard
            and cached_path
            and cached_path.exists()
            and sha256_bytes(cached_path.read_bytes()) == cached_standard.get("content_sha256")
        ):
            standards.append(cached_standard)
            continue
        file_name = str(record["standardInfo"])
        try:
            time.sleep(max(0.0, delay))
            content = _request(STANDARD_DOWNLOAD_HTTP.format(quote(file_name, safe="/")), referer=STANDARD_PORTAL, timeout=90)
            if not content.startswith(b"%PDF"):
                raise RuntimeError("download did not return a PDF")
            raw_path = RAW_DIR / "china-standards" / f"{code}.pdf"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(content)
            standards.append({
                "id": f"china-national-standard-{code}",
                "code": code,
                "name": str(record.get("name", "")).strip(),
                "issue_time": str(record.get("issueTime", "")),
                "issue_number": str(record.get("issueNumber", "")),
                "standard_info_name": str(record.get("standardInfoName", "")),
                "url": f"https://osta.mohrss.gov.cn/api/sys/downloadFile/decrypt?fileName={quote(file_name, safe='/')}",
                "portal_url": STANDARD_PORTAL,
                "publisher": "中华人民共和国人力资源和社会保障部",
                "source_type": "national_occupation_standard",
                "published_at": str(record.get("issueTime", "")).replace(" ", "T") + "Z",
                "fetched_at": utc_now(),
                "content_sha256": sha256_bytes(content),
                "http_status": 200,
                "robots_status": "unavailable:404",
                "license_notes": "国家职业标准公开查询系统文件；通过官方 HTTP 下载接口获取，HTTPS 证书错误未被绕过。",
                "raw_path": str(raw_path.relative_to(RAW_DIR.parent.parent)),
            })
        except Exception as error:  # keep individual failures visible
            failures.append({"code": code, "error": f"{type(error).__name__}: {error}"})

    payload = {
        "fetched_at": utc_now(),
        "dadian": dadian,
        "notice": notice,
        "standard_portal": {
            "id": "china-national-standard-portal",
            "url": STANDARD_PORTAL,
            "title": "国家职业标准查询系统",
            "publisher": "中华人民共和国人力资源和社会保障部",
            "source_type": "official_standard_registry",
            "published_at": None,
            "fetched_at": utc_now(),
            "content_sha256": sha256_bytes(raw_list),
            "http_status": 200,
            "robots_status": "unavailable:404",
            "license_notes": "官方查询系统目录快照；实际标准文件逐项保存哈希。",
        },
        "standards": standards,
        "failures": failures,
        "transport_notes": transport_notes,
        "registry_total": len(records),
        "requested_codes": selected_codes,
    }
    write_json(output, payload)
    print(f"china_catalog_fetch=ok registry={len(records)} selected_standards={len(standards)} failures={len(failures)}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Chinese occupation classification and current national standards")
    parser.add_argument("--delay", type=float, default=1.25)
    parser.add_argument("--output", type=Path, default=RAW_DIR / "china-standards-crawl.json")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    crawl(delay=args.delay, output=args.output, force=args.force)


if __name__ == "__main__":
    main()

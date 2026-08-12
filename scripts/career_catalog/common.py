from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from . import SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "careerpilot-data" / "raw"
CATALOG_DIR = ROOT / "careerpilot-data" / "catalog"
FIXTURE_DIR = Path(__file__).resolve().parent / "tests" / "fixtures"
USER_AGENT = "CareerPilotCatalogBot/1.0 (+https://github.com/Aidenwu0209/careerpilot)"
ALLOWED_HOSTS = {
    "zsb.gcc.edu.cn",
    "www.gcc.edu.cn",
    "gcc.edu.cn",
    "www.moe.gov.cn",
    "moe.gov.cn",
    "www.mohrss.gov.cn",
    "mohrss.gov.cn",
    "chinajob.mohrss.gov.cn",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(prefix: str, *values: str) -> str:
    normalized = "|".join(re.sub(r"\s+", " ", value.strip()) for value in values)
    return f"{prefix}-{hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:12]}"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", "utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def envelope(items: list[dict[str, Any]], *, catalog_version: str, generated_at: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "catalog_version": catalog_version,
        "generated_at": generated_at,
        "items": items,
    }


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._link_parts: list[str] = []
        self.title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"p", "div", "li", "br", "h1", "h2", "h3", "tr"}:
            self.parts.append("\n")
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._link_parts = []
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href:
            self.links.append((self._href, clean_text("".join(self._link_parts))))
            self._href = None
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        self.parts.append(data)
        if self._href is not None:
            self._link_parts.append(data)
        if self._in_title:
            self.title_parts.append(data)

    @property
    def text(self) -> str:
        lines = [clean_text(line) for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)

    @property
    def title(self) -> str:
        return clean_text("".join(self.title_parts))


def parse_html(content: bytes) -> TextExtractor:
    parser = TextExtractor()
    parser.feed(content.decode("utf-8", errors="replace"))
    return parser


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u3000", " ")).strip()


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int
    content: bytes
    fetched_at: str
    sha256: str
    content_type: str
    robots_status: str


class AuditedFetcher:
    def __init__(self, *, delay_seconds: float = 1.0, retries: int = 2, timeout: int = 25):
        self.delay_seconds = max(0.0, delay_seconds)
        self.retries = max(0, retries)
        self.timeout = timeout
        self._last_request_at = 0.0
        self._robots: dict[str, tuple[RobotFileParser, str]] = {}

    def _validate(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError(f"URL is not on the HTTPS allowlist: {url}")

    def _wait(self) -> None:
        remaining = self.delay_seconds - (time.monotonic() - self._last_request_at)
        if remaining > 0:
            time.sleep(remaining)

    def _robots_for(self, url: str) -> tuple[RobotFileParser, str]:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin in self._robots:
            return self._robots[origin]
        robots_url = origin + "/robots.txt"
        parser = RobotFileParser(robots_url)
        try:
            self._wait()
            with urlopen(Request(robots_url, headers={"User-Agent": USER_AGENT}), timeout=self.timeout) as response:
                parser.parse(response.read().decode("utf-8", errors="replace").splitlines())
                status = f"fetched:{response.status}"
                self._last_request_at = time.monotonic()
        except HTTPError as error:
            if error.code in {404, 410}:
                parser.parse([])
                status = f"unavailable:{error.code}"
            else:
                raise RuntimeError(f"robots.txt could not be checked: {robots_url}: {error}") from error
        except URLError as error:
            raise RuntimeError(f"robots.txt could not be checked: {robots_url}: {error}") from error
        self._robots[origin] = (parser, status)
        return parser, status

    def fetch(self, url: str) -> FetchResult:
        self._validate(url)
        robots, robots_status = self._robots_for(url)
        if not robots.can_fetch(USER_AGENT, url):
            raise PermissionError(f"robots.txt disallows automated fetch: {url}")
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                self._wait()
                with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=self.timeout) as response:
                    content = response.read()
                    self._last_request_at = time.monotonic()
                    return FetchResult(
                        url=response.geturl(),
                        status=response.status,
                        content=content,
                        fetched_at=utc_now(),
                        sha256=sha256_bytes(content),
                        content_type=response.headers.get("content-type", ""),
                        robots_status=robots_status,
                    )
            except (HTTPError, URLError, TimeoutError) as error:
                last_error = error
                if attempt < self.retries:
                    time.sleep(2**attempt)
        raise RuntimeError(f"fetch failed after {self.retries + 1} attempts: {url}: {last_error}")


def save_snapshot(result: FetchResult, source_id: str) -> dict[str, Any]:
    extension = ".html" if "html" in result.content_type else ".bin"
    content_path = RAW_DIR / f"{source_id}{extension}"
    content_path.parent.mkdir(parents=True, exist_ok=True)
    content_path.write_bytes(result.content)
    parser = parse_html(result.content) if extension == ".html" else None
    return {
        "id": source_id,
        "url": result.url,
        "title": parser.title if parser else source_id,
        "publisher": urlparse(result.url).hostname,
        "source_type": "official_webpage",
        "published_at": None,
        "fetched_at": result.fetched_at,
        "content_sha256": result.sha256,
        "http_status": result.status,
        "robots_status": result.robots_status,
        "license_notes": "Official public webpage; retain citation and review before redistribution.",
        "raw_path": str(content_path.relative_to(ROOT)),
    }


def resolve_url(base: str, href: str) -> str:
    return urljoin(base, href)

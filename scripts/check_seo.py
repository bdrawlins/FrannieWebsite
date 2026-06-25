#!/usr/bin/env python3
"""Local SEO checks for the static site."""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://frannietheclown.net"
EXPECTED_CANONICALS = {
    "index.html": f"{SITE_URL}/",
    "about.html": f"{SITE_URL}/about.html",
}
EXPECTED_SITEMAP_URLS = {
    f"{SITE_URL}/",
    f"{SITE_URL}/about.html",
}
GENERATED_FILES = {"site-config.js"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.ids: set[str] = set()
        self.title_parts: list[str] = []
        self.json_ld_blocks: list[str] = []
        self._in_title = False
        self._in_json_ld = False
        self._json_ld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value or "" for key, value in attrs}
        self.tags.append((tag, attr_map))

        if element_id := attr_map.get("id"):
            self.ids.add(element_id)

        if tag == "title":
            self._in_title = True
        elif tag == "script" and attr_map.get("type") == "application/ld+json":
            self._in_json_ld = True
            self._json_ld_parts = []

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)
        if self._in_json_ld:
            self._json_ld_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_json_ld:
            self.json_ld_blocks.append("".join(self._json_ld_parts))
            self._in_json_ld = False

    @property
    def title(self) -> str:
        return " ".join(part.strip() for part in self.title_parts if part.strip())


def fail(message: str) -> None:
    raise AssertionError(message)


def parse_page(relative_path: str) -> PageParser:
    parser = PageParser()
    parser.feed((ROOT / relative_path).read_text())
    return parser


def first_attr(
    parser: PageParser,
    tag: str,
    attr: str,
    *,
    where: tuple[str, str] | None = None,
) -> str | None:
    for current_tag, attrs in parser.tags:
        if current_tag != tag:
            continue
        if where and attrs.get(where[0]) != where[1]:
            continue
        if attr in attrs:
            return attrs[attr]
    return None


def check_root_files() -> None:
    for relative_path in ["CNAME", "robots.txt", "sitemap.xml"]:
        if not (ROOT / relative_path).is_file():
            fail(f"{relative_path} is missing")

    cname = (ROOT / "CNAME").read_text().strip()
    if cname != "frannietheclown.net":
        fail(f"CNAME should be frannietheclown.net, got {cname!r}")

    robots = (ROOT / "robots.txt").read_text()
    if f"Sitemap: {SITE_URL}/sitemap.xml" not in robots:
        fail("robots.txt does not point at the canonical sitemap")

    sitemap = ET.parse(ROOT / "sitemap.xml")
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = {
        loc.text.strip()
        for loc in sitemap.findall(".//sm:loc", namespace)
        if loc.text and loc.text.strip()
    }
    if urls != EXPECTED_SITEMAP_URLS:
        fail(f"sitemap URLs differ: {sorted(urls)}")


def check_json_ld(relative_path: str, parser: PageParser) -> None:
    if not parser.json_ld_blocks:
        fail(f"{relative_path}: missing JSON-LD")

    for index, block in enumerate(parser.json_ld_blocks, 1):
        try:
            json.loads(block)
        except json.JSONDecodeError as exc:
            fail(f"{relative_path}: JSON-LD block {index} is invalid: {exc}")


def check_metadata(relative_path: str, parser: PageParser) -> None:
    expected = EXPECTED_CANONICALS[relative_path]
    canonical = first_attr(parser, "link", "href", where=("rel", "canonical"))
    if canonical != expected:
        fail(f"{relative_path}: canonical should be {expected}, got {canonical!r}")

    if "Frannie" not in parser.title:
        fail(f"{relative_path}: title does not mention Frannie")

    description = first_attr(parser, "meta", "content", where=("name", "description"))
    if not description or len(description) < 80:
        fail(f"{relative_path}: meta description is missing or too short")

    og_url = first_attr(parser, "meta", "content", where=("property", "og:url"))
    if og_url != expected:
        fail(f"{relative_path}: og:url should be {expected}, got {og_url!r}")

    og_image = first_attr(parser, "meta", "content", where=("property", "og:image"))
    if not og_image or not og_image.startswith(f"{SITE_URL}/assets/"):
        fail(f"{relative_path}: og:image should be an absolute site asset URL")

    twitter_image = first_attr(parser, "meta", "content", where=("name", "twitter:image"))
    if twitter_image != og_image:
        fail(f"{relative_path}: twitter:image should match og:image")


def check_relative_references(
    relative_path: str,
    parser: PageParser,
    pages: dict[str, PageParser],
) -> None:
    reference_attrs = {
        "a": "href",
        "img": "src",
        "script": "src",
        "link": "href",
        "source": "src",
    }

    for tag, attrs in parser.tags:
        attr = reference_attrs.get(tag)
        if not attr or attr not in attrs:
            continue

        ref = attrs[attr]
        if not ref or ref.startswith(("mailto:", "tel:")):
            continue

        parsed = urlparse(ref)
        if parsed.scheme or parsed.netloc:
            continue

        target_path = parsed.path or relative_path
        target_name = Path(target_path).name

        if target_name in GENERATED_FILES:
            continue

        if target_path and not (ROOT / target_path).is_file():
            fail(f"{relative_path}: missing local reference {ref!r}")

        if parsed.fragment:
            target_page = pages.get(target_path)
            if not target_page:
                fail(f"{relative_path}: cannot verify anchor in {ref!r}")
            if parsed.fragment not in target_page.ids:
                fail(f"{relative_path}: missing anchor target {ref!r}")


def main() -> int:
    try:
        check_root_files()
        pages = {path: parse_page(path) for path in EXPECTED_CANONICALS}

        for relative_path, parser in pages.items():
            check_metadata(relative_path, parser)
            check_json_ld(relative_path, parser)
            check_relative_references(relative_path, parser, pages)
    except AssertionError as exc:
        print(f"SEO check failed: {exc}", file=sys.stderr)
        return 1

    print("SEO check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

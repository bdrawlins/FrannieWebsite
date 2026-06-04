#!/usr/bin/env python3
"""Generate browser config from .env for the static website."""

from __future__ import annotations

import json
import os
import shlex
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
OUTPUT_PATH = ROOT / "site-config.js"

REQUIRED_PUBLIC_KEYS = [
    "FRANNIE_FORMSPARK_FORM_URL",
    "FRANNIE_PUBLIC_CALENDAR_ID",
    "FRANNIE_TIME_ZONE",
    "FRANNIE_CONTACT_EMAIL",
    "FRANNIE_CONTACT_PHONE_DISPLAY",
    "FRANNIE_CONTACT_PHONE_TEL",
    "FRANNIE_FACEBOOK_URL",
    "FRANNIE_YELP_URL",
]

OPTIONAL_PUBLIC_KEYS = [
    "FRANNIE_BOTPOISON_PUBLIC_KEY",
]


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}

    if not path.exists():
        return values

    for line_number, raw_line in enumerate(path.read_text().splitlines(), 1):
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line.removeprefix("export ").strip()

        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=value")

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            raise ValueError(f"{path}:{line_number}: missing env var name")

        if value.startswith(("'", '"')):
            value = shlex.split(value, comments=False, posix=True)[0]

        values[key] = value

    return values


def main() -> None:
    env_values = parse_env_file(ENV_PATH)
    public_keys = REQUIRED_PUBLIC_KEYS + OPTIONAL_PUBLIC_KEYS
    merged = {key: os.environ.get(key, env_values.get(key, "")) for key in public_keys}
    missing = [key for key in REQUIRED_PUBLIC_KEYS if not merged[key]]

    if missing:
        names = ", ".join(missing)
        raise SystemExit(
            f"Missing required website config: {names}\n"
            "Copy .env.example to .env, fill in the values, then run make config."
        )

    config = {key.removeprefix("FRANNIE_"): value for key, value in merged.items()}
    OUTPUT_PATH.write_text(
        "window.FRANNIE_SITE_CONFIG = Object.freeze("
        + json.dumps(config, indent=4, sort_keys=True)
        + ");\n"
    )
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

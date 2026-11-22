#!/usr/bin/env python3
"""Discover target Ohio businesses from the free Geofabrik OSM extract.

This script only reads public OpenStreetMap business tags. It does not scrape
Google Maps, send emails, or store user credentials in the repository.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import osmium

USER_AGENT = "OhioLeadDiscovery/1.0 (+https://www.openstreetmap.org/)"

CRAFT_MAP = {
    "plumber": "Plumber",
    "hvac": "HVAC",
    "heating": "HVAC",
    "air_conditioning": "HVAC",
    "electrician": "Electrician",
    "roofer": "Roofer",
    "gardener": "Landscaping",
    "landscaper": "Landscaping",
    "landscape_architect": "Landscaping",
}
HEALTHCARE_MAP = {
    "dentist": "Dentist",
    "doctor": "Medical Clinic",
    "clinic": "Medical Clinic",
    "dermatology": "Dermatology",
    "aesthetic_medicine": "Cosmetic Clinic",
    "cosmetic_surgery": "Cosmetic Clinic",
    "orthodontics": "Orthodontist",
    "orthodontics;dentistry": "Orthodontist",
}
BEAUTY_MAP = {
    "clinic": "Cosmetic Clinic",
    "laser": "Laser Hair Removal",
    "cosmetic": "Cosmetic Clinic",
    "aesthetic": "Cosmetic Clinic",
}


def clean(value: object) -> str:
    return str(value).strip() if value is not None else ""


import re

EXCLUDED_CHAIN_RE = re.compile(
    r"^(?:the\s+)?(?:walmart|sam s club|target(?:$|\s+\d+\b|\s+(?:store|optical|pharmacy|distribution)\b)|home depot|"
    r"lowe'?s|menards|costco|kroger|meijer|whole foods|aldi|lidl|cvs|walgreens|rite aid|"
    r"best buy|big lots|dollar general|dollar tree|tractor supply|petco|petsmart|staples|"
    r"office depot|advance auto parts|auto ?zone|o reilly auto parts|ace hardware|true value)\b",
    re.IGNORECASE,
)


def is_excluded_chain(name: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", (name or "").lower().replace("&", " and ")).strip()
    return bool(EXCLUDED_CHAIN_RE.search(normalized))


def classify(tags) -> str:
    craft = clean(tags.get("craft")).lower()
    if craft in CRAFT_MAP:
        return CRAFT_MAP[craft]

    healthcare = clean(tags.get("healthcare")).lower()
    if healthcare in HEALTHCARE_MAP:
        return HEALTHCARE_MAP[healthcare]

    amenity = clean(tags.get("amenity")).lower()
    if amenity == "dentist":
        return "Dentist"
    if amenity in ("clinic", "doctors"):
        speciality = clean(tags.get("healthcare:speciality") or tags.get("clinic:speciality")).lower()
        if speciality in HEALTHCARE_MAP:
            return HEALTHCARE_MAP[speciality]
        if "dermat" in speciality:
            return "Dermatology"
        if any(x in speciality for x in ("cosmetic", "aesthetic", "botox")):
            return "Cosmetic Clinic"
        if "orthodont" in speciality:
            return "Orthodontist"
        return "Medical Clinic"

    speciality = " ".join([
        clean(tags.get("healthcare:speciality")),
        clean(tags.get("clinic:speciality")),
        clean(tags.get("medical_specialty")),
    ]).lower()
    if "orthodont" in speciality:
        return "Orthodontist"
    if "dermat" in speciality:
        return "Dermatology"
    if any(x in speciality for x in ("cosmetic", "aesthetic", "botox")):
        return "Cosmetic Clinic"

    beauty = clean(tags.get("beauty")).lower()
    if beauty in BEAUTY_MAP:
        return BEAUTY_MAP[beauty]

    # Do not include generic shops or offices; this keeps the list focused.
    return ""


def address_from_tags(tags):
    street = clean(tags.get("addr:street"))
    number = clean(tags.get("addr:housenumber"))
    unit = clean(tags.get("addr:unit"))
    city = clean(tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village"))
    state = clean(tags.get("addr:state"))
    postcode = clean(tags.get("addr:postcode"))
    street_line = " ".join(x for x in (number, street) if x)
    if unit and street_line:
        street_line += ", Unit " + unit
    parts = [p for p in (street_line, ", ".join(x for x in (city, state, postcode) if x)) if p]
    return ", ".join(parts), city, postcode


class OhioBusinessHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows: dict[str, dict] = {}
        self.discovered_at = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _add(self, obj, lat, lon):
        tags = obj.tags
        name = clean(tags.get("name") or tags.get("brand") or tags.get("operator"))
        if is_excluded_chain(name):
            return
        industry = classify(tags)
        if not name or not industry or lat is None or lon is None:
            return
        address, city, postcode = address_from_tags(tags)
        osm_id = f"{obj.__class__.__name__.lower()}:{obj.id}"
        tag_keys = (
            "craft", "healthcare", "healthcare:speciality", "clinic:speciality",
            "medical_specialty", "amenity", "beauty", "addr:street", "addr:housenumber",
            "addr:unit", "addr:city", "addr:postcode", "website", "contact:website",
            "url", "email", "contact:email", "phone", "contact:phone",
        )
        tag_subset = {k: clean(tags.get(k)) for k in tag_keys if tags.get(k)}
        website = clean(tags.get("contact:website") or tags.get("website") or tags.get("url"))
        email = clean(tags.get("contact:email") or tags.get("email"))
        self.rows[osm_id] = {
            "OSM ID": osm_id,
            "Business Name": name,
            "Industry": industry,
            "City": city,
            "Address": address,
            "Postal Code": postcode,
            "Website URL": website,
            "Public Email": email,
            "Email Source URL": ("https://www.openstreetmap.org/" + osm_id.replace(":", "/", 1)) if email else "",
            "Email Type": "OSM-listed public contact" if email else "",
            "Email Confidence": "Medium — OSM tag; not website-verified" if email else "",
            "Phone Number": clean(tags.get("contact:phone") or tags.get("phone")),
            "Latitude": round(float(lat), 7),
            "Longitude": round(float(lon), 7),
            "Source": "OpenStreetMap / Geofabrik Ohio extract",
            "Date Discovered": self.discovered_at,
            "OSM Tags": json.dumps(tag_subset, ensure_ascii=False),
        }

    def node(self, n):
        if n.location and n.location.valid():
            self._add(n, n.location.lat, n.location.lon)

    def way(self, w):
        coords = []
        for node in w.nodes:
            if node.location and node.location.valid():
                coords.append((node.location.lat, node.location.lon))
        if coords:
            self._add(w, sum(p[0] for p in coords) / len(coords), sum(p[1] for p in coords) / len(coords))


def post_json(webhook_url: str, secret: str, body: dict, attempts: int = 4) -> dict:
    payload = dict(body)
    payload["token"] = secret
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(webhook_url, data=data, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}, method="POST")
    last_error = None
    for attempt in range(attempts):
        try:
            with urlopen(req, timeout=90) as response:
                raw = response.read().decode("utf-8", errors="replace")
                result = json.loads(raw)
                if response.status >= 300 or not result.get("ok"):
                    raise RuntimeError(f"Webhook rejected request: {raw[:600]}")
                return result
        except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            wait = 2 ** (attempt + 1)
            print(f"Webhook attempt {attempt + 1} failed: {exc}; retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Webhook request failed after {attempts} attempts: {last_error}")


def post_batches(rows: list[dict], webhook_url: str, secret: str, batch_size: int = 100):
    if not webhook_url or not secret:
        print("No webhook configured; wrote local JSONL only.")
        return
    totals = {"added": 0, "merged": 0, "duplicates": 0}
    for start in range(0, len(rows), batch_size):
        result = post_json(webhook_url, secret, {"action": "ingest", "records": rows[start:start + batch_size]})
        for key in totals:
            totals[key] += int(result.get(key, 0))
        print(f"Uploaded batch {min(start + batch_size, len(rows))}/{len(rows)}; running totals: {totals}")
    print(f"Ingestion complete: {totals}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to Ohio .osm.pbf")
    parser.add_argument("--output", default="discoveries.jsonl")
    parser.add_argument("--webhook-url", default=os.getenv("SHEETS_WEBHOOK_URL", ""))
    parser.add_argument("--webhook-secret", default=os.getenv("SHEETS_WEBHOOK_SECRET", ""))
    args = parser.parse_args()
    pbf = Path(args.input)
    if not pbf.exists():
        raise SystemExit(f"Input file not found: {pbf}")

    handler = OhioBusinessHandler()
    print(f"Reading {pbf} (this can take several minutes)...")
    handler.apply_file(str(pbf), locations=True)
    rows = sorted(handler.rows.values(), key=lambda r: (r["Industry"], r["City"], r["Business Name"].casefold()))
    output = Path(args.output)
    with output.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Found {len(rows)} named target-category records. Saved {output}.")
    post_batches(rows, args.webhook_url, args.webhook_secret)


if __name__ == "__main__":
    main()

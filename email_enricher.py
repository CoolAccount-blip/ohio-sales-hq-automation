#!/usr/bin/env python3
"""Find publicly displayed business contact emails on official websites.

Only visits the business's own website, checks robots.txt, uses a small page
budget and delay, and never guesses email addresses or sends messages.
"""
from __future__ import annotations

import argparse
import html
import ipaddress
import json
import re
import socket
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

USER_AGENT = "OhioLeadResearchBot/1.0"
MAX_PAGES_PER_SITE = 5
MAX_BYTES_PER_PAGE = 2_000_000
REQUEST_TIMEOUT = 8
MAX_RECORDS_PER_RUN = 40
PAGE_DELAY_SECONDS = 1.0
EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+")
ROLE_ALIASES = {
    "info": 0, "contact": 1, "office": 2, "admin": 3, "service": 4,
    "support": 5, "hello": 6, "sales": 7, "estimate": 8, "estimates": 8,
    "inquiries": 9, "inquiry": 9, "appointments": 10, "booking": 10,
    "bookings": 10, "reception": 11, "frontdesk": 11, "customerservice": 12,
}
BAD_LOCAL_PREFIXES = ("noreply", "no-reply", "donotreply", "do-not-reply", "unsubscribe", "abuse", "postmaster")
NON_BUSINESS_HOSTS = ("facebook.com", "instagram.com", "tiktok.com", "linkedin.com", "yelp.com", "google.com", "g.page", "linktr.ee", "tripadvisor.com", "yellowpages.com")
EXCLUDED_CHAIN_RE = re.compile(
    r"\\b(walmart|sam'?s club|target|home depot|lowe'?s|menards|costco|kroger|meijer|"
    r"whole foods|aldi|lidl|cvs|walgreens|rite aid|best buy|big lots|dollar general|"
    r"dollar tree|tractor supply|petco|petsmart|staples|office depot|advance auto parts|"
    r"autozone|o'?reilly auto parts|ace hardware|true value)\\b",
    re.IGNORECASE,
)


def is_excluded_chain_name(name: str) -> bool:
    return bool(EXCLUDED_CHAIN_RE.search(name or ""))


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text_parts = []
        self.links = []
        self.jsonld = []
        self._script_type = ""
        self._script_data = []
        self._anchor_href = ""
        self._anchor_text = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "a":
            self._anchor_href = attrs.get("href", "") or ""
            self._anchor_text = []
        if tag.lower() == "script" and "ld+json" in (attrs.get("type", "").lower()):
            self._script_type = "ld+json"
            self._script_data = []

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._anchor_href:
            self.links.append((self._anchor_href, " ".join(self._anchor_text).strip()))
            self._anchor_href = ""
            self._anchor_text = []
        if tag.lower() == "script" and self._script_type == "ld+json":
            self.jsonld.append("".join(self._script_data))
            self._script_type = ""
            self._script_data = []

    def handle_data(self, data):
        if self._script_type == "ld+json":
            self._script_data.append(data)
        else:
            self.text_parts.append(data)
            if self._anchor_href:
                self._anchor_text.append(data)


class SafeSameSiteRedirect(HTTPRedirectHandler):
    def __init__(self, original_host):
        super().__init__()
        self.original_host = canonical_host(original_host)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urlsplit(newurl)
        if parts.scheme not in ("http", "https") or canonical_host(parts.hostname or "") != self.original_host:
            raise URLError("Redirect outside the original business website was blocked")
        validate_public_host(parts.hostname or "")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def canonical_host(host: str) -> str:
    host = (host or "").lower().strip().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def validate_public_host(host: str):
    if not host or host in ("localhost",):
        raise ValueError("Website host is missing or local")
    try:
        results = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve website host: {exc}") from exc
    addresses = {item[4][0] for item in results}
    if not addresses:
        raise ValueError("Website host did not resolve")
    for addr in addresses:
        ip = ipaddress.ip_address(addr)
        if not ip.is_global:
            raise ValueError("Non-public network address blocked")


def normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if not re.match(r"(?i)^https?://", raw):
        raw = "https://" + raw
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return ""
    if parts.username or parts.password:
        return ""
    # Drop query, fragment and common tracking parameters from the homepage URL.
    path = parts.path or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


def request_bytes(url: str, original_host: str, allow_non_html: bool = False) -> tuple[bytes, str, str]:
    parts = urlsplit(url)
    if canonical_host(parts.hostname or "") != canonical_host(original_host):
        raise ValueError("Cross-site URL blocked")
    validate_public_host(parts.hostname or "")
    opener = build_opener(SafeSameSiteRedirect(original_host))
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"})
    with opener.open(req, timeout=REQUEST_TIMEOUT) as response:
        final_url = response.geturl()
        final_parts = urlsplit(final_url)
        if canonical_host(final_parts.hostname or "") != canonical_host(original_host):
            raise ValueError("Redirected to a different website host")
        content_type = response.headers.get("Content-Type", "").lower()
        if content_type and not allow_non_html and not ("text/html" in content_type or "application/xhtml+xml" in content_type):
            return b"", final_url, content_type
        data = response.read(MAX_BYTES_PER_PAGE + 1)
        if len(data) > MAX_BYTES_PER_PAGE:
            data = data[:MAX_BYTES_PER_PAGE]
        charset = "utf-8"
        match = re.search(r"charset=([\w-]+)", content_type)
        if match:
            charset = match.group(1)
        try:
            data.decode(charset, errors="replace")
        except LookupError:
            pass
        return data, final_url, content_type


def load_robots(home_url: str, host: str) -> tuple[RobotFileParser | None, str]:
    parts = urlsplit(home_url)
    robots_url = urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        data, _final_url, _content_type = request_bytes(robots_url, host, allow_non_html=True)
        parser.parse(data.decode("utf-8", errors="replace").splitlines())
        return parser, "robots.txt"
    except HTTPError as exc:
        if exc.code in (404, 410):
            parser.parse([])
            return parser, "robots.txt not found"
        return None, f"robots.txt returned HTTP {exc.code}"
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        return None, f"robots.txt unavailable: {str(exc)[:120]}"


def decode_obfuscation(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"(?i)\s*(\[at\]|\(at\)|\sat\s)\s*", "@", text)
    text = re.sub(r"(?i)\s*(\[dot\]|\(dot\)|\sdot\s)\s*", ".", text)
    text = text.replace("[dot]", ".")
    return text


def valid_email(value: str) -> bool:
    email = value.strip().strip(".,;:()[]{}<>").lower()
    if len(email) > 254 or ".." in email:
        return False
    if email.count("@") != 1:
        return False
    local, domain = email.rsplit("@", 1)
    if not local or not domain or "." not in domain:
        return False
    if local.startswith(BAD_LOCAL_PREFIXES):
        return False
    if domain.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
        return False
    if any(x in domain for x in ("example.com", "domain.com", "yourdomain")):
        return False
    return True


def extract_from_jsonld(raw_scripts: list[str]) -> set[str]:
    found = set()
    def walk(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key.lower() == "email" and isinstance(value, str):
                    for match in EMAIL_RE.findall(decode_obfuscation(value)):
                        if valid_email(match):
                            found.add(match.lower())
                else:
                    walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)
        elif isinstance(obj, str) and "@" in obj:
            for match in EMAIL_RE.findall(decode_obfuscation(obj)):
                if valid_email(match):
                    found.add(match.lower())
    for raw in raw_scripts:
        try:
            walk(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            continue
    return found


def extract_emails(parser: PageParser) -> set[str]:
    found = set()
    for href, _label in parser.links:
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?", 1)[0].strip()
            for match in EMAIL_RE.findall(decode_obfuscation(addr)):
                if valid_email(match):
                    found.add(match.lower())
    text = decode_obfuscation(" ".join(parser.text_parts))
    for match in EMAIL_RE.findall(text):
        if valid_email(match):
            found.add(match.lower())
    found.update(extract_from_jsonld(parser.jsonld))
    return found


def contact_score(email: str) -> tuple[int, str]:
    local = email.split("@", 1)[0].lower()
    compact = re.sub(r"[^a-z0-9]", "", local)
    for alias, score in ROLE_ALIASES.items():
        if compact == alias or compact.startswith(alias):
            return score, "Role-based public inbox"
    return 50, "Other publicly listed business email"


def candidate_pages(home_url: str, links: list[tuple[str, str]]) -> list[str]:
    parts = urlsplit(home_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    candidates = [home_url]
    # Prefer actual contact links found in site navigation.
    for href, label in links:
        joined = urljoin(home_url, href)
        p = urlsplit(joined)
        if p.scheme not in ("http", "https") or canonical_host(p.hostname or "") != canonical_host(parts.hostname or ""):
            continue
        key = (p.path + " " + label).lower()
        if any(word in key for word in ("contact", "about", "team", "staff", "location", "office")):
            clean = urlunsplit((p.scheme, p.netloc, p.path or "/", "", ""))
            if clean not in candidates:
                candidates.append(clean)
    for path in ("/contact", "/contact-us", "/about", "/about-us", "/team", "/staff", "/locations"):
        url = origin + path
        if url not in candidates:
            candidates.append(url)
    return candidates[:MAX_PAGES_PER_SITE]


def research_site(record: dict) -> dict:
    website = normalize_url(str(record.get("website_url", "")))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    base = {"automation_id": record.get("automation_id", ""), "email": "", "email_source_url": "", "email_type": "", "email_confidence": "", "checked_at": now, "status": "Checked — no public email found", "note": ""}
    if is_excluded_chain_name(str(record.get("business_name", ""))):
        base["status"] = "Skipped — national chain excluded"
        base["note"] = "National chains are not eligible for local-business outreach."
        return base
    if not website:
        base["status"] = "No website URL available"
        return base

    host = urlsplit(website).hostname or ""
    if any(host == blocked or host.endswith("." + blocked) for blocked in NON_BUSINESS_HOSTS):
        base["status"] = "Skipped — social or directory profile, not an owned website"
        return base
    try:
        validate_public_host(host)
        robots, robots_note = load_robots(website, host)
        if robots is None:
            # Temporary robots.txt/network failures should be retried on a later run.
            # An explicit robots.txt disallow remains a permanent skip below.
            base["status"] = "Retry — robots.txt could not be checked"
            base["note"] = robots_note
            return base
        if not robots.can_fetch(USER_AGENT, website):
            base["status"] = "Skipped — robots.txt disallows crawling"
            base["note"] = robots_note
            return base

        collected: dict[str, tuple[str, str]] = {}
        links_all = []
        pages = candidate_pages(website, [])
        visited = set()
        for index in range(MAX_PAGES_PER_SITE):
            if index >= len(pages):
                break
            page_url = pages[index]
            if page_url in visited:
                continue
            visited.add(page_url)
            if index > 0:
                time.sleep(PAGE_DELAY_SECONDS)
            if not robots.can_fetch(USER_AGENT, page_url):
                continue
            try:
                payload, final_url, content_type = request_bytes(page_url, host)
            except HTTPError as exc:
                # A missing common contact path is normal; continue to the next page.
                if exc.code in (404, 410):
                    continue
                raise
            if not payload:
                continue
            encoding = "utf-8"
            charset = re.search(rb"charset=([\w-]+)", payload[:2048], re.I)
            if charset:
                try:
                    encoding = charset.group(1).decode("ascii")
                except Exception:
                    pass
            source = payload.decode(encoding, errors="replace")
            parser = PageParser()
            parser.feed(source)
            links_all.extend(parser.links)
            for email in extract_emails(parser):
                if email not in collected:
                    collected[email] = (final_url, "Official website listing")
            # Rebuild candidate list once after the homepage to use real nav links.
            if index == 0:
                discovered = candidate_pages(website, parser.links)
                pages = discovered
            # Stop early after finding an actual role inbox on a page.
            if collected and min(contact_score(e)[0] for e in collected) <= 8:
                break

        if collected:
            selected = sorted(collected.items(), key=lambda item: (contact_score(item[0])[0], item[0]))[0]
            email, (source_url, source_type) = selected
            rank, kind = contact_score(email)
            base.update({
                "email": email,
                "email_source_url": source_url,
                "email_type": kind,
                "email_confidence": "High — published on official website" if rank <= 8 else "Medium — published on official website",
                "status": "Done — public email found",
                "note": "Public listing found; mailbox delivery has not been tested.",
            })
        else:
            base["note"] = "Checked homepage/contact pages only; no email address was published there."
        return base
    except (ValueError, URLError, HTTPError, TimeoutError, OSError, socket.error) as exc:
        base["status"] = "Retry — website research error"
        base["note"] = str(exc)[:250]
        return base


def post_json(url: str, token: str, body: dict) -> dict:
    from urllib.request import Request, urlopen
    payload = dict(body)
    payload["token"] = token
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}, method="POST")
    with urlopen(req, timeout=90) as response:
        raw = response.read().decode("utf-8", errors="replace")
        result = json.loads(raw)
        if response.status >= 300 or not result.get("ok"):
            raise RuntimeError(f"Apps Script request failed: {raw[:600]}")
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--webhook-url", required=True)
    parser.add_argument("--webhook-secret", default="")
    parser.add_argument("--max-records", type=int, default=MAX_RECORDS_PER_RUN)
    args = parser.parse_args()
    limit = max(1, min(args.max_records, MAX_RECORDS_PER_RUN))
    secret = args.webhook_secret
    if not secret:
        import os
        secret = os.getenv("SHEETS_WEBHOOK_SECRET", "")
    if not secret:
        raise SystemExit("Missing webhook secret")

    queue = post_json(args.webhook_url, secret, {"action": "get_email_queue", "limit": limit})
    records = queue.get("records", [])
    print(f"Email research queue: {len(records)} website(s) (limit {limit})")
    results = []
    counts = {"found": 0, "no_public_email": 0, "retry": 0, "skipped": 0}
    for i, record in enumerate(records, start=1):
        print(f"[{i}/{len(records)}] Researching queued business website.")
        result = research_site(record)
        results.append(result)
        if result.get("email"):
            counts["found"] += 1
            print("  Found a published contact email.")
        elif str(result.get("status", "")).startswith("Checked"):
            counts["no_public_email"] += 1
            print("  Checked — no public email found")
        elif str(result.get("status", "")).startswith("Retry"):
            counts["retry"] += 1
            print("  Retry — website research error")
        else:
            counts["skipped"] += 1
            print(f"  {result.get('status', 'Skipped')}")
    if results:
        saved = post_json(args.webhook_url, secret, {"action": "save_email_results", "results": results})
        counts["saved"] = int(saved.get("updated", 0))
        print(
            "Batch summary: "
            f"found={counts['found']}, no_public_email={counts['no_public_email']}, "
            f"retry={counts['retry']}, skipped={counts['skipped']}, saved={counts['saved']}"
        )
    else:
        print("No pending website email research. Nothing to update.")


if __name__ == "__main__":
    main()

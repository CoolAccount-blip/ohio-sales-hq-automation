"""Validate the Command Center sidebar's inline JavaScript without a browser."""
from html.parser import HTMLParser
import subprocess
from pathlib import Path

class ScriptCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.parts = []
        self.current = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            self.in_script = True
            self.current = []

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.in_script:
            self.parts.append("".join(self.current))
            self.in_script = False

    def handle_data(self, data):
        if self.in_script:
            self.current.append(data)

source = Path(__file__).with_name("CommandCenter.html").read_text(encoding="utf-8")
parser = ScriptCollector()
parser.feed(source)
assert parser.parts, "CommandCenter.html must contain its client-side script"
js = "\n".join(parser.parts)
check = subprocess.run(
    ["node", "--check", "--input-type=commonjs"],
    input=js.encode("utf-8"),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
assert check.returncode == 0, check.stderr.decode("utf-8", errors="replace")
for required in ("saveOhioEmailResearchSettings", "retryFailedOhioEmailResearch",
                 "recheckOhioNoEmailWebsites", "toggleResearch"):
    assert required in js, f"Missing sidebar action: {required}"
print("Command Center HTML/JavaScript checks passed.")

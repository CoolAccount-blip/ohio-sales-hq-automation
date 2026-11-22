"""Small offline checks for the public email extractor."""
from email_enricher import PageParser, extract_emails, contact_score, valid_email, is_excluded_chain_name

HTML = '''
<html><body>
  <a href="mailto:office@sampleplumbing.com">Email our office</a>
  <p>For general questions write contact [at] sampleplumbing [dot] com</p>
  <script type="application/ld+json">{"@type":"LocalBusiness","email":"hello@sampleplumbing.com"}</script>
</body></html>
'''

parser = PageParser()
parser.feed(HTML)
found = extract_emails(parser)
assert "office@sampleplumbing.com" in found, found
assert "contact@sampleplumbing.com" in found, found
assert "hello@sampleplumbing.com" in found, found
assert valid_email("info@business.org")
assert not valid_email("noreply@business.org")
assert is_excluded_chain_name("Walmart Garden Center")
assert is_excluded_chain_name("Home Depot")
assert not is_excluded_chain_name("Independent Family Dental")
assert contact_score("info@business.org")[0] < contact_score("john@business.org")[0]
assert is_excluded_chain_name("Target 120")
assert is_excluded_chain_name("The Home Depot")
assert is_excluded_chain_name("O'Reilly Auto Parts")
assert not is_excluded_chain_name("Target Plumbing")
assert is_excluded_chain_name("Sams Club")
assert is_excluded_chain_name("Sam's Club")
assert is_excluded_chain_name("Lowe's")
print("Offline email extraction tests passed.")

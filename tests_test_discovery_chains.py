from discover_osm import is_excluded_chain

assert is_excluded_chain("Walmart Garden Center")
assert is_excluded_chain("The Home Depot")
assert is_excluded_chain("Kroger Pharmacy")
assert not is_excluded_chain("Independent Family Dental")
assert not is_excluded_chain("Smith Plumbing & Heating")
assert is_excluded_chain("Target 120")
assert is_excluded_chain("O'Reilly Auto Parts")
assert not is_excluded_chain("Target Plumbing")
assert is_excluded_chain("Sams Club")
assert is_excluded_chain("Sam's Club")
assert is_excluded_chain("Lowe's")
print("Discovery chain exclusion tests passed.")

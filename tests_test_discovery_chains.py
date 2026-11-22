from discover_osm import is_excluded_chain

assert is_excluded_chain("Walmart Garden Center")
assert is_excluded_chain("The Home Depot")
assert is_excluded_chain("Kroger Pharmacy")
assert not is_excluded_chain("Independent Family Dental")
assert not is_excluded_chain("Smith Plumbing & Heating")
print("Discovery chain exclusion tests passed.")

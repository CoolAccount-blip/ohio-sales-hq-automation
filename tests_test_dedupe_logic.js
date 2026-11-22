const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(__dirname + '/apps_script_receiver.gs', 'utf8');
vm.runInThisContext(source, {filename: 'apps_script_receiver.gs'});
assert.strictEqual(normalizeName_('Axis Plumbing Inc.'), normalizeName_('Axis Plumbing, LLC'));
assert.strictEqual(
  exactNameAddressKey_('Axis Plumbing Inc.', '5533 State Road, Parma, OH 44134', 'Parma'),
  exactNameAddressKey_('Axis Plumbing LLC', '5533 State Rd, Parma', 'Parma')
);
assert.notStrictEqual(
  exactNameAddressKey_('Axis Plumbing Inc.', '5533 State Rd, Parma, OH 44134', 'Parma'),
  exactNameAddressKey_('Axis Plumbing Inc.', '10 Main St, Parma, OH 44134', 'Parma')
);
assert.strictEqual(
  phoneAddressKey_('937-555-0100', '100 Main St, Dayton, OH 45402', 'Dayton'),
  phoneAddressKey_('+1 (937) 555-0100', '100 Main Street, Dayton, OH 45402', 'Dayton')
);
assert.strictEqual(
  websiteAddressKey_('https://www.axisplumbing.com/', '5533 State Rd, Parma, OH 44134', 'Parma'),
  websiteAddressKey_('http://axisplumbing.com/contact', '5533 State Road, Parma, OH 44134', 'Parma')
);
assert.notStrictEqual(
  websiteAddressKey_('https://axisplumbing.com', '5533 State Rd, Parma, OH 44134', 'Parma'),
  websiteAddressKey_('https://axisplumbing.com', '10 Main St, Parma, OH 44134', 'Parma')
);
console.log('Offline deduplication normalization tests passed.');

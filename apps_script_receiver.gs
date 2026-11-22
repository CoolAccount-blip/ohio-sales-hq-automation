/**
 * Ohio Sales HQ automation receiver.
 * Add this as a NEW .gs file in the spreadsheet's existing Apps Script project.
 * Do not replace the current approved-email sender script.
 *
 * Run setupAutomation() once from the Apps Script editor, then deploy this
 * project as a Web App (execute as you; access for the webhook must be Anyone).
 * Store WEBHOOK_SECRET in Project Settings > Script properties.
 */
const OHIO_CONFIG = {
  PROSPECTS: 'Prospects',
  INBOX: 'Discovery Inbox',
  DUP_LOG: 'Duplicate Log',
  AUTO_LOG: 'Automation Log',
  PROSPECT_EXTRA_HEADERS: [
    'Automation ID', 'OSM IDs', 'Postal Code', 'Email Source URL', 'Email Type',
    'Email Confidence', 'Email Checked At', 'Email Research Status', 'Email Research Notes',
    'Last Automation Update', 'Possible Duplicate', 'Latitude', 'Longitude'
  ],
  INBOX_HEADERS: [
    'Automation ID', 'OSM IDs', 'Business Name', 'Industry', 'City (OH)', 'Address',
    'Postal Code', 'Website URL', 'Public Email', 'Phone Number', 'Email Source URL',
    'Email Type', 'Email Confidence', 'Email Checked At', 'Email Research Status', 'Email Research Notes',
    'Source', 'Date Discovered', 'Latitude', 'Longitude', 'OSM Tags', 'Review Status',
    'Matched Prospect Row', 'Notes', 'Possible Duplicate'
  ],
  DUP_HEADERS: [
    'Timestamp', 'Action', 'Kept Sheet', 'Kept Row', 'Removed Sheet', 'Removed Row',
    'Business Name', 'Match Method', 'OSM ID', 'Details'
  ],
  LOG_HEADERS: [
    'Timestamp', 'Action', 'Received', 'Added', 'Merged Into Prospects',
    'Merged Into Inbox', 'Email Queue Size', 'Notes'
  ],
  EMAIL_BATCH_MAX: 40,
  PROCESSING_STALE_HOURS: 24
};


/** Resolve the target sheet reliably in both editor runs and Web App executions. */
function getAutomationSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('OHIO_AUTOMATION_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('Spreadsheet ID is not configured. Run setupAutomation() from the target Google Sheet first.');
}

/** One-time setup. Safe to run more than once. */
function setupAutomation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Google Sheet before running setupAutomation().');
  PropertiesService.getScriptProperties().setProperty('OHIO_AUTOMATION_SPREADSHEET_ID', ss.getId());
  const prospects = ss.getSheetByName(OHIO_CONFIG.PROSPECTS);
  if (!prospects) throw new Error('Could not find the Prospects tab.');
  ensureHeaderColumns_(prospects, OHIO_CONFIG.PROSPECT_EXTRA_HEADERS);
  const inbox = ensureSheetWithHeaders_(ss, OHIO_CONFIG.INBOX, OHIO_CONFIG.INBOX_HEADERS);
  ensureSheetWithHeaders_(ss, OHIO_CONFIG.DUP_LOG, OHIO_CONFIG.DUP_HEADERS);
  ensureSheetWithHeaders_(ss, OHIO_CONFIG.AUTO_LOG, OHIO_CONFIG.LOG_HEADERS);
  initializeAutomationRows_(prospects);
  initializeAutomationRows_(inbox);
  logAutomation_('SETUP', 0, 0, 0, 0, 0, 'Automation columns and tabs checked/created.');
  Logger.log('Setup complete. Existing prospect rows were preserved.');
}

/**
 * Webhook endpoint. Actions: ingest, get_email_queue, save_email_results, test.
 * Every request must include the shared token.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || !body.token || body.token !== expected) return jsonResponse_({ok: false, error: 'Unauthorized'});
    if (!lock.tryLock(20000)) return jsonResponse_({ok: false, error: 'Another automation task is running; retry shortly.'});

    const action = String(body.action || 'ingest').toLowerCase();
    let result;
    if (action === 'test') {
      result = {ok: true, message: 'Ohio Sales HQ webhook is connected.'};
    } else if (action === 'ingest') {
      result = ingestRecords_(body.records);
    } else if (action === 'get_email_queue') {
      result = getEmailQueue_(body.limit);
    } else if (action === 'save_email_results') {
      result = saveEmailResults_(body.results);
    } else {
      result = {ok: false, error: 'Unknown action.'};
    }
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ok: false, error: String(err && err.message || err)});
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function ingestRecords_(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 250) {
    return {ok: false, error: 'Send between 1 and 250 records per batch.'};
  }
  const ss = getAutomationSpreadsheet_();
  const prospects = ss.getSheetByName(OHIO_CONFIG.PROSPECTS);
  if (!prospects) throw new Error('Could not find the Prospects tab. Run setupAutomation().');
  ensureHeaderColumns_(prospects, OHIO_CONFIG.PROSPECT_EXTRA_HEADERS);
  const inbox = ensureSheetWithHeaders_(ss, OHIO_CONFIG.INBOX, OHIO_CONFIG.INBOX_HEADERS);

  const entries = [];
  entries.push.apply(entries, loadIndexEntries_(prospects, 'Prospects'));
  entries.push.apply(entries, loadIndexEntries_(inbox, 'Discovery Inbox'));
  const indexes = makeIndexes_(entries);
  const newRows = [];
  const newEntries = [];
  const counters = {added: 0, mergedProspects: 0, mergedInbox: 0, duplicates: 0, emailQueued: 0};

  records.forEach(function(raw) {
    const r = normalizeIncomingRecord_(raw);
    if (!r['OSM ID'] || !r['Business Name']) { counters.duplicates++; return; }
    const match = findMatch_(r, indexes);
    if (match) {
      mergeIncomingIntoEntry_(match, r);
      counters.duplicates++;
      if (match.sheetName === 'Prospects') counters.mergedProspects++;
      else counters.mergedInbox++;
      return;
    }

    const possibleMatch = findPossibleMatch_(r, indexes);
    const possibleNote = possibleMatch ? 'Review — same normalized business name and city; address differs or is incomplete.' : '';
    const rowObj = makeInboxRow_(r, possibleNote);
    newRows.push(rowObj.values);
    const entry = {
      sheet: inbox, sheetName: 'Discovery Inbox', row: null, headers: rowObj.headers,
      values: rowObj.values, newRecord: true, updates: {}
    };
    newEntries.push(entry);
    registerEntry_(entry, indexes);
    counters.added++;
    if (r['Website URL'] && !r['Public Email']) counters.emailQueued++;
  });

  // Write any updates to existing rows without overwriting formulas elsewhere in the row.
  entries.forEach(function(entry) { flushEntryUpdates_(entry); });
  if (newRows.length) {
    const firstRow = inbox.getLastRow() + 1;
    inbox.getRange(firstRow, 1, newRows.length, OHIO_CONFIG.INBOX_HEADERS.length).setValues(newRows);
  }
  logAutomation_('INGEST', records.length, counters.added, counters.mergedProspects,
    counters.mergedInbox, counters.emailQueued,
    'Exact duplicate candidates merged/blocked: ' + counters.duplicates + '; name/city review flags: ' + newEntries.filter(function(e){return !!e.values[headerCol_(e.headers, 'Possible Duplicate') - 1];}).length);
  return {
    ok: true,
    received: records.length,
    added: counters.added,
    merged: counters.mergedProspects + counters.mergedInbox,
    merged_into_prospects: counters.mergedProspects,
    merged_into_inbox: counters.mergedInbox,
    duplicates: counters.duplicates,
    email_queued: counters.emailQueued
  };
}

function normalizeIncomingRecord_(raw) {
  raw = raw || {};
  const email = clean_(raw['Public Email'] || raw.email);
  return {
    'OSM ID': clean_(raw['OSM ID'] || raw.osm_id),
    'Business Name': clean_(raw['Business Name'] || raw.business_name || raw.name),
    'Industry': clean_(raw['Industry'] || raw.industry),
    'City': clean_(raw['City'] || raw.city),
    'Address': clean_(raw['Address'] || raw.address),
    'Postal Code': clean_(raw['Postal Code'] || raw.postal_code),
    'Website URL': normalizeWebsite_(raw['Website URL'] || raw.website_url || raw.website),
    'Public Email': email,
    'Email Source URL': clean_(raw['Email Source URL'] || raw.email_source_url),
    'Email Type': clean_(raw['Email Type'] || raw.email_type),
    'Email Confidence': clean_(raw['Email Confidence'] || raw.email_confidence),
    'Phone Number': clean_(raw['Phone Number'] || raw.phone),
    'Latitude': raw['Latitude'] || raw.latitude || '',
    'Longitude': raw['Longitude'] || raw.longitude || '',
    'Source': clean_(raw.Source || raw.source || 'OpenStreetMap / Geofabrik Ohio extract'),
    'Date Discovered': clean_(raw['Date Discovered'] || raw.date_discovered) || new Date(),
    'OSM Tags': clean_(raw['OSM Tags'] || raw.osm_tags)
  };
}

function loadIndexEntries_(sheet, sheetName) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function(row, i) {
    return {sheet: sheet, sheetName: sheetName, row: i + 2, headers: headers, values: row,
      newRecord: false, updates: {}};
  }).filter(function(entry) {
    return clean_(valueByHeader_(entry, 'Business Name')) !== '';
  });
}

function makeIndexes_(entries) {
  const byId = Object.create(null);
  const byNameAddress = Object.create(null);
  const byPhoneAddress = Object.create(null);
  const byWebsiteAddress = Object.create(null);
  const byNameCity = Object.create(null);
  const indexes = {byId: byId, byNameAddress: byNameAddress, byPhoneAddress: byPhoneAddress, byWebsiteAddress: byWebsiteAddress, byNameCity: byNameCity};
  entries.forEach(function(entry) { registerEntry_(entry, indexes); });
  return indexes;
}

function registerEntry_(entry, indexes) {
  const ids = String(valueByHeader_(entry, 'OSM IDs') || '').split(/[|;,]/).map(function(x){return clean_(x);}).filter(Boolean);
  const singleId = clean_(valueByHeader_(entry, 'OSM ID'));
  if (singleId) ids.push(singleId);
  ids.forEach(function(id) { indexes.byId[id] = indexes.byId[id] || entry; });
  const name = normalizeName_(valueByHeader_(entry, 'Business Name'));
  const address = normalizeAddress_(valueByHeader_(entry, 'Address'));
  const city = normalizeAddress_(valueByHeader_(entry, 'City (OH)') || valueByHeader_(entry, 'City'));
  const key = exactNameAddressKey_(valueByHeader_(entry, 'Business Name'), valueByHeader_(entry, 'Address'), valueByHeader_(entry, 'City (OH)') || valueByHeader_(entry, 'City'));
  if (key) indexes.byNameAddress[key] = indexes.byNameAddress[key] || entry;
  const phoneKey = phoneAddressKey_(valueByHeader_(entry, 'Phone Number'), valueByHeader_(entry, 'Address'), valueByHeader_(entry, 'City (OH)') || valueByHeader_(entry, 'City'));
  if (phoneKey && indexes.byPhoneAddress) indexes.byPhoneAddress[phoneKey] = indexes.byPhoneAddress[phoneKey] || entry;
  const websiteKey = websiteAddressKey_(valueByHeader_(entry, 'Website URL'), valueByHeader_(entry, 'Address'), valueByHeader_(entry, 'City (OH)') || valueByHeader_(entry, 'City'));
  if (websiteKey && indexes.byWebsiteAddress) indexes.byWebsiteAddress[websiteKey] = indexes.byWebsiteAddress[websiteKey] || entry;
  if (name && city && indexes.byNameCity) {
    const looseKey = name + '|' + city;
    indexes.byNameCity[looseKey] = indexes.byNameCity[looseKey] || entry;
  }
}

function findMatch_(record, indexes) {
  return findMatchDetails_(record, indexes).entry;
}

function findMatchDetails_(record, indexes) {
  const idMatch = indexes.byId[record['OSM ID']];
  if (idMatch) return {entry: idMatch, method: 'Identical OSM ID'};
  const key = exactNameAddressKey_(record['Business Name'], record['Address'], record['City']);
  if (key && indexes.byNameAddress[key]) return {entry: indexes.byNameAddress[key], method: 'Exact normalized name + address'};
  const phoneKey = phoneAddressKey_(record['Phone Number'], record['Address'], record['City']);
  if (phoneKey && indexes.byPhoneAddress && indexes.byPhoneAddress[phoneKey]) return {entry: indexes.byPhoneAddress[phoneKey], method: 'Exact normalized phone + address'};
  const websiteKey = websiteAddressKey_(record['Website URL'], record['Address'], record['City']);
  if (websiteKey && indexes.byWebsiteAddress && indexes.byWebsiteAddress[websiteKey]) return {entry: indexes.byWebsiteAddress[websiteKey], method: 'Exact website host + address'};
  return {entry: null, method: ''};
}

function findPossibleMatch_(record, indexes) {
  const name = normalizeName_(record['Business Name']);
  const city = normalizeAddress_(record['City']);
  if (!name || !city || !indexes.byNameCity) return null;
  const entry = indexes.byNameCity[name + '|' + city];
  if (!entry) return null;
  const incomingAddress = normalizeAddress_(record['Address']);
  const existingAddress = normalizeAddress_(valueByHeader_(entry, 'Address'));
  if (!incomingAddress || !existingAddress || incomingAddress !== existingAddress) return entry;
  return null;
}

function mergeIncomingIntoEntry_(entry, r) {
  const mappings = [
    ['Business Name', 'Business Name'], ['Industry', 'Industry'], ['City', 'City (OH)'],
    ['Address', 'Address'], ['Postal Code', 'Postal Code'], ['Website URL', 'Website URL'],
    ['Public Email', 'Public Email'], ['Phone Number', 'Phone Number'],
    ['Email Source URL', 'Email Source URL'], ['Email Type', 'Email Type'],
    ['Email Confidence', 'Email Confidence'], ['Latitude', 'Latitude'], ['Longitude', 'Longitude']
  ];
  mappings.forEach(function(pair) {
    const value = r[pair[0]];
    if (isBlank_(value)) return;
    const col = headerCol_(entry.headers, pair[1]);
    if (!col) return;
    const current = entryValue_(entry, col);
    if (isBlank_(current) || (pair[1] === 'Public Email' && isPlaceholder_(current))) {
      setEntryValue_(entry, col, value);
    }
  });
  const automationCol = headerCol_(entry.headers, 'Automation ID');
  if (automationCol && isBlank_(entryValue_(entry, automationCol))) setEntryValue_(entry, automationCol, Utilities.getUuid());
  const idsCol = headerCol_(entry.headers, 'OSM IDs');
  if (idsCol) {
    const previous = String(entryValue_(entry, idsCol) || '');
    const all = previous.split(/[|;,]/).map(function(x){return clean_(x);}).filter(Boolean);
    if (r['OSM ID'] && all.indexOf(r['OSM ID']) === -1) all.push(r['OSM ID']);
    setEntryValue_(entry, idsCol, all.join(' | '));
  }
  const websiteValue = r['Website URL'];
  const hasWebsiteCol = headerCol_(entry.headers, 'Has Website (Yes/No)');
  if (websiteValue && hasWebsiteCol && /^no$/i.test(clean_(entryValue_(entry, hasWebsiteCol))) &&
      (!entry.row || !entry.sheet.getRange(entry.row, hasWebsiteCol).getFormula())) {
    setEntryValue_(entry, hasWebsiteCol, 'Yes');
  }
  const statusCol = headerCol_(entry.headers, 'Email Research Status');
  const emailCol = headerCol_(entry.headers, 'Public Email');
  const currentEmail = emailCol ? entryValue_(entry, emailCol) : '';
  const currentStatus = statusCol ? clean_(entryValue_(entry, statusCol)) : '';
  if (statusCol && r['Public Email'] && (isBlank_(currentEmail) || isPlaceholder_(currentEmail))) {
    setEntryValue_(entry, statusCol, 'Skipped — email already listed in OSM');
  } else if (statusCol && r['Website URL'] && (!currentStatus || /^No website available$/i.test(currentStatus))) {
    setEntryValue_(entry, statusCol, 'Pending');
  }
  const updatedCol = headerCol_(entry.headers, 'Last Automation Update');
  if (updatedCol) setEntryValue_(entry, updatedCol, new Date());
}

function makeInboxRow_(r, possibleDuplicate) {
  const valuesByHeader = {
    'Automation ID': Utilities.getUuid(), 'OSM IDs': r['OSM ID'],
    'Business Name': r['Business Name'], 'Industry': r['Industry'], 'City (OH)': r['City'],
    'Address': r['Address'], 'Postal Code': r['Postal Code'], 'Website URL': r['Website URL'],
    'Public Email': r['Public Email'], 'Phone Number': r['Phone Number'],
    'Email Source URL': r['Email Source URL'], 'Email Type': r['Email Type'],
    'Email Confidence': r['Email Confidence'], 'Email Checked At': '',
    'Email Research Status': r['Public Email'] ? 'Skipped — email already listed in OSM' : (r['Website URL'] ? 'Pending' : 'No website available'),
    'Email Research Notes': '',
    'Source': r['Source'], 'Date Discovered': r['Date Discovered'],
    'Latitude': r['Latitude'], 'Longitude': r['Longitude'], 'OSM Tags': r['OSM Tags'],
    'Review Status': 'Needs Review', 'Matched Prospect Row': '', 'Notes': '', 'Possible Duplicate': possibleDuplicate || ''
  };
  return {headers: OHIO_CONFIG.INBOX_HEADERS, values: OHIO_CONFIG.INBOX_HEADERS.map(function(h){return valuesByHeader[h] === undefined ? '' : valuesByHeader[h];})};
}

function getEmailQueue_(limit) {
  const ss = getAutomationSpreadsheet_();
  // Keep the user's existing prospects ahead of newly discovered inbox leads.
  const tabs = [ss.getSheetByName(OHIO_CONFIG.PROSPECTS), ss.getSheetByName(OHIO_CONFIG.INBOX)].filter(Boolean);
  const cap = Math.max(1, Math.min(Number(limit) || OHIO_CONFIG.EMAIL_BATCH_MAX, OHIO_CONFIG.EMAIL_BATCH_MAX));
  const results = [];
  const now = new Date();

  tabs.forEach(function(sheet) {
    if (results.length >= cap) return;
    const state = getSheetState_(sheet);
    const idCol = headerCol_(state.headers, 'Automation ID');
    const nameCol = headerCol_(state.headers, 'Business Name');
    const websiteCol = headerCol_(state.headers, 'Website URL');
    const cityCol = headerCol_(state.headers, 'City (OH)') || headerCol_(state.headers, 'City');
    const emailCol = headerCol_(state.headers, 'Public Email');
    const statusCol = headerCol_(state.headers, 'Email Research Status');
    const updateCol = headerCol_(state.headers, 'Last Automation Update');
    const scoreCol = headerCol_(state.headers, 'Lead Score (0-100)');
    if (!idCol || !nameCol || !websiteCol || !statusCol) return;

    const candidates = [];
    for (let i = 0; i < state.values.length; i++) {
      const row = state.values[i];
      const website = clean_(row[websiteCol - 1]);
      const email = emailCol ? row[emailCol - 1] : '';
      if (!clean_(row[nameCol - 1]) || !website || (!isBlank_(email) && !isPlaceholder_(email))) continue;

      const status = clean_(row[statusCol - 1]);
      const lastUpdate = updateCol ? row[updateCol - 1] : '';
      const staleProcessing = /^Processing/i.test(status) && lastUpdate instanceof Date &&
        ((now - lastUpdate) / 3600000 > OHIO_CONFIG.PROCESSING_STALE_HOURS);
      const pending = !status || /^Pending$/i.test(status) || /^Retry/i.test(status) || staleProcessing;
      if (!pending) continue;

      const rawScore = scoreCol ? Number(row[scoreCol - 1]) : 0;
      candidates.push({
        rowNum: i + 2,
        row: row,
        score: Number.isFinite(rawScore) ? rawScore : 0,
        originalIndex: i
      });
    }

    // Prospects have lead scores; work the highest-value existing prospects first.
    // Inbox entries have no lead score column and retain their discovery order.
    if (sheet.getName() === OHIO_CONFIG.PROSPECTS && scoreCol) {
      candidates.sort(function(a, b) {
        return (b.score - a.score) || (a.originalIndex - b.originalIndex);
      });
    }

    candidates.forEach(function(candidate) {
      if (results.length >= cap) return;
      const rowNum = candidate.rowNum;
      const row = candidate.row;
      const website = clean_(row[websiteCol - 1]);
      let automationId = clean_(row[idCol - 1]);
      if (!automationId) {
        automationId = Utilities.getUuid();
        sheet.getRange(rowNum, idCol).setValue(automationId);
      }
      sheet.getRange(rowNum, statusCol).setValue('Processing');
      if (updateCol) sheet.getRange(rowNum, updateCol).setValue(now);
      results.push({
        automation_id: automationId,
        business_name: clean_(row[nameCol - 1]),
        website_url: website,
        city: cityCol ? clean_(row[cityCol - 1]) : '',
        sheet_name: sheet.getName(),
        lead_score: candidate.score
      });
    });
  });
  return {ok: true, records: results, count: results.length};
}

function saveEmailResults_(results) {
  if (!Array.isArray(results) || results.length > 100) return {ok: false, error: 'Send up to 100 results.'};
  const ss = getAutomationSpreadsheet_();
  const sheets = [ss.getSheetByName(OHIO_CONFIG.PROSPECTS), ss.getSheetByName(OHIO_CONFIG.INBOX)].filter(Boolean);
  const index = Object.create(null);
  sheets.forEach(function(sheet) {
    const state = getSheetState_(sheet);
    const idCol = headerCol_(state.headers, 'Automation ID');
    if (!idCol) return;
    state.values.forEach(function(row, i) {
      const id = clean_(row[idCol - 1]);
      if (id) index[id] = {sheet: sheet, row: i + 2, headers: state.headers, values: row};
    });
  });
  let updated = 0;
  results.forEach(function(result) {
    const entry = index[clean_(result.automation_id)];
    if (!entry) return;
    const emailCol = headerCol_(entry.headers, 'Public Email');
    const sourceCol = headerCol_(entry.headers, 'Email Source URL');
    const typeCol = headerCol_(entry.headers, 'Email Type');
    const confidenceCol = headerCol_(entry.headers, 'Email Confidence');
    const checkedCol = headerCol_(entry.headers, 'Email Checked At');
    const statusCol = headerCol_(entry.headers, 'Email Research Status');
    const updateCol = headerCol_(entry.headers, 'Last Automation Update');
    const notesCol = headerCol_(entry.headers, 'Email Research Notes');
    const existingEmail = emailCol ? clean_(entry.values[emailCol - 1]) : '';
    const foundEmail = clean_(result.email);
    let status = clean_(result.status) || 'Checked';
    if (foundEmail) {
      if (isBlank_(existingEmail) || isPlaceholder_(existingEmail)) {
        if (emailCol) entry.sheet.getRange(entry.row, emailCol).setValue(foundEmail);
        if (sourceCol) entry.sheet.getRange(entry.row, sourceCol).setValue(clean_(result.email_source_url));
        if (typeCol) entry.sheet.getRange(entry.row, typeCol).setValue(clean_(result.email_type));
        if (confidenceCol) entry.sheet.getRange(entry.row, confidenceCol).setValue(clean_(result.email_confidence));
      } else if (existingEmail.toLowerCase() !== foundEmail.toLowerCase()) {
        status = 'Review — another public email found; existing email kept';
        appendDuplicateLog_('EMAIL_CONFLICT', entry.sheet.getName(), entry.row, '', '',
          clean_(entry.values[headerCol_(entry.headers, 'Business Name') - 1]), 'Different published emails', '',
          'Existing: ' + existingEmail + ' | New: ' + foundEmail + ' | Source: ' + clean_(result.email_source_url));
      }
    }
    if (checkedCol) entry.sheet.getRange(entry.row, checkedCol).setValue(result.checked_at ? new Date(result.checked_at) : new Date());
    if (statusCol) entry.sheet.getRange(entry.row, statusCol).setValue(status);
    if (notesCol && clean_(result.note)) entry.sheet.getRange(entry.row, notesCol).setValue(clean_(result.note));
    if (updateCol) entry.sheet.getRange(entry.row, updateCol).setValue(new Date());
    updated++;
  });
  logAutomation_('EMAIL_RESEARCH', results.length, 0, 0, 0, 0, 'Results saved: ' + updated);
  return {ok: true, updated: updated};
}

/**
 * Conservative cleanup of duplicates already present. Makes timestamped copies
 * of both data tabs first. It only auto-merges exact normalized name+address or
 * identical OSM IDs; fuzzy name-only matches are deliberately left untouched.
 */
function cleanupExistingDuplicates() {
  const ss = getAutomationSpreadsheet_();
  const prospects = ss.getSheetByName(OHIO_CONFIG.PROSPECTS);
  const inbox = ss.getSheetByName(OHIO_CONFIG.INBOX);
  if (!prospects) throw new Error('Could not find Prospects.');
  if (!inbox) throw new Error('Run setupAutomation() first to create Discovery Inbox.');
  ensureHeaderColumns_(prospects, OHIO_CONFIG.PROSPECT_EXTRA_HEADERS);
  backupSheet_(prospects, 'Prospects Backup');
  backupSheet_(inbox, 'Discovery Inbox Backup');
  const logs = [];
  const pCount = dedupeWithinSheet_(prospects, 'Prospects', logs);
  const iCount = dedupeWithinSheet_(inbox, 'Discovery Inbox', logs);
  const crossCount = mergeInboxDuplicatesIntoProspects_(prospects, inbox, logs);
  if (logs.length) {
    const logSheet = ensureSheetWithHeaders_(ss, OHIO_CONFIG.DUP_LOG, OHIO_CONFIG.DUP_HEADERS);
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logs.length, OHIO_CONFIG.DUP_HEADERS.length).setValues(logs);
  }
  logAutomation_('CLEANUP', 0, 0, pCount + crossCount, iCount, 0,
    'Removed exact duplicates only. Backup tabs were created before changes.');
  Logger.log('Cleanup finished. Prospects duplicates: ' + pCount + '; Inbox duplicates: ' + iCount + '; Inbox-to-Prospects duplicates: ' + crossCount);
}

function dedupeWithinSheet_(sheet, sheetName, logs) {
  const state = getSheetState_(sheet);
  const indexes = makeIndexes_([]);
  const deleteRows = [];
  let merged = 0;
  state.values.forEach(function(row, i) {
    const rowNum = i + 2;
    const entry = {sheet: sheet, sheetName: sheetName, row: rowNum, headers: state.headers, values: row, updates: {}};
    const record = {
      'OSM ID': clean_(valueByHeader_(entry, 'OSM IDs')).split(/[|;,]/)[0] || clean_(valueByHeader_(entry, 'OSM ID')),
      'Business Name': clean_(valueByHeader_(entry, 'Business Name')),
      'Address': clean_(valueByHeader_(entry, 'Address')),
      'City': clean_(valueByHeader_(entry, 'City (OH)') || valueByHeader_(entry, 'City')),
      'Phone Number': clean_(valueByHeader_(entry, 'Phone Number')),
      'Website URL': clean_(valueByHeader_(entry, 'Website URL'))
    };
    const matchInfo = findMatchDetails_(record, indexes);
    if (matchInfo.entry) {
      const keeper = matchInfo.entry;
      mergeSameSheetRows_(keeper, entry);
      deleteRows.push(rowNum);
      const name = clean_(valueByHeader_(keeper, 'Business Name'));
      logs.push(makeDuplicateLogRow_('CLEANUP_DUPLICATE', sheetName, keeper.row, sheetName, rowNum, name,
        matchInfo.method, record['OSM ID'], 'Merged missing fields; removed duplicate row.'));
      merged++;
    } else {
      registerEntry_(entry, indexes);
    }
  });
  flushCleanupUpdates_(state, sheet);
  deleteRowsDescending_(sheet, deleteRows);
  return merged;
}

function mergeSameSheetRows_(keeper, duplicate) {
  keeper.headers.forEach(function(header, i) {
    const current = keeper.values[i];
    const incoming = duplicate.values[i];
    if ((isBlank_(current) || (header === 'Public Email' && isPlaceholder_(current))) && !isBlank_(incoming)) keeper.values[i] = incoming;
  });
  const idsCol = headerCol_(keeper.headers, 'OSM IDs');
  if (idsCol) {
    const all = String(keeper.values[idsCol - 1] || '').split(/[|;,]/).map(clean_).filter(Boolean);
    String(duplicate.values[idsCol - 1] || '').split(/[|;,]/).map(clean_).filter(Boolean).forEach(function(x) {
      if (all.indexOf(x) === -1) all.push(x);
    });
    keeper.values[idsCol - 1] = all.join(' | ');
  }
}

function flushCleanupUpdates_(state, sheet) {
  const width = state.headers.length;
  state.values.forEach(function(row, i) {
    const rowNum = i + 2;
    // Only write cells whose pre-cleanup values differ, preserving formula cells.
    for (let c = 0; c < width; c++) {
      if (state.originalValues[i][c] !== row[c] && !(state.formulas[i] && state.formulas[i][c])) {
        sheet.getRange(rowNum, c + 1).setValue(row[c]);
      }
    }
  });
}

function mergeInboxDuplicatesIntoProspects_(prospects, inbox, logs) {
  const pEntries = loadIndexEntries_(prospects, 'Prospects');
  const indexes = makeIndexes_(pEntries);
  const state = getSheetState_(inbox);
  const deleteRows = [];
  let merged = 0;
  state.values.forEach(function(row, i) {
    const rowNum = i + 2;
    const source = {sheet: inbox, sheetName: 'Discovery Inbox', row: rowNum, headers: state.headers, values: row, updates: {}};
    const record = {
      'OSM ID': clean_(valueByHeader_(source, 'OSM IDs')).split(/[|;,]/)[0],
      'Business Name': clean_(valueByHeader_(source, 'Business Name')),
      'Address': clean_(valueByHeader_(source, 'Address')),
      'City': clean_(valueByHeader_(source, 'City (OH)')),
      'Industry': clean_(valueByHeader_(source, 'Industry')),
      'Postal Code': clean_(valueByHeader_(source, 'Postal Code')),
      'Website URL': clean_(valueByHeader_(source, 'Website URL')),
      'Public Email': clean_(valueByHeader_(source, 'Public Email')),
      'Phone Number': clean_(valueByHeader_(source, 'Phone Number')),
      'Email Source URL': clean_(valueByHeader_(source, 'Email Source URL')),
      'Email Type': clean_(valueByHeader_(source, 'Email Type')),
      'Email Confidence': clean_(valueByHeader_(source, 'Email Confidence'))
    };
    const matchInfo = findMatchDetails_(record, indexes);
    const match = matchInfo.entry;
    if (!match) return;
    mergeIncomingIntoEntry_(match, record);
    deleteRows.push(rowNum);
    logs.push(makeDuplicateLogRow_('CROSS_TAB_DUPLICATE', 'Prospects', match.row, 'Discovery Inbox', rowNum,
      record['Business Name'], matchInfo.method, record['OSM ID'],
      'Merged missing contact fields into existing prospect; removed inbox duplicate.'));
    merged++;
  });
  pEntries.forEach(flushEntryUpdates_);
  deleteRowsDescending_(inbox, deleteRows);
  return merged;
}

function backupSheet_(sheet, baseName) {
  const ss = getAutomationSpreadsheet_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const copy = sheet.copyTo(ss);
  copy.setName(baseName + ' ' + stamp);
}

function initializeAutomationRows_(sheet) {
  const state = getSheetState_(sheet);
  if (state.values.length === 0) return;
  const idCol = headerCol_(state.headers, 'Automation ID');
  const nameCol = headerCol_(state.headers, 'Business Name');
  const emailCol = headerCol_(state.headers, 'Public Email');
  const websiteCol = headerCol_(state.headers, 'Website URL');
  const statusCol = headerCol_(state.headers, 'Email Research Status');
  const ids = idCol ? sheet.getRange(2, idCol, state.values.length, 1).getValues() : [];
  const statuses = statusCol ? sheet.getRange(2, statusCol, state.values.length, 1).getValues() : [];
  let idsChanged = false;
  let statusesChanged = false;
  for (let i = 0; i < state.values.length; i++) {
    // Formula-filled blank template rows are not prospects; do not assign them IDs.
    if (!nameCol || isBlank_(state.values[i][nameCol - 1])) continue;
    if (idCol && isBlank_(ids[i][0])) { ids[i][0] = Utilities.getUuid(); idsChanged = true; }
    if (statusCol && isBlank_(statuses[i][0])) {
      const email = emailCol ? state.values[i][emailCol - 1] : '';
      const website = websiteCol ? state.values[i][websiteCol - 1] : '';
      statuses[i][0] = (!isBlank_(email) && !isPlaceholder_(email)) ? 'Skipped — existing email; not rechecked' : (!isBlank_(website) ? 'Pending' : 'No website available');
      statusesChanged = true;
    }
  }
  if (idsChanged) sheet.getRange(2, idCol, ids.length, 1).setValues(ids);
  if (statusesChanged) sheet.getRange(2, statusCol, statuses.length, 1).setValues(statuses);
}

function ensureHeaderColumns_(sheet, requiredHeaders) {
  let lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  requiredHeaders.forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(header);
      headers.push(header);
    }
  });
  sheet.setFrozenRows(1);
}

function ensureSheetWithHeaders_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    ensureHeaderColumns_(sheet, headers);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function getSheetState_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const formulas = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getFormulas() : [];
  return {headers: headers, values: values, originalValues: values.map(function(row){return row.slice();}), formulas: formulas};
}

function valueByHeader_(entry, header) {
  const col = headerCol_(entry.headers, header);
  return col ? entryValue_(entry, col) : '';
}
function entryValue_(entry, col) {
  return Object.prototype.hasOwnProperty.call(entry.updates || {}, col) ? entry.updates[col] : entry.values[col - 1];
}
function setEntryValue_(entry, col, value) {
  if (entry.newRecord) entry.values[col - 1] = value;
  else entry.updates[col] = value;
}
function flushEntryUpdates_(entry) {
  if (!entry || entry.newRecord || !entry.row) return;
  Object.keys(entry.updates || {}).forEach(function(col) {
    entry.sheet.getRange(entry.row, Number(col)).setValue(entry.updates[col]);
  });
}
function headerCol_(headers, name) {
  const index = headers.indexOf(name);
  return index < 0 ? 0 : index + 1;
}
function exactNameAddressKey_(name, address, city) {
  const n = normalizeName_(name);
  const a = normalizeAddress_(address);
  const c = normalizeAddress_(city);
  if (!n || !a) return '';
  const containsCity = c && (' ' + a + ' ').indexOf(' ' + c + ' ') !== -1;
  return n + '|' + (c && !containsCity ? a + ' ' + c : a);
}
function phoneAddressKey_(phone, address, city) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  if (digits.length !== 10) return '';
  const addressKey = exactNameAddressKey_('x', address, city).replace(/^x\|/, '');
  return addressKey ? digits + '|' + addressKey : '';
}
function websiteAddressKey_(website, address, city) {
  let host = clean_(website).toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  host = host.replace(/^www\./, '').replace(/:\d+$/, '');
  const addressKey = exactNameAddressKey_('x', address, city).replace(/^x\|/, '');
  return host && addressKey ? host + '|' + addressKey : '';
}

function normalizeName_(value) {
  let s = String(value || '').toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co)\b/g, ' ');
  return s.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeAddress_(value) {
  let s = String(value || '').toLowerCase().trim();
  // Remove trailing Ohio/state + ZIP details so otherwise identical addresses match.
  s = s.replace(/,\s*(oh|ohio)\s*(?:\d{5}(?:-\d{4})?)?\s*$/i, '');
  s = s.replace(/\s+\d{5}(?:-\d{4})?\s*$/i, '');
  const replacements = {street:'st', road:'rd', avenue:'ave', drive:'dr', boulevard:'blvd', lane:'ln', court:'ct', highway:'hwy', suite:'ste', unit:'ste', apartment:'apt', north:'n', south:'s', east:'e', west:'w'};
  Object.keys(replacements).forEach(function(word) { s = s.replace(new RegExp('\\b' + word + '\\b', 'g'), replacements[word]); });
  return s.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeWebsite_(value) {
  let s = clean_(value);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/\s/g, '').replace(/\/$/, '');
}
function isBlank_(value) { return value === null || value === undefined || String(value).trim() === ''; }
function isPlaceholder_(value) {
  return /^(not listed|n\/?a|not checked|unknown|none|no email|not available|-)$/i.test(clean_(value));
}
function clean_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function deleteRowsDescending_(sheet, rows) {
  rows.sort(function(a,b){return b-a;}).forEach(function(row){ sheet.deleteRow(row); });
}
function makeDuplicateLogRow_(action, keptSheet, keptRow, removedSheet, removedRow, name, method, osmId, details) {
  return [new Date(), action, keptSheet, keptRow, removedSheet, removedRow, name, method, osmId, details];
}
function appendDuplicateLog_(action, keptSheet, keptRow, removedSheet, removedRow, name, method, osmId, details) {
  const ss = getAutomationSpreadsheet_();
  const log = ensureSheetWithHeaders_(ss, OHIO_CONFIG.DUP_LOG, OHIO_CONFIG.DUP_HEADERS);
  log.appendRow(makeDuplicateLogRow_(action, keptSheet, keptRow, removedSheet, removedRow, name, method, osmId, details));
}
function logAutomation_(action, received, added, mergedP, mergedI, queueSize, notes) {
  const ss = getAutomationSpreadsheet_();
  const log = ensureSheetWithHeaders_(ss, OHIO_CONFIG.AUTO_LOG, OHIO_CONFIG.LOG_HEADERS);
  log.appendRow([new Date(), action, received, added, mergedP, mergedI, queueSize, notes || '']);
}
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

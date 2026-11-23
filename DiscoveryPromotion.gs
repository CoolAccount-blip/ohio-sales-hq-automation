/**
 * Ohio Sales HQ — automatic Discovery Inbox promotion.
 *
 * Add this as a NEW file named DiscoveryPromotion.gs to the bound Apps Script
 * project that already contains apps_script_receiver.gs.
 *
 * Run setupOhioDiscoveryPromotion() once from Apps Script. It installs one
 * six-hour trigger, removes the older promoteDiscoveryInbox trigger to prevent
 * the old completeness score being written into the Lead Score field, and runs
 * one initial pass.
 *
 * IMPORTANT:
 * - Promotion Score is a data-completeness score, not a sales-fit score.
 * - Lead Score (0-100) is deliberately left blank until Google review signals
 *   have been checked. This prevents incomplete discovery data from qualifying
 *   an email for sending.
 * - Emails are never sent by this file.
 * - Original Discovery Inbox rows are retained and marked with their result.
 */

var OHIO_DISCOVERY_PROMOTION = {
  INBOX: 'Discovery Inbox',
  PROSPECTS: 'Prospects',
  MIN_SCORE_DEFAULT: 70,
  MAX_PER_RUN: 100,
  PROMOTION_HEADERS: [
    'Discovery Source', 'Promotion Score', 'Promotion Reason', 'Promoted At',
    'Auto Qualification Status', 'Auto Qualification Reason', 'Last Auto Qualification'
  ]
};

/** Run once after adding this file. Installs the six-hour trigger and promotes the current eligible batch. */
function setupOhioDiscoveryPromotion() {
  var ss = (typeof getAutomationSpreadsheet_ === 'function')
    ? getAutomationSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Ohio Sales HQ spreadsheet before running setupOhioDiscoveryPromotion().');
  if (!ss.getSheetByName(OHIO_DISCOVERY_PROMOTION.PROSPECTS) ||
      !ss.getSheetByName(OHIO_DISCOVERY_PROMOTION.INBOX)) {
    throw new Error('Missing Prospects or Discovery Inbox. Run setupAutomation() first.');
  }
  var triggerResult = installOhioDiscoveryPromotionTrigger();
  var result = ohioAutoPromoteDiscoveryInbox_();
  Logger.log(JSON.stringify({triggers: triggerResult, promotion: result}));
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Discovery automation installed. Promoted: ' + result.promoted +
      ' | merged: ' + result.merged + ' | manual review: ' + result.review,
      'Ohio Sales HQ', 10);
  } catch (ignored) {}
  return {triggers: triggerResult, promotion: result};
}

/** Install one idempotent six-hour trigger and remove the older promoter trigger. */
function installOhioDiscoveryPromotionTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function(trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === 'promoteDiscoveryInbox' || fn === 'ohioAutoPromoteDiscoveryInbox_') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  ScriptApp.newTrigger('ohioAutoPromoteDiscoveryInbox_')
    .timeBased()
    .everyHours(6)
    .create();
  return {installed: true, intervalHours: 6, removedOlderTriggers: removed};
}

/** Trigger handler. It promotes only complete, non-duplicate local business records. */
function ohioAutoPromoteDiscoveryInbox_() {
  var result = {enabled: true, promoted: 0, merged: 0, review: 0, belowScore: 0, examined: 0};
  var settings = ohioPromotionReadSettings_();
  if (!settings.enabled) {
    result.enabled = false;
    result.reason = 'Automatic discovery promotion is paused in App Settings.';
    return result;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Another Ohio Sales HQ task is running. Discovery promotion will retry on the next scheduled run.');
  try {
    var ss = (typeof getAutomationSpreadsheet_ === 'function')
      ? getAutomationSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
    var prospects = ss && ss.getSheetByName(OHIO_DISCOVERY_PROMOTION.PROSPECTS);
    var inbox = ss && ss.getSheetByName(OHIO_DISCOVERY_PROMOTION.INBOX);
    if (!prospects || !inbox) throw new Error('Missing Prospects or Discovery Inbox.');
    if (typeof loadIndexEntries_ !== 'function' || typeof makeIndexes_ !== 'function' ||
        typeof findMatchDetails_ !== 'function' || typeof findPossibleMatch_ !== 'function' ||
        typeof mergeIncomingIntoEntry_ !== 'function' || typeof registerEntry_ !== 'function') {
      throw new Error('Current apps_script_receiver.gs helpers are missing. Update the receiver before enabling promotion.');
    }

    ohioPromotionEnsureHeaders_(prospects, OHIO_DISCOVERY_PROMOTION.PROMOTION_HEADERS);
    ohioPromotionEnsureHeaders_(prospects, [
      'Automation ID', 'OSM IDs', 'Postal Code', 'Email Source URL', 'Email Type',
      'Email Confidence', 'Email Checked At', 'Email Research Status', 'Email Research Notes',
      'Last Automation Update', 'Possible Duplicate', 'Latitude', 'Longitude'
    ]);
    ohioPromotionEnsureHeaders_(inbox, [
      'Automation ID', 'OSM IDs', 'Postal Code', 'Email Source URL', 'Email Type',
      'Email Confidence', 'Email Checked At', 'Email Research Status', 'Email Research Notes',
      'Last Automation Update', 'Possible Duplicate', 'Latitude', 'Longitude',
      'Review Status', 'Matched Prospect Row', 'Notes'
    ]);

    var prospectHeaders = prospects.getRange(1, 1, 1, prospects.getLastColumn()).getDisplayValues()[0];
    var inboxHeaders = inbox.getRange(1, 1, 1, inbox.getLastColumn()).getDisplayValues()[0];
    var inboxLastRow = inbox.getLastRow();
    if (inboxLastRow < 2) return result;
    var inboxValues = inbox.getRange(2, 1, inboxLastRow - 1, inbox.getLastColumn()).getValues();
    var indexes = makeIndexes_(loadIndexEntries_(prospects, 'Prospects'));
    var inboxCols = ohioPromotionHeaderMap_(inboxHeaders);
    var processed = 0;

    for (var i = 0; i < inboxValues.length && processed < OHIO_DISCOVERY_PROMOTION.MAX_PER_RUN; i++) {
      var sheetRow = i + 2;
      var row = inboxValues[i];
      var currentStatus = ohioPromotionText_(row[inboxCols['Review Status'] - 1]).toLowerCase();
      if (currentStatus.indexOf('promoted') === 0 ||
          currentStatus.indexOf('duplicate') === 0 ||
          currentStatus.indexOf('excluded') === 0) continue;

      processed++;
      result.examined++;
      var record = ohioPromotionReadRecord_(row, inboxHeaders);
      if (!record.business || !record.city || !record.address || !record.industry) {
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Needs Manual Review', '',
          'Missing a required field: business name, target industry, Ohio city, or street address. This row stays in Discovery Inbox.');
        result.review++;
        continue;
      }

      if (typeof isExcludedChainBusiness_ === 'function' && isExcludedChainBusiness_(record.business)) {
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Excluded — national chain', '',
          'Excluded from automatic promotion because this appears to be a national chain or big-box retailer.');
        result.review++;
        continue;
      }

      if (record.possibleDuplicate) {
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Possible Duplicate — manual review', '',
          record.possibleDuplicate);
        result.review++;
        continue;
      }

      var score = ohioPromotionScore_(record);
      var matchRecord = {
        'OSM ID': record.osmIds.split(/[|;,]/)[0] || '',
        'Business Name': record.business,
        'Industry': record.industry,
        'City': record.city,
        'Address': record.address,
        'Postal Code': record.postalCode,
        'Website URL': record.website,
        'Public Email': record.email,
        'Email Source URL': record.emailSource,
        'Email Type': record.emailType,
        'Email Confidence': record.emailConfidence,
        'Phone Number': record.phone,
        'Latitude': record.latitude,
        'Longitude': record.longitude
      };

      var exact = findMatchDetails_(matchRecord, indexes);
      if (exact.entry) {
        mergeIncomingIntoEntry_(exact.entry, matchRecord);
        if (typeof flushEntryUpdates_ === 'function') flushEntryUpdates_(exact.entry);
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Duplicate — merged into Prospects', exact.entry.row,
          'Matched an existing prospect by ' + exact.method + '. Missing contact fields were merged; no second prospect was created.');
        if (typeof appendDuplicateLog_ === 'function') {
          appendDuplicateLog_('PROMOTION_DUPLICATE_MERGE', 'Prospects', exact.entry.row,
            'Discovery Inbox', sheetRow, record.business, exact.method, matchRecord['OSM ID'],
            'Auto-promotion found an exact prospect match. Existing prospect retained.');
        }
        result.merged++;
        continue;
      }

      var possible = findPossibleMatch_(matchRecord, indexes);
      if (possible) {
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Possible Duplicate — manual review', possible.row,
          'Same normalized business name and city as an existing prospect, but the address is not an exact match. Held for review to avoid merging separate branches.');
        result.review++;
        continue;
      }

      if (score < settings.minimumScore) {
        ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
          'Review — score below threshold', '',
          'Discovery completeness score ' + score + '/100 is below the current promotion threshold of ' + settings.minimumScore + '/100. The record remains in Discovery Inbox.');
        result.belowScore++;
        continue;
      }

      var prospectValues = ohioPromotionBuildProspectRow_(prospectHeaders, record, score);
      prospects.appendRow(prospectValues);
      var prospectRow = prospects.getLastRow();
      var newEntry = {
        sheet: prospects, sheetName: 'Prospects', row: prospectRow,
        headers: prospectHeaders, values: prospectValues, newRecord: false, updates: {}
      };
      registerEntry_(newEntry, indexes);

      ohioPromotionSetStatus_(inbox, sheetRow, inboxCols,
        'Promoted to Prospects', prospectRow,
        'Automatically promoted with discovery completeness score ' + score + '/100. This is a data-completeness score, not a sales-fit score. Google review signals must be checked before email qualification.');
      result.promoted++;
    }

    if (typeof logAutomation_ === 'function') {
      logAutomation_('AUTO_PROMOTE_DISCOVERIES', result.examined, result.promoted,
        result.merged, result.review, 0,
        'Promotion threshold=' + settings.minimumScore +
        '; promoted=' + result.promoted + '; merged=' + result.merged +
        '; manual review=' + result.review + '; below threshold=' + result.belowScore + '.');
    }
  } finally {
    lock.releaseLock();
  }
  return result;
}

function ohioPromotionReadSettings_() {
  var settings = {enabled: true, minimumScore: OHIO_DISCOVERY_PROMOTION.MIN_SCORE_DEFAULT};
  try {
    var ss = (typeof getAutomationSpreadsheet_ === 'function')
      ? getAutomationSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss && ss.getSheetByName('App Settings');
    if (!sheet || sheet.getLastRow() < 2) return settings;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key === 'autoPromoteEnabled') settings.enabled = String(row[1]).toLowerCase() !== 'false';
      if (key === 'promotionMinScore') {
        var value = Number(row[1]);
        if ([70, 75, 80, 85, 90].indexOf(value) >= 0) settings.minimumScore = value;
      }
    });
  } catch (err) {
    Logger.log('Could not read App Settings for discovery promotion; using safe defaults. ' + err);
  }
  return settings;
}

function ohioPromotionReadRecord_(row, headers) {
  var h = ohioPromotionHeaderMap_(headers);
  function val(name) { return h[name] ? ohioPromotionText_(row[h[name] - 1]) : ''; }
  return {
    business: val('Business Name'), industry: val('Industry'),
    city: val('City (OH)') || val('City'), address: val('Address'),
    postalCode: val('Postal Code'), website: val('Website URL'),
    email: val('Public Email'), phone: val('Phone Number'),
    emailSource: val('Email Source URL'), emailType: val('Email Type'),
    emailConfidence: val('Email Confidence'), emailStatus: val('Email Research Status'),
    emailNotes: val('Email Research Notes'), automationId: val('Automation ID'),
    osmIds: val('OSM IDs'), latitude: val('Latitude'), longitude: val('Longitude'),
    osmTags: val('OSM Tags'), source: val('Source') || 'OpenStreetMap / Geofabrik Ohio extract',
    possibleDuplicate: val('Possible Duplicate')
  };
}

/** Score is data completeness only; it must never be copied into Lead Score. */
function ohioPromotionScore_(r) {
  var score = 0;
  if (r.industry) score += 25;
  if (r.business && r.business.length >= 2) score += 10;
  if (r.city) score += 10;
  if (r.address) score += 15;
  if (/\d{7,}/.test(String(r.phone || '').replace(/\D/g, ''))) score += 10;
  if (r.website) score += 10;
  if (ohioPromotionValidEmail_(r.email)) score += 15;
  if (r.osmIds || (r.latitude && r.longitude)) score += 5;
  return Math.min(100, score);
}

function ohioPromotionBuildProspectRow_(headers, r, score) {
  var values = new Array(headers.length).fill('');
  var h = ohioPromotionHeaderMap_(headers);
  function put(name, value) { if (h[name]) values[h[name] - 1] = value; }
  var validEmail = ohioPromotionValidEmail_(r.email);
  var subject = 'Quick question about ' + r.business;
  var body = 'Hi ' + r.business + ' team,\n\n' +
    'My name is Sam, and I\'m working on a service designed to help local businesses strengthen their online reputation and make collecting customer reviews easier.\n\n' +
    'I came across your business while researching ' + r.industry.toLowerCase() + ' businesses in ' + r.city +
    ', and wanted to reach out. I was curious how you\'re currently handling customer reviews and whether making that process easier is something you\'d be interested in.\n\n' +
    'I\'d love to show you a little more about what I\'m building if you\'re open to it.\n\nBest,\nSam';
  var reason = 'Promotion score ' + score + '/100 measures data completeness only: industry, business identity, Ohio location, address, contact data, and OSM identity/location. Google review activity has not yet been evaluated.';
  put('Business Name', r.business);
  put('City (OH)', r.city);
  put('Address', r.address);
  put('Industry', r.industry);
  put('Website URL', r.website);
  put('Has Website (Yes/No)', r.website ? 'Yes' : 'Not checked');
  put('Mobile Friendly (Yes/No/N/A)', 'N/A');
  put('Unanswered Reviews', 'Not checked');
  put('Recent Activity (Active/Stale)', 'Not checked');
  put('Public Email', validEmail ? r.email : '');
  put('Phone Number', r.phone);
  put('Contact Page (Yes/No)', 'Not checked');
  put('Recommended Service', 'Review Management Only');
  // Deliberately blank. Lead Score must come from actual business-fit/review data.
  put('Lead Score (0-100)', '');
  put('Why It Qualifies', reason);
  put('Personalized Subject Line', subject);
  put('Personalized Email Draft', body);
  put('Sales Status', 'New Prospect');
  put('Date Added', new Date());
  put('Notes', 'Source: ' + r.source + '. Promotion Score=' + score + '/100 (data completeness only). Check actual Google review signals before assigning Lead Score or approving an email.');
  put('Automation ID', r.automationId || Utilities.getUuid());
  put('OSM IDs', r.osmIds);
  put('Postal Code', r.postalCode);
  put('Email Source URL', r.emailSource);
  put('Email Type', r.emailType);
  put('Email Confidence', r.emailConfidence);
  put('Email Checked At', '');
  put('Email Research Status', r.emailStatus || (r.website ? (validEmail ? 'Done — public email found' : 'Pending') : 'No website URL available'));
  put('Email Research Notes', r.emailNotes);
  put('Last Automation Update', new Date());
  put('Possible Duplicate', '');
  put('Latitude', r.latitude);
  put('Longitude', r.longitude);
  put('Discovery Source', r.source);
  put('Promotion Score', score);
  put('Promotion Reason', reason);
  put('Promoted At', new Date());
  put('Auto Qualification Status', 'Needs Review');
  put('Auto Qualification Reason', 'Promoted based on data completeness. Actual lead score requires Google rating/review data; this record is not approved for email sending yet.');
  put('Last Auto Qualification', new Date());
  return values;
}

function ohioPromotionSetStatus_(sheet, row, h, status, matchedRow, notes) {
  if (h['Review Status']) sheet.getRange(row, h['Review Status']).setValue(status);
  if (h['Matched Prospect Row']) sheet.getRange(row, h['Matched Prospect Row']).setValue(matchedRow || '');
  if (h['Notes']) sheet.getRange(row, h['Notes']).setValue(notes || '');
  if (h['Email Research Status'] && (/^promoted/i.test(status) || /^duplicate/i.test(status))) {
    sheet.getRange(row, h['Email Research Status']).setValue(status + ' — email research is tracked on Prospects.');
  }
}

function ohioPromotionEnsureHeaders_(sheet, headers) {
  var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  headers.forEach(function(header) {
    if (current.indexOf(header) === -1) {
      sheet.getRange(1, current.length + 1).setValue(header);
      current.push(header);
    }
  });
}

function ohioPromotionHeaderMap_(headers) {
  var map = Object.create(null);
  headers.forEach(function(value, i) {
    var name = String(value || '').trim();
    if (name) map[name] = i + 1;
  });
  return map;
}
function ohioPromotionText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
function ohioPromotionValidEmail_(value) {
  var email = ohioPromotionText_(value);
  return !!email && !/^(not listed|n\/?a|not checked|unknown|none|no email|not available|-)$/i.test(email) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

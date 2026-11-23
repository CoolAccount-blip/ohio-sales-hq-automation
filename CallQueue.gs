/**
 * Ohio Sales HQ — Call Queue
 *
 * Builds a deduplicated call list from Prospects and Discovery Inbox.
 * Only records without a usable public email and with a usable phone number
 * are added. Existing call outcomes and notes are preserved across refreshes.
 *
 * Install: add this file to the bound Apps Script project, then run
 * installOhioCallQueue() once. The Command Center menu also exposes refresh.
 */

const OHIO_CALL_QUEUE = {
  SHEET: 'Call Queue',
  SOURCE_SHEETS: ['Prospects', 'Discovery Inbox'],
  HEADERS: [
    'Likelihood Score (0-100)', 'Business Name', 'Phone', 'Call', 'City', 'Address',
    'Industry', 'Company Overview / Research Notes', 'Website',
    'Suggested Call Script', 'Call Outcome', 'Call Notes',
    'Follow-up Date', 'Source Sheet', 'Source Row', 'Lead Key', 'Why This Lead Ranks Here'
  ],
  OUTCOMES: [
    'Ready to Call', 'No Answer', 'Left Voicemail', 'Spoke — Follow Up',
    'Interested', 'Not Interested', 'Wrong Number', 'Do Not Call', 'Completed'
  ]
};

function installOhioCallQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Ohio Sales HQ spreadsheet first.');
  PropertiesService.getScriptProperties().setProperty('OHIO_AUTOMATION_SPREADSHEET_ID', ss.getId());
  refreshOhioCallQueue();
  SpreadsheetApp.getUi().alert(
    'Call Queue installed',
    'Your Call Queue tab is ready. Use Ohio Sales HQ Controls → Refresh Call Queue whenever you want the latest list.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function callSelectedOhioLeadOnMac() {
  // This is a spreadsheet menu action. Use the spreadsheet currently open
  // in the user's browser, not the saved automation ID (which can point to
  // another workbook and therefore a different active tab).
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sh = ss && ss.getActiveSheet();
  if (!sh || sh.getName() !== OHIO_CALL_QUEUE.SHEET) {
    ui.alert('Open the Call Queue tab and select a lead row first.');
    return;
  }

  const row = sh.getActiveRange() ? sh.getActiveRange().getRow() : 0;
  if (row < 2) {
    ui.alert('Select a business row (not the header) in the Call Queue first.');
    return;
  }

  const phone = String(sh.getRange(row, 3).getDisplayValue() || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) {
    ui.alert('This row does not contain a usable phone number.');
    return;
  }

  let dial = digits;
  if (digits.length === 10) dial = '+1' + digits;
  else if (digits.length === 11 && digits.charAt(0) === '1') dial = '+' + digits;
  else if (phone.charAt(0) === '+') dial = '+' + digits;
  const tel = 'tel:' + dial;
  const business = String(sh.getRange(row, 2).getDisplayValue() || 'Selected business')
    .replace(/[&<>"]/g, '');
  const shownPhone = phone.replace(/[&<>"]/g, '');

  // Google Sheets' HYPERLINK() blocks tel: URLs. This user-clicked HTML link
  // hands the tel: URI to the browser, which can open the Mac's registered
  // calling app (FaceTime/Phone) when Continuity calling is configured.
  const html = '<!DOCTYPE html><html><head><base target="_blank">' +
    '<style>body{font:14px Arial,sans-serif;padding:18px;color:#172554}' +
    'a{display:inline-block;background:#1d4ed8;color:white;padding:11px 18px;' +
    'border-radius:6px;text-decoration:none;font-weight:600}' +
    '.muted{color:#64748b;font-size:12px;margin-top:14px}</style></head><body>' +
    '<h3 style="margin:0 0 8px">Call ' + business + '</h3>' +
    '<p style="margin:0 0 18px">' + shownPhone + '</p>' +
    '<a href="' + tel + '" target="_blank" rel="noopener">Open calling app</a>' +
    '<p class="muted">Your Mac may ask which app to use. Confirm the call in the app.</p>' +
    '</body></html>';

  ui.showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(340).setHeight(220),
    'Call on Mac'
  );
}

function refreshOhioCallQueue() {
  const ss = (typeof getAutomationSpreadsheet_ === 'function')
    ? getAutomationSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Could not open the Ohio Sales HQ spreadsheet.');

  const sh = ss.getSheetByName(OHIO_CALL_QUEUE.SHEET) || ss.insertSheet(OHIO_CALL_QUEUE.SHEET);
  const old = callQueueReadExisting_(sh);
  const candidates = [];
  const seen = Object.create(null);

  OHIO_CALL_QUEUE.SOURCE_SHEETS.forEach(function(sheetName, sourceOrder) {
    const source = ss.getSheetByName(sheetName);
    if (!source || source.getLastRow() < 2) return;
    const lastCol = source.getLastColumn();
    const headers = source.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const rows = source.getRange(2, 1, source.getLastRow() - 1, lastCol).getDisplayValues();

    rows.forEach(function(row, index) {
      const get = function(name) { return callQueueValue_(row, headers, name); };
      const business = get('Business Name');
      const phone = get('Phone Number');
      const email = get('Public Email');
      if (!business || !callQueueHasPhone_(phone)) return;
      if (callQueueHasEmail_(email)) return;
      if (get('Possible Duplicate')) return;
      const review = get('Review Status');
      if (sheetName === 'Discovery Inbox' && /^(promoted|duplicate|possible duplicate|excluded)/i.test(review)) return;
      const salesStatus = get('Sales Status');
      if (/do not contact|closed deal/i.test(salesStatus)) return;

      const key = callQueueKey_(business, phone, get('Address'), get('City (OH)') || get('City'));
      if (!key || seen[key]) return;
      seen[key] = true;

      const industry = get('Industry') || get('Business Type') || get('Category');
      const city = get('City (OH)') || get('City');
      const address = get('Address');
      const website = get('Website URL');
      const notes = [
        get('Notes'), get('QC Note'), get('Email Research Notes'),
        get('OSM Tags') ? 'Business listing tags: ' + get('OSM Tags') : '',
        get('Lead Score') ? 'Lead score: ' + get('Lead Score') : '',
        get('Source') ? 'Source: ' + get('Source') : ''
      ].filter(Boolean).join(' | ');
      const scoreText = get('Lead Score') || get('Score');
      const leadScore = Number(String(scoreText).replace(/[^0-9.]/g, '')) || 0;
      const fit = callQueueFitScore_({
        rating: get('Google Rating'),
        reviews: get('Review Count'),
        unanswered: get('Unanswered Reviews'),
        activity: get('Recent Activity (Active/Stale)'),
        hasWebsite: get('Has Website (Yes/No)'),
        mobile: get('Mobile Friendly (Yes/No/N/A)'),
        industry: industry,
        service: get('Recommended Service'),
        leadScore: leadScore,
        name: business
      });
      const score = fit.score;
      const overview = callQueueOverview_(business, industry, city, address, website, notes);
      const script = callQueueScript_(business, industry, city, website);
      const prior = old[key] || {};
      candidates.push({
        key: key,
        score: score,
        sourceOrder: sourceOrder,
        values: [
          score, business, phone, '', city, address, industry, overview,
          website, script, prior.outcome || 'Ready to Call', prior.notes || '',
          prior.followUp || '', sheetName, index + 2, key, fit.reason
        ]
      });
    });
  });

  // Preserve completed call records even if the source row later gains an email.
  Object.keys(old).forEach(function(key) {
    if (seen[key]) return;
    const item = old[key];
    if (item.outcome && item.outcome !== 'Ready to Call') {
      candidates.push({key: key, score: item.score || 0, sourceOrder: 2, values: item.values});
    }
  });

  candidates.sort(function(a, b) {
    const aDone = callQueueIsClosed_(a.values[10]);
    const bDone = callQueueIsClosed_(b.values[10]);
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (a.score !== b.score) return b.score - a.score;
    return a.sourceOrder - b.sourceOrder;
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, OHIO_CALL_QUEUE.HEADERS.length).setValues([OHIO_CALL_QUEUE.HEADERS]);
  if (candidates.length) {
    const values = candidates.map(function(item) { return item.values.slice(); });
    sh.getRange(2, 1, values.length, OHIO_CALL_QUEUE.HEADERS.length).setValues(values);
    candidates.forEach(function(item, i) {
      const row = i + 2;
      // Keep Phone as ordinary text. SheetDialer reads the selected phone cell
      // directly; tel: HYPERLINK formulas are not reliable in Google Sheets.
      sh.getRange(row, 3).setNumberFormat('@');
      sh.getRange(row, 4).setValue('Click Phone');
      const url = String(item.values[8] || '').trim();
      if (url) {
        const normalized = /^https?:\/\//i.test(url) ? url : 'https://' + url;
        sh.getRange(row, 9).setFormula('=HYPERLINK("' + normalized.replace(/"/g, '""') + '","Open website")');
      }
    });
    const outcomeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(OHIO_CALL_QUEUE.OUTCOMES, true)
      .setAllowInvalid(false).build();
    sh.getRange(2, 11, values.length, 1).setDataValidation(outcomeRule);
    sh.getRange(2, 13, values.length, 1).setNumberFormat('mmm d, yyyy');
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, OHIO_CALL_QUEUE.HEADERS.length)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#172554').setWrap(true);
  sh.getDataRange().setVerticalAlignment('top').setWrap(true);
  sh.setColumnWidth(1, 75);
  sh.setColumnWidth(2, 190);
  sh.setColumnWidth(3, 135);
  sh.setColumnWidth(4, 70);
  sh.setColumnWidth(5, 110);
  sh.setColumnWidth(6, 190);
  sh.setColumnWidth(7, 130);
  sh.setColumnWidth(8, 340);
  sh.setColumnWidth(9, 105);
  sh.setColumnWidth(10, 420);
  sh.setColumnWidth(11, 155);
  sh.setColumnWidth(12, 260);
  sh.setColumnWidth(13, 120);
  sh.setColumnWidth(14, 120);
  sh.setColumnWidth(15, 80);
  sh.setColumnWidth(16, 210);
  sh.setColumnWidth(17, 360);
  sh.setTabColor('#0f766e');
  if (candidates.length) sh.getRange(2, 8, candidates.length, 3).setWrap(true);
  SpreadsheetApp.flush();
  const ready = candidates.filter(function(item) { return !callQueueIsClosed_(item.values[10]); }).length;
  ss.toast('Call Queue refreshed: ' + ready + ' ready to call; ' + candidates.length + ' total records.', 'Ohio Sales HQ', 8);
  return {total: candidates.length, ready: ready};
}

function callQueueReadExisting_(sh) {
  const result = Object.create(null);
  if (sh.getLastRow() < 2) return result;
  const values = sh.getDataRange().getDisplayValues();
  const headers = values[0];
  const col = function(name) { return callQueueHeaderCol_(headers, name); };
  values.slice(1).forEach(function(row) {
    const key = col('Lead Key') ? row[col('Lead Key') - 1] : '';
    if (!key) return;
    result[key] = {
      outcome: col('Call Outcome') ? row[col('Call Outcome') - 1] : '',
      notes: col('Call Notes') ? row[col('Call Notes') - 1] : '',
      followUp: col('Follow-up Date') ? row[col('Follow-up Date') - 1] : '',
      score: col('Likelihood Score (0-100)') ? Number(row[col('Likelihood Score (0-100)') - 1]) || 0 :
        (col('Priority') ? Number(row[col('Priority') - 1]) || 0 : 0),
      values: callQueuePadRow_(row, OHIO_CALL_QUEUE.HEADERS.length)
    };
  });
  return result;
}

function callQueueFitScore_(x) {
  let score = 35;
  const reasons = [];
  const rating = Number(x.rating);
  const reviews = Number(x.reviews);
  const unanswered = Number(x.unanswered);
  const industry = String(x.industry || '').toLowerCase();
  const name = String(x.name || '').toLowerCase();

  if (x.rating && !isNaN(rating)) {
    if (rating <= 3.8) { score += 18; reasons.push('low public rating'); }
    else if (rating <= 4.2) { score += 12; reasons.push('room to improve rating'); }
    else if (rating >= 4.7) score -= 5;
  }
  if (x.reviews && !isNaN(reviews)) {
    if (reviews >= 100) { score += 14; reasons.push('substantial review volume'); }
    else if (reviews >= 30) { score += 10; reasons.push('established review history'); }
    else if (reviews >= 10) score += 5;
  }
  if (x.unanswered && !isNaN(unanswered) && unanswered >= 3) {
    score += 12; reasons.push('unanswered reviews reported');
  }
  if (/stale|inactive/i.test(String(x.activity || ''))) {
    score += 7; reasons.push('review activity appears stale');
  }
  if (/^no$/i.test(String(x.hasWebsite || ''))) {
    score += 10; reasons.push('no website listed — possible second service opportunity');
  }
  if (/^no$/i.test(String(x.mobile || ''))) {
    score += 5; reasons.push('website flagged as not mobile-friendly');
  }
  if (/plumb|hvac|roof|electric|landscap|tree service|dent|salon|auto repair|pest|cleaning|contract/i.test(industry)) {
    score += 6; reasons.push('trust- and review-sensitive service category');
  }
  if (/both/i.test(String(x.service || ''))) score += 4;
  if (/\b(inc|llc|company|co\.)\b/.test(name) && /group|holdings|national|corporate|franchise|ulta|immedia|bright now/i.test(name)) {
    score -= 12; reasons.push('possible multi-location or corporate decision process');
  }
  score += Math.min(5, Math.max(0, Number(x.leadScore) || 0) / 20);
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push('limited public signals; validate fit on the call');
  return {score: score, reason: reasons.join('; ') + '. This is a fit estimate, not a prediction of acceptance.'};
}

function callQueueOverview_(business, industry, city, address, website, notes) {
  const parts = [];
  parts.push(business + (industry ? ' is listed as a ' + industry.toLowerCase() + ' business' : ' is listed as a local business') +
    (city ? ' in ' + city : '') + '.');
  if (address) parts.push('Listed address: ' + address + '.');
  if (website) parts.push('Website is available for a quick review before calling.');
  if (notes) parts.push('Additional listing / research details: ' + notes);
  parts.push('No usable public email was found in the current prospect record, so this lead is routed here for a phone-first contact attempt.');
  return parts.join(' ');
}

function callQueueScript_(business, industry, city, website) {
  const category = industry ? industry.toLowerCase() : 'local service';
  const place = city ? ' in ' + city : ' in the area';
  let script = 'Hi, is this ' + business + '?\n\n' +
    'My name is Sam. I’m reaching out because I’m learning how independent ' + category + ' businesses' + place +
    ' manage their online reviews and customer feedback. Did I catch the right person to ask about that?\n\n' +
    'I’m working on a straightforward service that helps local businesses make it easier to request customer reviews and stay on top of responses. I wanted to ask how you currently handle that process.\n\n' +
    'A few quick questions:\n' +
    '• Do you have a process for asking customers to leave a Google review after a job or visit?\n' +
    '• Is that handled manually, or does your current software help with it?\n' +
    '• Who usually responds when a new review comes in?\n' +
    '• Is getting more consistent reviews or keeping up with responses something you’re actively trying to improve?\n\n' +
    'If it sounds relevant: Would you be open to a quick follow-up conversation so I can show you what I’m building and get your feedback?\n\n' +
    'If they are busy: No problem at all. Is there a better time to call back, or is there a preferred way to reach the person who handles this?';
  if (website) script += '\n\nBefore calling, take a quick look at the company website so you can reference one specific service they offer.';
  return script;
}

function callQueueKey_(business, phone, address, city) {
  const name = String(business || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const digits = String(phone || '').replace(/\D/g, '');
  const place = String(address || city || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!name) return '';
  return name + '|' + (digits || place);
}

function callQueuePadRow_(row, width) {
  const values = row.slice(0, width);
  while (values.length < width) values.push('');
  return values;
}

function callQueueHasPhone_(value) {
  return String(value || '').replace(/\D/g, '').length >= 7;
}

function callQueueHasEmail_(value) {
  const email = String(value || '').trim();
  if (!email) return false;
  if (/^(not listed|n\/?a|not checked|unknown|none|no email|not available|-)$/i.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function callQueueIsClosed_(value) {
  return /^(interested|not interested|wrong number|do not call|completed)$/i.test(String(value || '').trim());
}

function callQueueValue_(row, headers, name) {
  const col = callQueueHeaderCol_(headers, name);
  return col ? String(row[col - 1] || '').trim() : '';
}

function callQueueHeaderCol_(headers, name) {
  const target = String(name || '').trim().toLowerCase();
  const index = headers.map(function(value) { return String(value || '').trim().toLowerCase(); }).indexOf(target);
  return index < 0 ? 0 : index + 1;
}

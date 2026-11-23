/**
 * Ohio Sales HQ — lightweight web app.
 * Keeps Google Sheets and the existing Apps Script automation as the backend.
 * Deploy as a Web App, execute as the owner, access restricted to the owner.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('SalesHQApp')
    .setTitle('Ohio Sales HQ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getOhioSalesHQAppData() {
  const ss = getAutomationSpreadsheet_();
  const props = PropertiesService.getScriptProperties();
  const count = function(name) {
    const sh = ss.getSheetByName(name);
    return sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  };
  const settings = (typeof getEmailResearchSettings_ === 'function')
    ? getEmailResearchSettings_() : {};
  const prospects = count('Prospects');
  const inbox = count('Discovery Inbox');
  const callQueue = count('Call Queue');
  const replies = count('Reply Tracker');
  const found = Number(props.getProperty('OHIO_EMAIL_RESEARCH_TOTAL_FOUND')) || 0;
  return {
    metrics: {prospects: prospects, inbox: inbox, callQueue: callQueue, replies: replies, found: found},
    settings: {
      enabled: settings.enabled !== false,
      runsPerDay: settings.runsPerDay || 2,
      batchSize: settings.batchSize || 30,
      pagesPerSite: settings.pagesPerSite || 5,
      retryHours: settings.retryHours || 24,
      maxPerDay: settings.maxPerDay || ((settings.runsPerDay || 2) * (settings.batchSize || 30))
    },
    activity: {
      lastRun: props.getProperty('OHIO_EMAIL_RESEARCH_LAST_RUN_AT') || '',
      lastCompleted: props.getProperty('OHIO_EMAIL_RESEARCH_LAST_COMPLETED_AT') || '',
      lastBatchProcessed: Number(props.getProperty('OHIO_EMAIL_RESEARCH_LAST_BATCH_PROCESSED')) || 0,
      lastBatchFound: Number(props.getProperty('OHIO_EMAIL_RESEARCH_LAST_BATCH_FOUND')) || 0
    },
    preferences: getOhioSalesHQPreferences()
  };
}

function getOhioSalesHQLeads(query, page, pageSize) {
  const ss = getAutomationSpreadsheet_();
  const sh = ss.getSheetByName('Prospects');
  if (!sh || sh.getLastRow() < 2) return {rows: [], total: 0, page: 1, pageSize: 25};
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();
  const col = function(name) {
    const i = headers.findIndex(function(h) { return String(h).trim().toLowerCase() === name.toLowerCase(); });
    return i < 0 ? -1 : i;
  };
  const fields = {
    name: col('Business Name'), email: col('Public Email'), phone: col('Phone Number'),
    industry: col('Industry'), city: col('City (OH)') >= 0 ? col('City (OH)') : col('City'),
    status: col('Sales Status'), score: col('Lead Score'), website: col('Website URL')
  };
  const q = String(query || '').trim().toLowerCase();
  const filtered = values.filter(function(row) {
    if (!row[fields.name]) return false;
    if (!q) return true;
    return [fields.name, fields.email, fields.phone, fields.industry, fields.city, fields.status]
      .some(function(i) { return i >= 0 && String(row[i] || '').toLowerCase().indexOf(q) >= 0; });
  });
  const size = Math.max(10, Math.min(100, Number(pageSize) || 25));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  const rows = filtered.slice((current - 1) * size, current * size).map(function(row, i) {
    const val = function(index) { return index >= 0 ? String(row[index] || '') : ''; };
    return {name: val(fields.name), email: val(fields.email), phone: val(fields.phone),
      industry: val(fields.industry), city: val(fields.city), status: val(fields.status),
      score: val(fields.score), website: val(fields.website)};
  });
  return {rows: rows, total: total, page: current, pages: pages, pageSize: size};
}

function getOhioSalesHQCallLeads(query) {
  const ss = getAutomationSpreadsheet_();
  const sh = ss.getSheetByName('Call Queue');
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getDisplayValues();
  const headers = values[0];
  const col = function(name) { return headers.findIndex(function(h) { return String(h).trim().toLowerCase() === name.toLowerCase(); }); };
  const q = String(query || '').trim().toLowerCase();
  return values.slice(1).filter(function(row) {
    if (!row[col('Business Name')]) return false;
    return !q || row.some(function(v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
  }).slice(0, 150).map(function(row) {
    const val = function(name) { const i = col(name); return i >= 0 ? String(row[i] || '') : ''; };
    return {name: val('Business Name'), phone: val('Phone'), city: val('City'),
      industry: val('Industry'), score: val('Likelihood Score (0-100)'),
      outcome: val('Call Outcome'), notes: val('Call Notes')};
  });
}

function getOhioSalesHQPreferences() {
  const p = PropertiesService.getUserProperties();
  return {theme: p.getProperty('OHIO_HQ_THEME') || 'light',
    compact: p.getProperty('OHIO_HQ_COMPACT') === 'true'};
}

function saveOhioSalesHQPreferences(input) {
  input = input || {};
  const p = PropertiesService.getUserProperties();
  p.setProperty('OHIO_HQ_THEME', input.theme === 'dark' ? 'dark' : 'light');
  p.setProperty('OHIO_HQ_COMPACT', input.compact ? 'true' : 'false');
  return getOhioSalesHQPreferences();
}

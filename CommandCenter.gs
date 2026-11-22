/**
 * Ohio Sales HQ Command Center.
 *
 * Add this as a new Apps Script file named CommandCenter.gs.
 * Also add CommandCenter.html as an HTML file in the same bound project.
 * Run installOhioCommandCenter() once from the Apps Script editor.
 *
 * This file changes public-email research settings only. It never sends email.
 */

function installOhioCommandCenter() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Ohio Sales HQ spreadsheet before installing the Command Center.');
  PropertiesService.getScriptProperties().setProperty('OHIO_AUTOMATION_SPREADSHEET_ID', ss.getId());
  createOhioCommandCenterSheet_(ss);

  const triggers = ScriptApp.getProjectTriggers();
  const existing = triggers.filter(function(t) {
    return t.getHandlerFunction() === 'ohioCommandCenterOnOpen';
  });
  if (!existing.length) {
    ScriptApp.newTrigger('ohioCommandCenterOnOpen').forSpreadsheet(ss).onOpen().create();
  } else if (existing.length > 1) {
    existing.slice(1).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  }
  ohioCommandCenterOnOpen();
  SpreadsheetApp.getUi().alert(
    'Command Center installed',
    'The Command Center tab and controls are ready. Reopen the spreadsheet to see the controls menu automatically.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function ohioCommandCenterOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ohio Sales HQ Controls')
    .addItem('Open Command Center', 'openOhioCommandCenter')
    .addItem('Refresh Command Center', 'refreshOhioCommandCenter')
    .addSeparator()
    .addItem('Prioritize Next Email Research Run', 'prioritizeNextOhioEmailRun')
    .addItem('Retry Failed Email Research', 'retryFailedOhioEmailResearch')
    .addToUi();
}

function openOhioCommandCenter() {
  const html = HtmlService.createHtmlOutputFromFile('CommandCenter')
    .setTitle('Ohio Sales HQ');
  SpreadsheetApp.getUi().showSidebar(html);
  refreshOhioCommandCenter();
}

function refreshOhioCommandCenter() {
  const ss = getAutomationSpreadsheet_();
  createOhioCommandCenterSheet_(ss);
  const data = getOhioCommandCenterData();
  const sheet = ss.getSheetByName('Command Center');
  sheet.getRange('B5').setValue(data.metrics.prospects);
  sheet.getRange('D5').setValue(data.metrics.inbox);
  sheet.getRange('F5').setValue(data.metrics.pending);
  sheet.getRange('H5').setValue(data.metrics.found);
  sheet.getRange('B9').setValue(data.metrics.retries);
  sheet.getRange('D9').setValue(data.metrics.checkedNoEmail);
  sheet.getRange('F9').setValue(data.settings.enabled ? 'Running' : 'Paused');
  sheet.getRange('H9').setValue(data.settings.maxPerDay + ' max/day');
  sheet.getRange('B13').setValue(data.lastRun || 'Not run yet');
  sheet.getRange('F13').setValue(data.lastCompleted || 'Not completed yet');
  sheet.getRange('B15').setValue('Open the Ohio Sales HQ Controls menu and choose Open Command Center to adjust settings.');
  SpreadsheetApp.flush();
  return data;
}

function createOhioCommandCenterSheet_(ss) {
  let sh = ss.getSheetByName('Command Center');
  if (!sh) sh = ss.insertSheet('Command Center', 0);
  const content = [
    ['OHIO SALES HQ', '', '', '', '', '', '', ''],
    ['Your prospecting operation at a glance', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['PROSPECTS', '', 'DISCOVERY INBOX', '', 'EMAILS TO RESEARCH', '', 'PUBLIC EMAILS FOUND', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['FAILED / RETRY', '', 'CHECKED — NO EMAIL', '', 'EMAIL RESEARCH', '', 'DAILY CAPACITY', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['LAST BATCH STARTED', '', '', '', 'LAST BATCH COMPLETED', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['QUICK START', '', '', '', '', '', '', ''],
    ['1. Open Ohio Sales HQ Controls → Open Command Center.', '', '', '', '', '', '', ''],
    ['2. Adjust research frequency, batch size, website depth, and retry delay in the side panel.', '', '', '', '', '', '', ''],
    ['3. Pause research any time. Email sending remains a separate manual action.', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['Automation schedule', 'The GitHub worker checks every 3 hours. Your saved frequency controls when a batch is actually allowed to run.', '', '', '', '', '', ''],
    ['Safety', 'Only publicly displayed addresses on the business website are collected. No guessed addresses. No email is sent by this research worker.', '', '', '', '', '', '']
  ];
  sh.clear();
  sh.getRange(1,1,content.length,8).setValues(content);
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 230);
  sh.setColumnWidths(2, 7, 125);
  sh.setRowHeight(1, 36);
  sh.setRowHeight(2, 26);
  sh.getRange('A1:H1').merge().setFontSize(19).setFontWeight('bold').setBackground('#172554').setFontColor('#ffffff');
  sh.getRange('A2:H2').merge().setFontSize(10).setFontColor('#475569');
  ['A4:B4','C4:D4','E4:F4','G4:H4','A7:B7','C7:D7','E7:F7','G7:H7'].forEach(function(r) {
    sh.getRange(r).merge().setFontWeight('bold').setBackground('#e2e8f0').setFontColor('#334155');
  });
  ['A5:B5','C5:D5','E5:F5','G5:H5','A8:B8','C8:D8','E8:F8','G8:H8'].forEach(function(r) {
    sh.getRange(r).merge().setFontSize(16).setFontWeight('bold').setBackground('#f8fafc');
  });
  sh.getRange('A10:D10').merge().setFontWeight('bold').setBackground('#e2e8f0');
  sh.getRange('E10:H10').merge().setFontWeight('bold').setBackground('#e2e8f0');
  sh.getRange('A11:D11').merge();
  sh.getRange('E11:H11').merge();
  sh.getRange('A12:H12').merge().setFontWeight('bold').setFontSize(12);
  sh.getRange('A13:H15').mergeAcross();
  sh.getRange('A17:B17').setFontWeight('bold');
  sh.getRange('B17:H17').merge();
  sh.getRange('A18:B18').setFontWeight('bold');
  sh.getRange('B18:H18').merge();
  sh.getRange('A17:H18').setWrap(true);
  sh.getRange('A1:H18').setVerticalAlignment('middle');
  sh.setTabColor('#2563eb');
}

function getOhioCommandCenterData() {
  const ss = getAutomationSpreadsheet_();
  const props = PropertiesService.getScriptProperties();
  const settings = getEmailResearchSettings_();
  const metrics = {
    prospects: 0, inbox: 0, pending: 0, found: 0, retries: 0,
    checkedNoEmail: 0, noWebsite: 0
  };
  const sheets = [
    {name: OHIO_CONFIG.PROSPECTS, key: 'prospects'},
    {name: OHIO_CONFIG.INBOX, key: 'inbox'}
  ];
  sheets.forEach(function(item) {
    const sh = ss.getSheetByName(item.name);
    if (!sh || sh.getLastRow() < 2) return;
    const lastCol = sh.getLastColumn();
    const headers = sh.getRange(1,1,1,lastCol).getDisplayValues()[0];
    const vals = sh.getRange(2,1,sh.getLastRow()-1,lastCol).getDisplayValues();
    metrics[item.key] = vals.filter(function(row) {
      return ccValue_(row, headers, 'Business Name') !== '';
    }).length;
    vals.forEach(function(row) {
      if (!ccValue_(row, headers, 'Business Name')) return;
      if (ccValue_(row, headers, 'Possible Duplicate')) return;
      const email = ccValue_(row, headers, 'Public Email');
      const website = ccValue_(row, headers, 'Website URL');
      const status = ccValue_(row, headers, 'Email Research Status');
      const review = ccValue_(row, headers, 'Review Status');
      if (item.key === 'inbox' && /^(promoted|duplicate|possible duplicate|excluded)/i.test(review)) return;
      if (email && !/^(not listed|n\/a|none)$/i.test(email)) {
        metrics.found++;
      } else if (website) {
        if (/^Retry/i.test(status)) metrics.retries++;
        else if (/^Checked/i.test(status)) metrics.checkedNoEmail++;
        else if (!status || /^Pending/i.test(status) || /^Processing/i.test(status)) metrics.pending++;
      } else {
        metrics.noWebsite++;
      }
    });
  });
  return {
    settings: settings,
    metrics: metrics,
    lastRun: props.getProperty('OHIO_EMAIL_RESEARCH_LAST_RUN_AT') || '',
    lastCompleted: props.getProperty('OHIO_EMAIL_RESEARCH_LAST_COMPLETED_AT') || '',
    lastBatchFound: Number(props.getProperty('OHIO_EMAIL_RESEARCH_LAST_BATCH_FOUND')) || 0,
    lastBatchProcessed: Number(props.getProperty('OHIO_EMAIL_RESEARCH_LAST_BATCH_PROCESSED')) || 0,
    lastBatchRetry: Number(props.getProperty('OHIO_EMAIL_RESEARCH_LAST_BATCH_RETRY')) || 0,
    totalFound: Number(props.getProperty('OHIO_EMAIL_RESEARCH_TOTAL_FOUND')) || 0,
    log: getOhioCommandCenterLog_(ss)
  };
}

function saveOhioEmailResearchSettings(input) {
  input = input || {};
  const runs = Number(input.runsPerDay);
  const batch = Number(input.batchSize);
  const pages = Number(input.pagesPerSite);
  const retry = Number(input.retryHours);
  if ([1,2,3,4,6,8].indexOf(runs) < 0) throw new Error('Choose a valid runs-per-day setting.');
  if (!Number.isInteger(batch) || batch < 10 || batch > 100 || batch % 5 !== 0) throw new Error('Batch size must be 10–100 in steps of 5.');
  if (!Number.isInteger(pages) || pages < 3 || pages > 8) throw new Error('Website page depth must be between 3 and 8.');
  if ([6,12,24,48,72].indexOf(retry) < 0) throw new Error('Choose a valid retry interval.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('OHIO_EMAIL_RESEARCH_ENABLED', input.enabled ? 'true' : 'false');
  props.setProperty('OHIO_EMAIL_RESEARCH_RUNS_PER_DAY', String(runs));
  props.setProperty('OHIO_EMAIL_RESEARCH_BATCH_SIZE', String(batch));
  props.setProperty('OHIO_EMAIL_RESEARCH_PAGES_PER_SITE', String(pages));
  props.setProperty('OHIO_EMAIL_RESEARCH_RETRY_HOURS', String(retry));
  return getOhioCommandCenterData();
}

function retryFailedOhioEmailResearch() {
  return requeueOhioEmailResearch_(/^Retry/i, 'Retry — queued by user');
}

function recheckOhioNoEmailWebsites() {
  return requeueOhioEmailResearch_(/^Checked\s*[—-]\s*no public email found/i, 'Recheck — queued by user');
}

function requeueOhioEmailResearch_(statusPattern, newStatus) {
  const ss = getAutomationSpreadsheet_();
  let changed = 0;
  [OHIO_CONFIG.PROSPECTS, OHIO_CONFIG.INBOX].forEach(function(name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const lastCol = sh.getLastColumn();
    const headers = sh.getRange(1,1,1,lastCol).getDisplayValues()[0];
    const statusCol = ccHeaderCol_(headers, 'Email Research Status');
    const nameCol = ccHeaderCol_(headers, 'Business Name');
    const websiteCol = ccHeaderCol_(headers, 'Website URL');
    const emailCol = ccHeaderCol_(headers, 'Public Email');
    const updateCol = ccHeaderCol_(headers, 'Last Automation Update');
    const possibleCol = ccHeaderCol_(headers, 'Possible Duplicate');
    const reviewCol = ccHeaderCol_(headers, 'Review Status');
    if (!statusCol || !nameCol || !websiteCol) return;
    const rows = sh.getRange(2,1,sh.getLastRow()-1,lastCol).getDisplayValues();
    rows.forEach(function(row,i) {
      const status = String(row[statusCol-1] || '');
      if (!statusPattern.test(status)) return;
      if (!row[nameCol-1] || !row[websiteCol-1] || (emailCol && row[emailCol-1])) return;
      if (possibleCol && row[possibleCol-1]) return;
      if (reviewCol && name === OHIO_CONFIG.INBOX && /^(promoted|duplicate|possible duplicate|excluded)/i.test(row[reviewCol-1])) return;
      const rowNum = i + 2;
      sh.getRange(rowNum,statusCol).setValue('Pending');
      if (updateCol) sh.getRange(rowNum,updateCol).clearContent();
      changed++;
    });
  });
  if (changed) {
    PropertiesService.getScriptProperties().deleteProperty('OHIO_EMAIL_RESEARCH_LAST_RUN_AT');
    ccLogAction_('EMAIL_RESEARCH_REQUEUE', changed, 'Rows reset to Pending for the next scheduled public email research run.');
  }
  return {changed: changed, message: changed + ' website(s) queued for the next scheduled research run.'};
}

function prioritizeNextOhioEmailRun() {
  PropertiesService.getScriptProperties().deleteProperty('OHIO_EMAIL_RESEARCH_LAST_RUN_AT');
  return 'The frequency wait has been cleared. The next scheduled GitHub check can pick up pending websites.';
}

function getOhioCommandCenterLog_(ss) {
  const sh = ss.getSheetByName(OHIO_CONFIG.AUTO_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  const start = Math.max(2, sh.getLastRow() - 5);
  return sh.getRange(start,1,sh.getLastRow()-start+1,Math.min(8,sh.getLastColumn())).getDisplayValues().reverse();
}

function ccLogAction_(action, count, notes) {
  const ss = getAutomationSpreadsheet_();
  const sh = ss.getSheetByName(OHIO_CONFIG.AUTO_LOG);
  if (sh) sh.appendRow([new Date(), action, count, 0, 0, 0, 0, notes]);
}

function ccValue_(row, headers, name) {
  const col = ccHeaderCol_(headers,name);
  return col ? String(row[col-1] || '').trim() : '';
}

function ccHeaderCol_(headers, name) {
  const index = headers.map(function(h){return String(h).trim().toLowerCase();}).indexOf(String(name).trim().toLowerCase());
  return index < 0 ? 0 : index + 1;
}

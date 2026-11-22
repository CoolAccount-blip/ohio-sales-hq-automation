const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class Range {
  constructor(sheet, r, c, nr=1, nc=1) { this.sheet=sheet; this.r=r; this.c=c; this.nr=nr; this.nc=nc; }
  getValues() { return Array.from({length:this.nr},(_,i)=>Array.from({length:this.nc},(_,j)=>this.sheet.cell(this.r+i,this.c+j))); }
  getDisplayValues() { return this.getValues().map(row=>row.map(v=>v===null||v===undefined?'':String(v))); }
  getFormulas() { return Array.from({length:this.nr},(_,i)=>Array.from({length:this.nc},(_,j)=>this.sheet.formula(this.r+i,this.c+j))); }
  setValues(values) { values.forEach((row,i)=>row.forEach((v,j)=>this.sheet.setCell(this.r+i,this.c+j,v))); return this; }
  setValue(value) { this.sheet.setCell(this.r,this.c,value); return this; }
  getValue() { return this.sheet.cell(this.r,this.c); }
  getFormula() { return this.sheet.formula(this.r,this.c); }
}
class Sheet {
  constructor(name, ss) { this.name=name; this.ss=ss; this.data=[]; this.formulas=[]; }
  ensure(r,c) { while(this.data.length<r) this.data.push([]); while(this.formulas.length<r) this.formulas.push([]); for(let i=0;i<r;i++){while(this.data[i].length<c)this.data[i].push('');while(this.formulas[i].length<c)this.formulas[i].push('');} }
  cell(r,c) { this.ensure(r,c); return this.data[r-1][c-1]; }
  formula(r,c) { this.ensure(r,c); return this.formulas[r-1][c-1]; }
  setCell(r,c,v) { this.ensure(r,c); this.data[r-1][c-1]=v; }
  getRange(r,c,nr=1,nc=1) { return new Range(this,r,c,nr,nc); }
  getLastRow() { for(let r=this.data.length;r>0;r--){if(this.data[r-1].some(v=>v!==''&&v!==null&&v!==undefined) || this.formulas[r-1].some(v=>v!==''&&v!==null&&v!==undefined))return r;}return 0; }
  getLastColumn() { let max=0; for(const row of this.data){for(let c=row.length;c>0;c--){const v=row[c-1];if(v!==''&&v!==null&&v!==undefined){max=Math.max(max,c);break;}}}return max; }
  setFrozenRows(n) { this.frozen=n; }
  getName() { return this.name; }
  appendRow(row) { const n=this.getLastRow()+1; this.getRange(n,1,1,row.length).setValues([row]); }
  deleteRow(row) { this.data.splice(row-1,1); this.formulas.splice(row-1,1); }
  copyTo(ss) { const cp=ss.insertSheet('Copy '+this.name); cp.data=this.data.map(r=>r.slice()); cp.formulas=this.formulas.map(r=>r.slice()); return cp; }
  setName(name) { const old=this.name; this.name=name; delete this.ss.sheets[old]; this.ss.sheets[name]=this; }
}
class Spreadsheet {
  constructor(){this.sheets={};}
  insertSheet(name){const s=new Sheet(name,this);this.sheets[name]=s;return s;}
  getSheetByName(name){return this.sheets[name]||null;}
}
const ss = new Spreadsheet();
ss.getId = () => 'test-spreadsheet-id';
const scriptProperties = {};
const headers = ['Business Name','City (OH)','Address','Industry','Website URL','Has Website (Yes/No)','Mobile Friendly (Yes/No/N/A)','Google Rating','Review Count','Unanswered Reviews','Recent Activity (Active/Stale)','Public Email','Phone Number','Contact Page (Yes/No)','Recommended Service','Lead Score (0-100)','Why It Qualifies','Personalized Subject Line','Personalized Email Draft','Sales Status','Date Added','Last Contacted','Notes'];
const prospects = ss.insertSheet('Prospects');
prospects.getRange(1,1,1,headers.length).setValues([headers]);
const row1 = ['Axis Plumbing Inc','Parma','5533 State Road, Parma, OH 44134','Plumber','','No','N/A',4.5,10,'Not checked','Not checked','Not listed','', 'N/A','Both',90,'test','Quick question','','Ready for Approval','','',''];
const row2 = ['Axis Plumbing LLC','Parma','5533 State Rd, Parma, OH 44134','Plumber','https://axisplumbing.example','Yes','N/A',4.5,10,'Not checked','Not checked','office@axisplumbing.example','(216) 555-0100','N/A','Both',90,'duplicate','Quick question','formula result','Ready for Approval','','',''];
prospects.getRange(2,1,1,headers.length).setValues([row1]);
prospects.getRange(3,1,1,headers.length).setValues([row2]);
prospects.formulas[1][18] = '="formula body"';
prospects.setCell(2,19,'formula body');
prospects.ensure(10, 19);
prospects.formulas[9][18] = '=IF(A10=\"\",\"\",A10)';
let uuid = 0;
const context = {
  SpreadsheetApp: {getActiveSpreadsheet:()=>ss, openById:(id)=>{assert.strictEqual(id,'test-spreadsheet-id');return ss;}},
  PropertiesService: {getScriptProperties:()=>({getProperty:(key)=>Object.prototype.hasOwnProperty.call(scriptProperties,key) ? scriptProperties[key] : (key === 'WEBHOOK_SECRET' ? 'secret' : null), setProperty:(key,value)=>{scriptProperties[key]=value;}, deleteProperty:(key)=>{delete scriptProperties[key];}})},
  LockService: {getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities: {getUuid:()=>`uuid-${++uuid}`,formatDate:()=> '20261122_120000'},
  Session: {getScriptTimeZone:()=> 'UTC'},
  Logger: {log:()=>{}},
  ContentService: {createTextOutput:x=>({content:x,setMimeType:()=>({content:x})}),MimeType:{JSON:'application/json'}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/apps_script_receiver.gs','utf8'),context);
vm.runInContext(fs.readFileSync(__dirname+'/CommandCenter.gs','utf8'),context);
context.setupAutomation();
const defaultResearchSettings = context.getEmailResearchSettings_();
assert.strictEqual(defaultResearchSettings.enabled, true, 'public email research should default enabled');
assert.strictEqual(defaultResearchSettings.runsPerDay, 4, 'default research frequency should be four runs per day');
assert.strictEqual(defaultResearchSettings.batchSize, 50, 'default email research batch should be 50');
assert.strictEqual(defaultResearchSettings.pagesPerSite, 5, 'default site page depth should be five');
assert.strictEqual(defaultResearchSettings.retryHours, 24, 'default retry interval should be 24 hours');
assert.strictEqual(scriptProperties.OHIO_AUTOMATION_SPREADSHEET_ID, 'test-spreadsheet-id', 'setup should save spreadsheet ID for web app calls');
assert.strictEqual(context.getAutomationSpreadsheet_(), ss, 'web app should open target spreadsheet by saved ID');
const autoHeader = prospects.getRange(1,1,1,prospects.getLastColumn()).getDisplayValues()[0].indexOf('Automation ID') + 1;
assert.strictEqual(prospects.getRange(10,autoHeader).getValue(), '', 'blank formula-filled template rows must not receive automation IDs');
context.cleanupExistingDuplicates();
assert.strictEqual(prospects.getLastRow(),9,'duplicate row should be removed while formula-only template rows remain');
assert.strictEqual(prospects.getRange(9,19).getFormula(),'=IF(A10=\"\",\"\",A10)','formula-only template row should remain after duplicate deletion');
const afterCleanup = prospects.getRange(2,1,1,prospects.getLastColumn()).getValues()[0];
const h = prospects.getRange(1,1,1,prospects.getLastColumn()).getDisplayValues()[0];
const col = n=>h.indexOf(n)+1;
assert.strictEqual(prospects.getRange(2,col('Public Email')).getValue(),'office@axisplumbing.example','placeholder email should be replaced from duplicate row');
assert.strictEqual(prospects.getRange(2,19).getFormula(),'="formula body"','formula must be preserved during merge');
assert(ss.getSheetByName('Prospects Backup 20261122_120000'),'backup sheet should exist before cleanup');

const matched = context.ingestRecords_([{
  'OSM ID':'node:1','Business Name':'Axis Plumbing','Industry':'Plumber','City':'Parma',
  'Address':'5533 State Rd, Parma, OH 44134','Website URL':'https://axisplumbing.example',
  'Public Email':'service@axisplumbing.example','Phone Number':'216-555-0100'
}]);
assert.strictEqual(matched.added,0,'existing prospect should not be duplicated');
assert.strictEqual(matched.merged_into_prospects,1,'should merge into the existing prospect');
assert.strictEqual(prospects.getLastRow(),9);

const fresh = {
  'OSM ID':'node:2','Business Name':'New Plumbing Co','Industry':'Plumber','City':'Dayton',
  'Address':'100 Main St, Dayton, OH 45402','Website URL':'https://newplumbing.example',
  'Phone Number':'937-555-0100'
};
const added = context.ingestRecords_([fresh]);
assert.strictEqual(added.added,1,'new company should be added to Discovery Inbox');
const inbox = ss.getSheetByName('Discovery Inbox');
assert.strictEqual(inbox.getLastRow(),2);
const duplicate = context.ingestRecords_([fresh]);
assert.strictEqual(duplicate.added,0,'repeat OSM ID should not be appended');
assert.strictEqual(inbox.getLastRow(),2);
const sameNameDifferentAddress = context.ingestRecords_([{
  'OSM ID':'node:3','Business Name':'New Plumbing Co','Industry':'Plumber','City':'Dayton',
  'Address':'400 Oak St, Dayton, OH 45402','Website URL':'https://newplumbing.example'
}]);
assert.strictEqual(sameNameDifferentAddress.added,0,'same-name/city candidate must not enter the active Discovery Inbox');
assert.strictEqual(sameNameDifferentAddress.possible_duplicate_review,1,'ambiguous same-name/city candidate should be quarantined for review');
const possibleReview = ss.getSheetByName('Possible Duplicate Review');
assert.strictEqual(possibleReview.getLastRow(),2,'possible duplicate should be held in the separate review tab');
assert(possibleReview.getRange(2,colInbox('Review Status')).getValue().startsWith('Possible Duplicate'), 'same-name/city different address should be flagged in review tab');
assert.strictEqual(inbox.getLastRow(),2,'active inbox should retain only the original business record');
const queue = context.getEmailQueue_(10);
assert(queue.records.length >= 1,'website without an email should enter the queue');
const queued = queue.records.find(x=>x.business_name === 'New Plumbing Co');
assert(queued,'queue should include the new prospect website');
const saved = context.saveEmailResults_([{
  automation_id: queued.automation_id,
  email:'office@newplumbing.example',
  email_source_url:'https://newplumbing.example/contact',
  email_type:'Role-based public inbox',
  email_confidence:'High — published on official website',
  checked_at:'2026-11-22T17:00:00Z',
  status:'Done — public email found',
  note:'Public listing found; mailbox delivery has not been tested.'
}]);
assert.strictEqual(saved.updated,1,'email result should be saved to matching row');
assert.strictEqual(inbox.getRange(2,colInbox('Public Email')).getValue(),'office@newplumbing.example');
assert.strictEqual(inbox.getRange(2,colInbox('Email Research Notes')).getValue(),'Public listing found; mailbox delivery has not been tested.','research note should be saved for audit and retry context');
const phoneDuplicate = context.ingestRecords_([{
  'OSM ID':'node:4','Business Name':'Dayton Pipe Repair','Industry':'Plumber','City':'Dayton',
  'Address':'100 Main St, Dayton, OH 45402','Phone Number':'(937) 555-0100'
}]);
assert.strictEqual(phoneDuplicate.added,0,'same phone and address should be merged even when the listing name differs');
assert.strictEqual(phoneDuplicate.merged_into_inbox,1,'phone+address duplicate should merge into the existing inbox record');

// The queue should work highest lead-score Prospects first, then Discovery Inbox.
function appendScoredProspect(name, score) {
  const prospectHeaders = prospects.getRange(1,1,1,prospects.getLastColumn()).getDisplayValues()[0];
  const row = new Array(prospectHeaders.length).fill('');
  function put(header, value) {
    const index = prospectHeaders.indexOf(header);
    if (index >= 0) row[index] = value;
  }
  put('Business Name', name);
  put('Industry', 'Plumber');
  put('City (OH)', 'Cleveland');
  put('Address', '100 ' + name + ' St, Cleveland, OH 44101');
  put('Website URL', 'https://' + name.toLowerCase().replace(/[^a-z0-9]/g,'') + '.example');
  put('Public Email', '');
  put('Email Research Status', 'Pending');
  put('Automation ID', 'score-' + score);
  put('Lead Score (0-100)', score);
  prospects.appendRow(row);
}
appendScoredProspect('Lower Score Prospect', 25);
appendScoredProspect('Higher Score Prospect', 95);
scriptProperties.OHIO_EMAIL_RESEARCH_LAST_RUN_AT = '';
const prioritized = context.getEmailQueue_(40);
assert.strictEqual(prioritized.records[0].business_name, 'Higher Score Prospect', 'highest lead-score existing prospect should be researched first');
assert.strictEqual(prioritized.records[1].business_name, 'Lower Score Prospect', 'lower-scoring prospect should follow higher-scoring prospect');
assert(prioritized.records.length <= 50, 'email queue must respect the configured 50-record batch cap');
const savedSettings = context.saveOhioEmailResearchSettings({
  enabled: false, runsPerDay: 6, batchSize: 35, pagesPerSite: 7, retryHours: 12
});
assert.strictEqual(savedSettings.settings.enabled, false, 'Command Center must be able to pause research');
assert.strictEqual(savedSettings.settings.runsPerDay, 6, 'Command Center must save frequency');
assert.strictEqual(savedSettings.settings.batchSize, 35, 'Command Center must save batch size');
assert.strictEqual(savedSettings.settings.pagesPerSite, 7, 'Command Center must save website depth');
assert.strictEqual(savedSettings.settings.retryHours, 12, 'Command Center must save retry interval');
const pausedQueue = context.getEmailQueue_(50);
assert.strictEqual(pausedQueue.enabled, false, 'paused research must not dequeue websites');
console.log('Command Center settings tests passed: pause, frequency, batch size, page depth, retry interval, and queue pause are persisted.');
function colInbox(name) { return inbox.getRange(1,1,1,inbox.getLastColumn()).getDisplayValues()[0].indexOf(name)+1; }
console.log('Apps Script mock tests passed: setup, exact cleanup, formula preservation, prospect merge, inbox dedupe, fuzzy flags and email queue/result writeback.');

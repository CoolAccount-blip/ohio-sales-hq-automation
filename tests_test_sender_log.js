const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class Range {
  constructor(sheet, row, col, nRows=1, nCols=1) { this.sheet=sheet; this.row=row; this.col=col; this.nRows=nRows; this.nCols=nCols; }
  getValues() { return Array.from({length:this.nRows},(_,i)=>Array.from({length:this.nCols},(_,j)=>this.sheet.cell(this.row+i,this.col+j))); }
  getDisplayValues() { return this.getValues().map(row=>row.map(v=>v instanceof Date ? v.toISOString() : String(v ?? ''))); }
  setValues(values) { values.forEach((row,i)=>row.forEach((v,j)=>this.sheet.setCell(this.row+i,this.col+j,v))); return this; }
  setValue(value) { this.sheet.setCell(this.row,this.col,value); return this; }
}
class Sheet {
  constructor(name) { this.name=name; this.data=[]; }
  cell(r,c) { this.ensure(r,c); return this.data[r-1][c-1]; }
  setCell(r,c,v) { this.ensure(r,c); this.data[r-1][c-1]=v; }
  ensure(r,c) { while(this.data.length<r)this.data.push([]); for(let i=0;i<r;i++)while(this.data[i].length<c)this.data[i].push(''); }
  getName() { return this.name; }
  getLastRow() { for(let r=this.data.length;r>0;r--)if(this.data[r-1].some(v=>v!==''&&v!==null&&v!==undefined))return r; return 0; }
  getLastColumn() { return Math.max(0,...this.data.map(row=>row.reduce((m,v,i)=>v!==''&&v!==null&&v!==undefined?i+1:m,0))); }
  getRange(r,c,nr=1,nc=1) { return new Range(this,r,c,nr,nc); }
  getDataRange() { return new Range(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn())); }
  appendRow(row) { this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor() { this.sheets={}; }
  getSheetByName(name) { return this.sheets[name]||null; }
  insertSheet(name) { const sheet=new Sheet(name);this.sheets[name]=sheet;return sheet; }
}
const ss=new Spreadsheet();
const context={
  SpreadsheetApp:{getActiveSpreadsheet:()=>ss},
  Logger:{log:()=>{}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>'',setProperty:()=>{}})},
  Utilities:{}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/EmailSender.gs','utf8'),context);
vm.runInContext(fs.readFileSync(__dirname+'/OutreachAutomation.gs','utf8'),context);

assert.strictEqual(context.OUTBOUND_SENDING_ENABLED,true,'manual sending must remain enabled');
assert.strictEqual(context.emailSenderIsExcludedChain_('Walmart Garden Center'),true);
assert.strictEqual(context.emailSenderIsExcludedChain_('Independent Dental Studio'),false);

let history=context.emailSenderLoadSendHistory_();
const sentAt=new Date('2026-11-22T19:00:00Z');
context.emailSenderAppendSendLog_(history,'contact@sample.com','Sample Plumbing',sentAt,'Quick question about Sample Plumbing','thread-1',2,'message-1');
history=context.emailSenderLoadSendHistory_();
assert.strictEqual(context.emailSenderHasUnansweredSend_(history,'contact@sample.com','Sample Plumbing'),true);
assert.strictEqual(context.emailSenderHasUnansweredSend_(history,'contact@sample.com','Different Business'),true);

const replyAt=new Date('2026-11-23T12:00:00Z');
assert.strictEqual(context.outreachMarkEmailSendLogReply_(ss,'thread-1','contact@sample.com',replyAt,'Re: Quick question','reply-1'),true);
history=context.emailSenderLoadSendHistory_();
assert.strictEqual(context.emailSenderHasUnansweredSend_(history,'contact@sample.com','Sample Plumbing'),false);
context.emailSenderAppendSendLog_(history,'contact@sample.com','Sample Plumbing',new Date('2026-11-24T12:00:00Z'),'Follow-up','thread-2',2,'message-2');
history=context.emailSenderLoadSendHistory_();
assert.strictEqual(context.emailSenderHasUnansweredSend_(history,'contact@sample.com','Sample Plumbing'),true);

const sender=fs.readFileSync(__dirname+'/EmailSender.gs','utf8');
assert(sender.includes('emailSenderEnsureSentHistoryImported_();'));
assert(sender.includes('Import Existing Sent Outreach into Log'));
assert(sender.includes('GmailApp.sendEmail(emailAddress, subjectLine, bodyText, options)'));
console.log('Sender log tests passed: manual sends enabled; repeat contacts blocked until reply; reply unlocks one follow-up; unanswered follow-up blocks the next email.');

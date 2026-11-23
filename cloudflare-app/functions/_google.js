let cached={token:"",until:0};
const enc=b=>{let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")};
const col=n=>{let s="";while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s};
const qtab=n=>"'"+String(n).replace(/'/g,"''")+"'";
const ix=(h,n)=>h.findIndex(x=>String(x||"").trim().toLowerCase()===n.toLowerCase());
const v=(r,h,n)=>{const i=ix(h,n);return i<0?"":String(r[i]||"").trim()};
const realEmail=x=>{x=String(x||"").trim();return !!x&&!/^(not listed|n\/?a|not checked|unknown|none|no email|not available|-)$/i.test(x)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)};
const norm=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
async function token(env){
 if(cached.token&&cached.until>Date.now()+60000)return cached.token;
 if(!env.GOOGLE_SERVICE_ACCOUNT_JSON||!env.GOOGLE_SPREADSHEET_ID)throw Error("Add GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SPREADSHEET_ID in Cloudflare settings.");
 let sa;try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)}catch{throw Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain the full downloaded JSON key file.")};
 if(!sa.client_email||!sa.private_key)throw Error("Service account JSON is missing client_email or private_key.");
 const pem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""),raw=atob(pem),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const now=Math.floor(Date.now()/1000),head=enc(new TextEncoder().encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
 const claim=enc(new TextEncoder().encode(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/spreadsheets",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600})));
 const unsigned=head+"."+claim,key=await crypto.subtle.importKey("pkcs8",bytes,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned)));
 const resp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:unsigned+"."+enc(sig)})});
 const data=await resp.json();if(!resp.ok||!data.access_token)throw Error("Google authentication failed: "+(data.error_description||data.error||resp.status));
 cached={token:data.access_token,until:Date.now()+Number(data.expires_in||3600)*1000};return cached.token;
}
async function gs(env,path,opts={}){
 const t=await token(env),resp=await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)+path,{...opts,headers:{Authorization:"Bearer "+t,"Content-Type":"application/json",...(opts.headers||{})}});
 const raw=await resp.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{throw Error("Unexpected Google Sheets response.")};if(!resp.ok)throw Error(d.error?.message||"Sheets API error "+resp.status);return d;
}
export async function readTab(env,name){const d=await gs(env,"/values/"+encodeURIComponent(qtab(name)+"!A:AZ"));return d.values||[]}
async function write(env,range,values){return gs(env,"/values/"+encodeURIComponent(range)+"?valueInputOption=USER_ENTERED",{method:"PUT",body:JSON.stringify({majorDimension:"ROWS",values})})}
async function clear(env,range){return gs(env,"/values/"+encodeURIComponent(range)+":clear",{method:"POST",body:"{}"})}
async function ensureTab(env,name,headers){
 const d=await gs(env,"?fields=sheets.properties.title"),names=(d.sheets||[]).map(s=>s.properties.title);
 if(!names.includes(name))await gs(env,":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{addSheet:{properties:{title:name}}}]})});
 if(headers){let rows=[];try{rows=await readTab(env,name)}catch{}if(!rows.length||!rows[0].some(Boolean))await write(env,qtab(name)+"!A1:"+col(headers.length)+"1",[headers])}
}
export async function getSettings(env){
 let rows=[];try{rows=await readTab(env,"App Settings")}catch{}
 const s={enabled:true,runsPerDay:2,batchSize:30,pagesPerSite:5,retryHours:24,autoPromoteEnabled:true,promotionMinScore:70};
 rows.slice(1).forEach(r=>{
  const k=String(r[0]||"").trim(),value=String(r[1]||"").trim();
  if(k==="enabled")s.enabled=value.toLowerCase()!=="false";
  if(["runsPerDay","batchSize","pagesPerSite","retryHours"].includes(k))s[k]=Number(value)||s[k];
  if(k==="autoPromoteEnabled")s.autoPromoteEnabled=value.toLowerCase()!=="false";
  if(k==="promotionMinScore"&&[70,75,80,85,90].includes(Number(value)))s.promotionMinScore=Number(value);
 });return s;
}
export async function saveSettings(env,input){
 const s={enabled:!!input.enabled,runsPerDay:Number(input.runsPerDay),batchSize:Number(input.batchSize),pagesPerSite:Number(input.pagesPerSite),retryHours:Number(input.retryHours),autoPromoteEnabled:!!input.autoPromoteEnabled,promotionMinScore:Number(input.promotionMinScore)};
 if(![1,2,3,4,6,8].includes(s.runsPerDay)||!Number.isInteger(s.batchSize)||s.batchSize<10||s.batchSize>100||s.batchSize%5||!Number.isInteger(s.pagesPerSite)||s.pagesPerSite<3||s.pagesPerSite>8||![6,12,24,48,72].includes(s.retryHours)||![70,75,80,85,90].includes(s.promotionMinScore))throw Error("One or more research or promotion settings are invalid.");
 await ensureTab(env,"App Settings",["Setting","Value"]);const rows=await readTab(env,"App Settings");
 for(const [k,val] of Object.entries(s)){const i=rows.slice(1).findIndex(r=>String(r[0]||"")===k);if(i>=0)await write(env,qtab("App Settings")+"!B"+(i+2),[[val]]);else await gs(env,"/values/"+encodeURIComponent(qtab("App Settings")+"!A:B")+":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",{method:"POST",body:JSON.stringify({majorDimension:"ROWS",values:[[k,val]]})})}
 return s;
}
export async function dashboard(env){
 const [p,d,c,s]=await Promise.all([readTab(env,"Prospects"),readTab(env,"Discovery Inbox"),readTab(env,"Call Queue").catch(()=>[]),getSettings(env)]);
 const m={prospects:Math.max(0,p.length-1),inbox:Math.max(0,d.length-1),found:0,pending:0,callQueue:Math.max(0,c.length-1)};
 [p,d].forEach(rows=>{if(!rows.length)return;const h=rows[0];rows.slice(1).forEach(r=>{if(!v(r,h,"Business Name")||v(r,h,"Possible Duplicate"))return;if(realEmail(v(r,h,"Public Email")))m.found++;else if(v(r,h,"Website URL")&&!/^Checked|^Skipped/i.test(v(r,h,"Email Research Status")))m.pending++})});
 return{ok:true,metrics:m,settings:s,activity:{lastRun:"Existing research automation",lastCompleted:"See Automation Log"}};
}
function discoveryCompleteness_(r,h){
 let score=0;
 if(v(r,h,"Industry"))score+=25;
 if(v(r,h,"Business Name").length>=2)score+=10;
 if(v(r,h,"City (OH)")||v(r,h,"City"))score+=10;
 if(v(r,h,"Address"))score+=15;
 if(String(v(r,h,"Phone Number")).replace(/\\D/g,"").length>=7)score+=10;
 if(v(r,h,"Website URL"))score+=10;
 if(realEmail(v(r,h,"Public Email")))score+=15;
 if(v(r,h,"OSM IDs")||(v(r,h,"Latitude")&&v(r,h,"Longitude")))score+=5;
 return Math.min(100,score);
}
export async function discoveries(env,query,page,size){
 const [rows,settings]=await Promise.all([readTab(env,"Discovery Inbox"),getSettings(env)]);
 if(!rows.length)return{ok:true,rows:[],total:0,page:1,pages:1,summary:{eligible:0,promoted:0,review:0}};
 const h=rows[0],q=String(query||"").trim().toLowerCase(),minScore=settings.promotionMinScore||70;
 const fields=["Business Name","Industry","City (OH)","City","Address","Phone Number","Website URL","Public Email","Review Status","Notes"];
 const all=rows.slice(1).map((r,i)=>{
  const name=v(r,h,"Business Name"),city=v(r,h,"City (OH)")||v(r,h,"City"),review=v(r,h,"Review Status"),possible=v(r,h,"Possible Duplicate");
  const score=discoveryCompleteness_(r,h);
  const required=!!name&&!!city&&!!v(r,h,"Address")&&!!v(r,h,"Industry");
  let state="Eligible for next check";
  if(/^promoted/i.test(review))state="Promoted to Prospects";
  else if(/^duplicate/i.test(review))state="Duplicate — merged";
  else if(/^excluded/i.test(review))state="Excluded";
  else if(possible||/^possible duplicate/i.test(review))state="Manual duplicate review";
  else if(!required)state="Missing required details";
  else if(score<minScore)state="Below completeness threshold";
  else if(!settings.autoPromoteEnabled)state="Automatic promotion paused";
  return{rowNumber:i+2,name,city,address:v(r,h,"Address"),industry:v(r,h,"Industry"),phone:v(r,h,"Phone Number"),website:v(r,h,"Website URL"),email:v(r,h,"Public Email"),score,reviewStatus:review||"Needs Review",status:state,notes:v(r,h,"Notes"),source:v(r,h,"Source"),possibleDuplicate:possible};
 }).filter(x=>x.name);
 const summary={
  eligible:all.filter(x=>x.status==="Eligible for next check").length,
  promoted:all.filter(x=>x.status==="Promoted to Prospects").length,
  review:all.filter(x=>/Manual|Missing|Below/.test(x.status)).length
 };
 const filtered=all.filter(x=>!q||fields.some(k=>{
  const value=k==="City (OH)"||k==="City"?x.city:(k==="Review Status"?x.reviewStatus:k==="Notes"?x.notes:x[k==="Business Name"?"name":k==="Industry"?"industry":k==="Address"?"address":k==="Phone Number"?"phone":k==="Website URL"?"website":k==="Public Email"?"email":""]);
  return String(value||"").toLowerCase().includes(q);
 }));
 size=Math.max(10,Math.min(100,Number(size)||25));const pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.max(1,Math.min(pages,Number(page)||1));
 return{ok:true,total:filtered.length,page,pages,pageSize:size,settings,summary,rows:filtered.slice((page-1)*size,page*size)};
}
export async function leads(env,query,page,size){
 const rows=await readTab(env,"Prospects");if(!rows.length)return{ok:true,rows:[],total:0,page:1,pages:1};
 const h=rows[0],q=String(query||"").trim().toLowerCase();
 const fields=["Business Name","Public Email","Phone Number","Industry","City (OH)","City","Sales Status","Lead Score (0-100)","Lead Score","Website URL","Address"];
 const records=rows.slice(1).map((r,i)=>({r,rowNumber:i+2})).filter(x=>v(x.r,h,"Business Name")&&(!q||fields.some(k=>v(x.r,h,k).toLowerCase().includes(q))));
 size=Math.max(10,Math.min(100,Number(size)||25));const pages=Math.max(1,Math.ceil(records.length/size));page=Math.max(1,Math.min(pages,Number(page)||1));
 const city=ix(h,"City (OH)")>=0?"City (OH)":"City";
 const get=(r,...names)=>{for(const name of names){const value=v(r,h,name);if(value)return value;}return "";};
 return{ok:true,total:records.length,page,pages,pageSize:size,rows:records.slice((page-1)*size,page*size).map(({r,rowNumber})=>({
  rowNumber,name:get(r,"Business Name"),email:get(r,"Public Email"),phone:get(r,"Phone Number"),industry:get(r,"Industry"),city:get(r,city),address:get(r,"Address"),
  status:get(r,"Sales Status"),score:get(r,"Lead Score (0-100)","Lead Score"),website:get(r,"Website URL"),
  hasWebsite:get(r,"Has Website (Yes/No)"),mobileFriendly:get(r,"Mobile Friendly (Yes/No/N/A)"),rating:get(r,"Google Rating"),
  reviewCount:get(r,"Review Count"),unansweredReviews:get(r,"Unanswered Reviews"),recentActivity:get(r,"Recent Activity (Active/Stale)"),
  contactPage:get(r,"Contact Page (Yes/No)"),recommendedService:get(r,"Recommended Service"),qualificationReason:get(r,"Why It Qualifies"),
  subject:get(r,"Personalized Subject Line"),emailDraft:get(r,"Personalized Email Draft"),dateAdded:get(r,"Date Added"),lastContacted:get(r,"Last Contacted"),notes:get(r,"Notes"),
  emailResearchStatus:get(r,"Email Research Status"),emailResearchNotes:get(r,"Email Research Notes"),emailSourceUrl:get(r,"Email Source URL"),
  emailType:get(r,"Email Type"),emailConfidence:get(r,"Email Confidence"),autoQualificationStatus:get(r,"Auto Qualification Status"),autoQualificationReason:get(r,"Auto Qualification Reason")
 }))};
}
export async function calls(env,query){
 const [rows,prospects,inbox]=await Promise.all([
  readTab(env,"Call Queue").catch(()=>[]),
  readTab(env,"Prospects").catch(()=>[]),
  readTab(env,"Discovery Inbox").catch(()=>[])
 ]);
 if(!rows.length)return{ok:true,rows:[],total:0};
 const h=rows[0],q=String(query||"").trim().toLowerCase();
 const sourceWebsite=(sheetName,rowNumber)=>{
  const source=sheetName==="Prospects"?prospects:(sheetName==="Discovery Inbox"?inbox:[]);
  const row=source[Number(rowNumber)-1],headers=source[0]||[];
  return row?v(row,headers,"Website URL"):"";
 };
 const a=rows.slice(1).map((r,i)=>{
  const sourceSheet=v(r,h,"Source Sheet"),sourceRow=v(r,h,"Source Row");
  const sheetWebsite=v(r,h,"Website");
  const website=/^https?:\/\//i.test(sheetWebsite)?sheetWebsite:sourceWebsite(sourceSheet,sourceRow);
  return{
   rowNumber:i+2,name:v(r,h,"Business Name"),phone:v(r,h,"Phone"),city:v(r,h,"City"),address:v(r,h,"Address"),
   industry:v(r,h,"Industry"),score:v(r,h,"Likelihood Score (0-100)"),overview:v(r,h,"Company Overview / Research Notes"),
   website,script:v(r,h,"Suggested Call Script"),outcome:v(r,h,"Call Outcome"),notes:v(r,h,"Call Notes"),
   followUp:v(r,h,"Follow-up Date"),leadKey:v(r,h,"Lead Key"),sourceSheet,sourceRow,
   whyRanksHere:v(r,h,"Why This Lead Ranks Here")
  };
 }).filter(x=>x.name&&(!q||[x.name,x.phone,x.city,x.industry,x.outcome,x.address].some(t=>String(t||"").toLowerCase().includes(q))));
 return{ok:true,rows:a,total:a.length};
}

export async function saveCall(env,x){
 const rows=await readTab(env,"Call Queue");if(!rows.length)throw Error("Call Queue is empty.");
 const h=rows[0],key=String(x.leadKey||""),i=ix(h,"Lead Key"),at=rows.slice(1).findIndex(r=>i>=0&&String(r[i]||"").trim()===key);if(at<0)throw Error("Lead not found. Refresh the call queue.");
 const outcome=String(x.outcome||"Ready to Call"),allowed=["Ready to Call","No Answer","Left Voicemail","Spoke — Follow Up","Interested","Not Interested","Wrong Number","Do Not Call","Completed"];
 if(!allowed.includes(outcome))throw Error("Invalid call outcome.");const n=at+2,notes=String(x.notes||"").slice(0,3000),follow=String(x.followUp||"");
 const data=[];for(const [name,value] of [["Call Outcome",outcome],["Call Notes",notes],["Follow-up Date",follow]]){const c=ix(h,name);if(c>=0)data.push({range:qtab("Call Queue")+"!"+col(c+1)+n,values:[[value]]})}
 await gs(env,"/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"USER_ENTERED",data})});return{ok:true};
}
function rank(r,h){
 let s=35,why=[];const rating=Number(v(r,h,"Google Rating")),reviews=Number(v(r,h,"Review Count")),industry=(v(r,h,"Industry")||v(r,h,"Business Type")||"").toLowerCase();
 if(v(r,h,"Google Rating")){if(rating<=3.8){s+=18;why.push("low public rating")}else if(rating<=4.2){s+=12;why.push("room to improve rating")}else if(rating>=4.7)s-=5}
 if(reviews>=100){s+=14;why.push("substantial review volume")}else if(reviews>=30){s+=10;why.push("established review history")}else if(reviews>=10)s+=5;
 if(Number(v(r,h,"Unanswered Reviews"))>=3){s+=12;why.push("unanswered reviews reported")}
 if(/stale|inactive/i.test(v(r,h,"Recent Activity (Active/Stale)"))){s+=7;why.push("review activity stale")}
 if(/^no$/i.test(v(r,h,"Has Website (Yes/No)"))){s+=10;why.push("no website listed")}
 if(/^no$/i.test(v(r,h,"Mobile Friendly (Yes/No/N/A)"))){s+=5;why.push("site not mobile-friendly")}
 if(/plumb|hvac|roof|electric|landscap|tree service|dent|salon|auto repair|pest|cleaning|contract/i.test(industry)){s+=6;why.push("review-sensitive category")}
 if(/both/i.test(v(r,h,"Recommended Service")))s+=4;
 s=Math.max(0,Math.min(100,Math.round(s)));return{s,why:why.join("; ")||"limited public signals"};
}
export async function refreshCalls(env){
 const heads=["Likelihood Score (0-100)","Business Name","Phone","Call","City","Address","Industry","Company Overview / Research Notes","Website","Suggested Call Script","Call Outcome","Call Notes","Follow-up Date","Source Sheet","Source Row","Lead Key","Why This Lead Ranks Here"];
 const [p,d,current]=await Promise.all([readTab(env,"Prospects"),readTab(env,"Discovery Inbox"),readTab(env,"Call Queue").catch(()=>[])]);
 const oldH=current[0]||heads,old=new Map();current.slice(1).forEach(r=>{const k=v(r,oldH,"Lead Key");if(k)old.set(k,r)});
 const seen=new Set(),out=[];
 [["Prospects",p],["Discovery Inbox",d]].forEach(([sheet,rows])=>{if(!rows.length)return;const h=rows[0];rows.slice(1).forEach((r,i)=>{
  const name=v(r,h,"Business Name"),phone=v(r,h,"Phone Number"),email=v(r,h,"Public Email"),city=v(r,h,"City (OH)")||v(r,h,"City"),address=v(r,h,"Address");
  if(!name||String(phone).replace(/\D/g,"").length<7||realEmail(email)||v(r,h,"Possible Duplicate"))return;
  if(sheet==="Discovery Inbox"&&/^(promoted|duplicate|possible duplicate|excluded)/i.test(v(r,h,"Review Status")))return;
  if(/do not contact|closed deal/i.test(v(r,h,"Sales Status")))return;
  const digits=String(phone).replace(/\D/g,""),key=norm(name)+"|"+(digits||norm(address||city));if(seen.has(key))return;seen.add(key);
  const prior=old.get(key)||[],industry=v(r,h,"Industry")||v(r,h,"Business Type")||v(r,h,"Category"),website=v(r,h,"Website URL"),rating=rank(r,h);
  const sourceLeadScore=v(r,h,"Lead Score (0-100)")||v(r,h,"Lead Score");const notes=[v(r,h,"Notes"),v(r,h,"QC Note"),v(r,h,"Email Research Notes"),sourceLeadScore?"Lead score: "+sourceLeadScore:""].filter(Boolean).join(" | ");
  const category=industry?industry.toLowerCase():"local service",place=city?" in "+city:" in the area";
   let script="Hi, is this "+name+"?\n\nMy name is Sam. I’m reaching out because I’m learning how independent "+category+" businesses"+place+" manage their online reviews and customer feedback. Did I catch the right person to ask about that?\n\nI’m working on a straightforward service that helps local businesses make it easier to request customer reviews and stay on top of responses. I wanted to ask how you currently handle that process.\n\nA few quick questions:\n• Do you have a process for asking customers to leave a Google review after a job or visit?\n• Is that handled manually, or does your current software help with it?\n• Who usually responds when a new review comes in?\n• Is getting more consistent reviews or keeping up with responses something you’re actively trying to improve?\n\nIf it sounds relevant: Would you be open to a quick follow-up conversation so I can show you what I’m building and get your feedback?\n\nIf they are busy: No problem at all. Is there a better time to call back, or is there a preferred way to reach the person who handles this?";
   if(website)script+="\n\nBefore calling, take a quick look at the company website so you can reference one specific service they offer.";
  const overview=name+(industry?" is listed as a "+industry.toLowerCase():" is listed as a local business")+(city?" in "+city:"")+". "+(address?"Listed address: "+address+". ":"")+(website?"Website is available for a quick review before calling. ":"")+(notes?"Additional listing / research details: "+notes+" ":"")+"No usable public email was found in the current prospect record, so this lead is routed here for a phone-first contact attempt.";
   out.push([rating.s,name,phone,"",city,address,industry,overview,website,script,v(prior,oldH,"Call Outcome")||"Ready to Call",v(prior,oldH,"Call Notes"),v(prior,oldH,"Follow-up Date"),sheet,i+2,key,rating.why+". Fit estimate, not a prediction of acceptance."]);
 })});
 out.sort((a,b)=>{const ca=/^(interested|not interested|wrong number|do not call|completed)$/i.test(a[10]),cb=/^(interested|not interested|wrong number|do not call|completed)$/i.test(b[10]);return ca!==cb?(ca?1:-1):b[0]-a[0]});
 await ensureTab(env,"Call Queue",heads);await clear(env,qtab("Call Queue")+"!A2:Q"+Math.max(2,current.length));if(out.length)await write(env,qtab("Call Queue")+"!A2:Q"+(out.length+1),out);
 return{ok:true,total:out.length,ready:out.filter(r=>!(/^(interested|not interested|wrong number|do not call|completed)$/i.test(r[10]))).length};
}

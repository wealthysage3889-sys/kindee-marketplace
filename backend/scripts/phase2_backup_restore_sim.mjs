import { writeFileSync } from 'node:fs';

// Synthetic isolated in-memory DB simulation
const DB = { profiles:[], stores:[], conversations:[], conversation_members:[], messages:[], message_attachments:[], call_history:[] };

function reset(){ for(const k of Object.keys(DB)) DB[k]=[]; }

// Seed synthetic data
function seed(){
  reset();
  DB.profiles.push({id:'p-admin'},{id:'p-custA'},{id:'p-custB'},{id:'p-ownerA'},{id:'p-ownerB'},{id:'p-mgr'},{id:'p-staff'});
  DB.stores.push({id:'s-A',owner_id:'p-ownerA'},{id:'s-B',owner_id:'p-ownerB'});
  DB.conversations.push(
    {id:'c-1',type:'store_customer',store_id:'s-A',customer_id:'p-custA'},
    {id:'c-2',type:'store_customer',store_id:'s-A',customer_id:'p-custA'}, // duplicate
    {id:'c-3',type:'store_customer',store_id:'s-B',customer_id:'p-custB'},
    {id:'c-4',type:'direct',store_id:null,customer_id:null}
  );
  DB.conversation_members.push(
    {id:'m1',conversation_id:'c-1',profile_id:'p-custA'},
    {id:'m2',conversation_id:'c-1',profile_id:'p-ownerA'},
    {id:'m3',conversation_id:'c-2',profile_id:'p-custA'},
    {id:'m4',conversation_id:'c-2',profile_id:'p-ownerA'},
    {id:'m5',conversation_id:'c-3',profile_id:'p-custB'},
    {id:'m6',conversation_id:'c-3',profile_id:'p-ownerB'}
  );
  DB.messages.push(
    {id:'msg1',conversation_id:'c-1',sender_id:'p-custA',content:'hi'},
    {id:'msg2',conversation_id:'c-2',sender_id:'p-ownerA',content:'dup msg'},
    {id:'msg3',conversation_id:'c-3',sender_id:'p-custB',content:'hello'}
  );
  DB.message_attachments.push({id:'a1',message_id:'msg1',file_url:'u1',file_name:'f1',file_size:10,mime_type:'text/plain'});
  DB.call_history.push({id:'call1',conversation_id:'c-1',caller_id:'p-custA',callee_id:'p-ownerA',status:'ended'});
}

seed();
const preCounts = Object.fromEntries(Object.keys(DB).map(k=>[k,DB[k].length]));
console.log('PRE COUNTS', preCounts);

// Backup: serialize
const backup = JSON.parse(JSON.stringify(DB));
writeFileSync('C:/Users/LEGION/AppData/Local/Temp/kilo/backup.json', JSON.stringify(backup));

// Restore into new isolated DB
const restored = JSON.parse(JSON.stringify(backup));
// verify counts
const postCounts = Object.fromEntries(Object.keys(restored).map(k=>[k,restored[k].length]));
console.log('POST COUNTS', postCounts);
let countOk = Object.keys(preCounts).every(k=>preCounts[k]===postCounts[k]);
console.log('COUNT MATCH:', countOk);

// FK integrity
function fkCheck(d){
  const convIds=new Set(d.conversations.map(x=>x.id));
  const msgIds=new Set(d.messages.map(x=>x.id));
  const profIds=new Set(d.profiles.map(x=>x.id));
  const errs=[];
  for(const m of d.conversation_members){
    if(!convIds.has(m.conversation_id)) errs.push('member orphan conv '+m.id);
    if(!profIds.has(m.profile_id)) errs.push('member orphan profile '+m.id);
  }
  for(const m of d.messages){
    if(!convIds.has(m.conversation_id)) errs.push('msg orphan conv '+m.id);
    if(!profIds.has(m.sender_id)) errs.push('msg orphan sender '+m.id);
  }
  for(const a of d.message_attachments){
    if(!msgIds.has(a.message_id)) errs.push('attach orphan msg '+a.id);
  }
  for(const c of d.call_history){
    if(c.conversation_id && !convIds.has(c.conversation_id)) errs.push('call orphan conv '+c.id);
    if(!profIds.has(c.caller_id)) errs.push('call orphan caller '+c.id);
    if(!profIds.has(c.callee_id)) errs.push('call orphan callee '+c.id);
  }
  for(const c of d.conversations){
    if(c.store_id && !d.stores.some(s=>s.id===c.store_id)) errs.push('conv orphan store '+c.id);
    if(c.customer_id && !profIds.has(c.customer_id)) errs.push('conv orphan customer '+c.id);
  }
  return errs;
}
console.log('FK ERRORS (restored):', fkCheck(restored));

// Forward recovery test for migration 011: duplicate merge
// Simulate: keep c-1, remove c-2, re-point members/messages/calls
const beforeConv = restored.conversations.length;
// re-point c-2 -> c-1
restored.conversation_members.forEach(m=>{ if(m.conversation_id==='c-2') m.conversation_id='c-1'; });
restored.messages.forEach(m=>{ if(m.conversation_id==='c-2') m.conversation_id='c-1'; });
restored.call_history.forEach(c=>{ if(c.conversation_id==='c-2') c.conversation_id='c-1'; });
// delete duplicate conv
restored.conversations = restored.conversations.filter(c=>c.id!=='c-2');
console.log('CONV COUNT before/after merge:', beforeConv, restored.conversations.length);
console.log('FK ERRORS (post-merge):', fkCheck(restored));

// Restore from backup scenario: restore deleted conv from backup into temp table, verify
const recovery = JSON.parse(JSON.stringify(backup)).conversations.find(c=>c.id==='c-2');
console.log('RECOVERED CONV FROM BACKUP:', recovery);
// partial re-point check: count members referencing removed id in restored (should be 0)
const orphanMembers = restored.conversation_members.filter(m=>m.conversation_id==='c-2');
console.log('ORPHAN MEMBERS after merge (expect 0):', orphanMembers.length);

// Unique duplicate groups check
const groups = {};
for(const c of restored.conversations){
  if(c.type==='store_customer' && c.customer_id){
    const key=c.customer_id+'|'+c.store_id;
    groups[key]=(groups[key]||0)+1;
  }
}
const dupGroups = Object.entries(groups).filter(([,n])=>n>1);
console.log('DUPLICATE GROUPS (expect []):', dupGroups);

writeFileSync('C:/Users/LEGION/AppData/Local/Temp/kilo/result.json', JSON.stringify({preCounts,postCounts,countOk,mergeConvBefore:beforeConv,mergeConvAfter:restored.conversations.length,dupGroups},null,2));
console.log('DONE');

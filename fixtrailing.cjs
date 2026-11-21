const fs = require('fs');
const p = 'supabase/migrations/016_consolidated_chat_schema_drift.sql';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/\n" filePath=.*$/s, '');
fs.writeFileSync(p, s);
console.log('done');
" filePath="C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\fixtrailing.cjs
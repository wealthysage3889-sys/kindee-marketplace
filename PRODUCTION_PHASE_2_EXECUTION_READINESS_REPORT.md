# PRODUCTION PHASE 2 EXECUTION READINESS REPORT

**Project:** kindee-marketplace
**Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`
**Branch:** `main` (ahead of `origin/main` by 1 commit — `b5dbfb6`)
**Production Supabase Ref:** `bzkjtvsqqxnbbnkgcrko` (per user confirmation)
**Render service:** `kindee-marketplace-api`
**Date:** 2026-11-18
**Scope:** Readiness review only — no migration, no DML, no credential change, no link/unlink, no commit/push/deploy.

> **ข้อจำกัดของการตรวจในงานนี้:** เครื่องนี้ไม่มี `psql` / `pg_dump` และ Docker daemon ไม่ทำงานอยู่ (`docker` CLI อยู่ แต่ `dockerDesktopLinuxEngine` ปิด) จึงไม่มีการรัน SQL ใด ๆ กับ PostgreSQL จริง ทุกข้อผูกพันของ SQL อ้างอิงจาก static analysis เทียบกับ schema ใน `001`–`004` และระบุไว้ชัดว่าจุดใดต้องยืนยันบน Staging ก่อนจึงจะถือว่าผ่าน

---

## 0. EXECUTIVE VERDICT

| # | รายการ | Verdict |
|---|---|---|
| 1 | ตรวจ git status / diff / untracked (ไม่ทำลายงานเดิม) | **PASS** |
| 2 | Migration `010_store_memberships.sql` | **FAIL** (BLOCKER × 1, HIGH × 1) |
| 3 | Migration `011_conversation_customer_id.sql` | **FAIL** (BLOCKER × 1, HIGH × 2, MED × 6) |
| 4 | FK / RLS / Trigger / Index / ผลกระทบข้อมูลเดิม | **FAIL** (ตรวจครบแล้ว แต่ยังต้องแก้ 011 ก่อนอนุมัติ) |
| 5 | ความเสี่ยงการรวม/ลบ Conversations ซ้ำ + การรักษาประวัติ Chat/Call | **FAIL** (ยังไม่ปลอดภัย) |
| 6 | Backup / Restore / Rollback สำหรับ Production | **BLOCKED** (ไม่มี backup ที่ยืนยันแล้ว, 011 ย้อนไม่ได้) |
| 7 | แผนทดสอบ RLS แยกตาม Platform Admin / Owner / Manager / Staff / Customer | **PASS (แผน)** / **BLOCKED (การรัน — ยังไม่มี Staging)** |
| 8 | แผนทดสอบ Chat / Attachments / Read Receipts / Socket / Voice Call 2 บัญชี | **PASS (แผน)** / **BLOCKED (การรัน — ยังไม่มี Staging)** |
| 9 | ลำดับการดำเนินงานปลอดภัย + เงื่อนไขอนุมัติ | **PASS (จัดทำในเอกสารนี้)** |
| — | **ความพร้อมรัน Migration บน Production** | **BLOCKED — ห้ามรัน** |

**สรุปสั้น:** โครงสร้างงาน Phase 2 ถูกต้องในระดับการออกแบบ แต่ **SQL ของทั้ง 010 และ 011 จะ error เมื่อรัน** และขั้น merge ของ 011 เป็น *destructive + irreversible* ขณะเดียวกันยังไม่มี backup จริงที่ยืนยันได้ และไม่มี Staging จึงยังข้ามสู่ Production ไม่ได้ ต้องทำ Step 1–5 ก่อน (ดูหัวข้อ 8)

---

## 1. ข้อห้ามที่ถือปฏิบัติ (Constraints honored)

| ข้อห้าม | สถานะ |
|---|---|
| ไม่รัน Migration / `db push` | ถือ — ไม่มีการเรียก `supabase` CLI, `psql`, หรือ SQL ใด ๆ |
| ไม่ INSERT/UPDATE/DELETE ข้อมูลจริง | ถือ — ไม่มีการเชื่อมต่อ DB ใด ๆ |
| ไม่เปลี่ยน Environment / Credentials | ถือ — ไม่อ่านค่า secret, ไม่แก้ไข `.env*` |
| ไม่ Link/Unlink Supabase CLI ไปยัง Production | ถือ — ออกจาก CLI ใน state เดิม (ดูข้อ 2.4) |
| ไม่ Commit / Push / Deploy | ถือ — working tree คงเดิมทั้งหมด |
| ไม่ลบประวัติ Chat / Call | ถือ — ไม่มีการลบ/แก้ข้อมูล |
| สร้างรายงานนี้เท่านั้น |ไฟล์เดียวที่เขียน: `PRODUCTION_PHASE_2_EXECUTION_READINESS_REPORT.md` |

---

## 2. ผลการตรวจ git (ข้อ 1 ของงาน)

### 2.1 สถานะ

```
## main...origin/main [ahead 1]
 M .gitignore
 M backend/controllers/messageController.js
 M backend/services/callService.js
 M backend/services/chatService.js
 M backend/services/socketService.js
 M frontend/src/api/auth.js
D  supabase/.temp/cli-latest
D  supabase/.temp/gotrue-version
D  supabase/.temp/linked-project.json
D  supabase/.temp/pooler-url
D  supabase/.temp/postgres-version
D  supabase/.temp/project-ref
D  supabase/.temp/rest-version
D  supabase/.temp/storage-migration
D  supabase/.temp/storage-version
?? (38 ไฟล์)
```

- **modified (unstaged):** 6 ไฟล์
- **staged deletions:** 9 ไฟล์ (`supabase/.temp/*`) — เป็น metadata ของ Supabase CLI
- **untracked:** 38 ไฟล์
- **ไม่มี staged modification** และไม่มี stash / reset / checkout ใด ๆ

### 2.2 การแก้ไขเดิมที่ต้องรักษา (ห้ามทิ้ง)

| ไฟล์ | สรุป | ความเห็น |
|---|---|---|
| `.gitignore` |  เพิ่ม `backend/__check_*.cjs`, `**/__check_*.cjs`, `supabase/.temp/` | เหมาะสม — กันเปิดเผยไฟล์เช็ก credential และ metadata ของ CLI |
| `backend/controllers/messageController.js` | `populated?.[0] \|\| message` + ตัด `emitNewMessage` ที่ซ้ำ | ถูกต้อง (chatService ส่ง `newMessage` เองอยู่แล้ว) |
| `backend/services/callService.js` | `heartbeatCall` เรียก membership revalidation; `initiateCall` ส่ง `callee_id` | ถูกต้อง — ป้องกัน heartbeat ต่อจาก conversation ที่ไม่ใช่สมาชิก |
| `backend/services/chatService.js` | `getOrCreateConversation` ใช้ `customer_id` ฝั่ง server, fast path, fallback, retry 23505, บล็อก owner ที่ทักร้านตัวเอง | ถูกต้องตามทิศทาง **แต่ต้องพึ่ง unique index ที่ยังไม่มี** (011) |
| `backend/services/socketService.js` | typing/callSignal/joinCall revalidate membership; `joinStore` เฉพาะ owner | ถูกต้อง — ลดช่องว่างฝั่ง realtime |
| `frontend/src/api/auth.js` | social config cache + single-flight | แยกจากงาน Phase 2, ปลอดภัย |

### 2.3 ข้อสังเกตเรื่องความสะอาดของ repo

- `regression_output.txt`, `regression_test_output.txt` เป็น untracked **และไม่ถูก `.gitignore` ครอบคลุม** → `git add -A` จะดึงเข้า commit โดยไม่ตั้งใจ ควรเพิ่มเข้า `.gitignore`
- `backend/.env`, `backend/.env.test`, `.env.local`, `frontend/.env` อยู่ในเครื่อง แต่ `.gitignore` มี `.env*` ครอบไว้แล้ว → **ไม่รั่วไหล**
- ไม่พบไฟล์ `backend/__check_*.cjs` ในเครื่อง (มีแต่กฎ ignore)
- `supabase/audit_discount_price.sql`, `supabase/promote_admin.sql` เป็นไฟล์ tracked ที่อยู่นอก `migrations/` → ควรย้าย/จัดเก็บให้ชัดเจนใน Phase 3

### 2.4 สถานะ Supabase CLI

- `supabase/.temp/` ถูกลบแบบ staged และ `.gitignore` ใหม่ ignore แล้ว → ไฟล์ `linked-project.json` / `project-ref` ไม่ปรากฏอีก
- ไม่มี `supabase/config.toml` ในคลังงาน → CLI ไม่ถูก link ไปุณProject ใด และไม่สามารถ `db push` ได้โดยไม่ `init`/`link` ก่อน
- สรุป: **อยู่ในสถานะ unlinked พอดี** ตรงตามข้อห้าม (ไม่ต้องแก้อะไรเพิ่ม)

**Verdict ข้อ 1: PASS**

---

## 3. ตรวจ Migration 010 และ 011 แบบละเอียด

### 3.1 `010_store_memberships.sql` (190 บรรทัด, untracked)

**เจตนา:** ตาราง `store_memberships` (owner/manager/staff + permissions JSONB + audit fields), owner backfill, role CHECK, partial unique index, RLS 4 ตัว, ห้าม sole-owner ย้าย/ลบตัวเอง

#### 🔴 BLOCKER-1 — RLS policy ใช้ `OLD` / `NEW` ที่ PostgreSQL ไม่มี

- `010:116-136` — `store_memberships_update` … `WITH CHECK ( OLD.role = 'owner' AND NEW.role != 'owner' …)`
- `010:137-172` — manager branch ใช้ `OLD.*` ซ้ำอีกหลายจุด
- `010:178-190` — `store_memberships_delete` … `USING ( … OLD.role = 'owner' …)`

PostgreSQL **ไม่มี** `OLD` / `NEW` ใน RLS policy expression (มีได้เฉพาะใน trigger) การอ้างอิงจะถูก reject ตอน `CREATE POLICY` เsinceเอง เพราะ expression ถูก parse/analyze ทันที

```
ERROR:  missing FROM-clause entry for table "old"
```

ผลลัพธ์: 010 จะ **abort ที่บรรทัด 101** ทันที ตาราง `store_memberships` ถูกสร้างและ RLS ถูกเปิดไว้ แต่ไม่มี policy เลย (fail-closed → ใช้ไม่ได้ทุกกรณี) เนื่องจากไม่มีโค้ดใดใน repo อ้างอิง `store_memberships` (มีเฉพาะในไฟล์ test)
จึงยังไม่กระทบ runtime ของแอป แต่ **migration ตัวนี้ไม่ผ่าน**

> หมายเหตุ: เงื่อนไข "ป้องกัน sole owner" ไม่สามารถเขียนด้วย RLS policy ได้ ต้องย้ายไปเป็น `BEFORE UPDATE` / `BEFORE DELETE` trigger หรือ SECURITY DEFINER function ที่ policy เรียกใช้

#### 🟠 HIGH-1 — policy อ้างอิงตารางตัวเอง (self-reference) → infinite recursion

- `010:70-74` — `store_memberships_select` มี `SELECT 1 FROM store_memberships sm …`
- `010:85-90` — `store_memberships_insert` มี subquery ต่อ `store_memberships`
- `010:108-113`, `010:139-144` — `store_memberships_update` เหมือนกัน

เมื่อ policy บน table T มี subquery ต่อ T ตัวเอง PostgreSQL จะรายงาน `infinite recursion detected in policy for relation "store_memberships"` (SQLSTATE 42P17) ตอน query — แม้ policy จะสร้างผ่านไปได้

- ทางแก้ที่กลืนไปกับโค้ดเดิม: 002 ใช้ `SECURITY DEFINER` helper ไว้แล้ว (`002:41-54` เช่น `is_admin_or_owner()`) → ให้เพิ่ม `is_store_owner(store_id, uid)`, `is_active_store_manager(store_id, uid, need_member_write)` แบบ `SECURITY DEFINER` + `SET search_path`
- แsinceโน้มด้านเดียวกันนี้มีอยู่แล้วใน `002:66` และ `002:77` (profiles policies ที่ subquery ต่อ profiles) — เป็น "หนี้สิน" ที่ยังไม่ถูกใช้ในทางปฏิบัติ และเป็นกรณีศึกษาที่ควรแก้พร้อมกัน

#### 🟠 HIGH-2 — cast `jsonb ->> 'member_write'` เป็น boolean แบบไม่ปลอดภัย

`010:90`, `010:113`, `010:144`: `(sm.permissions->>'member_write')::boolean = true`
หาก `permissions` เป็น `NULL`, เป็น `{}` หรือ `member_write` เป็นสตริงที่ไม่ใช่ `true/false` จะได้ `NULL` หรือ `invalid input syntax for type boolean` → policy พังแบบไม่ทันตั้งตัว ควรใช้ helper `jsonb_boolean(permissions, 'member_write')` ที่ครอบ `CASE`/`jsonb_typeof`

#### 🟡 MED-1 — ไม่มี `created_at` / `updated_at` และไม่มี index บน `role`

ตารางไม่มี timestamp สำหรับ audit และ `suspended_by` / `removed_by` ไม่มี index (ยังไม่กระทบ, ระบุไว้เพื่อความครบถ้วน)

#### 🟡 MED-2 — 010 เป็น schema ลอย ๆ ไม่มีเส้นทางใช้งาน

- ไม่มีโค้ด backend/frontend ใดอ้าง `store_memberships` (ตรวจแล้วมีเฉพาะ `backend/__tests__/phase2_remediation.test.mjs`)
- RLS ของ `conversations` ยังให้เฉพาะ **store owner** (`002:633-640`) — manager/staff จึงไม่เห็น conversation ของร้านแม้จะมี membership
- `getStoreConversations` ตรวจเฉพาะ `stores.owner_id` (`chatService.js:730-741`) → manager/staff ใช้ API นี้ไม่ได้
- สรุป: **010 ยังไม่มี consumer** → การรันบน Production ตอนนี้ให้ประโยชน์ 0 แต่มีความเสี่ยง migration/downtime → ควรเลื่อนไปพร้อม Phase 3 ที่มี endpoint + policy ครบ

#### ✅ จุดที่ถูกต้องของ 010

- idempotent ด้วย `IF NOT EXISTS` / `DROP POLICY IF EXISTS` ครบ
- partial unique index `ux_store_memberships_active (store_id, profile_id) WHERE left_at IS NULL` (`010:54-55`) ถูกต้อง
- role CHECK (`010:49`) ถูกต้องและมาก่อน backfill จึงไม่ขัดแย้ง
- owner backfill เป็น INSERT แบบ NOT EXISTS (`010:34-41`) → idempotent และไม่กระทบข้อมูลเดิม
- 010 เป็น **additive ล้วน ๆ** ไม่มีการอ่าน/แก้/ลบข้อมูลเดิมใน table อื่น

**Verdict 010: FAIL (ต้องยังไม่รัน)**

---

### 3.2 `011_conversation_customer_id.sql` (111 บรรทัด, untracked)

**เจตนา:** เพิ่ม `conversations.customer_id`, backfill จาก `conversation_members`, merge conversation ซ้ำต่อ (customer, store), unique index, role check, เปิด RLS ซ้ำ

#### 🔴 BLOCKER-1 — merge ชน UNIQUE constraint ของ `conversation_members`

`011:70-72`:

```sql
UPDATE conversation_members
SET conversation_id = keep_id
WHERE conversation_id = ANY(remove_ids);
```

แต่ `001:543` กำหนด `UNIQUE (conversation_id, profile_id)` ไว้ที่ `conversation_members`

Conversation แบบ `store_customer` ทุกอันมี member ชุดเดียวกัน คือ **เจ้าของร้านเป็น `admin`** และ **ลูกค้าเป็น `member`** ดังนั้นเมื่อย้ายแถวจาก `remove_ids` ไป `keep_id` จะเกิด `duplicate key value violates unique constraint "conversation_members_conversation_id_profile_id_key"` ทันที

- นี่คือ **กรณีที่ migration นี้มีอยู่เพื่อจัดการ** ดังนั้นมันจะพังในสถานการณ์ที่ควรทำงาน — merge ทำได้ก็แถวไหนที่ไม่มี member ซ้ำ และ guest ที่แปลก ๆ
- seed ใน `backend/__tests__/phase2_remediation.test.mjs:204-209` มีสมาชิกซ้ำทั้ง owner และ customer พอดี → บน Postgres จริงจะ error ทันที
- ต้องแก้เป็น merge แบบ upsert: `INSERT … ON CONFLICT (conversation_id, profile_id) DO UPDATE SET unread_count = GREATEST(...), last_read_at = LEAST(...), left_at = COALESCE(...)` แล้ว `DELETE` ของเดิม

**นี่คือเหตุผลหลักที่ทำให้ 011 ยังไม่ผ่าน**

#### 🟠 HIGH-1 — เงื่อนไข "unambiguous" ของ backfill ใช้ไม่ได้จริง

`011:21-31`:

```sql
GROUP BY cm.conversation_id, cm.profile_id
HAVING COUNT(*) = 1
```

เพราะ `UNIQUE (conversation_id, profile_id)` ทำให้ทุก group มี `COUNT(*) = 1` เสมอ → `HAVING` นี้ **ไม่ได้กรองอะไรเลย** หาก conversation หนึ่ง ๆ มี non-owner ที่ active มากกว่า 1 คน (เช่น legacy group ที่ type ถูกตั้งเป็น `store_customer`) คำสั่ง `UPDATE … FROM` จะจับคู่ได้หลายแถวต่อ conversation เดียว และ PostgreSQL จะเลือกแบบ **ไม่มีการรับประกัน (arbitrary)** → `customer_id` ผิด

ผลต่อเนื่องอันตราย: `customer_id` ผิดเข้าสู่ unique index + ขั้น merge → เสี่ยงเอา conversation ของลูกค้าคนอื่นมารวมกัน (กระทบความเป็นส่วนตัว)

ต้องแก้ด้วย window function เช่น

```sql
COUNT(*) OVER (PARTITION BY cm.conversation_id) AS member_count
```

แล้วเลือกเฉพาะ `member_count = 1`

#### 🟠 HIGH-2 — merge ไม่คำนวณ `last_message_at` ใหม่

`003:335-349` (`update_conversation_last_message`) เป็น `AFTER INSERT` เท่านั้น การ re-point `messages` จึงไม่อัปเดต `conversations.last_message_at` และ `updated_at` ของ `keep_id` ผลคือ conversation ที่ถูกรวมแล้วจะ **หายไปจากลำดับบนของ chat list** หรือถูกแทนที่ด้วยข้อความเก่า ต้องเพิ่มการอัปเดต `last_message_at = max(created_at)` ของ `keep_id` ท้าย block

#### 🟡 MED-1 — backfill ข้าม conversation ที่ลูกค้าออกไปแล้ว

`011:26-29` บังคับ `cm.left_at IS NULL` → conversation ที่ลูกค้าออกไปแล้ว (`left_at`) จะไม่ถูก backfill ค้างเป็น `NULL` ตลอดไป และ partial unique index (011:92-94) ไม่ครอบ `NULL` → duplicate กลับมาได้อีกโดยที่ index ไม่ได้ช่วย (แอปจะไป fallback ทาง membership ซึ่งลูกค้าที่ออกแล้วก็ไม่ใช่สมาชิก → สร้างใหม่)

#### 🟡 MED-2 — ไม่ re-point `notifications` (deep-link ค้าง)

`notifications.related_id` เป็น UUID เปล่าไม่มี FK และ `notifications.data` เป็น JSONB ที่อาจมี `conversation_id` → conversation ที่ถูกลบจะทิ้ง deep-link ที่แตะแล้วไม่พบ (ไม่มี error ที่ DB แต่เป็นประสบการณ์ผู้ใช้เสีย)

#### 🟡 MED-3 — `ALTER TABLE conversation_members ADD CONSTRAINT … CHECK` ยังไม่มีการตรวจข้อมูลเดิม

`011:100-107` กำหนด `CHECK (role IN ('member','admin','owner'))` แต่ไม่มีขั้นตรวจว่าเดิมมี ค่า นอก set นี้ไหม หากมีจะ error ระหว่าง migration และทำ table lock ทั้งตาราง (ACCESS EXCLUSIVE + full scan) — ต้องรัน SELECT นับก่อนเสมอบน Production

#### 🟡 MED-4 — index แบบ non-concurrent ล็อกการเขียน `conversations` / `conversation_members` / `messages`

`011:92-97` (`CREATE UNIQUE INDEX` / `CREATE INDEX`) ราวกับทั้ง 3 ตาราง ต้องใช้ `CREATE INDEX CONCURRENTLY` ซึ่งรันในตัว migration transaction ไม่ได้ → ต้องแยกเป็นขั้น manual ในช่วง low-traffic เท่านั้น

#### 🟡 MED-5 — `ADD COLUMN … REFERENCES` ล็อก ACCESS EXCLUSIVE (สั้น)

`011:12` เป็น metadata-only จึงไม่ทำ table rewrite แต่ยังต้องหยุด write สั้น ๆ — ยอมรับได้ แต่ต้องรู้ในช่วง maintenance window

#### 🟡 MED-6 — พฤติกรรม product เปลี่ยน (ต้องมี sign-off)

Unique index `(customer_id, store_id)` หมายความว่า **ลูกค้าหนึ่งคนมีห้องเดียวกับร้านหนึ่งร้าน แม้จะมีหลายคำสั่งซื้อ** ขณะที่ `conversations.store_order_id` (`001:517`) เคยแยกตามคำสั่งซื้อได้ → ต้องยืนยันว่าเป็นพฤติกรรมที่ต้องการ เพราะเป็นการเปลี่ยน UX ไม่ใช่แค่ security

#### 🟡 MED-7 — เจ้าของร้านที่ซื้อของในร้านอื่นจะถูก backfill ข้าม

`NOT EXISTS (SELECT 1 FROM stores s WHERE s.owner_id = cm.profile_id)` ตัดทุกโปรไฟล์ที่เป็นเจ้าของร้านใดก็ออก → ผู้ใช้ที่เป็นทั้งเจ้าของร้านและลูกค้าจะได้ `customer_id = NULL` ตลอดไป

#### ✅ จุดที่ถูกต้องของ 011

- `ADD COLUMN IF NOT EXISTS` idempotent ถูกต้อง
- FK `customer_id → profiles(id) ON DELETE SET NULL` ถูกต้อง
- partial unique index ถูกต้องสำหรับ `customer_id IS NOT NULL`
- re-point `messages` และ `call_history` ก่อน DELETE ถูกต้อง (ดูหัวข้อ 4)
- RLS enable ซ้ำเป็น no-op ที่ไม่มีผลเสีย

**Verdict 011: FAIL (ต้องยังไม่รัน)**

---

### 3.3 สรุปผลกระทบต่อเดิม

| หมวด | 010 | 011 |
|---|---|---|
| เขียนทับ / แก้ไข / ลบแถวเดิม | ไม่มี | มี — merge ลบ `conversations` ซ้ำ (ย้อนกลับไม่ได้) |
| กระทบ `messages` | ไม่มี | ย้าย `conversation_id` (ข้อความคงอยู่) |
| กระทบ `message_attachments` | ไม่มี | คงอยู่ (ผูกกับ `messages`, ไม่ต้อง re-point) |
| กระทบ `call_history` | ไม่มี | ย้าย `conversation_id` (ประวัติคงอยู่) |
| กระทบ read state | ไม่มี | เสีย —แถว member ซ้ำถูกแทนที่ด้วยแถวของ `keep_id` |
| ต้องมี maintenance window | ไม่ | ใช่ |

---

## 4. FK / RLS / Trigger / Index / ผลกระทบข้อมูล

### 4.1 Foreign Keys ที่เกี่ยวข้อง

| FK | แบบ | ผลต่อ 010/011 |
|---|---|---|
| `store_memberships.store_id → stores(id)` | `ON DELETE CASCADE` | ลบร้าน → membership หาย (ถูกต้อง) |
| `store_memberships.profile_id → profiles(id)` | `ON DELETE CASCADE` | ลบโปรไฟล์ → membership หาย |
| `store_memberships.suspended_by / removed_by → profiles(id)` | `ON DELETE SET NULL` | เหมาะสม |
| `conversations.store_id → stores(id)` | `ON DELETE CASCADE` | ลบร้าน → conversation + messages + attachments หายทั้งชุด |
| `conversations.customer_id → profiles(id)` | `ON DELETE SET NULL` | ลบบัญชีลูกค้า → conversation ยังอยู่แต่ไม่มีลูกค้าเทียบ |
| `conversation_members.conversation_id → conversations(id)` | `ON DELETE CASCADE` | **ต้อง re-point ก่อน DELETE เท่านั้น** |
| `messages.conversation_id → conversations(id)` | `ON DELETE CASCADE` | **ถ้าไม่ re-point = ข้อความหาย + attachments หายตาม** |
| `message_attachments.message_id → messages(id)` | `ON DELETE CASCADE` | attachments ไม่มี FK ต่อ conversation → ปลอดภัยถ้า message ถูกย้าย |
| `call_history.conversation_id → conversations(id)` | `ON DELETE SET NULL` | ถ้าไม่ re-point = ประวัติคงอยู่แต่ "หลุด" จากห้อง (ยังกู้คืนได้) |

**ข้อสรุปสำคัญ:** re-point ใน 011 เป็นเงื่อนไขบังคับ ไม่ใช่ทางเลือก เพราะ `messages` เป็น `ON DELETE CASCADE` → หาก re-point ล้มเหลวครึ่งเดียว ข้อความและไฟล์แนบจะเสียและไม่มี FK อะไรเตือน

### 4.2 RLS ที่เกี่ยวข้อง

| Policy | ไฟล์:บรรทัด | ผลต่อ 010/011 |
|---|---|---|
| `conversations` SELECT 3 ตัว | `002:618-644` | สมาชิก / เจ้าของร้าน / admin เท่านั้น (manager/staff ยังมองไม่เห็น → ช่องว่างที่ต้องแก้ใน Phase 3) |
| `conversation_members` | `002:650-688` | สมาชิกในเครือเดียวกัน + admin ของห้อง |
| `messages` | `002:694-738` | สมาชิกดูได้, ผู้ส่งแก้/ลบได้, admin ลบได้ |
| `message_attachments` | `002:744-764` | ผ่าน parent message; upload ต้องเป็น sender ของ message |
| `call_history` | `002:786-790` | เฉพาะ caller/callee |
| `storage.objects` (chat-attachments) | `004:172-197` | อ่านผ่าน `conversation_members` + `messages` + `message_attachments` |
| `store_memberships` (ใหม่) | `010:61-190` | **ไม่สามารถใช้งานได้** ตาม BLOCKER-1/HIGH-1 |

### 4.3 Trigger ที่กระทบข้อมูลหลังการ merge

| Trigger | ไฟล์:บรรทัด | พฤติกรรมเมื่อ re-point |
|---|---|---|
| `update_conversation_last_message` | `003:347-349` | **ไม่ทำงาน** (AFTER INSERT เท่านั้น) → ต้องอัปเดตด้วยมือ |
| `increment_unread_count` | `003:368-370` | ไม่ทำงาน → `unread_count` ของ `keep_id` ค้างเป็นค่าเดิม |
| `reset_unread_count` | `003:382-384` | ทำงานเมื่อ `last_read_at` เปลี่ยนเท่านั้น → read state ที่รวมกันอาจคลาดเคลื่อน |
| `update_conversations_updated_at` | `003:47` | ทำงาน → ต้องตั้ง `updated_at` ให้สอดคล้อง |

### 4.4 Index

| Index | สถานะ |
|---|---|
| `ux_store_memberships_active` | ใหม่, ถูกต้อง, partial ถูกต้อง |
| `idx_store_memberships_store/profile/active` | ใหม่, ครบ (ขาด index บน `role` เท่านั้น) |
| `ux_conversations_store_customer` | ใหม่, partial ถูกต้อง; **แต่ non-concurrent → ล็อก write** |
| `idx_conversations_customer_id` | ใหม่, ครบ |
| `idx_conversations_store_id` / `_last_message_at` | เดิม, ยังใช้ได้ |

---

## 5. ความเสี่ยงการรวม/ลบ Conversations ซ้ำ และการรักษาประวัติ Chat/Call

### 5.1 เมทริกซ์การรักษาประวัติ (กรณี re-point ทำงานสำเร็จ)

| ข้อมูล | ผลหลัง merge | ระดับ |
|---|---|---|
| ข้อความ (`messages`) | คงอยู่ครบ (ย้าย `conversation_id`) | ✅ ปลอดภัย |
| ไฟล์แนบ (`message_attachments`) | คงอยู่ครบ (ผูกกับ message) | ✅ ปลอดภัย |
| ออบเจ็กต์ใน Storage | ไม่สูญหาย (แถวตารางคงอยู่) | ✅ ปลอดภัย |
| ประวัติการโทร (`call_history`) | คงอยู่ + คงความเชื่อมโยงกับห้อง | ✅ ปลอดภัย |
| สถานะอ่าน/จำนวน unread | **เสีย** — แถวซ้ำถูกแทนที่ด้วยแถวของ `keep_id` | ⚠️ เสี่ยง |
| Deep-link จาก `notifications` | ค้างเป็นห้องที่ถูกลบ | ⚠️ เสี่ยง |
| ตัวห้อง (`conversations` แถบที่ถูกลบ) | **หาย ถาวร** | 🔴 ต้องใช้ backup เท่านั้น |
| ID ห้องที่ลูกค้าเปิดค้างไว้ | ได้ 404/403 จนกว่าจะ refresh | ⚠️ ต่ำ |

### 5.2 ความเสี่ยงที่ต้องจัดการก่อนอนุมัติ

1. **ย้อนกลับไม่ได้** — `DELETE FROM conversations` ไม่มี soft delete และไม่มี archive table → ต้องสร้าง `conversations_merge_archive` หรือเก็บสำเนาแถวไว้ใน transaction เดียวกันก่อน DELETE
2. **สูญเสีย read state** — ต้อง merge `unread_count = GREATEST(...)` และ `last_read_at = LEAST(...)`
3. **ลำดับการแสดงผลเพี้ยน** — ต้อง re-calculate `last_message_at`
4. **race กับการใช้งานจริง** — ต้อง freeze write ที่ `conversations`/`messages`/`conversation_members` ตลอด migration (maintenance window)
5. **unique violation ระหว่าง merge** (BLOCKER-1) — ต้องทำเป็น upsert ไม่ใช่ UPDATE ล้วน
6. **การรันไม่ครบ** — ถ้า migration runner ไม่ได้ wrap ทุกอย่างใน transaction เดียว จะทิ้งสถานะกึ่งกลาง; ต้องยืนยัน
7. **ต้องมี backup ที่กู้คืนได้จริงก่อนเสมอ** (ดูหัวข้อ 6) — ตอนนี้ยังไม่มี

---

## 6. Backup / Restore / Rollback — ใช้ได้กับ Production จริงหรือไม่

### 6.1 สิ่งที่มีอยู่

| เอกสาร/ไฟล์ | คุณภาพ |
|---|---|
| `PHASE_2_BACKUP_RESTORE_PLAN.md` | แผนที่ดี (ลำดับ FK, checkpoint, stop condition) |
| `PHASE_2_FORWARD_RECOVERY_PLAN.md` | ถูกต้อง — ยอมรับว่า 011 ย้อนกลับไม่ได้ |
| `backend/scripts/phase2_backup_restore_sim.mjs` | **เป็น simulation ของแถว JSON ใน memory** ไม่ใช่ `pg_dump`/`pg_restore` → PASS ที่ได้เป็นเพียง "โค้ดตรรกะถูก" |
| `PHASE_2_BACKUP_RESTORE_TEST_REPORT.md` | ระบุเsinceง "in-memory simulation, ไม่มี postgres client" ตรงกับข้อเท็จจริง |

### 6.2 เครื่องมือที่มีในเครื่อง (ตรวจแล้ว)

| เครื่องมือ | สถานะ |
|---|---|
| `supabase` CLI | ✅ มี (`%APPDATA%\npm\supabase.ps1`) — แต่ยังไม่ `init`/`link` (ไม่มี `config.toml`, `.temp` ว่าง) |
| `psql` / `pg_dump` | ❌ ไม่มี → **ทำ backup แบบ logical จากเครื่องนี้ไม่ได้** |
| Docker | ⚠️ CLI อยู่ (29.8.0) แต่ daemon ปิด → local Postgres ยังใช้ไม่ได้ |
| Supabase Dashboard | ไม่เข้าถึงได้ในงานนี้ → **สถานะแผน backup/PITR ไม่สามารถยืนยันได้** |

### 6.3 คำตัดสิน

| รายการ | Verdict |
|---|---|
| แผน backup เป็นเอกสาร | **PASS** |
| Backup เป็น logical dump จริง | **BLOCKED** (ไม่มี `pg_dump`; ต้องใช้หน้าต่าง Dashboard หรือติดตั้ง client tools) |
| Backup ถูกยืนยันว่า restore ได้ | **BLOCKED** (ยังไม่มี environment รองให้ทดลอง restore) |
| Rollback 010 | **PASS (เมื่อเขียน script)** — `DROP TABLE store_memberships;` ปลอดภัย เพราะ additive |
| Rollback 011 | **FAIL** — ข้อมูลที่ถูกลบกู้คืนไม่ได้ ต้องพึ่ง forward recovery + backup |
| Local isolated validation | **FEASIBLE (ยังไม่รัน)** — ต้องสตาร์ท Docker daemon ก่อน |

**ข้อสรุป:** Backup/Restore ยัง **ไม่พร้อมสำหรับ Production** ไม่ใช่เพราะแผนไม่ดี แต่เพราะ (ก) ยังไม่มี backup จริง (ข) ยังไม่เคยทดสอบ restore จริง (ค) 011 ไม่มี rollback ที่เป็นข้อมูล

---

## 7. แผนทดสอบ (ข้อ 6 และ 7 ของงาน)

### 7.1 ข้อควรรู้ก่อนออกแบบ test

- แอปทุกเส้นทางใช้ `supabaseAdmin` (service role) → **RLS ถูกข้ามทั้งหมด** (`backend/config/supabase.js:44-52`) การทดสอบ RLS ต้องยิง **ตรงไปยัง Supabase ด้วย access token ของแต่ละ role** ไม่ใช่ผ่าน REST API
- `createUserClient(accessToken)` (`backend/config/supabase.js:58-71`) ใช้เป็นเครื่องมือหลักในการสร้าง user-scoped client
- user ทุกตัวต้องเป็น fixture ใน Staging เท่านั้น ห้ามใช้บัญชีจริงใน Production

### 7.2 ผัง Role สำหรับ RLS Test (Staging)

| โค้ด | บทบาท | เงื่อนไข |
|---|---|---|
| `U_ADMIN` | Platform Admin | `profiles.role = 'admin'` |
| `U_OWNER_A` / `U_OWNER_B` | Owner | `stores.owner_id` + `store_memberships(role='owner', left_at NULL)` |
| `U_MGR_A` | Manager | `store_memberships(S_A, role='manager', permissions.member_write = true)` |
| `U_MGR_NW` | Manager (ไม่มีสิทธิ์) | `store_memberships(S_A, role='manager', permissions.member_write = false)` |
| `U_STAFF_A` | Staff | `store_memberships(S_A, role='staff')` |
| `U_CUST_A` / `U_CUST_B` | Customer | ไม่มี membership |
| `U_OUTSIDER` | คนนอก | ไม่มีทุกอย่าง |

### 7.3 แผนทดสอบ RLS (ต้องรันบน Staging, ห้ามบน Production)

| # | เคส | คาดหวัง | อ้างอิง |
|---|---|---|---|
| R1 | `U_STAFF_A` SELECT `store_memberships` | เห็นแถวของตัวเองเท่านั้น | `010:66-75` |
| R2 | `U_MGR_A` SELECT `store_memberships` | เห็นทุกแถวของ S_A | `010:70-74` |
| R3 | `U_OWNER_B` SELECT `store_memberships` ของ S_A | 0 แถว | `010:69` |
| R4 | `U_OWNER_A` INSERT `staff` เข้า S_A | สำเร็จ | `010:82` |
| R5 | `U_MGR_A` INSERT `staff` เข้า S_A | สำเร็จ | `010:85-95` |
| R6 | `U_MGR_A` INSERT ตัวเอง | ถูกปฏิเสธ | `010:92` |
| R7 | `U_MGR_A` INSERT `role='owner'` | ถูกปฏิเสธ | `010:94` |
| R8 | `U_MGR_NW` INSERT/UPDATE ใด ๆ | ถูกปฏิเสธ | `010:90` |
| R9 | `U_STAFF_A` INSERT/UPDATE/DELETE | ถูกปฏิเสธ | ไม่มี policy ให้ staff |
| R10 | `U_MGR_A` UPDATE แถวของ `owner` | ถูกปฏิเสธ | `010:146` |
| R11 | `U_MGR_A` promote `staff → manager` | **ต้องยืนยันเจตนา** (ปัจจุบัน policy อนุญาต) | `010:167` |
| R12 | `U_MGR_A` suspend / remove `staff` | สำเร็จ (ตั้ง `left_at` + audit) | `010:169-171` |
| R13 | `U_OWNER_A` demote ตัวเองเมื่อเป็น sole owner | ถูกปฏิเสธ | `010:119-127` (ต้องย้ายไป trigger) |
| R14 | `U_OWNER_A` DELETE แถวตัวเองเมื่อเป็น sole owner | ถูกปฏิเสธ | `010:182-189` |
| R15 | `U_MGR_A` DELETE | ถูกปฏิเสธ | `010:178-180` |
| R16 | `U_CUST_A` SELECT `conversations` ของ `U_CUST_B` | 0 แถว | `002:618-626` |
| R17 | `U_OWNER_B` SELECT `conversations` ของ S_A | 0 แถว | `002:633-640` |
| R18 | `U_STAFF_A` SELECT `conversations` ของ S_A | **0 แถว → ช่องว่างที่ต้องแก้** | `002:633-640` |
| R19 | `U_CUST_B` SELECT `messages` ของห้อง S_A | 0 แถว | `002:694-703` |
| R20 | `U_CUST_B` SELECT `message_attachments` | 0 แถว | `002:744-754` |
| R21 | `U_CUST_B` ดาวน์โหลดไฟล์ `chat-attachments` | 403/denied | `004:172-184` |
| R22 | `U_CUST_A` / `U_CUST_B` SELECT `call_history` | เห็นเฉพาะเรตติ้งของตัวเอง | `002:786-790` |
| R23 | `U_CUST_A` SELECT `conversation_members` ของห้องตัวเอง | เห็น; ของห้องอื่น ไม่เห็น | `002:650-658` |
| R24 | `U_ADMIN` SELECT ข้าม role ทั้งหมด | เห็นตาม policy ที่อนุญาต | `002:643-644` |
| R25 | ทุกตัวพยายามอ้างอิง `store_memberships` | **ต้อง error ถ้า HIGH-1 ไม่ถูกแก้** → เป็นตัวชี้วัดว่า 010 พร้อมหรือไม่ | `010:70-144` |

### 7.4 แผนทดสอบ Chat / Attachments / Read Receipts / Socket / Voice Call (2 บัญชี)

**บัญชี:** `A = U_CUST_A`, `B = U_OWNER_A`, คู่เทียบ `C = U_CUST_B` (คนนอก), ผู้ช่วย `S = U_STAFF_A`, `M = U_MGR_A`

| # | เคส | ขั้น | คาดหวัง |
|---|---|---|---|
| C1 | สร้าง conversation | `POST /api/chat/conversations {storeId}` ซ้ำ 5 ครั้งขนานกัน | ได้ `conversation_id` เดียว, ไม่มี duplicate `(customer_id, store_id)` |
| C2 | ห้าม owner ทักร้านตัวเอง | `A` พยายามสร้างโดยใช้ token ของ `B` | 400 `Cannot start a conversation with your own store` (`chatService.js:60-67`) |
| C3 | ส่งข้อความ 2 ทิศ | `A` → `B` และ `B` → `A` | เห็น `newMessage` ฝั่งตรงข้ามผ่าน socket room `conversation_<id>` |
| C4 | คนนอกส่งข้อความ | `C` พยายาม `POST /conversations/:id/messages` | 403 `Not a member of this conversation` |
| C5 | Read receipt | `A` เปิดแชท → `POST /conversations/:id/read` | `unread_count` ของ `A` = 0; ของ `B` ยังเท่าเดิม; socket `messagesRead` ถึง `B` |
| C6 | Read receipt ของคนอื่น | `B` อ่านแล้วตรวจของ `A` | ไม่กระทบ (แยกตาม `profile_id`) |
| C7 | แก้ไข/ลบข้อความ | `A` แก้/ลบข้อความตัวเอง | สำเร็จ; ลบอีกฝ่าย → 403 |
| C8 | แนบไฟล์ | `A` อัปโหลด PNG/PDF 5 ไฟล์ (ขนาด < 20 MB) | 201; ปรากฏใน `message_attachments`; `B` ดาวน์โหลดได้ |
| C9 | แนบไฟล์ผิด type | อัปโหลด `.exe` | ถูกปฏิเสธตาม allowlist (`004:15`) |
| C10 | แนบไฟล์ในห้องคนอื่น | `C` พยายามแนบข้อความของ `A` | 403 (`chatService.js:689-712`) |
| C11 | พิมพ์/หยุดพิมพ์ | `A` emit `typing` / `stopTyping` | `B` เห็น; `C` ที่ไม่ได้ join room ไม่เห็น; คนนอก emit ครั้งแรก → ต้องไม่ไป (`socketService.js:176-205`) |
| C12 | join room ผิดห้อง | `C` emit `joinConversation` ของห้อง `A` | ไม่ถูก join (`socketService.js:117-133`) |
| V1 | เริ่มคอล | `A` `POST /api/calls {calleeId: B, conversationId}` | `call_history` `ringing`; `B` ได้ `incomingCall` พร้อม `callee_id` |
| V2 | รับสาย | `B` `POST /api/calls/:id/accept` | status `accepted`; ทั้งคู่ได้ `callSignal` ผ่าน room `call_<id>` |
| V3 | แลก signal | `A`/`B` emit `callSignal` สลับกัน | อีกฝ่ายได้ครบ; คนนอก emit → ต้องไม่ส่ง (`socketService.js:208-232`) |
| V4 | heartbeat | ทั้งคู่ emit `callHeartbeat` ทุก 5 วินาที | คอลไม่ถูกตัด (`callService.js:131-153`) |
| V5 | heartbeat ของคนไม่ใช่สมาชิก | ใช้ token `C` ยิง `POST /calls/:id/heartbeat` | `false` / 403 (`callService.js:141-152`) |
| V6 | จบสาย | `A` `POST /api/calls/:id/end` | status `ended` (หรือ `completed` ตาม 009); `callEnded` ถึง `B`; บันทึก `duration_seconds` |
| V7 | ประวัติคอล | `A` และ `B` `GET /api/calls/history` | เห็นรายการเดียวกัน; `C` ไม่เห็น |
| V8 | คอลซ้อน | `A` กำลังคอลกับ `B` แล้วพยายามคอล `C` | ถูกปฏิเสธ `Call already in progress` (`callService.js:193-202`) |
| V9 | merge ทำให้ประวัติหายไหม | รัน 011 แล้วตรวจ `call_history` | `conversation_id` ชี้ `keep_id`; ครบทุกแถว; ไม่มี orphan |
| V10 | merge ทำให้ข้อความหายไหม | รัน 011 แล้วนับ `messages` | จำนวนรวมไม่เปลี่ยน; กระจายตาม `keep_id` |
| V11 | merge ทำให้ไฟล์แนบหายไหม | รัน 011 แล้วนับ `message_attachments` + ทดลองดาวน์โหลด | ครบและดาวน์โหลดได้ |
| V12 | read state หลัง merge | รัน 011 แล้วเปิดแชท | `unread_count` สอดคล้องกับข้อความจริง (ปัจจุบัน **ไม่ผ่าน** → ต้องแก้ตาม HIGH-2) |

**เกณฑ์ผ่าน:** ทุกเคสต้องเป็นไปตามที่คาดหวัง และเด็ดขาด: R25 ต้อง error ถ้า 010 ยังไม่ถูกแก้ และ V9–V12 ต้องนับจำนวนจริง ไม่ใช่แค่ดู 0 errors

### 7.5 เครื่องมือที่ต้องใช้ทดสอบ

- 2 โปรไฟล์เบราว์เซอร์ (A, B) หรือ 2 context แยก
- ใช้ Staging URL + token ของ Staging เท่านั้น
- บันทึกผลเป็น `PHASE_2_RLS_INTEGRATION_TEST_RESULT.md` และ `PHASE_2_CHAT_CALL_E2E_RESULT.md`

---

## 8. ลำดับการดำเนินงานที่ปลอดภัย + เงื่อนไขอนุมัติ

> หลักการ: **ห้ามข้ามเด็ด** ทุกเด็ดต้องมีผู้ใช้อนุมัติเป็นขั้น ๆ และต้องย้อนกลับได้ก่อนก้าวต่อไป

### Step 0 — คงสถานะเดิม (ทำเสร็จแล้ว)
- สิ่งที่ทำ: ไม่เปลี่ยนแปลงใด ๆ นอกจากรายงานฉบับนี้
- เด็ดอนุมัติ: ไม่ต้อง (ผ่านแล้ว)

### Step 1 — แก้ SQL 010 ให้รันได้จริง (แก้ไฟล์เท่านั้น, ยังไม่รัน)
- สิ่งที่ต้องแก้: (1) ย้าย `OLD/NEW` ออกจาก RLS ไปเป็น `BEFORE UPDATE` / `BEFORE DELETE` trigger (2) เขียน `SECURITY DEFINER` helper สำหรับเช็กสมาชิก/สิทธิ์ (3) ครอบ cast ของ `member_write` ให้ปลอดภัย
- เด็ดอนุมัติ: **G1** — ผู้ใช้ตรวจ diff ของ 010 ก่อน
- ย้อนกลับ: `git checkout -- supabase/migrations/010_store_memberships.sql` (ยังไม่ commit)

### Step 2 — แก้ SQL 011 ให้ปลอดภัย (แก้ไฟล์เท่านั้น)
- (1) merge แบบ upsert + รวม `unread_count` / `last_read_at` (2) backfill แบบ deterministic ด้วย window function (3) คำนวณ `last_message_at` ใหม่ (4) เพิ่ม archive table + เก็บสำเนาก่อน DELETE (5) บังคับ `store_id IS NOT NULL` ตอนหา duplicate (6) `ORDER BY created_at ASC NULLS LAST` (7) แยก `CREATE INDEX CONCURRENTLY` ออกเป็นขั้น manual (8) เขียน rollback script สำหรับ 010
- เด็ดอนุมัติ: **G2** — ผู้ใช้ตรวจ diff ของ 011 + rollback scripts
- ย้อนกลับ: `git checkout --` ตามไฟล์

### Step 3 — ตรวจสอบแบบ local ที่ไม่มีความเสี่ยง
- `supabase init` (สร้าง `supabase/config.toml`) → `supabase start` (Docker) → `supabase db reset` ด้วย migrations 001–011 บน **DB ใน localStorage ของ Docker** + seed ข้อมูล synthetic ที่มี duplicate conversation
- ตรวจว่า: 010/011 รันจบโดยไม่ error, จำนวนแถวตรงตาม invariant, rollback script ทำงาน
- เด็ดอนุมัติ: **G3** — ผู้ใช้อนุมัติให้ใช้ Docker (ต้องสตาร์ท daemon) และยืนยันว่าไม่มีการ link ไป Production
- ย้อนกลับ: `docker rm` + ลบ `supabase/` ที่ init ไว้ (ยังไม่ commit)

### Step 4 — ยืนยันแผน backup กับ Production
- ผู้ใช้ (ไม่ใช่ agent) ทำ: เปิด Supabase Dashboard → Database → Backups → ยืนยันแผน (Daily/PITR), ดาวน์โหลด/บันทึก backup ล่าสุด, จด timestamp + row counts + FK integrity
- ตรวจสอบ: ต้องมี **logical dump จริงที่ restore ได้** (ทดสอบ restore ลง project ชั่วคราวที่ผู้ใช้สร้างเอง — ห้าม agent สร้าง staging เอง)
- เด็ดอนุมัติ: **G4** — ผู้ใช้ยืนยันว่า backup มีและทดสอบ restore แล้ว
- ถ้าไม่ผ่าน: **หยุด** — ห้ามไปต่อ

### Step 5 — Staging migration (ผู้ใช้ต้องมี/อนุมัติ staging ก่อน)
- รัน 010 → ตรวจ → รัน 011 → ตรวจ (ตาม `PHASE_2_STAGING_MIGRATION_RUNBOOK.md`)
- pre-check แบบ read-only ก่อน: จำนวนแถว, duplicate groups, role ที่อยู่นอก CHECK set, `store_id IS NULL` ใน `store_customer`
- เด็ดอนุมัติ: **G5** — ผู้ใช้อนุมัติเด็ดละครั้ง พร้อมระบุ staging ref ที่ใช้
- ย้อนกลับ: rollback 010 ได้ทันที; 011 ต้องพึ่ง backup (จึงต้องมี G4 ก่อน)

### Step 6 — ทดสอบ RLS + ทดสอบ 2 บัญชีบน Staging
- รัน R1–R25 และ C1–C12, V1–V12 ตาม 7.3 / 7.4
- เด็ดอนุมัติ: **G6** — ผู้ใช้อนุมัติให้รัน โดยมีเงื่อนไขว่าเป็น Staging ล้วน
- ผ่านทุกข้อจึงจะไปต่อ

### Step 7 — เตรียม Production (ยังไม่รัน)
- รัน pre-check แบบ **อ่านเท่านั้น** บน Production: จำนวนแถว, จำนวน duplicate `(customer_id, store_id)`, role ที่อยู่นอก CHECK set, จำนวน `conversations` ที่ `store_id IS NULL`, จำนวน `call_history`/`messages` ที่จะ bị re-point
- กำหนด maintenance window + freeze เขียนที่ `conversations` (ถ้าเป็นไปได้)
- เด็ดอนุมัติ: **G7** — ผู้ใช้อนุมัติเป็นลายลักษณ์อักษรสำหรับแต่ละ migration พร้อมระบุเวลา
- ย้อนกลับ: ยังไม่มีการแก้ข้อมูล

### Step 8 — Production migration (ทีหลัง และเมื่อผ่อนคลายข้อห้ามนี้แล้วเท่านั้น)
- รัน 010 → post-check (R1–R25 แบบอ่าน) → รัน 011 → post-check นับจำนวน + FK + duplicate groups = 0
- เด็ดอนุมัติ: **G8** — แยกเด็ดสำหรับ 010 และ 011 (ห้ามอนุมัติรวม)
- ย้อนกลับ: 010 = `DROP TABLE`; 011 = forward recovery จาก backup เท่านั้น

### สิ่งที่ทำได้ทันทีโดยไม่ต้องรอเด็ดใหม่ (แต่ต้องอนุมัติ G1/G2 เพื่อแก้ไฟล์)
1. เขียน/แก้ 010, 011 และ rollback scripts (ยังไม่รัน)
2. เพิ่ม `regression_output*.txt` เข้า `.gitignore`
3. เขียนสคริปต์ pre-check แบบอ่าน (read-only SELECT) สำหรับ Step 7
4. เขียนชุดทดสอบ RLS 2 บัญชีตาม 7.3/7.4 (ยังไม่รัน)

---

## 9. ข้อค้นพบอื่น (นอกเหนือขอบเขกโดยตรง แต่ควรบันทึก)

| # | ข้อค้นพบ | ระดับ | อ้างอิง |
|---|---|---|---|
| O1 | `002:66`, `002:77` ใช้ subquery ต่อ `profiles` ใน policy เดียวกัน → ความเสี่ยง infinite recursion เหมือนกัน | MED | `002:66,77` |
| O2 | helper RLS หลายตัวเป็น `SECURITY DEFINER` แต่ไม่มี `SET search_path` | MED | `002:31-54` |
| O3 | `backend/__tests__/phase2_remediation.test.mjs` มีเคส migration ที่เป็น `assert.ok(true, …)` เท่านั้น → 27 เคสที่ "ผ่าน" ไม่ได้พิสูจน์ SQL | HIGH | `:194,225,245,286,305` |
| O4 | RLS ของ `conversations` ยังไม่รองรับ manager/staff → ฟีเจอร์ multi-store ยังไม่ครบ | HIGH (สำหรับ Phase 3) | `002:633-640`, `chatService.js:730-741` |
| O5 | `RENDER_SUPABASE_PRODUCTION_AUDIT.md` ระบุ "BLOCKED / UNKNOWN" ขณะที่ผู้ใช้ยืนยัน ref แล้ว → บันทึกที่มาของข้อมูลด้วย | LOW | เsinceกษะจากผู้ใช้เป็นหลัก |
| O6 | `PATCH /conversations/:id/members` ให้ manager promote staff→manager ได้ (ตาม policy) → ต้องยืนยันเจตนา | MED | `010:167` |

---

## 10. บทสรุปและขั้นตอนถัดไปที่ทำได้จริง

**สรุปรวม: BLOCKED**

เหตุผลหลัก 4 ข้อ:
1. **010 ไม่สามารถรันได้** — RLS ใช้ `OLD`/`NEW` ซึ่ง PostgreSQL ไม่รองรับ + self-referencing policy
2. **011 ไม่สามารถรันได้ในกรณีที่จำเป็นที่สุด** — merge ชน `UNIQUE (conversation_id, profile_id)` และการ backfill แบบ "unambiguous" ไม่ทำงานจริงตามที่อธิบาย
3. **ไม่มี backup ที่ยืนยันได้** — ไม่มี `pg_dump`/`psql` ในเครื่อง, ยังไม่เคยทดสอบ restore จริง, และ 011 ทำลายข้อมูลถาวรโดยไม่มี rollback
4. **ไม่มี Staging** — การทดสอบ RLS และ 2 บัญชีเป็นไปไม่ได้ในสภาพแวดล้อมปัจจุบัน (และถูกห้ามให้สร้าง staging เอง)

**ลำดับที่ทำได้จริงถัดไป (ตามเด็ดอนุมัติ):**
1. อนุมัติ **G1/G2** → แก้ 010/011 + เขียน rollback scripts (แก้ไฟล์เท่านั้น)
2. อนุมัติ **G3** → local validation ด้วย Docker (`supabase start` + `db reset`) — ไม่มีการต่อ Production
3. ผู้ใช้ทำ **G4** → ยืนยันแผน backup/PITR + ทดสอบ restore
4. ผู้ใช้จัดหา/อนุมัติ **G5** → รัน 010 → 011 บน Staging
5. อนุมัติ **G6** → RLS R1–R25 + Chat/Call C1–C12, V1–V12
6. อ่าน-only pre-check บน Production (**G7**) → maintenance window → **G8** แยกสำหรับ 010 และ 011

**ห้ามข้ามเด็ดข้อใดข้อหนึ่งอย่างเด็ดขาด** เนื่องจากข้อ 2 และ 3 ของข้อห้ามยังมีผลอยู่ และ 011 เป็นการลบข้อมูลถาวร

---

## ภาคผนวก ก: ข้อความที่ใช้ตรวจ (read-only)

```powershell
git status --porcelain=v1 -uall
git diff --stat ; git diff -- <file>
git log --oneline -10 ; git branch -vv ; git remote -v
Select-String -Path "supabase\migrations\001_initial_schema.sql" -Pattern "CREATE TABLE|REFERENCES"
Get-Content "supabase\migrations\010_store_memberships.sql" ; Get-Content "supabase\migrations\011_conversation_customer_id.sql"
Select-String -Path "supabase\migrations\002_rls_policies.sql" -Pattern "CREATE POLICY"
Select-String -Path "supabase\migrations\003_triggers_functions.sql" -Pattern "CREATE TRIGGER|CREATE OR REPLACE FUNCTION"
npm --prefix backend test            # 206 passed / 0 failed (unit; ไม่เกี่ยว RLS/จริง)
Test-Path supabase\config.toml ; Get-ChildItem supabase\.temp -Force
Get-Command psql,pg_dump,docker,supabase
```

## ภาคผนวก ข: เอกสารอ้างอิงในคลัง

`PHASE_2_FINAL_VERIFICATION_REPORT.md` (สรุป PASS สำหรับ Phase 2 แต่พลาดข้อ BLOCKER ของ 010/011 เพราะตรวจแบบ static และ unit test ที่เป็น placeholder), `PHASE_2_DATABASE_VERIFICATION_REPORT.md`, `PHASE_2_BACKUP_RESTORE_PLAN.md`, `PHASE_2_FORWARD_RECOVERY_PLAN.md`, `PHASE_2_STAGING_MIGRATION_RUNBOOK.md`, `PHASE_2_RLS_INTEGRATION_TEST_PLAN.md`, `RENDER_SUPABASE_PRODUCTION_AUDIT.md`, `MULTI_STORE_SECURITY_DESIGN.md`

---

**หมายเหตุผู้เขียน:** รายงานนี้อ้างอิงเฉพาะข้อเท็จจริงที่ตรวจสอบได้ในเครื่อง (git, ไฟล์ใน repo, คำสั่งที่อ่านได้) และสรุปสถานะของ SQL จาก schema ใน `001`–`004` ทุกข้อที่ต้องใช้ DB จริงเพื่อยืนยันถูกระบุว่า "ต้องยืนยันบน Staging" อย่างชัดเจน
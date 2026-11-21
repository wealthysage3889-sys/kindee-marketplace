# KINDEE_MIGRATION_010_FIX_REPORT.md

**ไฟล์ที่แก้:** `supabase/migrations/010_store_memberships.sql`
**ไฟล์ที่เกี่ยวข้อง:** `supabase/rollback_010.sql` (เพิ่ม DROP สำหรับ trigger/function ใหม่)
**ข้อผิดพลาดเดิม:** `ERROR: 42P01: missing FROM-clause entry for table "OLD"` (และ `NEW`)
**ตำแหน่งเดิม:** `store_memberships_update` policy — `WITH CHECK` อ้างอิง `OLD.role`, `NEW.role`, `OLD.left_at`, `NEW.left_at`, `OLD.suspended_at`, `NEW.suspended_at` (เดิมบรรทัด 254–279)

---

## 1. สรุปสาเหตุ (Root Cause)

นโยบาย `CREATE POLICY ... FOR UPDATE` มีได้เพียง **สองนิพจน์ที่เขียนเป็นแถวเดียว**:

- `USING (...)` — ตรวจสอบ **แถวเดิม (pre-update / OLD row)** ว่าแถวนี้ผู้ใช้มองเห็น/แก้ไขได้หรือไม่
- `WITH CHECK (...)` — ตรวจสอบ **แถวใหม่ (post-update / NEW row)** ที่ *กำลังจะเขียน* ว่าเป็นแถวที่ยอมรับได้หรือไม่

ทั้งสองนิพจน์รันในบริบทของ **แถวปัจจุบันของ `store_memberships` เท่านั้น** ไม่มีตัวแปร `OLD` และ `NEW` แบบ Record เหมือนใน Trigger Function ดังนั้นการอ้างอิง `OLD.role` / `NEW.role` ใน `WITH CHECK` จึงทำให้เกิด:

```
ERROR: 42P01: missing FROM-clause entry for table "OLD"
```

(เช่นเดียวกันกับ `NEW`) เพราะ PostgreSQL พยายามหาตาราง/เทเบิลที่ชื่อ `OLD`/`NEW` ใน scope ของนิพจน์ policy แต่ไม่มีอยู่จริง

**หลักการแก้:** แยกหน้าที่ชัดเจน

| ประเภทกฎ | สถานที่ที่ถูกต้อง |
|-----------|-------------------|
| ใครแก้แถวนี้ได้ (role ปัจจุบันของ actor) | `USING` ของ policy |
| แถวใหม่นี้ถูกต้องไหม (permissions, actor ยังเป็นเจ้าของ/ผู้จัดการอยู่) | `WITH CHECK` ของ policy |
| เงื่อนไขที่ต้องเทียบค่า **ก่อน vs หลัง** (`store_id`, `profile_id`, `role`, `member_write`) | **BEFORE UPDATE TRIGGER** |

---

## 2. การตรวจสอบนโยบาย `store_memberships_update` แบบละเอียด (ก่อนแก้)

นโยบายเดิม (บรรทัด 243–281 ของเวอร์ชันก่อน) พยายามทำทุกอย่างใน `WITH CHECK` เดียว:

```sql
WITH CHECK (
    public.validate_store_member_permissions(permissions)
    AND (
        public.is_store_owner(store_id, auth.uid())
        AND NOT (OLD.role = 'owner' AND NEW.role <> 'owner' AND NOT EXISTS (...))   -- 42P01
        AND NOT (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL AND NOT EXISTS (...)) -- 42P01
        AND NOT (OLD.suspended_at IS NULL AND NEW.suspended_at IS NOT NULL AND NOT EXISTS (...)) -- 42P01
        OR
        public.is_active_store_manager(store_id, auth.uid(), TRUE)
        AND OLD.role <> 'owner'            -- 42P01
        AND NEW.role <> 'owner'            -- 42P01
        AND NEW.store_id = OLD.store_id    -- 42P01
        AND NEW.profile_id = OLD.profile_id -- 42P01
        AND (OLD.role = NEW.role OR NEW.role IN ('staff','manager')) -- 42P01
        AND NOT (NEW.role = 'owner')       -- 42P01
        AND NOT (NEW.role = 'staff' AND permissions ? 'member_write') -- 42P01
    )
)
```

จุดผุดพลาดเพิ่มเติมที่พบระหว่างตรวจสอบ (ไม่ใช่แค่ 42P01):

1. **Operator precedence ผิด** — `AND` ผูกมัดก่อน `OR` ทำให้เงื่อนไข `validate_store_member_permissions(...) AND ( ... )` ถูกแยกเป็นสามก้อนอิสระ ผลลัพธ์คือ manager อาจ **ข้าม** `validate_store_member_permissions` ได้บางเส้นทาง
2. **เงื่อนไซ manager ไม่สอดคล้องกัน** — บรรทัด `AND NOT (NEW.role = 'owner')` ซ้ำซ้อนกับ `NEW.role <> 'owner'` และ `AND (OLD.role = NEW.role OR NEW.role IN ('staff','manager'))` ไม่ครอบคลุมกรณี promote staff→manager ที่มีเงื่อนไขซ้อนกัน
3. **Subquery ใน policy อ้าง `store_id` เป็น correlation** ทำให้อ่านยาก�และเสี่ยง ambiguous กับ `sm2.store_id`

เนื่องจากนิพจน์ policy ไม่สามารถเทียบ OLD/NEW ได้โดยกำเนิด **ต้องเลื่อนเงื่อนไขเปรียบเทียบค่าทั้งหมดออกไปยัง BEFORE UPDATE TRIGGER** ซึ่งเข้าถึง `OLD` และ `NEW` ได้โดยตรง

---

## 3. การแก้ที่ทำ (ไม่ได้แก้เฉพาะบรรทัด error)

### 3.1 เพิ่ม BEFORE UPDATE TRIGGER สำหรับเงื่อนไข OLD/NEW ทั้งหมด

สร้างฟังก์ชัน `public.store_memberships_guard_update()` และ trigger `trg_store_memberships_guard_update` (วางก่อนนโยบาย `store_memberships_update`) เพื่อรองรับเงื่อนไขที่ต้องเทียบ OLD/NEW:

```sql
CREATE OR REPLACE FUNCTION public.store_memberships_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_is_store_owner BOOLEAN;
    v_is_manager_write BOOLEAN;
BEGIN
    -- 1) store_id / profile_id ต้องไม่เปลี่ยน (ห้ามย้ายสมาชิกข้ามร้าน)
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
        RAISE EXCEPTION 'store_memberships.store_id is immutable';
    END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'store_memberships.profile_id is immutable';
    END IF;

    -- Actor guards เฉพาะผู้ใช้ authenticated; NULL actor = service_role/SQL editor/superuser
    IF v_actor IS NOT NULL THEN
        v_is_store_owner := public.is_store_owner(OLD.store_id, v_actor);
        v_is_manager_write := public.is_active_store_manager(OLD.store_id, v_actor, TRUE);

        IF v_is_store_owner THEN
            -- 2) เจ้าของร้านเท่านั้นที่เปลี่ยน role / ลบ / ระงับสมาชิกได้
            --    (sole-owner ยังถูกกันโดย prevent_sole_owner_change() ที่รันก่อน)
            NULL;
        ELSIF v_is_manager_write THEN
            -- 3) manager (มี member_write) ห้ามเปลี่ยน role / ให้ member_write / แตะ owner
            IF NEW.role IS DISTINCT FROM OLD.role THEN
                RAISE EXCEPTION 'Only the store owner may change a member role';
            END IF;
            IF public.jsonb_bool(NEW.permissions, 'member_write') IS DISTINCT FROM
               public.jsonb_bool(OLD.permissions, 'member_write') THEN
                RAISE EXCEPTION 'Only the store owner may grant member_write';
            END IF;
            IF OLD.role = 'owner' THEN
                RAISE EXCEPTION 'Managers cannot modify owner memberships';
            END IF;
        ELSE
            -- 4) ไม่ใช่เจ้าของร้านและไม่ใช่ manager: fail-closed
            RAISE EXCEPTION 'Not authorized to update store membership';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_memberships_guard_update ON store_memberships;
CREATE TRIGGER trg_store_memberships_guard_update
    BEFORE UPDATE ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.store_memberships_guard_update();
```

**หมายเหตุสำคัญ:**

- ฟังก์ชันนี้ **ไม่** เป็น `SECURITY DEFINER` (ต่างจาก helper อื่น) เพื่อให้รันในสิทธิ์ของผู้ใช้เรียก และให้ RLS ของ `store_memberships` ยังมีผลบังคับใช้ — ป้องกัน trigger ถูกใช้เป็น backdoor ข้ามนโยบาย
- ลำดับการรัน trigger: BEFORE ROW trigger เรียงตามชื่ออักขระ `trg_prevent_sole_owner_update` < `trg_store_memberships_guard_update` จึง **sole-owner trigger รันก่อน** และให้ข้อความ error เฉพาะเจาะจงสำหรับกรณีเจ้าของรายเดียว ส่วน guard จัดการกฎ role/permission/immutable ที่เหลือ
- กรณี `auth.uid()` เป็น NULL (service_role / SQL editor / superuser) จะข้ามเงื่อนไข actor guards เพื่อไม่ให้บล็อกงาน maintenance ที่น่าเชื่อถือ แต่ **sole-owner protection ยังทำงานกับทุกกรณี** (เพราะ `prevent_sole_owner_change()` ไม่ตรวจ actor)

### 3.2 เขียนนโยบาย `store_memberships_update` ใหม่ให้ถูกต้อง

แยก `USING` (แถวเดิม) และ `WITH CHECK` (แถวใหม่) อย่างชัดเจน:

```sql
DROP POLICY IF EXISTS store_memberships_update ON store_memberships;
CREATE POLICY store_memberships_update ON store_memberships
    FOR UPDATE
    USING (
        public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
    )
    WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
        )
    );
```

- `USING` — ผู้ใช้ต้องเป็นเจ้าของร้าน หรือ manager ที่มี `member_write` ของ **แถวเดิม** (`store_id` ใน scope คือแถวเดิม)
- `WITH CHECK` — แถวใหม่ต้องผ่าน `validate_store_member_permissions` และ actor ยังต้องเป็นเจ้าของ/manager ของ **แถวใหม่** (ป้องกัน NOT NULL / เปลี่ยน store_id โดยแอบข้ามสิทธิ์ — ถูก guard จับอีกชั้นด้วย)
- ไม่มี `OLD`/`NEW` ในนิพจน์ policy อีกต่อไป → กำจัด 42P01

---

## 4. การตรวจสอบนโยบายอื่น ๆ ทั้งหมด

### 4.1 SELECT policy (บรรทัด 220–226)

```sql
CREATE POLICY store_memberships_select ON store_memberships
    FOR SELECT USING (
        profile_id = auth.uid()
        OR public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), FALSE)
    );
```

- สมาชิกคนเดียวกับตนเอง (`profile_id = auth.uid()`) เห็นแถวตัวเองได้
- เจ้าของร้านเห็นทุกสมาชิก
- manager ที่ active (ไม่จำเป็นมี `member_write` เพราะ `FALSE`) เห็นสมาชิกในร้าน
- **ไม่พบ OLD/NEW, ไม่พบช่องโหว่** — คงไว้เดิม

### 4.2 INSERT policy (บรรทัด 228–241)

```sql
CREATE POLICY store_memberships_insert ON store_memberships
    FOR INSERT WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR (
                public.is_active_store_manager(store_id, auth.uid(), TRUE)
                AND profile_id <> auth.uid()
                AND role <> 'owner'
                AND NOT (permissions ? 'member_write' AND public.jsonb_bool(permissions, 'member_write'))
            )
        )
    );
```

- เจ้าของร้านเพิ่มสมาชิกได้ (ทุก role ที่ validate ผ่าน)
- manager ที่มี `member_write` เพิ่มได้เฉพาะเมื่อ: ไม่เติมตัวเอง (`profile_id <> auth.uid()`), ไม่ใช่ `role = 'owner'`, และ **ห้ามให้ `member_write = true`** กับ member ใหม่
- `validate_store_member_permissions` กันคีย์อื่นนอกเหนือจาก `member_write` และกันค่าที่ไม่ใช่ boolean
- **ไม่พบ OLD/NEW** — คงไว้เดิม

### 4.3 DELETE policy (บรรทัด 343–347)

```sql
CREATE POLICY store_memberships_delete ON store_memberships
    FOR DELETE USING (
        public.is_store_owner(store_id, auth.uid())
    );
```

- เฉพาะเจ้าของร้านเท่านั้นที่ลบสมาชิกได้
- การลบเจ้าของรายเดียวยังถูกกันโดย `prevent_sole_owner_delete()` (BEFORE DELETE, SECURITY DEFINER)
- **ไม่พบ OLD/NEW** — คงไว้เดิม

### 4.4 นโยบายที่เกี่ยวข้องในตารางอื่น

`conversations_store_members_select` (บรรทัด 352–357) ใช้ `is_store_owner` / `is_active_store_member` เท่านั้น ไม่มี OLD/NEW — ถูกต้องและคงไว้

---

## 5. การป้องกันตามข้อกำหนด (Security Requirements Checklist)

| ข้อกำหนด | สถานะ | กลไก |
|-----------|--------|------|
| 4.1 แยก `USING` (แถวเดิม) / `WITH CHECK` (แถวใหม่) | ✅ | นโยบายใหม่แยกชัดเจน ใช้เฉพาะ `store_id`/`permissions`/`auth.uid()` ของแถวนั้น ๆ |
| 4.2 ย้ายเงื่อนไข OLD/NEW ไป BEFORE UPDATE TRIGGER | ✅ | `store_memberships_guard_update()` + `trg_store_memberships_guard_update` |
| 4.3 ป้องกัน manager เปลี่ยนเจ้าของร้าน / ย้ายข้ามร้าน | ✅ | guard บังคับ `store_id`/`profile_id` immutable + manager แตะ `role='owner'` ไม่ได้ + ห้ามเปลี่ยน role |
| 4.4 ป้องกันการยกระดับสิทธิ์โดยไม่ได้รับอนุญาต | ✅ | manager ห้ามให้ `member_write` (INSERT policy + guard), ห้ามเปลี่ยน role; เฉพาะเจ้าของร้านเท่านั้นที่ promote เป็น owner/manager ได้; `validate_store_member_permissions` กันคีย์อื่น |
| 4.5 คงการป้องกัน sole owner | ✅ | `prevent_sole_owner_change()` (BEFORE UPDATE) + `prevent_sole_owner_delete()` (BEFORE DELETE) คงไว้ครบ ทำงานร่วมกับ guard โดยไม่ขัดกัน |
| 4.6 fail-closed permissions | ✅ | `jsonb_bool` คืน FALSE เมื่อ NULL/คีย์หาย/ไม่ใช่ boolean; `validate_store_member_permissions` คืน FALSE เมื่อไม่ใช่ object/มีคีย์แปลกปลอม; guard ยก exception เมื่อ actor ไม่ใช่เจ้าของ/manager |
| 4.7 ตรวจ DELETE/INSERT/SELECT | ✅ | ตรวจครบ (หัวข้อ 4) ไม่พบ OLD/NEW ในนโยบายเหล่านั้น |
| 4.8 SECURITY DEFINER / search_path / grants | ✅ | ดูหัวข้อ 6 |

---

## 6. SECURITY DEFINER, search_path, grants

### 6.1 ฟังก์ชันในไฟล์ 010 และสถานะ SECURITY DEFINER

| ฟังก์ชัน | SECURITY DEFINER | search_path | เหตุผล |
|----------|------------------|-------------|---------|
| `is_store_owner` | ✅ ใช่ | `public, pg_catalog` | helper สำหรับ RLS หลีกเลี่ยง recursion |
| `is_active_store_manager` | ✅ ใช่ | `public, pg_catalog` | helper สำหรับ RLS |
| `is_active_store_member` | ✅ ใช่ | `public, pg_catalog` | helper สำหรับ RLS ของ conversations |
| `jsonb_bool` | ❌ ไม่ (IMMUTABLE) | `public, pg_catalog` | pure function คำนวณจาก argument |
| `validate_store_member_permissions` | ❌ ไม่ (IMMUTABLE) | `public, pg_catalog` | pure function ตรวจ JSONB |
| `prevent_sole_owner_change` | ✅ ใช่ | `public, pg_catalog` | trigger อ้าง store_memberships ตรง (ต้อง bypass RLS) |
| `prevent_sole_owner_delete` | ✅ ใช่ | `public, pg_catalog` | trigger อ้าง store_memberships ตรง (ต้อง bypass RLS) |
| **`store_memberships_guard_update` (ใหม่)** | ❌ **ไม่** | `public, pg_catalog` | ต้องให้รันในสิทธิ์ผู้ใช้ เพื่อให้ RLS ยังบังคับใช้ ป้องกัน backdoor |

**หมายเหตุ:** guard ทำงานโดยเรียก `is_store_owner`/`is_active_store_manager` (ซึ่งเป็น SECURITY DEFINER อยู่แล้ว) จึงได้ข้อมูลเจ้าของ/manager ที่ถูกต้องแม้ guard เองไม่ถูกเป็น SECURITY DEFINER

### 6.2 search_path

ทุกฟังก์ชัน (เดิมและใหม่) ตั้ง `SET search_path = public, pg_catalog` เพื่อกัน definer ถูก trick ให้ resolve ชื่อจาก schema ที่เขียนได้

### 6.3 Grants

- Migration 003 ให้ `GRANT ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public TO service_role` แต่ `store_memberships` ถูกสร้างใน 010 (หลัง 003) จึงไม่ครอบคลุมด้วย grant นั้น� secaraอัตโนมัติ
- ตาราง `store_memberships` และ policy ทั้งหมดใช้ `TO authenticated` แบบ default (ไม่ระบุ role ใน policy = ใช้ได้กับทุก role ที่มี grant บนตาราง) — Supabase ให้ `authenticated` และ `service_role` เข้าถึงตารางใน `public` โดยปริยาย
- ฟังก์ชันใหม่ `store_memberships_guard_update` ถูกสร้างด้วย `CREATE OR REPLACE FUNCTION` ซึ่ง grant `EXECUTE` ให้ `PUBLIC` โดยปริยาย → `authenticated`/`service_role` รันได้
- **ไม่มีการเปลี่ยนแปลงสิทธิ์ (grants) ใด ๆ** ในการแก้ครั้งนี้ — สอดคล้องกับข้อจำกัด "ห้ามลดความเข้มงวดของ RLS/Security"

---

## 7. การตรวจสอบทั้ง Migration ตั้งแต่ต้นจนจบ (001–012)

| Migration | เนื้อหา | ความเกี่ยวข้องกับ 010 | ผลตรวจสอบ |
|-----------|---------|----------------------|------------|
| 001 | schema หลัก (profiles, stores, ...) | 010 อ้าง `stores`, `profiles` | ✅ มี precondition ครบ |
| 002 | RLS policies ทุกตาราง | 010 สร้าง policy ใหม่ใน `store_memberships` | ✅ ไม่ขัดกัน |
| 003 | triggers/functions + `GRANT ... TO service_role` | 010 สร้างตารางใหม่หลัง 003 | ✅ ตรวจแล้ว (ดูหัวข้อ 6.3) |
| 004 | storage buckets/policies | ไม่เกี่ยวข้อง | ✅ |
| 005 | สร้าง admin/owner | ไม่เกี่ยวข้องโดยตรง | ✅ |
| 006 | social provider columns | ไม่เกี่ยวข้อง | ✅ |
| 007 | profile_addresses + RLS | ไม่เกี่ยวข้อง (มี trigger OLD/NEW ที่ถูกต้อง) | ✅ |
| 008 | call heartbeat columns | ไม่เกี่ยวข้อง | ✅ |
| 009 | call_status enum values | ไม่เกี่ยวข้อง | ✅ |
| **010** | **store_memberships (ไฟล์ที่แก้)** | — | ✅ หลังแก้ไม่มี OLD/NEW ใน policy |
| 011 | conversations.customer_id | ใช้ `conversation_members` ไม่ใช่ `store_memberships` | ✅ ไม่ได้รับผลกระทบ |
| 012 | store_order status function | ไม่เกี่ยวข้อง | ✅ |

** rollback_010.sql:** เพิ่ม `DROP TRIGGER IF EXISTS trg_store_memberships_guard_update` และ `DROP FUNCTION IF EXISTS public.store_memberships_guard_update()` เพื่อให้ rollback สะอาด

---

## 8. ผลตรวจสอบ OLD/NEW ในทุกไฟล์

ค้นหา `OLD.`/`NEW.` ทุกไฟล์ `.sql` ทั้งหมด:

- **001, 003, 007, 012** — `OLD`/`NEW` ปรากฏเฉพาะใน **ฟังก์ชัน trigger** เท่านั้น (ถูกต้อง เช่น `update_updated_at_column`, `log_order_status_change`, `profile_addresses_enforce_single_default`, `log_store_order_status_change`)
- **010 (หลังแก้)** — `OLD`/`NEW` ปรากฏเฉพาะใน **ฟังก์ชัน trigger** เท่านั้น (`prevent_sole_owner_change`, `prevent_sole_owner_delete`, `store_memberships_guard_update`) ไม่ปรากฏในนิพจน์ policy ใด ๆ อีก
- ** ไม่มี** นโยบาย RLS ในโปรเจกต์ที่อ้าง `OLD`/`NEW`

---

## 9. ตารางทดสอบเงื่อนไข (Test Matrix)

กรณีที่ต้องยืนยันบน staging (ไม่รันบน production ตามข้อกำหนด):

| # | Actor | การกระทำ | ผลที่คาดหวัง | กลไกที่บังคับ |
|---|-------|-----------|-------------|----------------|
| 1 | manager (member_write) | เปลี่ยน role ของ staff | ❌ ปฏิเสธ | guard: "Only the store owner may change a member role" |
| 2 | manager (member_write) | ให้ `member_write=true` แก่ staff | ❌ ปฏิเสธ | guard: "Only the store owner may grant member_write" |
| 3 | manager (member_write) | แก้แถว role='owner' | ❌ ปฏิเสธ | guard: "Managers cannot modify owner memberships" |
| 4 | manager (member_write) | เปลี่ยน `store_id` | ❌ ปฏิเสธ | guard: "store_memberships.store_id is immutable" |
| 5 | manager (member_write) | เปลี่ยน `profile_id` | ❌ ปฏิเสธ | guard: "store_memberships.profile_id is immutable" |
| 6 | manager (ไม่มี member_write) | UPDATE อะไรก็ได้ | ❌ ปฏิเสธ | USING/WITH CHECK: `is_active_store_manager(...,TRUE)` ไม่ผ่าน |
| 7 | เจ้าของร้าน | promote staff→manager หรือ manager→owner | ✅ อนุญาต (ถ้า sole-owner ไม่ถูกท้าทาย) | owner branch ของ guard + prevent_sole_owner ผ่าน |
| 8 | เจ้าของร้าน | demote/ลบ/rระงับ owner รายเดียว | ❌ ปฏิเสธ | `prevent_sole_owner_change()` |
| 9 | เจ้าของร้าน | demote owner เมื่อมี owner อื่น active | ✅ อนุญาต | prevent_sole_owner ตรวจว่ามี owner อื่น |
| 10 | ผู้ใช้ไม่มีสิทธิ์ | UPDATE | ❌ ปฏิเสธ | guard: "Not authorized to update store membership" + USING |
| 11 | service_role / SQL editor | UPDATE maintenance | ✅ อนุญาต (ข้าม actor guard) | `v_actor IS NULL` branch; sole-owner ยังบังคับ |
| 12 | manager | INSERT ให้ `member_write=true` | ❌ ปฏิเสธ | INSERT policy: `NOT (...member_write...)` |
| 13 | manager | INSERT โดยมี `permissions` คีย์แปลกปลอม | ❌ ปฏิเสธ | `validate_store_member_permissions` |
| 14 | เจ้าของร้าน | DELETE owner รายเดียว | ❌ ปฏิเสธ | `prevent_sole_owner_delete()` |
| 15 | manager | SELECT ทั้งร้าน | ✅ อนุญาต | SELECT policy |

---

## 10. ข้อจำกัดและคำแนะนำก่อนนำไปใช้จริง

1. **ห้าม deploy หรือรัน SQL กับ production โดยตรง** — ให้นำไฟล์ที่แก้แล้วไปทดสอบบน staging/supabase local ที่มี schema เหมือน production ก่อน (สอดคล้องข้อกำหนดข้อ 10)
2. ไม่มีเครื่องมือ PostgreSQL (`psql`/`postgres`) ในสภาพแวดล้อมนี้ จึงตรวจ syntax ด้วยการอ่านโค้ดเป็นการแทน ก่อนใช้จริงควรรันบน staging เพื่อยืนยันว่าไม่มี syntax/semantic error
3. ตรวจสอบว่า `service_role` ต้องการเข้าถึง `store_memberships` หรือไม่ — หากใน production มีการใช้ service_role เข้าถึงตารางนี้ ควรพิจารณาเติม `GRANT` ให้สอดคล้องกับรูปแบบใน 003 (รายงานนี้ **ไม่ได้** เพิ่ม grant ใด ๆ ตามข้อจำกัด "ห้ามลดความเข้มงวดของ Security")
4. หลัง migrate บน staging ให้รันทั้ง 15 เคสในตารางหัวข้อ 9 และ:
   - ทดสอบว่า RLS ไม่วนลูป (recursion) ระหว่าง `store_memberships` กับ `conversations`
   - ทดสอบ concurrent update ของสมาชิกคนเดียวกัน (ควรได้ผลถูกต้องด้วย BEFORE ROW trigger)
   - ทดสอบ `auth.uid()` เป็น NULL กรณี service_role (ต้องไม่ถูกบล็อกโดย actor guard)
5. ตรวจสอบว่า `trg_prevent_sole_owner_update` รันก่อน `trg_store_memberships_guard_update` (เรียงตามชื่อ) และ error message ของ sole-owner ยังปรากฏถูกต้อง

---

**สรุป:** ปัญหา `42P01` เกิดจากนโยบาย `store_memberships_update` อ้างอิง `OLD`/`NEW` ใน `WITH CHECK` ซึ่งไม่มีตัวแปรเหล่านั้นในบริบท policy แก้โดยย้ายเงื่อนไขเปรียบเทียบ OLD/NEW ทั้งหมด (`store_id`/`profile_id` immutable, manager ห้ามเปลี่ยน role/ให้ member_write/แตะ owner, owner-only role change, sole-owner defense-in-depth) ไปยัง BEFORE UPDATE TRIGGER ใหม่ `store_memberships_guard_update()` ที่เข้าถึง OLD/NEW ได้โดยตรง และเขียนนโยบายใหม่ให้แยก `USING` (แถวเดิม) กับ `WITH CHECK` (แถวใหม่) อย่างถูกต้อง โดยไม่ลดความเข้มงวดของ RLS/Security — คงการป้องกัน sole owner (`prevent_sole_owner_*`), fail-closed `jsonb_bool`/`validate_store_member_permissions`, และคง `SECURITY DEFINER`/`search_path` ของฟังก์ชันเดิมทั้งหมด
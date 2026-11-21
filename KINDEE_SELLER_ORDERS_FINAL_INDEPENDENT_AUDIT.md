# KINDEE Seller Orders — Final Independent Re-Audit Report

**Date:** 2026-11-18  
**Scope:** Seller Orders feature (frontend `/seller/orders`, backend routes/services, database migration, RLS, triggers)  
**Mode:** Read-only source code verification + static checks + test execution (no edits, no deploys, no env changes)

---

## Executive Summary

All **7 original FAIL items** from the independent audit have been **verified fixed in source code**. The remediation is technically sound and complete at the application layer.

**However:** The critical database migration `012_update_store_order_status_with_reason.sql` **has not been deployed to production**. Without it, the RPC function `update_store_order_status_with_reason()` does not exist, and the trigger-based fallback writes a static reason (`'Store order status updated'`) instead of the seller-provided reason.

**Final Verdict:** **BLOCKED — WAITING FOR MIGRATION DEPLOYMENT / VERIFICATION**

---

## Verification Results by Audit Checklist

| # | Topic | Original Status | Re-Audit Status | Evidence |
|---|-------|-----------------|-----------------|----------|
| 1 | Multi-store Support | FAIL | **PASS** | `storeRoutes.js:116-123` returns array; `SellerOrders.jsx:72-73,223-239` store selector; `SellerDashboard.jsx:116-131` selector |
| 2 | Authorization (list/detail/history/update) | FAIL | **PASS** | `orderRoutes.js:147,170,137` `authorize('seller','admin','owner')`; new `GET /store-orders/:storeOrderId/history` with ownership check; `/orders/:id/history` now verifies store ownership for sellers |
| 3 | Order Status Transitions (incl. `in_transit→failed`) | FAIL | **PASS** | `orderRoutes.js:171` validator includes `'failed'`; `orderService.js:593` service allows `in_transit→failed` |
| 4 | Rejection Reason Persistence | FAIL | **PASS (Code)** / **BLOCKED (DB)** | `orderService.js:614-620` passes `notes` to RPC; Migration 012 lines 70-78 inserts actual reason; trigger skips via `app.skip_history_trigger` (012:105-109); Frontend prompts for both cancelled/failed (SellerOrders.jsx:140-144) |
| 5 | Order Details Display (amounts, items, address, payment, notes) | FAIL | **PASS** | `formatCurrency` (SellerOrders.jsx:51-55); `formatAddress` (57-67); `customer_notes` in query (orderService.js:493) & display (SellerOrders.jsx:313-318); `PAYMENT_STATUS_LABELS` (43-49); status badges (SellerOrders.css:32-42) |
| 6 | UX/API (loading, empty, error, refresh, double-submit) | PASS* | **PASS** | Per-card `actionLoading` (83,273,325), `historyLoading` (82,274,334), `refreshLoading` (84,256); empty state (268); double-click prevention via `actionLoading[storeOrderId]` |
| 7 | History Fetch & API Errors | FAIL | **PASS** | New seller-specific endpoint `GET /store-orders/:storeOrderId/history` (orderRoutes.js:137-144, orderService.js:691-725); per-card history loading; error handling per action |
| 8 | Responsive & Route Integration | PASS* | **PASS** | Three breakpoints (SellerOrders.css:56-84); route `/seller/orders` with `allowedRoles={["seller","admin","owner"]}` (App.jsx:69); SellerDashboard link |
| 9 | Automated Tests | NOT VERIFIED | **PASS (Existing)** | 207 backend tests pass; no new Seller Orders specific tests added (as expected — remediation report documented test cases for CI/CD) |

---

## Detailed Findings

### 1. Multi-store Support — **PASS**
**Files:** `backend/routes/storeRoutes.js:116-123`, `frontend/src/pages/SellerOrders.jsx:72-73,87-111,223-239`, `frontend/src/pages/SellerDashboard.jsx:116-131`, `frontend/src/api/product.js:37`

- `/stores/owner/me` now returns `stores` array (was `stores[0] || null`)
- Frontend loads all stores on mount, auto-selects first, shows dropdown when `stores.length > 1`
- `fetchOrders()` uses `selectedStoreId`
- SellerDashboard mirrors same pattern

### 2. Authorization — **PASS**
**Files:** `backend/routes/orderRoutes.js:99-144,147,170`, `backend/services/orderService.js:473-484,569-585,691-725`

| Endpoint | Roles Allowed | Ownership Check |
|----------|---------------|-----------------|
| `GET /orders/store/:storeId` | seller, admin, owner | `store.owner_id === ownerId` (service:483) |
| `PATCH /store-orders/:storeOrderId/status` | seller, admin, owner | `store.owner_id === ownerId` (service:583) |
| `GET /orders/:id/history` | seller, admin, owner, customer | Seller: verifies store_order ownership (route:102-116) |
| `GET /store-orders/:storeOrderId/history` | seller, admin, owner | `store.owner_id === ownerId` (service:707) |

**Fixed:** Admin/owner can now access seller endpoints (was 403). Seller can view history of customer orders from their store.

### 3. Order Status Transitions — **PASS**
**Files:** `backend/routes/orderRoutes.js:171`, `backend/services/orderService.js:587-597`

- Route validator: `['confirmed','preparing','ready_for_pickup','picked_up','in_transit','delivered','cancelled','failed']`
- Service `validTransitions`: `in_transit: ['delivered', 'failed']` — matches UI mapping
- **Parity achieved** — UI "ล้มเหลว" button for `in_transit` now works end-to-end

### 4. Rejection Reason Persistence — **PASS (Application Code) / BLOCKED (Requires Migration Deploy)**
**Files:** `backend/services/orderService.js:614-620`, `supabase/migrations/012_update_store_order_status_with_reason.sql:70-78,105-109`, `frontend/src/pages/SellerOrders.jsx:140-144`

**Application Layer (Verified):**
- `updateStoreOrderStatus()` computes `reasonForHistory = notes && (cancelled||failed) ? notes : null`
- Calls `supabaseAdmin.rpc('update_store_order_status_with_reason', { p_store_order_id, p_new_status, p_reason: reasonForHistory })`
- Frontend prompts for reason on both `cancelled` and `failed` transitions

**Database Layer (Migration 012 — Not Deployed):**
```sql
-- RPC inserts actual reason into history
INSERT INTO order_status_history (order_id, store_order_id, from_status, to_status, changed_by, reason)
VALUES (v_parent_order_id, p_store_order_id, v_old_status, p_new_status, v_actor_id, COALESCE(p_reason, 'Store order status updated'));

-- Trigger respects skip flag
skip_trigger := current_setting('app.skip_history_trigger', true) = 'true';
```
**Without migration deployed:** RPC missing → service call fails → fallback to direct UPDATE would trigger old trigger with static reason.

### 5. Order Details Display — **PASS**
**Files:** `frontend/src/pages/SellerOrders.jsx`, `backend/services/orderService.js:492-494`

| Field | Before | After | Verified |
|-------|--------|-------|----------|
| Amounts | Raw numbers | `formatCurrency()` Thai locale, 2dp + "บาท" | ✅ |
| Address | `JSON.stringify()` | `formatAddress()` human-readable | ✅ |
| Payment Status | Raw enum | `PAYMENT_STATUS_LABELS` Thai mapping | ✅ |
| Customer Notes | Not selected | Selected in query (`customer_notes`), displayed | ✅ |
| Status Badge | Basic | Semantic colors per status (CSS) | ✅ |

### 6. UX/API Improvements — **PASS**
**Files:** `frontend/src/pages/SellerOrders.jsx`

- Per-card loading: `actionLoading[storeOrderId]`, `historyLoading[parentOrderId]`
- Refresh button disabled during fetch (`refreshLoading`)
- Double-submit prevention: buttons disabled while `actionLoading[storeOrderId]`
- Error messages contextual (per action, not global-only)
- Empty state: "ยังไม่มีออเดอร์ในสถานะที่เลือก"
- Search filters by order number, customer name, product names

### 7. Responsive Design — **PASS**
**File:** `frontend/src/pages/SellerOrders.css:56-84`

| Breakpoint | Changes |
|------------|---------|
| ≥1024px (Desktop) | Full layout, multi-column meta, min-width buttons |
| 768-1023px (Tablet) | Condensed meta, smaller buttons, `seller-order-meta` row wrap |
| ≤767px (Mobile) | Stacked filters, vertical actions, stacked history rows, full-width store selector, `seller-order-item` column |

### 8. Migration 012 — Special Security Audit

| Check | Status | Evidence |
|-------|--------|----------|
| Atomic Transaction | **PASS** | Single PL/pgSQL function, all operations in one block |
| Verifies Caller & Store Owner in DB | **PASS** | Lines 19-27 (JOIN stores), 40-48 (JWT `sub` or fallback to store owner) |
| Does Not Trust Client `store_id` | **PASS** | Only `p_store_order_id` accepted; owner looked up internally |
| Prevents Unauthorized RPC Calls | **PASS** | `GRANT EXECUTE ... TO service_role` only (line 92) |
| SECURITY DEFINER | **PASS** | Line 89: `LANGUAGE plpgsql SECURITY DEFINER` |
| search_path Safety | **PARTIAL** | Not explicitly set; SECURITY DEFINER runs with owner privileges. Acceptable as function only accesses qualified tables. |
| Records Reason & History | **PASS** | Lines 70-78 insert with `COALESCE(p_reason, ...)` |
| Enforces Business Rules (Transitions) | **PASS** | Lines 32-35 validate transition, raise on invalid |
| RLS After Migration | **PASS** | RLS unchanged (002_rls_policies.sql); backend uses `supabaseAdmin` (service_role) with explicit ownership checks in service layer |

**Critical Note:** Migration grants `EXECUTE` to `service_role` only. The backend uses `supabaseAdmin` (service role key) — correct. No `authenticated` or `anon` grants.

### 9. RLS & Triggers — **PASS (No Regression)**
**File:** `supabase/migrations/002_rls_policies.sql:254-307,329-345`

- `store_orders`: Owner SELECT/UPDATE via `stores.owner_id = auth.uid()` — aligned with backend checks
- `order_status_history`: Accessible via store_order ownership (lines 329-345) — supports new history endpoint
- Trigger `log_store_order_status_change` updated by Migration 012 to respect `app.skip_history_trigger` — no duplicate history entries

### 10. Static Checks & Tests — **ALL PASS**

| Check | Command | Result |
|-------|---------|--------|
| Backend Syntax | `node --check backend/routes/orderRoutes.js backend/services/orderService.js backend/routes/storeRoutes.js backend/services/storeService.js` | ✅ PASS (no output = success) |
| Frontend Build | `npm --prefix frontend run build` | ✅ PASS (3.44s, 709kB JS, 180kB CSS) |
| Backend Tests | `npm --prefix backend test` | ✅ 207 PASS, 0 FAIL |

---

## Production Readiness Assessment

| Component | Status | Notes |
|-----------|--------|-------|
| Backend Routes | ✅ Ready | Syntax OK, authorization fixed, new endpoints added |
| Backend Services | ✅ Ready | Logic correct, RPC integration ready |
| Frontend Pages | ✅ Ready | Build passes, multi-store, formatting, UX all implemented |
| API Layer | ✅ Ready | New `getStoreOrderHistory`, `updateStoreOrderStatus` with notes |
| Database Migration (012) | ❌ **NOT DEPLOYED** | **Blocking** — RPC function missing in production |
| RLS Policies | ✅ Compatible | No changes needed; existing policies support new flows |
| Automated Tests | ✅ Passing | 207/207 pass; no Seller Orders specific tests (documented for CI/CD) |

---

## Blocking Items for Production Approval

| # | Item | Required Action |
|---|------|-----------------|
| 1 | **Deploy Migration 012** | Run `supabase db push --include-all` or apply `012_update_store_order_status_with_reason.sql` to production database |
| 2 | **Verify RPC Exists** | `psql -c "\df update_store_order_status_with_reason"` |
| 3 | **Test RPC Call** | `SELECT update_store_order_status_with_reason('valid-uuid', 'cancelled', 'Test reason');` |
| 4 | **Confirm History Reason** | Verify `order_status_history.reason` stores actual seller reason, not static text |

---

## Regression Check

| Area | Status | Notes |
|------|--------|-------|
| Customer Order History | ✅ Unchanged | `/orders/:id/history` still works for customers (falls through to customer check at route:126-128) |
| Admin/All Orders | ✅ Unchanged | `/admin/all` endpoint untouched |
| Delivery/Courier Flows | ✅ Unchanged | No modifications to delivery routes/services |
| Chat/Call Features | ✅ Unchanged | No modifications |
| Payment/Refund | ✅ Unchanged | No modifications |

---

## Final Verdict

### **BLOCKED — WAITING FOR MIGRATION DEPLOYMENT / VERIFICATION**

**Reason:** All application-layer fixes are **verified complete and correct**. However, the database migration `012_update_store_order_status_with_reason.sql` **has not been deployed to production**. Without it:

1. The RPC function `update_store_order_status_with_reason()` does not exist
2. `orderService.updateStoreOrderStatus()` will throw an error when calling the missing RPC
3. Even if fallback logic existed, the trigger would write static reason `'Store order status updated'`

**Once Migration 012 is deployed and verified in production**, the status upgrades to:

> **READY FOR PRODUCTION APPROVAL**

---

## Audit Independence Statement

This re-audit was conducted by:
- Reading **actual source code** (not trusting remediation report claims)
- Running **static syntax checks** and **production builds**
- Executing **full backend test suite** (207 tests)
- Verifying **database migration SQL** logic and security properties
- Checking **RLS policies** for compatibility
- **No source code modifications**, **no deployments**, **no environment changes** were made during this audit

All findings are evidence-based with file paths and line numbers.

---

*Report generated: 2026-11-18T13:33:45Z*  
*Auditor: Independent Re-Audit (Kilo)*
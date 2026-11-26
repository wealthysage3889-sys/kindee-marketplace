# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: location-route-panel.spec.js >> Store Owner Chat Route Panel E2E >> should show GPS route with distance on desktop
- Location: tests\location-route-panel.spec.js:125:3

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  1   | // Kindee Marketplace — Local Browser E2E Tests (Playwright)
  2   | // Scope: Route Panel, Location Flow, IP Approximate Location
  3   | // Restrictions: Local only, no production access, no code modification,
  4   | // no Auth/Socket/Realtime/Call State/Database modification.
  5   | // Test data: mock/test data only, no real customer IPs.
  6   | 
  7   | import { test, expect } from '@playwright/test';
  8   | 
  9   | const API_BASE = 'http://localhost:5000/api';
  10  | 
  11  | // Helper: register a user via API using page.request
  12  | async function registerUser(page, role = 'customer') {
  13  |   const email = `e2e_${Date.now()}@example.com`;
  14  |   const res = await page.request.post(`${API_BASE}/auth/register`, {
  15  |     data: { email, password: 'TestPass123!', name: 'E2E User', role },
  16  |   });
> 17  |   expect(res.ok()).toBeTruthy();
      |                    ^ Error: expect(received).toBeTruthy()
  18  |   return { email, password: 'TestPass123!' };
  19  | }
  20  | 
  21  | // Helper: login via API and return token data
  22  | async function loginUser(page, email, password) {
  23  |   const res = await page.request.post(`${API_BASE}/auth/login`, {
  24  |     data: { emailOrPhone: email, password },
  25  |   });
  26  |   expect(res.ok()).toBeTruthy();
  27  |   const data = await res.json();
  28  |   return data.data;
  29  | }
  30  | 
  31  | // Helper: create a store (seller only)
  32  | async function createStore(page, accessToken, storeData) {
  33  |   const res = await page.request.post(`${API_BASE}/stores`, {
  34  |     headers: { Authorization: `Bearer ${accessToken}` },
  35  |     data: storeData,
  36  |   });
  37  |   expect(res.ok()).toBeTruthy();
  38  |   const data = await res.json();
  39  |   return data.data;
  40  | }
  41  | 
  42  | // Helper: create a conversation
  43  | async function createConversation(page, accessToken, storeId, storeOrderId = null) {
  44  |   const body = { storeId };
  45  |   if (storeOrderId !== null) body.storeOrderId = storeOrderId;
  46  |   const res = await page.request.post(`${API_BASE}/chat/conversations`, {
  47  |     headers: { Authorization: `Bearer ${accessToken}` },
  48  |     data: body,
  49  |   });
  50  |   expect(res.ok()).toBeTruthy();
  51  |   const data = await res.json();
  52  |   return data.data;
  53  | }
  54  | 
  55  | // Helper: set auth in browser localStorage
  56  | async function setAuth(page, mode, token, user) {
  57  |   await page.evaluate(([tokenKey, userKey, tokenVal, userVal]) => {
  58  |     localStorage.setItem(tokenKey, tokenVal);
  59  |     localStorage.setItem(userKey, JSON.stringify(userVal));
  60  |   }, [`kindee:${mode}:token`, `kindee:${mode}:user`, token, user]);
  61  | }
  62  | 
  63  | test.describe('Store Owner Chat Route Panel E2E', () => {
  64  |   test('should open and close ChatRoutePanel on desktop', async ({ page }) => {
  65  |     const consoleErrors = [];
  66  |     const failedRequests = [];
  67  |     page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  68  |     page.on('requestfailed', req => { if (req.url().startsWith(API_BASE)) failedRequests.push(req.url()); });
  69  | 
  70  |     // Register and login as store owner (seller role)
  71  |     const { email, password } = await registerUser(page, 'seller');
  72  |     const session = await loginUser(page, email, password);
  73  | 
  74  |     // Create a store with coordinates
  75  |     const store = await createStore(page, session.accessToken, {
  76  |       name: 'E2E Test Store',
  77  |       description: 'E2E test store',
  78  |       address: {
  79  |         street: '123 Test Street',
  80  |         district: 'Test District',
  81  |         province: 'Bangkok',
  82  |         postalCode: '10000',
  83  |         coordinates: { lat: 13.7563, lng: 100.5018 },
  84  |       },
  85  |       phone: '0812345678',
  86  |       email,
  87  |     });
  88  | 
  89  |     // Create conversation as customer
  90  |     const { email: custEmail } = await registerUser(page, 'customer');
  91  |     const custSession = await loginUser(page, custEmail, 'TestPass123!');
  92  | 
  93  |     const conv = await createConversation(page, custSession.accessToken, store.id);
  94  | 
  95  |     // Set admin auth in browser and navigate
  96  |     await page.goto('/');
  97  |     await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
  98  |     await page.goto(`/selladmin/messages/${conv.id}`);
  99  |     await page.waitForURL(`/selladmin/messages/${conv.id}`);
  100 | 
  101 |     // Click map button to open route panel
  102 |     const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"], [aria-label="ดูเส้นทาง"]').first();
  103 |     await expect(mapBtn).toBeVisible();
  104 |     await mapBtn.click();
  105 | 
  106 |     // Route panel should be open
  107 |     const routePanel = page.locator('.chat-route-panel, [role="dialog"]').first();
  108 |     await expect(routePanel).toBeVisible();
  109 | 
  110 |     // Check map container
  111 |     const mapContainer = page.locator('.chat-route-map').first();
  112 |     await expect(mapContainer).toBeVisible();
  113 | 
  114 |     // Close the panel
  115 |     const closeBtn = page.locator('.chat-route-close, [aria-label="ปิดแผนที่"]').first();
  116 |     await closeBtn.click();
  117 |     await expect(routePanel).not.toBeVisible();
```
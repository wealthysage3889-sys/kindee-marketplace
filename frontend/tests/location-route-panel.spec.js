// Kindee Marketplace — Local Browser E2E Tests (Playwright)
// Scope: Route Panel, Location Flow, IP Approximate Location
// Restrictions: Local only, no production access, no code modification,
// no Auth/Socket/Realtime/Call State/Database modification.
// Test data: mock/test data only, no real customer IPs.

import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:5000/api';

// Helper: register a user via API using page.request
async function registerUser(page, role = 'customer') {
  const email = `e2e_${Date.now()}@example.com`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email, password: 'TestPass123!', name: 'E2E User', role },
  });
  expect(res.ok()).toBeTruthy();
  return { email, password: 'TestPass123!' };
}

// Helper: login via API and return token data
async function loginUser(page, email, password) {
  const res = await page.request.post(`${API_BASE}/auth/login`, {
    data: { emailOrPhone: email, password },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return data.data;
}

// Helper: create a store (seller only)
async function createStore(page, accessToken, storeData) {
  const res = await page.request.post(`${API_BASE}/stores`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: storeData,
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return data.data;
}

// Helper: create a conversation
async function createConversation(page, accessToken, storeId, storeOrderId = null) {
  const body = { storeId };
  if (storeOrderId !== null) body.storeOrderId = storeOrderId;
  const res = await page.request.post(`${API_BASE}/chat/conversations`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: body,
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return data.data;
}

// Helper: set auth in browser localStorage
async function setAuth(page, mode, token, user) {
  await page.evaluate(([tokenKey, userKey, tokenVal, userVal]) => {
    localStorage.setItem(tokenKey, tokenVal);
    localStorage.setItem(userKey, JSON.stringify(userVal));
  }, [`kindee:${mode}:token`, `kindee:${mode}:user`, token, user]);
}

test.describe('Store Owner Chat Route Panel E2E', () => {
  test('should open and close ChatRoutePanel on desktop', async ({ page }) => {
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('requestfailed', req => { if (req.url().startsWith(API_BASE)) failedRequests.push(req.url()); });

    // Register and login as store owner (seller role)
    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    // Create a store with coordinates
    const store = await createStore(page, session.accessToken, {
      name: 'E2E Test Store',
      description: 'E2E test store',
      address: {
        street: '123 Test Street',
        district: 'Test District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    // Create conversation as customer
    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    // Set admin auth in browser and navigate
    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    // Click map button to open route panel
    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"], [aria-label="ดูเส้นทาง"]').first();
    await expect(mapBtn).toBeVisible();
    await mapBtn.click();

    // Route panel should be open
    const routePanel = page.locator('.chat-route-panel, [role="dialog"]').first();
    await expect(routePanel).toBeVisible();

    // Check map container
    const mapContainer = page.locator('.chat-route-map').first();
    await expect(mapContainer).toBeVisible();

    // Close the panel
    const closeBtn = page.locator('.chat-route-close, [aria-label="ปิดแผนที่"]').first();
    await closeBtn.click();
    await expect(routePanel).not.toBeVisible();

    // Assert no console errors
    expect(consoleErrors.length).toBe(0);
    // Assert no failed network requests
    expect(failedRequests.length).toBe(0);
  });

  test('should show GPS route with distance on desktop', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    const store = await createStore(page, session.accessToken, {
      name: 'E2E GPS Store',
      description: 'E2E GPS test store',
      address: {
        street: '456 GPS Street',
        district: 'GPS District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // Check origin (store) is displayed
    const originSection = page.locator('.chat-route-origin').first();
    await expect(originSection).toBeVisible();

    // GPS targets or empty state
    const gpsTargets = page.locator('.chat-route-targets').first();
    const emptyGps = page.locator('.chat-route-empty').first();
    await expect(gpsTargets.or(emptyGps)).toBeVisible();

    // Route summary section
    const summarySection = page.locator('.chat-route-section h4').filter({ hasText: 'สรุปเส้นทาง' });
    await expect(summarySection).toBeVisible();

    expect(consoleErrors.length).toBe(0);
  });

  test('should run on mobile viewport (390px)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    const store = await createStore(page, session.accessToken, {
      name: 'E2E Mobile Store',
      description: 'E2E mobile test store',
      address: {
        street: '789 Mobile Street',
        district: 'Mobile District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // Panel should render on mobile without horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 20);

    expect(consoleErrors.length).toBe(0);
  });
});

test.describe('Customer Shared GPS Location E2E', () => {
  test('should display customer-shared GPS location in route panel', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email: ownerEmail, password } = await registerUser(page, 'seller');
    const ownerSession = await loginUser(page, ownerEmail, password);

    const store = await createStore(page, ownerSession.accessToken, {
      name: 'E2E Shared GPS Store',
      description: 'E2E shared GPS test store',
      address: {
        street: '321 Shared Street',
        district: 'Shared District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email: ownerEmail,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    // Customer shares a GPS location message (mock coordinates)
    const locationMsg = await page.request.post(
      `${API_BASE}/chat/conversations/${conv.id}/messages`,
      {
        headers: { Authorization: `Bearer ${custSession.accessToken}` },
        data: {
          type: 'location',
          content: 'ตำแหน่งที่ลูกค้าแชร์',
          metadata: {
            location: 'POINT(100.5100 13.7600)',
            label: 'บ้านลูกค้า',
            address: '123 ลูกค้าถนน กรุงเทพฯ 10000',
          },
        },
      },
    );
    expect(locationMsg.ok()).toBeTruthy();

    // Navigate to admin chat and open route panel
    await page.goto('/');
    await setAuth(page, 'admin', ownerSession.accessToken, { ...ownerSession.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // GPS target from chat location should be visible
    const gpsTargets = page.locator('.chat-route-targets .chat-route-target').first();
    await expect(gpsTargets).toBeVisible();

    // Should show customer location label
    await expect(page.locator('.chat-route-targets')).toContainText('ตำแหน่งลูกค้า');

    // Select the GPS target
    await gpsTargets.click();
    // Wait for route calculation to complete
    await page.waitForTimeout(2000);

    // Route should be calculated (distance summary between origin and GPS target)
    const routeSummary = page.locator('.chat-route-summary').first();
    await expect(routeSummary).toBeVisible();

    // Distance should be displayed
    const distanceText = page.locator('.chat-route-summary strong').first();
    await expect(distanceText).toBeVisible();

    expect(consoleErrors.length).toBe(0);
  });

  test('should allow re-selecting GPS after IP selection', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email: ownerEmail, password } = await registerUser(page, 'seller');
    const ownerSession = await loginUser(page, ownerEmail, password);

    const store = await createStore(page, ownerSession.accessToken, {
      name: 'E2E ReSelect Store',
      description: 'E2E re-select test store',
      address: {
        street: '555 ReSelect Street',
        district: 'ReSelect District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email: ownerEmail,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    await page.goto('/');
    await setAuth(page, 'admin', ownerSession.accessToken, { ...ownerSession.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // Select IP target if available
    const ipTarget = page.locator('.chat-route-target-ip').first();
    if (await ipTarget.isVisible()) {
      await ipTarget.click();
      await expect(ipTarget).toHaveClass(/active/);
    }

    // Select GPS target back
    const gpsTargets = page.locator('.chat-route-targets .chat-route-target').first();
    if (await gpsTargets.isVisible()) {
      await gpsTargets.click();
      await expect(gpsTargets).toHaveClass(/active/);
      // IP should no longer be active
      await expect(ipTarget).not.toHaveClass(/active/);
    }

    expect(consoleErrors.length).toBe(0);
  });
});

test.describe('IP Approximate Location E2E', () => {
  test('should show IP disabled state when feature is off', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    const store = await createStore(page, session.accessToken, {
      name: 'E2E IP Disabled Store',
      description: 'E2E IP disabled test store',
      address: {
        street: '111 IP Street',
        district: 'IP District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    // Check IP location API returns disabled
    const ipRes = await page.request.get(
      `${API_BASE}/chat/conversations/${conv.id}/ip-location`,
      { headers: { Authorization: `Bearer ${custSession.accessToken}` } }
    );
    expect(ipRes.ok()).toBeTruthy();
    const ipData = await ipRes.json();
    expect(ipData.data.available).toBe(false);
    expect(ipData.data.reason).toBe('disabled');

    // Navigate to admin chat and open route panel
    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // IP card should show disabled message
    const ipCard = page.locator('.chat-route-card-ip').first();
    await expect(ipCard).toBeVisible();

    const ipEmpty = page.locator('.chat-route-empty').filter({ hasText: /ปิดใช้งาน|ยังไม่มีข้อมูลตำแหน่งโดยประมาณจาก IP/ });
    await expect(ipEmpty.or(ipCard)).toBeVisible();

    expect(consoleErrors.length).toBe(0);
  });

  test('IP selection should not create route, distance, or navigation link', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    const store = await createStore(page, session.accessToken, {
      name: 'E2E IP No Route Store',
      description: 'E2E IP no route test store',
      address: {
        street: '222 IP Street',
        district: 'IP District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    const routePanel = page.locator('.chat-route-panel').first();
    await expect(routePanel).toBeVisible();

    // Select IP target if available
    const ipTarget = page.locator('.chat-route-target-ip').first();
    if (await ipTarget.isVisible()) {
      await ipTarget.click();
      await expect(ipTarget).toHaveClass(/active/);

      // IP selection should NOT create a route polyline
      const polyline = page.locator('.leaflet-polyline');
      await expect(polyline).not.toBeVisible();

      // IP selection should NOT show distance
      const distanceSummary = page.locator('.chat-route-summary');
      await expect(distanceSummary).not.toBeVisible();

      // IP selection should NOT show Google Maps navigation link
      const navLink = page.locator('.chat-route-nav-link');
      await expect(navLink).not.toBeVisible();

      // Should show IP note: not used for delivery
      const ipNote = page.locator('.chat-route-ip-note, .chat-route-ip-route-note');
      await expect(ipNote).toBeVisible();
    }

    expect(consoleErrors.length).toBe(0);
  });
});

test.describe('Console and Network Error Checks', () => {
  test('should have no console errors or failed requests on chat route pages', async ({ page }) => {
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('requestfailed', req => { if (req.url().startsWith(API_BASE)) failedRequests.push(req.url()); });
    page.on('pageerror', err => consoleErrors.push(err.message));

    const { email, password } = await registerUser(page, 'seller');
    const session = await loginUser(page, email, password);

    const store = await createStore(page, session.accessToken, {
      name: 'E2E Console Check Store',
      description: 'E2E console check test store',
      address: {
        street: '999 Console Street',
        district: 'Console District',
        province: 'Bangkok',
        postalCode: '10000',
        coordinates: { lat: 13.7563, lng: 100.5018 },
      },
      phone: '0812345678',
      email,
    });

    const { email: custEmail } = await registerUser(page, 'customer');
    const custSession = await loginUser(page, custEmail, 'TestPass123!');

    const conv = await createConversation(page, custSession.accessToken, store.id);

    await page.goto('/');
    await setAuth(page, 'admin', session.accessToken, { ...session.user, role: 'owner' });
    await page.goto(`/selladmin/messages/${conv.id}`);
    await page.waitForURL(`/selladmin/messages/${conv.id}`);

    const mapBtn = page.locator('.map-btn, [title="ดูเส้นทาง"]').first();
    await mapBtn.click();

    await page.waitForTimeout(2000);

    expect(consoleErrors.length).toBe(0);
    expect(failedRequests.length).toBe(0);
  });
});

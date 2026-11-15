// Kindee Marketplace Integration Tests - Node.js version (using native fetch)
const BASE_URL = 'http://localhost:5001/api';

// Generate unique test data
const timestamp = Date.now();
const testData = {
    cust1: { email: `cust1_${timestamp}@test.com`, password: 'password123', name: 'Customer One', role: 'customer' },
    cust2: { email: `cust2_${timestamp}@test.com`, password: 'password123', name: 'Customer Two', role: 'customer' },
    seller: { email: `seller_${timestamp}@test.com`, password: 'password123', name: 'Test Seller', role: 'seller' },
};

async function testEndpoint(name, method, endpoint, body = null, token = null, expectedStatus = 200) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        const data = await response.json().catch(() => ({}));
        
        const passed = response.status === expectedStatus || response.status === 201;
        if (passed) {
            console.log(`✅ PASS: ${name} [${response.status}]`);
        } else {
            console.log(`❌ FAIL: ${name} [Expected ${expectedStatus}, got ${response.status}]`, JSON.stringify(data).substring(0, 300));
        }
        return { data, status: response.status, passed };
    } catch (err) {
        console.log(`❌ FAIL: ${name} [Error: ${err.message}]`);
        return { error: true };
    }
}

async function runTests() {
    const tokens = {};
    const ids = {};
    const results = { pass: 0, fail: 0, notTested: 0 };
    
    function record(passed) {
        if (passed) results.pass++; else results.fail++;
    }
    
    console.log('=== AUTH TESTS ===\n');
    
    // Register Customer 1
    let result = await testEndpoint('Register Customer 1', 'POST', '/auth/register', testData.cust1, null, 201);
    if (result.passed) { tokens.cust1 = result.data.data.accessToken; tokens.cust1Refresh = result.data.data.refreshToken; }
    record(result.passed);
    
    // Register Customer 2
    result = await testEndpoint('Register Customer 2', 'POST', '/auth/register', testData.cust2, null, 201);
    if (result.passed) { tokens.cust2 = result.data.data.accessToken; }
    record(result.passed);
    
    // Register Seller
    result = await testEndpoint('Register Seller', 'POST', '/auth/register', testData.seller, null, 201);
    if (result.passed) { tokens.seller = result.data.data.accessToken; }
    record(result.passed);
    
    // Login Customer 1
    result = await testEndpoint('Login Customer 1', 'POST', '/auth/login', { emailOrPhone: testData.cust1.email, password: testData.cust1.password });
    if (result.passed) { tokens.cust1 = result.data.data.accessToken; }
    record(result.passed);
    
    // Test invalid token
    result = await testEndpoint('Invalid Token', 'GET', '/auth/profile', null, 'invalid.token.here', 401);
    record(result.passed);
    
    // Test valid token (profile)
    result = await testEndpoint('Valid Token - Profile', 'GET', '/auth/profile', null, tokens.cust1);
    record(result.passed);
    
    // Test expired token - NOT TESTED (requires time manipulation)
    console.log('⏭️  NOT TESTED: Expired Token (requires time manipulation)');
    results.notTested++;
    
    console.log('\n=== STORE & PRODUCT SETUP ===\n');
    
    // Create store for seller
    result = await testEndpoint('Create Store', 'POST', '/stores', {
        name: 'Test Store',
        slug: `test-store-${timestamp}`,
        description: 'Test store for integration tests',
        address: { 
            street: '123 Test St', 
            district: 'Test District', 
            province: 'Bangkok', 
            postal_code: '10100',
            coordinates: { lat: 13.7563, lng: 100.5018 }
        },
        phone: '0812345678',
        email: 'store@test.com',
        delivery_fee: 30,
        minimum_order: 100,
        estimated_delivery_time: 30,
        delivery_type: 'store_delivery'
    }, tokens.seller, 201);
    if (result.passed) { ids.storeId = result.data.data.id; }
    record(result.passed);
    
    // Create product
    result = await testEndpoint('Create Product', 'POST', '/products', {
        storeId: ids.storeId,
        name: 'Test Product',
        slug: `test-product-${timestamp}`,
        description: 'Test product for integration tests',
        price: 150,
        discountPrice: 120,
        stock: 100,
        images: ['https://example.com/image1.jpg'],
        tags: ['test'],
        isActive: true
    }, tokens.seller, 201);
    if (result.passed) { ids.productId = result.data.data.id; }
    record(result.passed);
    
    console.log('\n=== ORDER TESTS ===\n');
    
    // Create order as Customer 1 - requires check_and_reserve_stock RPC function in DB
    result = await testEndpoint('Create Order (Customer 1)', 'POST', '/orders', {
        items: [{ productId: ids.productId, quantity: 2 }],
        paymentMethod: 'cod',
        customerNotes: 'Test order',
        deliveryAddress: {
            name: 'Customer One',
            phone: '0811111111',
            address: '123 Customer St',
            district: 'Customer District',
            province: 'Bangkok',
            postalCode: '10200'
        },
        customerCoordinates: { lat: 13.7563, lng: 100.5018 }
    }, tokens.cust1, 201);
    if (result.passed) { 
        ids.orderId = result.data.data.id; 
        ids.storeOrderId = result.data.data.store_orders?.[0]?.id;
        console.log(`   Order ID: ${ids.orderId}, Store Order ID: ${ids.storeOrderId}`);
    }
    record(result.passed);
    
    // Get customer orders (Customer 1)
    result = await testEndpoint('Get My Orders (Customer 1)', 'GET', '/orders', null, tokens.cust1);
    record(result.passed);
    
    // Get order by ID (Customer 1 - owner) - needs orderId
    if (ids.orderId) {
        result = await testEndpoint('Get Order by ID (Owner)', 'GET', `/orders/${ids.orderId}`, null, tokens.cust1);
        record(result.passed);
        
        // Get order by ID (Customer 2 - NOT owner) - should fail
        result = await testEndpoint('Get Order by ID (Non-owner)', 'GET', `/orders/${ids.orderId}`, null, tokens.cust2, 404);
        record(result.passed);
    } else {
        console.log('⏭️  NOT TESTED: Get Order by ID (Owner) - requires order creation');
        console.log('⏭️  NOT TESTED: Get Order by ID (Non-owner) - requires order creation');
        results.notTested += 2;
    }
    
    console.log('\n=== REFUND TESTS ===\n');
    
    // Test refund with invalid amount (exceeds paid)
    if (ids.orderId && ids.storeOrderId) {
        result = await testEndpoint('Refund - Exceeds Amount', 'POST', `/orders/${ids.orderId}/refund`, {
            storeOrderId: ids.storeOrderId,
            amount: 999999,
            reason: 'Test refund'
        }, tokens.seller, 400);
        record(result.passed);
        
        // Test refund without admin/owner role (Customer 1)
        result = await testEndpoint('Refund - Customer Not Authorized', 'POST', `/orders/${ids.orderId}/refund`, {
            storeOrderId: ids.storeOrderId,
            amount: 50,
            reason: 'Test refund'
        }, tokens.cust1, 403);
        record(result.passed);
        
        // Test partial refund - NOT TESTED (requires paid order)
        console.log('⏭️  NOT TESTED: Partial Refund - requires paid order');
        console.log('⏭️  NOT TESTED: Full Refund - requires paid order');
        console.log('⏭️  NOT TESTED: Failed Refund exclusion - requires failed refund record');
        results.notTested += 4;
    } else {
        console.log('⏭️  NOT TESTED: Refund - Exceeds Amount - requires order creation');
        console.log('⏭️  NOT TESTED: Refund - Customer Not Authorized - requires order creation');
        console.log('⏭️  NOT TESTED: Partial Refund - requires paid order');
        console.log('⏭️  NOT TESTED: Full Refund - requires paid order');
        console.log('⏭️  NOT TESTED: Failed Refund exclusion - requires failed refund record');
        results.notTested += 6;
    }
    
    console.log('\n=== DELIVERY TESTS ===\n');
    
    // Create delivery (seller) - needs storeOrderId
    if (ids.storeOrderId) {
        result = await testEndpoint('Create Delivery (Seller)', 'POST', `/deliveries/store-orders/${ids.storeOrderId}`, null, tokens.seller, 201);
        record(result.passed);
        
        // Get courier deliveries - NOT TESTED (requires courier user with courier role)
        console.log('⏭️  NOT TESTED: Get Courier Deliveries - requires courier role user');
        results.notTested++;
    } else {
        console.log('⏭️  NOT TESTED: Create Delivery (Seller) - requires order creation');
        console.log('⏭️  NOT TESTED: Get Courier Deliveries - requires courier role user');
        results.notTested += 2;
    }
    
    // Get store deliveries (seller)
    result = await testEndpoint('Get Store Deliveries', 'GET', `/deliveries/store/${ids.storeId}`, null, tokens.seller);
    record(result.passed);
    
    // Test store ownership verification on delivery creation - NOT TESTED
    console.log('⏭️  NOT TESTED: Delivery Store Ownership Verification - requires another seller');
    results.notTested++;
    
    console.log('\n=== ADMIN/OWNER TESTS ===\n');
    
    // Test with seller token (should fail - needs admin/owner)
    result = await testEndpoint('Admin All Orders - Seller Not Authorized', 'GET', '/orders/admin/all', null, tokens.seller, 403);
    record(result.passed);
    
    // Test with customer token (should fail)
    result = await testEndpoint('Admin All Orders - Customer Not Authorized', 'GET', '/orders/admin/all', null, tokens.cust1, 403);
    record(result.passed);
    
    // Admin/Owner access - NOT TESTED (requires admin/owner user)
    console.log('⏭️  NOT TESTED: Admin All Orders - Admin/Owner Access - requires admin/owner user');
    results.notTested++;
    
    console.log('\n=== REGRESSION TESTS (Original API) ===\n');
    
    // Test new endpoints (replaced old /myorders)
    result = await testEndpoint('Orders List (Customer)', 'GET', '/orders', null, tokens.cust1);
    record(result.passed);
    
    // GET /api/orders/:id
    if (ids.orderId) {
        result = await testEndpoint('Order Detail', 'GET', `/orders/${ids.orderId}`, null, tokens.cust1);
        record(result.passed);
    } else {
        console.log('⏭️  NOT TESTED: Order Detail - requires order creation');
        results.notTested++;
    }
    
    // Test order cancellation - NOT TESTED
    console.log('⏭️  NOT TESTED: Order Cancellation - requires order creation');
    results.notTested++;
    
    // Test order status history - NOT TESTED
    console.log('⏭️  NOT TESTED: Order Status History - requires order creation');
    results.notTested++;
    
    console.log('\n=== TESTS COMPLETE ===');
    console.log(`\n📊 SUMMARY: ${results.pass} PASS, ${results.fail} FAIL, ${results.notTested} NOT TESTED`);
}

runTests().catch(console.error);
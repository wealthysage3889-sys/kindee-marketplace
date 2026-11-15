# Kindee Marketplace Integration Tests
$baseUrl = "http://localhost:5001/api"
$headers = @{ "Content-Type" = "application/json" }

function Test-Endpoint($name, $method, $endpoint, $body = $null, $token = $null, $expectedStatus = 200) {
    $h = @{ "Content-Type" = "application/json" }
    if ($token) { $h["Authorization"] = "Bearer $token" }
    
    try {
        $params = @{
            Uri         = "$baseUrl$endpoint"
            Method      = $method
            Headers     = $h
        }
        if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 5) }
        
        $response = Invoke-RestMethod @params
        $statusCode = 200
        if ($response.PSObject.Properties['StatusCode']) {
            $statusCode = $response.PSObject.Properties['StatusCode'].Value
        }
        
        if ($statusCode -eq $expectedStatus -or $statusCode -eq 201) {
            Write-Host "✅ PASS: $name [$statusCode]" -ForegroundColor Green
            return $response
        } else {
            Write-Host "❌ FAIL: $name [Expected $expectedStatus, got $statusCode]" -ForegroundColor Red
            return $null
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "❌ FAIL: $name [Status $statusCode] $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# ==================== AUTH TESTS ====================
Write-Host "=== AUTH TESTS ===" -ForegroundColor Cyan

# Register Customer 1
$cust1 = Test-Endpoint "Register Customer 1" "POST" "/auth/register" @{
    email = "cust1@test.com"
    password = "password123"
    name = "Customer One"
    role = "customer"
} $null 201
$cust1Token = $cust1.data.accessToken
$cust1Refresh = $cust1.data.refreshToken

# Register Customer 2
$cust2 = Test-Endpoint "Register Customer 2" "POST" "/auth/register" @{
    email = "cust2@test.com"
    password = "password123"
    name = "Customer Two"
    role = "customer"
} $null 201
$cust2Token = $cust2.data.accessToken

# Register Seller
$seller = Test-Endpoint "Register Seller" "POST" "/auth/register" @{
    email = "seller@test.com"
    password = "password123"
    name = "Test Seller"
    role = "seller"
} $null 201
$sellerToken = $seller.data.accessToken

# Login Customer 1
$login = Test-Endpoint "Login Customer 1" "POST" "/auth/login" @{
    emailOrPhone = "cust1@test.com"
    password = "password123"
}
$cust1Token = $login.data.accessToken

# Test invalid token
Test-Endpoint "Invalid Token" "GET" "/auth/profile" $null "invalid.token.here" 401

# ==================== STORE & PRODUCT SETUP ====================
Write-Host "`n=== STORE & PRODUCT SETUP ===" -ForegroundColor Cyan

# Create store for seller
$store = Test-Endpoint "Create Store" "POST" "/stores" @{
    name = "Test Store"
    slug = "test-store"
    description = "Test store for integration tests"
    address = @{ street = "123 Test St"; district = "Test District"; province = "Bangkok"; postal_code = "10100" }
    phone = "0812345678"
    email = "store@test.com"
    delivery_fee = 30
    minimum_order = 100
    estimated_delivery_time = 30
    delivery_type = "store_delivery"
} $sellerToken 201
$storeId = $store.data.id

# Create product
$product = Test-Endpoint "Create Product" "POST" "/products" @{
    store_id = $storeId
    name = "Test Product"
    slug = "test-product"
    description = "Test product for integration tests"
    price = 150
    discount_price = 120
    stock = 100
    images = @("https://example.com/image1.jpg")
    tags = @("test")
    is_active = $true
} $sellerToken 201
$productId = $product.data.id

# ==================== ORDER TESTS ====================
Write-Host "`n=== ORDER TESTS ===" -ForegroundColor Cyan

# Create order as Customer 1
$order = Test-Endpoint "Create Order (Customer 1)" "POST" "/orders" @{
    items = @(@{ productId = $productId; quantity = 2 })
    paymentMethod = "cod"
    customerNotes = "Test order"
    deliveryAddress = @{
        name = "Customer One"
        phone = "0811111111"
        address = "123 Customer St"
        district = "Customer District"
        province = "Bangkok"
        postalCode = "10200"
    }
    customerCoordinates = @{ lat = 13.7563; lng = 100.5018 }
} $cust1Token 201
$orderId = $order.data.id
$storeOrderId = $order.data.store_orders[0].id

# Get customer orders (Customer 1)
Test-Endpoint "Get My Orders (Customer 1)" "GET" "/orders" $null $cust1Token

# Get order by ID (Customer 1 - owner)
Test-Endpoint "Get Order by ID (Owner)" "GET" "/orders/$orderId" $null $cust1Token

# Get order by ID (Customer 2 - NOT owner) - should fail
Test-Endpoint "Get Order by ID (Non-owner)" "GET" "/orders/$orderId" $null $cust2Token 404

# ==================== REFUND TESTS ====================
Write-Host "`n=== REFUND TESTS ===" -ForegroundColor Cyan

# Test refund with invalid amount (exceeds paid)
Test-Endpoint "Refund - Exceeds Amount" "POST" "/orders/$orderId/refund" @{
    storeOrderId = $storeOrderId
    amount = 999999
    reason = "Test refund"
} $sellerToken 400

# Test refund without admin/owner role (Customer 1)
Test-Endpoint "Refund - Customer Not Authorized" "POST" "/orders/$orderId/refund" @{
    storeOrderId = $storeOrderId
    amount = 50
    reason = "Test refund"
} $cust1Token 403

# ==================== DELIVERY TESTS ====================
Write-Host "`n=== DELIVERY TESTS ===" -ForegroundColor Cyan

# Create delivery (seller)
Test-Endpoint "Create Delivery (Seller)" "POST" "/deliveries/store-orders/$storeOrderId" $null $sellerToken 201

# Register courier
$courier = Test-Endpoint "Register Courier" "POST" "/auth/register" @{
    email = "courier@test.com"
    password = "password123"
    name = "Test Courier"
    role = "courier"
} $null 201
$courierToken = $courier.data.accessToken

# Get courier deliveries
Test-Endpoint "Get Courier Deliveries" "GET" "/deliveries/courier/me" $null $courierToken

# Get store deliveries (seller)
Test-Endpoint "Get Store Deliveries" "GET" "/deliveries/store/$storeId" $null $sellerToken

# ==================== ADMIN/OWNER TESTS ====================
Write-Host "`n=== ADMIN/OWNER TESTS ===" -ForegroundColor Cyan

# Test with seller token (should fail - needs admin/owner)
Test-Endpoint "Admin All Orders - Seller Not Authorized" "GET" "/orders/admin/all" $null $sellerToken 403

# ==================== REGRESSION TESTS ====================
Write-Host "`n=== REGRESSION TESTS (Original API) ===" -ForegroundColor Cyan

# Test new endpoints (replaced old /myorders)
Test-Endpoint "Orders List (Customer)" "GET" "/orders" $null $cust1Token

# GET /api/orders/:id
Test-Endpoint "Order Detail" "GET" "/orders/$orderId" $null $cust1Token

Write-Host "`n=== TESTS COMPLETE ===" -ForegroundColor Cyan
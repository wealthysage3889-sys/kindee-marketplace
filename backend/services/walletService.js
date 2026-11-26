import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

// Get wallet summary (balance, coins, counts)
export const getWalletSummary = async (customerId) => {
  const { data, error } = await supabaseAdmin.rpc('get_wallet_summary', {
    p_customer_id: customerId
  });

  if (error) {
    throw new AppError(`Failed to get wallet summary: ${error.message}`, 500);
  }

  const result = data?.[0] || {
    balance: 0,
    coins: 0,
    voucher_count: 0,
    card_count: 0,
    bank_count: 0
  };

  return {
    balance: Number(result.balance || 0),
    coins: Number(result.coins || 0),
    voucherCount: Number(result.voucher_count || 0),
    cardCount: Number(result.card_count || 0),
    bankCount: Number(result.bank_count || 0)
  };
};

// Get wallet transactions with pagination
export const getWalletTransactions = async (customerId, { page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;

  const { data, error } = await supabaseAdmin.rpc('get_wallet_transactions', {
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset
  });

  if (error) {
    throw new AppError(`Failed to get wallet transactions: ${error.message}`, 500);
  }

  return {
    transactions: data || [],
    pagination: {
      page,
      limit,
      hasMore: (data || []).length === limit
    }
  };
};

// Get finance history with pagination
export const getFinanceHistory = async (customerId, { page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;

  const { data, error } = await supabaseAdmin.rpc('get_finance_history', {
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset
  });

  if (error) {
    throw new AppError(`Failed to get finance history: ${error.message}`, 500);
  }

  return {
    history: data || [],
    pagination: {
      page,
      limit,
      hasMore: (data || []).length === limit
    }
  };
};

// Get vouchers
export const getVouchers = async (customerId, { includeExpired = false } = {}) => {
  let query = supabaseAdmin
    .from('customer_vouchers')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (!includeExpired) {
    query = query.eq('is_active', true).gt('valid_until', new Date().toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(`Failed to get vouchers: ${error.message}`, 500);
  }

  return data || [];
};

// Get saved cards
export const getCards = async (customerId) => {
  const { data, error } = await supabaseAdmin
    .from('customer_cards')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError(`Failed to get cards: ${error.message}`, 500);
  }

  return data || [];
};

// Add a new card
export const addCard = async (customerId, cardData) => {
  const { card_token, card_last4, card_brand, card_exp_month, card_exp_year, cardholder_name, gateway = 'stripe', metadata = {} } = cardData;

  if (!card_token || !card_last4 || !card_brand || !card_exp_month || !card_exp_year) {
    throw new ValidationError('Missing required card fields');
  }

  // If this is set as default, unset other defaults
  if (cardData.is_default) {
    await supabaseAdmin
      .from('customer_cards')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_cards')
    .insert({
      customer_id: customerId,
      card_token,
      card_last4,
      card_brand,
      card_exp_month,
      card_exp_year,
      cardholder_name,
      is_default: cardData.is_default || false,
      gateway,
      metadata
    })
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to add card: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'card_added',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'card',
    p_reference_id: data.id,
    p_description: `เพิ่มบัตร ${card_brand.toUpperCase()} •••• ${card_last4}`,
    p_metadata: { card_id: data.id, card_brand, card_last4 }
  });

  return data;
};

// Update card (set as default, etc.)
export const updateCard = async (customerId, cardId, updates) => {
  const allowedFields = ['is_default', 'cardholder_name', 'metadata'];
  const filteredUpdates = {};

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new ValidationError('No valid fields to update');
  }

  // If setting as default, unset other defaults
  if (filteredUpdates.is_default === true) {
    await supabaseAdmin
      .from('customer_cards')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_cards')
    .update(filteredUpdates)
    .eq('id', cardId)
    .eq('customer_id', customerId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to update card: ${error.message}`, 500);
  }

  if (!data) {
    throw new NotFoundError('Card');
  }

  return data;
};

// Delete card
export const deleteCard = async (customerId, cardId) => {
  const { data: card, error: fetchError } = await supabaseAdmin
    .from('customer_cards')
    .select('card_brand, card_last4')
    .eq('id', cardId)
    .eq('customer_id', customerId)
    .single();

  if (fetchError || !card) {
    throw new NotFoundError('Card');
  }

  const { error } = await supabaseAdmin
    .from('customer_cards')
    .delete()
    .eq('id', cardId)
    .eq('customer_id', customerId);

  if (error) {
    throw new AppError(`Failed to delete card: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'card_removed',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'card',
    p_reference_id: cardId,
    p_description: `ลบบัตร ${card.card_brand.toUpperCase()} •••• ${card.card_last4}`,
    p_metadata: { card_id: cardId, card_brand: card.card_brand, card_last4: card.card_last4 }
  });

  return { success: true };
};

// Get bank accounts
export const getBankAccounts = async (customerId) => {
  const { data, error } = await supabaseAdmin
    .from('customer_bank_accounts')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError(`Failed to get bank accounts: ${error.message}`, 500);
  }

  return data || [];
};

// Add a new bank account
export const addBankAccount = async (customerId, bankData) => {
  const { bank_name, bank_code, account_name, account_number, account_type = 'savings', promptpay_id, metadata = {} } = bankData;

  if (!bank_name || !account_name || !account_number) {
    throw new ValidationError('Missing required bank account fields');
  }

  // If this is set as default, unset other defaults
  if (bankData.is_default) {
    await supabaseAdmin
      .from('customer_bank_accounts')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_bank_accounts')
    .insert({
      customer_id: customerId,
      bank_name,
      bank_code,
      account_name,
      account_number,
      account_type,
      is_default: bankData.is_default || false,
      is_verified: false,
      promptpay_id,
      metadata
    })
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to add bank account: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'bank_added',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'bank_account',
    p_reference_id: data.id,
    p_description: `เพิ่มบัญชีธนาคาร ${bank_name} •••• ${account_number.slice(-4)}`,
    p_metadata: { bank_account_id: data.id, bank_name, account_last4: account_number.slice(-4) }
  });

  return data;
};

// Update bank account
export const updateBankAccount = async (customerId, bankAccountId, updates) => {
  const allowedFields = ['is_default', 'account_name', 'account_type', 'promptpay_id', 'metadata'];
  const filteredUpdates = {};

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new ValidationError('No valid fields to update');
  }

  // If setting as default, unset other defaults
  if (filteredUpdates.is_default === true) {
    await supabaseAdmin
      .from('customer_bank_accounts')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_bank_accounts')
    .update(filteredUpdates)
    .eq('id', bankAccountId)
    .eq('customer_id', customerId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to update bank account: ${error.message}`, 500);
  }

  if (!data) {
    throw new NotFoundError('Bank account');
  }

  return data;
};

// Delete bank account
export const deleteBankAccount = async (customerId, bankAccountId) => {
  const { data: bank, error: fetchError } = await supabaseAdmin
    .from('customer_bank_accounts')
    .select('bank_name, account_number')
    .eq('id', bankAccountId)
    .eq('customer_id', customerId)
    .single();

  if (fetchError || !bank) {
    throw new NotFoundError('Bank account');
  }

  const { error } = await supabaseAdmin
    .from('customer_bank_accounts')
    .delete()
    .eq('id', bankAccountId)
    .eq('customer_id', customerId);

  if (error) {
    throw new AppError(`Failed to delete bank account: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'bank_removed',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'bank_account',
    p_reference_id: bankAccountId,
    p_description: `ลบบัญชีธนาคาร ${bank.bank_name} •••• ${bank.account_number.slice(-4)}`,
    p_metadata: { bank_account_id: bankAccountId, bank_name: bank.bank_name, account_last4: bank.account_number.slice(-4) }
  });

  return { success: true };
};

// Verify bank account (admin or via PromptPay)
export const verifyBankAccount = async (customerId, bankAccountId) => {
  const { data, error } = await supabaseAdmin
    .from('customer_bank_accounts')
    .update({
      is_verified: true,
      verified_at: new Date().toISOString()
    })
    .eq('id', bankAccountId)
    .eq('customer_id', customerId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to verify bank account: ${error.message}`, 500);
  }

  if (!data) {
    throw new NotFoundError('Bank account');
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'bank_verified',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'bank_account',
    p_reference_id: data.id,
    p_description: `ยืนยันบัญชีธนาคาร ${data.bank_name} สำเร็จ`,
    p_metadata: { bank_account_id: data.id }
  });

  return data;
};

// Top up wallet (creates a pending topup transaction)
export const createWalletTopup = async (customerId, { amount, payment_method, payment_reference }) => {
  if (!amount || amount <= 0) {
    throw new ValidationError('Invalid topup amount');
  }

  // Record as pending topup (will be confirmed by payment webhook)
  const { data, error } = await supabaseAdmin
    .from('wallet_transactions')
    .insert({
      wallet_id: (await supabaseAdmin.from('customer_wallets').select('id').eq('customer_id', customerId).single()).data?.id,
      customer_id: customerId,
      type: 'topup',
      amount,
      coins: 0,
      balance_before: 0, // Will be updated on confirmation
      balance_after: 0,
      coins_before: 0,
      coins_after: 0,
      reference_type: 'payment',
      reference_id: payment_reference,
      description: `เติมเงินเข้ากระเป๋าเงิน ${amount} บาท`,
      metadata: { payment_method, status: 'pending' }
    })
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to create topup: ${error.message}`, 500);
  }

  return data;
};

// Confirm wallet topup (called by payment webhook)
export const confirmWalletTopup = async (transactionId, { success, payment_gateway_response }) => {
  const { data: transaction, error: fetchError } = await supabaseAdmin
    .from('wallet_transactions')
    .select('*')
    .eq('id', transactionId)
    .single();

  if (fetchError || !transaction) {
    throw new NotFoundError('Transaction');
  }

  if (transaction.type !== 'topup') {
    throw new ValidationError('Invalid transaction type');
  }

  if (success) {
    // Use the atomic RPC to update balance
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('record_wallet_transaction', {
      p_customer_id: transaction.customer_id,
      p_type: 'topup',
      p_amount: transaction.amount,
      p_coins: 0,
      p_reference_type: 'payment',
      p_reference_id: transaction.reference_id,
      p_description: transaction.description,
      p_metadata: { ...transaction.metadata, payment_gateway_response, status: 'completed' }
    });

    if (rpcError) {
      throw new AppError(`Failed to confirm topup: ${rpcError.message}`, 500);
    }

    // Update original transaction as completed
    await supabaseAdmin
      .from('wallet_transactions')
      .update({ metadata: { ...transaction.metadata, status: 'completed', confirmed_at: new Date().toISOString() } })
      .eq('id', transactionId);

    return result;
  } else {
    // Mark as failed
    await supabaseAdmin
      .from('wallet_transactions')
      .update({ metadata: { ...transaction.metadata, status: 'failed', failed_at: new Date().toISOString() } })
      .eq('id', transactionId);

    return { success: false };
  }
};

// Use wallet for payment (atomic deduction)
export const payWithWallet = async (customerId, { amount, order_id, description }) => {
  if (!amount || amount <= 0) {
    throw new ValidationError('Invalid payment amount');
  }

  const { data, error } = await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'payment',
    p_amount: -amount, // Negative for deduction
    p_coins: 0,
    p_reference_type: 'order',
    p_reference_id: order_id,
    p_description: description || `ชำระเงินสั่งซื้อ ${amount} บาท`,
    p_metadata: { order_id }
  });

  if (error) {
    if (error.message.includes('Insufficient wallet balance')) {
      throw new ValidationError('ยอดเงินในกระเป๋าเงินไม่เพียงพอ');
    }
    throw new AppError(`Wallet payment failed: ${error.message}`, 500);
  }

  return data;
};

// Refund to wallet
export const refundToWallet = async (customerId, { amount, order_id, reason }) => {
  if (!amount || amount <= 0) {
    throw new ValidationError('Invalid refund amount');
  }

  const { data, error } = await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'refund',
    p_amount: amount,
    p_coins: 0,
    p_reference_type: 'order',
    p_reference_id: order_id,
    p_description: `คืนเงินจากออเดอร์ ${reason || ''} ${amount} บาท`,
    p_metadata: { order_id, reason }
  });

  if (error) {
    throw new AppError(`Wallet refund failed: ${error.message}`, 500);
  }

  return data;
};

// Earn coins
export const earnCoins = async (customerId, { coins, reference_type, reference_id, description }) => {
  if (!coins || coins <= 0) {
    throw new ValidationError('Invalid coin amount');
  }

  const { data, error } = await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'coin_earned',
    p_amount: 0,
    p_coins: coins,
    p_reference_type: reference_type,
    p_reference_id: reference_id,
    p_description: description || `ได้รับเหรียญโบนัส ${coins} เหรียญ`,
    p_metadata: { coins_earned: coins }
  });

  if (error) {
    throw new AppError(`Failed to earn coins: ${error.message}`, 500);
  }

  return data;
};

// Spend coins
export const spendCoins = async (customerId, { coins, reference_type, reference_id, description }) => {
  if (!coins || coins <= 0) {
    throw new ValidationError('Invalid coin amount');
  }

  const { data, error } = await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'coin_spent',
    p_amount: 0,
    p_coins: -coins, // Negative for spending
    p_reference_type: reference_type,
    p_reference_id: reference_id,
    p_description: description || `ใช้เหรียญโบนัส ${coins} เหรียญ`,
    p_metadata: { coins_spent: coins }
  });

  if (error) {
    if (error.message.includes('Insufficient coins')) {
      throw new ValidationError('เหรียญโบนัสไม่เพียงพอ');
    }
    throw new AppError(`Failed to spend coins: ${error.message}`, 500);
  }

  return data;
};

// Add voucher (for promotions, referrals, etc.)
export const addVoucher = async (customerId, voucherData) => {
  const { code, name, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, valid_from, valid_until, source_type, source_id, metadata = {} } = voucherData;

  if (!code || !name || !discount_type || !discount_value || !valid_until) {
    throw new ValidationError('Missing required voucher fields');
  }

  const { data, error } = await supabaseAdmin
    .from('customer_vouchers')
    .insert({
      customer_id: customerId,
      code,
      name,
      description,
      discount_type,
      discount_value,
      min_order_amount: min_order_amount || 0,
      max_discount_amount,
      usage_limit: usage_limit || 1,
      valid_from: valid_from || new Date().toISOString(),
      valid_until,
      is_active: true,
      source_type,
      source_id,
      metadata
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      throw new ValidationError('Voucher code already exists');
    }
    throw new AppError(`Failed to add voucher: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'voucher_received',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'voucher',
    p_reference_id: data.id,
    p_description: `ได้รับคูปอง ${name}`,
    p_metadata: { voucher_id: data.id, voucher_name: name }
  });

  return data;
};

// Use voucher
export const useVoucher = async (customerId, voucherId) => {
  const { data: voucher, error: fetchError } = await supabaseAdmin
    .from('customer_vouchers')
    .select('*')
    .eq('id', voucherId)
    .eq('customer_id', customerId)
    .single();

  if (fetchError || !voucher) {
    throw new NotFoundError('Voucher');
  }

  if (!voucher.is_active || new Date(voucher.valid_until) < new Date()) {
    throw new ValidationError('Voucher is expired or inactive');
  }

  if (voucher.used_count >= voucher.usage_limit) {
    throw new ValidationError('Voucher usage limit reached');
  }

  const { data, error } = await supabaseAdmin
    .from('customer_vouchers')
    .update({
      used_count: voucher.used_count + 1,
      is_active: voucher.used_count + 1 >= voucher.usage_limit ? false : true
    })
    .eq('id', voucherId)
    .eq('customer_id', customerId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Failed to use voucher: ${error.message}`, 500);
  }

  // Record in finance history
  await supabaseAdmin.rpc('record_wallet_transaction', {
    p_customer_id: customerId,
    p_type: 'voucher_used',
    p_amount: 0,
    p_coins: 0,
    p_reference_type: 'voucher',
    p_reference_id: voucherId,
    p_description: `ใช้คูปอง ${voucher.name}`,
    p_metadata: { voucher_id: voucherId, voucher_name: voucher.name }
  });

  return data;
};

// Get wallet settings (enabled/disabled)
export const getWalletSettings = async () => {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'customer_wallet_enabled')
    .maybeSingle();

  if (error) {
    throw new AppError(`Failed to get wallet settings: ${error.message}`, 500);
  }

  const raw = data?.value;
  let enabled = false;
  if (typeof raw === 'boolean') enabled = raw;
  else if (typeof raw === 'string') enabled = raw === 'true' || raw === '1';
  else enabled = Boolean(raw);

  return { enabled };
};

// ================ Mee Card Wallet Registration ================

// Customer: Submit Mee card wallet registration
export const createMeeCardWalletRegistration = async (customerId, registrationData) => {
  const { 
    mee_card_number, 
    mee_card_holder_name, 
    mee_card_exp_month, 
    mee_card_exp_year, 
    mee_card_type = 'debit',
    phone_number,
    email,
    metadata = {}
  } = registrationData;

  if (!mee_card_number || !mee_card_holder_name || !mee_card_exp_month || !mee_card_exp_year) {
    throw new ValidationError('Missing required Mee card fields');
  }

  const { data, error } = await supabaseAdmin.rpc('create_mee_card_wallet_registration', {
    p_customer_id: customerId,
    p_mee_card_number: mee_card_number,
    p_mee_card_holder_name: mee_card_holder_name,
    p_mee_card_exp_month: mee_card_exp_month,
    p_mee_card_exp_year: mee_card_exp_year,
    p_mee_card_type: mee_card_type,
    p_phone_number: phone_number,
    p_email: email,
    p_metadata: metadata
  });

  if (error) {
    if (error.message.includes('already has a pending or approved') || error.message.includes('already has a wallet')) {
      throw new ValidationError(error.message);
    }
    throw new AppError(`Failed to create Mee card wallet registration: ${error.message}`, 500);
  }

  return data;
};

// Customer: Get their Mee card wallet registration status
export const getMyMeeCardRegistration = async (customerId) => {
  const { data, error } = await supabaseAdmin.rpc('get_my_mee_card_registration', {
    p_customer_id: customerId
  });

  if (error) {
    throw new AppError(`Failed to get Mee card registration: ${error.message}`, 500);
  }

  return data?.[0] || null;
};

// Admin: Get pending Mee card wallet registrations with pagination
export const getPendingMeeCardRegistrations = async ({ page = 1, limit = 20, status = 'pending' } = {}) => {
  const offset = (page - 1) * limit;

  const { data, error } = await supabaseAdmin.rpc('get_pending_mee_card_registrations', {
    p_limit: limit,
    p_offset: offset,
    p_status: status
  });

  if (error) {
    throw new AppError(`Failed to get pending Mee card registrations: ${error.message}`, 500);
  }

  return {
    registrations: data || [],
    pagination: {
      page,
      limit,
      hasMore: (data || []).length === limit
    }
  };
};

// Admin: Get Mee card registration counts by status
export const getMeeCardRegistrationCounts = async () => {
  const { data, error } = await supabaseAdmin.rpc('get_mee_card_registration_counts');

  if (error) {
    throw new AppError(`Failed to get Mee card registration counts: ${error.message}`, 500);
  }

  const counts = {};
  (data || []).forEach(item => {
    counts[item.status] = Number(item.count);
  });

  return {
    pending: counts.pending || 0,
    approved: counts.approved || 0,
    rejected: counts.rejected || 0,
    expired: counts.expired || 0,
    total: Object.values(counts).reduce((sum, val) => sum + val, 0)
  };
};

// Admin: Approve or reject Mee card wallet registration
export const reviewMeeCardWalletRegistration = async (reviewerId, registrationId, action, rejectionReason = null) => {
  if (!['approve', 'reject'].includes(action)) {
    throw new ValidationError('Invalid action. Must be "approve" or "reject"');
  }

  if (action === 'reject' && !rejectionReason) {
    throw new ValidationError('Rejection reason is required when rejecting');
  }

  const { data, error } = await supabaseAdmin.rpc('review_mee_card_wallet_registration', {
    p_registration_id: registrationId,
    p_reviewer_id: reviewerId,
    p_action: action,
    p_rejection_reason: rejectionReason
  });

  if (error) {
    if (error.message.includes('not pending') || error.message.includes('not found')) {
      throw new ValidationError(error.message);
    }
    throw new AppError(`Failed to review Mee card registration: ${error.message}`, 500);
  }

  return data;
};
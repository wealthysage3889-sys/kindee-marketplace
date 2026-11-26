-- Customer Wallet System (Migration 028)
-- Adds wallet balance, coins, vouchers, cards, bank accounts, and financial history

-- Wallet table (one per customer)
CREATE TABLE customer_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_wallets_customer_id ON customer_wallets(customer_id);

-- Wallet Transactions (audit trail for all balance changes)
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('topup', 'payment', 'refund', 'reward', 'adjustment', 'coin_earned', 'coin_spent', 'voucher_redeemed')),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    balance_before NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,
    coins_before INTEGER NOT NULL,
    coins_after INTEGER NOT NULL,
    reference_type TEXT, -- 'order', 'refund', 'promotion', 'manual', 'voucher'
    reference_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_customer_id ON wallet_transactions(customer_id);
CREATE INDEX idx_wallet_transactions_reference ON wallet_transactions(reference_type, reference_id);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- Customer Vouchers
CREATE TABLE customer_vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount', 'free_shipping')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    min_order_amount NUMERIC(10,2) DEFAULT 0,
    max_discount_amount NUMERIC(10,2),
    usage_limit INTEGER DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    source_type TEXT, -- 'promotion', 'referral', 'compensation', 'purchase_reward'
    source_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_vouchers_customer_id ON customer_vouchers(customer_id);
CREATE INDEX idx_customer_vouchers_code ON customer_vouchers(code);
CREATE INDEX idx_customer_vouchers_valid ON customer_vouchers(valid_from, valid_until, is_active);

-- Saved Payment Cards
CREATE TABLE customer_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    card_token TEXT NOT NULL, -- Tokenized card reference from payment gateway
    card_last4 TEXT NOT NULL,
    card_brand TEXT NOT NULL, -- 'visa', 'mastercard', 'jcb', 'amex', etc.
    card_exp_month INTEGER NOT NULL CHECK (card_exp_month BETWEEN 1 AND 12),
    card_exp_year INTEGER NOT NULL,
    cardholder_name TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    gateway TEXT NOT NULL DEFAULT 'stripe', -- Payment gateway used
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_cards_customer_id ON customer_cards(customer_id);
CREATE INDEX idx_customer_cards_default ON customer_cards(customer_id, is_default) WHERE is_default = true;

-- Bank Accounts
CREATE TABLE customer_bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    bank_name TEXT NOT NULL,
    bank_code TEXT, -- Thai bank code (e.g., 'KASIKORN', 'SCB', 'BANGKOK', 'KRUNGTHAI')
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'savings' CHECK (account_type IN ('savings', 'current', 'fixed')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    promptpay_id TEXT, -- Phone number or citizen ID linked to PromptPay
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_bank_accounts_customer_id ON customer_bank_accounts(customer_id);
CREATE INDEX idx_customer_bank_accounts_default ON customer_bank_accounts(customer_id, is_default) WHERE is_default = true;

-- Financial History (unified view of all financial activities)
CREATE TABLE customer_finance_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'wallet_topup', 'wallet_payment', 'wallet_refund', 'wallet_reward', 'wallet_adjustment',
        'coin_earned', 'coin_spent', 'coin_expired',
        'voucher_received', 'voucher_used', 'voucher_expired',
        'card_added', 'card_removed', 'card_used',
        'bank_added', 'bank_removed', 'bank_verified',
        'order_payment', 'order_refund', 'order_cod',
        'promotion_reward'
    )),
    amount NUMERIC(12,2) DEFAULT 0,
    coins INTEGER DEFAULT 0,
    balance_after NUMERIC(12,2),
    coins_after INTEGER,
    description TEXT NOT NULL,
    reference_type TEXT, -- 'order', 'wallet_transaction', 'voucher', 'card', 'bank_account', 'promotion'
    reference_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_finance_history_customer_id ON customer_finance_history(customer_id);
CREATE INDEX idx_customer_finance_history_type ON customer_finance_history(type);
CREATE INDEX idx_customer_finance_history_reference ON customer_finance_history(reference_type, reference_id);
CREATE INDEX idx_customer_finance_history_created_at ON customer_finance_history(created_at DESC);

-- RLS Policies for customer_wallets
ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_wallets_select_own ON customer_wallets
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_wallets_insert_own ON customer_wallets
    FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY customer_wallets_update_own ON customer_wallets
    FOR UPDATE USING (customer_id = auth.uid());

-- RLS Policies for wallet_transactions
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_transactions_select_own ON wallet_transactions
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY wallet_transactions_insert_own ON wallet_transactions
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- RLS Policies for customer_vouchers
ALTER TABLE customer_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_vouchers_select_own ON customer_vouchers
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_vouchers_insert_own ON customer_vouchers
    FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY customer_vouchers_update_own ON customer_vouchers
    FOR UPDATE USING (customer_id = auth.uid());

-- RLS Policies for customer_cards
ALTER TABLE customer_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_cards_select_own ON customer_cards
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_cards_insert_own ON customer_cards
    FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY customer_cards_update_own ON customer_cards
    FOR UPDATE USING (customer_id = auth.uid());

CREATE POLICY customer_cards_delete_own ON customer_cards
    FOR DELETE USING (customer_id = auth.uid());

-- RLS Policies for customer_bank_accounts
ALTER TABLE customer_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_bank_accounts_select_own ON customer_bank_accounts
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_bank_accounts_insert_own ON customer_bank_accounts
    FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY customer_bank_accounts_update_own ON customer_bank_accounts
    FOR UPDATE USING (customer_id = auth.uid());

CREATE POLICY customer_bank_accounts_delete_own ON customer_bank_accounts
    FOR DELETE USING (customer_id = auth.uid());

-- RLS Policies for customer_finance_history
ALTER TABLE customer_finance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_finance_history_select_own ON customer_finance_history
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_finance_history_insert_own ON customer_finance_history
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Function to create wallet for new customer (triggered on profile creation)
CREATE OR REPLACE FUNCTION create_customer_wallet()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO customer_wallets (customer_id, balance, coins, is_enabled)
    VALUES (NEW.id, 0, 0, true)
    ON CONFLICT (customer_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS create_customer_wallet_trigger ON profiles;
CREATE TRIGGER create_customer_wallet_trigger
    AFTER INSERT ON profiles
    FOR EACH ROW
    WHEN (NEW.role = 'customer')
    EXECUTE FUNCTION create_customer_wallet();

-- Function to record wallet transaction (atomic balance update)
CREATE OR REPLACE FUNCTION record_wallet_transaction(
    p_customer_id UUID,
    p_type TEXT,
    p_amount NUMERIC DEFAULT 0,
    p_coins INTEGER DEFAULT 0,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS wallet_transactions AS $$
DECLARE
    v_wallet customer_wallets%ROWTYPE;
    v_balance_before NUMERIC(12,2);
    v_balance_after NUMERIC(12,2);
    v_coins_before INTEGER;
    v_coins_after INTEGER;
    v_transaction wallet_transactions;
BEGIN
    -- Lock wallet row for update
    SELECT * INTO v_wallet
    FROM customer_wallets
    WHERE customer_id = p_customer_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        -- Create wallet if not exists
        INSERT INTO customer_wallets (customer_id, balance, coins, is_enabled)
        VALUES (p_customer_id, 0, 0, true)
        RETURNING * INTO v_wallet;
    END IF;
    
    IF NOT v_wallet.is_enabled THEN
        RAISE EXCEPTION 'Wallet is disabled';
    END IF;
    
    v_balance_before := v_wallet.balance;
    v_coins_before := v_wallet.coins;
    v_balance_after := v_wallet.balance + p_amount;
    v_coins_after := v_wallet.coins + p_coins;
    
    -- Validate balance doesn't go negative
    IF v_balance_after < 0 THEN
        RAISE EXCEPTION 'Insufficient wallet balance';
    END IF;
    
    IF v_coins_after < 0 THEN
        RAISE EXCEPTION 'Insufficient coins';
    END IF;
    
    -- Update wallet
    UPDATE customer_wallets
    SET balance = v_balance_after,
        coins = v_coins_after,
        updated_at = NOW()
    WHERE customer_id = p_customer_id;
    
    -- Record transaction
    INSERT INTO wallet_transactions (
        wallet_id, customer_id, type, amount, coins,
        balance_before, balance_after, coins_before, coins_after,
        reference_type, reference_id, description, metadata
    ) VALUES (
        v_wallet.id, p_customer_id, p_type, p_amount, p_coins,
        v_balance_before, v_balance_after, v_coins_before, v_coins_after,
        p_reference_type, p_reference_id, p_description, p_metadata
    ) RETURNING * INTO v_transaction;
    
    -- Also record in finance history
    INSERT INTO customer_finance_history (
        customer_id, type, amount, coins, balance_after, coins_after,
        description, reference_type, reference_id, metadata
    ) VALUES (
        p_customer_id, p_type, p_amount, p_coins, v_balance_after, v_coins_after,
        p_description, p_reference_type, p_reference_id, p_metadata
    );
    
    RETURN v_transaction;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get wallet summary
CREATE OR REPLACE FUNCTION get_wallet_summary(p_customer_id UUID)
RETURNS TABLE (
    balance NUMERIC(12,2),
    coins INTEGER,
    voucher_count INTEGER,
    card_count INTEGER,
    bank_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(w.balance, 0)::NUMERIC(12,2),
        COALESCE(w.coins, 0)::INTEGER,
        COALESCE(v.voucher_count, 0)::INTEGER,
        COALESCE(c.card_count, 0)::INTEGER,
        COALESCE(b.bank_count, 0)::INTEGER
    FROM customer_wallets w
    LEFT JOIN (
        SELECT customer_id, COUNT(*) as voucher_count
        FROM customer_vouchers
        WHERE is_active = true AND valid_until > NOW()
        GROUP BY customer_id
    ) v ON v.customer_id = p_customer_id
    LEFT JOIN (
        SELECT customer_id, COUNT(*) as card_count
        FROM customer_cards
        GROUP BY customer_id
    ) c ON c.customer_id = p_customer_id
    LEFT JOIN (
        SELECT customer_id, COUNT(*) as bank_count
        FROM customer_bank_accounts
        GROUP BY customer_id
    ) b ON b.customer_id = p_customer_id
    WHERE w.customer_id = p_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get wallet transactions with pagination
CREATE OR REPLACE FUNCTION get_wallet_transactions(
    p_customer_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    type TEXT,
    amount NUMERIC(12,2),
    coins INTEGER,
    balance_before NUMERIC(12,2),
    balance_after NUMERIC(12,2),
    coins_before INTEGER,
    coins_after INTEGER,
    reference_type TEXT,
    reference_id UUID,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wt.id, wt.type, wt.amount, wt.coins,
        wt.balance_before, wt.balance_after,
        wt.coins_before, wt.coins_after,
        wt.reference_type, wt.reference_id,
        wt.description, wt.metadata, wt.created_at
    FROM wallet_transactions wt
    WHERE wt.customer_id = p_customer_id
    ORDER BY wt.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get finance history with pagination
CREATE OR REPLACE FUNCTION get_finance_history(
    p_customer_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    type TEXT,
    amount NUMERIC(12,2),
    coins INTEGER,
    balance_after NUMERIC(12,2),
    coins_after INTEGER,
    description TEXT,
    reference_type TEXT,
    reference_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cfh.id, cfh.type, cfh.amount, cfh.coins,
        cfh.balance_after, cfh.coins_after,
        cfh.description, cfh.reference_type, cfh.reference_id,
        cfh.metadata, cfh.created_at
    FROM customer_finance_history cfh
    WHERE cfh.customer_id = p_customer_id
    ORDER BY cfh.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated role
GRANT EXECUTE ON FUNCTION record_wallet_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION get_wallet_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_wallet_transactions TO authenticated;
GRANT EXECUTE ON FUNCTION get_finance_history TO authenticated;

-- Create wallet for existing customers
INSERT INTO customer_wallets (customer_id, balance, coins, is_enabled)
SELECT id, 0, 0, true
FROM profiles
WHERE role = 'customer'
ON CONFLICT (customer_id) DO NOTHING;
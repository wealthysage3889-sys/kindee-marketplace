-- Mee Card Wallet Registration with Admin Approval (Migration 029)
-- Adds Mee card registration for Myanmar customers with admin approval workflow

-- Mee Card Wallet Registration table
CREATE TABLE mee_card_wallet_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    mee_card_number TEXT NOT NULL, -- Encrypted Mee card number
    mee_card_holder_name TEXT NOT NULL,
    mee_card_exp_month INTEGER NOT NULL CHECK (mee_card_exp_month BETWEEN 1 AND 12),
    mee_card_exp_year INTEGER NOT NULL,
    mee_card_type TEXT NOT NULL DEFAULT 'debit' CHECK (mee_card_type IN ('debit', 'credit', 'prepaid')),
    phone_number TEXT, -- Phone number linked to Mee card
    email TEXT, -- Email for verification
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id) -- One registration per customer
);

CREATE INDEX idx_mee_card_registrations_customer_id ON mee_card_wallet_registrations(customer_id);
CREATE INDEX idx_mee_card_registrations_status ON mee_card_wallet_registrations(status);
CREATE INDEX idx_mee_card_registrations_created_at ON mee_card_wallet_registrations(created_at DESC);
CREATE INDEX idx_mee_card_registrations_reviewed_by ON mee_card_wallet_registrations(reviewed_by);

-- RLS Policies for mee_card_wallet_registrations
ALTER TABLE mee_card_wallet_registrations ENABLE ROW LEVEL SECURITY;

-- Customers can view their own registration
CREATE POLICY mee_card_registrations_select_own ON mee_card_wallet_registrations
    FOR SELECT USING (customer_id = auth.uid());

-- Customers can insert their own registration
CREATE POLICY mee_card_registrations_insert_own ON mee_card_wallet_registrations
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Customers can update their own registration (only if pending)
CREATE POLICY mee_card_registrations_update_own ON mee_card_wallet_registrations
    FOR UPDATE USING (customer_id = auth.uid() AND status = 'pending');

-- Admins can view all registrations
CREATE POLICY mee_card_registrations_select_admin ON mee_card_wallet_registrations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
        )
    );

-- Admins can update all registrations (approve/reject)
CREATE POLICY mee_card_registrations_update_admin ON mee_card_wallet_registrations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
        )
    );

-- Function to create Mee card wallet registration
CREATE OR REPLACE FUNCTION create_mee_card_wallet_registration(
    p_customer_id UUID,
    p_mee_card_number TEXT,
    p_mee_card_holder_name TEXT,
    p_mee_card_exp_month INTEGER,
    p_mee_card_exp_year INTEGER,
    p_mee_card_type TEXT DEFAULT 'debit',
    p_phone_number TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS mee_card_wallet_registrations AS $$
DECLARE
    v_registration mee_card_wallet_registrations;
BEGIN
    -- Check if customer already has a wallet (approved or pending)
    IF EXISTS (
        SELECT 1 FROM mee_card_wallet_registrations
        WHERE customer_id = p_customer_id
        AND status IN ('pending', 'approved')
    ) THEN
        RAISE EXCEPTION 'Customer already has a pending or approved Mee card wallet registration';
    END IF;

    -- Check if customer already has a customer_wallet
    IF EXISTS (
        SELECT 1 FROM customer_wallets WHERE customer_id = p_customer_id
    ) THEN
        RAISE EXCEPTION 'Customer already has a wallet';
    END IF;

    INSERT INTO mee_card_wallet_registrations (
        customer_id,
        mee_card_number,
        mee_card_holder_name,
        mee_card_exp_month,
        mee_card_exp_year,
        mee_card_type,
        phone_number,
        email,
        status,
        metadata
    ) VALUES (
        p_customer_id,
        p_mee_card_number,
        p_mee_card_holder_name,
        p_mee_card_exp_month,
        p_mee_card_exp_year,
        p_mee_card_type,
        p_phone_number,
        p_email,
        'pending',
        p_metadata
    ) RETURNING * INTO v_registration;

    -- Record in finance history
    INSERT INTO customer_finance_history (
        customer_id, type, amount, coins, balance_after, coins_after,
        description, reference_type, reference_id, metadata
    ) VALUES (
        p_customer_id, 'wallet_registration_requested', 0, 0, 0, 0,
        'ขอสมัครวอเลทด้วยบัตร Mee Card', 'mee_card_registration', v_registration.id,
        jsonb_build_object('registration_id', v_registration.id, 'card_type', p_mee_card_type)
    );

    RETURN v_registration;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for admin to approve/reject Mee card wallet registration
CREATE OR REPLACE FUNCTION review_mee_card_wallet_registration(
    p_registration_id UUID,
    p_reviewer_id UUID,
    p_action TEXT, -- 'approve' or 'reject'
    p_rejection_reason TEXT DEFAULT NULL
)
RETURNS mee_card_wallet_registrations AS $$
DECLARE
    v_registration mee_card_wallet_registrations;
    v_customer_id UUID;
    v_wallet_id UUID;
BEGIN
    -- Get registration with lock
    SELECT * INTO v_registration
    FROM mee_card_wallet_registrations
    WHERE id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found';
    END IF;

    IF v_registration.status != 'pending' THEN
        RAISE EXCEPTION 'Registration is not pending (current status: %)', v_registration.status;
    END IF;

    v_customer_id := v_registration.customer_id;

    IF p_action = 'approve' THEN
        -- Create customer wallet
        INSERT INTO customer_wallets (customer_id, balance, coins, is_enabled)
        VALUES (v_customer_id, 0, 0, true)
        ON CONFLICT (customer_id) DO UPDATE SET is_enabled = true
        RETURNING id INTO v_wallet_id;

        -- Update registration status
        UPDATE mee_card_wallet_registrations
        SET status = 'approved',
            reviewed_by = p_reviewer_id,
            reviewed_at = NOW(),
            verified_at = NOW(),
            updated_at = NOW()
        WHERE id = p_registration_id
        RETURNING * INTO v_registration;

        -- Record in finance history
        INSERT INTO customer_finance_history (
            customer_id, type, amount, coins, balance_after, coins_after,
            description, reference_type, reference_id, metadata
        ) VALUES (
            v_customer_id, 'wallet_registration_approved', 0, 0, 0, 0,
            'อนุมัติการสมัครวอเลทด้วยบัตร Mee Card', 'mee_card_registration', p_registration_id,
            jsonb_build_object('registration_id', p_registration_id, 'wallet_id', v_wallet_id, 'reviewed_by', p_reviewer_id)
        );

    ELSIF p_action = 'reject' THEN
        -- Update registration status
        UPDATE mee_card_wallet_registrations
        SET status = 'rejected',
            rejection_reason = p_rejection_reason,
            reviewed_by = p_reviewer_id,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = p_registration_id
        RETURNING * INTO v_registration;

        -- Record in finance history
        INSERT INTO customer_finance_history (
            customer_id, type, amount, coins, balance_after, coins_after,
            description, reference_type, reference_id, metadata
        ) VALUES (
            v_customer_id, 'wallet_registration_rejected', 0, 0, 0, 0,
            'ปฏิเสธการสมัครวอเลทด้วยบัตร Mee Card: ' || COALESCE(p_rejection_reason, 'ไม่ระบุเหตุผล'), 'mee_card_registration', p_registration_id,
            jsonb_build_object('registration_id', p_registration_id, 'rejection_reason', p_rejection_reason, 'reviewed_by', p_reviewer_id)
        );

    ELSE
        RAISE EXCEPTION 'Invalid action: %', p_action;
    END IF;

    RETURN v_registration;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for customer to get their registration status
CREATE OR REPLACE FUNCTION get_my_mee_card_registration(p_customer_id UUID)
RETURNS TABLE (
    id UUID,
    mee_card_number TEXT,
    mee_card_holder_name TEXT,
    mee_card_exp_month INTEGER,
    mee_card_exp_year INTEGER,
    mee_card_type TEXT,
    phone_number TEXT,
    email TEXT,
    status TEXT,
    rejection_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id, m.mee_card_number, m.mee_card_holder_name,
        m.mee_card_exp_month, m.mee_card_exp_year, m.mee_card_type,
        m.phone_number, m.email, m.status, m.rejection_reason,
        m.reviewed_at, m.verified_at, m.created_at, m.updated_at
    FROM mee_card_wallet_registrations m
    WHERE m.customer_id = p_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for admin to get pending registrations with pagination
CREATE OR REPLACE FUNCTION get_pending_mee_card_registrations(
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0,
    p_status TEXT DEFAULT 'pending'
)
RETURNS TABLE (
    id UUID,
    customer_id UUID,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    mee_card_number TEXT,
    mee_card_holder_name TEXT,
    mee_card_exp_month INTEGER,
    mee_card_exp_year INTEGER,
    mee_card_type TEXT,
    phone_number TEXT,
    email TEXT,
    status TEXT,
    rejection_reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id, m.customer_id, p.name as customer_name, p.email as customer_email, p.phone as customer_phone,
        m.mee_card_number, m.mee_card_holder_name,
        m.mee_card_exp_month, m.mee_card_exp_year, m.mee_card_type,
        m.phone_number, m.email, m.status, m.rejection_reason,
        m.reviewed_by, m.reviewed_at, m.created_at, m.updated_at
    FROM mee_card_wallet_registrations m
    JOIN profiles p ON p.id = m.customer_id
    WHERE m.status = p_status
    ORDER BY m.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for admin to get registration count by status
CREATE OR REPLACE FUNCTION get_mee_card_registration_counts()
RETURNS TABLE (
    status TEXT,
    count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT m.status, COUNT(*) as count
    FROM mee_card_wallet_registrations m
    GROUP BY m.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated role
GRANT EXECUTE ON FUNCTION create_mee_card_wallet_registration TO authenticated;
GRANT EXECUTE ON FUNCTION review_mee_card_wallet_registration TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_mee_card_registration TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_mee_card_registrations TO authenticated;
GRANT EXECUTE ON FUNCTION get_mee_card_registration_counts TO authenticated;
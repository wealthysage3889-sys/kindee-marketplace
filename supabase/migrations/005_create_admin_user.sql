-- Create the initial admin by promoting ONE specific account to owner.
--
-- SAFETY:
--   * Do NOT auto-promote by creation order.
--   * Set target_email below to the intended administrator's email before running.
--   * While target_email is still the placeholder, this migration RAISES and does
--     nothing, so it can never promote an unintended real account by accident.
--   * It is a no-op when an owner already exists.

DO $$
DECLARE
    target_email TEXT := 'replace-me@example.invalid'; -- <-- replace with the intended owner email
    target_user_id UUID;
    owner_exists BOOLEAN;
BEGIN
    -- Guard: refuse to run until a real target email has been configured.
    IF target_email IS NULL
       OR btrim(target_email) = ''
       OR target_email = 'replace-me@example.invalid' THEN
        RAISE EXCEPTION 'Owner email is not configured. Set target_email to the intended administrator email before running this migration.';
    END IF;

    -- Never change roles if an owner already exists.
    SELECT EXISTS (SELECT 1 FROM profiles WHERE role = 'owner') INTO owner_exists;
    IF owner_exists THEN
        RAISE NOTICE 'An owner already exists; skipping admin promotion.';
        RETURN;
    END IF;

    -- Validate the target account exists before any UPDATE.
    SELECT id INTO target_user_id
    FROM profiles
    WHERE email = target_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'No profile found for email "%". Check target_email before running this migration.', target_email;
    END IF;

    -- Promote only this single, validated account.
    UPDATE profiles
    SET role = 'owner', updated_at = NOW()
    WHERE id = target_user_id;

    RAISE NOTICE 'Promoted user % (%) to owner role', target_user_id, target_email;
END $$;
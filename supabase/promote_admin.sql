-- Alternative: Promote a specific user by email to owner
-- Replace 'your-email@example.com' with the actual email

UPDATE profiles
SET role = 'owner', updated_at = NOW()
WHERE email = 'your-email@example.com';

-- Verify the change
SELECT id, email, name, role, is_active, created_at
FROM profiles
WHERE email = 'your-email@example.com';
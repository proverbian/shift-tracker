-- ===== COMPLETE SCHEMA SETUP FOR TIME TRACKER =====
-- Run this entire script in your Supabase SQL Editor
-- IMPORTANT: Replace 'your-superadmin@email.com' with your actual VITE_ADMIN_EMAIL value

-- ========================================
-- 1. USER ROLES TABLE
-- ========================================

-- Create user_roles table to store user roles
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'admin', 'superadmin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can read their own role" ON user_roles;
DROP POLICY IF EXISTS "Admins can read all roles" ON user_roles;
DROP POLICY IF EXISTS "Allow first user or superadmin to insert" ON user_roles;
DROP POLICY IF EXISTS "Superadmins can update roles" ON user_roles;
DROP POLICY IF EXISTS "Superadmins can delete roles" ON user_roles;
DROP POLICY IF EXISTS "Superadmins can insert roles" ON user_roles;
DROP POLICY IF EXISTS "Allow role viewing" ON user_roles;
DROP POLICY IF EXISTS "Superadmins insert" ON user_roles;
DROP POLICY IF EXISTS "Superadmins update" ON user_roles;
DROP POLICY IF EXISTS "Superadmins delete" ON user_roles;
DROP POLICY IF EXISTS "Users view own role" ON user_roles;
DROP POLICY IF EXISTS "superadmin_insert" ON user_roles;
DROP POLICY IF EXISTS "superadmin_update" ON user_roles;
DROP POLICY IF EXISTS "superadmin_delete" ON user_roles;
DROP POLICY IF EXISTS "user_select_own" ON user_roles;

-- Drop existing functions
DROP FUNCTION IF EXISTS is_superadmin();
DROP FUNCTION IF EXISTS user_roles_is_empty();
DROP FUNCTION IF EXISTS get_all_user_roles();
DROP FUNCTION IF EXISTS get_user_role(UUID);

-- Create SECURITY DEFINER function to check superadmin status (NO RECURSION)
-- IMPORTANT: Replace 'your-superadmin@email.com' with your actual superadmin email
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND email = 'your-superadmin@email.com'
  );
$$;

GRANT EXECUTE ON FUNCTION is_superadmin() TO authenticated;

-- Function to get all user roles (BYPASSES RLS for superadmin viewing)
CREATE OR REPLACE FUNCTION get_all_user_roles()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check superadmin status first
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Return all roles (SECURITY DEFINER bypasses RLS)
  RETURN QUERY 
  SELECT ur.id, ur.user_id, ur.email, ur.role, ur.created_at, ur.updated_at
  FROM user_roles ur
  ORDER BY ur.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_user_roles() TO authenticated;

-- Function to get a single user's role (BYPASSES RLS to avoid recursion)
CREATE OR REPLACE FUNCTION get_user_role(target_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  user_role_result TEXT;
BEGIN
  -- Get the role directly (SECURITY DEFINER bypasses RLS)
  SELECT role INTO user_role_result
  FROM user_roles
  WHERE user_id = target_user_id
  LIMIT 1;
  
  -- Return 'employee' if no role found
  RETURN COALESCE(user_role_result, 'employee');
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_role(UUID) TO authenticated;

-- Create RLS policies (using ONLY the SECURITY DEFINER functions)
CREATE POLICY "superadmin_insert"
  ON user_roles FOR INSERT
  TO authenticated
  WITH CHECK (is_superadmin());

CREATE POLICY "superadmin_update"
  ON user_roles FOR UPDATE
  TO authenticated
  USING (is_superadmin());

CREATE POLICY "superadmin_delete"
  ON user_roles FOR DELETE
  TO authenticated
  USING (is_superadmin());

CREATE POLICY "user_select_own"
  ON user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Note: Superadmins use get_all_user_roles() RPC function for SELECT, not policies

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on user_roles
DROP TRIGGER IF EXISTS update_user_roles_updated_at ON user_roles;
CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 2. SHIFTS TABLE RLS POLICIES
-- ========================================

-- Drop existing policies on shifts table
DROP POLICY IF EXISTS "Users can view own shifts" ON shifts;
DROP POLICY IF EXISTS "Users can insert own shifts" ON shifts;
DROP POLICY IF EXISTS "Users can update own shifts" ON shifts;
DROP POLICY IF EXISTS "Users can delete own shifts" ON shifts;
DROP POLICY IF EXISTS "Admins can view all shifts" ON shifts;
DROP POLICY IF EXISTS "Allow users to view all shifts" ON shifts;

-- Enable RLS on shifts table (if not already enabled)
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view ALL shifts (for availability checking)
CREATE POLICY "Allow users to view all shifts"
  ON shifts FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own shifts
CREATE POLICY "Users can insert own shifts"
  ON shifts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own shifts
CREATE POLICY "Users can update own shifts"
  ON shifts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can only delete their own shifts
CREATE POLICY "Users can delete own shifts"
  ON shifts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Superadmins can update any shift (for corrections/cleanup)
CREATE POLICY "Superadmins can update shifts"
  ON shifts FOR UPDATE
  TO authenticated
  USING (is_superadmin());

-- Superadmins can delete any shift (for cleanup)
CREATE POLICY "Superadmins can delete shifts"
  ON shifts FOR DELETE
  TO authenticated
  USING (is_superadmin());

-- ========================================
-- IMPORTANT: MANUAL STEPS AFTER RUNNING THIS SCRIPT
-- ========================================

-- 1. Replace 'your-superadmin@email.com' in the is_superadmin() function (line 61)
--    with your actual superadmin email from VITE_ADMIN_EMAIL

-- 2. Manually insert your superadmin role (run this ONCE after replacing the email):
--    INSERT INTO user_roles (user_id, email, role)
--    SELECT id, email, 'superadmin'
--    FROM auth.users
--    WHERE email = 'your-superadmin@email.com'
--    ON CONFLICT (user_id) DO NOTHING;

-- Done! Your schema is now set up with:
-- ✅ User roles table with RLS
-- ✅ SECURITY DEFINER functions to avoid recursion
-- ✅ Shifts table policies allowing users to view all shifts (for scheduling)
-- ✅ Users can only modify their own shifts

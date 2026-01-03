# User Management Setup Guide

## Initial Setup

### 1. Run the Database Migration

Execute the SQL in `supabase-migration-user-roles.sql` in your Supabase SQL Editor. This creates:
- `user_roles` table with RLS policies
- Proper indexes for performance
- Triggers for automatic timestamp updates

### 2. Create the Superadmin Account

The superadmin is defined by the `VITE_ADMIN_EMAIL` environment variable. 

**First time setup:**
1. Sign up via the app login screen using the email defined in `VITE_ADMIN_EMAIL`
2. The app will automatically recognize this user as the superadmin
3. No database entry needed - superadmin status is determined by email match

### 3. Add Your First Users

Once logged in as superadmin:
1. Navigate to the "User Management" section at the bottom of the page
2. Click "+ Add User"
3. Fill in:
   - **Email**: User's email address
   - **Password**: Minimum 6 characters
   - **Role**: Choose "Employee" or "Admin (View Only)"
4. Click "Create User"

## User Roles

### Superadmin
- **Defined by**: `VITE_ADMIN_EMAIL` environment variable
- **Access**: Full system access
- **Can**:
  - Create/delete employees and admins
  - View all employee logs and shifts
  - Access user management dashboard
  - View all shifts on admin calendar

### Admin (View Only)
- **Created by**: Superadmin via user management
- **Access**: Read-only access to employee data
- **Can**:
  - View all employee confirmed shift logs
  - View all shifts on admin calendar
  - Filter and export employee time data
- **Cannot**:
  - Create or manage users
  - Create, edit, or delete any entries or shifts
  - Access user management

### Employee
- **Created by**: Superadmin via user management
- **Access**: Personal time tracking and shift management
- **Can**:
  - Schedule future shifts
  - Confirm past shifts to log time
  - Edit/delete unconfirmed shifts
  - Manually log time entries
  - View their own statistics
- **Cannot**:
  - View other employees' data
  - Edit confirmed shifts
  - Access admin views

## Common Operations

### Adding an Employee
1. Login as superadmin
2. Go to "User Management"
3. Click "+ Add User"
4. Enter email and password
5. Select "Employee" role
6. Click "Create User"

### Adding a View-Only Admin
1. Login as superadmin
2. Go to "User Management"
3. Click "+ Add User"
4. Enter email and password
5. Select "Admin (View Only)" role
6. Click "Create User"

### Removing a User
1. Login as superadmin
2. Go to "User Management"
3. Find the user in the list
4. Click "Delete" next to their name
5. Confirm the deletion

**Note**: Deleting a user removes their role assignment. Their auth account and any data they created (shifts, entries) will remain in the database.

## Security Notes

- Only users with the exact email matching `VITE_ADMIN_EMAIL` can be superadmins
- There can only be ONE superadmin
- All user management operations require superadmin privileges
- RLS policies ensure users can only access data according to their role
- Passwords must be at least 6 characters (Supabase requirement)
- New users will need to check their email for verification (if email confirmation is enabled in Supabase)

## Troubleshooting

### "Only superadmin can create users" error
- Verify you're logged in with the email that matches `VITE_ADMIN_EMAIL`
- Check the `.env` file has the correct superadmin email
- Restart the dev server after changing environment variables

### Users not showing in User Management
- Click the "Refresh" button to reload the user list
- Check that you're online and connected to Supabase
- Verify the `user_roles` table exists and has proper RLS policies

### Created user can't log in
- Ensure the password meets the 6-character minimum
- Check Supabase auth settings for email confirmation requirements
- Verify the user's email is correct

### Role not being recognized
- The superadmin role is determined by email match, not database entry
- Admin and employee roles are stored in the `user_roles` table
- Try logging out and back in to refresh the role

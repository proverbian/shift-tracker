## Offline-first Time Tracker (Vue 3 + Vite)

Vue 3 + Tailwind CSS time-tracking app that works offline by default (IndexedDB via `localforage`) and syncs pending entries to Supabase when online.

### Features

- **User Management**: Superadmin can create employees and view-only admins
- **Role-Based Access**:
  - **Superadmin** (defined by `VITE_ADMIN_EMAIL`): Full access including user management
  - **Admin**: View-only access to employee logs
  - **Employee**: Can log time and manage their own shifts
- Email/password login with Supabase; entries are tied to the signed-in user
- Log date, time in, and time out; automatic hour calculation with overnight shift support
- Offline-first storage in IndexedDB with pending/synced status
- Auto-sync to Supabase when online; manual "Sync now" button
- Summary of total hours and pending counts
- Shift scheduling: Employees can schedule planned shifts in advance, view a monthly calendar, and confirm shifts on the day to automatically log them
- Admin calendar view to see all employee scheduled shifts
- Mobile-friendly UI with Tailwind

### Quick start

```bash
npm install
npm run dev
```

### Environment

Update `.env` with your Supabase keys and superadmin email:

```
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
VITE_ADMIN_EMAIL=superadmin@example.com
```

If Supabase values are missing, the app works offline but login/sync are disabled.

### Supabase tables

**1. Run the user roles migration:**

Execute `supabase-migration-user-roles.sql` in your Supabase SQL editor to create the `user_roles` table with proper RLS policies.

**2. Create the entries table:**

Create a table named `entries` with columns:

- `id` uuid primary key
- `user_id` uuid (references auth.users.id)
- `user_email` text
- `date` date
- `time_in` text
- `time_out` text
- `hours` numeric
- `created_at` timestamptz default now()

**3. Create the shifts table:**

- `id` uuid primary key
- `user_id` uuid (references auth.users.id)
- `user_email` text
- `date` date
- `time_in` text
- `time_out` text
- `confirmed` boolean default false
- `created_at` timestamptz default now()

### Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run preview` — preview production build

### Project structure (key files)

- `src/App.vue` — main UI and logic
- `src/composables/useTimeCalculator.js` — hour math + total hours
- `src/composables/useOfflineStorage.js` — IndexedDB persistence for entries via localforage
- `src/composables/useSupabaseSync.js` — online detection and Supabase sync for entries
- `src/composables/useSupabaseAuth.js` — authentication management
- `src/composables/useShifts.js` — shift CRUD and confirmation logic
- `src/composables/useOfflineStorageShifts.js` — IndexedDB persistence for shifts
- `src/composables/useSupabaseSyncShifts.js` — online detection and Supabase sync for shifts

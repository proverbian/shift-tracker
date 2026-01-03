<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useTimeCalculator } from './composables/useTimeCalculator'
import { useOfflineStorage } from './composables/useOfflineStorage'
import { useOfflineStorageShifts } from './composables/useOfflineStorageShifts'
import { useSupabaseSync } from './composables/useSupabaseSync'
import { useSupabaseSyncShifts } from './composables/useSupabaseSyncShifts'
import { useSupabaseAuth } from './composables/useSupabaseAuth'
import { useShifts } from './composables/useShifts'
import { supabase } from './lib/supabaseClient'

const { loadEntries, persistEntries } = useOfflineStorage()

const entries = ref([])
const adminEntries = ref([])
const adminLoading = ref(false)
const adminError = ref(null)
const selectedEmployee = ref(null)
const loadingEntries = ref(true)
const saving = ref(false)
const feedback = ref('')
const editingEntryId = ref(null)

const form = reactive({
  date: new Date().toISOString().slice(0, 10),
  timeIn: '',
  timeOut: '',
})

const loginForm = reactive({
  email: '',
  password: '',
})

const shiftForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  timeIn: '',
  timeOut: '',
})

const showShiftModal = ref(false)
const editingShiftId = ref(null)

// User Management
const showUserModal = ref(false)
const users = ref([])
const loadingUsers = ref(false)
const creatingUser = ref(false)
const userForm = reactive({
  email: '',
  password: '',
  role: 'employee',
})

// Calculate default date range based on current date
const getDefaultDateRange = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = today.getDate()
  
  if (day < 15) {
    // 1st to 14th
    const start = new Date(year, month, 1).toISOString().slice(0, 10)
    const end = new Date(year, month, 14).toISOString().slice(0, 10)
    return { start, end }
  } else {
    // 15th to end of month
    const start = new Date(year, month, 15).toISOString().slice(0, 10)
    const end = new Date(year, month + 1, 0).toISOString().slice(0, 10)
    return { start, end }
  }
}

const defaultRange = getDefaultDateRange()
const dateFilterStart = ref(defaultRange.start)
const dateFilterEnd = ref(defaultRange.end)
const adminDateFilterStart = ref(defaultRange.start)
const adminDateFilterEnd = ref(defaultRange.end)

const { user, userRole, isAdmin, isSuperAdmin, authReady, authError, loading: authLoading, signingOut, supabaseEnabled, signIn, signOut } = useSupabaseAuth()

const persistForCurrentUser = async (list = entries.value) => {
  if (!user.value) return
  await persistEntries(list, user.value.id)
}

const { calculateHours, totalHours } = useTimeCalculator(entries)

const { isOnline, syncing, lastSyncError, syncPendingEntries } = useSupabaseSync(
  entries,
  persistForCurrentUser,
  user,
)

const pendingCount = computed(() => entries.value.filter((e) => e.status === 'pending').length)
const isEditing = computed(() => !!editingEntryId.value)

const employees = computed(() => {
  const map = new Map()
  const today = new Date().toISOString().slice(0, 10)
  
  // Filter admin entries by date range and only past confirmed shifts
  let filtered = adminEntries.value.filter(entry => entry.date <= today)
  
  if (adminDateFilterStart.value) {
    filtered = filtered.filter((entry) => entry.date >= adminDateFilterStart.value)
  }
  if (adminDateFilterEnd.value) {
    filtered = filtered.filter((entry) => entry.date <= adminDateFilterEnd.value)
  }
  
  filtered.forEach(entry => {
    const email = entry.userEmail || 'unknown'
    if (!map.has(email)) {
      map.set(email, { email, totalHours: 0, normalHours: 0, overnightHours: 0, entries: [] })
    }
    const emp = map.get(email)
    emp.entries.push(entry)
    const hours = Number(entry.hours) || 0
    emp.totalHours += hours
    if (entry.timeOut < entry.timeIn) {
      emp.overnightHours += hours
    } else {
      emp.normalHours += hours
    }
  })
  return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email))
})

const selectedEmployeeEntries = computed(() => {
  if (!selectedEmployee.value) return []
  return selectedEmployee.value.entries
})

const formatHours = (hours) => Number(hours ?? 0).toFixed(2)
const statusBadgeClass = (status) =>
  status === 'synced'
    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
    : 'bg-amber-500/20 text-amber-100 border border-amber-500/40'

const { shifts, loading: shiftsLoading, addShift, confirmShift, loadUserShifts, fetchAllShifts, todayShifts } = useShifts(user)

const confirmedShiftsHours = computed(() => {
  return workedEntries.value.reduce((total, entry) => total + entry.hours, 0)
})

const currentMonthTotalHours = computed(() => {
  if (!user.value) return 0
  
  // Filter shifts for the current calendar month being viewed
  const monthShifts = shifts.value.filter(s => {
    if (s.userId !== user.value?.id) return false
    const shiftDate = new Date(s.date)
    return shiftDate.getMonth() === currentMonth.value && shiftDate.getFullYear() === currentYear.value
  })
  
  // Calculate total hours for all shifts in the month
  return monthShifts.reduce((total, shift) => {
    const hours = calculateHours(shift.date, shift.timeIn, shift.timeOut)
    return total + hours
  }, 0)
})

const workedEntries = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  let filtered = shifts.value
    .filter((s) => s.status === 'confirmed' && s.userId === user.value?.id && s.date <= today)
  
  // Apply date range filter
  if (dateFilterStart.value) {
    filtered = filtered.filter((s) => s.date >= dateFilterStart.value)
  }
  if (dateFilterEnd.value) {
    filtered = filtered.filter((s) => s.date <= dateFilterEnd.value)
  }
  
  return filtered
    .map((shift) => ({
      id: shift.id,
      date: shift.date,
      timeIn: shift.timeIn,
      timeOut: shift.timeOut,
      hours: calculateHours(shift.date, shift.timeIn, shift.timeOut),
      status: 'synced',
      userId: shift.userId,
      userEmail: shift.userEmail,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
})

const pullLatestForUser = async () => {
  if (!supabaseEnabled || !user.value || !isOnline.value) return
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.value.id)
    .order('created_at', { ascending: false })

  if (error) {
    feedback.value = `Fetch error: ${error.message}`
    return
  }

  const byId = new Map(entries.value.map((e) => [e.id, e]))

  data.forEach((row) => {
    const normalized = {
      id: row.id,
      date: row.date,
      timeIn: row.time_in,
      timeOut: row.time_out,
      hours: Number(row.hours ?? 0),
      status: 'synced',
      createdAt: row.created_at,
      syncedAt: row.updated_at || row.created_at,
      userId: row.user_id,
      userEmail: row.user_email,
    }

    const existing = byId.get(row.id)
    if (existing) {
      Object.assign(existing, normalized)
    } else {
      entries.value.push(normalized)
    }
  })

  entries.value.sort((a, b) => new Date(b.date) - new Date(a.date))
  await persistForCurrentUser()
}

const fetchAdminEntries = async () => {
  if (!isAdmin.value || !supabaseEnabled || !isOnline.value) return
  adminLoading.value = true
  adminError.value = null
  
  // Fetch confirmed shifts for all users
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('status', 'confirmed')
    .order('date', { ascending: false })
    .limit(500)

  adminLoading.value = false

  if (error) {
    adminError.value = error.message
    return
  }

  adminEntries.value = data.map((row) => ({
    id: row.id,
    date: row.date,
    timeIn: row.time_in,
    timeOut: row.time_out,
    hours: calculateHours(row.date, row.time_in, row.time_out),
    userEmail: row.user_email,
    createdAt: row.created_at,
  }))
}

const deleteAdminShift = async (entry) => {
  if (!isSuperAdmin.value || !supabaseEnabled || !isOnline.value) return
  const confirmed = confirm('Delete this logged shift? This cannot be undone.')
  if (!confirmed) return

  const { error } = await supabase.from('shifts').delete().eq('id', entry.id)
  if (error) {
    feedback.value = `Failed to delete shift: ${error.message}`
    return
  }

  // Update local lists so UI refreshes immediately
  adminEntries.value = adminEntries.value.filter((e) => e.id !== entry.id)
  shifts.value = shifts.value.filter((s) => s.id !== entry.id)
  feedback.value = 'Shift deleted.'
}

const handleLogin = async () => {
  feedback.value = ''
  await signIn(loginForm.email, loginForm.password)
}

const addEntry = async () => {
  feedback.value = ''

  if (!user.value) {
    feedback.value = 'Please sign in to save time entries.'
    return
  }

  if (isAdmin.value) {
    feedback.value = 'Admins cannot add or edit time logs.'
    return
  }

  if (!form.date || !form.timeIn || !form.timeOut) {
    feedback.value = 'Please fill in date, time in, and time out.'
    return
  }

  // Reject same time in and time out
  if (form.timeIn === form.timeOut) {
    feedback.value = 'Time in and time out cannot be the same.'
    return
  }

  const hours = calculateHours(form.date, form.timeIn, form.timeOut)

  if (hours <= 0) {
    feedback.value = 'Hours must be greater than zero.'
    return
  }

  // Minimum 10 minutes (0.17 hours)
  if (hours < 0.17) {
    feedback.value = 'Minimum work duration is 10 minutes.'
    return
  }

  // Maximum 16 hours
  if (hours > 16) {
    feedback.value = 'Maximum work duration is 16 hours.'
    return
  }

  // Check for overlapping time entries (exclude current entry if editing)
  const overlap = entries.value.find((entry) => {
    if (entry.id === editingEntryId.value) return false // Skip current entry when editing
    if (entry.userId !== user.value.id || entry.date !== form.date) return false
    
    // Convert times to comparable format
    const newStart = form.timeIn
    const newEnd = form.timeOut
    const existingStart = entry.timeIn
    const existingEnd = entry.timeOut
    
    // Check if times overlap
    if (newEnd >= newStart && existingEnd >= existingStart) {
      // Both are same-day entries
      return newStart < existingEnd && newEnd > existingStart
    }
    
    // Handle overnight entries
    if (newEnd < newStart) {
      // New entry is overnight
      if (existingEnd < existingStart) {
        // Both overnight - they always overlap
        return true
      } else {
        // Existing is same-day, new is overnight
        return existingStart < newEnd || existingEnd > newStart
      }
    } else if (existingEnd < existingStart) {
      // Existing is overnight, new is same-day
      return existingStart < newEnd || existingEnd > newStart
    }
    
    return false
  })
  
  if (overlap) {
    feedback.value = `This time log overlaps with your existing entry: ${format12Hour(overlap.timeIn)} - ${format12Hour(overlap.timeOut)}`
    return
  }

  saving.value = true

  try {
    const base = {
      date: form.date,
      timeIn: form.timeIn,
      timeOut: form.timeOut,
      hours: Number(hours.toFixed(2)),
      status: 'pending',
      userId: user.value.id,
      userEmail: user.value.email,
    }

    if (isEditing.value) {
      const idx = entries.value.findIndex((e) => e.id === editingEntryId.value)
      if (idx !== -1) {
        entries.value[idx] = {
          ...entries.value[idx],
          ...base,
          id: editingEntryId.value,
          updatedAt: new Date().toISOString(),
        }
      }
      feedback.value = 'Entry updated locally' + (supabaseEnabled ? ' — syncing when online.' : '')
    } else {
      const entry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        createdAt: new Date().toISOString(),
        ...base,
      }
      entries.value = [entry, ...entries.value]
      feedback.value = 'Saved locally' + (supabaseEnabled ? ' — syncing when online.' : '')
    }

    await persistForCurrentUser(entries.value)
    await syncPendingEntries()
    await pullLatestForUser()

    form.timeIn = ''
    form.timeOut = ''
    editingEntryId.value = null
  } finally {
    saving.value = false
  }
}

const startEdit = (entry) => {
  if (!user.value || entry.userId !== user.value.id) return
  editingEntryId.value = entry.id
  form.date = entry.date
  form.timeIn = entry.timeIn
  form.timeOut = entry.timeOut
  feedback.value = 'Editing entry…'
}

const cancelEdit = () => {
  editingEntryId.value = null
  form.timeIn = ''
  form.timeOut = ''
  feedback.value = ''
}

const selectEmployee = (emp) => {
  selectedEmployee.value = emp
}

const backToEmployees = () => {
  selectedEmployee.value = null
}

const openShiftModal = (dateStr) => {
  editingShiftId.value = null
  shiftForm.date = dateStr
  shiftForm.timeIn = ''
  shiftForm.timeOut = ''
  showShiftModal.value = true
}

const openEditShiftModal = (shift) => {
  editingShiftId.value = shift.id
  shiftForm.date = shift.date
  shiftForm.timeIn = shift.timeIn
  shiftForm.timeOut = shift.timeOut
  showShiftModal.value = true
}

const closeShiftModal = () => {
  showShiftModal.value = false
  editingShiftId.value = null
  shiftForm.timeIn = ''
  shiftForm.timeOut = ''
  feedback.value = ''
}

const getUserInitials = (email) => {
  if (!email) return '?'
  const parts = email.split('@')[0].split('.')
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return email.substring(0, 2).toUpperCase()
}

const getUserColor = (userId) => {
  if (!userId) return 'bg-indigo-500/20 border-indigo-500/40 text-indigo-100'
  const colors = [
    'bg-blue-500/20 border-blue-500/40 text-blue-100',
    'bg-purple-500/20 border-purple-500/40 text-purple-100',
    'bg-pink-500/20 border-pink-500/40 text-pink-100',
    'bg-rose-500/20 border-rose-500/40 text-rose-100',
    'bg-orange-500/20 border-orange-500/40 text-orange-100',
    'bg-amber-500/20 border-amber-500/40 text-amber-100',
    'bg-yellow-500/20 border-yellow-500/40 text-yellow-100',
    'bg-lime-500/20 border-lime-500/40 text-lime-100',
    'bg-green-500/20 border-green-500/40 text-green-100',
    'bg-emerald-500/20 border-emerald-500/40 text-emerald-100',
    'bg-teal-500/20 border-teal-500/40 text-teal-100',
    'bg-cyan-500/20 border-cyan-500/40 text-cyan-100',
    'bg-sky-500/20 border-sky-500/40 text-sky-100',
    'bg-indigo-500/20 border-indigo-500/40 text-indigo-100',
    'bg-violet-500/20 border-violet-500/40 text-violet-100',
    'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-100',
  ]
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

const format12Hour = (time24) => {
  if (!time24) return ''
  const [hours, minutes] = time24.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${hour12}:${minutes}${ampm}`
}

const addPlannedShift = async () => {
  feedback.value = ''
  if (!user.value || (isAdmin.value && !isSuperAdmin.value)) {
    feedback.value = 'Only employees (or superadmin) can schedule shifts.'
    return
  }
  if (!shiftForm.date || !shiftForm.timeIn || !shiftForm.timeOut) {
    feedback.value = 'Please fill in date, time in, and time out.'
    return
  }

  // Reject same time in and time out
  if (shiftForm.timeIn === shiftForm.timeOut) {
    feedback.value = 'Time in and time out cannot be the same.'
    return
  }

  // Calculate shift duration
  const shiftHours = calculateHours(shiftForm.date, shiftForm.timeIn, shiftForm.timeOut)

  // Minimum 10 minutes (0.17 hours)
  if (shiftHours < 0.17) {
    feedback.value = 'Minimum shift duration is 10 minutes.'
    return
  }

  // Maximum 16 hours
  if (shiftHours > 16) {
    feedback.value = 'Maximum shift duration is 16 hours.'
    return
  }
  
  // Check for overlapping shifts with ANY employee (exclude current shift if editing)
  const overlap = shifts.value.find((s) => {
    if (s.id === editingShiftId.value) return false // Skip current shift when editing
    if (s.date !== shiftForm.date) return false // Only check same date
    
    // Convert times to comparable format (handle overnight shifts)
    const newStart = shiftForm.timeIn
    const newEnd = shiftForm.timeOut
    const existingStart = s.timeIn
    const existingEnd = s.timeOut
    
    // Check if times overlap: (StartA < EndB) AND (EndA > StartB)
    // For same-day shifts (no overnight), simple comparison works
    if (newEnd >= newStart && existingEnd >= existingStart) {
      // Both are same-day shifts
      return newStart < existingEnd && newEnd > existingStart
    }
    
    // Handle overnight shifts
    if (newEnd < newStart) {
      // New shift is overnight
      if (existingEnd < existingStart) {
        // Both overnight - they always overlap
        return true
      } else {
        // Existing is same-day, new is overnight
        // Overlap if existing starts before midnight or ends after midnight
        return existingStart < newEnd || existingEnd > newStart
      }
    } else if (existingEnd < existingStart) {
      // Existing is overnight, new is same-day
      return existingStart < newEnd || existingEnd > newStart
    }
    
    return false
  })
  
  if (overlap) {
    const overlappingUser = overlap.userId === user.value.id ? 'your' : `${getUserInitials(overlap.userEmail)}'s`
    feedback.value = `This shift overlaps with ${overlappingUser} existing shift: ${format12Hour(overlap.timeIn)} - ${format12Hour(overlap.timeOut)}`
    return
  }
  
  try {
    if (editingShiftId.value) {
      // Edit existing shift
      const shiftIndex = shifts.value.findIndex(s => s.id === editingShiftId.value)
      if (shiftIndex !== -1) {
        shifts.value[shiftIndex].date = shiftForm.date
        shifts.value[shiftIndex].timeIn = shiftForm.timeIn
        shifts.value[shiftIndex].timeOut = shiftForm.timeOut
        shifts.value[shiftIndex].synced = false
        // Persist and sync changes
        const { persistShifts } = useOfflineStorageShifts()
        await persistShifts(JSON.parse(JSON.stringify(shifts.value)), user.value.id)
        feedback.value = 'Shift updated.'
      }
    } else {
      // Add new shift
      await addShift(shiftForm.date, shiftForm.timeIn, shiftForm.timeOut)
    }
    shiftForm.timeIn = ''
    shiftForm.timeOut = ''
    feedback.value = ''
    closeShiftModal()
  } catch (error) {
    feedback.value = `Error: ${error.message}`
    console.error('Failed to save shift:', error)
  }
}

const confirmTodayShift = async (shiftId) => {
  const entry = await confirmShift(shiftId)
  if (entry) {
    entries.value.push(entry)
    await persistForCurrentUser()
    await syncPendingEntries()
    
    // Mark shift as unsynced so it gets synced with confirmed status
    const confirmedShift = shifts.value.find(s => s.id === shiftId)
    if (confirmedShift) {
      confirmedShift.synced = false
    }
    
    // Persist updated shifts array (now includes confirmed status)
    const { persistShifts } = useOfflineStorageShifts()
    await persistShifts(JSON.parse(JSON.stringify(shifts.value)), user.value.id)
    
    // Sync shifts (will now include the confirmed shift)
    const { syncPendingShifts } = useSupabaseSyncShifts(shifts, persistShifts, user)
    await syncPendingShifts()
    
    feedback.value = 'Shift confirmed and logged.'
  }
}

const deleteShift = async (shiftId) => {
  if (!confirm('Are you sure you want to delete this shift?')) return
  
  const shiftIndex = shifts.value.findIndex(s => s.id === shiftId)
  if (shiftIndex !== -1) {
    shifts.value.splice(shiftIndex, 1)
    const { persistShifts } = useOfflineStorageShifts()
    await persistShifts(JSON.parse(JSON.stringify(shifts.value)), user.value.id)
    
    // Delete from Supabase if synced
    if (supabase && isOnline.value) {
      await supabase.from('shifts').delete().eq('id', shiftId)
    }
    feedback.value = 'Shift deleted.'
  }
}

const fetchUsers = async () => {
  if (!isSuperAdmin.value || !supabaseEnabled || !isOnline.value) return
  loadingUsers.value = true
  
  try {
    // Use RPC function to bypass RLS and avoid recursion
    const { data: rolesData, error: rolesError } = await supabase
      .rpc('get_all_user_roles')
    
    if (rolesError) {
      feedback.value = `Error fetching users: ${rolesError.message}`
      return
    }
    
    // Filter out superadmin from the list
    users.value = (rolesData || []).filter(u => u.role !== 'superadmin')
  } finally {
    loadingUsers.value = false
  }
}

const createUser = async () => {
  if (!isSuperAdmin.value) {
    feedback.value = 'Only superadmin can create users.'
    return
  }
  
  if (!userForm.email || !userForm.password) {
    feedback.value = 'Please fill in email and password.'
    return
  }
  
  if (userForm.password.length < 6) {
    feedback.value = 'Password must be at least 6 characters.'
    return
  }
  
  creatingUser.value = true
  
  try {
    // Store current admin session
    const { data: { session: adminSession } } = await supabase.auth.getSession()
    
    // Create user via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: userForm.email,
      password: userForm.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          role: userForm.role,
        }
      }
    })
    
    if (authError) {
      feedback.value = `Error creating user: ${authError.message}`
      creatingUser.value = false
      return
    }
    
    if (!authData.user) {
      feedback.value = 'User creation failed.'
      creatingUser.value = false
      return
    }
    
    // Immediately sign out the newly created user and restore admin session
    await supabase.auth.signOut()
    if (adminSession) {
      await supabase.auth.setSession(adminSession)
    }
    
    // Now add role to user_roles table (with admin session restored)
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        email: userForm.email,
        role: userForm.role,
      })
    
    if (roleError) {
      feedback.value = `User created but role assignment failed: ${roleError.message}`
      creatingUser.value = false
      return
    }
    
    feedback.value = `User created successfully with ${userForm.role} role.`
    userForm.email = ''
    userForm.password = ''
    userForm.role = 'employee'
    showUserModal.value = false
    await fetchUsers()
  } catch (error) {
    feedback.value = `Error: ${error.message}`
  } finally {
    creatingUser.value = false
  }
}

const deleteUser = async (userId, email) => {
  if (!isSuperAdmin.value) {
    feedback.value = 'Only superadmin can delete users.'
    return
  }
  
  if (!confirm(`Are you sure you want to delete user ${email}?`)) return
  
  try {
    // Delete from user_roles table
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
    
    if (error) {
      feedback.value = `Error deleting user: ${error.message}`
    } else {
      feedback.value = 'User deleted successfully.'
      await fetchUsers()
    }
  } catch (error) {
    feedback.value = `Error: ${error.message}`
  }
}

const openUserModal = () => {
  userForm.email = ''
  userForm.password = ''
  userForm.role = 'employee'
  showUserModal.value = true
}

const closeUserModal = () => {
  showUserModal.value = false
  userForm.email = ''
  userForm.password = ''
  userForm.role = 'employee'
  feedback.value = ''
}

const handleShiftClick = async (shift) => {
  if (!user.value) return
  
  // Superadmin can edit any shift directly
  if (isSuperAdmin.value) {
    openEditShiftModal(shift)
    return
  }
  
  // Non-superadmin: only own shifts
  if (shift.userId !== user.value.id) return
  
  // Don't allow editing confirmed shifts
  if (shift.status === 'confirmed') {
    return
  }
  
  // Get today's date in local timezone
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  // Parse shift date in local timezone (not UTC)
  const [year, month, day] = shift.date.split('-').map(Number)
  const shiftDate = new Date(year, month - 1, day) // month is 0-indexed
  
  const daysDiff = Math.floor((today - shiftDate) / (1000 * 60 * 60 * 24))
  
  // Auto-confirm if 2+ days past
  if (daysDiff >= 2) {
    await confirmTodayShift(shift.id)
    return
  }
  
  // If past date (but NOT today), allow confirmation
  if (shiftDate < today) {
    if (confirm('Confirm this shift as worked?')) {
      await confirmTodayShift(shift.id)
    }
    return
  }
  
  // Today or future date - allow editing
  openEditShiftModal(shift)
}

const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDate = new Date(firstDay)
  startDate.setDate(startDate.getDate() - firstDay.getDay())

  const days = []
  const current = new Date(startDate)

  while (current <= lastDay || days.length % 7 !== 0) {
    const dateStr = current.toISOString().slice(0, 10)
    // Show all shifts to everyone so employees can see availability
    const dayShifts = shifts.value.filter((s) => s.date === dateStr)
    days.push({
      date: new Date(current),
      dateStr,
      shifts: dayShifts,
      isCurrentMonth: current.getMonth() === month,
    })
    current.setDate(current.getDate() + 1)
  }
  return days
})

const prevMonth = () => {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value -= 1
  } else {
    currentMonth.value -= 1
  }
}

const nextMonth = () => {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value += 1
  } else {
    currentMonth.value += 1
  }
}

const triggerSync = async () => {
  feedback.value = ''
  await syncPendingEntries()
  await pullLatestForUser()
  if (pendingCount.value === 0) {
    feedback.value = 'All entries are synced.'
  }
}

watch(
  () => user.value,
  async (u) => {
    loadingEntries.value = true
    entries.value = u ? await loadEntries(u.id) : []
    loadingEntries.value = false
    if (u) {
      if (isAdmin.value) {
        await fetchAllShifts()
      }
    }
    if (u && isOnline.value) {
      await syncPendingEntries()
      await pullLatestForUser()
      // Load all shifts from Supabase (so employees can see availability)
      const { data } = await supabase
        .from('shifts')
        .select('*')
        .order('date', { ascending: true })
      if (data) {
        const allShifts = data.map((row) => ({
          id: row.id,
          date: row.date,
          timeIn: row.time_in,
          timeOut: row.time_out,
          status: row.status || 'planned',
          confirmed: row.confirmed,
          createdAt: row.created_at,
          userId: row.user_id,
          userEmail: row.user_email,
          synced: true,
        }))
        shifts.value = allShifts
        // Persist loaded shifts to IndexedDB
        const { persistShifts } = useOfflineStorageShifts()
        await persistShifts(JSON.parse(JSON.stringify(shifts.value)), u.id)
      }
      // Mark shifts as loaded
      shiftsLoading.value = false
      if (isAdmin.value) {
        await fetchAdminEntries()
      }
    } else if (u && !isOnline.value) {
      // Load from IndexedDB when offline
      await loadUserShifts()
    }
  },
)

watch(
  () => isOnline.value,
  async (online) => {
    if (online && user.value) {
      await syncPendingEntries()
      await pullLatestForUser()
      if (isAdmin.value) await fetchAdminEntries()
    }
  },
)

// Watch for superadmin login to auto-load users
watch(() => isSuperAdmin.value, async (isSuperAdminNow) => {
  if (isSuperAdminNow && supabaseEnabled && isOnline.value) {
    await fetchUsers()
  }
})

onMounted(async () => {
  if (supabaseEnabled && isAdmin.value && isOnline.value) {
    await fetchAdminEntries()
  }
  if (supabaseEnabled && isSuperAdmin.value && isOnline.value) {
    await fetchUsers()
  }
})
</script>

<template>
  <div class="min-h-screen text-slate-100">
    <header class="max-w-6xl mx-auto px-4 py-8">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-sm text-indigo-200/80">Offline-first time tracker</p>
          <h1 class="text-3xl font-semibold text-white">Time Tracker</h1>
          <p class="text-xs text-slate-300/80">Entries are tied to your Supabase user.</p>
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <span
            class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border border-white/10 bg-white/5"
          >
            <span
              class="h-2 w-2 rounded-full"
              :class="isOnline ? 'bg-emerald-400 shadow-[0_0_0_6px_rgba(16,185,129,0.18)]' : 'bg-amber-400'"
            />
            {{ isOnline ? 'Online' : 'Offline' }}
          </span>
          <span
            class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border border-white/10 bg-white/5"
          >
            <span class="h-2 w-2 rounded-full" :class="supabaseEnabled ? 'bg-sky-400' : 'bg-slate-400'" />
            {{ supabaseEnabled ? 'Status: OK' : 'Status: Not configured' }}
          </span>
          <span
            v-if="pendingCount"
            class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border border-amber-400/50 bg-amber-500/15 text-amber-50"
          >
            Pending sync: {{ pendingCount }}
          </span>
        </div>
      </div>
    </header>

    <main class="max-w-6xl mx-auto px-4 pb-16 space-y-8 flex flex-col">
      <section class="bg-white/5 border border-white/10 rounded-2xl shadow-xl shadow-indigo-900/30 p-6 backdrop-blur">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-white">Authentication</h2>
            <p class="text-sm text-slate-200/80">Sign in to tie entries to your account.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span v-if="user" class="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <span class="h-2 w-2 rounded-full bg-emerald-400" />
              {{ user.email }}
              <span v-if="isSuperAdmin" class="rounded bg-purple-500/80 px-2 py-0.5 text-xs uppercase">Super Admin</span>
              <span v-else-if="isAdmin" class="rounded bg-indigo-500/80 px-2 py-0.5 text-xs uppercase">Admin</span>
              <span v-else class="rounded bg-blue-500/80 px-2 py-0.5 text-xs uppercase">Employee</span>
            </span>
            <button
              v-if="user"
              type="button"
              class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white border border-white/20 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="signingOut"
              @click="signOut"
            >
              {{ signingOut ? 'Signing out...' : 'Sign out' }}
            </button>
          </div>
        </div>

        <div v-if="!authReady" class="mt-4 text-sm text-slate-200">Checking session…</div>

        <div v-else-if="!supabaseEnabled" class="mt-4 rounded-lg border border-amber-300/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Supabase is not configured. Provide credentials to enable login and syncing.
        </div>

        <form v-else-if="!user" class="mt-6 grid gap-4 md:grid-cols-3" @submit.prevent="handleLogin">
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            Email
            <input
              v-model="loginForm.email"
              type="email"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              required
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            Password
            <input
              v-model="loginForm.password"
              type="password"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              required
            />
          </label>
          <div class="flex items-end">
            <button
              type="submit"
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-px hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
              :disabled="authLoading"
            >
              <span v-if="authLoading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              {{ authLoading ? 'Signing in…' : 'Sign in' }}
            </button>
          </div>
        </form>

        <p v-if="authError" class="mt-3 text-sm text-rose-200">{{ authError }}</p>
      </section>

      <section v-if="user && !isAdmin" class="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Your worked shifts</h3>
            <p class="text-sm text-slate-300">Confirmed shifts that have been completed ({{ workedEntries.length }} entries).</p>
          </div>
        </div>

        <!-- Date Range Filter -->
        <div class="mt-4 flex flex-wrap gap-3 items-end">
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            From
            <input
              v-model="dateFilterStart"
              type="date"
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            To
            <input
              v-model="dateFilterEnd"
              type="date"
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            />
          </label>
          <button
            v-if="dateFilterStart || dateFilterEnd"
            type="button"
            class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
            @click="dateFilterStart = ''; dateFilterEnd = ''"
          >
            Clear
          </button>
        </div>

        <div v-if="loadingEntries" class="mt-6 text-sm text-slate-200">Loading entries…</div>

        <div v-else>
          <div v-if="!workedEntries.length" class="mt-6 rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-slate-300">
            No worked shifts yet. Confirm your scheduled shifts on the day to log them.
          </div>

          <div v-else class="mt-6 overflow-x-auto">
            <table class="min-w-full text-sm text-left text-slate-100">
              <thead class="text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th class="px-3 py-2 font-semibold">Date</th>
                  <th class="px-3 py-2 font-semibold">Time in</th>
                  <th class="px-3 py-2 font-semibold">Time out</th>
                  <th class="px-3 py-2 font-semibold">Hours</th>
                  <th class="px-3 py-2 font-semibold">Status</th>
                  <th class="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <tr v-for="entry in workedEntries" :key="entry.id" class="hover:bg-white/5">
                  <td class="px-3 py-3 align-top font-medium text-white">{{ entry.date }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeIn }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeOut }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(entry.hours) }}</td>
                  <td class="px-3 py-3 align-top">
                    <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold" :class="statusBadgeClass(entry.status)">
                      {{ entry.status === 'synced' ? 'Confirmed' : 'Pending' }}
                    </span>
                  </td>
                  <td class="px-3 py-3 align-top">
                    <span class="text-xs text-slate-400">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section v-if="user && !isAdmin" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 order-2">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Confirmed shift hours</p>
          <p class="mt-2 text-3xl font-semibold text-white">{{ formatHours(confirmedShiftsHours) }}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Calendar month hours</p>
          <p class="mt-2 text-3xl font-semibold text-indigo-200">{{ formatHours(currentMonthTotalHours) }}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Scheduled shifts</p>
          <p class="mt-2 text-3xl font-semibold text-white">{{ shifts.filter(s => s.userId === user?.id).length }}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Pending sync</p>
          <p class="mt-2 text-3xl font-semibold" :class="pendingCount ? 'text-amber-200' : 'text-emerald-200'">
            {{ pendingCount }}
          </p>
        </div>
      </section>

      <section v-if="user && !isAdmin" class="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl order-3">        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Your Shift Calendar</h3>
            <p class="text-sm text-slate-300">Tap a day to schedule a shift. <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 border-2 border-red-400 rounded"></span> = Overnight shift</span></p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
              @click="prevMonth"
            >
              ←
            </button>
            <span class="px-2 py-2 text-sm font-semibold text-white">
              {{ new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }}
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
              @click="nextMonth"
            >
              →
            </button>
          </div>
        </div>

        <div class="mt-6 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-300">
          <div>S</div>
          <div>M</div>
          <div>T</div>
          <div>W</div>
          <div>T</div>
          <div>F</div>
          <div>S</div>
        </div>

        <div class="mt-2 grid grid-cols-7 gap-1">
          <div
            v-for="day in calendarDays"
            :key="day.dateStr"
            class="min-h-[80px] rounded-lg border border-white/10 bg-white/5 p-1 text-left relative cursor-pointer hover:bg-white/10 transition"
            :class="{ 'bg-indigo-500/10 border-indigo-400/30': !day.isCurrentMonth }"
            @click="openShiftModal(day.dateStr)"
          >
            <div class="flex items-start justify-between">
              <div class="text-xs font-semibold text-white">{{ day.date.getDate() }}</div>
              <button
                v-if="day.isCurrentMonth"
                type="button"
                class="rounded-full bg-indigo-500/40 p-1 hover:bg-indigo-500/60 transition"
                @click.stop="openShiftModal(day.dateStr)"
              >
                <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            <div class="mt-1 space-y-1">
              <div
                v-for="shift in day.shifts"
                :key="shift.id"
                class="rounded px-1.5 py-1 text-[10px] flex items-center justify-between gap-1 cursor-pointer hover:opacity-80 transition"
                :class="[
                  getUserColor(shift.userId),
                  shift.timeOut < shift.timeIn ? 'border-2 border-red-400' : 'border'
                ]"
                @click.stop="handleShiftClick(shift)"
              >
                <div class="flex items-center gap-1 min-w-0">
                  <span class="font-bold">{{ getUserInitials(shift.userEmail) }}</span>
                  <span class="truncate">{{ format12Hour(shift.timeIn) }}-{{ format12Hour(shift.timeOut) }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span v-if="shift.status === 'confirmed'" class="text-emerald-300 flex-shrink-0">✓</span>
                  <button
                    v-if="isSuperAdmin"
                    type="button"
                    class="rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold text-white hover:bg-white/20 border border-white/20"
                    @click.stop="openEditShiftModal(shift)"
                    aria-label="Edit shift"
                  >
                    ✎
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Shift Modal for Mobile -->
      <div
        v-if="showShiftModal && user && (isSuperAdmin || !isAdmin)"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
        @click="closeShiftModal"
      >
        <div
          class="bg-slate-800 rounded-t-3xl sm:rounded-2xl border border-white/10 shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
          @click.stop
        >
          <div class="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-white">{{ editingShiftId ? 'Edit Shift' : 'Schedule Shift' }}</h3>
            <button
              type="button"
              class="text-slate-400 hover:text-white transition"
              @click="closeShiftModal"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form class="p-6 space-y-4" @submit.prevent="addPlannedShift">
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Date
              <input
                v-model="shiftForm.date"
                type="date"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
                readonly
              />
            </label>
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Time in
              <input
                v-model="shiftForm.timeIn"
                type="time"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
                autofocus
              />
            </label>
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Time out
              <input
                v-model="shiftForm.timeOut"
                type="time"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
              />
            </label>

            <p v-if="feedback" class="text-sm text-amber-100">{{ feedback }}</p>

            <div class="flex gap-3 pt-2">
              <button
                v-if="!editingShiftId"
                type="button"
                class="flex-1 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white border border-white/20 hover:bg-white/15 transition"
                @click="closeShiftModal"
              >
                Cancel
              </button>
              <button
                v-if="editingShiftId"
                type="button"
                class="rounded-lg bg-rose-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/30 transition hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-300"
                @click="deleteShift(editingShiftId); closeShiftModal()"
              >
                Delete
              </button>
              <button
                type="submit"
                class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                :disabled="shiftsLoading"
              >
                <span v-if="shiftsLoading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                {{ editingShiftId ? 'Update' : 'Save Shift' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <section
        v-if="user && isAdmin"
        class="bg-white/5 border border-white/10 rounded-2xl shadow-xl shadow-indigo-900/30 p-6 backdrop-blur"
      >
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-white">All Shifts Calendar</h2>
            <p class="text-sm text-slate-200/80">View all employee scheduled shifts. <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 border-2 border-red-400 rounded"></span> = Overnight shift</span></p>
          </div>
        </div>

        <div class="mt-6 flex justify-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
            @click="prevMonth"
          >
            ← Prev
          </button>
          <span class="px-4 py-2 text-sm font-semibold text-white">
            {{ new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }}
          </span>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
            @click="nextMonth"
          >
            Next →
          </button>
        </div>

        <div class="mt-6 grid grid-cols-7 gap-2 text-center text-sm font-semibold text-slate-300">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        <div class="mt-2 grid grid-cols-7 gap-2">
          <div
            v-for="day in calendarDays"
            :key="day.dateStr"
            class="min-h-[120px] rounded-lg border border-white/10 bg-white/5 p-2 text-left"
            :class="{ 'bg-indigo-500/10 border-indigo-400/30': !day.isCurrentMonth }"
          >
            <div class="text-sm font-semibold text-white">{{ day.date.getDate() }}</div>
            <div class="mt-1 space-y-1">
              <div
                v-for="shift in day.shifts"
                :key="shift.id"
                class="rounded px-2 py-1 text-xs flex items-center justify-between gap-1"
                :class="[
                  getUserColor(shift.userId),
                  shift.timeOut < shift.timeIn ? 'border-2 border-red-400' : 'border'
                ]"
                @click.stop="handleShiftClick(shift)"
              >
                <div class="flex items-center gap-1 min-w-0">
                  <span class="font-bold">{{ getUserInitials(shift.userEmail) }}</span>
                  <span class="truncate text-[10px]">{{ format12Hour(shift.timeIn) }}-{{ format12Hour(shift.timeOut) }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span v-if="shift.confirmed" class="text-emerald-300 flex-shrink-0">✓</span>
                  <button
                    v-if="isSuperAdmin"
                    type="button"
                    class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20 border border-white/20"
                    @click.stop="openEditShiftModal(shift)"
                    aria-label="Edit shift"
                  >
                    ✎
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="user && isAdmin"
        class="rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-900/40 via-slate-900/40 to-emerald-900/30 p-6 shadow-2xl shadow-indigo-900/40"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">
              {{ selectedEmployee ? `Logs for ${selectedEmployee.email}` : 'Admin — All Employees' }}
            </h3>
            <p class="text-sm text-slate-200">
              {{ selectedEmployee ? 'Time logs and totals for this employee.' : 'Click an employee to view their logs.' }}
            </p>
          </div>
          <div class="flex gap-2">
            <button
              v-if="selectedEmployee"
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
              @click="backToEmployees"
            >
              ← Back to Employees
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
              :disabled="adminLoading || !isOnline"
              @click="fetchAdminEntries"
            >
              <span v-if="adminLoading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              {{ adminLoading ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>
        </div>

        <p v-if="adminError" class="mt-3 text-sm text-rose-200">{{ adminError }}</p>

        <!-- Date Range Filter for Admin -->
        <div class="mt-4 flex flex-wrap gap-3 items-end">
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            From
            <input
              v-model="adminDateFilterStart"
              type="date"
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            To
            <input
              v-model="adminDateFilterEnd"
              type="date"
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            />
          </label>
          <button
            v-if="adminDateFilterStart || adminDateFilterEnd"
            type="button"
            class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
            @click="adminDateFilterStart = ''; adminDateFilterEnd = ''"
          >
            Clear
          </button>
        </div>

        <div v-if="!selectedEmployee">
          <!-- Employee List -->
          <div v-if="employees.length" class="mt-6 overflow-x-auto">
            <table class="min-w-full text-sm text-left text-slate-100">
              <thead class="text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th class="px-3 py-2 font-semibold">Employee</th>
                  <th class="px-3 py-2 font-semibold">Total Hours</th>
                  <th class="px-3 py-2 font-semibold">Normal Hours</th>
                  <th class="px-3 py-2 font-semibold">Overnight Hours</th>
                  <th class="px-3 py-2 font-semibold">Entries</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <tr
                  v-for="emp in employees"
                  :key="emp.email"
                  class="hover:bg-white/5 cursor-pointer"
                  @click="selectEmployee(emp)"
                >
                  <td class="px-3 py-3 align-top font-medium text-white">{{ emp.email }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(emp.totalHours) }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(emp.normalHours) }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(emp.overnightHours) }}</td>
                  <td class="px-3 py-3 align-top">{{ emp.entries.length }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="!adminLoading" class="mt-4 text-sm text-slate-200">No employees found yet.</p>
        </div>

        <div v-else>
          <!-- Selected Employee Details -->
          <div class="mt-6 grid gap-4 sm:grid-cols-3">
            <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
              <p class="text-sm text-slate-300">Total Hours</p>
              <p class="mt-2 text-3xl font-semibold text-white">{{ formatHours(selectedEmployee.totalHours) }}</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
              <p class="text-sm text-slate-300">Normal Hours</p>
              <p class="mt-2 text-3xl font-semibold text-white">{{ formatHours(selectedEmployee.normalHours) }}</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
              <p class="text-sm text-slate-300">Overnight Hours</p>
              <p class="mt-2 text-3xl font-semibold text-white">{{ formatHours(selectedEmployee.overnightHours) }}</p>
            </div>
          </div>

          <div class="mt-6 overflow-x-auto">
            <table class="min-w-full text-sm text-left text-slate-100">
              <thead class="text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th class="px-3 py-2 font-semibold">Date</th>
                  <th class="px-3 py-2 font-semibold">Time in</th>
                  <th class="px-3 py-2 font-semibold">Time out</th>
                  <th class="px-3 py-2 font-semibold">Hours</th>
                  <th class="px-3 py-2 font-semibold">Shift Type</th>
                  <th v-if="isSuperAdmin" class="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <tr v-for="entry in selectedEmployeeEntries" :key="entry.id" class="hover:bg-white/5">
                  <td class="px-3 py-3 align-top font-medium text-white">{{ entry.date }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeIn }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeOut }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(entry.hours) }}</td>
                  <td class="px-3 py-3 align-top">
                    <span
                      class="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                      :class="entry.timeOut < entry.timeIn ? 'bg-purple-500/20 text-purple-200 border border-purple-500/40' : 'bg-blue-500/20 text-blue-200 border border-blue-500/40'"
                    >
                      {{ entry.timeOut < entry.timeIn ? 'Overnight' : 'Normal' }}
                    </span>
                  </td>
                  <td v-if="isSuperAdmin" class="px-3 py-3 align-top text-right">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg bg-rose-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600 border border-rose-400/60"
                      @click="deleteAdminShift(entry)"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- User Management Section (Superadmin Only) -->
      <section
        v-if="user && isSuperAdmin"
        class="rounded-2xl border border-white/10 bg-gradient-to-br from-purple-900/40 via-slate-900/40 to-blue-900/30 p-6 shadow-2xl shadow-purple-900/40"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">User Management</h3>
            <p class="text-sm text-slate-200">Manage employee and admin accounts.</p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              @click="openUserModal"
            >
              + Add User
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:bg-white/15"
              :disabled="loadingUsers || !isOnline"
              @click="fetchUsers"
            >
              <span v-if="loadingUsers" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              {{ loadingUsers ? 'Loading…' : 'Refresh' }}
            </button>
          </div>
        </div>

        <div v-if="loadingUsers" class="mt-6 text-sm text-slate-200">Loading users…</div>

        <div v-else-if="users.length" class="mt-6 overflow-x-auto">
          <table class="min-w-full text-sm text-left text-slate-100">
            <thead class="text-xs uppercase tracking-wide text-slate-300">
              <tr>
                <th class="px-3 py-2 font-semibold">Email</th>
                <th class="px-3 py-2 font-semibold">Role</th>
                <th class="px-3 py-2 font-semibold">Created</th>
                <th class="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              <tr v-for="usr in users" :key="usr.user_id" class="hover:bg-white/5">
                <td class="px-3 py-3 align-top font-medium text-white">{{ usr.email }}</td>
                <td class="px-3 py-3 align-top">
                  <span
                    class="inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize"
                    :class="usr.role === 'admin' ? 'bg-purple-500/20 text-purple-200 border border-purple-500/40' : 'bg-blue-500/20 text-blue-200 border border-blue-500/40'"
                  >
                    {{ usr.role }}
                  </span>
                </td>
                <td class="px-3 py-3 align-top text-sm text-slate-300">
                  {{ new Date(usr.created_at).toLocaleDateString() }}
                </td>
                <td class="px-3 py-3 align-top">
                  <button
                    type="button"
                    class="rounded-lg bg-rose-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600"
                    @click="deleteUser(usr.user_id, usr.email)"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-else-if="!loadingUsers" class="mt-6 text-sm text-slate-200">No users found yet.</p>
      </section>

      <!-- User Creation Modal (Superadmin Only) -->
      <div
        v-if="showUserModal && user && isSuperAdmin"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
        @click="closeUserModal"
      >
        <div
          class="bg-slate-800 rounded-t-3xl sm:rounded-2xl border border-white/10 shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
          @click.stop
        >
          <div class="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-white">Create New User</h3>
            <button
              type="button"
              class="text-slate-400 hover:text-white transition"
              @click="closeUserModal"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form class="p-6 space-y-4" @submit.prevent="createUser">
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Email
              <input
                v-model="userForm.email"
                type="email"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
                placeholder="user@example.com"
              />
            </label>
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Password
              <input
                v-model="userForm.password"
                type="password"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
                placeholder="Min. 6 characters"
              />
            </label>
            <label class="flex flex-col gap-2 text-sm text-slate-200/90">
              Role
              <select
                v-model="userForm.role"
                class="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                required
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin (View Only)</option>
              </select>
            </label>

            <p v-if="feedback" class="text-sm text-amber-100">{{ feedback }}</p>

            <div class="flex gap-3 pt-2">
              <button
                type="button"
                class="flex-1 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white border border-white/20 hover:bg-white/15 transition"
                @click="closeUserModal"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                :disabled="creatingUser"
              >
                <span v-if="creatingUser" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                {{ creatingUser ? 'Creating…' : 'Create User' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  </div>
</template>

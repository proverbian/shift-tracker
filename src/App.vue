<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useTimeCalculator } from './composables/useTimeCalculator'
import { useOfflineStorage } from './composables/useOfflineStorage'
import { useSupabaseSync } from './composables/useSupabaseSync'
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

const { user, isAdmin, authReady, authError, loading: authLoading, supabaseEnabled, signIn, signOut } = useSupabaseAuth()

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
  adminEntries.value.forEach(entry => {
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
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false })
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
    hours: Number(row.hours ?? 0),
    userEmail: row.user_email,
    createdAt: row.created_at,
  }))
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

  const hours = calculateHours(form.date, form.timeIn, form.timeOut)

  if (hours <= 0) {
    feedback.value = 'Hours must be greater than zero.'
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
  shiftForm.date = dateStr
  shiftForm.timeIn = ''
  shiftForm.timeOut = ''
  showShiftModal.value = true
}

const closeShiftModal = () => {
  showShiftModal.value = false
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
  if (!user.value || isAdmin.value) {
    feedback.value = 'Only employees can schedule shifts.'
    return
  }
  if (!shiftForm.date || !shiftForm.timeIn || !shiftForm.timeOut) {
    feedback.value = 'Please fill in date, time in, and time out.'
    return
  }
  
  // Check for overlapping shifts
  const overlap = shifts.value.find((s) => {
    if (s.userId !== user.value.id || s.date !== shiftForm.date) return false
    
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
    feedback.value = `This shift overlaps with your existing shift: ${format12Hour(overlap.timeIn)} - ${format12Hour(overlap.timeOut)}`
    return
  }
  
  try {
    await addShift(shiftForm.date, shiftForm.timeIn, shiftForm.timeOut)
    shiftForm.timeIn = ''
    shiftForm.timeOut = ''
    feedback.value = ''
    closeShiftModal()
  } catch (error) {
    feedback.value = `Error: ${error.message}`
    console.error('Failed to add shift:', error)
  }
}

const confirmTodayShift = async (shiftId) => {
  const entry = await confirmShift(shiftId)
  if (entry) {
    entries.value.push(entry)
    await persistForCurrentUser()
    await syncPendingEntries()
    feedback.value = 'Shift confirmed and logged.'
  }
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
    const dayShifts = isAdmin.value
      ? shifts.value.filter((s) => s.date === dateStr)
      : shifts.value.filter((s) => s.date === dateStr && s.userId === user.value?.id)
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
      await loadUserShifts()
      if (isAdmin.value) {
        await fetchAllShifts()
      }
    }
    if (u && isOnline.value) {
      await syncPendingEntries()
      await pullLatestForUser()
      if (isAdmin.value) {
        await fetchAdminEntries()
      }
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

onMounted(async () => {
  if (supabaseEnabled && isAdmin.value && isOnline.value) {
    await fetchAdminEntries()
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
            {{ supabaseEnabled ? 'Supabase configured' : 'Supabase not set' }}
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

    <main class="max-w-6xl mx-auto px-4 pb-16 space-y-8">
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
              <span v-if="isAdmin" class="rounded bg-indigo-500/80 px-2 py-0.5 text-xs uppercase">Admin</span>
            </span>
            <button
              v-if="user"
              type="button"
              class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white border border-white/20 hover:bg-white/15"
              @click="signOut"
            >
              Sign out
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

      <section
        v-if="user && !isAdmin"
        class="bg-white/5 border border-white/10 rounded-2xl shadow-xl shadow-indigo-900/30 p-6 backdrop-blur"
      >
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-white">Log your time</h2>
            <p class="text-sm text-slate-200/80">Works offline. Syncs automatically when online.</p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-60"
              :disabled="syncing || !pendingCount || !supabaseEnabled || !isOnline"
              @click="triggerSync"
            >
              <span v-if="syncing" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              {{ syncing ? 'Syncing…' : 'Sync now' }}
            </button>
          </div>
        </div>

        <form class="mt-6 grid gap-4 md:grid-cols-4" @submit.prevent="addEntry">
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            Date
            <input
              v-model="form.date"
              type="date"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              required
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            Time in
            <input
              v-model="form.timeIn"
              type="time"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              required
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-slate-200/90">
            Time out
            <input
              v-model="form.timeOut"
              type="time"
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              required
            />
          </label>
          <div class="flex items-end">
            <button
              type="submit"
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-px hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
              :disabled="saving || isAdmin"
            >
              <span v-if="saving" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              <template v-if="isAdmin">Admins cannot add</template>
              <template v-else>{{ saving ? (isEditing ? 'Updating…' : 'Saving…') : (isEditing ? 'Update entry' : 'Save entry') }}</template>
            </button>
          </div>
        </form>

        <div v-if="isEditing" class="mt-3 flex items-center gap-3 text-sm text-amber-100">
          Editing entry — update times and save, or
          <button type="button" class="underline decoration-dotted" @click="cancelEdit">cancel</button>
        </div>

        <p v-if="feedback" class="mt-4 text-sm text-amber-100">{{ feedback }}</p>
        <p v-if="lastSyncError" class="mt-2 text-sm text-rose-200">Sync error: {{ lastSyncError }}</p>
      </section>

      <section v-if="user && !isAdmin" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Total hours</p>
          <p class="mt-2 text-3xl font-semibold text-white">{{ formatHours(totalHours) }}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Entries</p>
          <p class="mt-2 text-3xl font-semibold text-white">{{ entries.length }}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
          <p class="text-sm text-slate-300">Pending sync</p>
          <p class="mt-2 text-3xl font-semibold" :class="pendingCount ? 'text-amber-200' : 'text-emerald-200'">
            {{ pendingCount }}
          </p>
        </div>
      </section>

      <section v-if="user && !isAdmin" class="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Your entries</h3>
            <p class="text-sm text-slate-300">Saved offline and synced when online.</p>
          </div>
        </div>

        <div v-if="loadingEntries" class="mt-6 text-sm text-slate-200">Loading entries…</div>

        <div v-else>
          <div v-if="!entries.length" class="mt-6 rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-slate-300">
            No entries yet. Add your first time log above.
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
                <tr v-for="entry in entries" :key="entry.id" class="hover:bg-white/5">
                  <td class="px-3 py-3 align-top font-medium text-white">{{ entry.date }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeIn }}</td>
                  <td class="px-3 py-3 align-top">{{ entry.timeOut }}</td>
                  <td class="px-3 py-3 align-top">{{ formatHours(entry.hours) }}</td>
                  <td class="px-3 py-3 align-top">
                    <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold" :class="statusBadgeClass(entry.status)">
                      {{ entry.status === 'synced' ? 'Synced' : 'Pending' }}
                    </span>
                  </td>
                  <td class="px-3 py-3 align-top">
                    <button
                      v-if="user && entry.userId === user.id"
                      type="button"
                      class="text-xs font-semibold text-indigo-200 underline decoration-dotted hover:text-white"
                      @click="startEdit(entry)"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-if="user && !isAdmin" class="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Your Shift Calendar</h3>
            <p class="text-sm text-slate-300">Tap a day to schedule a shift.</p>
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
                class="rounded px-1.5 py-1 text-[10px] border flex items-center justify-between gap-1"
                :class="getUserColor(shift.userId)"
                @click.stop
              >
                <div class="flex items-center gap-1 min-w-0">
                  <span class="font-bold">{{ getUserInitials(shift.userEmail) }}</span>
                  <span class="truncate">{{ format12Hour(shift.timeIn) }}-{{ format12Hour(shift.timeOut) }}</span>
                </div>
                <button
                  v-if="day.dateStr === new Date().toISOString().slice(0, 10) && !shift.confirmed && shift.userId === user.value?.id"
                  type="button"
                  class="text-[10px] bg-white/20 px-1 rounded hover:bg-white/30 flex-shrink-0"
                  @click="confirmTodayShift(shift.id)"
                >
                  ✓
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Shift Modal for Mobile -->
      <div
        v-if="showShiftModal && user && !isAdmin"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
        @click="closeShiftModal"
      >
        <div
          class="bg-slate-800 rounded-t-3xl sm:rounded-2xl border border-white/10 shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
          @click.stop
        >
          <div class="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-white">Schedule Shift</h3>
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
                type="button"
                class="flex-1 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white border border-white/20 hover:bg-white/15 transition"
                @click="closeShiftModal"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                :disabled="shiftsLoading"
              >
                <span v-if="shiftsLoading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                {{ shiftsLoading ? 'Saving…' : 'Save Shift' }}
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
            <p class="text-sm text-slate-200/80">View all employee scheduled shifts.</p>
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
                class="rounded px-2 py-1 text-xs border flex items-center justify-between gap-1"
                :class="getUserColor(shift.userId)"
              >
                <div class="flex items-center gap-1 min-w-0">
                  <span class="font-bold">{{ getUserInitials(shift.userEmail) }}</span>
                  <span class="truncate text-[10px]">{{ format12Hour(shift.timeIn) }}-{{ format12Hour(shift.timeOut) }}</span>
                </div>
                <span v-if="shift.confirmed" class="text-emerald-300 flex-shrink-0">✓</span>
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
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

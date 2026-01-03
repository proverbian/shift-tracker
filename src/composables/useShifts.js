import { ref, computed } from 'vue'
import { useOfflineStorageShifts } from './useOfflineStorageShifts'
import { useSupabaseSyncShifts } from './useSupabaseSyncShifts'
import { supabase } from '../lib/supabaseClient'

export function useShifts(userRef) {
  const { loadShifts, persistShifts } = useOfflineStorageShifts()
  const shifts = ref([])
  const loading = ref(true)

  const persistForCurrentUser = async (list = shifts.value) => {
    if (!userRef?.value) return
    await persistShifts(list, userRef.value.id)
  }

  const { isOnline, syncing, lastSyncError, syncPendingShifts } = useSupabaseSyncShifts(
    shifts,
    persistForCurrentUser,
    userRef,
  )

  const addShift = async (date, timeIn, timeOut) => {
    if (!userRef.value) return

    const shift = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      date,
      timeIn,
      timeOut,
      status: 'planned',
      createdAt: new Date().toISOString(),
      userId: userRef.value.id,
      userEmail: userRef.value.email,
      synced: false,
    }

    shifts.value.push(shift)
    await persistForCurrentUser()
    await syncPendingShifts()
  }

  const confirmShift = async (shiftId) => {
    const shift = shifts.value.find((s) => s.id === shiftId)
    if (!shift || shift.status !== 'planned') return

    shift.status = 'confirmed'
    shift.confirmedAt = new Date().toISOString()

    // Create entry
    const entry = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      date: shift.date,
      timeIn: shift.timeIn,
      timeOut: shift.timeOut,
      hours: 0, // will be calculated
      status: 'pending',
      createdAt: new Date().toISOString(),
      userId: shift.userId,
      userEmail: shift.userEmail,
    }

    // Assume we have access to addEntry from useTimeCalculator or something, but since it's separate, perhaps emit or use a callback.
    // For now, just update shift, and later integrate with entries.

    await persistForCurrentUser()
    await syncPendingShifts()

    return entry // return to add to entries
  }

  const loadUserShifts = async () => {
    if (!userRef.value) return
    shifts.value = await loadShifts(userRef.value.id)
    loading.value = false
  }

  const fetchAllShifts = async () => {
    if (!supabase || !isOnline.value) return
    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .order('date', { ascending: true })

    if (error) {
      lastSyncError.value = error.message
      return
    }

    // For admin, load all
    shifts.value = data.map((row) => ({
      id: row.id,
      date: row.date,
      timeIn: row.time_in,
      timeOut: row.time_out,
      status: row.status,
      createdAt: row.created_at,
      userId: row.user_id,
      userEmail: row.user_email,
      synced: true,
    }))
  }

  const todayShifts = computed(() => {
    const today = new Date().toISOString().slice(0, 10)
    return shifts.value.filter((s) => s.date === today && s.status === 'planned')
  })

  return {
    shifts,
    loading,
    addShift,
    confirmShift,
    loadUserShifts,
    fetchAllShifts,
    todayShifts,
    isOnline,
    syncing,
    lastSyncError,
    syncPendingShifts,
  }
}
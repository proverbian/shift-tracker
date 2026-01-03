import { onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../lib/supabaseClient'

export function useSupabaseSyncShifts(shiftsRef, persistShifts = async () => {}, userRef = ref(null)) {
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const syncing = ref(false)
  const lastSyncError = ref(null)
  const supabaseEnabled = !!supabase

  const syncPendingShifts = async () => {
    if (!supabase || !isOnline.value || !userRef?.value?.id) return 0
    const pending = shiftsRef.value.filter((shift) => shift.status === 'planned' && !shift.synced)
    if (!pending.length) return 0

    syncing.value = true
    lastSyncError.value = null
    let syncedCount = 0

    for (const shift of pending) {
      const payload = {
        id: shift.id,
        date: shift.date,
        time_in: shift.timeIn,
        time_out: shift.timeOut,
        status: shift.status,
        created_at: shift.createdAt ?? new Date().toISOString(),
        user_id: shift.userId || userRef.value.id,
        user_email: shift.userEmail || userRef.value.email,
      }

      const { error } = await supabase.from('shifts').upsert(payload)

      if (error) {
        lastSyncError.value = error.message
        continue
      }

      shift.synced = true
      syncedCount += 1
    }

    await persistShifts(shiftsRef.value)
    syncing.value = false
    return syncedCount
  }

  const handleOnline = () => {
    isOnline.value = true
    syncPendingShifts()
  }

  const handleOffline = () => {
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (isOnline.value) {
      syncPendingShifts()
    }
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return {
    isOnline,
    syncing,
    lastSyncError,
    syncPendingShifts,
    supabaseEnabled,
  }
}
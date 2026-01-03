import { onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../lib/supabaseClient'

export function useSupabaseSync(entriesRef, persistEntries = async () => {}, userRef = ref(null)) {
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const syncing = ref(false)
  const lastSyncError = ref(null)
  const supabaseEnabled = !!supabase

  const markSynced = async () => {
    if (!userRef?.value) return
    await persistEntries(entriesRef.value)
  }

  const syncPendingEntries = async () => {
    if (!supabase || !isOnline.value || !userRef?.value?.id) return 0
    const pending = entriesRef.value.filter((entry) => entry.status === 'pending')
    if (!pending.length) return 0

    syncing.value = true
    lastSyncError.value = null
    let syncedCount = 0

    for (const entry of pending) {
      const payload = {
        id: entry.id,
        date: entry.date,
        time_in: entry.timeIn,
        time_out: entry.timeOut,
        hours: entry.hours,
        created_at: entry.createdAt ?? new Date().toISOString(),
        user_id: entry.userId || userRef.value.id,
        user_email: entry.userEmail || userRef.value.email,
      }

      const { error } = await supabase.from('entries').upsert(payload)

      if (error) {
        lastSyncError.value = error.message
        continue
      }

      entry.status = 'synced'
      entry.syncedAt = new Date().toISOString()
      syncedCount += 1
    }

    await markSynced()
    syncing.value = false
    return syncedCount
  }

  const handleOnline = () => {
    isOnline.value = true
    syncPendingEntries()
  }

  const handleOffline = () => {
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (isOnline.value) {
      syncPendingEntries()
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
    syncPendingEntries,
    supabaseEnabled,
  }
}

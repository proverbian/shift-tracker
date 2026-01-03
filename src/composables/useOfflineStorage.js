import localforage from 'localforage'

localforage.config({
  name: 'time-tracker',
  storeName: 'entries',
  description: 'Offline time entry cache',
})

const STORE_KEY = 'time-tracker-entries-v2'

export function useOfflineStorage() {
  const loadEntries = async (userId) => {
    const saved = await localforage.getItem(STORE_KEY)

    // Backward compatibility: old array format
    if (Array.isArray(saved)) {
      return saved.filter((entry) => !entry.userId || entry.userId === userId)
    }

    if (saved && typeof saved === 'object') {
      return saved[userId] ?? []
    }

    return []
  }

  const persistEntries = async (entries, userId) => {
    if (!userId) return
    const saved = await localforage.getItem(STORE_KEY)
    const map = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
    // Convert to plain objects to avoid DataCloneError with Vue reactive objects
    map[userId] = JSON.parse(JSON.stringify(entries))
    await localforage.setItem(STORE_KEY, map)
  }

  const clearEntries = async (userId) => {
    if (!userId) return
    const saved = await localforage.getItem(STORE_KEY)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      delete saved[userId]
      await localforage.setItem(STORE_KEY, saved)
    }
  }

  return {
    loadEntries,
    persistEntries,
    clearEntries,
  }
}

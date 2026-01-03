import localforage from 'localforage'

localforage.config({
  name: 'time-tracker',
  storeName: 'shifts',
  description: 'Offline shift cache',
})

const STORE_KEY = 'time-tracker-shifts-v1'

export function useOfflineStorageShifts() {
  const loadShifts = async (userId) => {
    const saved = await localforage.getItem(STORE_KEY)

    if (Array.isArray(saved)) {
      return saved.filter((shift) => !shift.userId || shift.userId === userId)
    }

    if (saved && typeof saved === 'object') {
      return saved[userId] ?? []
    }

    return []
  }

  const persistShifts = async (shifts, userId) => {
    if (!userId) return
    const saved = await localforage.getItem(STORE_KEY)
    const map = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
    // Convert to plain objects to avoid DataCloneError with Vue reactive objects
    map[userId] = JSON.parse(JSON.stringify(shifts))
    await localforage.setItem(STORE_KEY, map)
  }

  const clearShifts = async (userId) => {
    if (!userId) return
    const saved = await localforage.getItem(STORE_KEY)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      delete saved[userId]
      await localforage.setItem(STORE_KEY, saved)
    }
  }

  return {
    loadShifts,
    persistShifts,
    clearShifts,
  }
}
import { computed } from 'vue'

function toDate(date, time) {
  if (!date || !time) return null
  const iso = `${date}T${time}`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

export function useTimeCalculator(entriesRef) {
  const calculateHours = (date, timeIn, timeOut) => {
    const start = toDate(date, timeIn)
    const end = toDate(date, timeOut)

    if (!start || !end) return 0

    // handle overnight shifts
    if (end <= start) {
      end.setDate(end.getDate() + 1)
    }

    const diffMs = end.getTime() - start.getTime()
    const hours = diffMs / (1000 * 60 * 60)

    if (hours < 0) return 0

    return Math.round(hours * 100) / 100
  }

  const totalHours = computed(() => {
    if (!entriesRef?.value) return 0
    return entriesRef.value.reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0)
  })

  return {
    calculateHours,
    totalHours,
  }
}

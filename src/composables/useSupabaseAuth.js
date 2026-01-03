import { computed, onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../lib/supabaseClient'

const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()

export function useSupabaseAuth() {
  const user = ref(null)
  const authReady = ref(false)
  const authError = ref(null)
  const loading = ref(false)
  const supabaseEnabled = !!supabase

  const signIn = async (email, password) => {
    if (!supabase) {
      authError.value = 'Supabase is not configured.'
      return null
    }

    loading.value = true
    authError.value = null
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    loading.value = false

    if (error) {
      authError.value = error.message
      return null
    }

    user.value = data.user
    return data.user
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    user.value = null
  }

  const isAdmin = computed(() => {
    const email = user.value?.email?.toLowerCase?.()
    return !!email && !!adminEmail && email === adminEmail
  })

  onMounted(async () => {
    if (!supabase) {
      authReady.value = true
      return
    }

    const { data } = await supabase.auth.getSession()
    if (data.session?.user) {
      user.value = data.session.user
    }
    authReady.value = true

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })

    onUnmounted(() => {
      listener?.subscription?.unsubscribe?.()
    })
  })

  return {
    user,
    isAdmin,
    authReady,
    authError,
    loading,
    supabaseEnabled,
    signIn,
    signOut,
  }
}

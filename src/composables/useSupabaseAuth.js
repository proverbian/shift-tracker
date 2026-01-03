import { computed, onMounted, onUnmounted, ref } from 'vue'
import { supabase } from '../lib/supabaseClient'

const superAdminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()

export function useSupabaseAuth() {
  const user = ref(null)
  const userRole = ref('employee')
  const authReady = ref(false)
  const authError = ref(null)
  const loading = ref(false)
  const signingOut = ref(false)
  const supabaseEnabled = !!supabase

  const fetchUserRole = async (userId) => {
    if (!supabase) return 'employee'
    
    // Use RPC function to bypass RLS and avoid recursion
    const { data, error } = await supabase
      .rpc('get_user_role', { target_user_id: userId })
    
    if (error || !data) return 'employee'
    return data
  }

  const updateUserRole = async (userEmail, userId) => {
    if (userEmail?.toLowerCase() === superAdminEmail) {
      userRole.value = 'superadmin'
    } else {
      const role = await fetchUserRole(userId)
      userRole.value = role
    }
  }

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
    await updateUserRole(data.user.email, data.user.id)
    return data.user
  }

  const signOut = async () => {
    if (!supabase || signingOut.value) return
    signingOut.value = true
    try {
      await supabase.auth.signOut()
      user.value = null
      userRole.value = 'employee'
    } finally {
      signingOut.value = false
    }
  }

  const isAdmin = computed(() => {
    return userRole.value === 'admin' || userRole.value === 'superadmin'
  })

  const isSuperAdmin = computed(() => {
    return userRole.value === 'superadmin'
  })

  onMounted(async () => {
    if (!supabase) {
      authReady.value = true
      return
    }

    const { data } = await supabase.auth.getSession()
    if (data.session?.user) {
      user.value = data.session.user
      await updateUserRole(data.session.user.email, data.session.user.id)
    }
    authReady.value = true

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      user.value = session?.user ?? null
      if (session?.user) {
        await updateUserRole(session.user.email, session.user.id)
      } else {
        userRole.value = 'employee'
      }
    })

    onUnmounted(() => {
      listener?.subscription?.unsubscribe?.()
    })
  })

  return {
    user,
    userRole,
    isAdmin,
    isSuperAdmin,
    authReady,
    authError,
    loading,
    signingOut,
    supabaseEnabled,
    signIn,
    signOut,
  }
}

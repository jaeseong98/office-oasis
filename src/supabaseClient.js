import { createClient } from '@supabase/supabase-js'

// anon 키는 RLS 로 보호되므로 클라이언트 코드에 박혀도 안전.
// (service_role 키는 절대 여기 넣지 말 것.)
const SUPABASE_URL = 'https://svefzwjnduykzwwuuknt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZWZ6d2puZHV5a3p3d3V1a250Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjU3NzEsImV4cCI6MjA5NTIwMTc3MX0.rOzN9Rzt8_sh-KqpB3TmwaQwz_f8dxK1qWYwdDY1B0I'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

// 익명 세션 확보 — 앱 시작 시 호출
let signInPromise = null
export function ensureAuthSession() {
  if (signInPromise) return signInPromise
  signInPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) return session
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) throw error
    return data.session
  })()
  return signInPromise
}

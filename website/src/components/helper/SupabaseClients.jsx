import { createClient } from '@supabase/supabase-js'

const normalizeSupabaseUrl = (url) =>
  String(url || '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/g, '')

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_TRANSPORTATION_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL)
const supabaseKey = import.meta.env.VITE_TRANSPORTATION_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY 

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

export const shouldUseLocalData =
  import.meta.env.VITE_SENSOR_DIRECTORY_SOURCE === 'local' ||
  !isSupabaseConfigured

export const getSupabaseErrorContext = (error) => {
  if (!error || typeof error !== 'object') return error

  return {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    status: error.status || error.statusCode,
  }
}

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null

export default supabase;

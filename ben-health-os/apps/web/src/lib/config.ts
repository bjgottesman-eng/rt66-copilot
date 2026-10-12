export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
export const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'local') as 'local' | 'supabase';
export const SESSION_COOKIE = 'bho_session';

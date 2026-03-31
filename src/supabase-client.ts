import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

// Node 20 polyfill for Supabase Realtime
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
export const supabaseRealtime = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

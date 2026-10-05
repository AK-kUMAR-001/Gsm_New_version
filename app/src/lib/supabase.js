import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://yfxinmfkfttzuwgmmifl.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeGlubWZrZnR0enV3Z21taWZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Mzc5NzAsImV4cCI6MjA4NzQxMzk3MH0.myukRHttFDaQLwW0pNOfXDYSmcmtsXbBTgFhaBY-j7s';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

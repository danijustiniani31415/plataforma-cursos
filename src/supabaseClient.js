import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = "https://wrahjlstautwinxyqcfx.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYWhqbHN0YXV0d2lueHlxY2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTMyNjYsImV4cCI6MjA4ODY4OTI2Nn0.iAbYatXkr5BAplYDhs7vMca2ROjb11uFM0e4619sD4s";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zlhgjizhgayntetdgbec.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsaGdqaXpoZ2F5bnRldGRnYmVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTM3ODEsImV4cCI6MjA4NzI4OTc4MX0.IU_RgwWqTyt-kD4JEgZiImOH9v2COpoIK_RT-XunW4g';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

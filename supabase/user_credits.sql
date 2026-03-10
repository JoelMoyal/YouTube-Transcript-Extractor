-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Creates the server-side credit tracking table for ScribeSnap.

CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  used     INTEGER     NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  tier_max INTEGER     NOT NULL DEFAULT 20,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security: users can only read their own row (server uses service role key, bypasses RLS)
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credits"
  ON public.user_credits FOR SELECT
  USING (auth.uid() = user_id);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS user_credits_user_id_idx ON public.user_credits(user_id);

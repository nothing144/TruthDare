-- Run this script in your Supabase SQL Editor to add the missing columns

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS state_master_id UUID;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS phase_started_at BIGINT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS phase_duration_seconds INT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_round_id UUID;

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE;

-- This forces the Supabase API to clear its cache and recognize the new columns immediately
NOTIFY pgrst, 'reload schema';

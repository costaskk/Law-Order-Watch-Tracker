-- Wolf Universe Watch Tracker: make each Trakt/Supabase user have exactly one status row.
-- Run this once in Supabase SQL Editor if sync still appears stale or needs two clicks.

-- Keep the newest watch_status row per user_id and remove older duplicates.
DELETE FROM public.watch_status a
USING public.watch_status b
WHERE a.user_id = b.user_id
  AND a.ctid < b.ctid
  AND COALESCE(a.updated_at, TIMESTAMPTZ '1970-01-01') <= COALESCE(b.updated_at, TIMESTAMPTZ '1970-01-01');

-- Add/enforce one row per user. If this already exists, the block does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_status_user_id_unique'
  ) THEN
    ALTER TABLE public.watch_status
      ADD CONSTRAINT watch_status_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Keep the FK pointed at the app's Trakt user table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'watch_status_user_id_fkey'
  ) THEN
    ALTER TABLE public.watch_status DROP CONSTRAINT watch_status_user_id_fkey;
  END IF;

  ALTER TABLE public.watch_status
    ADD CONSTRAINT watch_status_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.trakt_users(id)
    ON DELETE CASCADE;
END $$;

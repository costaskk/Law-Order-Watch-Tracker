-- Run once in Supabase SQL Editor.
-- Keeps only the newest watch_status row per user and enforces one row per user.

DELETE FROM public.watch_status a
USING public.watch_status b
WHERE a.user_id = b.user_id
  AND a.ctid < b.ctid
  AND COALESCE(a.updated_at, '1970-01-01'::timestamptz) <= COALESCE(b.updated_at, '1970-01-01'::timestamptz);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_status_user_id_unique'
      AND conrelid = 'public.watch_status'::regclass
  ) THEN
    ALTER TABLE public.watch_status
      ADD CONSTRAINT watch_status_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

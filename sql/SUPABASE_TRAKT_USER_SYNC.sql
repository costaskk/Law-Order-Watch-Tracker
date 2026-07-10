-- Wolf Universe Watch Tracker: canonical Supabase schema (fresh install)
-- Run in Supabase SQL Editor. The browser never receives the service-role key.

create extension if not exists pgcrypto;

create table if not exists public.trakt_users (
  id uuid primary key default gen_random_uuid(),
  trakt_username text unique not null,
  trakt_user_slug text,
  trakt_access_token text,
  trakt_refresh_token text,
  token_expires_at timestamptz,
  display_name text,
  avatar_url text,
  profile_json jsonb not null default '{}'::jsonb,
  profile_updated_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watch_status (
  user_id uuid primary key references public.trakt_users(id) on delete cascade,
  -- Trakt-owned watched history.
  status jsonb not null default '{}'::jsonb,
  -- App-owned Watching / Skipped / explicit overrides.
  manual_status jsonb not null default '{}'::jsonb,
  trakt_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  -- SHA-256 hashes are stored here; the raw session id stays only in the signed cookie.
  session_id text primary key,
  user_id uuid not null references public.trakt_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions(expires_at);
create index if not exists trakt_users_last_sync_idx on public.trakt_users(last_sync_at desc);

alter table public.trakt_users enable row level security;
alter table public.watch_status enable row level security;
alter table public.app_sessions enable row level security;

-- No public policies are intentionally created. Vercel serverless functions use
-- SUPABASE_SERVICE_ROLE_KEY. Never expose that key to frontend JavaScript.

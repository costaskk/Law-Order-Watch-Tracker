-- Wolf Universe per-user Trakt sync schema
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.trakt_users (
  id uuid primary key default gen_random_uuid(),
  trakt_username text unique not null,
  trakt_user_slug text,
  trakt_access_token text not null,
  trakt_refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watch_status (
  user_id uuid primary key references public.trakt_users(id) on delete cascade,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  session_id text primary key,
  user_id uuid not null references public.trakt_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions(expires_at);

alter table public.trakt_users enable row level security;
alter table public.watch_status enable row level security;
alter table public.app_sessions enable row level security;

-- No public policies are required. The Vercel API uses SUPABASE_SERVICE_ROLE_KEY.
-- Do NOT put SUPABASE_SERVICE_ROLE_KEY in frontend JS.

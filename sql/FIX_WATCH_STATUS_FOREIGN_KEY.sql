-- Fix for:
-- insert or update on table "watch_status" violates foreign key constraint "watch_status_user_id_fkey"
--
-- Run this in Supabase SQL Editor. It is safe to run more than once.
-- It keeps existing data, removes the wrong/old FK, and makes watch_status.user_id
-- reference public.trakt_users(id), which is what the Vercel API uses.

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
  user_id uuid primary key,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  session_id text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Drop any old FK constraints on these two tables, regardless of what they reference.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass::text as table_name, conname
    from pg_constraint
    where contype = 'f'
      and conrelid in ('public.watch_status'::regclass, 'public.app_sessions'::regclass)
  loop
    execute format('alter table %s drop constraint if exists %I', r.table_name, r.conname);
  end loop;
end $$;

-- Remove orphan rows that cannot satisfy the correct FK.
delete from public.watch_status ws
where not exists (select 1 from public.trakt_users tu where tu.id = ws.user_id);

delete from public.app_sessions s
where not exists (select 1 from public.trakt_users tu where tu.id = s.user_id);

-- Ensure uniqueness required for upsert on_conflict=user_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.watch_status'::regclass
      and contype = 'p'
  ) then
    alter table public.watch_status add constraint watch_status_pkey primary key (user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.watch_status'::regclass
      and conname = 'watch_status_user_id_fkey'
  ) then
    alter table public.watch_status
      add constraint watch_status_user_id_fkey
      foreign key (user_id) references public.trakt_users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_sessions'::regclass
      and conname = 'app_sessions_user_id_fkey'
  ) then
    alter table public.app_sessions
      add constraint app_sessions_user_id_fkey
      foreign key (user_id) references public.trakt_users(id) on delete cascade;
  end if;
end $$;

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions(expires_at);

alter table public.trakt_users enable row level security;
alter table public.watch_status enable row level security;
alter table public.app_sessions enable row level security;

select
  'watch_status FK now references trakt_users(id)' as result,
  count(*) filter (where c.conname = 'watch_status_user_id_fkey') as watch_status_fk_count
from pg_constraint c
where c.conrelid = 'public.watch_status'::regclass;

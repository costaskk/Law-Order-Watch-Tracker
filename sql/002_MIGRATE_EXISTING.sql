-- Wolf Universe Watch Tracker: safe migration for an existing installation.
-- Run after backing up the three tables.

create extension if not exists pgcrypto;

alter table if exists public.trakt_users
  add column if not exists trakt_user_slug text,
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists profile_json jsonb not null default '{}'::jsonb,
  add column if not exists profile_updated_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Remove duplicate watch_status rows before adding the unique key.
do $$
begin
  if to_regclass('public.watch_status') is not null then
    delete from public.watch_status a
    using public.watch_status b
    where a.ctid < b.ctid and a.user_id = b.user_id;
  end if;
end $$;

alter table if exists public.watch_status
  add column if not exists manual_status jsonb not null default '{}'::jsonb,
  add column if not exists trakt_synced_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Correct old auth.users foreign keys and point them to trakt_users.
do $$
declare constraint_name text;
begin
  if to_regclass('public.watch_status') is not null then
    for constraint_name in
      select conname
      from pg_constraint
      where conrelid = 'public.watch_status'::regclass and contype = 'f'
    loop
      execute format('alter table public.watch_status drop constraint %I', constraint_name);
    end loop;
    begin
      alter table public.watch_status
        add constraint watch_status_user_id_fkey
        foreign key (user_id) references public.trakt_users(id) on delete cascade;
    exception when duplicate_object then null;
    end;
    begin
      alter table public.watch_status add constraint watch_status_user_id_key unique (user_id);
    exception when duplicate_object then null;
    end;
  end if;
end $$;

create table if not exists public.app_sessions (
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

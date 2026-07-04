-- Run this once in Supabase SQL Editor.
-- It creates per-user cloud saving for the Law & Order Watch Tracker.

create table if not exists public.watch_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.watch_status enable row level security;

drop policy if exists "Users can read their own watch status" on public.watch_status;
drop policy if exists "Users can insert their own watch status" on public.watch_status;
drop policy if exists "Users can update their own watch status" on public.watch_status;
drop policy if exists "Users can delete their own watch status" on public.watch_status;

create policy "Users can read their own watch status"
on public.watch_status for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own watch status"
on public.watch_status for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own watch status"
on public.watch_status for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own watch status"
on public.watch_status for delete
to authenticated
using (auth.uid() = user_id);

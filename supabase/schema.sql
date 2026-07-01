-- Lumio Supabase schema.
-- Run this in the Supabase SQL editor for your project. Safe to re-run
-- (uses IF NOT EXISTS / CREATE OR REPLACE where possible).

-- Conversations: cloud sync + shareable links.
create table if not exists lumio_conversations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  model text not null,
  messages jsonb not null default '[]',
  share_id uuid not null default gen_random_uuid(),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lumio_conversations enable row level security;

create policy if not exists "owners manage their conversations"
  on lumio_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "anyone can read public conversations"
  on lumio_conversations for select
  using (is_public = true);

create index if not exists lumio_conversations_share_id_idx
  on lumio_conversations (share_id);

-- Memory: durable, cross-conversation facts the model has been told to remember.
create table if not exists lumio_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  facts jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table lumio_memory enable row level security;

create policy if not exists "owners manage their own memory"
  on lumio_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Rate limiting: shared across serverless instances (best-effort — see
-- src/app/api/chat/route.ts for the in-memory fallback when this table, or
-- Supabase itself, isn't configured). Keyed by a hash of the client IP, not
-- the IP itself. No user data; safe to allow anonymous read/write.
create table if not exists lumio_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

alter table lumio_rate_limits enable row level security;

create policy if not exists "anon can read/write rate limit counters"
  on lumio_rate_limits for all
  using (true)
  with check (true);

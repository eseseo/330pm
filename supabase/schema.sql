create extension if not exists pgcrypto;

create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text not null,
  market_type text not null check (market_type in ('KR', 'US')),
  exchange text not null,
  last_close numeric(14, 2),
  change_rate numeric(7, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (symbol, market_type)
);

create index if not exists stocks_name_idx on public.stocks (name);
create index if not exists stocks_symbol_idx on public.stocks (symbol);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 120),
  emotion_tag text,
  anonymous_writer_hash text not null,
  market_date date not null,
  market_type text not null check (market_type in ('KR', 'US')),
  empathy_count integer not null default 0,
  is_hidden boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists posts_stock_id_created_at_idx on public.posts (stock_id, created_at desc);
create index if not exists posts_market_date_idx on public.posts (market_date);
create index if not exists posts_writer_hash_idx on public.posts (anonymous_writer_hash);

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('empathy')),
  session_hash text not null,
  created_at timestamptz not null default now(),
  unique (post_id, reaction_type, session_hash)
);

create index if not exists reactions_session_hash_idx on public.reactions (session_hash);
create index if not exists reactions_created_at_idx on public.reactions (created_at desc);

alter table public.reactions enable row level security;

-- Allow anyone to insert a reaction (duplicate prevention is handled in app logic)
create policy if not exists "reactions_insert_anon"
  on public.reactions for insert
  with check (true);

-- Allow anyone to read reactions
create policy if not exists "reactions_select_anon"
  on public.reactions for select
  using (true);

create table if not exists public.market_sessions (
  id uuid primary key default gen_random_uuid(),
  market_type text not null check (market_type in ('KR', 'US')),
  session_date date not null,
  write_open_at timestamptz not null,
  write_close_at timestamptz not null,
  is_write_open boolean not null default false,
  created_at timestamptz not null default now(),
  unique (market_type, session_date)
);

create index if not exists market_sessions_market_date_idx on public.market_sessions (market_type, session_date desc);

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  reason text not null,
  action_type text not null,
  created_at timestamptz not null default now()
);

-- Atomically increment empathy_count and return new value.
-- Call this instead of read-increment-write to avoid race conditions.
create or replace function public.increment_post_empathy(p_post_id uuid)
returns integer
language sql
as $$
  update public.posts
  set empathy_count = empathy_count + 1
  where id = p_post_id
    and is_hidden = false
    and deleted_at is null
  returning empathy_count;
$$;

create or replace function public.add_empathy_reaction(
  p_post_id uuid,
  p_session_hash text
)
returns integer
language plpgsql
as $$
declare
  v_empathy_count integer;
begin
  insert into public.reactions (post_id, reaction_type, session_hash)
  values (p_post_id, 'empathy', p_session_hash);

  update public.posts
  set empathy_count = empathy_count + 1
  where id = p_post_id
    and is_hidden = false
    and deleted_at is null
  returning empathy_count into v_empathy_count;

  if v_empathy_count is null then
    raise exception 'post_not_found';
  end if;

  return v_empathy_count;
exception
  when unique_violation then
    raise exception 'duplicate_reaction';
end;
$$;

create or replace function public.top_mentioned_stocks(
  p_market text,
  p_day date,
  p_limit int default 5
)
returns table (
  id uuid,
  symbol text,
  name text,
  mention_count bigint
)
language sql
stable
as $$
  select s.id, s.symbol, s.name, count(p.id) as mention_count
  from public.posts p
  join public.stocks s on s.id = p.stock_id
  where p.market_type = p_market
    and p.market_date = p_day
    and p.is_hidden = false
    and p.deleted_at is null
  group by s.id, s.symbol, s.name
  order by mention_count desc, s.name asc
  limit greatest(p_limit, 1);
$$;

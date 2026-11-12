-- MatTime shared data: one table. Run once in Supabase > SQL Editor.
create table if not exists public.docs (
  path text primary key,
  coll text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_coll_idx on public.docs (coll);
alter table public.docs enable row level security;
drop policy if exists "mattime open" on public.docs;
create policy "mattime open" on public.docs for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.docs to anon, authenticated;

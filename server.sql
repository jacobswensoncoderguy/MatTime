-- MatTime server job (v3). Run once in Supabase > SQL Editor. Safe to run again.
-- What it does, every 5 seconds on a meet day (from 60 min before the scheduled start until 10:30 PM Boise):
--   1. records what FloWrestling shows for today's meet, with a server timestamp (same as v2, the version that was live on Nov 18);
--   2. writes a heartbeat (config/flopoll) the app shows as "Flo checked h:mm:ss";
--   3. NEW: sends the GO NOW phone alert itself through ntfy (topic in config/notify), so no phone needs the page open,
--      and one "meet under way" alert when Flo posts its first result. Each is sent once per meet and noted in config/push.
-- It never touches meets/<id>/bouts (times entered by hand).
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- Bouts still ahead of the tracked wrestler, from the stored bout sheet + Flo results + hand-timed bouts. Read-only.
-- Tracked wrestler: config/notify.name (default Oliver Swenson) found on the sheet, else the meet's "track" row.
create or replace function public.mt_go_ahead(p_meet text, p_asof bigint default null) returns jsonb
language sql stable security definer set search_path = public, extensions set jit = off as $fn$   -- jit off: the planner over-estimates this query and would spend ~1.5 s compiling a 25 ms read
with m as (select data from public.docs where path = 'meets/'||p_meet),
tn as materialized (select btrim(regexp_replace(regexp_replace(lower(coalesce((select data->>'name' from public.docs where path='config/notify'),'Oliver Swenson')),'[^a-z ]',' ','g'),'\s+',' ','g')) as n),
r1 as (
  select mk.key as sh, mk.value->>'name' as mat, sec.ord::int as si, (b.ord-1)::int as bi, jsonb_array_length(sec.val->'bouts') as n,
         coalesce(b.val->>0,'') as wt, coalesce(b.val->>1,'') as a, coalesce(b.val->>2,'') as c
  from m, jsonb_each(m.data->'mats') mk,
       jsonb_array_elements(case when jsonb_typeof(mk.value->'sections')='array' then mk.value->'sections' else '[]'::jsonb end) with ordinality sec(val,ord),
       jsonb_array_elements(case when jsonb_typeof(sec.val->'bouts')='array' then sec.val->'bouts' else '[]'::jsonb end) with ordinality b(val,ord)),
r2 as (select r1.*, (row_number() over (partition by sh order by si, bi) - 1)::int as i,
         btrim(regexp_replace(regexp_replace(lower(a),'[^a-z ]',' ','g'),'\s+',' ','g')) as na,
         btrim(regexp_replace(regexp_replace(lower(c),'[^a-z ]',' ','g'),'\s+',' ','g')) as nc from r1),
r3 as (select r2.*, (min(i) over (partition by sh, si))::int as base from r2),
-- running order inside each section: start at the hand-picked row, else at the first weight >= the meet's starting weight, then wrap
st as (select sh, si, coalesce(
           max(case when (m.data->'startAt'->>sh) ~ '^\d+$' and (m.data->'startAt'->>sh)::int between base and base+n-1 then (m.data->'startAt'->>sh)::int - base end),
           min(case when (m.data->>'startWt') ~ '^\d+$' and wt ~ '^\d+$' and wt::int >= (m.data->>'startWt')::int then bi end), 0) as s
       from r3, m group by sh, si),
r4 as materialized (select r3.*, base + ((bi - st.s + n) % n) as p from r3 join st using (sh, si)),
fl as materialized (select x.*, substring(fa from '[a-z]+$') as la, substring(fc from '[a-z]+$') as lc from (select btrim(regexp_replace(regexp_replace(lower(coalesce(data->>'a','')),'[^a-z ]',' ','g'),'\s+',' ','g')) as fa,
              btrim(regexp_replace(regexp_replace(lower(coalesce(data->>'c','')),'[^a-z ]',' ','g'),'\s+',' ','g')) as fc, coalesce(data->>'wt','') as wt
       from public.docs where coll = 'meets/'||p_meet||'/flo' and (data->>'endMs') is not null and (p_asof is null or (data->>'endMs')::bigint <= p_asof)) x),
hb as materialized (select id from public.docs where coll = 'meets/'||p_meet||'/bouts' and ((data->>'start') is not null or (data->>'end') is not null or data->>'forfeit' = 'true')
         and (p_asof is null or coalesce((data->>'updatedAtMs')::bigint,0) <= p_asof)),
d as materialized (select r4.*, (a = '' or c = '') as ff,
        -- a Flo result marks a row finished only when BOTH wrestlers match (exact, or same last name + first initial), in either order
        (exists(select 1 from fl where fl.fa <> '' and fl.fc <> '' and na <> '' and nc <> '' and (
             (fl.fa = na and fl.fc = nc) or (fl.fa = nc and fl.fc = na)
          or (fl.la = substring(na from '[a-z]+$') and left(fl.fa,1) = left(na,1) and fl.lc = substring(nc from '[a-z]+$') and left(fl.fc,1) = left(nc,1))
          or (fl.la = substring(nc from '[a-z]+$') and left(fl.fa,1) = left(nc,1) and fl.lc = substring(na from '[a-z]+$') and left(fl.fc,1) = left(na,1))))
         or exists(select 1 from hb where hb.id = sh||'-'||lpad((i+1)::text,2,'0'))) as done from r4),
tk as (select * from (
         select d.*, 0 as pref from d, tn where tn.n <> '' and (d.na = tn.n or d.nc = tn.n)
         union all
         select d.*, 1 as pref from d, m where d.sh = split_part(coalesce(m.data->>'track',''),'|',1) and split_part(coalesce(m.data->>'track',''),'|',2) ~ '^\d+$' and d.i = split_part(m.data->>'track','|',2)::int
       ) x order by pref, done, p limit 1)
select jsonb_build_object(
  'rows', (select count(*) from d),
  'results', (select count(*) from fl) + (select count(*) from hb),
  'found', (select count(*) from tk) > 0,
  'who', (select case when pref = 0 and na = (select n from tn) then a when pref = 0 then c else coalesce(nullif(c,''),a) end from tk),
  'mat', (select mat from tk), 'row', (select i+1 from tk), 'done', coalesce((select done from tk), false),
  -- an unmatched row counts as passed once a finished bout sits 3+ rows beyond it (mats run a row or two out of order), same rule as the app
  'ahead', (select count(*) from d, tk where d.sh = tk.sh and d.p < tk.p and not d.ff and not d.done
              and not exists(select 1 from d d2 where d2.sh = d.sh and d2.done and d2.p > d.p + 2 and d2.p < tk.p)))
$fn$;
revoke execute on function public.mt_go_ahead(text, bigint) from public, anon, authenticated;

drop function if exists public.mt_flo_poll();
create or replace function public.mt_flo_poll(p_force boolean default false) returns integer
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  nowl timestamp := now() at time zone 'America/Boise';
  today text := to_char(nowl,'YYYY-MM-DD');
  meet jsonb; ev text; lvl text; base text; ts jsonb; tid text; r jsonb; b jsonb; cur jsonb; ncfg jsonb; pushd jsonb; g jsonb; resp record;
  p text; fin boolean; live boolean; a_win boolean; n int := 0; reached int := 0; posting int := 0; nowms bigint;
  startm int := 990; nowm int; topic text; lim int; msg text; sent text := null;
begin
  select data into meet from public.docs where path = 'meets/'||today;
  if meet is null or jsonb_typeof(meet->'flo') is distinct from 'array' or jsonb_array_length(meet->'flo') = 0 then return 0; end if;
  begin startm := split_part(meet->>'start',':',1)::int*60 + split_part(meet->>'start',':',2)::int; exception when others then startm := 990; end;
  nowm := extract(hour from nowl)::int*60 + extract(minute from nowl)::int;
  if not p_force and (nowm < startm - 60 or nowm > 22*60+30) then return 0; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT','6');
  for ev in select jsonb_array_elements_text(meet->'flo') loop
    base := 'https://prod-web-api.flowrestling.org/api/event-hub/'||ev;
    r := null;
    begin
      select content::jsonb into ts from http_get(base);
      lvl := coalesce(ts#>>'{data,competitionCategoryLabels,0}','');
      select content::jsonb into ts from http_get(base||'/results/rounds/event-team?offset=0&limit=1000');
      reached := reached + 1;   -- Flo answered for this event
      if jsonb_typeof(ts->'data') is distinct from 'array' or jsonb_array_length(ts->'data') = 0 then continue; end if;   -- nothing scored yet
      select coalesce((select x->>'id' from jsonb_array_elements(ts->'data') x where x->>'title' ilike '%eagle%' limit 1), ts#>>'{data,0,id}') into tid;
      select content::jsonb into r from http_get(base||'/results/rounds/event-team/items?offset=0&limit=1000&groupFilter='
        ||urlencode(jsonb_build_object('id','event-team','type','string','value',tid)::text));
      posting := posting + 1;   -- Flo is listing results for this event
    exception when others then continue;
    end;
    if r is null or jsonb_typeof(r->'data') is distinct from 'array' then continue; end if;
    for b in select bb from jsonb_array_elements(r->'data') gg
               cross join lateral jsonb_array_elements(case when jsonb_typeof(gg->'items')='array' then gg->'items' else '[]'::jsonb end) rr
               cross join lateral jsonb_array_elements(case when jsonb_typeof(rr->'items')='array' then rr->'items' else '[]'::jsonb end) bb loop
      if coalesce(b->>'id','') = '' then continue; end if;
      a_win := coalesce(b#>>'{athlete1,isWinner}','') = 'true';
      fin := a_win or coalesce(b#>>'{athlete2,isWinner}','') = 'true';
      live := not fin and (coalesce(b#>>'{athlete1,score}','0') not in ('0','') or coalesce(b#>>'{athlete2,score}','0') not in ('0',''));
      nowms := (extract(epoch from clock_timestamp())*1000)::bigint;
      p := 'meets/'||today||'/flo/'||(b->>'id');
      select data into cur from public.docs where path = p;
      if not found then
        insert into public.docs(path,coll,id,data) values (p,'meets/'||today||'/flo',b->>'id',
          jsonb_build_object('ev',ev,'lvl',lvl,'wt',b->>'weightClass','a',coalesce(b#>>'{athlete1,name}',''),'c',coalesce(b#>>'{athlete2,name}',''),
            'aTeam',coalesce(b#>>'{athlete1,team,name}',''),'cTeam',coalesce(b#>>'{athlete2,team,name}',''),'aWin',a_win,'winType',coalesce(b->>'winType',''),
            'seenMs',nowms,'liveMs',case when live then nowms end,'endMs',case when fin then nowms end))
        on conflict (path) do nothing;
        n := n + 1;
      elsif fin and (cur->>'endMs') is null then
        update public.docs set data = cur || jsonb_build_object('endMs',nowms,'aWin',a_win,'winType',coalesce(b->>'winType','')), updated_at = now() where path = p;
        n := n + 1;
      elsif live and (cur->>'liveMs') is null and (cur->>'endMs') is null then
        update public.docs set data = cur || jsonb_build_object('liveMs',nowms), updated_at = now() where path = p;
        n := n + 1;
      end if;
    end loop;
  end loop;

  -- phone alerts, sent from here so they do not depend on a phone having the page open
  begin
    select data into ncfg from public.docs where path = 'config/notify';
    topic := coalesce(ncfg->>'ntfy','');
    if topic <> '' then
      select coalesce((select data from public.docs where path = 'config/push'),'{}'::jsonb) into pushd;
      g := public.mt_go_ahead(today);
      lim := case when (ncfg->>'ahead') ~ '^\d+$' then (ncfg->>'ahead')::int else 8 end;   -- 8 bouts out: about 20 min of warning on Nov 12 and 39 min on Nov 18 (replayed from the stored results)
      nowms := (extract(epoch from clock_timestamp())*1000)::bigint;
      if (g->>'results')::int > 0 and not (pushd ? (today||'|first')) then
        msg := 'First result is in at '||to_char(nowl,'FMHH12:MI AM')||'. '||case when (g->>'found')::boolean and not (g->>'done')::boolean
                 then (g->>'who')||': '||(g->>'ahead')||' bouts ahead on '||(g->>'mat')||'. GO NOW comes at '||lim||' or fewer.'
                 when (g->>'found')::boolean then (g->>'who')||' has already wrestled.'
                 else 'No bout sheet is loaded, so GO NOW cannot be timed. Add the sheets in Mat Time.' end;
        select * into resp from http(('POST','https://ntfy.sh/'||topic, array[http_header('Title','Mat Time: meet under way'),http_header('Tags','wrestling')], 'text/plain', msg)::http_request);
        if resp.status = 200 then pushd := pushd || jsonb_build_object(today||'|first', jsonb_build_object('ms',nowms)); sent := 'first'; end if;
      end if;
      if (g->>'found')::boolean and not (g->>'done')::boolean and (g->>'results')::int > 0 and (g->>'ahead')::int <= lim and not (pushd ? (today||'|go')) then
        msg := 'GO NOW · '||(g->>'who')||' · '||(g->>'ahead')||case when (g->>'ahead')::int = 1 then ' bout' else ' bouts' end||' ahead on '||(g->>'mat')||' (row '||(g->>'row')||').';
        select * into resp from http(('POST','https://ntfy.sh/'||topic, array[http_header('Title','GO NOW'),http_header('Priority','urgent'),http_header('Tags','rotating_light')], 'text/plain', msg)::http_request);
        if resp.status = 200 then pushd := pushd || jsonb_build_object(today||'|go', jsonb_build_object('ms',nowms,'ahead',(g->>'ahead')::int,'by','server')); sent := 'go'; end if;
      end if;
      if sent is not null then
        insert into public.docs(path,coll,id,data) values ('config/push','config','push',pushd)
          on conflict (path) do update set data = excluded.data, updated_at = now();
      end if;
    end if;
  exception when others then sent := 'error: '||sqlerrm;
  end;

  nowms := (extract(epoch from clock_timestamp())*1000)::bigint;
  insert into public.docs(path,coll,id,data) values ('config/flopoll','config','flopoll',
      jsonb_build_object('ms',nowms,'events',jsonb_array_length(meet->'flo'),'reached',reached,'posting',posting,'changed',n,'v',3,'ahead',g->'ahead','alert',sent))
    on conflict (path) do update set data = excluded.data, updated_at = now();
  return n;
end
$fn$;
revoke execute on function public.mt_flo_poll(boolean) from public, anon, authenticated;

do $do$
begin
  begin perform cron.unschedule('mt-flo-poll'); exception when others then null; end;
  begin perform cron.unschedule('mt-cron-cleanup'); exception when others then null; end;
  begin
    perform cron.schedule('mt-flo-poll','5 seconds','select public.mt_flo_poll()');
  exception when others then
    perform cron.schedule('mt-flo-poll','* * * * *','select public.mt_flo_poll()');
  end;
  perform cron.schedule('mt-cron-cleanup','15 9 * * *','delete from cron.job_run_details where end_time < now() - interval ''1 day''');
end
$do$;

notify pgrst, 'reload schema';
-- Result row: the poller version now installed, how often it runs, and what it sees for the next meet's sheet.
select 3 as poller_version, (select schedule from cron.job where jobname = 'mt-flo-poll') as runs_every,
       public.mt_go_ahead((select min(id) from public.docs where coll = 'meets' and id >= to_char(now() at time zone 'America/Boise','YYYY-MM-DD'))) as next_meet_check;

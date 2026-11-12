-- MatTime server job: records what FloWrestling shows for today's meet, every 20 seconds, with a server timestamp.
-- Run once in Supabase > SQL Editor. Safe to run again.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create or replace function public.mt_flo_poll() returns integer
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  today text := to_char(now() at time zone 'America/Boise','YYYY-MM-DD');
  meet jsonb; ev text; lvl text; base text; ws jsonb; w jsonb; r jsonb; b jsonb; cur jsonb;
  p text; fin boolean; live boolean; a_win boolean; n int := 0; reached int := 0; nowms bigint;
begin
  select data into meet from public.docs where path = 'meets/'||today;
  if meet is null or jsonb_typeof(meet->'flo') is distinct from 'array' or jsonb_array_length(meet->'flo') = 0 then return 0; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT','6');
  for ev in select jsonb_array_elements_text(meet->'flo') loop
    base := 'https://prod-web-api.flowrestling.org/api/event-hub/'||ev;
    begin
      select content::jsonb into ws from http_get(base);
      lvl := coalesce(ws#>>'{data,competitionCategoryLabels,0}','');
      select content::jsonb into ws from http_get(base||'/results/rounds/event-weight-class?offset=0&limit=1000');
      reached := reached + 1;
    exception when others then continue;
    end;
    for w in select x from jsonb_array_elements(case when jsonb_typeof(ws->'data')='array' then ws->'data' else '[]'::jsonb end) x loop
      begin
        select content::jsonb into r from http_get(base||'/results/rounds/event-weight-class/items?groupFilter='
          ||urlencode(jsonb_build_object('id','event-weight-class','type','string','value',w->>'id')::text));
      exception when others then continue;
      end;
      if jsonb_typeof(r->'data') is distinct from 'array' then continue; end if;
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
  end loop;
  nowms := (extract(epoch from clock_timestamp())*1000)::bigint;
  insert into public.docs(path,coll,id,data) values ('config/flopoll','config','flopoll',
      jsonb_build_object('ms',nowms,'events',jsonb_array_length(meet->'flo'),'reached',reached,'changed',n))
    on conflict (path) do update set data = excluded.data, updated_at = now();
  return n;
end
$fn$;
revoke execute on function public.mt_flo_poll() from public, anon, authenticated;

do $do$
begin
  begin perform cron.unschedule('mt-flo-poll'); exception when others then null; end;
  begin perform cron.unschedule('mt-cron-cleanup'); exception when others then null; end;
  begin
    perform cron.schedule('mt-flo-poll','20 seconds','select public.mt_flo_poll()');
  exception when others then
    perform cron.schedule('mt-flo-poll','* * * * *','select public.mt_flo_poll()');
  end;
  perform cron.schedule('mt-cron-cleanup','15 9 * * *','delete from cron.job_run_details where end_time < now() - interval ''1 day''');
end
$do$;

notify pgrst, 'reload schema';
select public.mt_flo_poll() as changes_this_run, (select schedule from cron.job where jobname = 'mt-flo-poll') as runs_every;

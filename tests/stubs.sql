create schema if not exists extensions; create schema if not exists cron;
create table public.docs(path text primary key, coll text, id text, data jsonb, updated_at timestamptz default now());
create table cron.job(jobname text, schedule text, command text);
create function cron.schedule(a text,b text,c text) returns int language sql as $$ insert into cron.job values(a,b,c); select 1 $$;
create function cron.unschedule(a text) returns boolean language sql as $$ delete from cron.job where jobname=a; select true $$;
create type extensions.http_header as (field varchar, value varchar);
create type extensions.http_request as (method varchar, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
create type extensions.http_response as (status int, content_type varchar, headers extensions.http_header[], content varchar);
create table public.sim(t bigint, ev text, body jsonb); create table public.sent(at_t bigint, uri text, title text, body text);
create table public.simt(t bigint); insert into public.simt values(0);
create function extensions.http_header(f varchar, v varchar) returns extensions.http_header language sql as $$ select row(f,v)::extensions.http_header $$;
create function extensions.http_set_curlopt(a varchar,b varchar) returns boolean language sql as $$ select true $$;
create function extensions.urlencode(a text) returns text language sql as $$ select a $$;
create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$ begin
  insert into public.sent values((select t from public.simt), r.uri, (select value from unnest(r.headers) h where h.field='Title'), r.content); return row(200,'text/plain',null,'ok')::extensions.http_response; end $$;
-- fake Flo: an event lists teams and bouts only once something is finished, like the real one
create function extensions.http_get(u varchar) returns extensions.http_response language plpgsql as $$ declare e text := substring(u from 'event-hub/([A-Za-z0-9]+)'); t0 bigint := (select t from public.simt); items jsonb; begin
  select coalesce(jsonb_agg(body),'[]'::jsonb) into items from public.sim where ev=e and t<=t0;
  if u like '%/items%' then return row(200,'application/json',null,jsonb_build_object('data',jsonb_build_array(jsonb_build_object('items',jsonb_build_array(jsonb_build_object('items',items)))))::text)::extensions.http_response;
  elsif u like '%event-team%' then return row(200,'application/json',null,jsonb_build_object('data',case when jsonb_array_length(items)>0 then '[{"id":"T1","title":"Eagle Middle School"}]'::jsonb else '[]'::jsonb end)::text)::extensions.http_response;
  else return row(200,'application/json',null,'{"data":{"competitionCategoryLabels":["Junior Varsity"]}}')::extensions.http_response; end if; end $$;

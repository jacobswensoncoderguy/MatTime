# Local Postgres replay of the server job: fake Flo feeds recorded results minute by minute; real server.sql runs unchanged.
import json,subprocess,sys,datetime as dt
import os; S=os.path.dirname(os.path.abspath(__file__))+'/'
def psql(sql,db='mt'):
    r=subprocess.run(['psql','-h','/tmp/mtpg','-p','5544','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-qAt','-f','-'],input=sql,capture_output=True,text=True)
    if r.returncode: sys.exit('PSQL ERROR '+r.stderr[:1500])
    return r.stdout.strip()
q=lambda v: "'"+json.dumps(v).replace("'","''")+"'::jsonb"
today=psql("select to_char(now() at time zone 'America/Boise','YYYY-MM-DD')",'postgres')
fmt=lambda ms:(dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc)-dt.timedelta(hours=7)).strftime('%-I:%M %p')
for meet,thr in [('2026-11-18',None),('2026-11-12',None),('noroster',None)]:
    psql('drop database if exists mt; create database mt;','postgres'); psql(open(S+'stubs.sql').read()); 
    src='2026-11-18' if meet=='noroster' else meet
    md=[r for r in json.load(open(S+'fx/meets.json')) if r['id']==src][0]['data']
    if meet=='noroster': md['mats']={k:{'name':v['name'],'sections':[]} for k,v in md['mats'].items()}
    flo=json.load(open(S+f'fx/meets_{src}_flo.json')); bouts=json.load(open(S+f'fx/meets_{src}_bouts.json'))
    sql=f"insert into docs(path,coll,id,data) values('meets/{today}','meets','{today}',{q(md)});\n"
    ncfg={'ntfy':'test-topic'}; 
    if thr: ncfg['ahead']=thr
    sql+=f"insert into docs(path,coll,id,data) values('config/notify','config','notify',{q(ncfg)});\n"
    for r in flo:
        x=r['data']; body={'id':r['id'],'weightClass':x['wt'],'winType':x.get('winType',''),'athlete1':{'name':x['a'],'isWinner':bool(x.get('aWin')),'score':'1','team':{'name':x.get('aTeam','')}},'athlete2':{'name':x['c'],'isWinner':not x.get('aWin'),'score':'0','team':{'name':x.get('cTeam','')}}}
        sql+=f"insert into sim values({x['endMs']},'{x['ev']}',{q(body)});\n"
    psql(sql); import re; out=psql(re.sub(r'(?m)^create extension.*$','',open(S+'../server.sql').read())); 
    day0=int(dt.datetime.fromisoformat(src+'T00:00:00-07:00').timestamp()*1000); trace=[]
    for minute in range(16*60, 19*60+31):
        T=day0+minute*60000; sql=f"update simt set t={T};\n"
        for r in bouts:
            x=r['data']
            if x.get('start') is not None and x['start']<=minute:
                d=dict(x); 
                if d.get('end') is not None and d['end']>minute: d.pop('end')
                sql+=f"insert into docs(path,coll,id,data) values('meets/{today}/bouts/{r['id']}','meets/{today}/bouts','{r['id']}',{q(d)}) on conflict(path) do update set data=excluded.data;\n"
        sql+="select public.mt_flo_poll(true);\nselect '|'||data::text from docs where path='config/flopoll';"
        o=psql(sql); hb=json.loads(o.split('|',1)[1])
        if minute%4==0 and 990<=minute<=1150: trace.append(f"{fmt(T)[:-3]}:{hb.get('ahead')}")
        if str(hb.get('alert') or '').startswith('error'): sys.exit('ALERT ERROR '+o)
    # second run of the same minute must send nothing new, and hand-entered bouts must be untouched
    n1=psql("select count(*) from sent"); psql("select public.mt_flo_poll(true)"); n2=psql("select count(*) from sent"); assert n1==n2, 'duplicate alert'
    hand=psql(f"select count(*) from docs where coll='meets/{today}/bouts'"); nflo=psql(f"select count(*) from docs where coll='meets/{today}/flo' and data->>'endMs' is not null")
    chk=sum(1 for r in bouts if r['data'].get('start') is not None); assert int(hand)==chk,(hand,chk); assert int(nflo)==len(flo),(nflo,len(flo))
    same=psql(f"select count(*) from docs d where coll='meets/{today}/bouts' and (data->>'start') is null"); assert same=='0'
    print(f"== {meet} threshold {thr or 8}: flo docs {nflo}/{len(flo)}, hand bouts kept {hand}, heartbeat {psql('select data::text from docs where path=$$config/flopoll$$')}")
    for row in psql("select at_t||'~'||title||'~'||body from sent order by at_t").split('\n'):
        if row: t,ti,b=row.split('~',2); print('   ',fmt(int(t)),'|',ti,'|',b)
    print('    ahead by time:',' '.join(trace)); print('    push doc:',psql("select data::text from docs where path='config/push'")[:200])
    print('    deploy output:',out.replace('\n',' / ')[:260])

// Test harness: serves the repo's index.html locally, replays recorded store data (or passes GETs to the live store), blocks every non-GET.
const {chromium}=require('playwright'); const http=require('http'); const fs=require('fs'); const path=require('path'); const {execFileSync}=require('child_process');
const REPO=path.join(__dirname,'..'), FX=path.join(__dirname,'fx');
const fx=n=>JSON.parse(fs.readFileSync(path.join(FX,n+'.json'),'utf8'));
const cache={};
function curl(url){ if(cache[url]) return cache[url]; const hf=path.join(__dirname,'.h'); const body=execFileSync('curl',['-s','-L','--max-time','20','-D',hf,'-H','apikey: sb_publishable_WFqCxeR9AjQ2ecjqryETLQ_1Xx2aDV8','-A','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',url],{maxBuffer:5e7}); const h=fs.readFileSync(hf,'utf8'); const ct=(h.match(/content-type:\s*([^\r\n]+)/ig)||[]).pop(); return cache[url]={body,ct:ct?ct.split(':').slice(1).join(':').trim():'application/octet-stream'}; }
let server=null, transform=null;
function serve(){ if(server) return; server=http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/'||p==='/MatTime/') p='/index.html'; p=p.replace(/^\/MatTime/,''); const f=path.join(REPO,p); if(!fs.existsSync(f)){ r.writeHead(404); r.end(); return; } let b=fs.readFileSync(f); if(p==='/index.html'&&transform) b=Buffer.from(transform(b.toString())); r.writeHead(200,{'content-type':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':p.endsWith('.js')?'text/javascript':'application/json'}); r.end(b); }).listen(8765); }
const minOf=ms=>{ const d=new Date(ms-7*3600e3); return d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60; };
function replayRows(coll,o){ const T=o.maskT||o.T, nm=minOf(T);
  if(coll==='config') return [{id:'current',data:{id:o.current||o.meet}},{id:'notify',data:{ntfy:'test-topic'}},{id:'flopoll',data:Object.assign({ms:o.T-4000,events:2,reached:2,changed:0,v:2},o.hb||{})}].concat(o.push?[{id:'push',data:o.push}]:[]);
  if(coll==='meets'){ let rows=fx('meets').map(r=>JSON.parse(JSON.stringify(r))); if(o.onlyUpTo) rows=rows.filter(r=>r.id<=o.onlyUpTo); rows.forEach(r=>{ if(r.id===o.meet&&!o.keepSummary) r.data.summary=null; if(o.meetPatch&&r.id===o.meet) Object.assign(r.data,o.meetPatch); }); return rows; }
  const m=/^meets\/([^/]+)\/(bouts|flo|guesslog)$/.exec(coll); if(!m) return [];
  let rows; try{ rows=fx('meets_'+m[1]+'_'+m[2]); }catch(e){ return []; } rows=JSON.parse(JSON.stringify(rows)); if(o.noMask) return rows;
  if(m[1]!==o.meet) return rows;
  if(m[2]==='bouts') return rows.filter(r=>{ const x=r.data; if(x.start!=null) return x.start<=nm; return (x.updatedAtMs||0)<=T; }).map(r=>{ if(r.data.end!=null&&r.data.end>nm){ delete r.data.end; delete r.data.winner; } return r; });
  if(m[2]==='flo') return rows.filter(r=>r.data.seenMs<=T).map(r=>{ if(r.data.endMs>T) r.data.endMs=null; if(r.data.liveMs>T) r.data.liveMs=null; return r; });
  return rows.filter(r=>r.data.at<=T);
}
let browser=null;
async function open(o){ // o: {mode:'replay'|'live', meet, T(ms), width, height, ctx, safeTop, delayMs, offline, dark}
  serve(); transform=o.safeTop?(s=>s.replace(/env\(safe-area-inset-top,0px\)/g,o.safeTop+'px')):null;
  browser=browser||await chromium.launch();
  const ctx=o.ctx||await browser.newContext({viewport:{width:o.width||390,height:o.height||844},timezoneId:'America/Boise',deviceScaleFactor:o.dsf||1,colorScheme:o.dark?'dark':'light',isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const log={blocked:[],gets:0,errors:[],ntfy:[]};
  page.on('pageerror',e=>log.errors.push(String(e.message))); page.on('console',m=>{ if(m.type()==='error'&&!/Failed to load resource|ERR_/.test(m.text())) log.errors.push(m.text()); });
  await page.route('**/*',async route=>{ const rq=route.request(), u=rq.url(), me=rq.method();
    if(u.startsWith('http://localhost:8765')) return route.continue();
    if(me!=='GET'){ log.blocked.push(me+' '+u.replace(/\?.*/,'')); if(/functions\/v1\/mt-push/.test(u)){ try{ const j=JSON.parse(rq.postData()); log.ntfy.push({title:j.action,body:j.body}); }catch(e){} } return route.abort(); }
    if(/supabase\.co/.test(u)){ log.gets++; if(o.offline) return route.abort(); if(o.delayMs) await new Promise(r=>setTimeout(r,o.delayMs));
      if(o.mode==='live'){ try{ const r=curl(u); return route.fulfill({status:200,contentType:'application/json',body:r.body}); }catch(e){ return route.abort(); } }
      const q=new URL(u).searchParams; const c=q.get('coll'), p=q.get('path'); let rows;
      if(c) rows=replayRows(c.replace(/^eq\./,''),o); else { const pp=p.replace(/^eq\./,''); const i=pp.lastIndexOf('/'); rows=replayRows(pp.slice(0,i),o).filter(r=>r.id===pp.slice(i+1)); }
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)}); }
    if(/flowrestling/.test(u)) return route.abort();
    if(/fonts\.(googleapis|gstatic)\.com/.test(u)){ try{ const r=curl(u); return route.fulfill({status:200,contentType:r.ct,body:r.body}); }catch(e){ return route.abort(); } }
    return route.abort(); });
  if(o.T) await page.clock.install({time:new Date(o.T)});
  if(o.init) await page.addInitScript(o.init);
  await page.goto('http://localhost:8765/MatTime/',{waitUntil:'load'}); await page.waitForTimeout(o.wait||1500);
  return {page,ctx,log};
}
const snap=page=>page.evaluate(()=>{ const t=id=>(document.getElementById(id)||{}).textContent||''; const st=document.getElementById('status'); const gb=document.getElementById('goBanner');
  return {up:t('upText'),sub:t('upSub'),win:t('winText'),eta:t('etaText'),note:t('noteText'),score:t('scoreText'),lbl:t('boardLbl'),status:st.textContent+(st.dataset.flo?' · '+st.dataset.flo:''),go:!!(gb&&gb.style.display!=='none'&&gb.offsetParent!==null||gb&&gb.style.display==='block'),title:document.title,
    rows:[...document.querySelectorAll('#sheet .r')].map(r=>({k:r.dataset.k,cls:r.className,chip:r.querySelector('.chip').textContent})),cards:[...document.querySelectorAll('.card')].map(c=>c.innerText.replace(/\n+/g,' | ').slice(0,160)),all:document.querySelector('main').innerText}; });
const ms=s=>new Date(s).getTime();
async function close(){ if(browser) await browser.close(); browser=null; if(server) server.close(); server=null; }
module.exports={open,snap,ms,close,fx,minOf};

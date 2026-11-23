// Replay check: recorded meets from the store, stepped through the evening. Exits non-zero on any failed assertion.
const {open,snap,ms,close,fx,minOf}=require('./h.js');
const toMin=s=>{ const m=/(\d{1,2}):(\d{2})\s*(AM|PM)/.exec(s); if(!m) return null; let h=+m[1]%12; if(m[3]==='PM') h+=12; return h*60+ +m[2]; };
const times=s=>{ const ap=(s.match(/(AM|PM)/g)||[]).pop(); return (s.match(/\d{1,2}:\d{2}(\s*(AM|PM))?/g)||[]).map(x=>toMin(/M$/.test(x)?x:x+' '+ap)); };
const fmt=m=>{ m=Math.round(m); let h=Math.floor(m/60)%24, mm=m%60; const ap=h>=12?'PM':'AM'; h=h%12||12; return h+':'+String(mm).padStart(2,'0')+' '+ap; };
const mss=m=>{ const t=Math.max(0,Math.round(m*60)); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); };
let fails=0, checks=0; const fail=(w,m)=>{ fails++; console.log('FAIL',w,m); }; const ok=(c,w,m)=>{ checks++; if(!c) fail(w,m); };
async function allRows(page){ const out={}; const tabs=await page.$$eval('#tabs button',bs=>bs.map(b=>b.dataset.tab)); for(const t of tabs){ if(t==='log') continue; await page.click('#tabs button[data-tab="'+t+'"]'); const rows=await page.$$eval('#sheet .r',rs=>rs.map(r=>({k:r.dataset.k,cls:r.className,chip:r.querySelector('.chip').textContent,names:[...r.querySelectorAll('.nm')].map(n=>n.textContent)}))); out[t]=rows; } return out; }
const MEETS=[{id:'2026-11-12',from:'16:00',to:'19:30'},{id:'2026-11-18',from:'16:00',to:'18:50'}];
(async()=>{
  const only=process.argv[2];
  for(const M of MEETS){ if(only&&only!==M.id) continue;
    const meet=fx('meets').find(r=>r.id===M.id).data; const bouts=fx('meets_'+M.id+'_bouts'); let firstGo=null, line=[];
    const t0=ms(M.id+'T'+M.from+':00-07:00'), t1=ms(M.id+'T'+M.to+':00-07:00');
    for(let T=t0;T<=t1;T+=5*60000){ const nm=minOf(T), tag=M.id+' '+fmt(nm);
      const a=await open({mode:'replay',meet:M.id,T,wait:1200}); const s=await snap(a.page);
      ok(a.log.errors.length===0,tag,'page errors '+a.log.errors.join(' | ')); ok(!a.log.blocked.some(b=>/rest\/v1/.test(b)),tag,'store write attempted: '+a.log.blocked.join(','));
      ok(/Up to date/.test(s.status),tag,'status: '+s.status);
      const projecting=!/^(DONE|LIVE|FF|—)$/.test(s.up);
      if(projecting){ for(const t of times(s.win).concat(times(s.eta))) ok(t>=Math.floor(nm),tag,'guess in the past: '+s.win+' / '+s.eta);
        const nA=/(\d+) bouts? still ahead/.exec(s.note); if(nA) ok(+nA[1]===(s.up==='NEXT'?0:+s.up),tag,'Up in "'+s.up+'" vs note "'+nA[0]+'"'); else ok(/Set as next|estimate|Leave by|GO NOW/.test(s.note+s.lbl),tag,'note has no count: '+s.note); }
      const rows=await allRows(a.page); let ours=null, oursTab=null;
      for(const t in rows){ const flat=meet.mats[t].sections.flatMap(x=>x.bouts);
        rows[t].forEach(r=>{ const i=+r.k.slice(3)-1, b=flat[i]; const blank=!b[1]||!b[2];
          if(blank) ok(/\bff\b/.test(r.cls)&&!/\b(next|live)\b/.test(r.cls)&&/^(FF|FLO )/.test(r.chip),tag,'forfeit row not excluded: '+r.k+' '+r.cls+' '+r.chip);
          if(/\bours\b/.test(r.cls)){ ours=r; oursTab=t; } });
        // hand-entered times are shown exactly as stored, whatever Flo says
        bouts.forEach(d=>{ const x=d.data; if(!d.id.startsWith(t)||x.start==null||x.start>nm) return; const r=rows[t].find(q=>q.k===d.id); if(!r){ fail(tag,'hand row missing '+d.id); return; } const want=(x.end!=null&&x.end<=nm)?(mss(x.end-x.start)+' long · began '+fmt(x.start)):('LIVE '+fmt(x.start)); const b=flat[+d.id.slice(3)-1]; if(x.forfeit===true||!b[1]||!b[2]) return; ok(r.chip===want,tag,'hand time changed '+d.id+': "'+r.chip+'" want "'+want+'"'); }); }
      if(projecting&&ours&&/^\d+$|^NEXT$/.test(s.up)){ const before=rows[oursTab].slice(0,rows[oursTab].indexOf(ours)); const open_=before.filter(r=>!/\bff\b/.test(r.cls)&&!/\bdone\b/.test(r.cls)).length; ok((s.up==='NEXT'?0:+s.up)<=open_+1,tag,'Up in '+s.up+' exceeds contested rows before him ('+open_+')'); }
      if(s.go&&firstGo==null) firstGo=nm; ok(!s.go||/GO NOW/.test(s.note),tag,'banner without GO NOW note');
      // reload: same board, nothing lost
      await a.page.reload({waitUntil:'load'}); await a.page.waitForTimeout(1200); const s2=await snap(a.page); const rows2=await allRows(a.page);
      ok(s2.up===s.up&&s2.eta===s.eta&&s2.win===s.win&&s2.lbl===s.lbl,tag,'board changed on reload: '+JSON.stringify([s.up,s.eta,s.win])+' -> '+JSON.stringify([s2.up,s2.eta,s2.win]));
      ok(JSON.stringify(rows2)===JSON.stringify(rows),tag,'sheet rows changed on reload');
      line.push(fmt(nm).replace(' PM','')+' up '+s.up+' eta '+s.eta.replace(' PM','')+(s.go?' GO':''));
      await a.ctx.close(); }
    // offline reload mid-meet: board still shows the saved picture
    { const T=ms(M.id+'T17:20:00-07:00'); const a=await open({mode:'replay',meet:M.id,T}); const s=await snap(a.page); const b=await open({mode:'replay',meet:M.id,T,offline:true,ctx:a.ctx,wait:7500}); const s2=await snap(b.page);
      ok(s2.up===s.up&&s2.eta===s.eta&&s2.lbl===s.lbl,M.id+' offline','board lost offline: '+JSON.stringify([s.up,s.eta])+' -> '+JSON.stringify([s2.up,s2.eta])); ok(/Still connecting|No connection/.test(s2.status),M.id+' offline','offline status: '+s2.status); console.log('  offline status:',s2.status); await a.ctx.close(); }
    const tk=meet.track.split('|'); const own=bouts.find(d=>d.id===tk[0]+'-'+String(+tk[1]+1).padStart(2,'0'));
    console.log(M.id,'tracked',meet.track,'actual start',own&&own.data.start!=null?fmt(own.data.start):'not hand-timed','first GO NOW',firstGo!=null?fmt(firstGo):'never'); console.log('  '+line.join(' | '));
  }
  console.log(fails?('FAILED '+fails+' of '+checks):('PASS '+checks+' checks')); await close(); process.exit(fails?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });

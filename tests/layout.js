const {open,snap,ms,close}=require('./h.js'); const out=process.argv[2]||'a';
const audit=(page,w)=>page.evaluate(WANT=>{ const vw=window.innerWidth, r=[]; if(vw!==WANT) r.push('layout widened to '+vw+' (asked '+WANT+')'); const se=document.scrollingElement; if(se.scrollWidth>vw) r.push('page scrolls sideways: '+se.scrollWidth+'>'+vw);
  document.querySelectorAll('main *').forEach(e=>{ const b=e.getBoundingClientRect(); if(!b.width||e.closest('[hidden]')) return; if(b.right>vw+0.5||b.left<-0.5) r.push('outside viewport: '+e.tagName+'.'+e.className+' '+Math.round(b.left)+'..'+Math.round(b.right)); });
  const small=[...document.querySelectorAll('main button, main .r, main summary, main input, main select')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<36).map(e=>(e.id||e.className||e.textContent.slice(0,14))+':'+Math.round(e.getBoundingClientRect().height));
  const clip=[...document.querySelectorAll('.hdr *, .alerts *, .card h2, .card .state')].filter(e=>e.children.length===0&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible').map(e=>(e.id||e.className)+' "'+e.textContent.slice(0,30)+'"');
  const h=document.getElementById('hdr').getBoundingClientRect(); const bd=document.getElementById('board').getBoundingClientRect(); return {issues:r.slice(0,8),small:[...new Set(small)],clip,pinned:Math.round(bd.height),vh:innerHeight}; },w);
(async()=>{ const W=[320,375,390,430]; const T=ms('2026-11-12T17:45:30-07:00');
  for(const w of W){
    const a=await open({mode:'replay',meet:'2026-11-12',T,width:w,height:844,safeTop:47}); const st=await a.page.evaluate(()=>[...new Set([...document.querySelectorAll('#sheet .r')].flatMap(r=>r.className.split(' ')))].join(' '));
    await a.page.click('#tabs button[data-tab="m1"]'); const au=await audit(a.page,w); console.log(w,'loaded',JSON.stringify(au),'| row states on Mat 1 tab:',st, a.log.errors);
    await a.page.screenshot({path:`${__dirname}/shots/${out}-${w}-top.png`});
    await a.page.evaluate(()=>{ const r=document.querySelector('#sheet .r.ours')||document.querySelector('#sheet .r.live'); window.scrollTo(0,r.getBoundingClientRect().top+scrollY-420); }); await a.page.waitForTimeout(200);
    // anything from the scrolled content visible above or beside the sticky header's top edge?
    const peek=await a.page.evaluate(()=>{ const h=document.getElementById('board').getBoundingClientRect(); const bad=[]; document.querySelectorAll('.card,.r,.tabs button,.alerts,.sec').forEach(e=>{ const b=e.getBoundingClientRect(); if(b.bottom>2&&b.top<h.top) bad.push(e.className+'@'+Math.round(b.top)+'..'+Math.round(b.bottom)); }); return {hdrTop:Math.round(h.top),under:bad.length}; });
    console.log(w,'scrolled',JSON.stringify(peek)); await a.page.screenshot({path:`${__dirname}/shots/${out}-${w}-scroll.png`}); await a.ctx.close();
    const e=await open({mode:'replay',meet:'2026-12-02',T:ms('2026-12-02T15:00:00-07:00'),width:w,height:844}); console.log(w,'empty',JSON.stringify(await audit(e.page,w))); await e.page.screenshot({path:`${__dirname}/shots/${out}-${w}-empty.png`}); await e.ctx.close();
  }
  const g=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T17:42:00-07:00'),width:390,height:844,safeTop:47,dark:true}); await g.page.screenshot({path:`${__dirname}/shots/${out}-390-go-dark.png`}); console.log('go',JSON.stringify(g.log.ntfy)); await g.ctx.close();
  await close(); })();

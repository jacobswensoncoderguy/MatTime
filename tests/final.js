const {open,snap,ms,close,fx}=require('./h.js'); let fails=0; const ok=(c,m)=>{ console.log((c?'ok   ':'FAIL ')+m); if(!c) fails++; };
const alerts=p=>p.evaluate(()=>document.getElementById('alertState').textContent+' | '+document.getElementById('alertSub').textContent+' | '+document.getElementById('alerts').className);
(async()=>{
  // 1. live store, GET only
  let a=await open({mode:'live',wait:5000}); let s=await snap(a.page);
  ok(a.log.errors.length===0&&a.log.blocked.length===0&&a.log.gets>5,'live store: no page errors, no write attempted, '+a.log.gets+' reads'); ok(/Up to date/.test(s.status),'live store status: '+s.status);
  ok(s.score===''&&/Waiting for the bout sheet/.test(s.lbl),'live store, next meet (no sheet): board "'+s.lbl+'", score line empty'); console.log('     alerts:',await alerts(a.page)); console.log('     header:',await a.page.evaluate(()=>document.getElementById('meetTitle').textContent));
  await a.ctx.close();
  // 2. score leak: phone that last viewed Nov 18 opens to the Dec 2 meet
  a=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T19:30:00-07:00'),onlyUpTo:'2026-11-18',noMask:true,keepSummary:true}); s=await snap(a.page); const sc18=s.score;
  let b=await open({mode:'replay',meet:'2026-12-02',current:'2026-11-18',T:ms('2026-11-23T10:30:00-07:00'),ctx:a.ctx,noMask:true,keepSummary:true}); s=await snap(b.page);
  ok(/THIS BOUT \d+\/100 · 60 guesses/.test(sc18),'Nov 18 score from the 60 stored guesses: '+sc18); ok(s.score==='','no score carried onto Dec 2: "'+s.score+'"'); await a.ctx.close();
  // 3. server already sent GO NOW: phone does not send a second one, panel says sent
  a=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T17:42:00-07:00'),push:{'2026-11-18|go':{ms:ms('2026-11-18T17:17:00-07:00'),ahead:8,by:'server'}},hb:{v:3}}); s=await snap(a.page);
  ok(s.go&&a.log.ntfy.length===0,'GO NOW showing, no duplicate phone push when the server sent one (ntfy posts: '+a.log.ntfy.length+')'); ok(/Alerts are off on this phone/.test(await alerts(a.page)),'panel on a phone that has not turned alerts on: '+await alerts(a.page));
  await a.page.click('#goBanner'); await a.page.waitForTimeout(1500); ok(!(await snap(a.page)).go,'GO banner hides on tap and stays hidden'); await a.ctx.close();
  // 4. no server push yet: phone sends exactly one, even across a reload
  a=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T17:42:00-07:00')}); b=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T17:43:00-07:00'),ctx:a.ctx});
  ok(a.log.ntfy.length===1&&a.log.ntfy[0].title==='go'&&b.log.ntfy.length===0,'phone asks the server to send GO NOW once: '+JSON.stringify(a.log.ntfy[0])); 
  // 5. test alert button
  await b.page.click('#alertTest'); await b.page.waitForTimeout(1500); ok(b.log.errors.length===0,'turn-on button without permission: '+await alerts(b.page)); await a.ctx.close();
  // 6. armed wording with and without the server job v3
  a=await open({mode:'replay',meet:'2026-12-02',T:ms('2026-12-02T15:00:00-07:00'),hb:{v:3}}); ok(/Alerts are off on this phone \| Turn them on once/.test(await alerts(a.page))&&await a.page.evaluate(()=>document.getElementById('alertTest').textContent)==='Turn on alerts','button reads Turn on alerts'); await a.ctx.close();
  a=await open({mode:'replay',meet:'2026-12-02',T:ms('2026-12-02T15:00:00-07:00')}); ok(a.log.errors.length===0,'no page errors'); await a.ctx.close();
  // 7. Flo heartbeat stale during the meet
  a=await open({mode:'replay',meet:'2026-11-18',T:ms('2026-11-18T17:30:00-07:00'),hb:{ms:ms('2026-11-18T17:20:00-07:00')}}); s=await snap(a.page); ok(/Flo check stalled since 5:20:00 PM/.test(s.status),'stale Flo job is called out: '+s.status.slice(-60)); await a.ctx.close();
  // 8. future meet with a sheet and the wrestler 3rd in line: no GO NOW days before, none hours before, GO NOW by 20 min before the earliest time
  const mats={m1:{name:'Mat 1',sections:[{label:'JV',bouts:[[85,'A One','B One'],[90,'A Two','B Two'],[110,'Oliver Swenson','B Three'],[115,'A Four','B Four']]}]},m2:{name:'Mat 2',sections:[]}};
  for(const [t,want] of [['2026-11-23T17:00:00-07:00',false],['2026-12-02T14:00:00-07:00',false],['2026-12-02T16:35:00-07:00',true]]){ a=await open({mode:'replay',meet:'2026-12-02',T:ms(t),meetPatch:{mats,flo:[]}}); s=await snap(a.page);
    ok(s.go===want&&(a.log.ntfy.length>0)===want,t.slice(5,16)+' GO NOW '+(s.go?'on':'off')+' · '+s.up+' · '+s.win+' · '+s.note.slice(0,110)); await a.ctx.close(); }
  // 9. history numbers on the Dec 2 meet: stored copy said first whistle -15 min at 5.7 min/bout
  a=await open({mode:'replay',meet:'2026-12-02',T:ms('2026-12-02T14:00:00-07:00'),meetPatch:{mats,flo:[]}}); s=await snap(a.page); ok(/first whistle 4:4\d PM at 4\.\d min\/bout/.test(s.note),'Dec 2 uses history from Nov 12 + Nov 18: '+s.note.slice(0,90)); await a.ctx.close();
  console.log(fails?'FAILED '+fails:'ALL OK'); await close(); process.exit(fails?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });

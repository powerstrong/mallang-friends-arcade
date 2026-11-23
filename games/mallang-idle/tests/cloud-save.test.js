'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Cloud=require('../cloud-save.js'),Save=require('../engine/save.js'),Combat=require('../engine/combat.js');
const randomBytes=n=>new Uint8Array(n).fill(42);
function fixture(fetch,storage){let p=Save.serialize(Combat.createState(),1000),time=1000,owner=true;const messages=[],backups=[];storage=storage||new Map();const io={storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch,base:'',now:()=>time,randomBytes,snapshot:()=>p,apply:v=>{p=v;},owner:()=>owner,status:s=>messages.push(s),backup:p=>backups.push(p),settle:Save.settleOffline};return {io,cloud:Cloud.create(io),storage,messages,backups,payload:()=>p,time:v=>{time=v;},owner:v=>{owner=v;}};}
const response=(payload,revision=1,status=200)=>new Response(JSON.stringify({payload,revision,serverNow:1000}),{status});
test('cloud restore keeps pet day, daily limit and hint in the same snapshot as hearts',async()=>{
 const s=Combat.createState(),Pet=require('../engine/pet.js'),now=Date.parse('2026-11-22T03:00:00Z');
 const pet=Pet.create();for(let i=0;i<5;i++)pet.tap(s,'rabbit',now+i*2000);
 s.tutorialSeen.push('petHint');const source=Save.serialize(s,now);
 const f=fixture(async(url,opts)=>response(opts.method==='GET'?source:JSON.parse(opts.body).payload,2));
 f.time(now);await f.cloud.restore(Cloud.generate(randomBytes));
 assert.deepEqual(f.payload().pet,source.pet);assert.equal(f.payload().friends.hearts,5);
 assert.ok(f.payload().tutorialSeen.includes('petHint'));
 assert.equal(Pet.create().tap(Save.deserialize(f.payload()),'rabbit',now+20000).reward,0);
});
test('128-bit code roundtrip and checksum typo',()=>{const c=Cloud.generate(randomBytes);assert.equal(c.length,28);assert.equal(Cloud.normalize(Cloud.display(c)),c);assert.equal(Cloud.normalize(c.slice(0,27)+'A'),null);});
test('registration, single in-flight request, lost response retries same id, owner guard',async()=>{
 let calls=[],fail=false;
 const f=fixture(async(url,opts)=>{calls.push(JSON.parse(opts.body));if(fail)throw Error('offline');return response(JSON.parse(opts.body).payload,calls.length);});
 await f.cloud.tick();assert.ok(f.cloud.ready());assert.ok(f.cloud.code());
 f.time(40000);f.cloud.changed(true);fail=true;await f.cloud.flush();const id=calls.at(-1).requestId;
 f.time(50000);fail=false;await f.cloud.tick();assert.equal(calls.at(-1).requestId,id);
 f.owner(false);f.cloud.changed(true);await f.cloud.flush();assert.equal(calls.length,3);
});
test('restore fetch must finish before uploads; settlement CAS then full snapshot apply',async()=>{
 const source=Save.serialize(Combat.createState(),1000);source.stage=80;source.safeStage=79;source.progress.maxClearedStage=79;source.gold=999;source.shards=10;
 let posts=0;const f=fixture(async(url,opts)=>{if(opts.method==='GET')return response(source,3);posts++;assert.equal(JSON.parse(opts.body).baseRevision,3);return response(JSON.parse(opts.body).payload,4);});
 await f.cloud.restore(Cloud.generate(randomBytes));assert.equal(f.payload().stage,80);assert.equal(f.payload().gold,999);assert.equal(posts,1);assert.equal(f.backups.length,1);
 const b=fixture(async()=>response(source));assert.equal(b.cloud.ready(),false);await b.cloud.restore(Cloud.generate(randomBytes));assert.equal(b.payload().stage,80);
});
test('404, quota, future versions and DEV never overwrite local progress',async()=>{
 const f=fixture(async()=>new Response('{}',{status:404}));await assert.rejects(f.cloud.restore(Cloud.generate(randomBytes)));assert.equal(f.payload().stage,1);assert.equal(f.cloud.ready(),false);
 const future=fixture(async()=>response({...f.payload(),version:999}));await assert.rejects(future.cloud.restore(Cloud.generate(randomBytes)));assert.equal(future.payload().stage,1);
 const quota=fixture(async()=>{throw Error('must not request');});quota.io.storage.setItem=()=>{throw Error('quota');};const c=Cloud.create(quota.io);await c.tick();assert.equal(c.ready(),false);
 const dev=Cloud.create({...f.io,disabled:true});await dev.tick();await assert.rejects(dev.restore(Cloud.generate(randomBytes)));
});
test('offline cursor prevents duplicate gold after immediate save/reload and clock rollback',()=>{
 const s=Combat.createState();s.safeStage=5;const p=Save.serialize(s,1000),a=Save.settleOffline(p,3601000),b=Save.settleOffline(a.payload,3601000);assert.ok(a.reward.gold>0);assert.equal(b.reward.gold,0);assert.equal(b.payload.gold,a.payload.gold);assert.equal(Save.settleOffline(b.payload,1000).payload.offlineThroughAt,3601000);
});
test('slow existing-code lookup keeps uploads off; conflicts keep the original branch revision',async()=>{
 const source=Save.serialize(Combat.createState(),1000),code=Cloud.generate(randomBytes),storage=new Map([[Cloud.KEY,JSON.stringify({code,baseRevision:1})]]);
 let release;const slow=new Promise(r=>{release=r;});let calls=[];
 const f=fixture(async(url,opts)=>{calls.push(opts);if(opts.method==='GET'){await slow;return response(source,2);}return response(JSON.parse(opts.body).payload,3);},storage);
 const boot=f.cloud.tick();await f.cloud.flush();assert.equal(calls.length,1);assert.equal(f.cloud.ready(),false);release();await boot;assert.ok(f.cloud.ready());
 let revisions=[];const g=fixture(async(url,opts)=>{if(url.endsWith('/saves'))return response(source,1);revisions.push(JSON.parse(opts.body).baseRevision);return response(source,99,409);});
 await g.cloud.tick();g.payload().stats.kills=10;g.cloud.changed(true);await g.cloud.flush();await g.cloud.flush();assert.deepEqual(revisions,[1,1]);
});
test('pending snapshots remain immutable when live daily claims change during a failed upload',async()=>{
 let fail=false,requests=[];const f=fixture(async(url,opts)=>{const body=JSON.parse(opts.body);requests.push(body);if(fail)throw Error('lost');return response(body.payload,1);});await f.cloud.tick();
 f.payload().daily={date:'2026-11-22',dayKey:'2026-11-22',targets:{kills:100,upgrades:10,bossTries:5},base:{kills:0,upgrades:0,bossTries:0},claimed:{}};
 fail=true;await f.cloud.flush();const request=JSON.stringify(requests.at(-1));f.payload().daily.claimed.kills=true;await f.cloud.flush();assert.equal(JSON.stringify(requests.at(-1)),request);
});
test('restore intent survives a quota failure between connection metadata and game snapshot writes',async()=>{
 const p=Save.serialize(Combat.createState(),1000);p.stage=40;p.safeStage=39;p.progress.maxClearedStage=39;
 const f=fixture(async(url,opts)=>response(opts.method==='GET'?p:JSON.parse(opts.body).payload,3));
 f.io.apply=()=>{throw Error('quota');};const interrupted=Cloud.create(f.io);
 await assert.rejects(interrupted.restore(Cloud.generate(randomBytes)),/quota/);
 assert.equal(f.payload().stage,1);assert.equal(JSON.parse(f.storage.get(Cloud.KEY)).restorePending,true);
 const reboot=Cloud.create({...f.io,apply:q=>{p.stage=q.stage;}});await reboot.tick();assert.ok(reboot.ready());assert.equal(JSON.parse(f.storage.get(Cloud.KEY)).restorePending,false);
});
for(const waitAt of ['lookup','settlement'])for(const notify of [true,false])test('pending restore discards old-device frames during '+waitAt+' (changed notified: '+notify+')',async()=>{
 const source=Save.serialize(Combat.createState(),1000);source.stage=21;source.safeStage=20;source.progress.maxClearedStage=20;
 const storage=new Map([[Cloud.KEY,JSON.stringify({code:Cloud.generate(randomBytes),baseRevision:1,restorePending:true})]]);
 let server=source,revision=1,release,started,applied=0;const posts=[];
 const pending=new Promise(r=>{release=r;}),waiting=new Promise(r=>{started=r;});
 const f=fixture(async(url,opts)=>{
  if(opts.method==='GET'){
   if(waitAt==='lookup'){started();await pending;}
   return response(server,revision);
  }
  const body=JSON.parse(opts.body);posts.push(body);
  if(body.settlement && waitAt==='settlement'){started();await pending;}
  assert.equal(body.baseRevision,revision);server=body.payload;return response(server,++revision);
 },storage);
 f.payload().stage=81;f.payload().safeStage=80;f.payload().progress.maxClearedStage=80;
 storage.set(Save.STORAGE_KEY,JSON.stringify(f.payload()));
 const apply=f.io.apply;f.io.apply=p=>{
  assert.equal(JSON.parse(storage.get(Cloud.KEY)).restorePending,true);
  storage.set(Save.STORAGE_KEY,JSON.stringify(p));apply(p);applied++;
 };
 const store=f.io.storage.setItem;f.io.storage.setItem=(k,v)=>{
  if(k===Cloud.KEY && JSON.parse(v).restorePending===false){
   assert.equal(applied,1);assert.equal(JSON.parse(storage.get(Save.STORAGE_KEY)).stage,21);
  }
  store(k,v);
 };
 const boot=f.cloud.tick();await waiting;
 f.payload().playtime+=0.016;if(notify)f.cloud.changed(true);
 await f.cloud.flush();assert.equal(f.cloud.ready(),false);assert.equal(JSON.parse(storage.get(Cloud.KEY)).restorePending,true);
 release();await boot;
 assert.equal(applied,1,'the restore target must be applied despite old-device gameplay');
 assert.equal(f.payload().stage,21);assert.equal(f.payload().playtime,source.playtime);
 assert.equal(f.cloud.ready(),true);assert.equal(JSON.parse(storage.get(Cloud.KEY)).restorePending,false);
 await f.cloud.flush();
 assert.equal(server.stage,21);assert.equal(server.playtime,source.playtime);
 assert.ok(posts.every(b=>b.payload.stage===21),'old-device progress must never be uploaded');
 assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,revision);
});
test('resumed restore keeps its intent and uploads blocked until the target is saved locally',async()=>{
 const source=Save.serialize(Combat.createState(),1000);source.stage=21;source.safeStage=20;source.progress.maxClearedStage=20;
 const storage=new Map([[Cloud.KEY,JSON.stringify({code:Cloud.generate(randomBytes),baseRevision:1,restorePending:true})]]);
 let revision=1;const posts=[];
 const f=fixture(async(url,opts)=>{
  if(opts.method==='GET')return response(source,revision);
  const body=JSON.parse(opts.body);posts.push(body);return response(body.payload,++revision);
 },storage);
 f.payload().stage=81;f.payload().safeStage=80;f.payload().progress.maxClearedStage=80;
 storage.set(Save.STORAGE_KEY,JSON.stringify(f.payload()));
 const apply=f.io.apply;f.io.apply=()=>{throw Error('quota');};await f.cloud.tick();
 assert.equal(f.cloud.ready(),false);assert.equal(JSON.parse(storage.get(Cloud.KEY)).restorePending,true);
 assert.equal(JSON.parse(storage.get(Save.STORAGE_KEY)).stage,81);
 f.payload().playtime+=0.016;f.cloud.changed(true);await f.cloud.flush();assert.equal(posts.length,1);
 f.io.apply=p=>{storage.set(Save.STORAGE_KEY,JSON.stringify(p));apply(p);};
 const reboot=Cloud.create(f.io);await reboot.tick();
 assert.equal(reboot.ready(),true);assert.equal(JSON.parse(storage.get(Cloud.KEY)).restorePending,false);
 assert.equal(JSON.parse(storage.get(Save.STORAGE_KEY)).stage,21);
 assert.ok(posts.every(b=>b.settlement && b.payload.stage===21));
 await reboot.flush();assert.equal(posts.at(-1).payload.stage,21);
});
for(const notify of [true,false])test('boot settlement rechecks pending upgrades and keeps branch revision (changed notified: '+notify+')',async()=>{
 const source=Save.serialize(Combat.createState(),1000),code=Cloud.generate(randomBytes);
 const storage=new Map([[Cloud.KEY,JSON.stringify({code,baseRevision:1})]]);
 let release,started;const pending=new Promise(r=>{release=r;}),posted=new Promise(r=>{started=r;});let sent=[];
 const f=fixture(async(url,opts)=>{
  if(opts.method==='GET')return response(source,2);
  const body=JSON.parse(opts.body);sent.push(body);
  if(body.settlement){started();await pending;return response(body.payload,3);}
  return response(source,3,409);
 },storage);
 const boot=f.cloud.tick();await posted;
 f.payload().up.atk=2;f.payload().stats.upgrades=1;if(notify)f.cloud.changed(true);
 release();await boot;
 assert.equal(f.payload().up.atk,2);assert.equal(f.payload().stats.upgrades,1);
 assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,1);
 await f.cloud.flush();await f.cloud.flush();
 assert.deepEqual(sent.filter(b=>!b.settlement).map(b=>b.baseRevision),[1,1]);
});
test('boot lookup also preserves the local branch when progress changes before GET returns',async()=>{
 const source=Save.serialize(Combat.createState(),1000),code=Cloud.generate(randomBytes);
 const storage=new Map([[Cloud.KEY,JSON.stringify({code,baseRevision:7})]]);
 let release;const pending=new Promise(r=>{release=r;});let posts=[];
 const f=fixture(async(url,opts)=>{if(opts.method==='GET'){await pending;return response(source,9);}posts.push(JSON.parse(opts.body));return response(source,9,409);},storage);
 const boot=f.cloud.tick();f.payload().stats.upgrades++;f.payload().up.atk++;f.cloud.changed(true);release();await boot;
 assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,7);
 await f.cloud.flush();assert.equal(posts[0].baseRevision,7);
});
test('boot settlement still accepts a server winner after concurrent local changes',async()=>{
 const source=Save.serialize(Combat.createState(),1000);source.stage=20;source.safeStage=19;source.progress.maxClearedStage=19;
 const storage=new Map([[Cloud.KEY,JSON.stringify({code:Cloud.generate(randomBytes),baseRevision:1})]]);
 let release,started;const pending=new Promise(r=>{release=r;}),posted=new Promise(r=>{started=r;});
 const f=fixture(async(url,opts)=>{if(opts.method==='GET')return response(source,2);started();await pending;return response(JSON.parse(opts.body).payload,3);},storage);
 const boot=f.cloud.tick();await posted;f.payload().stats.upgrades++;f.cloud.changed(true);release();await boot;
 assert.equal(f.payload().stage,20);assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,3);
});

for(const waitAt of ['lookup','settlement'])for(const reward of ['pet','attendance','quest','achievement'])test('delayed boot '+waitAt+' preserves '+reward+' ledger and balance through the next CAS upload',async()=>{
 const Calendar=require('../engine/calendar.js'),Pet=require('../engine/pet.js');
 const Quests=require('../data/quests.js'),Achievements=require('../data/achievements.js');
 const Contract=require('../engine/save-contract.js'),now=Date.parse('2026-11-22T03:00:00Z');
 const s=Combat.createState();s.stage=31;s.safeStage=30;s.progress.maxClearedStage=30;
 Calendar.sync(s,now);s.friends.hearts=0;
 s.stats.kills=s.daily.targets.kills;
 if(reward==='attendance')s.attendance={count:0,lastDayKey:''};
 let server=Save.serialize(s,now),revision=2,release,started;
 const pending=new Promise(r=>{release=r;}),waiting=new Promise(r=>{started=r;});
 const storage=new Map([[Cloud.KEY,JSON.stringify({code:Cloud.generate(randomBytes),baseRevision:1})]]);
 const f=fixture(async(url,opts)=>{
  if(opts.method==='GET'){
   if(waitAt==='lookup'){started();await pending;}
   return response(server,revision);
  }
  const body=JSON.parse(opts.body);
  if(body.settlement && waitAt==='settlement'){started();await pending;}
  if(body.baseRevision!==revision && Contract.compare(body.payload,server).order<=0)return response(server,revision,409);
  server=body.payload;return response(server,++revision);
 },storage);
 Object.assign(f.payload(),structuredClone(server));f.time(now);
 const apply=f.io.apply;f.io.apply=p=>{storage.set(Save.STORAGE_KEY,JSON.stringify(p));apply(p);};
 const boot=f.cloud.tick();await waiting;
 const live=Save.deserialize(f.payload());
 if(reward==='pet')assert.equal(Pet.create().tap(live,'rabbit',now).reward,1);
 if(reward==='attendance')assert.equal(Calendar.sync(live,now),true);
 if(reward==='quest')assert.ok(Quests.claim(Quests.QUESTS[0],live,live.daily)>0);
 if(reward==='achievement')assert.equal(Achievements.claim(live,'thirty'),true);
 Object.assign(f.payload(),Save.serialize(live,now));f.cloud.changed(true);
 const earned=structuredClone(f.payload());storage.set(Save.STORAGE_KEY,JSON.stringify(earned));
 release();await boot;
 function check(p){
  for(const key of ['pet','attendance','daily','achievementClaimed','friends','shards'])assert.deepEqual(p[key],earned[key],key);
 }
 assert.equal(f.cloud.ready(),true);check(f.payload());check(JSON.parse(storage.get(Save.STORAGE_KEY)));
 assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,1,'retain local ancestry until CAS accepts it');
 await f.cloud.flush();check(server);check(f.payload());
 assert.equal(JSON.parse(storage.get(Cloud.KEY)).baseRevision,revision);
});

/* DOM wiring smoke, deliberately separate from real Chrome layout/recovery checks. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function boot(raw,options={}){
 const ids={};let cloudOptions;let saved=new Map(raw?[['mallang-idle-save',raw]]:[]),events={};
 for(const [k,v] of options.entries||[])saved.set(k,v);
 function element(){const classes=new Set();return {hidden:false,children:[],set textContent(v){this._text=v;this.children=[];},get textContent(){return this._text||'';},set innerHTML(v){this._html=v;this.children=[];},get innerHTML(){return this._html||'';},dataset:{},style:{setProperty(){}},classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},toggle(x,b){if(b===undefined)b=!classes.has(x);if(b)classes.add(x);else classes.delete(x);},contains:x=>classes.has(x)},setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k]||null;},appendChild(e){this.children.push(e);e.parentElement=this;return e;},querySelector(){return element();},querySelectorAll(){return [];},addEventListener(k,f){this['on'+k]=f;},remove(){},focus(){},click(){if(this.onclick)return this.onclick({target:this,stopPropagation(){}});},closest(){return element();},getBoundingClientRect(){return {left:0,top:0,width:390,height:300};}};}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){ids[match[1]]=element();ids[match[1]].hidden=/\bhidden\b/.test(match[0]);ids[match[1]].parentElement=element();}
 for(const match of html.matchAll(/<button data-tab="([^"]+)"([^>]*)>/g)){const b=element();b['data-tab']=match[1];if(/class="on"/.test(match[2]))b.classList.add('on');ids.tabs.children.push(b);}
 const doc={getElementById:id=>ids[id]||null,createElement:element,documentElement:element(),querySelector:()=>element(),addEventListener(){},removeEventListener(){},hidden:false};
 const storage=new Proxy({getItem:k=>saved.get(k)||null,setItem:(k,v)=>{saved.set(k,v);},removeItem:k=>saved.delete(k),clear:()=>saved.clear()},{ownKeys:()=>[...saved.keys()],getOwnPropertyDescriptor:(_,k)=>saved.has(k)?{enumerable:true,configurable:true}:undefined});
 const stage={syncParty(){},setChapter(){},update(){},dungeonActive:()=>false,resize(){},push(){},heartBurst(){},restoreSnapshot(){},queue:{},fx:{}};
 const context={console,document:doc,localStorage:storage,location:{search:'?dev=1',hostname:'localhost',origin:'http://localhost',reload(){}},innerHeight:900,innerWidth:390,URLSearchParams,URL,Blob,Uint32Array,Uint8Array,TextEncoder,crypto:crypto.webcrypto,Date,Math,Map,Set,setTimeout(){},requestAnimationFrame(){},addEventListener(k,f){events[k]=f;},fetch:async()=>{throw Error('network disabled');},navigator:{clipboard:{}},matchMedia:()=>({matches:false}),MallangIdleStage:{create:()=>stage},MallangIdleAudio:null};
 if(options.production)context.location.search='';
 if(options.fetch)context.fetch=options.fetch;
 context.window=context;context.globalThis=context;vm.createContext(context);
 for(const m of html.matchAll(/<script src="([^"]+)">/g)){if(m[1].startsWith('/')||['audio.js','render/stage.js'].includes(m[1]))continue;if(m[1]==='game.js'){const create=context.MallangIdleCloudSave.create;context.MallangIdleCloudSave.create=function(opts){cloudOptions=opts;return create(opts);};}vm.runInContext(fs.readFileSync(path.join(root,m[1]),'utf8'),context,{filename:m[1]});}
 return {context,ids,saved,cloudOptions};
}
test('new game HTML/engine modules boot with actual IDs and empty storage',()=>{const b=boot();assert.equal(b.context.__mallangIdle.state.stage,1);assert.equal(b.ids.intro.hidden,false);assert.ok(b.ids.nextGoal.textContent);assert.equal(b.ids.storyOverlay.hidden,true);});
test('v6 resumes without intro, preserves funds and claims, corrupt/future snapshots remain untouched',()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js');let s=C.createState();s.stage=81;s.safeStage=80;s.gold=123456;s.shards=456;s.t=100;const p=S.serialize(s,Date.now());p.version=6;p.daily={date:'2026-11-22',base:{kills:0,upgrades:0,bossTries:0},claimed:{kills:true}};p.dungeon={date:'2026-11-22',runs:2,best:7};
 const b=boot(JSON.stringify(p));assert.equal(b.ids.intro.hidden,true);assert.ok(b.context.__mallangIdle.state.gold>=123456);assert.equal(b.context.__mallangIdle.state.shards,456);assert.equal(b.context.__mallangIdle.state.daily.claimed.kills,true);assert.equal(b.context.__mallangIdle.state.dungeon.charges,1);
 for(const raw of ['{bad',JSON.stringify({...p,version:999}),JSON.stringify({version:10})]){const blocked=boot(raw);assert.equal(blocked.saved.get('mallang-idle-save'),raw);assert.equal(blocked.ids.saveModal.hidden,false);assert.match(blocked.ids.saveStatus.textContent,/읽지 못/);}
});
test('actual UI handlers and pure engine action sequence commit identical hatch, growth and trial rewards',()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js'),F=require('../engine/friends.js'),D=require('../engine/dungeon.js');
 const initial=C.createState(42);initial.stage=81;initial.safeStage=80;initial.progress.maxClearedStage=80;initial.t=100;initial.friends.hearts=80;
 const b=boot(S.dump(initial,Date.now())),live=b.context.__mallangIdle.state,expected=C.clone(live);
 const result=F.open(expected);b.ids.hatchOpen.click();assert.ok(result);assert.deepEqual(JSON.parse(JSON.stringify(live.hatch)),expected.hatch);assert.equal(live.friends.hearts,expected.friends.hearts);
 assert.ok(F.grow(expected,'rabbit'));b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='rabbit').children[1].click();assert.equal(live.friends.levels.rabbit,expected.friends.levels.rabbit);assert.equal(live.friends.hearts,expected.friends.hearts);
 const trial=D.enter(expected,Date.now());assert.ok(trial);b.ids.dungeonGo.click();assert.equal(live.gold,expected.gold);assert.equal(live.shards,expected.shards);assert.equal(live.dungeon.charges,expected.dungeon.charges);assert.equal(b.ids.dungeonModal.hidden,false);
 const disk=JSON.parse(b.saved.get(S.STORAGE_KEY));assert.equal(disk.gold,live.gold);assert.equal(disk.hatch.rngState,live.hatch.rngState);assert.equal(disk.friends.levels.rabbit,live.friends.levels.rabbit);assert.equal(disk.dungeon.charges,live.dungeon.charges);
});
test('partially corrupt v6 retains the original, blocks saves and initializes code/file recovery handlers',async()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js');
 const raw=JSON.stringify({...S.serialize(C.createState(),Date.now()),version:6,relics:'broken'}),b=boot(raw);
 assert.equal(b.saved.get(S.STORAGE_KEY),raw);assert.equal(b.ids.saveModal.hidden,false);
 assert.match(b.ids.saveStatus.textContent,/읽지 못/);
 for(const id of ['restoreGo','exportSave','serverBackups'])assert.equal(typeof b.ids[id].onclick,'function',id);
 assert.equal(typeof b.ids.importSave.onchange,'function');
 assert.ok([...b.saved].some(([k,v])=>k.startsWith(S.STORAGE_KEY+'-backup-')&&v===raw));
 b.ids.exitBtn3.click();assert.equal(b.saved.get(S.STORAGE_KEY),raw);
 const replacement=C.createState();replacement.gold=321;replacement.stage=12;replacement.safeStage=11;
 const text=S.dump(replacement,Date.now());
 await b.ids.importSave.onchange({target:{files:[{size:text.length,text:async()=>text}]}});
 assert.equal(b.context.__mallangIdle.state.gold,321);assert.equal(b.ids.saveModal.hidden,true);
 assert.equal(JSON.parse(b.saved.get(S.STORAGE_KEY)).gold,321);
});
test('local backup buttons appear before server lookup and remain usable when it fails',async()=>{
 const b=boot('{bad',{production:true});
 b.saved.set('mallang-idle-save-backup-local','original');
 // Without a connection inspect fails immediately; that must still retain local backups.
 await b.ids.serverBackups.click();
 assert.ok(b.ids.backupList.children.some(btn=>/이 기기/.test(btn.textContent)));
 let release;const pending=new Promise(r=>{release=r;});
 const c=boot('{bad',{production:true,entries:[['mallang-idle-connection',JSON.stringify({code:'A'.repeat(28),baseRevision:1})]],fetch:async()=>{await pending;throw Error('offline');}});
 const lookup=c.ids.serverBackups.click();
 const displayedWhilePending=c.ids.backupList.children.some(btn=>/이 기기/.test(btn.textContent));
 release();await lookup;assert.equal(displayedWhilePending,true);
 assert.ok(c.ids.backupList.children.some(btn=>/이 기기/.test(btn.textContent)));
 assert.match(c.ids.saveStatus.textContent,/offline/);
});
test('ordinary boss clear refreshes heart count, growth affordability and egg affordability',()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js'),Cal=require('../engine/calendar.js');
 for(const hearts of [1,9]){
  const initial=C.createState();initial.stage=12;initial.safeStage=11;initial.progress.maxClearedStage=11;initial.friends.rewardedThrough=11;initial.storySeen=['ch-meadow'];
  Cal.sync(initial,Date.now());initial.friends.hearts=hearts;initial.hatch.firstGiftClaimed=true;
  const b=boot(S.dump(initial,Date.now())),live=b.context.__mallangIdle.state;
  b.ids.hatchAgain.ontoggle();
  if(hearts===1)assert.equal(b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='rabbit').children[1].disabled,true);
  if(hearts===9)assert.equal(b.ids.hatchOpen.disabled,true);
  live.phase=C.PHASE_BOSS;live.enemyHp=1;live.enemyMaxHp=1;live.attackAccum=1;
  b.context.__mallangIdle.advance(0.1);
  assert.equal(live.friends.hearts,hearts+1);
  assert.equal(b.ids.heartCount.textContent,'마음방울 '+(hearts+1)+'개');
  assert.equal(b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='rabbit').children[1].disabled,false);
  if(hearts===9)assert.equal(b.ids.hatchOpen.disabled,false);
 }
});

test('full party waits for an explicit replacement, crown changes order, removal survives save/load',()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js');
 const s=C.createState();s.stage=100;s.safeStage=99;s.party=['rabbit','chick','hamster'];s.t=1;
 const b=boot(S.dump(s,Date.now())),live=b.context.__mallangIdle.state;
 b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();
 assert.deepEqual(Array.from(live.party),['rabbit','chick','hamster']);
 assert.equal(b.ids.partyChoiceHint.textContent,'누구랑 바꿀까요?');
 b.ids.partyCancel.click();assert.deepEqual(Array.from(live.party),['rabbit','chick','hamster']);
 b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();b.ids.partyBar.children[2].click();
 assert.deepEqual(Array.from(live.party),['rabbit','chick','latte']);
 b.ids.partyBar.children[2].click();b.ids.partyActions.children[0].click();
 assert.deepEqual(Array.from(live.party),['latte','rabbit','chick']);
 b.ids.partyBar.children[1].click();b.ids.partyActions.children[1].click();
 assert.deepEqual(Array.from(live.party),['latte','chick']);
 assert.deepEqual(S.load(S.dump(live,Date.now())).state.party,['latte','chick']);
 b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='hamster').children[0].click();assert.deepEqual(Array.from(live.party),['latte','chick','hamster']);
});

function partyBoot(stage=100,party=['rabbit','chick','hamster']) {
 const C=require('../engine/combat.js'),S=require('../engine/save.js'),s=C.createState();
 s.stage=stage;s.safeStage=stage-1;s.party=party;s.t=1;
 return boot(S.dump(s,Date.now()));
}
function changeTab(b,tab) {
 b.ids.tabs.onclick({target:{closest:()=>({getAttribute:()=>tab})}});
}
test('cloud and backup import clear both replacement and selected slot before lower-stage restore',async()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js');
 const s=C.createState();s.stage=10;s.safeStage=9;s.party=['rabbit','chick'];
 const payload=S.serialize(s,Date.now());
 for(const source of ['cloud','file'])for(const mode of ['replace','select']){
  const b=partyBoot();
  if(mode==='replace')b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();
  else b.ids.partyBar.children[1].click();
  if(source==='cloud')b.cloudOptions.apply(payload);
  else {const text=JSON.stringify(payload);await b.ids.importSave.onchange({target:{files:[{size:text.length,text:async()=>text}]}});}
  assert.equal(b.ids.partyCancel.hidden,true,source+' '+mode);
  assert.equal(b.ids.partyActions.children.length,0);
  assert.equal(b.ids.partyChoiceHint.textContent,'친구를 눌러 함께 가요');
  b.ids.partyBar.children[0].click();
  assert.deepEqual(Array.from(b.context.__mallangIdle.state.party),['rabbit','chick']);
 }
});
test('leaving party tab cancels replacement and slot actions',()=>{
 for(const mode of ['replace','select']){
  const b=partyBoot();changeTab(b,'party');
  if(mode==='replace')b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();
  else b.ids.partyBar.children[1].click();
  changeTab(b,'upgrade');changeTab(b,'party');
  assert.equal(b.ids.partyCancel.hidden,true);
  assert.equal(b.ids.partyActions.children.length,0);
  b.ids.partyBar.children[0].click();
  assert.deepEqual(Array.from(b.context.__mallangIdle.state.party),['rabbit','chick','hamster']);
 }
});
test('replacement validates current unlock and duplicates before changing or saving party',()=>{
 for(const invalid of ['locked','duplicate']){
  const b=partyBoot(),live=b.context.__mallangIdle.state;
  b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();
  // Both stages have three slots: this must exercise commit-time validation.
  if(invalid==='locked')live.stage=40;
  else live.party[2]='latte';
  const before=Array.from(live.party),disk=b.saved.get('mallang-idle-save');
  b.ids.partyBar.children[0].click();
  assert.deepEqual(Array.from(live.party),before);
  assert.equal(b.saved.get('mallang-idle-save'),disk);
  assert.equal(b.ids.partyCancel.hidden,true);
 }
});
test('9 to 10 unlock ends replacement, clears slot actions, and empty slot adds the chosen friend',()=>{
 const C=require('../engine/combat.js'),S=require('../engine/save.js');
 for(const mode of ['replace','select']){
  const b=partyBoot(9,['rabbit']),live=b.context.__mallangIdle.state;
  if(mode==='replace')b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='chick').children[0].click();
  else b.ids.partyBar.children[0].click();
  live.phase=C.PHASE_BOSS;live.enemyHp=1;live.enemyMaxHp=1;live.attackAccum=1;
  b.context.__mallangIdle.advance(.1);
  assert.equal(live.stage,10);
  assert.equal(b.ids.partyBar.classList.contains('replacing'),false);
  assert.equal(b.ids.partyActions.children.length,0);
  if(mode==='replace'){
   assert.equal(b.ids.partyChoiceHint.textContent,'빈 자리를 눌러 함께 가요');
   b.ids.partyBar.children[1].click();
   assert.deepEqual(Array.from(live.party),['rabbit','chick']);
   assert.deepEqual(JSON.parse(b.saved.get(S.STORAGE_KEY)).party,['rabbit','chick']);
   assert.equal(b.ids.partyChoiceHint.textContent,'친구를 눌러 함께 가요');
  }else assert.equal(b.ids.partyCancel.hidden,true);
 }
});
test('a newly available empty slot never replaces the leader, and an occupied slot cannot execute the old replacement',()=>{
 const b=partyBoot(9,['rabbit']),live=b.context.__mallangIdle.state;
 b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='chick').children[0].click();
 live.stage=10;live.safeStage=9;
 // Click without a render in between: the handler must use the current slot count.
 b.ids.partyBar.children[1].click();
 assert.deepEqual(Array.from(live.party),['rabbit','chick']);
 const c=partyBoot(9,['rabbit']);c.ids.partyList.children.find(card=>card.children[0].dataset.friend==='chick').children[0].click();
 c.context.__mallangIdle.state.stage=10;c.ids.partyBar.children[0].click();
 assert.deepEqual(Array.from(c.context.__mallangIdle.state.party),['rabbit']);
});
test('pending replacement adds into a vacancy created without a slot-count change',()=>{
 const b=partyBoot(),live=b.context.__mallangIdle.state;
 b.ids.partyList.children.find(card=>card.children[0].dataset.friend==='latte').children[0].click();live.party.pop();
 b.ids.partyBar.children[2].click();
 assert.deepEqual(Array.from(live.party),['rabbit','chick','latte']);
});
test('leader multiplier uses plain Korean ability wording',()=>{
 const b=partyBoot();assert.match(b.ids.leaderEffect.textContent,/^대표 능력 1\.5배 · /);
 assert.doesNotMatch(b.ids.leaderEffect.textContent,/대표 효과|x1\.5/);
});

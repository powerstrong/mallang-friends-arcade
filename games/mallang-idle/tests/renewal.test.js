'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../engine/combat.js'),S=require('../engine/save.js'),K=require('../engine/save-contract.js'),F=require('../engine/friends.js'),Cal=require('../engine/calendar.js'),D=require('../engine/dungeon.js'),Q=require('../data/quests.js'),Sim=require('../tools/sim.js');
const now=Date.UTC(2026,10,21,15);
function fixture(){const s=C.createState(42);s.stage=81;s.safeStage=80;s.progress.maxClearedStage=80;s.up={atk:90,aspd:25,gold:20};s.gold=123456;s.shards=456;s.relics={hammer:3,barn:2,compass:4,hourglass:0};s.party=['rabbit','chick','latte'];s.collection=['meadow:acorn'];s.storySeen=['ch-meadow'];s.farmMode=true;Cal.sync(s,now);s.daily.claimed.kills=true;s.dungeon.charges=1;return s;}
test('v0-v10 fixtures migrate, validate, dump and restore another device; v6 never loses progress',()=>{
 for(let version=0;version<=10;version++){
  const p=S.serialize(fixture(),now);p.version=version;
  if(version<7){delete p.offlineThroughAt;delete p.progress;}
  if(version<8){delete p.friends;delete p.hatch;delete p.selectedCompanion;}
  if(version<9){delete p.relics.hourglass;p.dungeon={date:'2026-11-22',runs:2,best:7};delete p.calendar;delete p.attendance;delete p.achievementClaimed;}
  if(version<10){delete p.tutorialSeen;delete p.preferences;}
  const migrated=S.migrateSave(p,{nowMs:now});assert.ok(migrated.ok);assert.ok(K.validate(migrated.save,{nowMs:now}).ok,JSON.stringify(migrated));
  const first=S.deserialize(migrated.save),second=S.load(S.dump(first,now),{nowMs:now}).state;
  for(const field of ['stage','safeStage','gold','shards','up','party','collection','storySeen','farmMode','stats'])assert.deepEqual(second[field],fixture()[field],`v${version} ${field}`);
  assert.equal(second.daily.claimed.kills,true);assert.equal(second.dungeon.charges,1);
  if(version<8){assert.equal(second.friends.hearts,80);assert.equal(second.friends.rewardedThrough,80);}
  assert.deepEqual(S.serialize(second,now),S.serialize(first,now));
 }
});
test('strict shared contract rejects bad growth, RNG, huge body and future versions',()=>{
 const p=S.serialize(fixture(),now);assert.ok(K.validate(p).ok);
 const alter=fn=>{const q=JSON.parse(JSON.stringify(p));fn(q);assert.equal(K.validate(q).ok,false);};
 alter(q=>q.friends.hearts=-1);alter(q=>q.friends.levels.rabbit=21);alter(q=>q.hatch.rngState=2**32);alter(q=>q.hatch.owned=['acorn','acorn']);alter(q=>q.up.atk=100000);alter(q=>q.version=11);alter(q=>q.dungeon.charges=4);alter(q=>q.collection=Array(501).fill('x'));alter(q=>q.gold=Infinity);alter(q=>q.stats.kills=null);alter(q=>q.calendar.lastDayKey='bad');assert.equal(S.load('null').ok,false);
});
test('conflict comparison chooses whole snapshot without mixing RNG, currencies or claim flags',()=>{
 const a=S.serialize(fixture(),now),b=JSON.parse(JSON.stringify(a));b.gold=1;b.progress.maxClearedStage=81;assert.equal(K.compare(b,a).order,1);b.progress.maxClearedStage=80;b.friends.levels.rabbit=2;assert.equal(K.compare(b,a).reason,'친구 성장');b.friends.levels.rabbit=1;b.hatch.owned=['acorn'];assert.equal(K.compare(b,a).reason,'산책 도감');b.hatch.owned=[];b.stats.upgrades++;assert.equal(K.compare(b,a).reason,'강화 횟수');assert.equal(K.compare(a,a).order,0);
 const winner=K.compare(a,b).order>0?a:b;assert.equal(winner.gold,1);assert.deepEqual(winner.daily,b.daily);assert.equal(winner.hatch.rngState,b.hatch.rngState);
});
test('every reward survives an immediate exit, no hatch/quest/offline payout twice',()=>{
 let a=fixture();a.safeStage=80;a.friends.hearts=100;const first=F.open(a);assert.ok(first);a=S.load(S.dump(a,now)).state;const hearts=a.friends.hearts;assert.equal(F.giftReady(a),false);assert.equal(a.hatch.count,1);assert.ok(F.select(a,first.id));
 a.daily.claimed.kills=false;a.stats.kills=a.daily.base.kills+Q.targetOf(Q.QUESTS[0],a.daily);Q.claim(Q.QUESTS[0],a,a.daily);a=S.load(S.dump(a,now)).state;assert.equal(Q.claim(Q.QUESTS[0],a,a.daily),0);
 const result=D.enter(a,now);assert.ok(result);a=S.load(S.dump(a,now)).state;assert.equal(a.dungeon.charges,0);assert.equal(D.enter(a,now),null);
 const paid=S.settleOffline(S.serialize(a,now),now+3600000);assert.equal(S.settleOffline(paid.payload,now+3600000).reward.gold,0);assert.ok(a.friends.hearts>=hearts);
});
function range(n,min,max,label){assert.ok(Number.isFinite(n)&&n>=min&&n<=max,`${label}: ${n} outside ${min}..${max}`);}
test('renewal metric targets for seeds 1/7/42/2026, baseline and unchanged upper checks',()=>{
 for(const seed of [1,7,42,2026])for(const questModel of ['baseline','upper']){
  for(const seconds of [300,1800,7200,86400]){
   const m=Sim.run({seconds,seed,questModel});assert.ok(m.state.gold>=0&&Number.isFinite(C.dps(m.state)));assert.equal(m.heartEarned-m.heartSpent,m.state.friends.hearts);range(m.firstHatchAt,0,180,'first egg');range(m.firstUpgradeAt,0,15,'first upgrade');range(m.firstBossAt,30,60,'first boss');range(m.firstBossClearAt,0,90,'first clear');
   if(seconds===300){range(m.finalStage,6,8,'5m stage');range(m.avgStageDwell,35,65,'5m dwell');range(m.longestWall,25,60,'5m wall');range(m.wallRatio,.05,.20,'5m wall ratio');range(m.avgClearRatio,1,1.4,'5m ratio');range(m.bossFailCount,1,2,'5m failures');assert.equal(m.hatchCount,1);}
   if(seconds===1800){range(m.finalStage,45,65,'30m stage');range(m.avgStageDwell,25,45,'30m dwell');range(m.longestWall,25,180,'30m wall');range(m.wallRatio,.02,.20,'30m wall ratio');range(m.avgClearRatio,1,2,'30m ratio');range(m.hatchCount,2,4,'30m eggs');assert.ok(m.maxFriendLevel>=5);}
   if(seconds===7200){range(m.longestWall,40,600,'2h wall');range(m.avgClearRatio,1,1.7,'2h ratio');}
   if(seconds===86400){range(m.finalStage,210,250,'24h stage');range(m.avgStageDwell,300,420,'24h dwell');range(m.longestWall,0,4200,'24h wall');range(m.wallRatio,0,.82,'24h wall ratio');range(m.avgClearRatio,1,1.7,'24h ratio');assert.equal(m.hatchCount,6);assert.equal(m.uniqueCompanions,6);assert.ok(m.maxFriendLevel>=10);}
   range(m.idleRatio,0,seconds===86400?.20:.15,'idle');
  }
 }
});
test('24h session metrics and morning/evening return decisions use engine rewards',()=>{
 for(const questModel of ['baseline','upper']){
  const m=Sim.run({seconds:86400,questModel,sessions:{activeSec:900,gapSec:7200}});range(m.finalStage,170,210,'session stage');range(m.longestWall,0,360,'session wall');range(m.activeWallRatio,0,.30,'active wall');range(m.activeIdleRatio,0,.15,'active idle');range(m.offlineGoldRatio,.65,.85,'offline gold');assert.equal(m.offlineStageAdvances,0);
  const b=Sim.run({seconds:86400,questModel,sessions:{activeSec:600,gapSec:42600}});assert.ok(b.returns.length>0);b.returns.forEach(r=>{assert.ok(r.upgrades>=1);assert.ok(r.charges>=1);});assert.equal(b.offlineStageAdvances,0);
 }
});

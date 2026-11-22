'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Cal=require('../engine/calendar.js'),C=require('../engine/combat.js'),S=require('../engine/save.js'),Q=require('../data/quests.js'),D=require('../engine/dungeon.js'),A=require('../data/achievements.js');
const midnight=Date.UTC(2026,10,21,15),hour=3600000;
function state(){let s=C.createState(7);s.stage=10;s.safeStage=9;return s;}
test('KST midnight, weekday rules, calendar skips and reverse do not repay',()=>{
 assert.equal(Cal.dayKey(midnight-1),'2026-11-21');assert.equal(Cal.dayKey(midnight),'2026-11-22');assert.equal(Cal.rule(midnight),null);assert.equal(Cal.rule(midnight+24*hour),'bossMul');
 let s=state();Cal.sync(s,midnight);assert.equal(s.friends.hearts,2);Cal.sync(s,midnight);assert.equal(s.friends.hearts,2);Cal.sync(s,midnight-24*hour);assert.equal(s.friends.hearts,2);
 Cal.sync(s,midnight+72*hour);assert.equal(s.attendance.count,2);for(let i=4;i<10;i++)Cal.sync(s,midnight+i*24*hour);assert.equal(s.attendance.count,7);assert.equal(s.friends.hearts,16);
});
test('charge capacity, exact eight hours, no full capacity overflow and old runs preserved',()=>{
 let s=state();Cal.sync(s,midnight);assert.equal(s.dungeon.charges,3);Cal.sync(s,midnight+100*hour);assert.ok(Cal.consume(s,midnight+100*hour));assert.equal(s.dungeon.charges,2);Cal.sync(s,midnight+107.99*hour);assert.equal(s.dungeon.charges,2);Cal.sync(s,midnight+108*hour);assert.equal(s.dungeon.charges,3);
 let p=S.serialize(state(),midnight);p.version=8;p.daily=Q.freshDaily('2026-11-22',p.stats,9);p.daily.claimed.kills=true;p.dungeon={date:'2026-11-22',runs:2,best:7};let m=S.migrateSave(p,{nowMs:midnight+hour});assert.equal(m.save.dungeon.charges,1);let r=S.deserialize(m.save);Cal.sync(r,midnight+hour);assert.equal(r.daily.claimed.kills,true);assert.equal(r.dungeon.charges,1);assert.equal(r.attendance.count,1);const earned=r.friends.hearts;Cal.sync(r,midnight+hour);assert.equal(r.friends.hearts,earned);
});
test('daily targets snapshot, rewards once, migrated legacy dates and lost days',()=>{
 let s=state();Cal.sync(s,midnight);assert.equal(s.daily.targets.kills,100);s.safeStage=100;Cal.sync(s,midnight+hour);assert.equal(s.daily.targets.kills,100);s.stats.kills=100;assert.equal(Q.claim(Q.QUESTS[0],s,s.daily),3);let hearts=s.friends.hearts;assert.equal(Q.claim(Q.QUESTS[0],s,s.daily),0);assert.equal(s.friends.hearts,hearts);
 Cal.sync(s,midnight+24*hour);assert.equal(s.daily.targets.kills,200);
 const p=S.serialize(s,midnight);p.version=8;p.daily.date='2026-11-22';p.daily.claimed.kills=true;const m=S.migrateSave(p,{nowMs:midnight});assert.equal(m.save.daily.claimed.kills,true);
});
test('trial reward committed before replay, reload never replays payout, rule never leaks',()=>{
 let s=state();Cal.sync(s,midnight);const up=JSON.stringify(s.up),party=JSON.stringify(s.party);let r=D.enter(s,midnight+24*hour);assert.ok(r);const gold=s.gold;let b=S.load(S.dump(s,midnight+24*hour),{nowMs:midnight+24*hour}).state;assert.equal(b.gold,gold);assert.equal(b.dungeon.charges,2);assert.equal(JSON.stringify(s.up),up);assert.equal(JSON.stringify(s.party),party);assert.equal(s.trialRule,undefined);
 const ids=Object.keys(require('../engine/balance.js').BALANCE.characters);
 s.stage=150;s.safeStage=149;s.up={atk:200,aspd:500,gold:100};Object.keys(s.friends.levels).forEach(id=>s.friends.levels[id]=20);
 for(let day=0;day<7;day++)for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)for(let c=b+1;c<ids.length;c++){
   s.party=[ids[a],ids[b],ids[c]];const original=JSON.stringify(s),time=midnight+day*24*hour,probe={...s,trialRule:Cal.rule(time)},result=D.simulate(s,time);
   assert.ok(Number.isFinite(result.gold));assert.ok(C.effAspd(probe)<=5);assert.deepEqual(result,D.simulate(probe));assert.equal(JSON.stringify(s),original);
   const baseBonus=C.partyBonus(s),boost=C.partyBonus(probe),key=Cal.rule(time);if(key)assert.ok(boost[key]>=baseBonus[key]);
 }
});
test('hourglass eight/twelve hours, stage unchanged and six cosmetic achievements',()=>{
 let s=state();assert.equal(C.offlineReward(s,99*3600).seconds,8*3600);s.relics.hourglass=7;const stage=s.stage;const reward=C.offlineReward(s,99*3600);assert.equal(reward.seconds,12*3600);assert.ok(Math.abs(C.offlineSettings(s).efficiency-0.6)<1e-12);assert.equal(s.stage,stage);assert.equal(A.ALL.length,6);s.achievementClaimed={};assert.equal(A.claim(s,'egg'),false);s.hatch.count=1;assert.equal(A.claim(s,'egg'),true);assert.equal(A.claim(s,'egg'),false);
});
test('achievement thresholds follow BALANCE and the full collection follows companion data',()=>{
 const B=require('../engine/balance.js').BALANCE,companions=require('../data/companions.js');
 const previous=B.achievements;
 try{
  B.achievements={firstHatchCount:2,collectionCount:4,starCount:2,clearStage:40,trialBest:12};
  const check=(id,s)=>A.ALL.find(a=>a.id===id).test(s),s=state();
  s.hatch.count=1;assert.equal(check('egg',s),false);s.hatch.count=2;assert.equal(check('egg',s),true);
  s.hatch.owned=companions.slice(0,3).map(c=>c.id);assert.equal(check('three',s),false);
  s.hatch.owned.push(companions[3].id);assert.equal(check('three',s),true);
  s.friends.levels.rabbit=B.friends.starLevels[0];assert.equal(check('star',s),false);
  s.friends.levels.rabbit=B.friends.starLevels[1];assert.equal(check('star',s),true);
  s.safeStage=39;assert.equal(check('thirty',s),false);s.safeStage=40;assert.equal(check('thirty',s),true);
  s.dungeon={best:11};assert.equal(check('ten',s),false);s.dungeon.best=12;assert.equal(check('ten',s),true);
  s.hatch.owned=companions.map(c=>c.id);assert.equal(check('six',s),true);
  companions.push({id:'test-companion'});
  try{assert.equal(check('six',s),false);s.hatch.owned.push('test-companion');assert.equal(check('six',s),true);}finally{companions.pop();}
 }finally{B.achievements=previous;}
});

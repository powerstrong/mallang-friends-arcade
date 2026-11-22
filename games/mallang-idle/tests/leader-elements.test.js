'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../engine/combat'),B=require('../engine/balance').BALANCE,Ch=require('../data/chapters'),F=require('../engine/friends');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' != '+b);
test('leader multiplies only its own passive, with growth and weekday, not synergy',()=>{
 const s=C.createState();s.party=['rabbit','latte'];s.friends.levels.rabbit=10;s.trialRule='atkMul';
 near(C.partyBonus(s).atkMul,.2*B.leaderMultiplier*F.multiplier(s,'rabbit')*B.calendar.ruleMultiplier);
 near(C.partyBonus(s).bossMul,.35+.05);
 s.party.reverse();near(C.partyBonus(s).bossMul,.35*B.leaderMultiplier+.05);
 near(C.partyBonus(s).atkMul,.2*F.multiplier(s,'rabbit')*B.calendar.ruleMultiplier);
});
test('element damage enters elapsed HP and event time, with no disadvantage penalty',()=>{
 for(const phase of [C.PHASE_FIGHT,C.PHASE_BOSS])for(const id of ['rabbit','chick','mintcat']){
  const s=C.createState();s.stage=95;s.mobIndex=0;s.party=[id];s.phase=phase;s.enemyHp=1e6;s.enemyMaxHp=1e6;
  const enemy=phase===C.PHASE_BOSS?Ch.bossFor(s.stage):Ch.mobFor(s.stage,0);
  const chars=require('../data/characters'),factor=chars.beats[chars.byId(id).el]===enemy.el?B.elementAdvantage:1;
  near(C.elementMultiplier(s,enemy),factor);
  const expected=(phase===C.PHASE_BOSS?C.bossDps(s):C.dps(s))*factor,before=s.enemyHp;
  C.step(s,.25);near(before-s.enemyHp,expected*.25);
  const a=C.clone(s),b=C.clone(s);a.enemyHp=b.enemyHp=expected*.3;C.step(a,.4);for(let i=0;i<4;i++)C.step(b,.1);
  near(a.enemyHp,b.enemyHp);assert.equal(a.phase,b.phase);
 }
});
test('every enemy has an element; early chapters offer leaf and water opponents',()=>{
 for(const c of Ch.CHAPTERS){assert.ok(c.boss.el);assert.ok(c.mobs.every(m=>['fire','leaf','water'].includes(m.el)));}
 for(const c of Ch.CHAPTERS.slice(0,2)){assert.ok(c.mobs.some(m=>m.el==='leaf'));assert.ok(c.mobs.some(m=>m.el==='water'));}
});
test('all cheer/cute sheets use the declared frame width and 220px height',()=>{
 const fs=require('node:fs'),path=require('node:path'),chars=require('../data/characters').CHARACTERS;
 for(const c of chars)for(const kind of ['cheer','cute']){
  if(!c[kind])continue;
  const png=fs.readFileSync(path.join(__dirname,'..',c[kind]));
  assert.equal(png.readUInt32BE(16),c[kind+'W']*c[kind+'N']);
  assert.equal(png.readUInt32BE(20),220);
 }
});
test('trial uses the same element bonus for each displayed chapter boss',()=>{
 const D=require('../engine/dungeon'),s=C.createState();s.stage=100;s.safeStage=99;s.up.atk=200;s.party=['chick'];
 const r=D.simulate(s);
 for(let i=0;i<r.kills;i++){
  const boss=Ch.CHAPTERS[i%Ch.CHAPTERS.length].boss;
  near(r.log[i].time,r.log[i].hp/(C.bossDps(s)*C.elementMultiplier(s,boss)));
 }
 assert.ok(r.kills>0);
});

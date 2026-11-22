'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../engine/friends.js'),C=require('../engine/combat.js'),S=require('../engine/save.js'),R=require('../engine/rng.js'),Sim=require('../tools/sim.js');
test('zero RNG restore, six unique hatches, saved next result deterministic',()=>{
 const r=R.restore(0);assert.equal(r.state(),0);const a=C.createState(42);a.stage=120;a.safeStage=119;a.friends.hearts=100;
 const b=S.deserialize(S.serialize(a,1000));for(let i=0;i<6;i++)assert.deepEqual(F.open(a),F.open(b));assert.equal(new Set(a.hatch.owned).size,6);assert.equal(a.hatch.count,6);const before=a.friends.hearts;assert.equal(F.open(a).duplicate,true);assert.equal(a.friends.hearts,before-8);
});
test('growth price, locks, cap, stars, resource and first clear idempotence',()=>{
 const s=C.createState();s.friends.hearts=1000;assert.equal(F.grow(s,'rabbit'),false);s.stage=10;assert.equal(F.grow(s,'latte'),false);
 for(let i=1;i<20;i++)assert.ok(F.grow(s,'rabbit'));assert.equal(F.grow(s,'rabbit'),false);assert.equal(F.stars(20),3);assert.equal(F.multiplier(s,'rabbit'),1.5);
 F.rewardClear(s,5);const hearts=s.friends.hearts;F.rewardClear(s,5);assert.equal(s.friends.hearts,hearts);s.friends.hearts=-1;assert.equal(F.grow(s,'chick'),false);
});
test('v6 retroactive hearts exactly once and original resources retained',()=>{
 const s=C.createState();s.stage=81;s.safeStage=80;s.gold=123;s.shards=456;
 const v6=S.serialize(s,1000);v6.version=6;delete v6.friends;delete v6.hatch;
 const a=S.load(JSON.stringify(v6));assert.equal(a.state.friends.hearts,80);assert.equal(a.state.friends.rewardedThrough,80);assert.equal(a.state.gold,123);assert.equal(a.state.shards,456);assert.ok(F.giftReady(a.state));
 F.open(a.state);const b=S.load(S.dump(a.state,1000));assert.equal(b.state.friends.hearts,80);assert.equal(F.giftReady(b.state),false);
});
test('growth preserves farming versus boss party choice and caps',()=>{
 const s=C.createState();s.stage=150;s.up={atk:250,aspd:100,gold:100};s.friends.hearts=100000;Object.keys(s.friends.levels).forEach(id=>{s.friends.levels[id]=20;});
 assert.notDeepEqual(Sim.run({seconds:300,seed:1}).state.hatch.rngState,undefined);
 s.party=['rabbit','latte','chick'];const boss=C.bossDps(s),gold=C.goldPerSec(s,150);s.party=['hamster','mintcat','otter'];assert.ok(C.bossDps(s)<boss);assert.ok(C.goldPerSec(s,150)>gold);s.up.aspd=100000;assert.ok(C.effAspd(s)<=5);
});

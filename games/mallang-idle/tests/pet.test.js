'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Pet=require('../engine/pet.js'),Combat=require('../engine/combat.js');
const Save=require('../engine/save.js'),Contract=require('../engine/save-contract.js');
const midnight=Date.parse('2026-11-22T15:00:00Z');
test('five daily hearts, one limit notice and per-friend cooldown',()=>{
  const s=Combat.createState(42),pet=Pet.create(),start=midnight-20000;
  const before=JSON.stringify([s.gold,s.stats,s.hatch,Combat.dps(s),s.enemyHp]);
  assert.equal(pet.tap(s,'rabbit',start).reward,1);
  assert.equal(pet.tap(s,'rabbit',start+1).reward,0);
  let notices=0;
  for(let i=1;i<8;i++){
    const r=pet.tap(s,'rabbit',start+i*2000);notices+=Number(r.limitReached);
    assert.equal(r.reward,i<5?1:0);assert.equal(r.animate,i<5);
  }
  assert.equal(notices,1);assert.equal(s.friends.hearts,5);assert.equal(s.pet.count,5);
  assert.equal(before,JSON.stringify([s.gold,s.stats,s.hatch,Combat.dps(s),s.enemyHp]));
});
test('KST midnight renews the allowance, backward clock never renews it',()=>{
  const s=Combat.createState(),pet=Pet.create();
  s.pet={day:'2026-11-22',count:5};
  assert.equal(pet.tap(s,'rabbit',midnight-1).reward,0);
  assert.equal(pet.tap(s,'rabbit',midnight+1500).reward,1);
  assert.deepEqual(s.pet,{day:'2026-11-23',count:1});
  assert.equal(Pet.create().tap(s,'rabbit',midnight-10000).reward,0);
  assert.equal(s.pet.count,1);
  s.pet={day:'',count:0};s.calendar={lastDayKey:'2026-11-24'};
  assert.equal(Pet.create().tap(s,'rabbit',midnight).reward,0);
});
test('followers and owned egg friends share the daily limit, each has a cooldown',()=>{
  const s=Combat.createState(),pet=Pet.create();s.party=['rabbit','chick','hamster'];
  s.hatch.owned=['acorn'];s.selectedCompanion='acorn';
  for(const id of [...s.party,'acorn'])assert.equal(pet.tap(s,id,midnight).reward,1);
  assert.equal(pet.tap(s,'acorn',midnight+1).reward,0);
  assert.equal(pet.tap(s,'fairy',midnight+2000).reward,0);
  assert.equal(s.pet.count,4);
});
test('v11 save roundtrip and offline settlement retain pet ledger and tutorial',()=>{
  const s=Combat.createState();Pet.create().tap(s,'rabbit',midnight);s.tutorialSeen.push('petHint');
  const p=Save.serialize(s,midnight),checked=Contract.validate(p,{nowMs:midnight});
  assert.equal(checked.ok,true,checked.note);
  const restored=Save.deserialize(JSON.parse(Save.dump(s,midnight)));
  assert.deepEqual(restored.pet,s.pet);assert.deepEqual(restored.tutorialSeen,['petHint']);
  assert.deepEqual(Save.settleOffline(p,midnight+10000).payload.pet,s.pet);
  for(const count of [-1,1.2,6])assert.equal(Contract.validate({...p,pet:{day:s.pet.day,count}}).ok,false);
  assert.equal(Contract.validate({...p,pet:{day:'bad',count:0}}).ok,false);
});
test('v10 migration adds defaults without changing existing heart balance',()=>{
  const s=Combat.createState();s.friends.hearts=12;
  const p=Save.serialize(s,midnight);p.version=10;delete p.pet;
  const checked=Contract.validate(p,{nowMs:midnight});assert.equal(checked.ok,true,checked.note);
  assert.equal(checked.save.version,Save.CURRENT_VERSION);assert.deepEqual(checked.save.pet,{day:'',count:0});
  assert.equal(Save.deserialize(checked.save).friends.hearts,12);
  assert.deepEqual(Save.deserialize(p).pet,{day:'',count:0});
});
test('field UI shows its hint and daily limit toast once and saves only earned rewards',()=>{
  require('../render/game.js');
  const s=Combat.createState(),toasts=[],feedback=[];let now=midnight,saved=0,sounds=0;
  const ui=globalThis.MallangIdlePetUI.create({state:()=>s,now:()=>now,
    stage:{friendAt:()=>({id:'rabbit',busy:false}),petFeedback:(f,r)=>feedback.push(r)},
    sfx:()=>sounds++,toast:t=>toasts.push(t),persist:()=>saved++,changed:()=>saved++,
    markTutorial:id=>s.tutorialSeen.push(id)});
  ui.hint();ui.hint();assert.deepEqual(toasts,['친구를 톡 눌러 봐요']);assert.equal(saved,1);
  for(let i=0;i<7;i++){assert.equal(ui.tap({}),true);now+=2000;}
  assert.equal(toasts.filter(t=>t.includes('내일 또')).length,1);
  assert.equal(sounds,5);assert.equal(saved,6);assert.equal(feedback.length,7);
  assert.equal(feedback.at(-1).animate,false);
});

test('busy attacks and actions still earn one reward and use the small response',()=>{
  const s=Combat.createState(),pet=Pet.create();
  const r=pet.tap(s,'rabbit',midnight,true);
  assert.equal(r.reward,1);assert.equal(r.animate,false);
  assert.equal(s.friends.hearts,1);assert.equal(s.pet.count,1);
  assert.equal(pet.tap(s,'rabbit',midnight+1,true).reward,0);
  assert.equal(s.pet.count,1);
});

test('a friend moving between pointer down and click still receives the tap',()=>{
  require('../render/game.js');
  const s=Combat.createState();let friend={id:'rabbit',busy:false},feedback=[];
  const ui=globalThis.MallangIdlePetUI.create({state:()=>s,now:()=>midnight,
    stage:{friendAt:()=>friend,petFeedback:(f,r)=>feedback.push([f.id,r.reward])},
    sfx:()=>{},changed:()=>{},toast:()=>{}});
  ui.press({});friend=null;
  assert.equal(ui.tap({detail:1}),true);
  assert.deepEqual(feedback,[['rabbit',1]]);assert.equal(s.pet.count,1);
  assert.equal(ui.tap({detail:1}),false,'the pressed target is consumed once');
  friend={id:'rabbit',busy:false};ui.press({});ui.cancel();friend=null;
  assert.equal(ui.tap({detail:1}),false,'cancelled pointers cannot leave a stale target');
});

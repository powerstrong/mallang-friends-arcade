'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../engine/combat'),S=require('../engine/save'),Contract=require('../engine/save-contract'),Chars=require('../data/characters'),Ch=require('../data/chapters'),B=require('../engine/balance').BALANCE;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('15층부터 세 속성 대표 선택, 기존 해금 유지, 펭귄의 불꽃 상대 역할',()=>{
 assert.equal(Chars.unlockedAt(14).includes('penguin'),false);
 assert.deepEqual(new Set(Chars.unlockedAt(15).map(id=>Chars.byId(id).el)),new Set(['leaf','fire','water']));
 for(const [id,stage] of Object.entries({hamster:22,latte:55,mintcat:90,otter:120}))assert.equal(Chars.byId(id).unlockStage,stage);
 const s=C.createState();s.stage=15;s.party=['penguin'];near(C.partyBonus(s).atkMul,.12*B.leaderMultiplier);
 const fire=Ch.CHAPTERS[0].mobs.find(m=>m.el==='fire');
 const penguin=C.dps(s)*C.elementMultiplier(s,fire);s.party=['rabbit'];assert.ok(penguin>C.dps(s)*C.elementMultiplier(s,fire));
 const totals={fire:0,leaf:0,water:0};for(let stage=1;stage<=30;stage++)for(let i=0;i<B.mobsPerStage;i++)totals[Ch.mobFor(stage,i).el]++;
 assert.deepEqual(totals,{fire:100,leaf:100,water:100});
 s.stage=90;s.party=['penguin','mintcat'];near(C.partyBonus(s).advanceMul,.4+.05);
 assert.equal(B.synergies.find(x=>x.ids.includes('penguin')).name,'시원한 바람');
});
test('v11 로컬·공유 클라우드 계약: 빠진 펭귄만 Lv.1 추가, 쓰다듬기·재화·편성 보존',()=>{
 const s=C.createState(42);s.stage=95;s.safeStage=94;s.progress.maxClearedStage=94;s.gold=12345;s.shards=22;
 s.party=['rabbit','mintcat'];s.friends.hearts=17;s.friends.levels.rabbit=9;s.pet={day:'2026-11-22',count:5};s.tutorialSeen=['petHint'];
 const old=S.serialize(s,1000);old.version=11;delete old.friends.levels.penguin;const original=JSON.stringify(old);
 for(const result of [S.load(original),Contract.validate(old)]){
  assert.equal(result.ok,true,result.note);assert.equal(result.save.friends.levels.penguin,1);
  const expected=JSON.parse(original);expected.version=S.CURRENT_VERSION;expected.friends.levels.penguin=1;assert.deepEqual(result.save,expected);
 }
 assert.equal(JSON.stringify(old),original);
 s.party=['penguin','rabbit'];s.friends.levels.penguin=7;
 const checked=Contract.validate(S.serialize(s,2000));assert.equal(checked.ok,true,checked.note);
 const restored=S.load(JSON.stringify(checked.save)).state;assert.deepEqual(restored.party,s.party);assert.equal(restored.friends.levels.penguin,7);assert.deepEqual(restored.pet,s.pet);
 const corrupt=S.serialize(s,2000);corrupt.friends.levels.penguin=0;assert.equal(Contract.validate(corrupt).ok,false);
 delete corrupt.friends.levels.penguin;assert.equal(Contract.validate(corrupt).ok,false);
});
test('펭귄 PNG 프레임 규격은 전달된 meta.json과 일치',()=>{
 const c=Chars.byId('penguin'),meta=require('../assets/penguin-meta.json');
 for(const [kind,w,n] of [['walk','walkW','walkN'],['run','runW','runN'],['atkSheet','atkSheetW','atkSheetN'],['atkSp','atkSpW','atkSpN'],['cheer','cheerW','cheerN'],['cute','cuteW','cuteN']]){
  assert.equal(c[kind==='walk'?'frameW':w],meta[w]);assert.equal(c[n],meta[n]);
  const png=fs.readFileSync(path.join(__dirname,'..',c[kind]));assert.equal(png.readUInt32BE(16),meta[w]*meta[n]);assert.equal(png.readUInt32BE(20),220);
 }
});

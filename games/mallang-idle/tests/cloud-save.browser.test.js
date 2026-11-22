/* Run against a local Worker/D1: IDLE_TEST_API=http://127.0.0.1:8787 CHROME_PATH=... node ...
 * Two withPage calls use different Chrome profiles and fresh storage, not fetch fixtures.
 */
'use strict';
const assert=require('node:assert/strict'),H=require('./browser-harness.js'),Save=require('../engine/save.js'),Combat=require('../engine/combat.js');
const api=process.env.IDLE_TEST_API;
if(!api || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api)){console.log('SKIPPED: local Worker/D1 required via IDLE_TEST_API (never prod)');process.exit(0);}
const s=Combat.createState(2026);s.stage=81;s.safeStage=80;s.progress.maxClearedStage=80;s.up={atk:90,aspd:25,gold:20};s.gold=123456;s.shards=45;s.relics={hammer:2,barn:3,compass:4,hourglass:1};s.friends.levels.rabbit=5;s.friends.hearts=17;s.hatch.owned=['acorn'];s.hatch.count=1;s.hatch.firstGiftClaimed=true;s.storySeen=['ch-meadow'];s.t=500;
require('../engine/calendar.js').sync(s,Date.now());s.daily.claimed.kills=true;s.dungeon.charges=1;s.selectedCompanion='acorn';
const seed=Save.serialize(s,Date.now());let code;
async function waitFor(pg,expression){for(let i=0;i<150;i++){if(await pg.eval(expression))return;await pg.sleep(100);}throw Error('timeout: '+expression);}
(async()=>{
 await H.withPage('/games/mallang-idle/index.html',async pg=>{
  await waitFor(pg,'!!localStorage.getItem("mallang-idle-connection") && JSON.parse(localStorage.getItem("mallang-idle-connection")).baseRevision>0');
  const stored=JSON.parse(await pg.eval('localStorage.getItem("mallang-idle-save")'));assert.equal(stored.stage,81);assert.equal(stored.shards,45);
  code=JSON.parse(await pg.eval('localStorage.getItem("mallang-idle-connection")')).code;
  await pg.eval('localStorage.clear()');
 },{apiOrigin:api,initScript:'localStorage.clear();localStorage.setItem("mallang-idle-save",'+JSON.stringify(JSON.stringify(seed))+');'});
 await H.withPage('/games/mallang-idle/index.html',async pg=>{
  await waitFor(pg,'!!document.getElementById("introRestore") && !!window.MallangIdleCloudSave');
  await pg.clickEl('introRestore');await pg.eval('document.getElementById("restoreCode").value='+JSON.stringify(code));await pg.clickEl('restoreGo');
  await waitFor(pg,'localStorage.getItem("mallang-idle-save") && JSON.parse(localStorage.getItem("mallang-idle-save")).stage===81');
  const recovered=JSON.parse(await pg.eval('localStorage.getItem("mallang-idle-save")'));
  assert.equal(recovered.shards,45);assert.deepEqual(recovered.up,seed.up);assert.deepEqual(recovered.relics,seed.relics);assert.equal(recovered.friends.levels.rabbit,5);assert.equal(recovered.hatch.rngState,seed.hatch.rngState);assert.equal(recovered.hatch.firstGiftClaimed,true);assert.equal(recovered.friends.hearts,seed.friends.hearts);assert.equal(recovered.daily.claimed.kills,true);assert.equal(recovered.dungeon.charges,1);assert.equal(recovered.selectedCompanion,'acorn');
  assert.equal(await pg.eval('getComputedStyle(document.getElementById("intro")).display'),'none');
  assert.equal(await pg.eval('getComputedStyle(document.getElementById("saveModal")).display'),'none');
  console.log('Recovery passed: A upload → erase storage → independent B profile restore, real Worker/D1');
 },{apiOrigin:api});
})().catch(e=>{console.error(e);process.exitCode=1;});

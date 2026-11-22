'use strict';
const H=require('./browser-harness'),assert=require('node:assert/strict'),fs=require('node:fs');
let passed=0;
async function run(pg,reduced){
 for(let i=0;i<100;i++){if(await pg.eval('!!window.__mallangIdle'))break;await pg.sleep(100);}
 await pg.eval("document.getElementById('introStart').click();document.getElementById('storySkip').click();1");
 await pg.sleep(400);
 const result=JSON.parse(await pg.eval(`JSON.stringify((function(){
  var H=window.__mallangIdle,s=H.state,C=window.MallangIdleCombat;
  s.storySeen=window.MallangIdleStory.SCENES.map(function(c){return c.id;});s.stage=60;s.safeStage=59;s.party=['rabbit','chick','hamster'];s.phase='fight';s.mobIndex=0;s.enemyHp=s.enemyMaxHp=10000;
  s.selectedCompanion='acorn';s.hatch.owned=['acorn'];
  H.Stage.restoreSnapshot(s);H.Stage.update(.01,0,s);
  var before=JSON.stringify([s.enemyHp,s.gold,s.shards,s.t]),attack=false,action=false,frames=false;
  for(var i=0;i<400;i++){
   H.Stage.update(.05,0,s);
   var nodes=[document.getElementById('follower1'),document.getElementById('follower2')];
   nodes.forEach(function(n){if(n.classList.contains('friend-attack')){attack=true;if(n.style.backgroundImage.indexOf('sheet')>=0 && n.style.backgroundPosition!=='0px 0px')frames=true;}});
   if(document.querySelector('.friend-action'))action=true;
  }
  H.Stage.celebrate();H.Stage.update(.1,0,s);var lead=document.getElementById('hero').classList.contains('friend-action');
  var sheet=document.getElementById('hero').classList.contains('action-sheet');
  var chars=window.MallangIdleCharacters.CHARACTERS, originals=chars.map(function(c){var old=c.cheer;c.cheer='missing-action.png';return old;});
  H.Stage.celebrate();H.Stage.update(.1,0,s);var fallback=document.getElementById('hero').classList.contains('act-hop');
  chars.forEach(function(c,i){c.cheer=originals[i];});
  var pet=document.querySelector('.field-companion'),petVisible=!pet.hidden;s.selectedCompanion=null;H.Stage.update(.1,0,s);
  return {attack:attack,action:action,frames:frames,lead:lead,sheet:sheet,fallback:fallback,petVisible:petVisible,petHidden:pet.hidden,same:before===JSON.stringify([s.enemyHp,s.gold,s.shards,s.t])};
 })())`));
 assert.equal(result.same,true);passed++;
 assert.equal(result.petVisible && result.petHidden,true);passed++;
 assert.equal(result.attack,!reduced);assert.equal(result.action,!reduced);assert.equal(result.lead,!reduced);passed+=3;
 assert.equal(result.fallback,!reduced);passed++;
 if(!reduced){assert.equal(result.sheet,true);assert.equal(result.frames,true);passed+=2;
  await pg.eval(`(function(){var H=window.__mallangIdle;H.state.selectedCompanion='acorn';H.advance(0.01);H.Stage.update(.1,0,H.state);document.querySelector('.devpanel').hidden=true;document.getElementById('chapterBanner').hidden=true;document.querySelector('[data-tab=party]').click();return 1;})()`);
  await pg.sleep(100);
  assert.equal(await pg.eval('document.documentElement.scrollWidth<=innerWidth'),true);passed++;
  assert.equal(await pg.eval('innerWidth'),400);passed++;
  assert.equal(await pg.eval("(function(){var a=document.getElementById('leaderEffect').getBoundingClientRect(),b=document.querySelector('.element-cycle').getBoundingClientRect(),c=document.getElementById('bossLeaderHint').getBoundingClientRect();return a.bottom<=b.top && b.bottom<=c.top;})()"),true);passed++;
  // Screenshots use 400 CSS pixels, and keep the party panel at its top.
  fs.mkdirSync('/data/projects/mallang_idle_v2/work/shots',{recursive:true});
  fs.writeFileSync('/data/projects/mallang_idle_v2/work/shots/friends.png',Buffer.from(await pg.screenshot(),'base64'));
  await pg.eval("document.querySelector('[data-tab=upgrade]').click();1");await pg.sleep(100);
  fs.writeFileSync('/data/projects/mallang_idle_v2/work/shots/combat.png',Buffer.from(await pg.screenshot(),'base64'));
 }
}
H.withPage('/games/mallang-idle/index.html?dev=1',p=>run(p,false),{viewport:{width:400,height:900},args:['--window-size=400,900']})
.then(()=>H.withPage('/games/mallang-idle/index.html?dev=1',p=>run(p,true),{viewport:{width:400,height:900},args:['--window-size=400,900','--force-prefers-reduced-motion']}))
.then(()=>console.log(passed+' passed, 0 failed'),e=>{console.error(e);console.log(passed+' passed, 1 failed');process.exitCode=1;});

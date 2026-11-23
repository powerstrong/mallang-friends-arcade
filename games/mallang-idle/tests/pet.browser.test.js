'use strict';
const H=require('./browser-harness'),assert=require('node:assert/strict');
async function run(pg,reduced){
  for(let i=0;i<100;i++){if(await pg.eval('!!window.__mallangIdle'))break;await pg.sleep(100);}
  await pg.eval("document.getElementById('introStart').click();document.getElementById('storySkip').click();1");
  await pg.sleep(200);
  await pg.eval(`(function(){var H=window.__mallangIdle,s=H.state;
    s.stage=60;s.safeStage=59;s.party=['rabbit','chick','hamster'];s.phase='fight';
    s.storySeen=window.MallangIdleStory.SCENES.map(c=>c.id);
    s.hatch.owned=['acorn'];s.selectedCompanion='acorn';s.pet={day:'',count:0};
    H.Stage.restoreSnapshot(s);H.Stage.update(.01,0,s);
    window.petBefore=s.friends.hearts;
    window.combatBefore=JSON.stringify([s.enemyHp,s.gold,s.stats,s.hatch.rngState]);
    return 1;})()`);
  // rAF is disabled above, but CSS formation transitions keep running. Wait for
  // those finite transitions before measuring a coordinate for the CDP click.
  await pg.eval(`Promise.all(['hero','follower1','follower2'].flatMap(id=>
    document.getElementById(id).getAnimations().filter(a=>a instanceof CSSTransition)
      .map(a=>a.finished.catch(()=>{}))))`);
  // Real coordinate click: exercises nearest friend hitboxes even under overlapping sprites.
  await pg.clickEl('hero');
  assert.equal(await pg.eval("document.getElementById('hero').classList.contains('friend-action')"),true);
  assert.equal(await pg.eval('window.__mallangIdle.state.friends.hearts-window.petBefore'),1);
  assert.equal(await pg.eval("document.querySelectorAll('.pet-heart').length"),reduced?1:4);
  assert.equal(await pg.eval("document.querySelector('.pet-reward').textContent"),'마음방울 +1 ♥');
  await pg.clickEl('hero');
  assert.equal(await pg.eval('window.__mallangIdle.state.pet.count'),1);
  await pg.clickEl('follower1');await pg.clickEl('follower2');
  await pg.eval("(function(){var n=document.querySelector('.field-companion');n.id='eggFriend';return 1;})()");
  await pg.clickEl('eggFriend');
  assert.equal(await pg.eval("document.getElementById('eggFriend').classList.contains('friend-action')"),true);
  assert.equal(await pg.eval('window.__mallangIdle.state.pet.count'),4);
  assert.equal(await pg.eval('window.combatBefore===JSON.stringify([window.__mallangIdle.state.enemyHp,window.__mallangIdle.state.gold,window.__mallangIdle.state.stats,window.__mallangIdle.state.hatch.rngState])'),true);
  // Force the attack and tap in one task: no sleep can accidentally let the
  // attack's restoration timer expire before the assertion samples it.
  const attacking=await pg.eval(`(function(){
    var H=window.__mallangIdle,s=H.state,stage=H.Stage;
    s.pet.count=0;
    var ui=window.MallangIdlePetUI.create({state:()=>s,stage:stage,now:()=>Date.now()+2000,
      sfx:()=>{},changed:()=>{},toast:()=>{}});
    stage.fx.strike(1,100);
    var hero=document.getElementById('hero'),pose=hero.style.backgroundImage;
    var r=hero.getBoundingClientRect(),before=s.friends.hearts;
    ui.tap({clientX:r.left+r.width/2,clientY:r.top+r.height/2,detail:1,target:hero});
    var first={small:hero.classList.contains('pet-react'),full:hero.classList.contains('friend-action'),
      samePose:hero.style.backgroundImage===pose,reward:s.friends.hearts-before,count:s.pet.count};
    ui.tap({clientX:r.left+r.width/2,clientY:r.top+r.height/2,detail:1,target:hero});
    first.repeated=s.pet.count;first.repeatVisible=hero.classList.contains('pet-react');
    return first;
  })()`);
  assert.deepEqual(attacking,{small:true,full:false,samePose:true,reward:1,count:1,repeated:1,repeatVisible:true});
  console.log('pet coordinate taps and '+(reduced?'reduced':'normal')+' motion passed');
}
H.withPage('/games/mallang-idle/index.html?dev=1',pg=>run(pg,false),{initScript:'window.requestAnimationFrame=function(){};'})
  .then(()=>H.withPage('/games/mallang-idle/index.html?dev=1',pg=>run(pg,true),{args:['--force-prefers-reduced-motion'],initScript:'window.requestAnimationFrame=function(){};'}))
  .catch(e=>{console.error(e);process.exitCode=1;});

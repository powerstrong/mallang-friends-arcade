import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleIdleSave,codeHash} from '../src/idle-save.js';
import Save from '../../games/mallang-idle/engine/save.js';
import Combat from '../../games/mallang-idle/engine/combat.js';
// Actual SQLite transactions exercise the D1 SQL and constraints without an HTTP mock.
// The optional local D1 rehearsal uses Wrangler against the same migration.
function database(){
 const sqlite=new DatabaseSync(':memory:');
 const queries=[];
 function execute(batch){return batch.map(q=>{queries.push(q.sql);const st=sqlite.prepare(q.sql);return {results:st.all(...q.args),meta:{changes:sqlite.prepare('select changes() AS n').get().n}};});}
 const db={prepare(sql){return {bind(...args){const q={sql,args};return {q,async first(){return execute([q])[0].results[0]||null;},async all(){return execute([q])[0];},async run(){return execute([q])[0];}};}};},async batch(stmts){sqlite.exec('BEGIN');try{const result=execute(stmts.map(x=>x.q));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const migration=readFileSync(new URL('../migrations/0005_create_idle_saves.sql',import.meta.url),'utf8');
 sqlite.exec(migration);sqlite.exec(migration);
 db.queries=queries;return db;
}
const code='ABCDEFGHIJKLMNOPQRSTUVWXYZ23';
function payload(stage=1){const s=Combat.createState();s.stage=stage;s.safeStage=stage-1;return Save.serialize(s,1000);}
function request(path,method='GET',body,secret=code){return new Request('https://test/api/idle/'+path,{method,headers:{Authorization:'Bearer '+secret},body:body&&JSON.stringify(body)});}
const write=(p,rev,id)=>({payload:p,baseRevision:rev,requestId:id});
test('idle API: migration twice, hash auth, namespaces, CAS, replay, backups and stale downgrade',async()=>{
 const DB=database(),env={DB,IDLE_NAMESPACE:'test'};
 assert.equal((await codeHash(code)).length,64);
 let r=await handleIdleSave(request('saves','POST',write(payload(),0,'create-0001')),env,1000);assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
 assert.equal((await handleIdleSave(request('save','GET',null,'Z'.repeat(28)),env)).status,404);
 assert.equal((await handleIdleSave(request('save'),{DB,IDLE_NAMESPACE:'staging'})).status,404);
 const body=write(payload(5),1,'advance-001');
 const [a,b]=await Promise.all([handleIdleSave(request('save','POST',body),env,2000),handleIdleSave(request('save','POST',write(payload(4),1,'advance-002')),env,2000)]);
 assert.equal(a.status,200);assert.equal(b.status,409);
 r=await handleIdleSave(request('save','POST',body),env,3000);assert.equal((await r.json()).revision,2);
 r=await handleIdleSave(request('save','POST',write(payload(4),2,'downgrade01')),env,4000);assert.equal(r.status,409);
 r=await handleIdleSave(request('save?backup=1'),env);assert.equal(r.status,200);
 assert.equal((await handleIdleSave(request('save','POST',{...body,extra:'한'.repeat(30000)}),env)).status,413);
 assert.equal((await handleIdleSave(request('save','POST',write({...payload(),version:999},2,'future-0001')),env)).status,422);
 const s=await (await handleIdleSave(request('save'),env)).json();assert.equal(s.payload.stage,5);
 const tie=await handleIdleSave(request('save','POST',write(s.payload,1,'tie-000001')),env);assert.equal(tie.status,409);
 const settlement=await handleIdleSave(request('save','POST',{...write(payload(7),1,'settle-0001'),settlement:true}),env);assert.equal(settlement.status,409);
});
test('unregistered POSTs rotating codes hit the IP limit before lookup or expiry cleanup',async()=>{
 const DB=database(),env={DB,IDLE_NAMESPACE:'test'};let limited=false;
 for(let i=0;i<150;i++){
  const before=DB.queries.length;
  const secret=i.toString(2).replace(/0/g,'A').replace(/1/g,'B').padStart(28,'A');
  const r=await handleIdleSave(request('save','POST',write(payload(),0,'unknown-'+i),secret),env,1000);
  if(r.status===429){limited=true;assert.equal(DB.queries.length-before,1,'rejected IP requests only touch the IP counter');}
  else {assert.equal(limited,false,'requests stay blocked in the same window');assert.equal(r.status,404);}
 }
 assert.ok(limited,'rotating unregistered codes must be throttled');
});
for(const retry of ['creation','requestId'])test(retry+' retries count toward request limits',async()=>{
 const DB=database(),env={DB,IDLE_NAMESPACE:'test'};
 assert.equal((await handleIdleSave(request('saves','POST',write(payload(),0,'create-limit')),env,1000)).status,200);
 let limited=false;
 for(let i=0;i<150;i++){
  const path=retry==='creation'?'saves':'save';
  const body=write(payload(),retry==='creation'?0:1,retry==='creation'?'retry-new-'+i:'create-limit');
  const r=await handleIdleSave(request(path,'POST',body),env,1000);
  assert.ok([200,429].includes(r.status));if(r.status===429)limited=true;
  else assert.equal(limited,false);
 }
 assert.ok(limited,'idempotency responses must still consume request limits');
 assert.equal((await handleIdleSave(request('save'),env,1000)).status,200,'read budget stays independent');
});
test('code limits apply across IPs, including replayed requestIds',async()=>{
 const DB=database(),env={DB,IDLE_NAMESPACE:'test'};
 await handleIdleSave(request('saves','POST',write(payload(),0,'create-code')),env,1000);
 let limited=false;
 for(let i=0;i<150;i++){
  const req=request('save','POST',write(payload(),1,'create-code'));req.headers.set('CF-Connecting-IP','192.0.2.'+i);
  const r=await handleIdleSave(req,env,1000);assert.ok([200,429].includes(r.status));if(r.status===429)limited=true;
 }
 assert.ok(limited,'changing IPs cannot bypass the code budget');
});
test('v0 through current migrate without mutating input or losing v6 fields',()=>{
 for(let version=0;version<=Save.CURRENT_VERSION;version++){
  const p={...payload(80),version,gold:123456,shards:99,storySeen:['chapter-1'],collection:['acorn'],farmMode:true};
  const original=JSON.stringify(p),m=Save.migrateSave(p,{nowMs:1000});assert.ok(m.ok);assert.equal(JSON.stringify(p),original);
  const out=Save.serialize(Save.deserialize(m.save),1000);assert.equal(out.gold,p.gold);assert.equal(out.shards,p.shards);assert.equal(out.stage,80);assert.deepEqual(out.storySeen,p.storySeen);assert.equal(out.farmMode,true);
 }
 for(const version of [-1,1.2,'7',Infinity,999])assert.equal(Save.migrateSave({version}).ok,false);
});
test('CORS Authorization, bounded daily backups, expiry replay and IP request throttling',async()=>{
 const DB=database(),env={DB,IDLE_NAMESPACE:'test'};
 const pre=await handleIdleSave(new Request('https://test/api/idle/save',{method:'OPTIONS'}),env);assert.equal(pre.status,204);assert.match(pre.headers.get('access-control-allow-headers'),/Authorization/);
 await handleIdleSave(request('saves','POST',write(payload(),0,'create-other')),env,1000);
 let revision=1;
 for(let day=1;day<=5;day++){
  const res=await handleIdleSave(request('save','POST',write(payload(day+1),revision,'day-write-'+day)),env,day*86400000);assert.equal(res.status,200);revision=(await res.json()).revision;
 }
 const old=await handleIdleSave(request('save','POST',write(payload(),1,'expired-old')),env,6*86400000);assert.equal(old.status,409);
 const out=await (await handleIdleSave(request('save'),env,6*86400000)).json();assert.equal(out.backups.filter(b=>b.kind==='normal').length,3);assert.equal(out.backups.filter(b=>b.kind==='conflict').length,1);assert.equal(out.revision,6);
 const persisted=await DB.prepare('SELECT code_hash FROM idle_saves').bind().first();assert.notEqual(persisted.code_hash,code);assert.equal(persisted.code_hash.length,64);
 for(let i=0;i<121;i++){
  const r=await handleIdleSave(request('save'),env,7*86400000);
  if(i===120)assert.equal(r.status,429);
 }
});

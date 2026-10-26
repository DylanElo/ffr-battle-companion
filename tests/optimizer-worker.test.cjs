const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/optimizer-worker.js'),'utf8');

async function run({party=[1,2,3,4],invalid=[],partySize=4}={}){
  const messages=[],compared=[];
  const model={
    evaluate:({characterId})=>({valid:!invalid.includes(characterId),damage:10}),
    evaluateParty:members=>{compared.push(members.map(m=>m.characterId));return {damage:members.length*10};},
    explainAbilities:()=>[]
  };
  const context={importScripts:()=>{},performance:{now:()=>0},
    fetch:async()=>({ok:true,json:async()=>({})}),self:{postMessage:message=>messages.push(message)},
    CompanionBattle:{createModel:()=>model},CompanionSearch:{rankParties:()=>({results:[{
      members:[{characterId:1,equipment:{},evaluation:{remainingMp:99,mpExhaustedRounds:[5]}}],
      evaluation:{mpExhaustedRounds:{1:[3,4,5]},remainingMp:{1:0}}
    }]})}
  };
  vm.runInNewContext(source,context);
  await context.self.onmessage({data:{id:1,catalog:{enemies:[{id:1}]},snapshot:{party,characters:[1,2,3,4].map(id=>({id,equipment:{visionId:-1}}))},enemyId:1,options:{partySize}}});
  const result=messages.find(message=>message.type==='result');
  assert.ok(result,JSON.stringify(messages));
  return {result:result.result,compared};
}

test('worker never compares a partially evaluable saved party against a complete recommendation',async()=>{
  const {result,compared}=await run({invalid:[3]});
  assert.equal(result.current,null);
  assert.equal(compared.length,0);
});

test('worker requires the requested saved party size and unique members for before/after',async()=>{
  for(const party of [[1,2,3],[1,2,3,3]]){
    const {result}=await run({party});
    assert.equal(result.current,null);
  }
  const {result}=await run({party:[1,2],partySize:2});
  assert.equal(result.current.damage,20);
});

test('worker compares all valid saved members and keeps party MP results including zero',async()=>{
  const {result,compared}=await run();
  assert.equal(result.current.damage,40);
  assert.equal(JSON.stringify(compared),JSON.stringify([[1,2,3,4]]));
  const member=result.results[0].members[0];
  assert.equal(member.evaluation.remainingMp,0);
  assert.equal(JSON.stringify(member.evaluation.mpExhaustedRounds),JSON.stringify([3,4,5]));
});

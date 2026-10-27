const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/optimizer-worker.js'),'utf8');

async function run({party=[1,2,3,4],invalid=[],partySize=4,partyState={}}={}){
  const messages=[],compared=[];
  const model={
    evaluate:({characterId})=>({valid:!invalid.includes(characterId),damage:10}),
    evaluateParty:members=>{compared.push(members.map(m=>m.characterId));return {damage:members.length*10};},
    explainAbilities:()=>[]
  };
  const context={importScripts:()=>{},performance:{now:()=>0},
    fetch:async()=>({ok:true,json:async()=>({})}),self:{postMessage:message=>messages.push(message)},
    CompanionBattle:{createModel:()=>model},CompanionSearch:{rankParties:()=>({results:[{
      members:[{characterId:1,equipment:{},evaluation:{remainingMp:99,remainingHp:100,mpExhaustedRounds:[5],common:{attack:77},damage:10,resourceEvents:[{round:1,skillId:1}],stateLeafResults:[{skillId:1}],overheat:true,demonForm:true}}],
      evaluation:{mpExhaustedRounds:{1:[3,4,5]},remainingMp:{1:0},...partyState}
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


test('party resource outputs update both displayed and explanation state while preserving reference formula inputs',async()=>{
 const partyState={gambleSamples:32,sampleKind:'native-initiative-and-gamble',initiativeSamples:32,remainingHp:{1:0},hpSpent:{1:100},resourceSkips:{1:[{round:4,reason:'HP'}]},stateLeafResults:{1:[{skillId:2,damage:7}]},
 resourceEvents:{1:[{round:2,kind:'incoming',damage:100}]},remainingGoodLuck:{1:0},overclockCharges:{1:0},overclockStates:{1:[]},overheat:{1:false},demonForm:{1:false},
 actionOverrides:{1:{damage:5}},limitUses:{1:[{round:3,skillId:9}]}};
 const {result}=await run({partyState}),member=result.results[0].members[0];
 for(const key of ['remainingHp','hpSpent','resourceSkips','stateLeafResults','resourceEvents','remainingGoodLuck','overclockCharges','overclockStates','overheat','demonForm']){
  assert.equal(JSON.stringify(member.evaluation[key]),JSON.stringify(partyState[key][1]),key);
  assert.equal(JSON.stringify(member.explanationEvaluation[key]),JSON.stringify(partyState[key][1]),key);
 }
 for(const key of ['gambleSamples','sampleKind','initiativeSamples']){assert.equal(member.evaluation[key],partyState[key]);assert.equal(member.explanationEvaluation[key],partyState[key]);}
 assert.equal(member.explanationEvaluation.remainingMp,0);
 assert.equal(member.evaluation.damage,5);assert.equal(member.explanationEvaluation.damage,10);
 assert.equal(member.evaluation.common.attack,77);assert.equal(member.explanationEvaluation.common.attack,77);
 assert.equal(JSON.stringify(member.explanationEvaluation.leafResults),JSON.stringify(partyState.stateLeafResults[1]));
 assert.equal(JSON.stringify(member.explanationEvaluation.limitUses),JSON.stringify(partyState.limitUses[1]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const plan={maxHp:100,turn:{steps:[{skillId:1}]}};
test('worker maps party phases and representative resources to both output evaluations and preserves scalar reference inputs',async()=>{
 const partyState={extraActions:{1:0},expectedExtraActions:{1:1.25},phaseEvents:{1:[{round:1,phase:'additional',kind:'actor-finished',paid:false}]},combatSamples:32,gambleSamples:32,initiativeSamples:32,sampleKind:'native-initiative-and-combat',remainingMp:{1:0},resourceEvents:{1:[{phase:'additional',mpCost:10}]},actionOverrides:{1:{damage:80,common:{attack:999}}}};
 const member={characterId:1,evaluation:{valid:true,damage:10,common:{attack:77},extraActions:99,fallbackActionPlan:plan}};
 const messages=[],model={evaluate:()=>member.evaluation,evaluateParty:()=>({}),explainAbilities:()=>[]};
 const context={importScripts(){},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),CompanionBattle:{createModel:()=>model},CompanionSearch:{rankParties:()=>({results:[{members:[member],evaluation:partyState}]})},self:{postMessage:v=>messages.push(v)}};
 vm.runInNewContext(fs.readFileSync(new URL('../docs/optimizer-worker.js',import.meta.url),'utf8'),context);
 await context.self.onmessage({data:{id:1,catalog:{enemies:[{id:1}]},snapshot:{party:[1],characters:[{id:1,equipment:{}}]},enemyId:1,options:{partySize:1}}});
 const result=messages.find(m=>m.type==='result').result.results[0].members[0];
 for(const field of ['evaluation','explanationEvaluation']){
  for(const key of ['extraActions','expectedExtraActions','phaseEvents','remainingMp','resourceEvents'])assert.equal(JSON.stringify(result[field][key]),JSON.stringify(partyState[key][1]),`${field}.${key}`);
  assert.equal(result[field].combatSamples,32);assert.equal(result[field].sampleKind,'native-initiative-and-combat');
 }
 assert.equal(result.evaluation.damage,80);assert.equal(result.explanationEvaluation.damage,10);
 assert.equal(result.explanationEvaluation.common.attack,77);assert.equal(result.explanationEvaluation.fallbackActionPlan,plan);
});

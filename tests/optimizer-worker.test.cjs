const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/optimizer-worker.js'),'utf8');

test('single worker checkpoints only improving owned, unreserved completed candidates without extra evaluations',async()=>{
  const messages=[];let evaluated=0,modelOptions;
  const model={evaluate:()=>{evaluated++;return {valid:true};},explainAbilities:()=>[],
    scenario:{rounds:5},evidence:{formula:'Native arithmetic'},globalWarnings:['Known limitation']};
  const candidates=[
    {visionId:100,score:10},{visionId:101,score:500},{visionId:999,score:1000},
    {visionId:100,score:9},{visionId:100,score:10},{visionId:100,score:10,cost:5},{visionId:102,score:11},
    {visionId:102,score:NaN},{visionId:-1,score:12},
  ].map(row=>({...row,characterId:1,equipment:{weaponId:10,accessoryIds:[]},evaluation:{valid:true,skillCost:row.cost ?? 10,skillId:1,equippedSkillIds:[5],warnings:['Known limitation','Local warning']}}));
  const context={importScripts:()=>{},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),
    self:{postMessage:message=>messages.push(message)},CompanionBattle:{createModel:(c,s,e,options)=>{modelOptions=options;return model;}},
    CompanionSearch:{compareCandidates:require('../docs/search.js').compareCandidates,buildCandidates:(c,s,id,callbacks)=>{
      assert.equal(modelOptions.deadline-callbacks.options.deadline,1000,'Reserve completion time inside the original budget');
      for(const candidate of candidates){callbacks.candidate(candidate);assert.equal(evaluated,0,'A checkpoint cannot trigger another model evaluation');}
      return [];
    },finalizeBuilds:()=>[]}};
  vm.runInNewContext(source,context);
  await context.self.onmessage({data:{id:77,mode:'single',catalog:{enemies:[{id:1}]},
    snapshot:{characters:[{id:1,equipment:{visionId:100}}],resonances:[{id:100},{id:101},{id:102}]},
    characterId:1,enemyId:1,taken:[101],available:[],options:{timeMs:8000}}});
  const checkpoints=messages.filter(message=>message.type==='checkpoint');
  assert.deepEqual(checkpoints.map(message=>message.result.results[0].score),[10,10,11,12]);
  assert.deepEqual(checkpoints.map(message=>message.result.results[0].visionId),[100,100,102,-1]);
  assert.equal(checkpoints[1].result.results[0].evaluation.skillCost,5);
  assert.equal(checkpoints.every(message=>message.id===77),true);
  assert.equal(checkpoints[0].result.before,null);
  assert.equal(checkpoints[0].result.current,null);
  assert.equal(checkpoints[0].result.scenario,model.scenario);
  assert.equal(checkpoints[0].result.modelEvidence,model.evidence);
  assert.equal(JSON.stringify(checkpoints[0].result.results[0].evaluation.warnings),JSON.stringify(['Known limitation','Local warning']));
  assert.equal(evaluated,1,'Only the existing saved-setup comparison evaluates after searching');
  assert.equal(modelOptions.includeSupportOptions,true);
  assert.equal(modelOptions.fillAbilitySlots,true);
});

test('search publishes a candidate checkpoint only after its evaluation passed validation',()=>{
  const Search=require('../docs/search.js'),seen=[];
  const catalog={characters:[{id:1,sex:'Male',weaponType:'Sword',armorTypes:[]}],equipment:[],visions:[{id:100},{id:101}]};
  const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,equipment:{weaponId:-1,armorId:-1,accessoryIds:[],visionId:100}}],
    inventory:[],resonances:[{id:100},{id:101}],party:[1]};
  const options={timeMs:0,maxEvaluations:2,perLoadoutBudget:1,visionIds:[100,101]};
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({visionId})=>visionId===100?{valid:false,score:100}:{valid:true,score:3},
    candidate:member=>{assert.equal(member.evaluation.valid,true);assert.ok(Number.isFinite(member.score));seen.push(member);}},options);
  assert.equal(seen.length,1);
  assert.equal(seen[0].visionId,101);
  assert.equal(results.length,1);
  assert.equal(results[0],seen[0]);
});

test('single worker completes equipment alternatives before ranking and deduplicating attacks',async()=>{
  const messages=[],finalized=[];
  const candidates=[{visionId:100,equipment:{weaponId:10},score:100,evaluation:{skillId:1}},
    {visionId:100,equipment:{weaponId:11},score:99,evaluation:{skillId:1}},
    {visionId:101,equipment:{weaponId:10},score:98,evaluation:{skillId:1}}];
  const context={importScripts:()=>{},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),
    self:{postMessage:m=>messages.push(m)},CompanionBattle:{GENERAL_ENEMY_ID:'general',createModel:()=>({evaluate:()=>({valid:true}),explainAbilities:()=>[],
      scenario:{rounds:7},evidence:{formula:'Native arithmetic'},globalWarnings:['Active artifact effects are not modeled.']})},
    CompanionSearch:{compareCandidates:require('../docs/search.js').compareCandidates,buildCandidates:()=>candidates,finalizeBuilds:(c,s,[x])=>{
      finalized.push(x.equipment.weaponId);return [{...x,score:x.equipment.weaponId===11?199:x.score}];
    }}};
  vm.runInNewContext(source,context);
  await context.self.onmessage({data:{id:1,mode:'single',catalog:{enemies:[{id:1}]},
    snapshot:{characters:[{id:1,equipment:{visionId:100}}]},characterId:1,enemyId:1,available:[],options:{}}});
  const response=messages.find(m=>m.type==='result').result, rows=response.results;
  assert.ok(finalized.includes(11));
  assert.equal(rows[0].equipment.weaponId,11);
  assert.equal(rows[0].score,199);
  assert.equal(rows.filter(c=>c.visionId===100 && c.evaluation.skillId===1).length,1);
  assert.equal(response.scenario.rounds,7);
  assert.equal(response.modelEvidence.formula,'Native arithmetic');
  assert.ok(rows[0].evaluation.warnings.includes('Active artifact effects are not modeled.'));
});

test('single worker compares the pre-Build draft with its exact fixed abilities under the same model',async()=>{
  const messages=[],evaluated=[];
  const model={evaluate:args=>{evaluated.push(args);return {valid:true,damage:args.equipment.weaponId};},explainAbilities:()=>[]};
  const context={importScripts:()=>{},performance:{now:()=>0},fetch:async()=>({ok:true,json:async()=>({})}),
    self:{postMessage:m=>messages.push(m)},CompanionBattle:{createModel:()=>model},
    CompanionSearch:{compareCandidates:require('../docs/search.js').compareCandidates,buildCandidates:()=>[],finalizeBuilds:()=>[]}};
  vm.runInNewContext(source,context);
  const baseline={weaponId:77,visionId:100,accessoryIds:[3],equippedSkillIds:[8,9]};
  await context.self.onmessage({data:{id:1,mode:'single',catalog:{enemies:[{id:1}]},
    snapshot:{characters:[{id:1,equipment:{weaponId:10,visionId:100}}]},characterId:1,enemyId:1,available:[],baseline,options:{goals:['stagger']}}});
  const result=messages.find(m=>m.type==='result').result;
  assert.equal(result.before.damage,77); assert.equal(result.current.damage,10);
  const call=evaluated.find(args=>args.equipment.weaponId===77);
  assert.equal(call.current,true); assert.deepEqual(call.equippedSkillIds,[8,9]);
  assert.equal(call.equipment,baseline);
});

test('unlock worker routes an isolated preview without invoking the ordinary build search',async()=>{
  const messages=[],build={visionId:100,weaponId:10},snapshot={characters:[]},catalog={enemies:[{id:1}]};
  const output={results:[{required:95}],checked:1,total:1};
  const context={importScripts:()=>{},fetch:async()=>({ok:true,json:async()=>({})}),self:{postMessage:m=>messages.push(m)},
    Companion:{},CompanionStats:{},CompanionBattle:{},CompanionUnlocks:{recommend:(c,s,id,b,e,options,deps,progress)=>{
      assert.equal(c,catalog);assert.equal(s,snapshot);assert.equal(b,build);assert.equal(id,1001);assert.equal(e.id,1);
      assert.equal(options.goals[0],'stagger');assert.equal(deps.core,context.Companion);
      progress('Checking one milestone');return output;
    }}};
  vm.runInNewContext(source,context);
  await context.self.onmessage({data:{id:7,mode:'unlocks',catalog,snapshot,characterId:1001,build,enemyId:1,options:{goals:['stagger']}}});
  assert.equal(messages.find(m=>m.type==='result').result,output);
  assert.equal(messages.find(m=>m.type==='progress').message,'Checking one milestone');
});

async function run({party=[1,2,3,4],invalid=[],partySize=4,partyState={}}={}){
  const messages=[],compared=[];
  const model={
    evaluate:({characterId})=>({valid:!invalid.includes(characterId),damage:10}),
    evaluateParty:members=>{compared.push(members.map(m=>m.characterId));return {damage:members.length*10};},
    explainAbilities:()=>[]
  };
  const context={importScripts:()=>{},performance:{now:()=>0},
    fetch:async()=>({ok:true,json:async()=>({})}),self:{postMessage:message=>messages.push(message)},
    CompanionBattle:{createModel:()=>model},CompanionSearch:{compareCandidates:require('../docs/search.js').compareCandidates,rankParties:()=>({results:[{
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

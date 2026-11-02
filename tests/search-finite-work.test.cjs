const test=require('node:test');
const assert=require('node:assert/strict');
const Search=require('../docs/search.js');

function fixture(){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[-1],visionId:100};
  return {catalog:{characters:[{id:1,name:'One',sex:'Male',weaponType:'Sword',armorTypes:[]}],visions:[{id:100}],
    equipment:[{id:10,type:'Accessory',detailType:'None',sexLimit:'None',stats:{Attack:1},passiveIds:[]}]},
    snapshot:{characters:[{id:1,joinStatus:'Join',usable:true,equipment}],inventory:[{id:10,quantity:1}],resonances:[{id:100}],party:[1]}};
}

function clocked(step,run){
  const original=Date.now;let clock=0;
  try{Date.now=()=>clock;return run(()=>{clock+=step;});}finally{Date.now=original;}
}

test('finite candidate work is identical with a stationary or arbitrarily slow clock',()=>{
  const run=step=>clocked(step,tick=>{
    const f=fixture(),calls=[],checkpoints=[];
    const results=Search.buildCandidates(f.catalog,f.snapshot,1,{evaluate:args=>{
      tick();calls.push(args.equipment.accessoryIds.slice());
      assert.equal(args.evaluationTimeMs,undefined);
      return {valid:true,score:args.equipment.accessoryIds.includes(10)?10:1};
    },candidate:candidate=>checkpoints.push(candidate.score)},
    {visionIds:[100],maxEvaluations:2,perLoadoutBudget:20,candidatesPerVision:2,timeMs:1,deadline:0,evaluationTimeMs:1,seedEvaluationTimeMs:1});
    assert.equal(calls.length,2);
    return {calls,checkpoints,results};
  });
  assert.deepEqual(run(0),run(1000000));
});

test('baseline gear gets a finite four-trial ability seed without limiting ordinary evaluations',()=>{
  const f=fixture(),calls=[];
  f.catalog.equipment.push({...f.catalog.equipment[0],id:11,stats:{Attack:2}});
  f.snapshot.inventory.push({id:11,quantity:1});
  Search.buildCandidates(f.catalog,f.snapshot,1,{evaluate:args=>{calls.push(args);return {valid:true,score:1};}},
    {visionIds:[100],maxEvaluations:4,perLoadoutBudget:20,jointAbilityBudget:64});
  assert.ok(calls.some(args=>args.jointAbilityBudget===4));
  assert.ok(calls.some(args=>args.jointAbilityBudget===undefined));
  assert.ok(calls.every(args=>args.options.jointAbilityBudget===64));
});

test('party scoring and all member refinement run after obsolete elapsed cutoffs without forwarding a deadline',()=>clocked(1000000,tick=>{
  const f=fixture(),refined=[],scored=[];
  const evaluation={valid:true,score:1,equippedSkillIds:[],turn:{leaves:[],steps:[]}};
  const result=Search.rankParties(f.catalog,f.snapshot,{
    options:{partySize:1,fixedCharacterIds:[1],maxResults:1,maxEvaluations:10,perLoadoutBudget:1,jointOptimization:true,timeMs:1,partyTimeMs:1,deadline:0},
    evaluate:()=>{tick();return evaluation;},
    refine:args=>{tick();refined.push(args.characterId);assert.equal(args.evaluationTimeMs,undefined);return evaluation;},
    evaluateParty:(members,args)=>{tick();assert.equal(args.deadline,undefined);scored.push(args.samples);return {score:1};}
  });
  assert.deepEqual(refined,[1]);
  assert.ok(scored.length>1);
  assert.equal(result.results.length,1);
  assert.ok(result.evaluations<=10);
  assert.ok(result.reasons.every(reason=>!reason.includes('time')));
}));

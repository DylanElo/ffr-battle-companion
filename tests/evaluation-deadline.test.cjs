const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const P=require('../docs/passives.js');
const C=require('../docs/core.js');
const native=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture(){
  const character={id:1,name:'Deadline fixture',sex:'Male',weaponType:'Sword',armorTypes:['Light'],levelParamId:1,
    stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50},baseSkillEquipCost:100,passiveIds:[]};
  const equipment={weaponId:10,armorId:-1,accessoryIds:[],visionId:-1};
  const skills=[401010,220010,220040].map(id=>({...native.skills.find(skill=>skill.id===id),cost:0}));
  const catalog={...native,skillRules:rules,characters:[character],skills,visions:[],masterSkills:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},
    equipment:[{id:10,name:'Owned sword',type:'Weapon',detailType:'Sword',sexLimit:'None',stats:{PhysicalAttack:5},passiveIds:[]}]};
  const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:skills.map(skill=>skill.id),equippedSkillIds:Array(8).fill(-1),equipment}],
    inventory:[{id:10,quantity:1}],resonances:[],party:[1],player:{difficulty:'Normal'}};
  const enemy={id:999,name:'Deadline target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[]};
  return {catalog,snapshot,enemy,input:{characterId:1,visionId:-1,equipment}};
}

function withClock(fn){
  const original=Date.now;let clock=0;
  try{Date.now=()=>++clock;return fn(()=>clock);}finally{Date.now=original;}
}

test('elapsed clock changes and obsolete deadlines do not truncate a complete legal evaluation',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),before=JSON.stringify(snapshot);
  const options={goals:['damage'],includeSupportOptions:false,rounds:1};
  const full=B.createModel(catalog,snapshot,enemy,options).evaluate(input);
  const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{...options,deadline:0,evaluationTimeMs:1}).evaluate({...input,evaluationTimeMs:1}));
  assert.equal(result.valid,true);
  assert.deepEqual(result,full);
  assert.ok(result.skillCost<=result.skillBudget);
  assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
  assert.equal(C.validPlan(catalog,snapshot,1,input.equipment),'');
  assert.equal(result.stats.PhysicalAttack,105);
  assert.equal(result.searchTruncated,undefined);
  assert.equal(JSON.stringify(snapshot),before);
});

test('an obsolete expired deadline still evaluates candidates',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),original=P.analyze;
  let calls=0;
  try{
    P.analyze=(...args)=>{calls++;return original(...args);};
    const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false,rounds:1,deadline:-1}).evaluate(input));
    assert.equal(result.valid,true);
    assert.ok(calls>0);
    assert.equal(result.searchTruncated,undefined);
  }finally{P.analyze=original;}
});

test('joint ability refinement remains finite by its combination allowance, independent of elapsed time',()=>{
  const {catalog,snapshot,enemy,input}=fixture();
  const passive=native.passives.find(row=>row.id===1310);
  const additions=Array.from({length:6},(_,n)=>({...passive,id:50001+n,equipCost:1}));
  catalog.passives=[...catalog.passives,...additions];
  catalog.statGrowth[1].rows[0].skillIds=additions.map(row=>row.id);
  const options={goals:['damage'],includeSupportOptions:false,rounds:1,jointOptimization:true,jointAbilityBudget:3};
  const full=B.createModel(catalog,snapshot,enemy,options).evaluate(input);
  const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{...options,deadline:0,evaluationTimeMs:1}).evaluate(input));
  assert.equal(result.valid,true);
  assert.deepEqual(result,full);
  assert.ok(result.jointAbilityEvaluations<=3);
  assert.equal(result.jointSearchTruncated,true);
  assert.equal(result.searchTruncated,undefined);
});

test('party support comparisons complete with expired legacy deadlines and a rapidly advancing clock',()=>{
  const {catalog,snapshot,enemy,input}=fixture();
  const support=native.skills.find(skill=>skill.id===230110);
  catalog.skills.push(support);
  catalog.characters.push({...catalog.characters[0],id:2,name:'Support recipient'});
  snapshot.characters[0].activeSkillIds.push(support.id);
  snapshot.characters.push({...snapshot.characters[0],id:2,activeSkillIds:[220010],equipment:{...input.equipment}});
  snapshot.inventory[0].quantity=2;
  snapshot.party=[1,2];
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
  const members=[1,2].map(characterId=>({...input,characterId,evaluation:model.evaluate({...input,characterId})}));
  assert.ok(members.every(member=>member.evaluation.valid));
  assert.ok(members[0].evaluation.supportActions.some(action=>action.skillId===support.id));
  const full=model.evaluateParty(members);
  const result=withClock(()=>model.evaluateParty(members,{deadline:0}));
  assert.deepEqual(result,full);
  assert.equal(result.supportSearchTruncated,false);
  assert.ok(Number.isFinite(result.score));
});

test('real evaluator failures propagate even with obsolete expired deadline options',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),original=P.analyze,error=new Error('Deliberate native-model failure');
  try{
    P.analyze=()=>{throw error;};
    assert.throws(()=>withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],deadline:0,evaluationTimeMs:1}).evaluate(input)),caught=>caught===error);
  }finally{P.analyze=original;}
});

test('knapsack stops inside a wide DP expansion and retains an affordable completed state',()=>{
  const entries=Array.from({length:180},(_,n)=>({id:n+1,cost:n+1,value:n+1}));
  let checks=0;
  const selected=B.knapsack(entries,1000,8,()=>++checks>15);
  assert.ok(checks<=17,'the DP stops cooperatively instead of scanning the remaining entries');
  assert.ok(selected.length<=8);
  assert.ok(selected.reduce((sum,id)=>sum+id,0)<=1000);
  assert.ok(selected.length>0,'a completed partial DP state is retained');
});

test('already valued legal passive choices survive a cooperative stop before DP expansion starts',()=>{
  assert.deepEqual(B.knapsack([{id:1,cost:3,value:5},{id:2,cost:4,value:7},{id:3,cost:9,value:100}],5,2,()=>true),[2]);
  assert.deepEqual(B.knapsack([{id:1,cost:0,value:5}],5,0,()=>true),[]);
});

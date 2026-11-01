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

test('inner deadline returns a completed legal incumbent with explicit truncation',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),before=JSON.stringify(snapshot);
  const full=B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false,rounds:1}).evaluate(input);
  const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false,rounds:1,deadline:2}).evaluate(input));
  assert.equal(result.valid,true);
  assert.equal(result.searchTruncated,true);
  assert.ok(Number.isFinite(result.score));
  assert.ok(full.score>=result.score);
  assert.ok(result.skillCost<=result.skillBudget);
  assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
  assert.equal(C.validPlan(catalog,snapshot,1,input.equipment),'');
  assert.equal(result.stats.PhysicalAttack,105,'The complete owned loadout remains intact');
  assert.ok(result.warnings.some(warning=>/best completed legal build/.test(warning)));
  assert.equal(JSON.stringify(snapshot),before);
});

test('an already expired deadline runs no candidate analysis or extra recipes',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),original=P.analyze;
  let calls=0;
  try{
    P.analyze=()=>{calls++;throw Error('Expired search must not evaluate a candidate');};
    const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],deadline:0}).evaluate(input));
    assert.equal(result.valid,false);
    assert.match(result.reason,/search time ended/);
    assert.equal(calls,0);
  }finally{P.analyze=original;}
});

test('a per-evaluation subdeadline returns a legal incumbent before the shared deadline',()=>{
  const {catalog,snapshot,enemy,input}=fixture();
  const result=withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false,rounds:1,deadline:100,evaluationTimeMs:2}).evaluate(input));
  assert.equal(result.valid,true);
  assert.equal(result.searchTruncated,true);
  assert.ok(result.skillCost<=result.skillBudget);
  assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
  assert.equal(C.validPlan(catalog,snapshot,1,input.equipment),'');
  assert.ok(Number.isFinite(result.score));
});

test('real evaluator failures are not swallowed as deadline truncation',()=>{
  const {catalog,snapshot,enemy,input}=fixture(),original=P.analyze,error=new Error('Deliberate native-model failure');
  try{
    P.analyze=()=>{throw error;};
    assert.throws(()=>withClock(()=>B.createModel(catalog,snapshot,enemy,{goals:['damage'],deadline:100,evaluationTimeMs:2}).evaluate(input)),caught=>caught===error);
  }finally{P.analyze=original;}
});

test('passive expansion stops inside its package and never caches the partial choice',()=>{
  const {catalog,snapshot,enemy,input}=fixture();
  const passive=native.passives.find(row=>row.id===1310);
  const additions=Array.from({length:24},(_,n)=>({...passive,id:50001+n,equipCost:1}));
  catalog.passives=[...catalog.passives,...additions];
  catalog.statGrowth[1].rows[0].skillIds=additions.map(row=>row.id);
  const originalNow=Date.now,originalAnalyze=P.analyze;
  let clock=0,interrupt=true;
  const visited=new Set();
  try{
    Date.now=()=>clock;
    P.analyze=(catalog,ids,...rest)=>{
      for(const id of ids)if(id>=50001&&id<=50024)visited.add(id);
      if(interrupt && visited.size)clock=1000;
      return originalAnalyze(catalog,ids,...rest);
    };
    const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false,rounds:1,deadline:500});
    const partial=model.evaluate(input);
    assert.equal(partial.valid,true,'first complete legal action survives interrupted package expansion');
    assert.equal(partial.searchTruncated,true);
    assert.equal(visited.size,1,'deadline is checked before expanding the next passive');
    assert.ok(partial.skillCost<=partial.skillBudget);
    assert.ok(partial.equippedSkillIds.length<=partial.maxSkillSlots);
    interrupt=false;clock=0;visited.clear();
    const full=model.evaluate(input);
    assert.equal(full.valid,true);
    assert.ok(visited.size>1,'an interrupted package must not poison the model cache');
    assert.ok(full.score>=partial.score);
  }finally{Date.now=originalNow;P.analyze=originalAnalyze;}
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

test('already valued legal passive choices survive a deadline before DP expansion starts',()=>{
  assert.deepEqual(B.knapsack([{id:1,cost:3,value:5},{id:2,cost:4,value:7},{id:3,cost:9,value:100}],5,2,()=>true),[2]);
  assert.deepEqual(B.knapsack([{id:1,cost:0,value:5}],5,0,()=>true),[]);
});

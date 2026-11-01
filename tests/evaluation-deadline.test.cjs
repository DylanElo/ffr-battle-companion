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

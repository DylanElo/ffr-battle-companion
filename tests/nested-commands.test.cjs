const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const native=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({wrappers=[400650,400730],mp=999,magic=true,skillRules=rules}={}){
  const skill={...native.skills.find(s=>s.name==='Fire'),cost:19,...(!magic?{attr:'Ability',dmgType:'Physic',calcType:'Physic',element:'None'}:{})};
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const catalog={...native,skillRules,characters:[{id:1,name:'Test unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:mp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:250,passiveIds:[]}],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:wrappers}]}},
    visions:[],equipment:[],artifacts:[],masterSkills:[],passives:[],skills:[skill,...wrappers.map(id=>native.skills.find(s=>s.id===id))]};
  const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[skill.id],equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
  const enemy={id:2,name:'Test target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
  return {result:model.evaluate({characterId:1,visionId:-1,equipment}),catalog,skill};
}

test('Arms can preserve two Dualcast children and four repeated spell leaves',()=>{
  const {result,catalog}=fixture();
  assert.equal(result.valid,true);
  assert.equal(result.actionCount,4);
  assert.deepEqual(result.turn.steps.map(step=>step.skillId),[400650,400730,220010,220010,400730,220010,220010]);
  assert.deepEqual(result.turn.leaves.map(leaf=>leaf.actionIndex),[0,1,2,3]);
  assert.equal(result.turnMp,40+4*19);
  assert.deepEqual(result.turn.reservedIds,[400650,400730]);
  assert.equal(result.skillCost,catalog.skills.filter(s=>[400650,400730].includes(s.id)).reduce((sum,s)=>sum+s.equipCost,0));
  assert.equal(result.equippedSkillIds.filter(id=>id===400730).length,1,'the repeated wrapper pays AP once');
});

test('two independent Boost branches use two boosted costs and damage contexts',()=>{
  const {result}=fixture({wrappers:[400650,400660],mp:96});
  assert.equal(result.actionCount,2);
  assert.equal(result.turnMp,96,'40 + trunc(19 × 1.5) twice');
  assert.deepEqual(result.turn.leaves.map(leaf=>leaf.boost),[true,true]);
  assert.deepEqual(result.turn.steps.map(step=>step.skillId),[400650,400660,220010,400660,220010]);
  assert.equal(result.turn.reservedIds.filter(id=>id===400660).length,1);
});

test('one Boost branch does not boost its plain sibling',()=>{
  const mixed=fixture({wrappers:[400650,400660],mp:87}).result;
  const double=fixture({wrappers:[400650,400660],mp:96}).result;
  assert.equal(mixed.actionCount,2);
  assert.equal(mixed.turnMp,87,'40 + trunc(19 × 1.5) + 19');
  assert.equal(mixed.turn.leaves.filter(leaf=>leaf.boost).length,1);
  assert.equal(mixed.turn.leaves.filter(leaf=>leaf.context.activeEffectIds?.includes(12911)).length,1);
  assert.ok(double.damage>mixed.damage);
  const first=mixed.hits.filter(hit=>hit.actionIndex===0).reduce((sum,hit)=>sum+hit.damage,0);
  const second=mixed.hits.filter(hit=>hit.actionIndex===1).reduce((sum,hit)=>sum+hit.damage,0);
  assert.notEqual(first,second,'each leaf rolls its own boost state');
});

test('Arms can nest two Double Actions for four nonmagic attacks',()=>{
  const {result}=fixture({wrappers:[400650,400710],magic:false});
  assert.equal(result.actionCount,4);
  assert.equal(result.turnMp,116);
  assert.deepEqual(result.turn.reservedIds,[400650,400710]);
  assert.equal(result.turn.steps.filter(step=>step.kind==='wrapper').length,3);
});

test('Arms accepts different valid child wrapper types within the MP budget',()=>{
  const {result}=fixture({mp:97});
  assert.equal(result.actionCount,3);
  assert.equal(result.turnMp,97);
  assert.deepEqual(result.turn.steps.filter(step=>step.kind==='wrapper').map(step=>step.skillId),[400650,400730]);
  assert.equal(result.turn.leaves.length,3);
});

test('Magic and damage list predicates prevent recursive wrapper children',()=>{
  const magical=fixture({wrappers:[400730,400710]}).result;
  assert.equal(magical.actionCount,2);
  assert.deepEqual(magical.turn.reservedIds,[400730]);
  assert.equal(magical.turn.steps.filter(step=>step.kind==='wrapper').length,1);
  const physical=fixture({wrappers:[400730,400710,400660],magic:false}).result;
  assert.deepEqual(physical.turn.reservedIds,[400710]);
  assert.equal(physical.actionCount,2);
});

test('native hierarchy exclusions apply to nested leaf actions',()=>{
  const custom=structuredClone(rules);
  custom.general.usableData.push({lockSkills:[220010],lockType:'FoundSkillInHierarchy',hierarchySkills:[400650]});
  const {result}=fixture({skillRules:custom});
  assert.equal(result.actionCount,2,'an Arms ancestor rejects the attack even below Dualcast');
  assert.deepEqual(result.turn.reservedIds,[400730]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../docs/battle.js');
const native = require('../docs/data/catalog.json');

function fixture(equipped = [900002, 900003]) {
  const attack = {...native.skills.find(s => s.id === 401010), id:900001, cost:0, criticalHitRate:0};
  const defense = {id:900002,name:'Equipped defense',equipCost:25,effectBundles:[{effectId:900004,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit',conditionData:{Condition:'None'}}]};
  const unused = {...attack,id:900003,name:'Equipped unused attack',mag:1,equipCost:30};
  const effect = {...native.effects.find(e => e.type === 'ParameterContinuousVariation'),id:900004,params:[50,6,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],condition:{Condition:'None'},activationProbability:100};
  const catalog = {...native,skills:[attack,unused],passives:[defense],effects:[effect],visions:[],masterSkills:[],equipment:[],artifacts:[]};
  const person = {id:1001,experience:0,joinStatus:'Join',usable:true,baseParameters:Array(20).fill(0),activeSkillIds:[attack.id],equippedSkillIds:[...equipped,...Array(8-equipped.length).fill(-1)],equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1,-1],visionId:-1}};
  const snapshot = {characters:[person],inventory:[],resonances:[],party:[person.id],player:{difficulty:'Normal'}};
  const enemy = {id:1,name:'Fixture target',level:1,stats:{MaxHitPoint:10000,MaxBreakPoint:10000,Defence:25,Mind:25},resistances:{},passiveIds:[]};
  return {catalog,snapshot,enemy,input:{characterId:1001,visionId:-1,equipment:person.equipment}};
}

test('current setup preserves equipped defensive passives and unused abilities in AP and slots', () => {
  const {catalog,snapshot,enemy,input} = fixture();
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.deepEqual(result.equippedSkillIds.slice().sort(),[900002,900003]);
  assert.equal(result.skillCost,55);
  assert.ok(result.passiveIds.includes(900002));
  assert.ok(result.passiveAnalysis.applied.some(t=>t.effectId===900004));
});

test('ability explanations hold the rest of the loadout fixed and report zero for an unused option', () => {
  const {catalog,snapshot,enemy,input} = fixture();
  const model = B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const evaluation = model.evaluate({...input,current:true});
  const reasons = model.explainAbilities({...input,evaluation});
  assert.equal(reasons.length,2);
  assert.equal(reasons.find(r=>r.id===900003).damageDelta,0);
  assert.equal(reasons.find(r=>r.id===900003).cost,30);
});

test('removing the last equipped ability does not reuse the unrestricted optimizer cache', () => {
  const {catalog,snapshot,enemy,input} = fixture([900002]);
  catalog.effects = catalog.effects.map(e=>({...e,params:e.params.map((v,i)=>i===1?5:v)}));
  const model = B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const optimized = model.evaluate(input);
  assert.ok(optimized.equippedSkillIds.includes(900002));
  const fixed = model.evaluate({...input,equippedSkillIds:[]});
  assert.deepEqual(fixed.equippedSkillIds,[]);
  assert.ok(fixed.damage<optimized.damage);
});

test('an over-budget current setup is rejected instead of silently dropping equipped abilities', () => {
  const {catalog,snapshot,enemy,input} = fixture();
  catalog.skills = catalog.skills.map(s => s.id===900003?{...s,equipCost:101}:s);
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate({...input,current:true});
  assert.equal(result.valid,false);
});

test('five-round estimates spend MP and report turns the chosen action cannot be paid for', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.skills = [{...catalog.skills[0],cost:15,mag:100}];
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate(input);
  assert.equal(result.valid,true);
  const affordable = Math.min(5,Math.floor(result.availableMp/result.turnMp));
  assert.ok(affordable<5);
  assert.ok(Math.abs(result.fightDamage-result.damage*affordable/5)<1e-8);
  assert.equal(result.mpExhaustedRounds.length,5-affordable);
});

test('party simulation uses the selected support action rather than the caster original stagger', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.skills = [{...catalog.skills[0],dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===230110)];
  const model = B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const receiver = model.evaluate(input);
  receiver.stats = {...receiver.stats,Agility:1};
  const caster = {...receiver,damage:0,brokenDamage:0,breakDamage:10000,stats:{...receiver.stats,Agility:999},supportActions:[{skillId:230110,name:'Faith',kind:'damagePercent',value:100,mpCost:6,rootRelation:'Friendlies',rootTarget:'Single',tests:[{key:'skill.dmgType',value:'Magic'}]}]};
  const party = model.evaluateParty([{characterId:1002,evaluation:caster},{characterId:1001,evaluation:receiver}]);
  assert.ok(party.supportUsed);
  assert.equal(party.firstStagger,0,'support caster never performs the original stagger attack');
  assert.equal(party.breakDamage,receiver.breakDamage);
});

test('fixed loadouts retain an equipped support action even when an attack is selected', () => {
  const {catalog,snapshot,enemy,input} = fixture([230110]);
  catalog.skills = [...catalog.skills,native.skills.find(s=>s.id===230110)];
  catalog.effects = [...native.effects,...catalog.effects];
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.equal(result.skillId,900001);
  assert.ok(result.supportActions.some(a=>a.skillId===230110));
  assert.deepEqual(result.equippedSkillIds,[230110]);
});

test('defense breaks preserve derived enemy defense and existing passive effects', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.skills = [...catalog.skills.map(s=>({...s,mag:1000})),native.skills.find(s=>s.id===230110)];
  enemy.stats = {...enemy.stats,PhysicalDefense:80};
  enemy.passiveIds = [900002];
  const model = B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const receiver = model.evaluate(input);
  receiver.stats = {...receiver.stats,Agility:1};
  const caster = {...receiver,damage:0,brokenDamage:0,breakDamage:0,stats:{...receiver.stats,Agility:999},supportActions:[{skillId:230110,name:'Fixture defense break',kind:'statPercent',parameter:'Defence',value:-50,mpCost:6,rootRelation:'Enemies',rootTarget:'Single',tests:[]}]};
  const party = model.evaluateParty([{characterId:1002,evaluation:caster},{characterId:1001,evaluation:receiver}]);
  // Native per-effect rounding: base DEF25 -12, plus the existing flat50 and derived80 =143.
  const expected = B.createModel(catalog,snapshot,{...enemy,stats:{...enemy.stats,Defence:13}},{goals:['damage']}).evaluate(input);
  assert.ok(party.supportUsed);
  assert.equal(party.roundDamage,expected.damage);
});

test('single-character search can skip optional support abilities while fixed and party loadouts retain them', () => {
  const optional=[400550,400660,230040];
  const {catalog,snapshot,enemy,input}=fixture(optional);
  catalog.skills=[catalog.skills[0],...native.skills.filter(s=>optional.includes(s.id))];
  catalog.effects=[...native.effects,...catalog.effects];
  const single=B.createModel(catalog,snapshot,enemy,{goals:['damage'],includeSupportOptions:false});
  const result=single.evaluate(input);
  assert.equal(result.valid,true);
  assert.equal(result.skillId,900001);
  assert.deepEqual(result.equippedSkillIds,[],'physical attack needs none of the optional support choices');
  const current=single.evaluate({...input,current:true});
  assert.deepEqual(current.equippedSkillIds.slice().sort(),optional.slice().sort(),'recorded abilities stay fixed');
  assert.equal(current.canHeal,true);
  const party=B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate(input);
  assert.equal(party.canHeal,true);
  assert.equal(party.canProtect,true);
});

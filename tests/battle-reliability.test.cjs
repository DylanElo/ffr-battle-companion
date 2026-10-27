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

test('Magic Boost uses native truncation for odd MP costs', () => {
  const {catalog,snapshot,enemy,input} = fixture([400660]);
  catalog.skills = [{...catalog.skills[0],cost:15,mag:100,dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===400660)];
  catalog.effects = native.effects;
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.equal(result.magicBoost,true);
  assert.equal(result.turnMp,22);
});

test('a known support Limit Burst contributes to gauge capacity without becoming a damage option', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.skills = [...catalog.skills,native.skills.find(s=>s.id===403030)];
  snapshot.characters[0].id=1003;
  snapshot.characters[0].activeSkillIds.push(403030);
  input.characterId=1003;
  const result=B.createModel(catalog,snapshot,enemy,{goals:['limit']}).evaluate(input);
  assert.equal(result.valid,true);
  assert.equal(result.limit.max,200);
  assert.deepEqual(result.limit.options,[]);
});

test('Arms Akimbo honors the native forbidden hierarchy instead of doubling a blocked attack', () => {
  const {catalog,snapshot,enemy,input}=fixture([400650]);
  catalog.skills=[{...catalog.skills[0],id:400210},native.skills.find(s=>s.id===400650)];
  catalog.skillRules=require('../docs/skill-rules.json');
  snapshot.characters[0].activeSkillIds=[400210,400650];
  const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.equal(result.skillId,400210);
  assert.equal(result.actionCount,1);
});

test('unverified combined boost and multiple-action turns are excluded rather than multiplied optimistically', () => {
  const {catalog,snapshot,enemy,input}=fixture([400660,400730]);
  catalog.skills=[{...catalog.skills[0],dmgType:'Magic',calcType:'Magic',attr:'Magic',cost:15,mag:100},...native.skills.filter(s=>[400660,400730].includes(s.id))];
  catalog.effects=native.effects;
  catalog.equipment=[{id:900010,type:'Accessory',stats:{MagicPoint:200},passiveIds:[]}];
  input.equipment={...input.equipment,accessoryIds:[900010,-1]};
  const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.equal(result.magicBoost && result.actionCount>1,false);
});

test('Magic Boost cannot be recast as a buff on a different party member', () => {
  const {catalog,snapshot,enemy,input}=fixture([]);
  catalog.skills=[{...catalog.skills[0],dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===400660)];
  catalog.effects=native.effects;
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const receiver=model.evaluate(input);
  receiver.stats={...receiver.stats,Agility:1};
  const support=require('../docs/passives.js').supportActions(catalog,[400660]).buffs;
  const caster={...receiver,damage:0,brokenDamage:0,breakDamage:0,hits:undefined,stats:{...receiver.stats,Agility:999},supportActions:support};
  const party=model.evaluateParty([{characterId:1002,evaluation:caster},{characterId:1001,evaluation:receiver}]);
  assert.equal(party.supportUsed,null);
});

test('a hit becoming staggered retains critical-conditional passive effects', () => {
  const {catalog,snapshot,enemy,input}=fixture([]);
  const passive=native.passives.find(p=>p.effects.includes(12928));
  catalog.passives=[passive];catalog.effects=native.effects;
  catalog.skills=[{...catalog.skills[0],criticalHitRate:100,mag:1000}];
  catalog.equipment=[{id:900011,type:'Accessory',stats:{},passiveIds:[passive.id]}];
  input.equipment={...input.equipment,accessoryIds:[900011,-1]};
  const normal=B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate(input);
  const alreadyBroken=B.createModel(catalog,snapshot,enemy,{goals:['damage'],broken:true}).evaluate(input);
  assert.equal(normal.hits[0].brokenDamage,alreadyBroken.hits[0].damage);
});

test('single-character results never invent four times the character own stagger contribution', () => {
  const {catalog,snapshot,enemy,input}=fixture([]);
  catalog.skills=[{...catalog.skills[0],breakDmg:30}];
  enemy.stats.MaxBreakPoint=100;
  const result=B.createModel(catalog,snapshot,enemy,{goals:['stagger'],rounds:1}).evaluate(input);
  assert.equal(result.firstStagger,0);
  assert.equal(result.fightBreakDamage,30);
});

test('native LB Charge Opener supplies 50 opening gauge independently of Triple Charge', () => {
  const {catalog,snapshot,enemy,input}=fixture([1004,1031]);
  catalog.skills=[...catalog.skills,native.skills.find(s=>s.id===401040)];
  catalog.passives=native.passives.filter(p=>[1004,1031].includes(p.id));
  catalog.effects=native.effects;
  const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1}).evaluate({...input,current:true});
  assert.equal(result.valid,true);
  assert.equal(result.limit.initial,50);
  assert.equal(result.limit.mult,3);
  assert.equal(result.gaugePerRound,0);
  assert.ok(result.limit.effectIds.includes(1014));
});

test('the optimizer can select LB Charge Opener when it enables an earlier damaging LB', () => {
  const {catalog,snapshot,enemy,input}=fixture([1004]);
  catalog.skills=[{...catalog.skills[0],mag:1,breakDmg:100},native.skills.find(s=>s.id===401040)];
  catalog.passives=[native.passives.find(p=>p.id===1004)];catalog.effects=native.effects;
  enemy.stats.MaxBreakPoint=100;
  const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1}).evaluate(input);
  assert.equal(result.valid,true);
  assert.ok(result.equippedSkillIds.includes(1004));
  assert.deepEqual(result.limitUses[0],{round:1,phase:'additional',skillId:401040});
});

test('native higher-stat effects reach the actual attack and target defense inputs', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.passives = [native.passives.find(p=>p.id===1491)];
  catalog.effects = native.effects;
  catalog.equipment = [{id:900009,type:'Accessory',stats:{PhysicalAttack:10,MagicalAttack:300},passiveIds:[1491]}];
  input.equipment = {...input.equipment,accessoryIds:[900009,-1]};
  enemy.stats = {...enemy.stats,PhysicalDefense:80,MagicalDefense:200};
  enemy.passiveIds = [1491];
  const result = B.createModel(catalog,snapshot,enemy,{goals:['damage']}).evaluate(input);
  assert.equal(result.valid,true);
  assert.equal(result.common.attack,Math.max(result.stats.PhysicalAttack,result.stats.MagicalAttack));
  assert.equal(result.common.attackSource,'higher of ATK and MAG');
  assert.equal(result.common.defense,225);
  assert.equal(result.common.defenseSource,'higher of physical and magic');
});

test('party simulation uses the selected support action rather than the caster original stagger', () => {
  const {catalog,snapshot,enemy,input} = fixture([]);
  catalog.skills = [{...catalog.skills[0],dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===230110)];
  const model = B.createModel(catalog,snapshot,enemy,{goals:['damage']});
  const receiver = model.evaluate(input);
  receiver.stats = {...receiver.stats,Agility:1};
  const caster = {...receiver,damage:0,brokenDamage:0,breakDamage:10000,hits:undefined,stats:{...receiver.stats,Agility:999},supportActions:[{skillId:230110,name:'Faith',kind:'damagePercent',value:1000,mpCost:6,rootRelation:'Friendlies',rootTarget:'Single',tests:[{key:'skill.dmgType',value:'Magic'}]}]};
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
  const caster = {...receiver,damage:0,brokenDamage:0,breakDamage:0,hits:undefined,stats:{...receiver.stats,Agility:999},supportActions:[{skillId:230110,name:'Fixture defense break',kind:'statPercent',parameter:'Defence',value:-50,mpCost:6,rootRelation:'Enemies',rootTarget:'Single',tests:[]}]};
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

test('native Group support reaches all compatible later allies, with random order respected',()=>{
  const {catalog,snapshot,enemy,input}=fixture([]);
  catalog.skills=[{...catalog.skills[0],dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===230110)];
  snapshot.characters.push({...snapshot.characters[0],id:1003});
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1});
  const one=model.evaluate(input),two=model.evaluate({...input,characterId:1003});
  one.stats={...one.stats,Agility:1};two.stats={...two.stats,Agility:1};
  const action={skillId:230110,name:'Group fixture',kind:'damagePercent',value:100,mpCost:0,rootRelation:'Friendlies',rootTarget:'Group',tests:[{key:'skill.dmgType',value:'Magic'}]};
  const caster={...one,damage:0,brokenDamage:0,breakDamage:0,hits:[],stats:{...one.stats,Agility:999},supportActions:[action]};
  const members=[{characterId:1002,evaluation:caster},{characterId:1001,equipment:input.equipment,evaluation:one},{characterId:1003,equipment:input.equipment,evaluation:two}];
  const result=model.evaluateParty(members);
  assert.deepEqual(result.supportUsed.targetIds,[1001,1003]);
  assert.equal(result.damage,result.roundDamage);
  caster.stats.Agility=1;one.stats.Agility=999;two.stats.Agility=999;
  assert.equal(model.evaluateParty(members).supportUsed,null,'a slower support caster cannot buff earlier attacks');
});

test('a support caster still receives incoming damage and LB fill after replacing its attack', () => {
  const {catalog,snapshot,enemy,input}=fixture([]);
  catalog.skills=[{...catalog.skills[0],dmgType:'Magic',calcType:'Magic'},native.skills.find(s=>s.id===230110)];
  catalog.characters=catalog.characters.map(c=>c.id===1002?{...c,stats:{...c.stats,Agility:999}}:c);
  snapshot.characters.push({...snapshot.characters[0],id:1002});
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,incomingDamage:10});
  const receiver=model.evaluate(input),own=model.evaluate({...input,characterId:1002});
  const caster={...own,damage:0,brokenDamage:0,breakDamage:0,hits:[],stats:{...own.stats,Agility:999},supportActions:[{skillId:230110,name:'Faith',kind:'damagePercent',value:1000,mpCost:6,rootRelation:'Friendlies',rootTarget:'Single',tests:[{key:'skill.dmgType',value:'Magic'}]}]};
  caster.limit={max:100,initial:0,mult:1,fillOnStagger:0,recuperate:0,options:[]};
  const party=model.evaluateParty([{characterId:1002,equipment:input.equipment,evaluation:caster},{characterId:1001,equipment:input.equipment,evaluation:receiver}]);
  assert.ok(party.supportUsed);
  assert.equal(party.remainingHp[1002],own.stats.MaxHitPoint-10);
  assert.ok(party.resourceEvents[1002].some(event=>event.kind==='incoming' && event.damage===10));
  const expected=require('../docs/damage.js').damageTakenLb(10,own.stats.MaxHitPoint,own.stats.MaxHitPoint,50);
  assert.equal(party.gauge[1002],expected);
});

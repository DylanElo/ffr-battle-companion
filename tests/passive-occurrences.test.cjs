const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const S=require('../docs/stats.js');
const P=require('../docs/passives.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture(accessoryIds=[12056],equippedSkillIds=[1312700]){
  const native={...source.characters.find(c=>c.id===1008),baseSkillEquipCost:1000};
  const skill={...source.skills.find(s=>s.id===220340),cost:0,accuracy:100};
  // Isolate the captured shared1310 source; unrelated Spirit bonuses have their own native regressions.
  const spirit=source.masterSkills.find(m=>m.id===1312700);
  const catalog={...source,characters:[native],skills:[skill],masterSkills:[{...spirit,grants:{...spirit.grants,passiveIds:[1310]}}],
    visions:source.visions.filter(v=>v.id===13127),skillRules:rules};
  const equipment={weaponId:-1,armorId:-1,accessoryIds,visionId:-1};
  const snapshot={characters:[{id:1008,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    equippedSkillIds,activeSkillIds:[220340],equipment}],inventory:[{id:12056,quantity:2}],
    resonances:[{id:13127,awakeningPoints:0,sync:[{characterId:1008,points:4195}]}],player:{difficulty:'Normal'},artifactOverrides:[]};
  const enemy={id:999,name:'Fixture target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Mind:50,Defence:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  return {catalog,snapshot,enemy,input:{characterId:1008,visionId:-1,equipment,equippedSkillIds}};
}

test('fixed Moonlight Ring plus Spirit preserves two native magic damage instances through live simulation',()=>{
  const {catalog,snapshot,enemy,input}=fixture();
  const model=B.createModel(catalog,snapshot,enemy,{objective:'damage',difficulty:'Normal',incomingDamage:1,rounds:2,includeSupportOptions:false});
  const result=model.evaluate(input);
  assert.equal(result.valid,true,JSON.stringify(result));
  assert.equal(result.passiveAnalysis.damageFactor,1.2);
  assert.equal(result.passiveAnalysis.applied.filter(t=>t.effectId===16011).length,2);
  assert.deepEqual(result.equippedSkillIds,[1312700]);
  assert.equal(result.skillCost,95);
  assert.ok(result.actionPlan,'Incoming damage forces live-state recalculation');
  const attacks=result.stateLeafResults.filter(row=>row.skillId===220340);
  assert.ok(attacks.length);
  assert.ok(attacks.every(row=>row.common.outgoingFactor===1.2));
  const party=model.evaluateParty([{characterId:1008,equipment:input.equipment,evaluation:result}]);
  const partyAttacks=party.stateLeafResults[1008].filter(row=>row.skillId===220340);
  assert.ok(partyAttacks.length);
  assert.ok(partyAttacks.every(row=>row.common.outgoingFactor===1.2));
});

test('occurrences replace semantic references and never enable unverified effect-type stacking',()=>{
  const skill=source.skills.find(s=>s.id===220340);
  assert.equal(P.analyze(source,[1310,1310],{skill,passiveIdOccurrences:[1310]}).damageFactor,1.1);
  assert.equal(P.analyze(source,[1310],{skill,passiveIdOccurrences:[1310,1310]}).damageFactor,1.2);
  assert.equal(P.analyze(source,[1310],{skill,passiveIdOccurrences:[]}).damageFactor,1);
  const hpPassive=source.passives.find(p=>p.effects.includes(16301)).id;
  const hp=P.analyze(source,[hpPassive],{passiveIdOccurrences:[hpPassive,hpPassive]});
  assert.equal(hp.modifiers.statPercent.HitPoint,10);
  assert.match(hp.deferred[0].reason,/identical-effect stacking has not been verified/);
});

test('source collector counts gear slots and unique equipped Spirits, keeping innate and grant references unique',()=>{
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[12056,12056]};
  const copies=S.passiveIdOccurrences(source,[1310,1310],equipment,[1312700,1312700]);
  assert.equal(copies.filter(id=>id===1310).length,4,'One conservative innate/grant reference, two rings, one Spirit');
  assert.equal(copies.filter(id=>id===1370).length,1);
});

test('multiple physical slots preserve counts without multiplying selected ability cost or cache state',()=>{
  const {catalog,snapshot,enemy,input}=fixture([12056,12056],[1312700,1312700]);
  const model=B.createModel(catalog,snapshot,enemy,{objective:'damage',difficulty:'Normal',incomingDamage:1,rounds:1,includeSupportOptions:false});
  const two=model.evaluate(input);
  assert.equal(two.valid,true);
  assert.equal(two.passiveAnalysis.damageFactor,1.3);
  assert.equal(two.skillCost,95);
  assert.deepEqual(two.equippedSkillIds,[1312700]);
  const one=model.evaluate({...input,equipment:{...input.equipment,accessoryIds:[12056]}});
  assert.equal(one.passiveAnalysis.damageFactor,1.2);
  assert.equal(model.evaluate(input).passiveAnalysis.damageFactor,1.3);
  assert.ok(two.stateLeafResults.filter(row=>row.skillId===220340).every(row=>row.common.outgoingFactor===1.3));
  const statsTwo=S.buildStats(catalog,snapshot,1008,{...input.equipment,equippedSkillIds:[1312700]});
  assert.equal(statsTwo.passiveAnalysis.deferred.filter(t=>t.effectId===16011).length,3,'No damage type is invented in the stats editor');
  const statsOne=S.buildStats(catalog,snapshot,1008,{...input.equipment,accessoryIds:[12056],equippedSkillIds:[1312700]});
  assert.equal(statsOne.passiveAnalysis.deferred.filter(t=>t.effectId===16011).length,2);
});

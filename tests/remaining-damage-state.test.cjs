const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const B=require('../docs/battle.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const honing=require('./fixtures/native-honing.json');
const catalog={...source,skillRules:rules};
const attack=source.skills.find(row=>row.id===401010);
const base={skill:attack,hpPercent:100,mpPercent:100,lbPercent:0,critical:false};

test('Honing Sense matches native getters and the exact nine configured Meikyo skill IDs',()=>{
  assert.equal(rules.general.meikyoIds.length,9);
  for(const row of honing.getterVectors){
    const result=P.analyze(catalog,[1507],{...base,skill:source.skills.find(skill=>skill.id===row.skill),round:1});
    const actual=row.kind==='damage'?result.damageFactor-1:result.modifiers.critRatePercent;
    assert.ok(Math.abs(actual-row.nativeValue)<1e-12,JSON.stringify(row));
  }
  for(const id of rules.general.meikyoIds){
    const result=P.analyze(catalog,[1507],{...base,skill:source.skills.find(skill=>skill.id===id),round:5});
    assert.equal(result.modifiers.critRatePercent,20);
    assert.equal(result.damageFactor,1.4000000953674316);
    const expired=P.analyze(catalog,[1507],{...base,skill:source.skills.find(skill=>skill.id===id),round:6});
    assert.equal(expired.modifiers.critRatePercent,0);
    assert.equal(expired.damageFactor,1);
  }
});

test('Honing Sense defers missing list, current skill, invalid round and overlapping unverified statuses',()=>{
  const skill=source.skills.find(row=>row.id===402040);
  for(const [fixture,context] of [[source,{skill,round:1}],[catalog,{round:1}],
    ...[0,-1,1.5,NaN].map(round=>[catalog,{skill,round}])]){
    const result=P.analyze(fixture,[1507],context);
    assert.equal(result.modifiers.critRatePercent,0);
    assert.equal(result.damageFactor,1);
    assert.ok(result.deferred.some(term=>term.effectId===12967));
  }
  const overlap=P.analyze(catalog,[1507],{...base,skill,round:1,activeEffectIds:[12912]});
  assert.equal(overlap.modifiers.critRatePercent,20);
  assert.equal(overlap.damageFactor,1.4000000953674316);
  assert.ok(overlap.deferred.some(term=>/Overlapping/.test(term.reason)));
});

test('fresh battle Bravery and Faith openers last through round three and expire before round four',()=>{
  for(const [passiveId,skillId] of [[1294,401010],[1295,220010]]){
    const skill=source.skills.find(row=>row.id===skillId);
    for(const [round,expected] of [[1,1.5],[3,1.5],[4,1],[5,1]]){
      const result=P.analyze(catalog,[passiveId],{...base,skill,round});
      assert.equal(result.damageFactor,expected);
    }
  }
});

function modelFor(skillId,passiveId,rounds){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:999,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
  const fixture={...catalog,characters:[character],skills:[source.skills.find(row=>row.id===skillId)],visions:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[passiveId]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:[skillId],equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(fixture,snapshot,enemy,{goals:['damage'],rounds,includeSupportOptions:false});
  const input={characterId:1001,visionId:-1,equipment};
  const fixed=ids=>{const evaluation=model.evaluate({...input,equippedSkillIds:ids});assert.equal(evaluation.valid,true,JSON.stringify(evaluation));return evaluation;};
  return {model,input,fixed};
}

test('five-round fixed and party scoring drop expired opener damage instead of freezing the first-round bonus',()=>{
  for(const [passiveId,skillId] of [[1294,401010],[1295,220010]]){
    const one=modelFor(skillId,passiveId,1),five=modelFor(skillId,passiveId,5);
    const opening=one.fixed([passiveId]),plain=one.fixed([]),full=five.fixed([passiveId]);
    assert.ok(full.actionPlan,'finite opening effects require live round context');
    const expected=(3*opening.fightDamage+2*plain.fightDamage)/5;
    assert.ok(Math.abs(full.fightDamage-expected)<1e-6,`${full.fightDamage} != ${expected}`);
    assert.ok(full.fightDamage<opening.fightDamage);
    const party=five.model.evaluateParty([{...five.input,evaluation:full}]);
    assert.ok(Math.abs(party.damage-expected)<1e-6);
  }
});

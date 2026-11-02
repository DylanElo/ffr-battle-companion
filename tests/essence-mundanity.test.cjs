const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-mundanity.json');
const nativeImbue=require('./fixtures/native-imbue.json');
const rounding=require('./fixtures/native-mundanity-rounding.json');
const attack=source.skills.find(row=>row.id===401010);
const elements=['None','Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'];
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('Mundanity retains native getter epsilon without altering displayed percentages',()=>{
  const result=P.analyze(source,[1389],{skill:attack});
  assert.equal(result.modifiers.damagePercent,40);
  assert.equal(result.modifiers.breakPercent,-50);
  assert.equal(result.damageFactor,rounding.nativeHpFactor);
  assert.equal(result.breakFactor,rounding.nativeBreakFactor);
  const inactive=P.analyze(source,[1389],{skill:{...attack,element:'Fire'}});
  assert.equal(inactive.damageFactor,1);
  assert.equal(inactive.breakFactor,1);
  const copies=P.analyze(source,[],{skill:attack,activeEffectIds:[12944,12944]});
  assert.equal(copies.modifiers.damagePercent,80);
  assert.equal(copies.damageFactor,1+2*(rounding.nativeHpFactor-1));
});

test('Mundanity native factors preserve the HP and stagger integer boundary examples',()=>{
  const result=P.analyze(source,[1389],{skill:attack});
  const hp=rounding.hpExample,bp=rounding.bpExample;
  const input={attack:hp.stats.attack,defense:hp.stats.defense,level:hp.stats.level,
    skill:{calcType:hp.stats.calcType,mag:hp.stats.mag},damageCap:99999};
  assert.equal(D.damage({...input,outgoingFactor:result.damageFactor}).amount,hp.results[1].truncatedAmount);
  assert.equal(D.damage({...input,outgoingFactor:1.4}).amount,hp.results[0].truncatedAmount);
  const breakInput={skill:{breakDmg:bp.breakDmg},level:bp.level,targetLevel:bp.targetLevel};
  assert.equal(D.breakDamage({...breakInput,outgoingFactor:result.breakFactor}).amount,bp.results[1].nativeAmount);
  assert.equal(D.breakDamage({...breakInput,outgoingFactor:.5}).amount,bp.results[0].nativeAmount);
});

test('Mundanity matches native base-row gates independently of effective element and damage type',()=>{
  for(const row of native.vectors){
    const skill={...attack,element:elements[row.baseSkillElement],dmgType:['None','Physic','Magic'][row.damageType]};
    const original=source.effects.find(effect=>effect.id===row.effectId);
    const effect=row.filterParam===undefined?original:{...original,params:original.params.map((value,index)=>index===row.filterParam?row.filterValue:value)};
    const catalog={...source,effects:[effect]};
    for(const element of ['None','Fire']){
      const result=P.analyze(catalog,[],{skill,element,activeEffectIds:[row.effectId]});
      const factor=row.effectId===12944?result.damageFactor:result.breakFactor;
      approx(factor-1,row.nativeAdditiveContribution);
    }
  }
});

test('Solar only imbues physical non-elemental HP damage, retaining intrinsic elements',()=>{
  const cases=[
    [{},'Fire'],
    [{element:'Ice'},'Ice'],
    [{dmgType:'Magic',calcType:'Magic'},'None'],
    [{parameterType:'MagicPoint'},'None'],
    [{parameterVariationType:'Increase'},'None'],
    [{parameterVariationType:'RatioDecrease'},'Fire']
  ];
  for(const [overrides,expected] of cases){
    const result=P.analyze(source,[1521],{skill:{...attack,...overrides}});
    assert.equal(result.modifiers.element,expected,JSON.stringify(overrides));
  }
});

test('Solar effective elements match the native collector vectors and forced-element precedence',()=>{
  for(const row of nativeImbue.vectors){
    const skill={...attack,element:elements[row.baseElement],dmgType:['None','Physic','Magic'][row.damageType],
      parameterType:['None','HitPoint','MagicPoint'][row.parameter ?? 1],
      parameterVariationType:['Increase','Decrease','RatioIncrease','RatioDecrease'][row.variation ?? 1]};
    // Native oracle supplies a generic forced-element virtual getter; vary the native AddElement row equivalently.
    const template=source.effects.find(effect=>effect.id===1021);
    const forced={...template,params:template.params.map((value,index)=>index===0?row.forcedElement:value)};
    const catalog={...source,effects:source.effects.map(effect=>effect.id===1021?forced:effect),
      skillRules:{...rules,damageCalc:{...rules.damageCalc,Physic:{...rules.damageCalc.Physic,doCalcElement:row.elementCalculationEnabled ?? true}}}};
    const result=P.analyze(catalog,[1521],{skill,activeEffectIds:row.forcedElement?[1021]:[]});
    assert.equal(result.modifiers.element,elements[row.nativeEffectiveElements[0] ?? 0],JSON.stringify(row));
    assert.equal(result.elementAmbiguous,undefined);
  }
});

test('Solar defers incomplete native skill metadata instead of assuming a physical HP attack',()=>{
  for(const field of ['element','dmgType','parameterType','parameterVariationType']){
    const skill={...attack};delete skill[field];
    const result=P.analyze(source,[1521],{skill});
    assert.equal(result.modifiers.imbues.length,0,field);
    assert.ok(result.deferred.some(term=>term.effectId===40202),field);
  }
});

test('Mundanity survives Solar imbue while Fire damage bonuses still use the effective element',()=>{
  const firePower=source.passives.find(row=>row.effects.includes(12955)).id;
  const result=P.analyze(source,[1389,1521,firePower],{skill:attack});
  assert.equal(result.modifiers.element,'Fire');
  assert.equal(result.modifiers.damagePercent,40);
  assert.equal(result.modifiers.breakPercent,-50);
  assert.equal(result.modifiers.elementDamagePercent,20);
});

test('Solar scope restrictions do not narrow the distinct generic AddElement decoder',()=>{
  const result=P.analyze(source,[],{skill:{...attack,attr:'Ability',dmgType:'Magic',calcType:'Magic'},activeEffectIds:[1021]});
  assert.equal(result.modifiers.element,'Fire');
});

function fixture(){
  const ids=[1389,1521],passives=source.passives.filter(row=>ids.includes(row.id));
  const effectIds=new Set(passives.flatMap(row=>row.effects));
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const attacks=new Map([[1001,attack],[1002,source.skills.find(row=>row.id===402010)]]);
  const characters=[1001,1002].map(id=>({...source.characters.find(row=>row.id===id),levelParamId:1,passiveIds:[],baseSkillEquipCost:100,
    stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}}));
  const catalog={...source,skillRules:rules,characters,skills:[...attacks.values()],passives,effects:source.effects.filter(row=>effectIds.has(row.id)),masterSkills:[],visions:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:ids}]}}};
  const snapshot={characters:characters.map(({id})=>({id,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:[attacks.get(id).id],equippedSkillIds:Array(8).fill(-1),equipment})),
    inventory:[],resonances:[],party:characters.map(row=>row.id),player:{difficulty:'Normal'},artifactOverrides:[]};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{jointOptimization:true,goals:['damage'],difficulty:'Normal',rounds:1,includeSupportOptions:false});
  const members=equippedSkillIds=>characters.map(({id:characterId})=>{
    const input={characterId,visionId:-1,equipment,equippedSkillIds};
    const evaluation=model.evaluate(input);
    assert.equal(evaluation.valid,true,JSON.stringify(evaluation));
    assert.ok(evaluation.skillCost<=evaluation.skillBudget);
    return {...input,evaluation};
  });
  return {model,members};
}

test('complete fixed builds and party rescoring retain Mundanity after Solar conversion',()=>{
  const {model,members}=fixture();
  const baseline=members([1521]),mundane=members([1521,1389]);
  for(let i=0;i<baseline.length;i++){
    approx(mundane[i].evaluation.leafResults[0].common.outgoingFactor,1.4);
    assert.equal(mundane[i].evaluation.leafResults[0].common.effectiveElement,'Fire');
    assert.ok(mundane[i].evaluation.damage>baseline[i].evaluation.damage);
    assert.ok(mundane[i].evaluation.breakDamage<baseline[i].evaluation.breakDamage);
  }
  const before=model.evaluateParty(baseline),after=model.evaluateParty(mundane);
  assert.ok(after.roundDamage>before.roundDamage);
  assert.ok(after.roundBreakDamage<before.roundBreakDamage);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-weakness-variation.json');
const reactor=require('./fixtures/native-ultima-reactor-bp.json');
const skill=source.skills.find(row=>row.id===220010);

test('Weak Blast and Weakness Exploiter add to either native HP or stagger elemental base factor',()=>{
  for(const row of native.vectors){
    const result=P.analyze(source,[],{skill,weakness:row.resistance===1,activeEffectIds:row.effectIds});
    assert.equal(Math.fround(row.baseElementFactor+result.modifiers.weaknessFactorAdd),row.nativeFinalElementFactor,JSON.stringify(row));
  }
  for(const [passiveId,effectId] of [[1099,1220],[1398,12979]]){
    assert.ok(source.passives.find(row=>row.id===passiveId).effects.includes(effectId));
    const result=P.analyze(source,[passiveId],{skill,weakness:true});
    assert.ok(result.modifiers.weaknessFactorAdd>0);
    assert.equal(result.damageFactor,1);
    assert.equal(result.breakFactor,1);
  }
  const semantic=P.analyze(source,[1099,1099],{skill,weakness:true});
  assert.ok(semantic.deferred.length,'repeated semantic references do not assert two physical sources');
  const physical=P.analyze(source,[1099],{skill,weakness:true,passiveIdOccurrences:[1099,1099]});
  assert.equal(Math.fround(1.5+physical.modifiers.weaknessFactorAdd),1.9000000953674316);
});

test('fixed native Fire builds feed the same additive weakness bonuses to HP and stagger calculations',()=>{
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:999,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
  const catalog={...source,skillRules:rules,characters:[character],skills:[skill],visions:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[1099,1398]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:[skill.id],equippedSkillIds:Array(8).fill(-1),equipment}],
    inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{Fire:'Weakness'},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
  for(const equippedSkillIds of [[],[1099],[1398],[1099,1398]]){
    const effects=equippedSkillIds.map(id=>id===1099?1220:12979);
    const oracle=base=>native.vectors.find(row=>row.resistance===1 && row.baseElementFactor===base && JSON.stringify(row.effectIds)===JSON.stringify(effects)).nativeFinalElementFactor;
    const result=model.evaluate({characterId:1001,visionId:-1,equipment,equippedSkillIds});
    assert.equal(result.valid,true,JSON.stringify(result));
    const common=result.leafResults[0].common;
    assert.equal(common.elementFactor,oracle(1.5));
    const normal=D.breakDamage({skill,level:1,targetLevel:1,elementFactor:oracle(3),rules:catalog.battleRules});
    const critical=D.breakDamage({skill,level:1,targetLevel:1,elementFactor:oracle(3),critical:true,rules:catalog.battleRules});
    const chance=D.criticalProbability(skill.criticalHitRate);
    assert.equal(result.breakDamage,normal.amount*(1-chance)+critical.amount*chance);
  }
});

test('Ultima Reactor native critical stagger rounds to44, preserving the known reference43 disagreement',()=>{
  const attack=source.skills.find(row=>row.id===401010);
  for(const row of reactor.rows){
    const actual=D.breakDamage({skill:attack,level:55,targetLevel:55,outgoingFactor:row.outgoingFactor,critical:row.critical});
    assert.equal(actual.amount,row.nativeAmount);
    if(row.critical)assert.equal(actual.amount,44);
  }
  const result=P.analyze(source,source.equipment.find(row=>row.id===12095).passiveIds,{skill:attack,hpPercent:50});
  const critical=D.breakDamage({skill:attack,level:55,targetLevel:55,outgoingFactor:result.breakFactor,critical:true});
  assert.equal(critical.amount,44);
  assert.notEqual(critical.amount,43);
});


test('shared roll state preserves explicit duplicate applied weakness effects',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
  const file=require.resolve('../docs/battle.js'),code=fs.readFileSync(file,'utf8');
  const hook='return {evaluate,evaluateParty,explainAbilities,scenario,evidence,globalWarnings,prep,requestError};';
  assert.ok(code.includes(hook));
  const sandbox={module:{exports:{}},require:createRequire(file)};
  vm.runInNewContext(code.replace(hook,hook.replace('prep,requestError','prep,requestError,rollState')),sandbox);
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:[],equipment}],resonances:[],inventory:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50},resistances:{Fire:'Weakness'},passiveIds:[]};
  const model=sandbox.module.exports.createModel({...source,skillRules:rules},snapshot,enemy,{goals:['damage']});
  const roll=model.rollState([],skill,1001,equipment,{activeEffectIds:[1220,1220]});
  assert.equal(roll.common.elementFactor,1.9000000953674316);
});

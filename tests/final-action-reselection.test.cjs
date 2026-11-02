const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const S=require('../docs/stats.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture(){
  const ids=[220010,220020,220340,400650,400360];
  const spirit=source.masterSkills.find(row=>row.id===1312700);
  const passiveIds=[1045,...spirit.grants.passiveIds];
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:13108};
  const character={...source.characters.find(row=>row.id===1008),levelParamId:1,passiveIds:[],baseSkillEquipCost:300,
    stats:{HitPoint:1000,MagicPoint:3000,Attack:50,Intelligence:300,Defence:50,Mind:50,Agility:50}};
  const catalog={...source,skillRules:rules,characters:[character],equipment:[],artifacts:[],
    skills:source.skills.filter(row=>ids.includes(row.id)),passives:source.passives.filter(row=>passiveIds.includes(row.id)),masterSkills:[spirit],
    visions:[{id:13108,name:'Terra',stats:{},awakening:[{requiredPoints:0,grants:[220010,220020,220340].map(id=>({type:'ActiveSkill',id}))}],synchro:[]},
      {id:13127,name:'Y’shtola',stats:{},awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:1312700}]}]}],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[1045,400650,220010]}]}}};
  const snapshot={characters:[{id:1008,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:[],equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[
      {id:13108,awakeningPoints:0,sync:[{characterId:1008,points:0}]},
      {id:13127,awakeningPoints:0,sync:[{characterId:1008,points:1}]}],party:[1008],player:{GameDifficulty:'Normal'},artifactOverrides:[]};
  const enemy={id:999,name:'Final action fixture',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const options={jointOptimization:true,fillAbilitySlots:true,includeSupportOptions:true,goals:['damage'],difficulty:'Normal',rounds:5};
  const input={characterId:1008,visionId:13108,equipment};
  const previous=B.createModel(catalog,snapshot,enemy,{...options,actionId:220010}).evaluate({...input,equippedSkillIds:[1045,1312700,400650,220010]});
  assert.equal(previous.valid,true,previous.reason);
  assert.equal(previous.skillId,220010);
  assert.ok(previous.turn.wrapperIds.includes(400650));
  assert.ok(previous.turn.wrapperIds.includes(400360));
  return {catalog,snapshot,enemy,options,input,previous};
}

function legal(f,result){
  assert.equal(result.valid,true,result.reason);
  assert.ok(result.skillCost<=result.skillBudget);
  assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
  const known=S.learned(f.catalog,f.snapshot,1008,13108);
  assert.ok(result.equippedSkillIds.every(id=>[...known.learnedActiveIds,...known.learnedPassiveIds,...known.masterSkillIds].includes(id)));
}

test('final refinement reselects a stronger action on its completed physical loadout',()=>{
  const f=fixture(),model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const before=JSON.stringify(f.previous);
  const refined=model.evaluate({...f.input,lockedSkillIds:[400650,1312700],refineEvaluation:f.previous});
  legal(f,refined);
  assert.equal(refined.skillId,220340);
  assert.ok(refined.score>f.previous.score);
  assert.ok(refined.fightDamage>f.previous.fightDamage);
  assert.ok(refined.equippedSkillIds.includes(400650));
  assert.ok(refined.equippedSkillIds.includes(1312700));
  assert.ok(!refined.equippedSkillIds.includes(220010),'unused Fire is not kept as a filler');
  const fixed=model.evaluate({...f.input,equippedSkillIds:refined.equippedSkillIds});
  assert.equal(refined.score,fixed.score,'returned score belongs to the full final action and abilities');
  const withFire=model.evaluate({...f.input,equippedSkillIds:[...refined.equippedSkillIds,220010]});
  assert.equal(withFire.score,fixed.score,'old Fire contributes no damage or score');
  assert.equal(JSON.stringify(f.previous),before);
});

test('final action reselection preserves an explicit action pin',()=>{
  const f=fixture(),model=B.createModel(f.catalog,f.snapshot,f.enemy,{...f.options,actionId:220010});
  const refined=model.evaluate({...f.input,lockedSkillIds:[400650,1312700,220010],refineEvaluation:f.previous});
  legal(f,refined);
  assert.equal(refined.skillId,220010);
  assert.ok(refined.equippedSkillIds.includes(220010));
});

test('an explicit small joint allowance remains strict during final refinement',()=>{
  const f=fixture(),model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const refined=model.evaluate({...f.input,lockedSkillIds:[400650,1312700],refineEvaluation:f.previous,jointAbilityBudget:3});
  legal(f,refined);
  assert.ok(refined.jointAbilityEvaluations<=3);
});


const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const native=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({mp=200,skills=[420010],passives=[1414],breakPoint=1e12,incomingDamage=0,critical=false}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const character={...native.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:mp,Attack:100,Intelligence:100,Divine:30,Defence:30,Mind:30,Agility:50}};
  const catalog={...native,skillRules:rules,characters:[character],skills:native.skills.filter(row=>skills.includes(row.id)),
    visions:[],masterSkills:[],equipment:[],artifacts:[],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...skills,...passives]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:[],equippedSkillIds:Array(8).fill(-1),equipment}],
    inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:breakPoint,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],jointOptimization:true,jointAbilityBudget:8,rounds:1,includeSupportOptions:false,incomingDamage,critical});
  const input={characterId:1001,visionId:-1,equipment};
  const fixed=ids=>{
    const result=model.evaluate({...input,equippedSkillIds:ids});
    assert.equal(result.valid,true,JSON.stringify(result));
    assert.ok(result.skillCost<=result.skillBudget);
    assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
    return result;
  };
  return {catalog,model,input,fixed};
}

test('native Dual Spellblade adds exactly one separately paid ordinary cast without another active AP charge',()=>{
  const {fixed}=fixture();
  const plain=fixed([420010]),repeated=fixed([420010,1414]);
  assert.equal(plain.actionCount,1);
  assert.equal(repeated.actionCount,2);
  assert.deepEqual(repeated.turn.leaves.map(leaf=>[leaf.skillId,!!leaf.nativeRepeat]),[[420010,false],[420010,true]]);
  assert.equal(repeated.turnMp,10);
  assert.equal(repeated.remainingMp,190);
  assert.equal(repeated.skillCost-plain.skillCost,40);
  assert.equal(repeated.equippedSkillIds.filter(id=>id===420010).length,1);
  assert.deepEqual(repeated.resourceEvents.filter(event=>event.mpCost>0).map(event=>[event.skillId,event.mpCost]),[[420010,5],[420010,5]]);
});

test('the original Spellblade remains valid when its generated clone fails fresh MP affordability',()=>{
  const {fixed}=fixture({mp:7});
  const result=fixed([420010,1414]);
  assert.equal(result.actionCount,2,'the selected queue includes the generated clone');
  assert.equal(result.turn.selectionMp,5,'selection does not require both payments upfront');
  assert.equal(result.remainingMp,2);
  assert.deepEqual(result.resourceEvents.filter(event=>event.mpCost>0).map(event=>[event.skillId,event.mpCost]),[[420010,5]]);
  assert.ok(result.resourceSkips.some(event=>event.skillId===420010 && /Insufficient MP/.test(event.reason)));
  assert.ok(result.fightDamage>0,'the original completed damage is retained');
});

test('Spellblade Wielder alone is not mistaken for the native repeat source',()=>{
  const {fixed}=fixture({passives:[1415]});
  const result=fixed([420010,1415]);
  assert.equal(result.actionCount,1);
  assert.equal(result.remainingMp,195);
  assert.equal(result.turn.leaves.some(leaf=>leaf.nativeRepeat),false);
});

test('manual Arms A/B selection appends one A/B repeat batch, also once in Additional',()=>{
  const f=fixture({skills:[420010,420040,400650],breakPoint:1});
  const ids=[420010,420040,400650,1414],initial=f.fixed(ids);
  assert.equal(initial.actionCount,4);
  const base=initial.turn.leaves.filter(leaf=>!leaf.nativeRepeat).map((leaf,index)=>({...leaf,skillId:index?420040:420010}));
  const turn={...initial.turn,leaves:base,steps:[...initial.turn.steps.filter(step=>step.kind==='wrapper'),...base],actions:2,hasNativeRepeats:false,mp:50};
  const result=f.model.evaluate({...f.input,lockedSkillIds:ids,refineEvaluation:{...initial,skillId:420010,turn,equippedSkillIds:ids}});
  assert.equal(result.valid,true,JSON.stringify(result));
  assert.deepEqual(result.turn.leaves.map(leaf=>leaf.skillId),[420010,420040,420010,420040]);
  assert.equal(result.turn.leaves.filter(leaf=>leaf.nativeRepeat).length,2);
  assert.equal(result.skillCost,initial.skillCost);
  const events=result.resourceEvents.filter(event=>[420010,420040].includes(event.skillId));
  assert.deepEqual(events.filter(event=>event.phase==='normal').map(event=>event.skillId),[420010,420040,420010,420040]);
  assert.deepEqual(events.filter(event=>event.phase==='additional').map(event=>event.skillId),[420010,420040,420010,420040]);
  assert.equal(result.remainingMp,80,'each participation pays Arms40 and four Spellblade5 costs');
});

test('Braver intrinsic CritMul13300 contributes once to HP and stagger in static and live scoring',()=>{
  const still=fixture({skills:[446000],passives:[],critical:true});
  const live=fixture({skills:[446000],passives:[],critical:true,incomingDamage:1});
  const staticResult=still.fixed([446000]),liveResult=live.fixed([446000]);
  const leaf=staticResult.leafResults[0],skill=still.catalog.skills[0];
  assert.equal(leaf.common.criticalBonus,.05);
  assert.equal(leaf.damage,D.damage({...leaf.common,critical:true}).amount);
  assert.equal(leaf.breakDamage,D.breakDamage({skill,level:1,targetLevel:1,critical:true,criticalBonus:.05,rules:still.catalog.battleRules}).amount);
  const row=liveResult.stateLeafResults.find(row=>row.skillId===446000);
  assert.equal(row.common.criticalBonus,.05);
  assert.equal(row.damage,leaf.damage);
  assert.equal(row.breakDamage,leaf.breakDamage);
});

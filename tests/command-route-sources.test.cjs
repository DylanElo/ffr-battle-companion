const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const M=require('../docs/mp-costs.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-command-route-sources.json');

function fixture({visionId=13017,awakening=0,sync=0,skillIds=[220010,220020,220380,400450,400650,400730,400360],spirit=false,joint=false,second=false,missingMembership=false,incomingDamage=0}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId};
  const character=id=>({...source.characters.find(row=>row.id===id),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:2000,Attack:120,Intelligence:200,Divine:20,Defence:50,Mind:50,Agility:50}});
  const selected=source.visions.find(row=>row.id===visionId);
  const vision=selected && {...selected,stats:{},innatePassiveIds:[],awakening:selected.awakening.map(stage=>({...stage,grants:stage.grants.filter(g=>g.type==='ActiveSkill')})),
    synchro:selected.synchro.map(stage=>({...stage,grants:stage.grants.filter(g=>g.type==='ActiveSkill')}))};
  const master=source.masterSkills.find(row=>row.id===1312700);
  const savedIds=[220380,220020,400650,400730,...(spirit?[1312700]:[])];
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:[],equippedSkillIds:savedIds,equipment}],
    inventory:[],resonances:vision?[{id:vision.id,awakeningPoints:awakening,sync:[{characterId:1001,points:sync}]}]:[],party:[1001],player:{GameDifficulty:'Normal'},artifactOverrides:[]};
  const catalog={...source,skillRules:rules,characters:[character(1001)],equipment:[],artifacts:[],
    skills:source.skills.filter(row=>skillIds.includes(row.id)).map(row=>missingMembership && row.id===220380?{...row,commandIds:[]}:row),
    passives:source.passives.filter(row=>[1432,...(spirit?master.grants.passiveIds:[])].includes(row.id)),masterSkills:spirit?[master]:[],visions:vision?[vision]:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}}};
  if(second){const other={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};catalog.characters.push(character(1008));snapshot.characters.push({...snapshot.characters[0],id:1008,equipment:other,equippedSkillIds:[220380]});snapshot.party.push(1008);}
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const options={goals:['damage'],rounds:1,incomingDamage,includeSupportOptions:false,jointOptimization:joint,jointAbilityBudget:8};
  const input={characterId:1001,visionId,equipment};
  const model=actionId=>B.createModel(catalog,snapshot,enemy,{...options,actionId});
  const fixed=(actionId,ids)=>{const result=model(actionId).evaluate({...input,equippedSkillIds:ids});assert.equal(result.valid,true,result.reason);legal(result);return result;};
  return {catalog,snapshot,enemy,options,input,model,fixed};
}
function legal(result){assert.ok(result.skillCost<=result.skillBudget);assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);}
const originals=result=>result.turn.leaves.filter(leaf=>!leaf.nativeRepeat);
const route=leaf=>({initialCommandId:leaf.context.initialCommandId,parentActionId:leaf.context.parentActionId,commandId:leaf.context.commandId,queuedCommandId:leaf.context.queuedCommandId});

test('compact source vectors preserve the independently executed native route distinctions',()=>{
  assert.equal(native.evidence.nativeChecks,Object.values(native.evidence.checks).reduce((sum,value)=>sum+value,0));
  for(const id of native.vectors.find(row=>row.case==='generic paid Spirit Sync pool').childIds)assert.ok(source.skills.find(row=>row.id===id).commandIds.includes(1));
  const awakening=source.visions.find(row=>row.id===13017).awakening.filter(stage=>stage.requiredPoints<=0).flatMap(stage=>stage.grants.filter(grant=>grant.type==='ActiveSkill').map(grant=>grant.id));
  assert.deepEqual(native.vectors.find(row=>row.case==='Amelia Awakening zero').childIds,awakening);
  assert.deepEqual(native.vectors.find(row=>row.case==='generic paid Spirit Sync pool').childIds,[400450,400360,220380]);
  assert.equal(native.vectors.find(row=>row.case==='Arms inner Vision').parentActionId,202);
  assert.equal(native.vectors.find(row=>row.case==='Arms inner generic').parentActionId,1);
  assert.equal(source.skills.find(row=>row.id===400450).name,'Aim');
});

test('paid Meltdown uses generic1 and does not become an equipped-Vision action',()=>{
  const f=fixture(),result=f.fixed(220380,[220380]);
  assert.deepEqual(route(originals(result)[0]),{initialCommandId:1,parentActionId:1,commandId:1,queuedCommandId:1});
  assert.deepEqual(result.equippedSkillIds,[220380]);
});

test('reached Awakening Fire uses202, while a paid but unreached Fira remains generic1',()=>{
  const f=fixture(),fire=f.fixed(220010,[]),fira=f.fixed(220020,[220020]);
  assert.equal(originals(fire)[0].context.parentActionId,202);
  assert.equal(originals(fire)[0].context.commandId,202);
  assert.equal(originals(fira)[0].context.commandId,1);
  assert.equal(fira.turn.hasNativeRepeats,false);
});

test('Spirit Magic Barrage keeps generic wrapper identity and AW-only child remapping',()=>{
  const f=fixture({spirit:true});
  const fire=f.fixed(220010,[1312700]),paid=f.fixed(220380,[1312700,220380]);
  assert.ok(fire.turn.wrapperIds.includes(400360));
  const wrapper=fire.turn.steps.find(step=>step.skillId===400360);
  assert.equal(wrapper.context.initialCommandId,1);
  assert.equal(wrapper.context.parentActionId,1);
  assert.equal(wrapper.context.commandId,1);
  assert.ok(originals(fire).every(leaf=>leaf.context.parentActionId===400360 && leaf.context.commandId===202));
  assert.ok(originals(paid).every(leaf=>leaf.context.parentActionId===400360 && leaf.context.commandId===1));
  assert.ok(!fire.equippedSkillIds.includes(400360),'the selected Spirit supplies Magic Barrage without another AP slot');
  assert.equal(fire.skillCost,source.masterSkills.find(row=>row.id===1312700).equipCost);
});

test('Arms supports independent AW Vision and generic menu parents, including Sync-only Aim',()=>{
  const f=fixture({sync:95,joint:true}),model=f.model(220010);
  const seed=f.fixed(220010,[400650]);
  assert.ok(originals(seed).every(leaf=>leaf.context.initialCommandId===1 && leaf.context.parentActionId===202 && leaf.context.commandId===202));
  const turn=structuredClone(seed.turn);
  const first=turn.leaves[0];
  turn.leaves[1]={...turn.leaves[1],skillId:400450,kind:'support'};
  const second=turn.steps.map((step,index)=>step.kind!=='wrapper' && step.skillId===220010?index:-1).filter(index=>index>=0)[1];
  assert.ok(second>=0);
  turn.steps[second]={...turn.steps[second],skillId:400450,kind:'support'};
  const result=model.evaluate({...f.input,lockedSkillIds:[400650],refineEvaluation:{...seed,turn},jointAbilityBudget:1});
  assert.equal(result.valid,true,result.reason);legal(result);
  assert.deepEqual(originals(result).map(leaf=>[leaf.skillId,leaf.context.parentActionId,leaf.context.commandId]),[[first.skillId,202,202],[400450,1,1]]);
  assert.ok(originals(result).every(leaf=>leaf.context.initialCommandId===1 && leaf.context.hierarchySkills.includes(400650)));
  assert.ok(!result.equippedSkillIds.includes(400450),'current equipped Sync grants Aim for free');
  assert.ok(result.equippedSkillIds.includes(400650));
});

test('command-cost checks consume actual direct and wrapper contexts without substituting the Vision command',()=>{
  const f=fixture({visionId:13123,skillIds:[220090,400360],spirit:true});
  const result=f.fixed(220090,[1312700]),wrapper=result.turn.steps.find(step=>step.skillId===400360),leaf=originals(result)[0];
  assert.equal(wrapper.context.commandId,1);
  assert.equal(leaf.context.commandId,123);
  const skill=f.catalog.skills.find(row=>row.id===220090),cost=context=>M.costForSkill(f.catalog,[1432],skill,{...context,limitBurstPoints:50,areaEffect:false}).cost;
  assert.equal(cost(leaf.context),Math.trunc(skill.cost*.5));
  assert.equal(cost(wrapper.context),skill.cost);
});

test('unavailable grants and missing native command membership fail closed',()=>{
  const unavailable=fixture({visionId:-1,skillIds:[220010,220380]});
  assert.equal(unavailable.model(220010).evaluate({...unavailable.input,equippedSkillIds:[]}).valid,false);
  const noMember=fixture({missingMembership:true}),result=noMember.fixed(220380,[220380]);
  assert.equal(originals(result)[0].context.commandId,undefined);
  assert.equal(originals(result)[0].context.queuedCommandId,undefined);
  const noSpirit=fixture();
  assert.equal(noSpirit.model(220380).evaluate({...noSpirit.input,equippedSkillIds:[1312700,220380]}).valid,false);
});

test('fixed and joint party evaluation retain per-member routes, pins and AP legality',()=>{
  const f=fixture({joint:true,second:true,incomingDamage:1}),model=f.model(220010);
  const first=model.evaluate({...f.input,lockedSkillIds:[400650],jointAbilityBudget:3});
  assert.equal(first.valid,true,first.reason);legal(first);
  assert.ok(first.equippedSkillIds.includes(400650));
  const other=f.snapshot.characters.find(row=>row.id===1008),second=f.model(220380).evaluate({characterId:1008,visionId:-1,equipment:other.equipment,equippedSkillIds:[220380]});
  assert.equal(second.valid,true,second.reason);legal(second);
  const party=model.evaluateParty([{...f.input,evaluation:first},{characterId:1008,visionId:-1,equipment:other.equipment,evaluation:second}]);
  assert.notEqual(party.valid,false,party.reason);assert.ok(party.damage>0);
  assert.ok(party.resourceEvents[1001].some(event=>event.skillId===220010 && event.common));
  assert.ok(party.resourceEvents[1008].some(event=>event.skillId===220380 && event.common));
  assert.ok(party.resourceEvents[1001].filter(event=>event.skillId===220010 && event.common).every(event=>event.context.commandId===202));
  assert.ok(party.resourceEvents[1008].filter(event=>event.skillId===220380 && event.common).every(event=>event.context.commandId===1));
});

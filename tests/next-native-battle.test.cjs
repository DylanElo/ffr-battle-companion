const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({skills=[401010],passives=[],rounds=1,actionId=skills[0],steals,vision=false,multiHit=false,ap=500,slots=8}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:vision?13105:-1};
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:ap,
    stats:{HitPoint:1000,MagicPoint:999,Attack:300,Intelligence:200,Divine:30,Defence:30,Mind:30,Agility:50}};
  const catalog={...source,skillRules:rules,characters:[character],skills:source.skills.filter(row=>skills.includes(row.id)).map(row=>multiHit&&row.id===401010?{...row,hits:3}:row),
    visions:[],masterSkills:[],equipment:[],artifacts:[],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...skills,...passives]}]}}};
  if(vision){
    catalog.visions=[{...source.visions.find(row=>row.id===13105),stats:{},innatePassiveIds:[],passiveIds:[],finishBlow:-1,baseSkillIds:[401010],
      awakening:[{requiredPoints:0,grants:[{type:'ActiveSkill',id:220030}]}],
      synchro:[{requiredPoints:0,grants:[{type:'ActiveSkill',id:220010},{type:'ActiveSkill',id:220010},{type:'ActiveSkill',id:220020}]},
        {requiredPoints:20,grants:[{type:'ActiveSkill',id:220030}]}]}];
    catalog.masterSkills=[{...source.masterSkills[0],id:1301700,grants:{activeIds:[220040],passiveIds:[]}}];
  }
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:[401010],equippedSkillIds:Array(slots).fill(-1),equipment}],inventory:[],resonances:vision?[{id:13105,awakeningPoints:0,sync:[{characterId:1001,points:10}]}]:[],party:[1001],player:{difficulty:'Normal',...(steals===undefined?{}:{StealSuccessNum:steals})}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],actionId,rounds,jointOptimization:true,jointAbilityBudget:16,includeSupportOptions:false});
  if(vision)snapshot.characters[0].equippedSkillIds=[1301700,...Array(7).fill(-1)];
  const input={characterId:1001,visionId:equipment.visionId,equipment};
  const fixed=ids=>{const result=model.evaluate({...input,equippedSkillIds:ids});assert.equal(result.valid,true,JSON.stringify(result));return result;};
  const party=evaluation=>model.evaluateParty([{...input,evaluation}]);
  return {catalog,snapshot,enemy,model,input,fixed,party};
}
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message}: ${actual} vs ${expected}`);

test('Improvement uses prior completed normal attacks across five scored rounds and joint selection',()=>{
  const f=fixture({passives:[1421],rounds:5});
  const plain=f.fixed([]),improved=f.fixed([1421]);
  const events=improved.resourceEvents.filter(row=>row.phase==='normal'&&row.skillId===401010);
  assert.deepEqual(events.map(row=>row.context.completedNormalAttackCount),[0,1,2,3,4]);
  assert.ok(events[0].common.outgoingFactor<1.000001,'first attack receives no prior completed-attack bonus');
  assert.ok(events[4].common.outgoingFactor>1.39&&events[4].common.outgoingFactor<1.41);
  close(improved.fightDamage,events.reduce((sum,row)=>sum+row.damage,0)/5,'full five-round average');
  close(f.party(improved).damage,improved.fightDamage,'party rescores the same evolving state');
  assert.ok(improved.fightDamage>plain.fightDamage);
  const picked=f.model.evaluate(f.input);
  assert.equal(picked.valid,true);
  assert.ok(picked.equippedSkillIds.includes(1421),'joint optimization selects the useful growing damage passive');
  close(picked.fightDamage,improved.fightDamage,'optimizer uses full completed-build score');
});

test('Improvement increments once after each completed eligible leaf, including paid aliases, never per hit',()=>{
  const f=fixture({skills:[401010,220010,400490],passives:[1421],multiHit:true});
  const leaves=[401010,220010,400490,401010].map((skillId,actionIndex)=>({skillId,actionIndex,kind:'attack',context:{}}));
  const evaluation={skillId:401010,damage:0,brokenDamage:0,breakDamage:0,availableMp:999,turnMp:5,
    stats:{Agility:50,MaxHitPoint:1000,MaxMagicPoint:999,PhysicalDefense:30,MagicalDefense:30},supportActions:[],
    actionPlan:{turn:{leaves,steps:leaves},characterId:1001,equipment:f.input.equipment,passiveIds:[1421],maxHp:1000,maxMp:999}};
  const result=f.party(evaluation),events=result.resourceEvents[1001].filter(row=>row.phase==='normal');
  assert.equal(rules.general.normalAttackSkills.includes(400490),true);
  assert.deepEqual(events.map(row=>[row.skillId,row.context.completedNormalAttackCount]),[[401010,0],[220010,1],[400490,1],[401010,2]]);
  assert.equal(result.hpSpent[1001],50,'paid normal alias spends its actual HP');
  assert.equal(events[3].common.outgoingFactor,1.2000001072883606);
});

test('Perfect Serenity raises the native normal-attack coefficient, including paid general aliases but excluding Fire',()=>{
  for(const skillId of [401010,400490,220010]){
    const f=fixture({skills:[skillId],passives:[1493]});
    const paid=skillId===401010?[]:[skillId];
    const plain=f.fixed(paid),boosted=f.fixed([...paid,1493]);
    const expected=skillId===220010?1:1.5000001192092896;
    assert.equal(boosted.leafResults[0].common.coefficientScale,expected);
    if(skillId===220010)assert.equal(boosted.fightDamage,plain.fightDamage);
    else {assert.ok(boosted.fightDamage>plain.fightDamage);const picked=f.model.evaluate(f.input);assert.equal(picked.valid,true);assert.ok(picked.equippedSkillIds.includes(1493));close(picked.fightDamage,boosted.fightDamage,'joint optimization selects the native normal coefficient passive');}
    close(f.party(boosted).damage,boosted.fightDamage,'party uses identical coefficient and HP state');
  }
});

test('Versatility counts physical active slots plus unique reached equipped-command sync grants only',()=>{
  const f=fixture({skills:[401010,220010,220020,220030,220040],passives:[1340],vision:true});
  const fixed=f.fixed([1340,220010]);
  assert.equal(fixed.actionPlan.equippedCommandActiveCount,3,'one physical ID plus two unique current-command sync grants; cross-list overlap still counts');
  assert.equal(fixed.resourceEvents[0].context.equippedCommandActiveCount,3);
  close(fixed.passiveAnalysis.damageFactor,1.3000001013278961,'native 30% contribution');
  close(f.party(fixed).damage,fixed.fightDamage,'party receives the completed build command count');
  const spirit=f.fixed([1340,220010,1301700]);
  assert.equal(spirit.actionPlan.equippedCommandActiveCount,3,'a physical Spirit ID and its granted active do not add native command count');
  close(spirit.passiveAnalysis.damageFactor,fixed.passiveAnalysis.damageFactor,'Spirit grants do not inflate Versatility');
  const base=f.fixed([]);
  assert.ok(fixed.fightDamage>base.fightDamage);
  const picked=f.model.evaluate(f.input);
  assert.equal(picked.valid,true);
  assert.ok(picked.equippedSkillIds.includes(1340),'joint assignment considers a useful command-count source');
  assert.equal(picked.actionPlan.equippedCommandActiveCount,picked.equippedSkillIds.filter(id=>id>=100000&&id<1000000).length+2);
  close(f.party(picked).damage,picked.fightDamage,'party matches the optimizer complete build');
});

test('Thievery uses imported global successes, native cap and conservative missing state in fixed and party builds',()=>{
  const damage=[];
  for(const steals of [undefined,7,500,1000]){
    const f=fixture({passives:[1426],steals});
    const plain=f.fixed([]),boosted=f.fixed([1426]);
    damage.push(boosted.fightDamage);
    const expected=steals===undefined?1:steals===7?1.0070001194253564:1.5;
    close(boosted.passiveAnalysis.damageFactor,expected,'saved success-count contribution');
    if(steals===undefined){assert.equal(boosted.fightDamage,plain.fightDamage);assert.ok(boosted.passiveAnalysis.deferred.some(row=>row.effectId===12905));}
    else {assert.ok(boosted.fightDamage>plain.fightDamage);assert.equal(boosted.passiveAnalysis.deferred.some(row=>row.effectId===12905),false);const picked=f.model.evaluate(f.input);assert.ok(picked.equippedSkillIds.includes(1426));close(picked.fightDamage,boosted.fightDamage,'joint optimizer retains a useful saved-history passive');}
    close(f.party(boosted).damage,boosted.fightDamage,'party preserves imported global history');
  }
  assert.ok(damage[1]>damage[0]);assert.ok(damage[2]>damage[1]);assert.equal(damage[2],damage[3]);
});


test('Versatility joint search purchases unused cheap native commands only for a real complete-build gain',()=>{
  const commands=[400550,400640],required=[1340,...commands];
  const cost=source.passives.find(row=>row.id===1340).equipCost+commands.reduce((sum,id)=>sum+source.skills.find(row=>row.id===id).equipCost,0);
  assert.equal(cost,65,'native Versatility/First Aid/Guard AP prices');
  const z=fixture({skills:[401010,...commands],passives:[1340,1042],ap:cost,slots:4});
  const plain=z.fixed([]),expected=z.fixed(required),picked=z.model.evaluate(z.input);
  assert.equal(picked.valid,true);
  assert.deepEqual(picked.equippedSkillIds.slice().sort((a,b)=>a-b),required.slice().sort((a,b)=>a-b));
  assert.equal(picked.skillCost,cost);assert.equal(picked.skillBudget,cost);assert.equal(picked.maxSkillSlots,4);
  assert.equal(picked.actionPlan.equippedCommandActiveCount,2,'free Attack and zero sync grants contribute no extra physical command slots');
  assert.ok(picked.fightDamage>plain.fightDamage);
  close(picked.fightDamage,expected.fightDamage,'optimizer compares the exact physically charged assignment');
  close(z.party(picked).damage,expected.fightDamage,'party scores the identical physical command count');
  assert.ok(picked.resourceEvents.every(row=>row.skillId===401010),'unused commands occupy paid slots without invented casts');
  const refined=z.model.evaluate({...z.input,refineEvaluation:picked});
  assert.equal(refined.valid,true);
  assert.deepEqual(refined.equippedSkillIds.slice().sort((a,b)=>a-b),required.slice().sort((a,b)=>a-b),'exact-recipe refinement preserves useful physical command extras');
  assert.equal(refined.skillCost,cost);
  close(refined.fightDamage,picked.fightDamage,'refined seed retains full build gain');
});

test('unused utility commands are not added without an available Versatility source',()=>{
  const z=fixture({skills:[401010,400550,400640],passives:[1042],ap:65,slots:4}),picked=z.model.evaluate(z.input);
  assert.equal(picked.valid,true);
  assert.equal(picked.equippedSkillIds.some(id=>[400550,400640].includes(id)),false);
  assert.ok(picked.resourceEvents.every(row=>row.skillId===401010));
});

test('Versatility command fillers respect a completely locked native slot assignment',()=>{
  const locked=[1340,1042,1278,1321],ap=locked.reduce((sum,id)=>sum+source.passives.find(row=>row.id===id).equipCost,0);
  const z=fixture({skills:[401010,400550,400640],passives:locked,ap,slots:4}),fixed=z.fixed(locked),picked=z.model.evaluate({...z.input,lockedSkillIds:locked});
  assert.equal(picked.valid,true);
  assert.deepEqual(picked.equippedSkillIds.slice().sort((a,b)=>a-b),locked.slice().sort((a,b)=>a-b));
  assert.equal(picked.equippedSkillIds.length,4);assert.equal(picked.skillCost,ap);
  assert.equal(picked.actionPlan.equippedCommandActiveCount,0);
  close(picked.fightDamage,fixed.fightDamage,'full locked assignment is retained and fully scored');
});

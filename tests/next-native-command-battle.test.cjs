const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const P=require('../docs/passives.js');
const S=require('../docs/stats.js');
const D=require('../docs/damage.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({skillIds,passiveIds,rounds=1,visionId=-1,enemyBreak=1e12,actionId=0,nativeCommands=false,awakeningPoints=0,mp=999,joint=false,mpPercent=100}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId};
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:mp,Attack:100,Intelligence:80,Divine:13,Defence:30,Mind:40,Agility:50}};
  const vision=source.visions.find(row=>row.id===visionId);
  const catalog={...source,skillRules:rules,characters:[character],skills:source.skills.filter(row=>skillIds.includes(row.id) || row.id===vision?.finishBlow),
    visions:vision?[{...vision,stats:{},awakening:nativeCommands?vision.awakening:[],synchro:[],innatePassiveIds:[]}]:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...skillIds,...passiveIds]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:skillIds,
    equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:vision?[{id:vision.id,awakeningPoints,sync:[]}]:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:enemyBreak,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage','stagger'],rounds,actionId,includeSupportOptions:false,mpPercent,jointOptimization:joint,jointAbilityBudget:16});
  const input={characterId:1001,visionId,equipment};
  const fixed=ids=>{const result=model.evaluate({...input,equippedSkillIds:ids});assert.equal(result.valid,true,JSON.stringify(result));assert.ok(result.skillCost<=result.skillBudget);assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);return result;};
  return {catalog,snapshot,model,input,fixed};
}

test('Odin’s Blessing native skill whitelist improves complete fixed builds and party HP/stagger',()=>{
  for(const skillId of [447500,447510,220010]){
    const f=fixture({skillIds:[skillId],passiveIds:[1439]}),plain=f.fixed([]),blessed=f.fixed([1439]);
    const leaf=blessed.leafResults[0],matches=skillId!==220010;
    assert.equal(blessed.skillId,skillId);
    assert.equal(leaf.common.outgoingFactor,matches?1.2500001192092896:1);
    assert.ok(Math.abs(blessed.passiveAnalysis.modifiers.breakPercent-(matches?50:0))<.0001);
    const before=f.model.evaluateParty([{...f.input,evaluation:plain}]);
    const after=f.model.evaluateParty([{...f.input,evaluation:blessed}]);
    if(matches){assert.ok(blessed.damage>plain.damage);assert.ok(blessed.breakDamage>plain.breakDamage);assert.ok(after.damage>before.damage);assert.ok(after.breakDamage>before.breakDamage);}
    else {assert.equal(after.damage,before.damage);assert.equal(after.breakDamage,before.breakDamage);}
  }
});

test('Odin’s Blessing includes the native Zantetsuken Finish HP bonus without inventing a Finish stagger bonus',()=>{
  const f=fixture({skillIds:[401010],passiveIds:[1439],visionId:13125,enemyBreak:1});
  const plain=f.fixed([]),blessed=f.fixed([1439]);
  assert.ok(blessed.finishUses.length);
  const finishes=blessed.resourceEvents.filter(event=>event.phase==='finish' && event.skillId===440260 && event.common);
  assert.ok(finishes.length);
  assert.ok(finishes.every(event=>event.common.outgoingFactor===1.2500001192092896));
  assert.equal(P.analyze(f.catalog,[1439],{skill:f.catalog.skills.find(row=>row.id===440260)}).breakFactor,1);
  assert.ok(blessed.fightDamage>plain.fightDamage);
  const after=f.model.evaluateParty([{...f.input,evaluation:blessed}]),before=f.model.evaluateParty([{...f.input,evaluation:plain}]);
  assert.ok(after.finishUses[1001].some(event=>event.skillId===440260));
  assert.ok(after.damage>before.damage);
  assert.equal(after.breakDamage,before.breakDamage);
});

test('Trigger applies to the owner normal attack and configured Darkness alias, but not Fire',()=>{
  for(const skillId of [401010,400490,220010]){
    const f=fixture({skillIds:[skillId],passiveIds:[1422]}),plain=f.fixed([]),trigger=f.fixed([1422]);
    const matches=skillId!==220010;
    assert.equal(trigger.skillId,skillId);
    if(matches){assert.ok(trigger.leafResults[0].common.outgoingFactor>1.29);assert.ok(trigger.damage>plain.damage);assert.ok(trigger.breakDamage>plain.breakDamage);}
    else {assert.equal(trigger.damage,plain.damage);assert.equal(trigger.breakDamage,plain.breakDamage);}
    const before=f.model.evaluateParty([{...f.input,evaluation:plain}]),after=f.model.evaluateParty([{...f.input,evaluation:trigger}]);
    assert.equal(after.damage>before.damage,matches);
    assert.equal(after.breakDamage>before.breakDamage,matches);
  }
});

test('Lone Lion requires an actual capped Improvement source and scales only the five primary parameters',()=>{
  const f=fixture({skillIds:[401010],passiveIds:[1421,1423]});
  const skill=f.catalog.skills[0],base=S.characterStats(f.catalog,f.snapshot,1001,f.input.equipment);
  for(const count of [0,4,5,6]){
    const analyze=ids=>P.analyze(f.catalog,ids,{skill,normalAttackSkillId:401010,completedNormalAttackCount:count});
    const lone=analyze([1423]),together=analyze([1421,1423]);
    assert.deepEqual(lone.modifiers.statScale,{});
    const scaled=S.characterStats(f.catalog,f.snapshot,1001,f.input.equipment,together.terms);
    const expected=count>=5?130:100;
    assert.equal(scaled.stats.Attack,expected);
    assert.equal(scaled.stats.PhysicalAttack,count>=5?Math.trunc(base.stats.PhysicalAttack*1.3):base.stats.PhysicalAttack);
    assert.equal(scaled.stats.MaxHitPoint,base.stats.MaxHitPoint);
    assert.equal(scaled.stats.MaxMagicPoint,base.stats.MaxMagicPoint);
    assert.equal(scaled.stats.Divine,base.stats.Divine+scaled.stats.Mind-base.stats.Mind,'derived Divine inherits its changed Mind once, with no direct scale term');
    assert.deepEqual(Object.keys(together.modifiers.statScale).sort(),count>=5?['Agility','Attack','Defence','Intelligence','Mind']:[]);
  }
  assert.equal(f.fixed([1423]).fightDamage,f.fixed([]).fightDamage);
});

test('Arms Darkness increments Improvement after each completed cast and activates Lone Lion on the sixth cast in full simulation',()=>{
  const f=fixture({skillIds:[400490,400650],passiveIds:[1421,1423],rounds:3});
  const ids=[400650,1421,1423],result=f.fixed(ids);
  const attacks=result.resourceEvents.filter(event=>event.skillId===400490 && event.common);
  assert.equal(attacks.length,6);
  assert.deepEqual(attacks.map(event=>event.context.completedNormalAttackCount),[0,1,2,3,4,5]);
  const original=attacks[0].common.attack;
  assert.ok(attacks.slice(0,5).every(event=>event.common.attack===original));
  assert.equal(attacks[5].common.attack,Math.trunc(original*1.3));
  assert.ok(attacks.every(event=>event.context.maxHp===1000));
  assert.equal(result.stats.MaxMagicPoint,999);
  const party=f.model.evaluateParty([{...f.input,evaluation:result}]);
  const partyAttacks=party.resourceEvents[1001].filter(event=>event.skillId===400490 && event.common);
  assert.deepEqual(partyAttacks.map(event=>event.common.attack),attacks.map(event=>event.common.attack));
  assert.equal(party.damage,result.fightDamage);
});

test('Tronn’s reached Fire command adds True Stagger six to base BP before native factors in fixed and party scoring',()=>{
  const f=fixture({skillIds:[220010],passiveIds:[1406],visionId:13024,nativeCommands:true,actionId:220010});
  const plain=f.fixed([]),trueStagger=f.fixed([1406]),leaf=trueStagger.leafResults[0],skill=f.catalog.skills[0];
  assert.equal(leaf.context.commandId,200);
  assert.ok(trueStagger.passiveAnalysis.breakFactor>1,'native Tronn also supplies a stagger multiplier');
  const input={skill:{...skill,breakDmg:skill.breakDmg+6},level:1,targetLevel:1,outgoingFactor:trueStagger.passiveAnalysis.breakFactor,rules:f.catalog.battleRules};
  const chance=D.criticalProbability(skill.criticalHitRate+trueStagger.passiveAnalysis.modifiers.critRatePercent);
  const expected=D.breakDamage(input).amount*(1-chance)+D.breakDamage({...input,critical:true}).amount*chance;
  assert.equal(trueStagger.breakDamage,expected);
  assert.ok(trueStagger.breakDamage>plain.breakDamage+6,'the six is multiplied, not appended to final stagger');
  const after=f.model.evaluateParty([{...f.input,evaluation:trueStagger}]),before=f.model.evaluateParty([{...f.input,evaluation:plain}]);
  assert.equal(after.breakDamage,trueStagger.fightBreakDamage);
  assert.ok(after.breakDamage>before.breakDamage);
});

test('Amelia’s reached Fire command samples paid Dual Guns across32 paths without buying duplicate AP slots',()=>{
  const f=fixture({skillIds:[220010],passiveIds:[],visionId:13017,nativeCommands:true,awakeningPoints:0,actionId:220010,joint:true});
  const result=f.model.evaluate(f.input);
  assert.equal(result.valid,true,JSON.stringify(result));
  assert.equal(result.skillId,220010);
  assert.equal(result.combatSamples,32);
  assert.equal(result.turn.hasNativeRepeats,true);
  assert.equal(result.turn.selectionMp,5,'only the original is funded up front');
  assert.equal(result.turn.mp,10);
  assert.equal(result.turn.leaves.length,2);
  const [original,clone]=result.turn.leaves;
  assert.equal(original.context.queuedCommandId,202);
  assert.equal(clone.nativeRepeat,true);
  assert.deepEqual(clone.repeatChances,[25]);
  assert.equal(result.equippedSkillIds.includes(1443),false,'native Amelia already supplies Dual Guns for free');
  assert.equal(result.skillCost,0);
  assert.ok(result.remainingMp<999-5 && result.remainingMp>999-10,'sampling includes both clone successes and failures');
  assert.ok(result.fightDamage>result.singleDamage && result.fightDamage<2*result.singleDamage);
  const party=f.model.evaluateParty([{...f.input,evaluation:result}]);
  assert.equal(party.combatSamples,32);
  assert.equal(party.damage,result.fightDamage);
  assert.equal(party.remainingMp[1001],result.remainingMp);
});

test('Dual Guns can select and finish its original with exactly5MP while every successful clone fails fresh payment',()=>{
  const f=fixture({skillIds:[220010],passiveIds:[],visionId:13017,nativeCommands:true,awakeningPoints:0,actionId:220010,mp:5});
  const result=f.fixed([]);
  assert.equal(result.turn.selectionMp,5);
  assert.equal(result.turn.mp,10);
  assert.equal(result.remainingMp,0);
  assert.ok(result.fightDamage>0);
  const party=f.model.evaluateParty([{...f.input,evaluation:result}]);
  assert.equal(party.remainingMp[1001],0);
  assert.equal(party.damage,result.fightDamage);
  assert.ok(party.resourceSkips[1001].length,'the representative path actually attempts a clone and fails its fresh check');
  assert.ok(party.resourceSkips[1001].every(event=>/MP/.test(event.reason)));
  const paid=result.resourceEvents.filter(event=>event.skillId===220010 && event.common);
  assert.equal(paid.length,1);
  assert.equal(paid[0].mpBefore,5);
  assert.equal(paid[0].mpAfter,0);
  assert.equal(result.fightDamage,paid[0].damage);
  const empty=fixture({skillIds:[220010],passiveIds:[],visionId:13017,nativeCommands:true,awakeningPoints:0,actionId:220010,mp:5,mpPercent:0});
  assert.equal(empty.model.evaluate({...empty.input,equippedSkillIds:[]}).valid,false);
});

test('Arms ancestry and missing reached-Awakening provenance do not receive Dual Guns command repeats',()=>{
  const arms=fixture({skillIds:[220010,400650],passiveIds:[],visionId:13017,nativeCommands:true,awakeningPoints:0,actionId:220010});
  const result=arms.fixed([400650]);
  assert.equal(result.multiActionId,400650);
  assert.equal(result.turn.hasNativeRepeats,false);
  assert.equal(result.turn.leaves.filter(leaf=>leaf.nativeRepeat).length,0);
  assert.equal(result.turn.leaves.length,2);
  assert.ok(result.turn.leaves.every(leaf=>leaf.context.hierarchySkills.includes(400650)));
  for(const control of [{visionId:13017,awakeningPoints:0,skillId:220020},{visionId:-1,skillId:220010}]){
    const f=fixture({skillIds:[control.skillId],passiveIds:[1443],nativeCommands:true,actionId:control.skillId,...control});
    const result=f.fixed([1443]);
    assert.equal(result.turn.hasNativeRepeats,false);
    assert.equal(result.turn.leaves[0].context.queuedCommandId,1);
    const routed=P.analyze(f.catalog,[1443],{skill:f.catalog.skills.find(skill=>skill.id===control.skillId),...result.turn.leaves[0].context});
    assert.ok(routed.inactive.some(term=>term.effectId===54220));
  }
  const other=fixture({skillIds:[220010],passiveIds:[1443],nativeCommands:true,actionId:220010,visionId:13024});
  const wrongCommand=other.fixed([1443]);
  assert.equal(wrongCommand.turn.leaves[0].context.queuedCommandId,200);
  assert.equal(wrongCommand.turn.hasNativeRepeats,false);
});

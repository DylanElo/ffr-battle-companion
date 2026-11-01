const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const B=require('../docs/battle.js');
const catalog=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const ultima=catalog.skills.find(skill=>skill.id===220340);
const context={skill:ultima,element:'None',hpPercent:100,mpPercent:75,lbPercent:50,targetStatusIds:[],statusIds:[],
  critical:false,broken:false,extraPhase:false,currentSkillIds:[400650,400360,220340],skillHistory:[[]],targetCount:2};
const analyze=(ids,overrides={})=>P.analyze(catalog,[],{...context,...overrides,activeEffectIds:ids});

test('Skill Flow counts unique current IDs and the last five global-turn buckets',()=>{
  const result=analyze([12909]);
  assert.equal(result.modifiers.damagePercent,30);
  assert.equal(result.modifiers.breakPercent,0);
  assert.equal(result.damageFactor,1.3);
  assert.equal(result.unsupported.length+result.deferred.length,0);
  const duplicates=analyze([12909],{currentSkillIds:[400650,400650],skillHistory:[[400650,400360],[400360],[],[220340],[]]});
  assert.equal(duplicates.modifiers.damagePercent,30);
});

test('Skill Flow caps at fifty percentage points and excludes the expired sixth bucket',()=>{
  const capped=analyze([12909],{currentSkillIds:[400650,400360,220340,401010,220010,401140],skillHistory:[]});
  assert.equal(capped.modifiers.damagePercent,50);
  const expired=analyze([12909],{currentSkillIds:[400650],skillHistory:[[400360],[],[],[],[],[]]});
  assert.equal(expired.modifiers.damagePercent,10,'Empty global turns still advance the five-turn window');
  assert.equal(analyze([12909],{currentSkillIds:[],skillHistory:[]}).modifiers.damagePercent,0);
});

test('the BreakDmgCalculation Skill Flow effect changes stagger only',()=>{
  const result=analyze([15109]);
  assert.equal(result.modifiers.breakPercent,30);
  assert.equal(result.breakFactor,1.3);
  assert.equal(result.modifiers.damagePercent,0);
  assert.equal(result.damageFactor,1);
});

test('native zero history window returns zero without context; negative windows remain unsupported',()=>{
  const effect=catalog.effects.find(effect=>effect.id===12909);
  const zero={...effect,params:[effect.params[0],effect.params[1],0,...effect.params.slice(3)]};
  const result=P.analyze({...catalog,effects:[zero]},[],{activeEffectIds:[12909]});
  assert.equal(result.modifiers.damagePercent,0);
  assert.equal(result.deferred.length+result.unsupported.length,0);
  const negative={...effect,params:[effect.params[0],effect.params[1],-1,...effect.params.slice(3)]};
  const excluded=P.analyze({...catalog,effects:[negative]},[],{activeEffectIds:[12909]});
  assert.equal(excluded.modifiers.damagePercent,0);
  assert.equal(excluded.unsupported.length,1);
});

test('unknown or malformed current/global skill history is deferred without a guessed bonus',()=>{
  for(const state of [
    {currentSkillIds:undefined},{skillHistory:undefined},{currentSkillIds:null},{skillHistory:null},
    {currentSkillIds:'400650'},{currentSkillIds:[400650,'220340']},{currentSkillIds:[NaN]},
    {skillHistory:[400650]},{skillHistory:[null]},{skillHistory:[[400650,{}]]},{skillHistory:[[Infinity]]},
  ]){
    const result=analyze([12909,15109],state);
    assert.equal(result.modifiers.damagePercent,0,JSON.stringify(state));
    assert.equal(result.modifiers.breakPercent,0,JSON.stringify(state));
    assert.equal(result.applied.length,0,JSON.stringify(state));
    assert.equal(result.deferred.length,2,JSON.stringify(state));
  }
});

test('Sharp Mind requires a native area target and exactly one actual target',()=>{
  for(const target of ['Group','All']){
    const result=analyze([12949],{skill:{...ultima,target},targetCount:1});
    assert.equal(result.modifiers.damagePercent,100);
    assert.equal(result.damageFactor,2);
  }
  for(const state of [{targetCount:2},{skill:{...ultima,target:'Single'},targetCount:1}]){
    const result=analyze([12949],state);
    assert.equal(result.modifiers.damagePercent,0);
    assert.equal(result.inactive.length,1);
  }
});

test('Sharp Mind does not invent an actual target count or native target category',()=>{
  for(const state of [{targetCount:undefined},{targetCount:NaN},{targetCount:'1'},{skill:{...ultima,target:undefined},targetCount:1}]){
    const result=analyze([12949],state);
    assert.equal(result.damageFactor,1);
    assert.equal(result.applied.length,0);
    assert.equal(result.deferred.length,1);
  }
});

test('Decimating Attacks retains actual target-count scaling beside Sharp Mind',()=>{
  assert.equal(analyze([12917],{targetCount:2}).modifiers.damagePercent,20);
  assert.equal(analyze([12917],{targetCount:1}).modifiers.damagePercent,10);
  assert.equal(analyze([12917,12949],{targetCount:2}).modifiers.damagePercent,20);
  assert.equal(analyze([12917,12949],{targetCount:1}).modifiers.damagePercent,110);
});

test('captured Sakura source instances reconstruct 3.3 for two targets and 4.2 for one',()=>{
  // Source FX ordering from the continuous native context capture; duplicate16011 are separate instances.
  //12945 is Magic Barrage's temporary -50%. This checks percent-bucket assembly, not native float32 bit equality.
  const ids=[12924,12909,16011,12917,16013,60000,12949,16067,16011,12945];
  for(const [targetCount,expected] of [[2,3.3],[1,4.2]]){
    const result=analyze(ids,{targetCount});
    assert.ok(Math.abs(result.damageFactor-expected)<1e-9,`Targets${targetCount}: ${result.damageFactor}`);
    assert.equal(result.applied.filter(term=>term.effectId===16011).length,2);
    assert.equal(result.unsupported.length+result.deferred.length,0);
  }
});

function simulatedHistory({rounds=2,mp=999,rotation=[401010,220010],passives=[1464],bonusId,reactionSkills,incomingDamage=0,barrage=false,passiveIdOccurrences,activeEffectIds=[],enemyCount=1}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const native={id:1,name:'History fixture',levelParamId:1,stats:{HitPoint:10000,MagicPoint:999,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:100},baseSkillEquipCost:500,passiveIds:[]};
  const cat={...catalog,skillRules:rules,characters:[native],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[]};
  const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:rotation,equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
  const enemy={id:999,name:'History target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Agility:0,Defence:100,Mind:100},resistances:{},passiveIds:[]};
  const phase=skillId=>{
    const skill=catalog.skills.find(s=>s.id===skillId),leaf={skillId,kind:skill.relation==='Enemies'?'attack':'support',actionIndex:0,context:{friendlyTargetId:1,activeEffectIds}};
    if(barrage){
      const leaves=Array.from({length:4},(_,i)=>({...leaf,depth:2,actionIndex:i,paymentSuppressed:i>0,context:{activeEffectIds:[...activeEffectIds,12945]}}));
      const wrappers=[{skillId:400650,kind:'wrapper',depth:0,context:{}},{skillId:400360,kind:'wrapper',depth:1,context:{}}];
      return {leaves,steps:[...wrappers,...leaves],mp:60+skill.cost};
    }
    return {leaves:[leaf],steps:[leaf],mp:skill.cost,reactionSkills};
  };
  const turn=phase(rotation[0]);
  const evaluation={damage:1,brokenDamage:1,breakDamage:0,availableMp:mp,turnMp:turn.mp,stats:{Agility:100,MaxHitPoint:10000,PhysicalDefense:20,MagicalDefense:20},limit:null,supportActions:[],
    actionPlan:{turn,rotationTurns:rotation.map(phase),bonusTurn:bonusId?phase(bonusId):undefined,characterId:1,equipment,passiveIds:passives,passiveIdOccurrences,maxHp:10000,maxMp:999}};
  return B.createModel(cat,snapshot,enemy,{goals:['damage'],rounds,incomingDamage,enemyCount}).evaluateParty([{characterId:1,equipment,evaluation}]);
}

test('simulation carries paid selections into current IDs, then resets history at the global round boundary',()=>{
  const result=simulatedHistory();
  const events=result.resourceEvents[1].filter(event=>event.kind!=='incoming');
  assert.equal(events.length,2);
  assert.deepEqual(events[0].context.currentSkillIds,[401010]);
  assert.deepEqual(events[0].context.skillHistory,[]);
  assert.deepEqual(events[1].context.currentSkillIds,[220010]);
  assert.deepEqual(events[1].context.skillHistory,[[401010]]);
  assert.equal(events[0].common.outgoingFactor,1.1);
  assert.equal(events[1].common.outgoingFactor,1.2);
});

test('normal and additional paid selections share one current cycle and one completed global bucket',()=>{
  const result=simulatedHistory({rotation:[401140],bonusId:401010});
  const events=result.resourceEvents[1].filter(event=>event.skillId);
  assert.equal(events.length,4);
  assert.deepEqual(events.map(event=>event.phase),['normal','additional','normal','additional']);
  assert.deepEqual(events[1].context.currentSkillIds,[401140,401010]);
  assert.deepEqual(events[1].context.skillHistory,[]);
  assert.equal(events[1].common.outgoingFactor,1.2);
  assert.deepEqual(events[3].context.currentSkillIds,[401140,401010]);
  assert.deepEqual(events[3].context.skillHistory,[[401140,401010]]);
});

test('paid Arms Akimbo and Magic Barrage wrappers enter Skill Flow before repeated Ultima leaves',()=>{
  const result=simulatedHistory({rounds:1,rotation:[220340],barrage:true});
  const events=result.resourceEvents[1].filter(event=>event.skillId===220340);
  assert.equal(events.length,4);
  assert.deepEqual(events[0].context.currentSkillIds,[400650,400360,220340]);
  assert.ok(events.every(event=>new Set(event.context.currentSkillIds).size===3));
  assert.ok(events.every(event=>event.common.outgoingFactor===0.8),'Three unique skills add30%; Magic Barrage subtracts50%');
  assert.deepEqual(events.map(event=>event.mpCost),[95,0,0,0]);
});

test('a triggered child rejected for MP does not enter the next successful reaction history',()=>{
  const result=simulatedHistory({rounds:1,mp:0,rotation:[400790],reactionSkills:[220340,401010],incomingDamage:100});
  const event=result.resourceEvents[1].find(event=>event.skillId===401010);
  assert.ok(event,'The zero-MP reaction remains legal after the unaffordable Ultima');
  assert.ok(result.resourceSkips[1].some(skip=>skip.skillId===220340 && /MP/.test(skip.reason)));
  assert.deepEqual(event.context.currentSkillIds,[400790,401010]);
  assert.equal(event.common.outgoingFactor,1.2);
});

test('live Magic Barrage leaves reconstruct captured Sakura modifiers for one and two actual targets',()=>{
  // Supply the observed active context, separating the two counted1310 sources from the other effects.
  // Combat stats and RNG are fixture values; only source assembly and live per-leaf multipliers are calibrated here.
  const activeEffectIds=[12924,12909,12917,16013,60000,12949,16067];
  for(const [enemyCount,expected] of [[2,3.3],[1,4.2]]){
    const result=simulatedHistory({rounds:1,rotation:[220340],barrage:true,passives:[1310],passiveIdOccurrences:[1310,1310],activeEffectIds,enemyCount});
    const leaves=result.resourceEvents[1].filter(event=>event.skillId===220340);
    assert.equal(leaves.length,4);
    assert.ok(leaves.every(leaf=>Math.abs(leaf.common.outgoingFactor-expected)<1e-9));
    assert.deepEqual(leaves[0].context.currentSkillIds,[400650,400360,220340]);
  }
});

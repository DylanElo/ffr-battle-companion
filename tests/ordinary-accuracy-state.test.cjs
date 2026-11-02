const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const native=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({skillIds=[414200],passives=[],rounds=1,mp=200,enemyBreak=1e12,broken=false,critical=false,statusResistances={},resistances={},enemyPassives=[],finishId=null,amelia=false}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:amelia?13017:-1};
  const character={...native.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:1000,MagicPoint:mp,Attack:300,Intelligence:200,Divine:30,Defence:30,Mind:30,Agility:50}};
  const catalog={...native,skillRules:rules,characters:[character],skills:native.skills.filter(row=>[...skillIds,finishId].includes(row.id)),
    visions:amelia?[native.visions.find(row=>row.id===13017)]:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...skillIds,...passives]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:amelia?[]:skillIds,equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:amelia?[{id:13017,awakeningPoints:1,sync:[{characterId:1001,points:0}]}]:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:enemyBreak,Defence:50,Mind:50,Agility:0},resistances,passiveIds:enemyPassives,statusResistances,skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,broken,critical,actionId:skillIds[0],includeSupportOptions:false,jointAbilityBudget:8});
  const input={characterId:1001,visionId:equipment.visionId,equipment};
  const fixed=()=>{const result=model.evaluate({...input,equippedSkillIds:passives});assert.equal(result.valid,true,JSON.stringify(result));return result;};
  const run=()=>{
    const leaves=skillIds.map((skillId,actionIndex)=>({skillId,kind:'attack',actionIndex,context:{}})),turn={leaves,steps:leaves};
    const evaluation={skillId:skillIds[0],turn,damage:0,brokenDamage:0,breakDamage:0,availableMp:mp,turnMp:0,
      stats:{Agility:50,MaxHitPoint:1000,MaxMagicPoint:mp,PhysicalDefense:30,MagicalDefense:30},supportActions:[],
      finish:finishId?{skillId:finishId,visionId:13000,name:'Native finish',kind:'damage',supported:true,mpCost:0,apCost:0,secondaryReasons:[]}:null,
      actionPlan:{turn,accuracyModeled:true,characterId:1001,equipment,passiveIds:passives,maxHp:1000,maxMp:mp}};
    return model.evaluateParty([{...input,evaluation}]);
  };
  return {catalog,snapshot,enemy,model,input,fixed,run};
}
function hitControl(decide,run){const original=D.skillHitSuccess,calls=[];D.skillHitSuccess=(chance,roll,options)=>{calls.push(chance);return decide(chance,roll,options,calls.length);};try{return {result:run(),calls};}finally{D.skillHitSuccess=original;}}
const attacks=events=>events.filter(row=>row.context?.attackHitOutcomes);

test('ordinary misses spend HP/MP and retain completion/history without granting damage, stagger or critical state',()=>{
  const z=fixture({skillIds:[400490,220010],passives:[1421],rounds:2,enemyBreak:1,enemyPassives:[1085,1086],critical:true});
  const {result,calls}=hitControl(()=>false,z.run),events=attacks(result.resourceEvents[1001]);
  assert.equal(result.damage,0);assert.equal(result.breakDamage,0);assert.equal(result.staggers,0);
  assert.equal(result.hpSpent[1001],100);assert.equal(result.remainingHp[1001],900);assert.equal(result.remainingMp[1001],190);
  assert.deepEqual(events.map(row=>row.context.completedNormalAttackCount),[0,1,1,2]);
  assert.deepEqual(events[2].context.skillHistory,[[400490,220010]]);
  assert.ok(events.every(row=>row.context.anyHit===false&&row.context.anyCritical===false&&row.context.attackHitOutcomes.every(hit=>!hit)&&row.damage===0&&row.breakDamage===0));
  assert.ok(result.phaseEvents[1001].every(row=>row.kind!=='bonus-granted'));
  assert.ok(calls.every(chance=>chance===100));
});

test('an all-miss critical-requested Warp-Strike cannot grant an any-critical additional action',()=>{
  const z=fixture({skillIds:[447810],critical:true,enemyBreak:1,enemyPassives:[1085]});
  const {result,calls}=hitControl(chance=>chance!==100,z.run);
  assert.equal(result.damage,0);assert.equal(result.breakDamage,0);assert.equal(result.remainingMp[1001],185);
  assert.equal(calls.includes(25),false,'the post-hit phase proc is not rolled for an all-miss action');
  assert.equal(result.phaseEvents[1001].some(row=>row.kind==='bonus-granted'),false);
  assert.ok(attacks(result.resourceEvents[1001]).every(row=>row.context.anyCritical===false));
});

test('Amelia Rapid Fire rolls free Dual Guns admission before original accuracy and can repeat an all-miss original',()=>{
  const z=fixture({amelia:true,enemyBreak:1});
  const {result,calls}=hitControl(chance=>chance===25,z.fixed);
  assert.equal(result.actionCount,2);assert.equal(result.skillCost,0,'Rapid Fire and Dual Guns are native reached-Awakening free grants');
  assert.equal(result.fightDamage,0);assert.equal(result.fightBreakDamage,0);assert.equal(result.remainingMp,164);
  const events=result.resourceEvents.filter(row=>row.skillId===414200);
  assert.equal(events.length,2);assert.deepEqual(events.map(row=>[row.mpBefore,row.mpCost,row.mpAfter]),[[200,18,182],[182,18,164]]);
  assert.ok(events.every(row=>row.context.attackHitOutcomes.length===4&&row.context.attackHitOutcomes.every(hit=>!hit)));
  assert.equal(result.phaseEvents.some(row=>row.kind==='bonus-granted'),false);
  assert.equal(calls.length,result.combatSamples*9);
  for(let i=0;i<calls.length;i+=9)assert.deepEqual(calls.slice(i,i+9),[25,85,85,85,85,85,85,85,85]);
});

test('admitted Dual Guns checks clone affordability after the original pays, without precharging two casts',()=>{
  const z=fixture({amelia:true,mp:27});
  const {result,calls}=hitControl(chance=>chance===25,z.fixed);
  assert.equal(result.turn.selectionMp,18);assert.equal(result.remainingMp,9);
  assert.deepEqual(result.resourceEvents.filter(row=>row.mpCost>0).map(row=>[row.mpBefore,row.mpCost,row.mpAfter]),[[27,18,9]]);
  assert.ok(result.resourceSkips.some(row=>/Insufficient MP/.test(row.reason)));
  assert.equal(calls.length,result.combatSamples*5);
  for(let i=0;i<calls.length;i+=5)assert.deepEqual(calls.slice(i,i+5),[25,85,85,85,85]);
});

test('None-status immunity precedes already-staggered accuracy bypass and produces no hit draws or critical grants',()=>{
  const z=fixture({broken:true,critical:true,statusResistances:{None:100}});
  const {result,calls}=hitControl(()=>true,z.run);
  assert.equal(calls.length,0);assert.equal(result.damage,0);assert.equal(result.breakDamage,0);
  assert.ok(attacks(result.resourceEvents[1001]).every(row=>row.context.anyHit===false&&row.context.anyCritical===false));
});

test('Halved and Absorb resistance suppress ordinary critical results even when critical is requested',()=>{
  for(const resistance of ['Halved','Absorb']){
    const z=fixture({critical:true,resistances:{Fire:resistance}});
    const {result}=hitControl(()=>true,z.run),rows=attacks(result.resourceEvents[1001]);
    assert.ok(rows.length>0);assert.ok(rows.every(row=>row.context.anyHit===true&&row.context.anyCritical===false&&row.context.criticalOutcomes.every(critical=>!critical)));
    if(resistance==='Absorb'){assert.equal(result.damage,0);assert.equal(result.breakDamage,0);}else assert.ok(result.damage>0);
  }
});

test('stagger during the first Rapid Fire part skips later ordinary rolls; Additional and Finish still roll critical outcomes',()=>{
  const original=D.criticalProbability;D.criticalProbability=()=>.5;
  try{
    const z=fixture({enemyBreak:1,finishId:440060});
    const {result,calls}=hitControl(()=>true,z.run),events=attacks(result.resourceEvents[1001]);
    assert.equal(calls.length,result.combatSamples,'only the first ordinary part is checked before the target becomes staggered');
    assert.ok(calls.every(chance=>chance===85));
    assert.deepEqual(events.map(row=>row.phase),['normal','additional','finish']);
    assert.ok(events.every(row=>row.context.attackHitOutcomes.every(Boolean)));
    const bypass=events.filter(row=>row.phase!=='normal'),criticalOutcomes=bypass.flatMap(row=>row.context.criticalOutcomes);
    assert.ok(criticalOutcomes.some(Boolean)&&criticalOutcomes.some(value=>!value),'phase accuracy bypass does not guarantee criticals');
  }finally{D.criticalProbability=original;}
});


function immuneCallParty(finishId=440060,rounds=1){
  const z=fixture({broken:true,critical:true,statusResistances:{None:100},finishId});
  const caller={...z.catalog.characters[0],id:1002,stats:{...z.catalog.characters[0].stats,Agility:1000000}};
  const catalog={...z.catalog,characters:[...z.catalog.characters,caller],skills:[...z.catalog.skills,native.skills.find(row=>row.id===401140)]};
  const snapshot={...z.snapshot,characters:[...z.snapshot.characters,{...z.snapshot.characters[0],id:1002,activeSkillIds:[401140]}],party:[1002,1001]};
  const member=(id,skillId,kind)=>{
    const leaf={skillId,kind,actionIndex:0,context:kind==='support'?{friendlyTargetId:1001}:{}},turn={leaves:[leaf],steps:[leaf]};
    return {characterId:id,equipment:z.input.equipment,evaluation:{skillId,turn,damage:0,brokenDamage:0,breakDamage:0,availableMp:200,turnMp:0,
      stats:{Agility:id===1002?1000000:50,MaxHitPoint:1000,MaxMagicPoint:200,PhysicalDefense:30,MagicalDefense:30},supportActions:[],
      finish:id===1001?{skillId:finishId,visionId:13000,name:'Native Finish',kind:'damage',supported:true,mpCost:0}:null,
      actionPlan:{turn,accuracyModeled:id===1001,characterId:id,equipment:z.input.equipment,passiveIds:[],maxHp:1000,maxMp:200}}};
  };
  const model=B.createModel(catalog,snapshot,z.enemy,{goals:['damage'],rounds,broken:true,critical:true,includeSupportOptions:false});
  return hitControl(()=>true,()=>model.evaluateParty([member(1001,414200,'attack'),member(1002,401140,'support')]));
}

test('None-status immunity also precedes Additional and Finish bypass after a real Call to Action grant',()=>{
  const {result,calls}=immuneCallParty();
  const rows=attacks(result.resourceEvents[1001]);
  assert.deepEqual(rows.map(row=>row.phase),['normal','additional','finish']);
  assert.ok(rows.every(row=>row.context.anyHit===false&&row.context.anyCritical===false&&row.damage===0&&row.breakDamage===0));
  assert.equal(result.damage,0);assert.equal(result.breakDamage,0);
  assert.ok(calls.length>0&&calls.every(chance=>chance===100),'only the actual Call grant is rolled; offensive ordinary checks remain blocked by immunity');
});


test('an all-miss Crystal Braver does not install its AfterDamageCalculation Protect status',()=>{
  const {result}=immuneCallParty(440010,2),rows=attacks(result.resourceEvents[1001]);
  assert.equal(rows.filter(row=>row.skillId===440010).length,2,'the native Finish was selected and completed in each phase cycle');
  assert.ok(rows.every(row=>row.context.anyHit===false));
  assert.ok(rows.every(row=>row.context.sameSideProtectCount===0),'missed damage never dispatches the self Protect post-damage bundle');
});

test('an all-miss Cecil Finish does not grant its post-damage one-use guard',()=>{
  const {result}=immuneCallParty(440040);
  assert.ok(attacks(result.resourceEvents[1001]).some(row=>row.skillId===440040&&row.context.anyHit===false));
  assert.equal(result.resourceEvents[1001].some(row=>row.kind==='finish-protection'),false);
  assert.deepEqual(result.remainingGuards[1001],[]);
});

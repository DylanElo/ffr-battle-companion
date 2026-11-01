const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const S=require('../docs/stats.js');
const Search=require('../docs/search.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

const IMBUE=90001,FIRE_POWER=90002,FLAT_STR=90003,PERCENT_STR=90004;
const sorted=ids=>ids.slice().sort((a,b)=>a-b);

function passive(id,effectId,cost=20){
  const base=source.passives.find(row=>row.id===1310);
  const bundle=base.effectBundles.find(row=>row.effectId===16011);
  return {...base,id,name:`Joint fixture ${id}`,equipCost:cost,effects:[effectId],
    effectBundles:[{...bundle,effectId}]};
}

function fixture(passives,effects,{budget=40}={}){
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:budget,
    stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
  const attack=source.skills.find(row=>row.id===401010);
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const catalog={...source,skillRules:rules,characters:[character],skills:[attack],passives,effects,masterSkills:[],visions:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:passives.map(row=>row.id)}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:[401010],equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'},artifactOverrides:[]};
  const enemy={id:999,name:'Neutral joint fixture',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:50,Mind:50,Agility:0},
    resistances:{},passiveIds:[],skillIds:[]};
  const options={jointOptimization:true,goals:['damage'],difficulty:'Normal',rounds:1,includeSupportOptions:false};
  return {catalog,snapshot,enemy,options,input:{characterId:1001,visionId:-1,equipment}};
}

function evaluateFixed(model,input,ids){
  const result=model.evaluate({...input,equippedSkillIds:ids});
  assert.equal(result.valid,true,JSON.stringify(result));
  return result;
}

test('a full-AP warm start cannot hide a later history-scaled passive behind depth-first combinations',()=>{
  const flow=source.effects.find(effect=>effect.id===12909);
  const effects=[source.effects.find(effect=>effect.id===16001),
    {...flow,id:92001,params:[1,50,5,...flow.params.slice(3)]},
    {...flow,id:92002,params:[50,50,5,...flow.params.slice(3)]}];
  const passives=[passive(90000,16001),...Array.from({length:30},(_,i)=>passive(90001+i,i===29?92002:92001))];
  const f=fixture(passives,effects,{budget:20});
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const strongest=evaluateFixed(model,f.input,[90030]);
  const warm=evaluateFixed(model,f.input,[90000]);
  assert.ok(strongest.score>warm.score,'native Skill Flow uses the paid current action history');
  const chosen=model.evaluate(f.input);
  assert.equal(chosen.valid,true);
  assert.deepEqual(chosen.equippedSkillIds,[90030]);
  assert.equal(chosen.score,strongest.score);
  assert.equal(chosen.skillCost,20);
  assert.equal(chosen.jointPassiveCoverage.complete,true);
  assert.equal(chosen.jointPassiveCoverage.eligibleIds.length,31);
  assert.deepEqual(chosen.jointPassiveCoverage.omittedIds,[]);
});

test('refinement tries an owned high-ID Spirit alongside useful direct damage passives',()=>{
  const direct=[passive(90000,16001),...Array.from({length:100},(_,i)=>passive(90001+i,16021))];
  const spirit=source.masterSkills.find(row=>row.id===1310200); // Native Spirit of Onion Knight.
  const granted=source.passives.filter(row=>spirit.grants.passiveIds.includes(row.id));
  const effectIds=new Set([16001,16021,...granted.flatMap(row=>row.effects)]);
  const f=fixture(direct,source.effects.filter(row=>effectIds.has(row.id)),{budget:120});
  f.catalog.passives.push(...granted);
  f.catalog.masterSkills=[spirit];
  f.catalog.visions=[{id:13102,awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:spirit.id,value:-1}]}]}];
  f.snapshot.resonances=[{id:13102,sync:[{characterId:1001,points:1}],awakeningPoints:0}];
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const baseline=evaluateFixed(model,f.input,[90000]);
  const result=model.evaluate(f.input);
  assert.equal(result.valid,true);
  assert.ok(result.equippedSkillIds.includes(90000));
  assert.ok(result.equippedSkillIds.includes(spirit.id));
  assert.ok(result.fightDamage>baseline.fightDamage);
  assert.ok(result.jointPassiveCoverage.triedIds.includes(spirit.id));
  assert.ok(result.skillCost<=result.skillBudget);
});

test('joint selection finds an imbue and elemental power pair with zero standalone benefit',()=>{
  // Native1147 imbues Fire only onto None; native12955 adds20% Fire damage.
  const f=fixture([passive(IMBUE,1147),passive(FIRE_POWER,12955)],
    [1147,12955].map(id=>source.effects.find(row=>row.id===id)));
  const before=JSON.stringify({catalog:f.catalog,snapshot:f.snapshot});
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const empty=evaluateFixed(model,f.input,[]);
  const imbue=evaluateFixed(model,f.input,[IMBUE]);
  const power=evaluateFixed(model,f.input,[FIRE_POWER]);
  const paired=evaluateFixed(model,f.input,[IMBUE,FIRE_POWER]);
  assert.equal(imbue.score,empty.score,'neutral Fire conversion alone has no score gain');
  assert.equal(power.score,empty.score,'Fire-only damage alone is inactive on None');
  assert.ok(paired.score>empty.score,'the complete pair has a supported positive effect');
  const chosen=model.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.deepEqual(sorted(chosen.equippedSkillIds),[IMBUE,FIRE_POWER]);
  assert.equal(chosen.score,paired.score);
  assert.equal(chosen.skillCost,40);
  assert.equal(JSON.stringify({catalog:f.catalog,snapshot:f.snapshot}),before);
});

test('internal refinement scores only the completed recipe while preserving pins and recalculating its abilities',()=>{
  const f=fixture([passive(IMBUE,1147),passive(FIRE_POWER,12955)],
    [1147,12955].map(id=>source.effects.find(row=>row.id===id)));
  const initial=B.createModel(f.catalog,f.snapshot,f.enemy,{...f.options,jointAbilityBudget:1}).evaluate(f.input);
  const before=JSON.stringify(initial);
  const refined=B.createModel(f.catalog,f.snapshot,f.enemy,f.options).evaluate({...f.input,
    refineEvaluation:initial,lockedSkillIds:[IMBUE],evaluationTimeMs:1000});
  assert.equal(refined.valid,true,JSON.stringify(refined));
  assert.equal(refined.skillId,initial.skillId);
  assert.deepEqual(refined.turn,initial.turn);
  assert.deepEqual(sorted(refined.equippedSkillIds),[IMBUE,FIRE_POWER]);
  assert.ok(refined.score>initial.score);
  assert.equal(refined.skillCost,40);
  assert.equal(refined.jointPassiveCoverage.complete,true);
  assert.equal(JSON.stringify(initial),before);
  const limited=B.createModel(f.catalog,f.snapshot,f.enemy,{...f.options,jointAbilityBudget:1}).evaluate({...f.input,
    refineEvaluation:initial,lockedSkillIds:[IMBUE]});
  assert.equal(limited.valid,true);
  assert.ok(limited.equippedSkillIds.includes(IMBUE));
  assert.ok(limited.jointAbilityEvaluations<=1);
  const invalid=B.createModel(f.catalog,f.snapshot,f.enemy,f.options).evaluate({...f.input,
    refineEvaluation:{...initial,equippedSkillIds:[99999999]}});
  assert.equal(invalid.valid,false);
  assert.match(invalid.reason,/refinement/);
});

test('joint packages use actual gear and do not reuse the saved-gear package across loadouts',()=>{
  // Native continuous-parameter layout: STR5, variation0 flat / variation2 percent.
  const native=source.effects.find(row=>row.id===1341);
  const flat={...native,id:91001,params:[200,5,0,...native.params.slice(3)]};
  const percent={...native,id:91002,params:[100,5,2,...native.params.slice(3)]};
  const f=fixture([passive(FLAT_STR,flat.id),passive(PERCENT_STR,percent.id)],[flat,percent],{budget:20});
  f.enemy.stats.Defence=2000; // Keep both actual-gear choices inside the native non-saturated attack curve.
  f.catalog.equipment=[{id:10,name:'STR gear fixture',type:'Weapon',detailType:'Sword',sexLimit:'None',stats:{Attack:1000},passiveIds:[]}];
  f.snapshot.inventory=[{id:10,quantity:1}];
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const lowFlat=evaluateFixed(model,f.input,[FLAT_STR]);
  const lowPercent=evaluateFixed(model,f.input,[PERCENT_STR]);
  assert.ok(lowFlat.score>lowPercent.score,'flat STR wins on the saved low-STR gear');
  const actual={...f.input,equipment:{...f.input.equipment,weaponId:10}};
  const highFlat=evaluateFixed(model,actual,[FLAT_STR]);
  const highPercent=evaluateFixed(model,actual,[PERCENT_STR]);
  assert.ok(highPercent.score>highFlat.score);
  const low=model.evaluate(f.input);
  assert.equal(low.valid,true,JSON.stringify(low));
  assert.deepEqual(low.equippedSkillIds,[FLAT_STR]);
  const high=model.evaluate(actual);
  assert.equal(high.valid,true,JSON.stringify(high));
  assert.deepEqual(high.equippedSkillIds,[PERCENT_STR]);
  assert.equal(high.score,highPercent.score);
  assert.deepEqual(model.evaluate(f.input).equippedSkillIds,[FLAT_STR],'returning to low gear must reuse only its own result');
  const pinned=model.evaluate({...f.input,lockedSkillIds:[PERCENT_STR]});
  assert.equal(pinned.valid,true);
  assert.deepEqual(pinned.equippedSkillIds,[PERCENT_STR],'the stronger unpinned result cannot replace a pin');
  assert.deepEqual(evaluateFixed(model,actual,[FLAT_STR]).equippedSkillIds,[FLAT_STR],'fixed scoring preserves the supplied physical loadout');
});

test('a direct passive and selected Spirit retain separate effects, AP costs and slots',()=>{
  const f=fixture([source.passives.find(row=>row.id===1310)],[source.effects.find(row=>row.id===16011)],{budget:200});
  const spirit=source.masterSkills.find(row=>row.id===1312700);
  f.catalog.masterSkills=[{...spirit,grants:{activeIds:[],passiveIds:[1310]}}];
  f.catalog.visions=[{id:13127,awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:1312700,value:-1}]}]}];
  f.snapshot.resonances=[{id:13127,sync:[{characterId:1001,points:1}],awakeningPoints:0}];
  // Magic-only native1310 requires a magic attack; use the captured Ultima row.
  f.catalog.skills=[{...source.skills.find(row=>row.id===220340),cost:0,accuracy:100}];
  f.snapshot.characters[0].activeSkillIds=[220340];
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const only=evaluateFixed(model,f.input,[1312700]);
  const both=evaluateFixed(model,f.input,[1312700,1310]);
  assert.equal(only.passiveAnalysis.damageFactor,1.1);
  assert.equal(both.passiveAnalysis.damageFactor,1.2);
  assert.ok(both.score>only.score);
  const expectedCost=spirit.equipCost+f.catalog.passives[0].equipCost;
  assert.equal(both.skillCost,expectedCost);
  const chosen=model.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.deepEqual(sorted(chosen.equippedSkillIds),[1310,1312700]);
  assert.equal(chosen.skillCost,expectedCost);
  assert.equal(chosen.passiveAnalysis.applied.filter(row=>row.effectId===16011).length,2);
  const pool=S.learned(f.catalog,f.snapshot,1001,-1);
  assert.ok(chosen.equippedSkillIds.every(id=>[...pool.learnedPassiveIds,...pool.masterSkillIds].includes(id)));
});

test('a selected Spirit supplies the required active without charging its AP or slot twice',()=>{
  const f=fixture([source.passives.find(row=>row.id===1310)],[source.effects.find(row=>row.id===16011)],{budget:95});
  const spirit=source.masterSkills.find(row=>row.id===1312700);
  const ultima={...source.skills.find(row=>row.id===220340),cost:0,accuracy:100};
  f.catalog.skills=[ultima];
  f.catalog.masterSkills=[{...spirit,grants:{activeIds:[220340],passiveIds:[1310]}}];
  f.catalog.visions=[{id:13127,awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:1312700,value:-1}]}]}];
  f.catalog.statGrowth[1].rows[0].skillIds=[];
  f.snapshot.characters[0].activeSkillIds=[];
  f.snapshot.resonances=[{id:13127,sync:[{characterId:1001,points:1}],awakeningPoints:0}];
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const chosen=model.evaluate({...f.input,lockedSkillIds:[1312700]});
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.equal(chosen.skillId,220340);
  assert.deepEqual(chosen.equippedSkillIds,[1312700]);
  assert.equal(chosen.skillCost,spirit.equipCost);
  assert.equal(chosen.equippedSkillIds.length,1);
  assert.equal(model.evaluate({...f.input,equippedSkillIds:[]}).valid,false,'the unlearned active is not available without its physical Spirit source');
});

test('physical active pins keep their AP and slot even when a selected Spirit grants the same action',async()=>{
  const {applyBuildResult,learnedForBuild}=await import('../docs/abilities.js');
  const pins=[1312700,220340];
  for(const budget of [95,105]){
    const f=fixture([source.passives.find(row=>row.id===1310)],[source.effects.find(row=>row.id===16011)],{budget});
    const spirit=source.masterSkills.find(row=>row.id===1312700);
    f.catalog.skills=[{...source.skills.find(row=>row.id===220340),cost:0,accuracy:100}];
    f.catalog.masterSkills=[{...spirit,grants:{activeIds:[220340],passiveIds:[1310]}}];
    f.catalog.visions=[{id:13127,awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:1312700,value:-1}]}]}];
    f.catalog.statGrowth[1].rows[0].skillIds=[220340];
    f.snapshot.characters[0].activeSkillIds=[];
    f.snapshot.resonances=[{id:13127,sync:[{characterId:1001,points:1}],awakeningPoints:0}];
    const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
    const granted=model.evaluate({...f.input,lockedSkillIds:[1312700]});
    assert.equal(granted.valid,true);
    assert.deepEqual(granted.equippedSkillIds,[1312700]);
    assert.equal(granted.skillCost,95,'an unpinned granted action still has no separate physical slot');
    const chosen=model.evaluate({...f.input,lockedSkillIds:pins});
    if(budget===95){
      assert.equal(chosen.valid,false,'a physical AP10 active pin cannot disappear to make the AP95 Spirit fit');
      continue;
    }
    assert.equal(chosen.valid,true,JSON.stringify(chosen));
    assert.deepEqual(sorted(chosen.equippedSkillIds),sorted(pins));
    assert.equal(chosen.skillCost,105);
    assert.equal(chosen.equippedSkillIds.length,2);
    const draft={...f.input.equipment,equippedSkillIds:pins,
      locks:{vision:false,weapon:false,armor:false,accessories:[],skillIds:pins}};
    const indexes=Object.fromEntries(['skills','passives','masterSkills','equipment'].map(key=>[key,new Map(f.catalog[key].map(row=>[row.id,row]))]));
    const applied=applyBuildResult(draft,{equipment:f.input.equipment,visionId:-1,evaluation:chosen},
      next=>learnedForBuild(S,f.catalog,f.snapshot,1001,next),indexes);
    assert.deepEqual(applied.dropped,[],'applying the scored build must not drop a physical pin');
    assert.deepEqual(sorted(applied.draft.equippedSkillIds),sorted(chosen.equippedSkillIds),'applying must not silently add an unscored slot');
    assert.deepEqual(applied.draft.locks.skillIds,pins);
  }
});

test('a tiny joint budget retains a fully scored affordable incumbent and marks the unfinished search',()=>{
  const f=fixture([passive(IMBUE,1147),passive(FIRE_POWER,12955)],
    [1147,12955].map(id=>source.effects.find(row=>row.id===id)));
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,{...f.options,jointAbilityBudget:1});
  const chosen=model.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.equal(chosen.jointSearchTruncated,true);
  assert.ok(chosen.jointAbilityEvaluations<=1);
  assert.equal(chosen.jointPassiveCoverage.complete,false);
  assert.ok(chosen.jointPassiveCoverage.omittedIds.length>0);
  assert.deepEqual(sorted([...chosen.jointPassiveCoverage.triedIds,...chosen.jointPassiveCoverage.omittedIds]),
    chosen.jointPassiveCoverage.eligibleIds);
  assert.ok(chosen.skillCost<=chosen.skillBudget);
  assert.ok(chosen.equippedSkillIds.length<=chosen.maxSkillSlots);
  const fixed=evaluateFixed(model,f.input,chosen.equippedSkillIds);
  assert.equal(chosen.score,fixed.score,'the incumbent is a complete simulated loadout, not a partial-set bound');
  assert.ok(chosen.warnings.some(warning=>/best fully scored combination/.test(warning)));
});

test('joint accessory and ability search matches complete native-scored brute force on a small space',()=>{
  const native=source.effects.find(row=>row.id===1341);
  const flat={...native,id:91001,params:[200,5,0,...native.params.slice(3)]};
  const percent={...native,id:91002,params:[100,5,2,...native.params.slice(3)]};
  const f=fixture([passive(FLAT_STR,flat.id),passive(PERCENT_STR,percent.id)],[flat,percent],{budget:20});
  f.enemy.stats.Defence=2000;
  f.input.equipment.accessoryIds=[-1];
  f.catalog.equipment=[
    {id:10,name:'STR accessory',type:'Accessory',detailType:'Accessory',sexLimit:'None',stats:{Attack:1000},passiveIds:[]},
    {id:11,name:'Attack accessory',type:'Accessory',detailType:'Accessory',sexLimit:'None',stats:{PhysicalAttack:100},passiveIds:[]},
  ];
  f.snapshot.inventory=[{id:10,quantity:1},{id:11,quantity:1}];
  const model=B.createModel(f.catalog,f.snapshot,f.enemy,f.options);
  const brute=[];
  for(const accessory of [-1,10,11])for(const abilities of [[],[FLAT_STR],[PERCENT_STR]]){
    const equipment={...f.input.equipment,accessoryIds:[accessory]};
    const evaluation=model.evaluate({...f.input,equipment,equippedSkillIds:abilities});
    if(evaluation.valid)brute.push({accessory,abilities,score:evaluation.score});
  }
  brute.sort((a,b)=>b.score-a.score);
  const candidates=Search.buildCandidates(f.catalog,f.snapshot,1001,{evaluate:args=>model.evaluate(args),enemy:f.enemy},
    {jointOptimization:true,visionIds:[-1],timeMs:0,maxEvaluations:100,perLoadoutBudget:100,candidatesPerVision:100});
  candidates.sort((a,b)=>b.score-a.score);
  assert.equal(candidates[0].score,brute[0].score);
  assert.deepEqual(candidates[0].equipment.accessoryIds,[brute[0].accessory]);
  assert.deepEqual(candidates[0].evaluation.equippedSkillIds,brute[0].abilities);
  assert.equal(brute[0].accessory,10);
  assert.deepEqual(brute[0].abilities,[PERCENT_STR]);
});

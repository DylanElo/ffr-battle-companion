const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function passive(id,effectId,cost=40){
  const base=source.passives.find(row=>row.id===1310);
  return {...base,id,equipCost:cost,effects:[effectId],effectBundles:[{...base.effectBundles.find(row=>row.effectId===16011),effectId}]};
}
function fixture(){
  const template=source.effects.find(row=>row.id===1341);
  const effects=[{...template,id:91001,params:[100,1,2,...template.params.slice(3)]},
    {...template,id:91002,params:[1000,5,0,...template.params.slice(3)]}];
  const passives=[passive(90001,91001),passive(90002,91002)];
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:40,
    stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const catalog={...source,skillRules:rules,characters:[character],skills:[source.skills.find(row=>row.id===401010)],passives,effects,
    visions:[],masterSkills:[],equipment:[],artifacts:[],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:passives.map(row=>row.id)}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:[401010],equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'},artifactOverrides:[]};
  const enemy={id:999,name:'Requirements fixture',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:2000,Mind:50,Agility:0},
    resistances:{},passiveIds:[],skillIds:[]};
  const options={jointOptimization:true,goals:['damage'],difficulty:'Normal',rounds:1,includeSupportOptions:false};
  return {catalog,snapshot,enemy,options,input:{characterId:1001,visionId:-1,equipment}};
}
const model=(f,extra={})=>B.createModel(f.catalog,f.snapshot,f.enemy,{...f.options,...extra});

test('default action and empty requirements retain the existing automatic result',()=>{
  const f=fixture(),before=JSON.stringify({catalog:f.catalog,snapshot:f.snapshot});
  const implicit=model(f).evaluate(f.input);
  const explicit=model(f,{actionId:0,requirements:{minHp:0,survive:false,element:''}}).evaluate(f.input);
  assert.equal(implicit.valid,true);
  assert.equal(explicit.score,implicit.score);
  assert.deepEqual(explicit.equippedSkillIds,implicit.equippedSkillIds);
  assert.deepEqual(explicit.requirementChecks,[]);
  assert.equal(JSON.stringify({catalog:f.catalog,snapshot:f.snapshot}),before);
});

test('minimum HP is inclusive and is checked on complete assignments instead of pruning their prefixes',()=>{
  const f=fixture();
  const automatic=model(f).evaluate(f.input);
  assert.deepEqual(automatic.equippedSkillIds,[90002]);
  const constrained=model(f,{requirements:{minHp:2000}});
  const chosen=constrained.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.deepEqual(chosen.equippedSkillIds,[90001],'the initial 1000-HP prefix must remain expandable');
  assert.equal(chosen.stats.MaxHitPoint,2000);
  assert.deepEqual(chosen.requirementChecks,[{key:'minHp',label:'Minimum HP',met:true,actual:2000,minimum:2000}]);
  assert.equal(constrained.evaluate({...f.input,equippedSkillIds:[]}).valid,false);
  const impossible=model(f,{requirements:{minHp:2001}}).evaluate(f.input);
  assert.equal(impossible.valid,false);
  assert.match(impossible.reason,/Minimum HP/);
});

test('survival chooses a living complete fight over a higher damage setup and exposes exact durability',()=>{
  const f=fixture(),incomingDamage=1500;
  const dying=model(f,{incomingDamage}).evaluate(f.input);
  assert.deepEqual(dying.equippedSkillIds,[90002]);
  assert.equal(dying.remainingHp,0);
  const chosen=model(f,{incomingDamage,requirements:{survive:true},goals:['damage','durability']}).evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.deepEqual(chosen.equippedSkillIds,[90001]);
  assert.ok(chosen.remainingHp>0);
  assert.ok(chosen.minimumRemainingHp>0);
  assert.equal(chosen.requirementChecks.find(row=>row.key==='survive').actual,chosen.minimumRemainingHp);
  assert.equal(chosen.score,chosen.fightDamage/f.enemy.stats.MaxHitPoint+chosen.durability/f.enemy.stats.MaxHitPoint);
  const noIncoming=model(f,{requirements:{survive:true}});
  assert.match(noIncoming.requestError,/Configure incoming damage/);
  assert.equal(noIncoming.evaluate(f.input).valid,false);
});

test('required element uses effective imbues and rejects a fixed loadout that misses it',()=>{
  const f=fixture();
  f.catalog.passives=[passive(90001,1147,20)];
  f.catalog.effects=[source.effects.find(row=>row.id===1147)];
  f.catalog.statGrowth[1].rows[0].skillIds=[90001];
  const fire=model(f,{requirements:{element:'Fire'}});
  const chosen=fire.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.deepEqual(chosen.equippedSkillIds,[90001]);
  assert.deepEqual(chosen.damageElements,['Fire']);
  assert.equal(chosen.requirementChecks.find(row=>row.key==='element').met,true);
  assert.equal(fire.evaluate({...f.input,equippedSkillIds:[]}).valid,false);
  const none=model(f,{requirements:{element:'None'}}).evaluate(f.input);
  assert.equal(none.valid,true);
  assert.deepEqual(none.equippedSkillIds,[]);
  const ice=model(f,{requirements:{element:'Ice'}}).evaluate(f.input);
  assert.equal(ice.valid,false);
  assert.match(ice.reason,/Damage element/);
});

test('requested ordinary action overrides automatic damage choice and refuses unknown or unavailable actions',()=>{
  const f=fixture(),fire={...source.skills.find(row=>row.id===220010),cost:0,accuracy:100,mag:1};
  const ice={...source.skills.find(row=>row.id===220040),cost:0,accuracy:100};
  f.catalog.skills.push(fire,ice);
  f.snapshot.characters[0].activeSkillIds.push(fire.id);
  assert.equal(model(f).evaluate(f.input).skillId,401010);
  const selected=model(f,{actionId:fire.id}).evaluate(f.input);
  assert.equal(selected.valid,true,JSON.stringify(selected));
  assert.equal(selected.skillId,fire.id);
  assert.deepEqual(selected.damageElements,['Fire']);
  const unknown=model(f,{actionId:999999}).evaluate(f.input);
  assert.equal(unknown.valid,false);assert.match(unknown.reason,/unknown/);
  const unavailable=model(f,{actionId:ice.id}).evaluate(f.input);
  assert.equal(unavailable.valid,false);assert.match(unavailable.reason,/not an available/);
});

test('element requirements reject mixed damaging leaves even when the main leaf matches',()=>{
  const f=fixture();
  f.catalog.characters[0].stats.MagicPoint=31;
  f.enemy.stats.MaxBreakPoint=100;
  f.catalog.passives=[];f.catalog.effects=[];f.catalog.statGrowth[1].rows[0].skillIds=[];
  f.catalog.skills=[{...source.skills.find(row=>row.id===220010),cost:30,mag:120,breakDmg:0,accuracy:100,criticalHitRate:0},
    {...source.skills.find(row=>row.id===220010),id:910002,name:'Ice breaker',element:'Ice',cost:1,mag:1,breakDmg:100,accuracy:100,criticalHitRate:0},
    {...source.skills.find(row=>row.id===400730),cost:0}];
  f.snapshot.characters[0].activeSkillIds=f.catalog.skills.map(row=>row.id);
  const mixed=model(f).evaluate(f.input);
  assert.equal(mixed.valid,true,JSON.stringify(mixed));
  assert.ok(mixed.turn.leaves.some(leaf=>leaf.skillId===220010));
  assert.ok(mixed.turn.leaves.some(leaf=>leaf.skillId===910002),'the unconstrained optimum uses the affordable mixed command');
  const fire=model(f,{requirements:{element:'Fire'}}).evaluate(f.input);
  assert.equal(fire.valid,true,JSON.stringify(fire));
  assert.deepEqual(fire.damageElements,['Fire']);
  assert.ok(fire.turn.leaves.every(leaf=>leaf.skillId!==910002),'a matching main leaf cannot excuse an Ice child');
});

test('requested Spirit-granted action requires a selected physical grant source',()=>{
  const f=fixture(),spirit=source.masterSkills.find(row=>row.id===1312700);
  f.catalog.characters[0].baseSkillEquipCost=95;
  f.catalog.skills=[{...source.skills.find(row=>row.id===220340),cost:0,accuracy:100}];
  f.catalog.passives=[];f.catalog.effects=[];
  f.catalog.masterSkills=[{...spirit,grants:{activeIds:[220340],passiveIds:[]}}];
  f.catalog.visions=[{id:13127,awakening:[],synchro:[{requiredPoints:1,grants:[{type:'MasterSkill',id:1312700,value:-1}]}]}];
  f.catalog.statGrowth[1].rows[0].skillIds=[];
  f.snapshot.characters[0].activeSkillIds=[];
  f.snapshot.resonances=[{id:13127,sync:[{characterId:1001,points:1}],awakeningPoints:0}];
  const selected=model(f,{actionId:220340});
  const chosen=selected.evaluate(f.input);
  assert.equal(chosen.valid,true,JSON.stringify(chosen));
  assert.equal(chosen.skillId,220340);assert.deepEqual(chosen.equippedSkillIds,[1312700]);
  assert.equal(selected.evaluate({...f.input,equippedSkillIds:[]}).valid,false);
});

test('equal primary scores prefer lower charged AP without changing the primary score',()=>{
  const f=fixture();
  f.catalog.passives=[f.catalog.passives[0]];f.catalog.effects=[f.catalog.effects[0]];
  f.catalog.statGrowth[1].rows[0].skillIds=[90001];
  const selected=model(f,{rounds:2,goals:['damage','durability'],incomingDamage:999999});
  const empty=selected.evaluate({...f.input,equippedSkillIds:[]});
  const costly=selected.evaluate({...f.input,equippedSkillIds:[90001]});
  assert.equal(empty.score,costly.score);
  const chosen=selected.evaluate(f.input);
  assert.equal(chosen.score,empty.score);
  assert.equal(chosen.skillCost,0);assert.deepEqual(chosen.equippedSkillIds,[]);
});

test('malformed contract values fail clearly without interpreting an unsupported constraint',()=>{
  const f=fixture();
  for(const extra of [{actionId:-1},{actionId:1.5},{requirements:{minHp:NaN}},{requirements:{minHp:-1}},
    {requirements:{element:'Unknown'}},{requirements:{survive:'yes'}}]){
    const invalid=model(f,extra);
    assert.ok(invalid.requestError);
    assert.equal(invalid.evaluate(f.input).valid,false);
  }
});

const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({area=true,mp=1000,rounds=5,skillCost=20,mpPercent=100,breakPoint=1e9,extraSkills=[]}={}){
 const skill={...native.skills.find(s=>s.name==='Firaga'),mag:20,cost:skillCost,criticalHitRate:0,isApplyAllMag:area};
 const ids=[1351,1441,1464,1045,1417,1254,1255,1256,...extraSkills];
 const character={...native.characters.find(c=>c.id===1008),id:1,levelParamId:1,passiveIds:[],baseSkillEquipCost:516,
  stats:{HitPoint:1000,MagicPoint:mp,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const catalog={...native,skillRules:rules,characters:[character],skills:[skill,...extraSkills.map(id=>native.skills.find(s=>s.id===id))],visions:[],equipment:[],artifacts:[],masterSkills:[],
  statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:ids}]}}};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[skill.id],equippedSkillIds:Array(8).fill(-1),equipment}],
  inventory:[],resonances:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:1,level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:breakPoint,Defence:30,Mind:30,Agility:0},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{rounds,mpPercent,goals:['damage'],includeSupportOptions:false});
 const evaluate=ids=>model.evaluate({characterId:1,visionId:-1,equipment,equippedSkillIds:ids});
 return {model,evaluate,catalog,snapshot,enemy,equipment,skill};
}
test('Area Effect Adept removes the native flagged damage and stagger penalty in complete builds',()=>{
 const area=fixture(),plain=fixture({area:false});
 const reduced=area.evaluate([]),adept=area.evaluate([1351]),unpenalized=plain.evaluate([]);
 assert.equal(adept.valid,true,JSON.stringify(adept));assert.equal(adept.damage,unpenalized.damage);assert.equal(adept.breakDamage,unpenalized.breakDamage);
 assert.ok(adept.damage>reduced.damage);assert.equal(adept.common.ignoreAllDamagePenalty,true);
});
test('Scion Sorceress enhances paid Skill Flow in full fight scoring',()=>{
 const f=fixture({area:false}),flow=f.evaluate([1464]),enhanced=f.evaluate([1464,1441]);
 assert.equal(enhanced.valid,true,JSON.stringify(enhanced));assert.ok(enhanced.fightDamage>flow.fightDamage);
 assert.equal(enhanced.passiveAnalysis.modifiers.skillHistoryMultiplier>1,true);
});
test('ActionBegin MP recovery sustains another paid attack and can fund the first fresh selection',()=>{
 const f=fixture({area:false,mp:80,rounds:3,skillCost:30}),plain=f.evaluate([]),restore=f.evaluate([1254]);
 assert.deepEqual(plain.mpExhaustedRounds,[3]);assert.deepEqual(restore.mpExhaustedRounds,[]);
 assert.ok(restore.fightDamage>plain.fightDamage);
 assert.deepEqual(restore.resourceEvents.filter(e=>e.kind==='mp-recovery').map(e=>e.gained),[0,5,5]);
 const first=fixture({area:false,mp:40,mpPercent:50,rounds:1,skillCost:25});
 assert.equal(first.evaluate([]).valid,false);assert.equal(first.evaluate([1254]).valid,true);
 assert.equal(first.evaluate([1254]).remainingMp,0);
});
test('percentage recovery is truncated per native effect, and Additional does not repeat ActionBegin',()=>{
 const f=fixture({area:false,mp:99,rounds:3,skillCost:35}),restore=f.evaluate([1255,1256]);
 assert.equal(restore.remainingMp,6);assert.deepEqual(restore.mpExhaustedRounds,[]);
 assert.deepEqual(restore.resourceEvents.filter(e=>e.kind==='mp-recovery' && e.round===2).map(e=>e.amount),[2,4]);
 const extra=fixture({area:false,mp:80,rounds:3,skillCost:1,breakPoint:1}).evaluate([1254]);
 assert.ok(extra.extraActions>0);assert.equal(extra.resourceEvents.filter(e=>e.kind==='mp-recovery').length,3);
 assert.ok(extra.resourceEvents.filter(e=>e.kind==='mp-recovery').every(e=>e.phase==='normal'));
});
test('Half MP Cost is used by fresh affordability, actual payments and complete-fight scoring',()=>{
 const f=fixture({area:false,mp:80,rounds:5,skillCost:30}),plain=f.evaluate([]),half=f.evaluate([1045]);
 assert.equal(half.valid,true);assert.equal(half.turnMp,15);assert.equal(half.remainingMp,5);
 assert.deepEqual(half.mpExhaustedRounds,[]);assert.ok(half.fightDamage>plain.fightDamage);
});
test('Unlock Magic cancels the active boost surcharge while preserving Half MP Cost',()=>{
 const f=fixture({area:false,rounds:1,skillCost:19,extraSkills:[400660]});
 const boosted=f.evaluate([400660]),unlocked=f.evaluate([400660,1417]),both=f.evaluate([400660,1417,1045]);
 assert.equal(boosted.magicBoost,true);assert.equal(boosted.turnMp,28);
 assert.equal(unlocked.turnMp,19);assert.equal(both.turnMp,9);
 assert.equal(both.remainingMp,991);
});
test('nested Magic Barrage discounts wrappers and pays each chosen spell once per branch',()=>{
 const f=fixture({area:false,rounds:1,skillCost:19,extraSkills:[400650,400360]});
 const result=f.evaluate([400650,400360,1045]);
 assert.equal(result.valid,true);assert.equal(result.actionCount,8);assert.equal(result.turnMp,58);assert.equal(result.remainingMp,942);
 assert.equal(result.leafResults.filter(leaf=>leaf.paymentSuppressed).length,6);
});

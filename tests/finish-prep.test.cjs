const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({visionId=13108,owned=true,equippedSkillIds=Array(8).fill(-1)}={}){
 const vision=native.visions.find(row=>row.id===visionId),attack=native.skills.find(row=>row.id===401010);
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId};
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'Owner',levelParamId:1,stats:{HitPoint:1000,MagicPoint:500,Attack:100,Intelligence:50,Mind:20,Defence:20,Divine:5,Agility:50},baseSkillEquipCost:100,passiveIds:[]}],
   statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:native.visions,skills:[attack,...native.skills.filter(skill=>skill.attr==='FinishBlow')],masterSkills:[],equipment:[],artifacts:[]};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[attack.id],equippedSkillIds,equipment}],resonances:owned && vision?[{id:vision.id,awakeningPoints:0,sync:[]}]:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Finish metadata target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:1,Mind:1,Agility:0},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
 const input={characterId:1,visionId,equipment};
 return {catalog,snapshot,enemy,vision,model,input};
}
test('Finish ownership comes from the selected owned Resonance rather than mastery or an AP active slot',()=>{
 const {model,input,vision}=fixture(),prepared=model.prep(1,vision.id),result=model.evaluate(input);
 assert.equal(prepared.finish.skillId,vision.finishBlow);assert.equal(prepared.finish.visionId,vision.id);
 assert.equal(prepared.finish.supported,true);assert.equal(prepared.finish.mpCost,0);assert.equal(prepared.finish.apCost,0);
 assert.equal(result.finish.skillId,vision.finishBlow);assert.equal(result.skillCost,0);
 assert.ok(!result.equippedSkillIds.includes(vision.finishBlow));assert.ok(!result.skillIds.includes(vision.finishBlow));
 assert.ok(!prepared.learn.freeActiveIds.includes(vision.finishBlow));assert.ok(!prepared.active.some(skill=>skill.id===vision.finishBlow));
});
test('an unowned or unselected Resonance does not supply a finisher',()=>{
 const unowned=fixture({owned:false});assert.equal(unowned.model.prep(1,13108).finish,null);
 const owned=fixture();assert.equal(owned.model.prep(1,-1).finish,null);
});
test('an unrelated recorded active slot cannot grant a different Resonance finisher',()=>{
 const {model}=fixture({owned:false,equippedSkillIds:[440090,...Array(7).fill(-1)]});
 assert.equal(model.prep(1,13108).finish,null);
});
test('Wilhelm exposes its verified next-incoming-command protection finisher',()=>{
 const {model}=fixture({visionId:13062}),finish=model.prep(1,13062).finish;
 assert.equal(finish.skillId,412620);assert.equal(finish.supported,true);assert.equal(finish.kind,'protection');
 assert.equal(finish.reason,undefined);assert.equal(finish.mpCost,0);assert.equal(finish.apCost,0);
});
test('Tidus points at Blitz Ace while its appended damage is separate metadata',()=>{
 const {model}=fixture({visionId:13120}),finish=model.prep(1,13120).finish;
 assert.equal(finish.skillId,440210);assert.equal(finish.supported,true);
 assert.ok(finish.secondaryEffects.some(effect=>effect.effectId===59000 && effect.type==='AppendDamage'));
 assert.ok(!finish.secondaryEffects.some(effect=>effect.effectId===440230));
 assert.ok(!finish.secondaryReasons.some(reason=>/59000/.test(reason)),'the verified append must not be described as unmodeled');
});


test('Leah, Ayaka and Charlotte expose supported recovery finishers without pretending to deal enemy damage',()=>{
 for(const [visionId,skillId] of [[13045,414100],[13051,412510],[13060,412600]]){
  const {model}=fixture({visionId}),finish=model.prep(1,visionId).finish;
  assert.equal(finish.skillId,skillId);assert.equal(finish.supported,true);assert.equal(finish.kind,'healing');
  assert.equal(finish.apCost,0);assert.equal(finish.mpCost,0);assert.equal(finish.reason,undefined);
 }
});
test('verified finisher LB fill and append effects are not mislabeled as unsupported',()=>{
 for(const visionId of [13101,13123,13120]){
  const {model}=fixture({visionId}),finish=model.prep(1,visionId).finish;
  assert.equal(finish.kind,'damage');assert.ok(!finish.secondaryReasons.some(reason=>/62000|59000/.test(reason)));
 }
});

test('gear ranking includes the equipped magic finisher instead of only the regular physical attack',()=>{
 const f=fixture(),snapshot=structuredClone(f.snapshot);
 snapshot.characters[0].equipment.accessoryIds=[-1];
 const catalog={...f.catalog,equipment:[{id:980001,name:'Physical edge',type:'Accessory',detailType:'None',sexLimit:'None',stats:{PhysicalAttack:10},passiveIds:[]},{id:980002,name:'Magic edge',type:'Accessory',detailType:'None',sexLimit:'None',stats:{MagicalAttack:100},passiveIds:[]}]};
 const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1,Defence:150,Mind:150}};
 const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
 const evaluate=id=>model.evaluate({...f.input,equipment:{...f.input.equipment,accessoryIds:[id]}});
 const physical=evaluate(980001),magical=evaluate(980002);
 assert.ok(physical.damage>magical.damage,'the ordinary attack alone prefers ATK');
 assert.equal(physical.finishCount,1);assert.equal(magical.finishCount,1);
 assert.ok(magical.fightDamage>physical.fightDamage,'the full native phase forecast values MAG for the selected finisher');
 assert.ok(magical.score>physical.score);
 const physicalFinish=physical.resourceEvents.find(event=>event.kind==='finish'),magicFinish=magical.resourceEvents.find(event=>event.kind==='finish');
 assert.equal(magicFinish.common.attackSource,'MAG');assert.ok(magicFinish.common.attack>physicalFinish.common.attack);
});

test('an incoming-hit durability build values a supported healing Finish through actual remaining HP',()=>{
 const compare=visionId=>{
  const f=fixture({visionId}),catalog={...f.catalog,visions:f.catalog.visions.map(vision=>({...vision,awakening:[],synchro:[]}))};
  const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1,Defence:150,Mind:150}};
  const model=B.createModel(catalog,f.snapshot,enemy,{goals:['durability'],rounds:1,incomingDamage:100,includeSupportOptions:false});
  return {model,result:model.evaluate(f.input),member:{characterId:1,visionId,equipment:f.input.equipment}};
 };
 const healing=compare(13051),damage=compare(13108);
 assert.equal(healing.result.finish.kind,'healing');assert.equal(healing.result.finishCount,1);
 assert.ok(healing.result.remainingHp>damage.result.remainingHp);
 assert.ok(healing.result.score>damage.result.score);
 const healParty=healing.model.evaluateParty([{...healing.member,evaluation:healing.result}]);
 const damageParty=damage.model.evaluateParty([{...damage.member,evaluation:damage.result}]);
 assert.ok(healParty.remainingHp[1]>damageParty.remainingHp[1]);assert.ok(healParty.score>damageParty.score);
});

test('Wilhelm protection affects durability ranking and exposes its unconsumed next-command guard',()=>{
 const compare=visionId=>{
  const f=fixture({visionId}),catalog={...f.catalog,visions:f.catalog.visions.map(vision=>({...vision,awakening:[],synchro:[]}))};
  const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1,Defence:150,Mind:150}};
  const model=B.createModel(catalog,f.snapshot,enemy,{goals:['durability'],rounds:2,incomingDamage:100,includeSupportOptions:false});
  const result=model.evaluate(f.input);
  return {result,party:model.evaluateParty([{characterId:1,visionId,equipment:f.input.equipment,evaluation:result}])};
 };
 const protectedBuild=compare(13062),damageBuild=compare(13108),result=protectedBuild.result;
 assert.equal(result.finish.kind,'protection');assert.equal(result.remainingHp,870);assert.equal(damageBuild.result.remainingHp,800);
 assert.ok(result.score>damageBuild.result.score);assert.ok(protectedBuild.party.score>damageBuild.party.score);
 assert.equal(result.remainingGuards[0].effectId,16129);assert.equal(result.remainingGuards[0].percent,70);
 assert.equal(protectedBuild.party.remainingGuards[1][0].effectId,16129);
 const incoming=result.resourceEvents.filter(event=>event.kind==='incoming');
 assert.equal(incoming[1].damage,30);assert.equal(incoming[1].guardsConsumed,true);
});


test('all current equipped Resonances classify as supported damage, recovery or protection finishers',()=>{
 const kinds={damage:0,healing:0,protection:0};
 for(const vision of native.visions){
  const {model}=fixture({visionId:vision.id}),finish=model.prep(1,vision.id).finish;
  assert.equal(finish.supported,true,vision.name);assert.ok(Object.hasOwn(kinds,finish.kind),vision.name);
  assert.equal(finish.skillId,vision.finishBlow);assert.equal(finish.apCost,0);assert.equal(finish.mpCost,0);
  kinds[finish.kind]++;
 }
 assert.deepEqual(kinds,{damage:22,healing:3,protection:1});
});
test('verified OverHeal and one-command Finish guards are not mislabeled as unsupported',()=>{
 for(const visionId of [13045,13062,13103]){
  const {model}=fixture({visionId}),finish=model.prep(1,visionId).finish;
  assert.ok(!finish.secondaryReasons.some(reason=>/21200|16100|16129/.test(reason)));
 }
});

const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({wrapper=400650,mp=71,magicPair=false,budget=250,slots=8,free=false,lock=false}={}){
 const base=native.skills.find(s=>s.id===220010),strong={...base,id:910001,name:'Strong spell',cost:30,equipCost:15,mag:120,breakDmg:0,criticalHitRate:0,element:'None'};
 const breaker={...base,id:910002,name:'Cheap breaker',cost:1,equipCost:20,mag:1,breakDmg:100,criticalHitRate:0,element:'None',...(magicPair?{}:{attr:'Ability',dmgType:'Physic',calcType:'Physic'})};
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const skillRules=structuredClone(rules);
 if(lock)skillRules.general.usableData.push({lockSkills:[breaker.id],lockType:'FoundSkillInHierarchy',hierarchySkills:[wrapper]});
 const catalog={...native,skillRules,characters:[{id:1,name:'Test unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:mp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:budget,passiveIds:[]}],
 statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[wrapper,...(free?[]:[strong.id,breaker.id])]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:[],skills:[strong,breaker,native.skills.find(s=>s.id===wrapper)]};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:free?[strong.id,breaker.id]:[],equippedSkillIds:Array(slots).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Test target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:100,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
 return {result:model.evaluate({characterId:1,visionId:-1,equipment}),catalog,snapshot,enemy,model,input:{characterId:1,visionId:-1,equipment}};
}
test('Arms mixes physical and magical attacks and breaks before the stronger hit',()=>{
 const {result}=fixture();
 assert.equal(result.valid,true);assert.deepEqual(result.skillIds,[910002,910001]);
 assert.equal(result.turnMp,71);assert.equal(result.actionCount,2);
 assert.equal(result.skillCost,60+15+20);
 assert.deepEqual(result.turn.leaves.map(l=>l.skillId),[910002,910001]);
 assert.ok(result.fightDamage>result.damage,'the later strong hit receives the stagger multiplier');
 assert.equal(new Set(result.equippedSkillIds).size,result.equippedSkillIds.length);
});
test('Dualcast can mix different Magic leaves within a shared MP budget',()=>{
 const {result}=fixture({wrapper:400730,mp:31,magicPair:true});
 assert.deepEqual(result.skillIds,[910002,910001]);assert.equal(result.turnMp,31);
 assert.equal(result.turn.steps[0].skillId,400730);
 assert.equal(result.turn.leaves.every(l=>l.context.activeEffectIds===undefined),true);
});
test('different skill pairs obey AP and slot limits',()=>{
 for(const options of [{budget:90},{slots:2}]){
   const {result}=fixture(options);
   assert.ok(!result.valid || result.skillIds.length===1,'a mixed pair cannot evade the active AP or slot charge');
 }
});
test('free secondary skills do not consume another AP slot',()=>{
 const {result}=fixture({free:true,budget:60,slots:1});
 assert.deepEqual(result.skillIds,[910002,910001]);assert.equal(result.skillCost,60);
 assert.deepEqual(result.equippedSkillIds,[400650]);
});
test('mixed leaves still obey wrapper ancestry and Double Action nonmagic filters',()=>{
 const locked=fixture({lock:true}).result;
 assert.ok(!locked.valid || locked.skillIds.length===1);
 const nonMagic=fixture({wrapper:400710,mp:31}).result;
 assert.ok(!nonMagic.valid || nonMagic.skillIds.length===1);
});

test('a Mastery grant can supply a secondary mixed skill without charging that active twice',()=>{
 const f=fixture({budget:80});
 const catalog={...f.catalog,masterSkills:[{id:910010,name:'Breaker mastery',equipCost:5,grants:{activeIds:[910002],passiveIds:[]}}]};
 const snapshot=structuredClone(f.snapshot);snapshot.characters[0].equippedSkillIds[0]=910010;
 const result=B.createModel(catalog,snapshot,f.enemy,{goals:['damage'],rounds:1,includeSupportOptions:false}).evaluate(f.input);
 assert.deepEqual(result.skillIds,[910002,910001]);
 assert.equal(result.skillCost,80);assert.ok(result.equippedSkillIds.includes(910010));
 assert.ok(!result.equippedSkillIds.includes(910002),'the mastery-granted skill needs no separate active slot');
});

function recklessFixture({nested=false,magic=false,mp=28}={}){
 const f=fixture({wrapper:nested?400650:400700,mp});
 const catalog={...f.catalog,skills:f.catalog.skills.filter(s=>s.id!==910002).map(s=>s.id===910001?{...s,cost:19,breakDmg:100,...(!magic?{dmgType:'Physic',calcType:'Physic',attr:'Ability'}:{})}:s)};
 if(nested){catalog.skills.push(native.skills.find(s=>s.id===400700));catalog.statGrowth=structuredClone(catalog.statGrowth);catalog.statGrowth[1].rows[0].skillIds.push(400700);}
 const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1e9}};
 const model=B.createModel(catalog,f.snapshot,enemy,{goals:['stagger'],rounds:1,includeSupportOptions:false});
 return {result:model.evaluate(f.input),catalog};
}
test('Reckless Abandonment boosts physical stagger and pays the native modified child cost',()=>{
 const {result}=recklessFixture();
 assert.equal(result.recklessAbandonment,true);assert.equal(result.magicBoost,false);
 assert.equal(result.turnMp,28);assert.deepEqual(result.turn.leaves[0].context.activeEffectIds,[15112]);
 assert.ok(result.passiveAnalysis.applied.some(effect=>effect.effectId===15112));
});
test('Arms supports two independent Reckless physical branches with unique AP charges',()=>{
 const {result,catalog}=recklessFixture({nested:true,mp:96});
 assert.equal(result.actionCount,2);assert.equal(result.turnMp,96);
 assert.equal(result.turn.leaves.filter(leaf=>leaf.reckless).length,2);
 assert.equal(result.equippedSkillIds.filter(id=>id===400700).length,1);
 assert.equal(result.skillCost,result.equippedSkillIds.reduce((sum,id)=>sum+catalog.skills.find(s=>s.id===id).equipCost,0));
});
test('Reckless rejects magical damage leaves and cannot afford a modified physical child with only plain MP',()=>{
 assert.equal(recklessFixture({magic:true}).result.recklessAbandonment,false);
 assert.equal(recklessFixture({mp:19}).result.recklessAbandonment,false);
});

function barrageFixture({nested=false,mp=39,enemyCount=1,learned=true}={}){
 const f=fixture({wrapper:nested?400650:400360,mp});
 const catalog={...f.catalog,skills:f.catalog.skills.filter(s=>s.id!==910002 && (learned || s.id!==400360)).map(s=>s.id===910001?{...s,cost:19,breakDmg:100}:s)};
 if(nested && learned){catalog.skills.push(native.skills.find(s=>s.id===400360));catalog.statGrowth=structuredClone(catalog.statGrowth);catalog.statGrowth[1].rows[0].skillIds.push(400360);}
 const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1e9}};
 const result=B.createModel(catalog,f.snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false,enemyCount}).evaluate(f.input);
 return {result,catalog};
}
test('Magic Barrage executes four penalized copies but charges the selected spell only once',()=>{
 const {result}=barrageFixture(),plain=barrageFixture({learned:false}).result;
 assert.equal(result.actionCount,4);assert.equal(result.turnMp,39);
 assert.ok(result.turn.leaves.every(leaf=>leaf.context.activeEffectIds.includes(12945) && leaf.context.activeEffectIds.includes(15128)));
 assert.deepEqual(result.turn.leaves.map(leaf=>leaf.mpCost),[19,0,0,0]);
 assert.deepEqual(result.turn.leaves.map(leaf=>leaf.paymentSuppressed),[false,true,true,true]);
 assert.ok(Math.abs(result.damage-plain.damage*2)<1);
 assert.equal(result.breakDamage,plain.breakDamage*2);
});
test('Arms can execute two Magic Barrage branches with eight spell copies and unique AP',()=>{
 const {result,catalog}=barrageFixture({nested:true,mp:118});
 assert.equal(result.actionCount,8);assert.equal(result.turnMp,118);
 assert.equal(result.equippedSkillIds.filter(id=>id===400360).length,1);
 assert.equal(result.skillCost,result.equippedSkillIds.reduce((sum,id)=>sum+catalog.skills.find(s=>s.id===id).equipCost,0));
 assert.equal(result.turn.leaves.filter(leaf=>leaf.paymentSuppressed===false).length,2);
});
test('Magic Barrage penalties expire before an ordinary sibling',()=>{
 const {result}=barrageFixture({nested:true,mp:98});
 assert.equal(result.actionCount,5);assert.equal(result.turnMp,98);
 assert.equal(result.turn.leaves.filter(leaf=>leaf.context.activeEffectIds?.includes(12945)).length,4);
 const normal=result.leafResults.filter(leaf=>!leaf.context.activeEffectIds?.includes(12945));
 const penalized=result.leafResults.filter(leaf=>leaf.context.activeEffectIds?.includes(12945));
 assert.equal(normal.length,1);assert.ok(normal[0].damage>penalized[0].damage);
});
test('Magic Barrage numeric recommendations exclude unknown random-target allocation',()=>{
 assert.equal(barrageFixture({enemyCount:2}).result.actionCount,1);
});

test('AP-invalid high-count mixtures do not crowd affordable mixed candidates out of the shortlist',()=>{
 const f=fixture({magicPair:true,mp:200,budget:95});
 const catalog={...f.catalog,skills:[...f.catalog.skills,native.skills.find(s=>s.id===400730)],statGrowth:structuredClone(f.catalog.statGrowth)};
 catalog.statGrowth[1].rows[0].skillIds.push(400730);
 const result=B.createModel(catalog,f.snapshot,f.enemy,{goals:['damage','stagger'],rounds:1,includeSupportOptions:false}).evaluate(f.input);
 assert.equal(result.skillIds.length,2);assert.ok(result.skillCost<=95);
 assert.equal(result.actionCount,2,'four-child mixed branches cannot fit the available AP');
});

test('separate Arms Barrage branches may choose different spells while each branch repeats its own choice',()=>{
 const f=fixture({magicPair:true,mp:111});
 const catalog={...f.catalog,skills:[...f.catalog.skills,native.skills.find(s=>s.id===400360)],statGrowth:structuredClone(f.catalog.statGrowth)};
 catalog.statGrowth[1].rows[0].skillIds.push(400360);
 const result=B.createModel(catalog,f.snapshot,f.enemy,{goals:['damage','stagger'],rounds:1,includeSupportOptions:false}).evaluate(f.input);
 assert.equal(result.skillIds.length,2);
 for(const index of result.turn.steps.map((step,index)=>step.skillId===400360?index:-1).filter(index=>index>=0)){
   const branch=result.turn.steps.slice(index+1,index+5);
   assert.equal(branch.length,4);assert.equal(new Set(branch.map(step=>step.skillId)).size,1);
 }
 assert.ok(result.turn.wrapperIds.includes(400360));
});

test('supported special command costs and leaf effects match the retained native vectors',()=>{
 const vectors=require('./fixtures/native-special-actions.json').cases;
 const results=[recklessFixture().result,recklessFixture({nested:true,mp:87}).result,barrageFixture().result,barrageFixture({nested:true,mp:118}).result];
 vectors.forEach((vector,index)=>{
  assert.equal(results[index].turnMp,vector.mp,vector.name);
  assert.deepEqual(results[index].turn.leaves.map(leaf=>leaf.context.activeEffectIds || []).sort(),vector.leafActiveEffectIds.slice().sort(),vector.name);
 });
});

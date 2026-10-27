const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({skillId=400490,rounds=1,passiveIds=[],repeat=1,wrapper=false,suppressed=false,lb=false}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1},skill=native.skills.find(s=>s.id===skillId);
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'HP tester',levelParamId:1,stats:{HitPoint:100,MagicPoint:999,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:500,passiveIds:[]}],
  statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[]};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[skillId],equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'HP target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:lb?25:1e12,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{goals:lb?['limit']:['damage'],rounds});
 const leaves=Array.from({length:repeat},(_,actionIndex)=>({skillId,kind:'attack',actionIndex,context:{},paymentSuppressed:suppressed && actionIndex>0}));
 const steps=[...(wrapper?[{kind:'wrapper',skillId:400650}]:[]),...leaves];
 const turn={leaves,steps},turnMp=(wrapper?40:0)+leaves.reduce((sum,leaf)=>sum+(leaf.paymentSuppressed?0:skill.cost),0);
 const evaluation={damage:999,brokenDamage:999,breakDamage:0,availableMp:999,turnMp,stats:{Agility:50,MaxHitPoint:100,PhysicalDefense:20,MagicalDefense:20},limit:lb?{max:100,initial:0,mult:1,fillOnStagger:0,recuperate:0,options:[{skillId:401300,cost:100,damage:1e9,brokenDamage:1e9,breakDamage:0}]}:null,supportActions:[],
   actionPlan:{turn,characterId:1,equipment,passiveIds,maxHp:100,maxMp:999}};
 return {result:model.evaluateParty([{characterId:1,equipment,evaluation}]),evaluation,model,skill};
}
test('HP-cost children spend max-HP percentages separately and pay their wrapper MP once',()=>{
 const {result}=fixture({repeat:2,wrapper:true});
 assert.equal(result.remainingHp[1],90);assert.equal(result.hpSpent[1],10);assert.equal(result.remainingMp[1],959);
 assert.ok(result.damage>0);assert.deepEqual(result.resourceSkips[1],[]);
});
test('HP-conditional damage passives are recalculated after the cost, not from full-HP preview stats',()=>{
 const plain=fixture().result,fullHpPassive=fixture({passiveIds:[1358]}).result;
 assert.equal(fullHpPassive.damage,plain.damage,'Vigorous Attacks is inactive after Darkness pays 5 HP');
});
test('additional HP costs retain the skill MP cost for every paid child',()=>{
 const {result,skill}=fixture({skillId:408070,repeat:2,wrapper:true});
 assert.equal(result.remainingHp[1],80);assert.equal(result.hpSpent[1],20);
 assert.equal(result.remainingMp[1],999-40-2*skill.cost);
});
test('an equality-cost leaf completes at zero HP, and following turns cannot act',()=>{
 const one=fixture().result,twentyOne=fixture({rounds:21}).result;
 assert.equal(twentyOne.remainingHp[1],0);assert.equal(twentyOne.hpSpent[1],100);
 assert.ok(Math.abs(twentyOne.damage*21-one.damage*20)<1e-6);
 assert.ok(twentyOne.resourceSkips[1].some(event=>event.round===21));
});
test('native no-consumption action flags suppress HP as well as MP payment',()=>{
 const {result}=fixture({repeat:2,suppressed:true});
 assert.equal(result.remainingHp[1],95);assert.equal(result.hpSpent[1],5);
});

test('a later Limit Burst uses the paid-down HP state rather than restoring full-HP passive damage',()=>{
 const plain=fixture({rounds:3,lb:true}).result,withPassive=fixture({rounds:3,lb:true,passiveIds:[1358]}).result;
 assert.deepEqual(plain.limitUses[1],[{round:2,phase:'additional',skillId:401300}]);
 assert.deepEqual(plain.resourceEvents[1].filter(event=>event.hpCost>0).map(event=>[event.round,event.phase,event.hpAfter]),[
  [1,'normal',95],[1,'additional',90],[2,'normal',85],[3,'normal',80],[3,'additional',75]
 ]);
 assert.equal(plain.resourceEvents[1].find(event=>event.kind==='limit').hpAfter,85,'the LB observes all three preceding HP payments');
 assert.equal(plain.hpSpent[1],25);
 assert.equal(withPassive.damage,plain.damage);
 assert.equal(withPassive.remainingHp[1],75);
});

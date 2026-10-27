const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({wrappers=[400650,400460,400730],mp=78,cost=19,rounds=1,limit=false}={}){
 const attack={...native.skills.find(s=>s.id===220010),cost,mag:100,breakDmg:limit?100:0,criticalHitRate:0,element:'None'};
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const skills=[attack,...wrappers.map(id=>native.skills.find(s=>s.id===id))];
 if(limit)skills.push({...attack,id:990099,name:'Test burst',attr:'LimitBurst',hasUnit:'Focus unit',cost:100,mag:350});
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'Focus unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:mp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:250,passiveIds:[]}],
  statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...wrappers,...(limit?[1004]:[])]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:limit?native.passives.filter(p=>p.id===1004):[],skills};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[attack.id],equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:limit?100:1e9,Defence:1,Mind:1,Agility:0},resistances:{},passiveIds:[]};
 const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,includeSupportOptions:false}).evaluate({characterId:1,visionId:-1,equipment});
 return {result,catalog};
}
test('Focus before Dualcast boosts both children without consuming a lifetime per spell',()=>{
 const {result}=fixture();
 assert.equal(result.focus,true);assert.equal(result.turnMp,78);
 assert.ok(result.actionPlan,'Focus prefixes use live state even without incoming hits');
 assert.equal(result.remainingMp,0);assert.ok(result.resourceEvents.some(event=>event.skillId===400460));
 assert.deepEqual(result.turn.steps.map(step=>step.skillId),[400650,400460,400730,220010,220010]);
 assert.equal(result.turn.leaves[0].kind,'support');
 assert.ok(result.turn.leaves.slice(1).every(leaf=>leaf.context.activeEffectIds.includes(12907)));
 assert.equal(result.turn.setupDuration,2);assert.equal(result.actionCount,3);
 assert.equal(result.equippedSkillIds.filter(id=>id===400460).length,1);
 assert.equal(result.skillCost,result.equippedSkillIds.reduce((sum,id)=>sum+native.skills.find(s=>s.id===id).equipCost,0));
});
test('Focus cannot become a non-Magic child of Dualcast without Arms',()=>{
 const {result}=fixture({wrappers:[400460,400730],mp:38});
 assert.equal(result.focus,false);assert.equal(result.turn.steps.some(step=>step.skillId===400460),false);
});
test('Focus and Magic Boost combine in the native additive bucket, not as two multipliers',()=>{
 const {result}=fixture({wrappers:[400650,400460,400660],mp:68});
 assert.equal(result.focus,true);assert.equal(result.magicBoost,true);assert.equal(result.turnMp,68);
 const leaf=result.leafResults.find(leaf=>leaf.kind==='attack');
 assert.equal(leaf.common.outgoingFactor,3);
 assert.deepEqual(leaf.context.activeEffectIds,[12907,1382,12911]);
});
test('Focus survives Magic Barrage child events and does not compound its own damage effect',()=>{
 const {result}=fixture({wrappers:[400650,400460,400360],mp:79});
 assert.equal(result.focus,true);assert.equal(result.actionCount,5);assert.equal(result.turnMp,79);
 const attacks=result.leafResults.filter(leaf=>leaf.kind==='attack');
 assert.equal(attacks.length,4);
 assert.ok(attacks.every(leaf=>leaf.common.outgoingFactor===1.5));
 assert.ok(attacks.every(leaf=>leaf.context.activeEffectIds.filter(id=>id===12907).length===1));
});
test('Focus exposes unbuffed opening initiative and one slow effect for the following round',()=>{
 const {result}=fixture();
 assert.equal(result.baseAgility,50);assert.equal(result.setupAgility,31);
 assert.equal(result.stats.Agility,result.setupAgility);
});
test('Focus prepares later Limit Bursts with its persistent damage effect',()=>{
 const {result}=fixture({wrappers:[400650,400460],mp:210,cost:30,rounds:3,limit:true});
 assert.equal(result.focus,true);assert.ok(result.setupLimit);
 assert.ok(result.setupLimit.options[0].damage>result.limit.options[0].damage);
 assert.ok(result.limitUses.some(use=>use.round>1));
});

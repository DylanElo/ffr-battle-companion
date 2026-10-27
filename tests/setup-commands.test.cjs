const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture(setupId=230110,{rounds=1,lb=false}={}){
 const attack={...native.skills.find(s=>s.id===220010),cost:30,mag:100,breakDmg:100,criticalHitRate:0,element:'None'};
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const person={id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[attack.id],equippedSkillIds:Array(8).fill(-1),equipment};
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'Setup unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:36*rounds,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:250,passiveIds:[]}],
 statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[400730,setupId,...(lb?[1004]:[])]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:lb?native.passives.filter(p=>p.id===1004):[],
 skills:[attack,native.skills.find(s=>s.id===setupId),native.skills.find(s=>s.id===400730)]};
 if(lb)catalog.skills.push({...attack,id:990001,name:'Test LB',attr:'LimitBurst',hasUnit:'Setup unit',cost:100,mag:350});
 const snapshot={characters:[person],inventory:[],resonances:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:lb?100:1e9,Defence:100,Mind:100,Agility:0},resistances:{},passiveIds:[]};
 const input={characterId:1,visionId:-1,equipment};
 const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,includeSupportOptions:false});
 return {catalog,snapshot,enemy,input,model,result:model.evaluate(input)};
}
test('Dualcast can cast Faith on self before a damage spell with one shared AP/MP budget',()=>{
 const {result}=fixture();
 assert.equal(result.turn.recipeLabel,'Dualcast → Faith (self) + Fire');
 assert.equal(result.turnMp,36);assert.equal(result.leafResults[0].kind,'support');assert.equal(result.leafResults[0].damage,0);
 assert.ok(result.turn.leaves[1].context.activeEffectIds.includes(19050));
 assert.equal(result.equippedSkillIds.filter(id=>id===230110).length,1);
});
test('Deshell is applied before the next spell and resisted setup is not assumed',()=>{
 const {result,catalog,snapshot,enemy,input}=fixture(230090);
 assert.equal(result.turn.leaves[0].skillId,230090);
 assert.equal(result.turn.leaves[1].context.targetStatPercent.parameter,'Mind');
 const resisted=B.createModel(catalog,snapshot,{...enemy,statusResistances:{MindDown:100}},{goals:['damage'],rounds:1,includeSupportOptions:false}).evaluate(input);
 assert.ok(!resisted.turn.setupContext);
 assert.ok(result.damage>resisted.damage);
});
test('setup effects refresh without accumulating potency across the five-round forecast',()=>{
 const one=fixture().result,five=fixture(230110,{rounds:5}).result;
 assert.equal(five.turnMp,36);assert.equal(five.fightDamage,one.fightDamage);
});
test('a persistent setup effect is available to later Limit Bursts, not an opening burst',()=>{
 const {result}=fixture(230110,{rounds:3,lb:true});
 assert.ok(result.setupLimit);
 assert.ok(result.setupLimit.options[0].damage>result.limit.options[0].damage);
 assert.ok(result.limitUses.some(use=>use.round>1));
});

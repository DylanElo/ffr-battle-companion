const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({pile=false,fixed=false}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const ids=pile?[401010]:[401010,447810],passives=pile?[1004,1404]:[1361];
 const skills=native.skills.map(s=>s.id===401010?{...s,cost:0,mag:pile?1:30,breakDmg:pile?50:0,criticalHitRate:0}:s.id===447810?{...s,cost:0,mag:20,breakDmg:0,criticalHitRate:0}:s.id===401040?{...s,breakDmg:0,mag:1}:s);
 const catalog={...native,skillRules:rules,characters:[{id:1001,name:'Rain',levelParamId:1,stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:100,passiveIds:[]}],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:passives}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],skills};
 const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:ids,equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1001],player:{difficulty:'Normal'}};
 const enemy={id:3,name:'Target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:pile?75:1e12,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{goals:pile?['stagger']:['damage'],rounds:3,includeSupportOptions:false});
 return {result:model.evaluate({characterId:1001,visionId:-1,equipment,current:fixed}),model};
}

test('phase-only probability abilities can change the chosen attack within AP and slots',()=>{
 const {result}=fixture();
 assert.equal(result.skillId,447810);assert.ok(result.equippedSkillIds.includes(1361));
 assert.ok(result.skillCost<=result.skillBudget);assert.ok(result.expectedExtraActions>0);
 assert.equal(fixture({fixed:true}).result.equippedSkillIds.includes(1361),false);
});

test('Pilebunker reaches the optimizer through actual earned LB gauge and known capacity',()=>{
 const {result}=fixture({pile:true});
 assert.ok(result.equippedSkillIds.includes(1404));assert.ok(result.equippedSkillIds.includes(1004));
 const full=result.resourceEvents.find(event=>event.skillId===401010 && event.context.lbPercent===100);
 assert.ok(full);assert.equal(full.context.lbCapacity,100);
 assert.ok(full.breakDamage>=75);assert.ok(result.skillCost<=result.skillBudget);
});

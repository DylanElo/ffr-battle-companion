const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
const CALL=401140;
function fixture({rounds=3,goals=['damage'],callerMp=120,recipientMp=60,learned=true,free=false,budget=100,slots=8,fixed=false,optional=true,limit=false}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1},base=native.skills.find(skill=>skill.id===401010);
 const attacks=[{...base,id:970001,name:'Weak strike',mag:1,breakDmg:0,cost:0,criticalHitRate:0},{...base,id:970002,name:'Strong strike',mag:100,breakDmg:10,cost:10,criticalHitRate:0}];
 const burst={...attacks[1],id:970003,name:'Recipient Limit',hasUnit:'Recipient',attr:'LimitBurst',cost:100,breakDmg:0,mag:100};
 const characters=[{id:1,name:'Caller',levelParamId:1,stats:{HitPoint:500,MagicPoint:callerMp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:200},baseSkillEquipCost:budget,passiveIds:[]},{id:2,name:'Recipient',levelParamId:2,stats:{HitPoint:500,MagicPoint:recipientMp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:100},baseSkillEquipCost:100,passiveIds:[]}];
 const catalog={...native,skillRules:rules,characters,skills:[...attacks,native.skills.find(skill=>skill.id===CALL),...(limit?[burst]:[])],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:learned && !free?[CALL]:[]}]},2:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],masterSkills:[],artifacts:[]};
 const snapshot={characters:characters.map((char,index)=>({id:char.id,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[attacks[index].id,...(free && index===0?[CALL]:[])],equippedSkillIds:Array(index===0?slots:8).fill(-1),equipment})),resonances:[],inventory:[],party:[1,2],player:{difficulty:'Normal'}};
 const enemy={id:3,name:'Planning target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:limit?10:1e12,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{rounds,goals,includeSupportOptions:optional});
 const members=characters.map(char=>({characterId:char.id,visionId:-1,equipment,evaluation:model.evaluate({characterId:char.id,visionId:-1,equipment,...(fixed && char.id===1?{current:true}:{})})}));
 return {model,members,catalog,snapshot,enemy};
}
test('party planner replaces a weak normal command with Call to Action for a stronger paid recipient',()=>{
 const {model,members,catalog}=fixture();
 const caller=members[0].evaluation,call=catalog.skills.find(skill=>skill.id===CALL),party=model.evaluateParty(members);
 assert.equal(call.equipCost,10);assert.ok(caller.equippedSkillIds.includes(CALL));assert.equal(caller.skillCost,10);
 assert.equal(caller.supportActions.find(action=>action.skillId===CALL).kind,'bonusPhase');
 assert.equal(party.supportUsed.skillId,CALL);assert.deepEqual(party.supportUsed.targetIds,[2]);
 assert.equal(party.actionOverrides[1].damage,0);assert.equal(party.actionOverrides[1].turnMp,40);
 assert.equal(party.remainingMp[1],0);assert.equal(party.remainingMp[2],0);
 assert.equal(party.expectedExtraActions[2],3);
 assert.equal(party.resourceEvents[1].filter(event=>event.skillId===CALL).length,3);
 assert.equal(party.resourceEvents[2].filter(event=>event.phase==='additional').length,3);
 assert.ok(party.damage>caller.damage+members[1].evaluation.damage);
 assert.match(party.supportDescription,/recipient pays its own/);
});
test('Call planning also participates in Stagger objectives without a Damage checkbox',()=>{
 const {model,members}=fixture({goals:['stagger']});
 const result=model.evaluateParty(members);
 assert.equal(result.supportUsed.skillId,CALL);assert.ok(result.breakDamage>members[1].evaluation.breakDamage);
});
test('Call is absent when unlearned, fixed but not equipped, or blocked by AP and slots',()=>{
 for(const options of [{learned:false},{fixed:true},{budget:0},{slots:0},{optional:false}]){
  const {members}=fixture(options),caller=members[0].evaluation;
  assert.equal(caller.valid,true);
  assert.equal(caller.supportActions.some(action=>action.skillId===CALL),false,JSON.stringify(options));
  assert.ok(!caller.equippedSkillIds.includes(CALL));
 }
});
test('a free Call remains usable without adding an optional AP ability',()=>{
 const {model,members}=fixture({free:true,budget:0,optional:false});
 assert.ok(members[0].evaluation.supportActions.some(action=>action.skillId===CALL));
 assert.equal(members[0].evaluation.skillCost,0);
 assert.equal(model.evaluateParty(members).supportUsed.skillId,CALL);
});
test('Call planning rejects a dead beneficiary and cannot manufacture participation',()=>{
 const {model,members}=fixture();
 members[1].evaluation.fallbackActionPlan.maxHp=0;
 const result=model.evaluateParty(members);
 assert.equal(result.supportUsed,null);assert.equal(result.expectedExtraActions[2],0);
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===CALL).length,0);
});
test('the recipient must afford an additional action rather than receiving free damage',()=>{
 const {model,members}=fixture({rounds:1,callerMp:40,recipientMp:10});
 const result=model.evaluateParty(members);
 assert.equal(result.supportUsed,null,'the normal attack consumes the recipient’s last 10 MP');
 assert.equal(result.remainingMp[2],0);assert.equal(result.expectedExtraActions[2],0);
});

test('Call can improve the Limit goal through a paid additional stagger after the normal LB',()=>{
 const {model,members}=fixture({rounds:1,goals:['limit'],callerMp:40,recipientMp:10,limit:true});
 members[1].evaluation.limit.initial=100;
 const result=model.evaluateParty(members);
 assert.equal(result.supportUsed.skillId,CALL);assert.deepEqual(result.supportUsed.targetIds,[2]);
 assert.equal(result.limitUses[2][0].phase,'normal');
 assert.equal(result.remainingMp[2],0);assert.equal(result.gauge[2],50);
 assert.equal(result.expectedExtraActions[2],1);
});

test('a recorded equipped Call remains available on fixed loadouts without a second AP charge',()=>{
 const f=fixture({fixed:true,optional:false}),snapshot=structuredClone(f.snapshot);
 snapshot.characters[0].equippedSkillIds[0]=CALL;
 const model=B.createModel(f.catalog,snapshot,f.enemy,{rounds:3,goals:['damage'],includeSupportOptions:false});
 const caller=model.evaluate({characterId:1,visionId:-1,equipment:snapshot.characters[0].equipment,current:true});
 assert.equal(caller.skillCost,10);assert.equal(caller.equippedSkillIds.filter(id=>id===CALL).length,1);
 assert.ok(caller.supportActions.some(action=>action.skillId===CALL));
});
test('prescribed normal Call disables ready normal LBs while retaining traits and additional-phase options',()=>{
 const f=fixture({rounds:1,callerMp:40,recipientMp:20}),catalog={...f.catalog,skills:[...f.catalog.skills,{...native.skills.find(skill=>skill.id===401010),id:970004,name:'Caller limit',hasUnit:'Caller',attr:'LimitBurst',cost:100,mag:1,breakDmg:0,criticalHitRate:0}]};
 const model=B.createModel(catalog,f.snapshot,f.enemy,{rounds:1,goals:['damage']});
 const members=f.members.map(member=>({...member,evaluation:model.evaluate({characterId:member.characterId,visionId:-1,equipment:member.equipment})}));
 members[0].evaluation.limit.initial=100;
 const result=model.evaluateParty(members),override=result.actionOverrides[1];
 assert.equal(result.supportUsed.skillId,CALL);assert.equal(override.limit.max,100);assert.equal(override.limit.initial,100);
 assert.deepEqual(override.limit.options,[]);assert.equal(override.bonusLimit.options[0].skillId,970004);
 assert.deepEqual(result.limitUses[1],[]);assert.equal(result.resourceEvents[1].filter(event=>event.skillId===CALL).length,1);
});

test('a normal support caster attacks in its earned bonus phase while the buff persists on recipients',()=>{
 const f=fixture({rounds:1,callerMp:120,recipientMp:60});
 const bravery=native.skills.find(skill=>skill.id===230100);
 const catalog={...f.catalog,skills:[...f.catalog.skills.filter(skill=>skill.id!==CALL),bravery].map(skill=>skill.id===970002?{...skill,effects:[54100],effectBundles:[{effectId:54100,TargetType:'Self',targetRelation:'Friendlies',activeSkillAddTiming:'AfterDamageCalculation',conditionData:{Condition:'None'}}]}:skill),effects:f.catalog.effects.map(effect=>effect.id===54100?{...effect,params:[100,...effect.params.slice(1)]}:effect),statGrowth:{...f.catalog.statGrowth,1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[230100]}]}}};
 const enemy={...f.enemy,stats:{...f.enemy.stats,MaxBreakPoint:1}};
 const model=B.createModel(catalog,f.snapshot,enemy,{rounds:1,goals:['damage'],incomingDamage:1});
 const members=f.members.map(member=>({...member,evaluation:model.evaluate({characterId:member.characterId,visionId:-1,equipment:member.equipment})}));
 const result=model.evaluateParty(members);
 assert.equal(result.supportUsed.skillId,230100);
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===230100).length,1);
 assert.ok(result.resourceEvents[1].some(event=>event.phase==='additional' && event.skillId===970001));
 assert.equal(result.remainingMp[1],120-bravery.cost);
 const bonus=result.resourceEvents[2].find(event=>event.phase==='additional' && event.skillId===970002);
 assert.ok(bonus);assert.equal(bonus.context.additionalDamagePercent,50);
});

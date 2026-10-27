const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function execute({ids=[406080],rotation=null,opening=null,rounds=1,passiveIds=[],wrapper=false,breakRace=false,slowFocus=true,lbReset=false,luckPolicy=null,incomingDamage=0}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'State tester',levelParamId:1,stats:{HitPoint:100,MagicPoint:999,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:breakRace?100:50},baseSkillEquipCost:500,passiveIds:[]}],
  statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[]};
 if(breakRace){catalog.skills=catalog.skills.map(skill=>skill.id===401010?{...skill,breakDmg:100,criticalHitRate:0}:skill);if(!slowFocus)catalog.effects=catalog.effects.map(effect=>effect.id===1382?{...effect,params:effect.params.map((n,i)=>i===0?0:n)}:effect);}
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:ids,equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'State target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:breakRace?100:1e12,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const phase=(keys,useWrapper=wrapper)=>{
  const leaves=keys.map((id,actionIndex)=>{const skill=native.skills.find(s=>s.id===id);return {skillId:id,kind:skill.relation==='Enemies' && skill.mag>0?'attack':'support',actionIndex,context:{}};});
  const wrapperId=typeof useWrapper==='number'?useWrapper:400710;
  let steps=[...(useWrapper?[{skillId:wrapperId,kind:'wrapper',depth:0}]:[]),...leaves.map(leaf=>({...leaf,depth:1}))];
  if(wrapperId===400650 && useWrapper && keys.length>=3)steps=[{skillId:400650,kind:'wrapper',depth:0},{skillId:400710,kind:'wrapper',depth:1},...leaves.slice(0,2).map(leaf=>({...leaf,depth:2})),...(keys.length===4?[{skillId:400710,kind:'wrapper',depth:1}]:[]),...leaves.slice(2).map(leaf=>({...leaf,depth:keys.length===4?2:1}))];
  return {leaves,steps,mp:(useWrapper?native.skills.find(skill=>skill.id===wrapperId).cost:0)+keys.reduce((sum,id)=>sum+native.skills.find(s=>s.id===id).cost,0)};
 };
 const turn=phase(ids),actionPlan={turn,characterId:1,equipment,passiveIds,maxHp:100,maxMp:999,...(rotation?{rotationTurns:rotation.map(keys=>phase(keys))}:{}),...(opening?{openingTurn:phase(opening,false)}:{})};
 if(luckPolicy)actionPlan.luckPolicy={generatorTurn:phase(luckPolicy.generator,false),spenderTurn:phase(luckPolicy.spender),requiredLuck:luckPolicy.requiredLuck,requiredTurnLuck:luckPolicy.requiredTurnLuck};
 const evaluation={damage:999,brokenDamage:999,breakDamage:0,availableMp:999,turnMp:turn.mp,stats:{Agility:50,MaxHitPoint:100,PhysicalDefense:20,MagicalDefense:20},limit:lbReset?{max:200,initial:200,mult:1,fillOnStagger:0,recuperate:0,options:[{skillId:406040,cost:200,damage:1e12,brokenDamage:1e12,breakDamage:0}]}:null,supportActions:[],actionPlan};
 const members=[{characterId:1,equipment,evaluation}];
 if(breakRace){evaluation.limit={max:100,mult:1,initial:0,fillOnStagger:0,recuperate:0,options:[]};members.push({characterId:2,evaluation:{damage:1,brokenDamage:1,breakDamage:100,availableMp:999,turnMp:0,stats:{Agility:80,MaxHitPoint:100,PhysicalDefense:0,MagicalDefense:0},limit:{max:100,mult:1,initial:0,fillOnStagger:0,recuperate:0,options:[]},supportActions:[]}});}
 return B.createModel(catalog,snapshot,enemy,{goals:lbReset?['limit']:['damage'],rounds,incomingDamage,incomingType:'Physic'}).evaluateParty(members);
}
test('Gale gains Good Luck before its own damage, with zero unearned starting stacks',()=>{
 const result=execute({rounds:3});
 assert.equal(result.stateLeafResults[1][0].context.goodLuck,1);
 assert.equal(result.remainingGoodLuck[1],3);
});
test('ActionBegin luck is once per unit turn, not once per selected child',()=>{
 const result=execute({ids:[406080,406080],wrapper:true,passiveIds:[1499]});
 assert.deepEqual(result.stateLeafResults[1].map(leaf=>leaf.context.goodLuck),[2,3]);
 assert.equal(result.remainingGoodLuck[1],3);
});
test('Demolisher checks eight stacks but pays five, while unavailable spenders do not execute',()=>{
 const ready=execute({ids:[406050],passiveIds:[1511]}),empty=execute({ids:[406050]});
 assert.equal(ready.stateLeafResults[1][0].context.goodLuck,3);assert.equal(ready.remainingGoodLuck[1],3);
 assert.equal(empty.damage,0);assert.equal(empty.remainingMp[1],999);
 assert.ok(empty.resourceSkips[1].some(event=>/GoodLuck/.test(event.reason)));
});
test('Overclock boosts the third listed action before expiring, then blocks Mechabo until two BeginTurn events',()=>{
 const result=execute({ids:[404060],opening:[404130],rounds:6});
 const shots=result.resourceEvents[1].filter(event=>event.skillId===404060);
 assert.deepEqual(shots.map(event=>event.round),[2,3,4,6]);
 assert.deepEqual(shots.map(event=>event.common.coefficientScale),[2.5,2.5,2.5,1]);
 assert.ok(result.resourceSkips[1].some(event=>event.round===5 && /Overheat/.test(event.reason)));
 assert.equal(result.overclockCharges[1],0);
});
test('same-level Overclock recasts pay MP without refreshing charges',()=>{
 const result=execute({rotation:[[404130],[404060],[404130],[404060],[404060]],rounds:5});
 assert.equal(result.overclockCharges[1],0);
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===404130).length,2);
});
test('Zero followed by Overclock I keeps two independently charged additive boosts',()=>{
 const result=execute({rotation:[[404130],[404140],[404130],[404060]],rounds:4});
 const shot=result.resourceEvents[1].find(event=>event.skillId===404060);
 assert.equal(shot.common.coefficientScale,5.5);
 assert.deepEqual(result.overclockStates[1].map(clock=>clock.charges),[2,2]);
});
test('Focus proceeds once at ActionBegin and expires before the second subsequent action',()=>{
 const result=execute({ids:[401010],rotation:[[400460],[401010],[401010]],rounds:3});
 const hits=result.resourceEvents[1].filter(event=>event.skillId===401010);
 assert.ok(hits[0].damage>hits[1].damage);
 assert.ok(hits[0].context.activeEffectIds.includes(12907));
 assert.ok(!hits[1].context.activeEffectIds.includes(12907));
});
test('form setup activates its native primary boost and cancellation removes it',()=>{
 const result=execute({rotation:[[408090],[401010],[408150],[401010]],rounds:4});
 const hits=result.resourceEvents[1].filter(event=>event.skillId===401010);
 assert.equal(hits[0].context.demonForm,true);assert.equal(hits[1].context.demonForm,false);
 assert.ok(hits[0].common.attack>hits[1].common.attack);
});

test('Focus speed penalty changes subsequent native-priority ordering',()=>{
 const slow=execute({ids:[401010],opening:[400460],rounds:2,breakRace:true}),control=execute({ids:[401010],opening:[400460],rounds:2,breakRace:true,slowFocus:false});
 assert.ok(slow.gauge[1]<control.gauge[1],'fewer sampled rounds let the slowed Focus actor stagger first');
});

test('an unavailable resource wrapper cannot grant its unpaid child action',()=>{
 const result=execute({ids:[401010],wrapper:406140});
 assert.equal(result.damage,0);assert.equal(result.remainingMp[1],999);
 assert.ok(result.resourceSkips[1].some(event=>event.skillId===406140));
});


test('Glücksschmied uses current luck for damage then clears it after the burst',()=>{
 const result=execute({ids:[406080],rounds:1,passiveIds:[1511],lbReset:true});
 assert.deepEqual(result.limitUses[1],[{round:1,phase:'normal',skillId:406040}]);
 assert.equal(result.remainingGoodLuck[1],0);
});

test('four already queued Mechabo attacks finish after the third exhausts Overclock; the next command is blocked',()=>{
 const result=execute({ids:[404060,404060,404060,404060],wrapper:400650,opening:[404130],rounds:3});
 const shots=result.resourceEvents[1].filter(event=>event.skillId===404060);
 assert.equal(shots.length,4);assert.deepEqual(shots.map(event=>event.common.coefficientScale),[2.5,2.5,2.5,1]);
 assert.ok(shots.every(event=>event.round===2));
 assert.ok(result.resourceSkips[1].some(event=>event.round===3 && /Overheat/.test(event.reason)));
});
test('adaptive luck selection generates until the native threshold is affordable, then returns to generation after spending',()=>{
 const result=execute({ids:[406080],rounds:10,luckPolicy:{generator:[406080],spender:[406050],requiredLuck:8,requiredTurnLuck:8}});
 assert.deepEqual(result.resourceEvents[1].map(event=>event.skillId),[...Array(8).fill(406080),406050,406080]);
 assert.equal(result.remainingGoodLuck[1],4);assert.deepEqual(result.resourceSkips[1],[]);
});
test('adaptive selection requires enough starting luck for every queued spender',()=>{
 const result=execute({ids:[406070,406070,406070],wrapper:400650,rounds:2,passiveIds:[1511],luckPolicy:{generator:[406080],spender:[406070,406070,406070],requiredLuck:3,requiredTurnLuck:9}});
 assert.deepEqual(result.resourceEvents[1].map(event=>event.skillId),[406080,406070,406070,406070]);
 assert.equal(result.remainingGoodLuck[1],0);assert.deepEqual(result.resourceSkips[1],[]);
});

test('a fresh HP-cost queue must be fully affordable before any child is committed',()=>{
 const result=execute({ids:[400490,400490,400490,400490],wrapper:400650,rounds:2,incomingDamage:71});
 assert.equal(result.hpSpent[1],20,'only the first fully affordable four-child queue spends HP');
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===400490).length,4);
 assert.ok(result.resourceSkips[1].some(event=>event.round===2 && /fresh command percentage check/.test(event.reason)));
});

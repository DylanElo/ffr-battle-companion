const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../docs/passives.js'),B=require('../docs/battle.js'),D=require('../docs/damage.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function execute({ids=[447810],passives=[],rounds=1,incomingDamage=0,incomingType='Physic',enemyBreak=1e12,callTarget=1,bonusId,guaranteed=true,party=1,mp=999,deadTarget=false,enemyCount=1,broken=false,leadAgility=100}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const chars=Array.from({length:party},(_,i)=>({id:i+1,name:'Phase tester '+i,levelParamId:1,stats:{HitPoint:10000,MagicPoint:999,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:i===0?leadAgility:100-i*10},baseSkillEquipCost:500,passiveIds:[]}));
 const catalog={...native,skillRules:rules,characters:chars,statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],effects:native.effects.map(effect=>guaranteed && effect.id===54100?{...effect,params:[100,...effect.params.slice(1)]}:effect)};
 const snapshot={characters:chars.map(char=>({id:char.id,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:ids,equippedSkillIds:Array(8).fill(-1),equipment})),resonances:[],inventory:[],party:chars.map(char=>char.id),player:{difficulty:'Normal'}};
 const enemy={id:100,name:'Phase target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:enemyBreak,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const phase=skillId=>{const skill=native.skills.find(s=>s.id===skillId),leaf={skillId,kind:skill.relation==='Enemies'?'attack':'support',actionIndex:0,context:{friendlyTargetId:callTarget}};return {leaves:[leaf],steps:[leaf],mp:skill.cost};};
 const members=chars.map((char,i)=>{const turn=phase(ids[i] || ids[0]);return {characterId:char.id,equipment,evaluation:{damage:1,brokenDamage:1,breakDamage:0,availableMp:mp,turnMp:turn.mp,stats:{Agility:i===0?leadAgility:100-i*10,MaxHitPoint:10000,PhysicalDefense:20,MagicalDefense:20},limit:null,supportActions:[],actionPlan:{turn,bonusTurn:bonusId?phase(bonusId):undefined,characterId:char.id,equipment,passiveIds:passives,maxHp:deadTarget && char.id===callTarget?0:10000,maxMp:999}}};});
 return B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,incomingDamage,incomingType,enemyCount,broken}).evaluateParty(members);
}
test('skill-end grants one paid additional participation and cannot chain',()=>{
 const result=execute();
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===447810).length,2);
 assert.equal(result.remainingMp[1],969);
 assert.deepEqual(result.resourceEvents[1].map(event=>event.phase),['normal','additional']);
});
test('duplicate grant sources deduplicate the same beneficiary',()=>{
 const result=execute({enemyBreak:1});
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===447810).length,2);
});
test('Call to Action grants the selected ally after all normal actors finish',()=>{
 const result=execute({ids:[401140,401010],party:2,callTarget:2});
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===401140).length,1);
 assert.equal(result.resourceEvents[2].filter(event=>event.skillId===401010).length,2);
 assert.equal(result.remainingMp[1],959);
});
test('ExPhase lock rejects a new Call to Action during additional phase',()=>{
 const result=execute({bonusId:401140});
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===401140).length,0);
 assert.ok(result.resourceSkips[1].some(event=>/ExPhase/.test(event.reason)));
});
test('Bonus Damage applies only to additional participation',()=>{
 const result=execute({passives:[1335]});const events=result.resourceEvents[1].filter(event=>event.skillId===447810);
 assert.ok(events[1].damage>events[0].damage);assert.equal(events[0].context.extraPhase,false);assert.equal(events[1].context.extraPhase,true);
});
test('controlled incoming event occurs once per global round, not for each participation',()=>{
 const result=execute({incomingDamage:100});
 assert.equal(result.resourceEvents[1].filter(event=>event.kind==='incoming').length,1);
 assert.equal(result.remainingHp[1],9900);
});
test('Hit and Run nullifies physical incoming damage after a committed attack',()=>{
 const original=D.skillHitSuccess;D.skillHitSuccess=(accuracy,...rest)=>accuracy===35?true:original(accuracy,...rest);
 try{const result=execute({passives:[1334],incomingDamage:100});const incoming=result.resourceEvents[1].find(event=>event.kind==='incoming');assert.equal(incoming.damage,0);assert.equal(incoming.nullified,true);assert.equal(result.remainingHp[1],10000);}
 finally{D.skillHitSuccess=original;}
});
test('Hit and Run cannot nullify magic or support-only action history',()=>{
 const original=D.skillHitSuccess;D.skillHitSuccess=(accuracy,...rest)=>accuracy===35?true:original(accuracy,...rest);
 try{for(const options of [{incomingType:'Magic'},{ids:[401140]}]){const result=execute({...options,passives:[1334],incomingDamage:100});assert.equal(result.remainingHp[1],9900);}}
 finally{D.skillHitSuccess=original;}
});

test('Additional Gamble bypasses both critical-or-miss and ordinary accuracy checks',()=>{
 const first=D.gambleSuccess,hit=D.skillHitSuccess;D.gambleSuccess=()=>false;D.skillHitSuccess=(accuracy,...rest)=>accuracy===100?hit(accuracy,...rest):false;
 try{const result=execute({ids:[401140,406060],party:2,callTarget:2});const events=result.resourceEvents[2].filter(event=>event.skillId===406060);
 assert.equal(events.length,2);assert.equal(events[0].gambleOutcome,false);assert.equal(events[1].gambleOutcome,true);assert.equal(events[1].context.extraPhase,true);assert.equal(events[1].goodLuckAfter,5);
 }finally{D.gambleSuccess=first;D.skillHitSuccess=hit;}
});
test('normal and additional participations share state and pay every selected leaf',()=>{
 const result=execute({ids:[401140],bonusId:406080,passives:[1499],callTarget:1});
 const gale=result.resourceEvents[1].find(event=>event.skillId===406080);assert.equal(gale.phase,'additional');assert.equal(gale.context.goodLuck,2);assert.equal(result.remainingGoodLuck[1],2);
});

test('an earned additional action still requires its full MP payment',()=>{
 const result=execute({mp:15});assert.equal(result.resourceEvents[1].filter(event=>event.skillId===447810).length,1);assert.equal(result.remainingMp[1],0);assert.ok(result.resourceSkips[1].some(event=>event.resource==='MP'));
});
test('Call to Action targeting a dead ally neither pays MP nor grants participation',()=>{
 const result=execute({ids:[401140,401010],party:2,callTarget:2,deadTarget:true});assert.equal(result.remainingMp[1],999);assert.equal(result.resourceEvents[1].filter(event=>event.skillId===401140).length,0);assert.ok(result.resourceSkips[1].some(event=>/friendly target/.test(event.reason)));
});

test('Warp Crit ties guaranteed proc chance to sampled actual critical damage',()=>{
 const oldCrit=D.criticalProbability,oldHit=D.skillHitSuccess;D.criticalProbability=()=>1;D.skillHitSuccess=(chance,...rest)=>chance>=100;
 try{const result=execute({passives:[1466],guaranteed:false});const events=result.resourceEvents[1].filter(event=>event.skillId===447810);assert.equal(events.length,2);assert.equal(events[0].context.anyCritical,true);assert.ok(events[0].context.criticalOutcomes.every(Boolean));}
 finally{D.criticalProbability=oldCrit;D.skillHitSuccess=oldHit;}
});
test('Warp Crit cannot grant its critical-only bonus when every sampled part is noncritical',()=>{
 const oldCrit=D.criticalProbability,oldHit=D.skillHitSuccess;D.criticalProbability=()=>0;D.skillHitSuccess=(chance,...rest)=>chance>=100;
 try{const result=execute({passives:[1466],guaranteed:false});const events=result.resourceEvents[1].filter(event=>event.skillId===447810);assert.equal(events.length,1);assert.equal(events[0].context.anyCritical,false);}
 finally{D.criticalProbability=oldCrit;D.skillHitSuccess=oldHit;}
});

test('Additional participation neither decrements Focus nor emits normal ActionBegin luck',()=>{
 const result=execute({ids:[401140,400460],party:2,callTarget:2,bonusId:406080,passives:[1499]});
 const bonus=result.resourceEvents[2].find(event=>event.skillId===406080);assert.equal(bonus.phase,'additional');assert.equal(bonus.focusLife,2);assert.ok(bonus.context.activeEffectIds.includes(12907));assert.equal(bonus.context.goodLuck,2);
});

test('all missed Warp parts cannot crit, install its proc, or consume proc chance RNG',()=>{
 const oldCrit=D.criticalProbability,oldHit=D.skillHitSuccess;let calls=[];D.criticalProbability=()=>1;D.skillHitSuccess=chance=>{calls.push(chance);return false;};
 try{const result=execute({passives:[1466],guaranteed:false});const events=result.resourceEvents[1].filter(event=>event.skillId===447810);assert.equal(events.length,1);assert.equal(result.damage,0);assert.equal(result.remainingMp[1],984);assert.equal(events[0].context.anyHit,false);assert.equal(events[0].context.anyCritical,false);assert.ok(events[0].context.criticalOutcomes.every(value=>value===false));assert.ok(calls.every(chance=>chance===100));}
 finally{D.criticalProbability=oldCrit;D.skillHitSuccess=oldHit;}
});
test('only successful Warp parts become actual criticals for Warp Crit',()=>{
 const oldCrit=D.criticalProbability,oldHit=D.skillHitSuccess;let accuracyCalls=0;D.criticalProbability=()=>1;D.skillHitSuccess=(chance,...rest)=>chance===100?++accuracyCalls%2===0:chance>=100;
 try{const result=execute({passives:[1466],guaranteed:false});const normal=result.resourceEvents[1].find(event=>event.skillId===447810 && event.phase==='normal');assert.deepEqual(normal.context.attackHitOutcomes,[false,true]);assert.deepEqual(normal.context.criticalOutcomes,[false,true]);assert.equal(normal.context.anyCritical,true);}
 finally{D.criticalProbability=oldCrit;D.skillHitSuccess=oldHit;}
});

test('only stochastic combat paths expand to thirty-two samples',()=>{
 const random=execute({guaranteed:false}),deterministic=execute({ids:[401140],bonusId:406080,callTarget:1});assert.equal(random.combatSamples,32);assert.equal(random.initiativeSamples,32);assert.equal(deterministic.initiativeSamples,1);
 const bonusOnlyRandom=execute({ids:[401140],bonusId:406060,callTarget:1});assert.equal(bonusOnlyRandom.gambleSamples,32);assert.equal(bonusOnlyRandom.combatSamples,32);
});

test('Vaan source Break proc waits for all corrected hit parts and grants one eligible ally',()=>{
 const oldAnalyze=P.analyze,oldHit=D.skillHitSuccess;let context,parts=0,procInputs=[];
 P.analyze=(...args)=>{if(args[2]?.skill?.id===447410 && Array.isArray(args[2].attackHitOutcomes))context=args[2];return oldAnalyze(...args);};
 D.skillHitSuccess=(chance,...rest)=>{if(chance===100)return ++parts%3===1;if(chance===20){procInputs.push([...context.attackHitOutcomes]);return true;}return oldHit(chance,...rest);};
 try{const result=execute({ids:[447410,401010,401010],party:3,enemyCount:2,enemyBreak:1,leadAgility:1000000});
 assert.equal(procInputs.length,32);assert.ok(procInputs.every(parts=>parts.length===3 && parts.every(Boolean)));assert.equal(Object.values(result.extraActions).reduce((sum,count)=>sum+count,0),2);
 }finally{P.analyze=oldAnalyze;D.skillHitSuccess=oldHit;}
});
test('all-party basic stagger grants finish before Vaan evaluates its remaining ally pool',()=>{
 const oldHit=D.skillHitSuccess;let procs=0;D.skillHitSuccess=(chance,...rest)=>{if(chance===20){procs++;return true;}return oldHit(chance,...rest);};
 try{const result=execute({ids:[447410,401010,401010],party:3,enemyBreak:1,leadAgility:1000000});assert.equal(procs,32);assert.ok(Object.values(result.extraActions).every(count=>count===1));assert.ok(Object.values(result.phaseEvents).flat().every(event=>event.reason!=='random-ally-stagger'));
 }finally{D.skillHitSuccess=oldHit;}
});
test('Vaan does not dispatch source Break again against an already staggered target',()=>{
 const oldHit=D.skillHitSuccess;let procs=0;D.skillHitSuccess=(chance,...rest)=>{if(chance===20)procs++;return oldHit(chance,...rest);};
 try{const result=execute({ids:[447410,401010],party:2,enemyCount:2,broken:true});assert.equal(procs,0);assert.ok(Object.values(result.extraActions).every(count=>count===0));}
 finally{D.skillHitSuccess=oldHit;}
});

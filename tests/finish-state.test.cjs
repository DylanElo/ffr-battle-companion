const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../docs/passives.js'),B=require('../docs/battle.js'),D=require('../docs/damage.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function execute({rounds=1,enemyCount=1,enemyBreak=1,broken=false,finishIds=[440020],normalId=401010,mp=1000,atk=100,mag=100,mind=20,dead=false,party=1,unsupported=false,limits=[],mps=[],leadAgility=50,bravery=false,incomingDamage=0,goals=['damage'],maxHps=[],passives=[],normalIds=[],incomingType='Physic'}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const characters=Array.from({length:party},(_,i)=>({id:i+1,name:'Finish tester '+i,levelParamId:1,stats:{HitPoint:maxHps[i]??1000,MagicPoint:1000,Attack:atk,Intelligence:mag,Mind:mind,Defence:20,Agility:i===0?leadAgility:50},baseSkillEquipCost:500,passiveIds:[]}));
 const catalog={...native,skillRules:rules,characters,statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[]};
 const snapshot={characters:characters.map(char=>({id:char.id,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[normalId,...normalIds,401010,220010],equippedSkillIds:Array(8).fill(-1),equipment})),resonances:[],inventory:[],party:characters.map(char=>char.id),player:{difficulty:'Normal'}};
 const enemy={id:100,name:'Finish target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:enemyBreak,Agility:0,Defence:150,Mind:150},resistances:{},passiveIds:[]};
 const members=characters.map((char,i)=>{
  const actionId=normalIds[i]??normalId,normal=native.skills.find(skill=>skill.id===actionId),leaf={skillId:actionId,kind:normal.relation==='Enemies'?'attack':'support',actionIndex:0,context:{}},turn={leaves:[leaf],steps:[leaf],mp:normal.cost,...(actionId===400790?{reactionSkills:[401010,220010]}:{})};
  return {characterId:char.id,equipment,evaluation:{skillId:actionId,turn,damage:1,brokenDamage:1,breakDamage:0,availableMp:mps[i]??mp,turnMp:normal.cost,stats:{Agility:50,MaxHitPoint:maxHps[i]??1000,PhysicalDefense:20,MagicalDefense:20},limit:limits[i] || null,supportActions:bravery && i===0?P.supportActions(catalog,[230100]).buffs:[],finish:finishIds[i]?{skillId:finishIds[i],visionId:13000+i,name:native.skills.find(skill=>skill.id===finishIds[i]).name,kind:finishIds[i]===412620?'protection':[414100,412510,412600].includes(finishIds[i])?'healing':'damage',supported:!unsupported,mpCost:0,apCost:0,secondaryReasons:[]}:null,actionPlan:{turn,characterId:char.id,equipment,passiveIds:passives,maxHp:dead?0:maxHps[i]??1000,maxMp:1000}}};
 });
 return B.createModel(catalog,snapshot,enemy,{goals,rounds,enemyCount,broken,incomingDamage,incomingType}).evaluateParty(members);
}
const finishes=result=>Object.values(result.resourceEvents).flat().filter(event=>event.kind==='finish');
test('one direct Finish executes after Additional with owner resources and no AP or MP charge',()=>{
 const result=execute(),events=result.resourceEvents[1];assert.equal(result.finishUses[1].length,1);assert.equal(result.expectedFinishUses[1],1);assert.equal(finishes(result).length,1);
 assert.deepEqual(events.map(event=>event.phase),['normal','additional','finish']);const finish=finishes(result)[0];assert.equal(finish.mpCost,0);assert.equal(finish.hpCost,0);assert.ok(finish.mpAfter>0);assert.equal(finish.common.attackSource,'ATK');assert.equal(finish.context.extraPhase,true);assert.ok(finish.context.activeEffectIds.includes(12966));
});
test('Finish needs both an entered Additional phase and all living enemies staggered',()=>{
 for(const options of [{enemyCount:2},{broken:true},{enemyBreak:1e12}])assert.equal(finishes(execute(options)).length,0);
});
test('no selected Finish metadata, unsupported Finish or dead owner produces no Finish attack',()=>{
 for(const options of [{finishIds:[]},{unsupported:true},{dead:true}])assert.equal(finishes(execute(options)).length,0);
});
test('a new qualified round can use Finish again without a made-up readiness gauge',()=>{
 const result=execute({rounds:3});assert.deepEqual(result.finishUses[1].map(use=>use.round),[1,2,3]);assert.equal(result.expectedFinishUses[1],3);
});
test('the party selects one strongest eligible Finish rather than all vision owners',()=>{
 const result=execute({party:2,finishIds:[440020,412170],atk:20,mag:200});assert.equal(finishes(result).length,1);assert.equal(finishes(result)[0].skillId,412170);assert.equal(result.finishUses[1].length,0);assert.equal(result.finishUses[2].length,1);
});
test('Magic Finish uses current owner MAG rather than Divine or vision base stats',()=>{
 const a=finishes(execute({finishIds:[412170],mag:100,mind:500}))[0],b=finishes(execute({finishIds:[412170],mag:200,mind:1}))[0];assert.equal(a.common.attackSource,'MAG');assert.equal(a.common.attack,100);assert.equal(b.common.attack,200);assert.ok(b.damage>a.damage,JSON.stringify([a.damage,b.damage,a.common.attack,a.common.defense,a.common.level]));
});

test('Tidus appends one distinct Group damage part inside the same Finish with inherited level scaling',()=>{
 const result=execute({finishIds:[440210]}),events=result.resourceEvents[1],primary=events.find(event=>event.kind==='finish'),child=events.find(event=>event.kind==='finish-append');
 assert.ok(child);assert.equal(child.skillId,440230);assert.equal(child.parentSkillId,440210);assert.equal(child.mpCost,0);assert.equal(child.hpCost,0);assert.equal(child.paymentSuppressed,true);assert.equal(child.common.skill.mag,21);assert.equal(child.common.skill.target,'Group');assert.equal(child.common.coefficientScale,primary.common.coefficientScale);assert.ok(child.common.coefficientScale>1);assert.ok(child.damage>0);assert.ok(events.indexOf(primary)<events.indexOf(child));assert.equal(events.filter(event=>event.kind==='finish').length,1);
});
test('a zero-MP owner can use its zero-cost Finish even when its ordinary actions are unaffordable',()=>{
 const result=execute({party:2,finishIds:[null,412170],mps:[1000,0]});const finish=finishes(result)[0];assert.ok(finish);assert.equal(finish.skillId,412170);assert.equal(finish.mpAfter,0);assert.equal(finish.mpCost,0);
});
test('Finish SkillEnd LB gain is twenty raw points, strongest charge-scaled, truncated and clamped',()=>{
 const limit=(max,mult=1,initial=0)=>({max,mult,initial,fillOnStagger:0,recuperate:0,options:[]});
 for(const [max,mult,initial,expected] of [[100,1,0,20],[200,1,0,20],[200,2,0,40],[200,3,0,60],[200,3,190,10]]){
  const result=execute({party:2,finishIds:[null,440020],limits:[null,limit(max,mult,initial)],leadAgility:1000000}),finish=finishes(result)[0];assert.equal(finish.lbGained,expected);assert.equal(finish.gaugeAfter,Math.min(max,initial+20*mult));
 }
});

test('party Bravery reaches physical Finish only after its paid normal support cast',()=>{
 const options={party:2,finishIds:[null,440020],atk:200,mag:200,leadAgility:1000000};const baseline=execute(options),buffed=execute({...options,bravery:true});assert.ok(buffed.supportUsed);assert.ok(finishes(buffed)[0].damage>finishes(baseline)[0].damage);assert.equal(finishes(buffed)[0].context.additionalDamagePercent,50);
 const noMp=execute({...options,bravery:true,mps:[0,1000]});assert.equal(finishes(noMp)[0].context.additionalDamagePercent,undefined);
});
test('a physical-only Bravery buff is not copied into Magic Finish',()=>{
 const options={party:2,finishIds:[null,412170],atk:200,mag:200,leadAgility:1000000};const baseline=execute(options),buffed=execute({...options,bravery:true});assert.equal(finishes(buffed)[0].context.additionalDamagePercent,undefined);assert.equal(finishes(buffed)[0].damage,finishes(baseline)[0].damage);
});

test('healing Finish uses owner Divine recovery and caps normal recipient HP, not damage arithmetic',()=>{
 const result=execute({finishIds:[412510],incomingDamage:100,goals:['durability']}),heal=result.resourceEvents[1].find(event=>event.kind==='finish-heal');assert.ok(heal);assert.equal(heal.common.statSource,'Divine');assert.equal(heal.healing,D.recovery({divine:heal.common.divine,coefficient:heal.common.coefficient,rules:native.battleRules,exPhase:true,cap:9999}).amount);assert.equal(heal.effectiveHealing,100);assert.equal(heal.recipients[0].hpAfter,1000);assert.equal(result.remainingHp[1],1000);assert.equal(result.finishUses[1].length,1);assert.equal(heal.mpCost,0);
 const other=execute({finishIds:[412510],incomingDamage:100,mag:999,goals:['durability']}).resourceEvents[1].find(event=>event.kind==='finish-heal');assert.equal(other.healing,heal.healing);
});
test('Leah OverHeal raises living targets above maximum HP while retaining the native per-heal amount cap',()=>{
 const result=execute({finishIds:[414100],goals:['durability']}),heal=result.resourceEvents[1].find(event=>event.kind==='finish-heal');assert.ok(heal.common.overheal);assert.equal(heal.common.cap,9999);assert.ok(result.remainingHp[1]>1000);assert.equal(heal.recipients[0].hpAfter,1000+heal.healing);assert.equal(heal.effectiveHealing,heal.healing);
});
test('group healing Finish excludes dead allies and does not invent resurrection',()=>{
 const result=execute({party:2,finishIds:[412510,null],incomingDamage:1000,maxHps:[2000,1000],goals:['durability'],leadAgility:1000000}),heal=result.resourceEvents[1].find(event=>event.kind==='finish-heal');assert.ok(heal);assert.deepEqual(heal.recipients.map(target=>target.characterId),[1]);assert.equal(result.remainingHp[2],0);
});
test('durability chooses the healing Finish by effective restored HP among party options',()=>{
 const result=execute({party:2,finishIds:[440020,412510],incomingDamage:600,goals:['durability']});assert.equal(Object.values(result.finishUses).flat().length,1);assert.equal(result.finishUses[2][0].skillId,412510);const heal=result.resourceEvents[2].find(event=>event.kind==='finish-heal');assert.ok(heal.effectiveHealing>0);assert.equal(heal.effectiveHealing,heal.recipients.reduce((sum,target)=>sum+target.healed,0));
});

test('Wilhelm protects the next incoming physical or magic skill and consumes that guard once',()=>{
 for(const incomingType of ['Physic','Magic']){const result=execute({finishIds:[412620],rounds:2,incomingDamage:100,goals:['durability'],incomingType}),hits=result.resourceEvents[1].filter(event=>event.kind==='incoming');assert.equal(hits[0].damage,100);assert.equal(hits[1].damage,30);assert.equal(hits[1].guardsConsumed,true);assert.deepEqual(hits[1].guardEffects.map(guard=>guard.effectId),[16129]);assert.ok(hits[1].guardFactor>.3 && hits[1].guardFactor<.300001);const guards=result.resourceEvents[1].filter(event=>event.kind==='finish-protection');assert.equal(guards[0].expectedProtection,70);assert.equal(guards[1].expectedProtection,0);assert.equal(result.finishUses[1].length,2);}
});
test('Cecil deals its Finish damage and applies the same one-use group guard without another Finish cast',()=>{
 const result=execute({finishIds:[440040],rounds:2,incomingDamage:100}),events=result.resourceEvents[1],hits=events.filter(event=>event.kind==='incoming');assert.equal(hits[1].damage,50);assert.equal(hits[1].guardEffects[0].effectId,16100);assert.equal(events.filter(event=>event.kind==='finish').length,2);assert.ok(events.filter(event=>event.kind==='finish-protection').every(event=>event.paymentSuppressed));assert.equal(result.finishUses[1].length,2);
});
test('a nullified incoming skill still consumes the one-use Finish guard',()=>{
 const old=D.skillHitSuccess;D.skillHitSuccess=(chance,...args)=>chance===35?true:old(chance,...args);
 try{const result=execute({finishIds:[412620],rounds:2,incomingDamage:100,goals:['durability'],passives:[1334]}),hit=result.resourceEvents[1].find(event=>event.kind==='incoming' && event.round===2);assert.equal(hit.damage,0);assert.equal(hit.nullified,true);assert.equal(hit.guardsConsumed,true);assert.equal(hit.guardEffects[0].effectId,16129);}
 finally{D.skillHitSuccess=old;}
});
test('refreshing an unconsumed Finish guard does not stack the same status',()=>{
 const result=execute({finishIds:[412620],rounds:3,goals:['durability']});assert.equal(result.remainingGuards[1].length,1);assert.equal(result.remainingGuards[1][0].effectId,16129);
});
test('Mirror and Finish guard multiply before the single truncation, keeping the ordinary minimum one',()=>{
 const result=execute({party:2,normalIds:[401010,400790],finishIds:[412620,null],rounds:2,incomingDamage:100,goals:['durability'],leadAgility:1000000}),hit=result.resourceEvents[2].find(event=>event.kind==='incoming' && event.round===2);assert.equal(hit.damage,15);assert.equal(hit.mirrorReduction,true);assert.equal(hit.guardsConsumed,true);
 const tiny=execute({finishIds:[412620],rounds:2,incomingDamage:1,goals:['durability']}).resourceEvents[1].find(event=>event.kind==='incoming' && event.round===2);assert.equal(tiny.damage,1);
});

test('normal recovery preserves previously accumulated OverHeal excess without increasing that excess',()=>{
 const old=D.skillHitSuccess;let events=0;D.skillHitSuccess=(chance,...args)=>chance===35?++events%4!==3:old(chance,...args);
 try{const result=execute({party:2,finishIds:[412510,414100],rounds:2,incomingDamage:450,goals:['durability'],passives:[1334],leadAgility:1000000});const first=result.resourceEvents[2].find(event=>event.kind==='finish-heal' && event.round===1),second=result.resourceEvents[1].find(event=>event.kind==='finish-heal' && event.round===2);assert.equal(first.skillId,414100);assert.equal(second.skillId,412510);const preserved=second.recipients.find(target=>target.characterId===2);assert.ok(preserved.hpBefore>preserved.maxHp);assert.equal(preserved.hpAfter,preserved.hpBefore);assert.equal(preserved.healed,0);assert.ok(preserved.extraHpBefore>0);}
 finally{D.skillHitSuccess=old;}
});
test('odd incoming damage combines Mirror and Finish guard before truncating once',()=>{
 const result=execute({party:2,normalIds:[401010,400790],finishIds:[412620,null],rounds:2,incomingDamage:107,goals:['durability'],leadAgility:1000000}),hit=result.resourceEvents[2].find(event=>event.kind==='incoming' && event.round===2);assert.equal(hit.damage,16);
});

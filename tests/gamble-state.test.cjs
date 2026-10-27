const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),D=require('../docs/damage.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({rounds=1,lucky=false,critical=false,count=1,broken=false,evasion=0,enemyBreak=1e12}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'Gamble tester',levelParamId:1,stats:{HitPoint:1000,MagicPoint:1000,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:500,passiveIds:[]}],
  statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:[...native.passives,{id:990002,effectBundles:[{effectId:990003,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit'}]}],effects:[...native.effects,{id:990003,type:'Avoidance',params:[evasion,1,-1,-1,-1,-1,-1,-1],prob:100,activationProbability:100}]};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:[406060],equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Gamble target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:enemyBreak,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:evasion?[990002]:[]};
 const leaves=Array.from({length:count},(_,actionIndex)=>({skillId:406060,kind:'attack',actionIndex,context:{}}));
 const turn={leaves,steps:[...(count===2?[{skillId:400710,kind:'wrapper',depth:0}]:[]),...leaves.map(leaf=>({...leaf,depth:1}))],mp:18*count};
 const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,critical,broken,includeSupportOptions:false});
 const evaluation={damage:100,brokenDamage:100,breakDamage:0,availableMp:1000,turnMp:turn.mp,stats:{Agility:50,MaxHitPoint:1000,PhysicalDefense:20,MagicalDefense:20},limit:null,supportActions:[],
  actionPlan:{turn,characterId:1,equipment,passiveIds:lucky?[1511]:[],maxHp:1000,maxMp:1000}};
 return {result:()=>model.evaluateParty([{characterId:1,equipment,evaluation}]),model,input:{characterId:1,visionId:-1,equipment},catalog,snapshot,enemy};
}
function force(outcome,run){const original=D.gambleSuccess;let draws=0;D.gambleSuccess=(...args)=>{draws++;return typeof outcome==='function'?outcome(draws,...args):outcome;};try{return {value:run(),draws};}finally{D.gambleSuccess=original;}}

test('Gamble uses a reproducible 32-path discrete state forecast',()=>{
 const f=fixture({rounds:5});const a=f.result(),b=f.result();
 assert.equal(a.gambleSamples,32);assert.equal(a.initiativeSamples,32);assert.equal(a.sampleKind,'native-initiative-and-gamble');
 assert.deepEqual(a,b);assert.ok(Number.isInteger(a.remainingGoodLuck[1]));
 assert.ok(a.resourceEvents[1].every(event=>Number.isInteger(event.goodLuckAfter)));
});
test('one failed selected Gamble misses all animation ratios, still pays MP and gains no luck',()=>{
 const {value,draws}=force(false,()=>fixture().result());
 assert.equal(draws,32);assert.equal(value.damage,0);assert.equal(value.breakDamage,0);
 assert.equal(value.remainingMp[1],982);assert.equal(value.remainingGoodLuck[1],0);
 const event=value.resourceEvents[1][0];assert.equal(event.gambleOutcome,false);assert.equal(event.goodLuckAfter,0);
 assert.equal(value.stateLeafResults[1].length,1);
});
test('one successful selected Gamble guarantees critical damage and grants five luck once',()=>{
 const {value,draws}=force(true,()=>fixture().result());
 assert.equal(draws,32);assert.ok(value.damage>0);assert.ok(value.breakDamage>0);
 assert.equal(value.remainingMp[1],982);assert.equal(value.remainingGoodLuck[1],5);
 const event=value.resourceEvents[1][0];assert.equal(event.gambleOutcome,true);assert.equal(event.context.goodLuck,0);assert.equal(event.goodLuckAfter,5);
});
test('each selected Gamble gets its own outcome, rather than rerolling all eight hit ratios',()=>{
 const {value,draws}=force(index=>index%2===0,()=>fixture({count:2}).result());
 assert.equal(draws,64);assert.equal(value.remainingGoodLuck[1],5);assert.equal(value.remainingMp[1],964);
 assert.deepEqual(value.resourceEvents[1].map(event=>event.gambleOutcome),[false,true]);
});
test('critical scenario settings cannot turn a failed Gamble into a hit',()=>{
 const value=force(false,()=>fixture({critical:true}).result()).value;
 assert.equal(value.damage,0);assert.equal(value.remainingGoodLuck[1],0);
});
test('native Lucky Time starts at eight integer stacks and successful Gamble caps at ten',()=>{
 const value=fixture({lucky:true}).result();
 assert.equal(value.remainingGoodLuck[1],10);assert.ok(value.damage>0);
 assert.equal(value.resourceEvents[1][0].context.goodLuck,8);assert.equal(value.resourceEvents[1][0].gambleOutcome,true);
});
test('preview weights critical hit damage by Gamble probability instead of adding normal damage for misses',()=>{
 const f=fixture(),preview=f.model.evaluate(f.input);
 const plain={...native.skills.find(skill=>skill.id===406060),id:990001,effects:[],effectBundles:[]};
 const catalog={...f.catalog,skills:[plain]},snapshot={...f.snapshot,characters:f.snapshot.characters.map(person=>({...person,activeSkillIds:[plain.id]}))};
 const critical=B.createModel(catalog,snapshot,f.enemy,{goals:['damage'],critical:true,rounds:1,includeSupportOptions:false}).evaluate(f.input);
 assert.equal(preview.hitProbability,D.gambleHitProbability(0));
 assert.equal(preview.damageMin,0);assert.ok(Math.abs(preview.damage-critical.damage*preview.hitProbability)<1e-6);
});

test('first-stage success still makes eight separate ordinary accuracy checks',()=>{
 const original=D.skillHitSuccess;let draws=0;D.skillHitSuccess=()=>++draws%8===0;
 try{const {value}=force(true,()=>fixture().result());assert.equal(draws,32*8);assert.ok(value.damage>0);assert.equal(value.remainingGoodLuck[1],5);assert.equal(value.resourceEvents[1][0].context.gambleHitOutcomes.filter(Boolean).length,1);}
 finally{D.skillHitSuccess=original;}
});
test('eight ordinary accuracy misses grant no luck even after successful critical stage',()=>{
 const original=D.skillHitSuccess;D.skillHitSuccess=()=>false;
 try{const {value}=force(true,()=>fixture().result());assert.equal(value.damage,0);assert.equal(value.breakDamage,0);assert.equal(value.remainingGoodLuck[1],0);assert.equal(value.remainingMp[1],982);}
 finally{D.skillHitSuccess=original;}
});
test('already staggered target bypasses both Gamble and ordinary accuracy checks',()=>{
 const original=D.skillHitSuccess;let calls=0;D.skillHitSuccess=()=>{calls++;return false;};
 try{const {value,draws}=force(false,()=>fixture({broken:true}).result());assert.equal(draws,0);assert.equal(calls,0);assert.ok(value.damage>0);assert.equal(value.remainingGoodLuck[1],5);}
 finally{D.skillHitSuccess=original;}
});

test('native target evasion lowers sampled damage while keeping actual luck integer',()=>{
 const plain=fixture({rounds:5}).result(),evaded=fixture({rounds:5,evasion:75}).result();
 assert.ok(evaded.damage<plain.damage);assert.ok(Number.isInteger(evaded.remainingGoodLuck[1]));
 assert.ok(evaded.resourceEvents[1].every(event=>!event.context || event.context.gambleHitOutcomes.every(value=>typeof value==='boolean')));
});

test('a stagger from the first part makes the seven following parts hit and grants luck once',()=>{
 const original=D.skillHitSuccess;let calls=0;D.skillHitSuccess=()=>++calls%8===1;
 try{const {value}=force(true,()=>fixture({enemyBreak:1}).result());const event=value.resourceEvents[1][0];
  assert.equal(calls,32*8);assert.equal(event.context.gambleHitOutcomes.filter(Boolean).length,8);assert.equal(event.goodLuckAfter,5);assert.equal(value.remainingGoodLuck[1],5);
 }finally{D.skillHitSuccess=original;}
});

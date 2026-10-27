const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({incomingDamage=0,learnMirror=true,magic=true,mp=100,learnedAttacks=false,budget=500,slots=8,rounds=1,goals=['damage'],darkness=false}={}){
 const base=native.skills.find(s=>s.id===220010),physical={...base,id:930001,name:'Physical response',attr:'Ability',dmgType:'Physic',calcType:'Physic',element:'None',cost:3,equipCost:15,mag:50,breakDmg:0,criticalHitRate:0};
 const magical={...base,id:930002,name:'Magical response',attr:'Magic',dmgType:'Magic',calcType:'Magic',element:'None',cost:4,equipCost:20,mag:50,breakDmg:0,criticalHitRate:0};
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1},attacks=[darkness?native.skills.find(s=>s.id===400490):physical,...(magic?[magical]:[])],setups=learnMirror?[400790]:[];
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'Counter unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:mp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:budget,passiveIds:[]}],
 statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...setups,...(learnedAttacks?attacks.map(s=>s.id):[])]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:[],skills:[...attacks,...setups.map(id=>native.skills.find(s=>s.id===id))]};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:learnedAttacks?[]:attacks.map(s=>s.id),equippedSkillIds:Array(slots).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Counter target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const model=B.createModel(catalog,snapshot,enemy,{goals,rounds,incomingDamage,incomingType:'Physic',includeSupportOptions:false});
 const result=model.evaluate({characterId:1,visionId:-1,equipment});
 return {result,catalog,model,equipment,attacks};
}

// Exercise a fixed, initially affordable stance independently of optimizer ranking.
function simulateCounterPair(options){
 const {model,equipment,attacks}=fixture(options);
 const leaf={skillId:400790,kind:'support',context:{},actionIndex:0};
 const turn={...(options.selectionMp!==undefined?{selectionMp:options.selectionMp}:{}),reactionSetup:true,reactionSkills:attacks.map(skill=>skill.id),stateful:true,mp:0,leaves:[leaf],steps:[{...leaf,depth:0}]};
 const evaluation={damage:0,brokenDamage:0,breakDamage:0,availableMp:options.mp,turnMp:0,
  stats:{Agility:50,MaxHitPoint:500,PhysicalDefense:20,MagicalDefense:20},limit:null,supportActions:[],
  actionPlan:{turn,characterId:1,equipment,passiveIds:[],maxHp:500,maxMp:options.mp}};
 return model.evaluateParty([{characterId:1,equipment,evaluation}]);
}
test('no incoming event grants no automatic Moiety counter damage',()=>{
 const {result}=fixture();
 assert.equal(result.valid,true);assert.equal(result.turn.reactionSetup,undefined);
});
test('configured incoming damage can select an owned conditional counter pair, without ordinary attack leaves',()=>{
 const {result}=fixture({incomingDamage:100});
 assert.equal(result.turn.reactionSetup,true);
 assert.deepEqual(result.turn.reactionSkills,[930001,930002]);
 assert.deepEqual(result.turn.leaves.map(leaf=>[leaf.skillId,leaf.kind]),[[400790,'support']]);
 assert.equal(result.damage,0,'the stance itself is not two immediate attacks');
 assert.ok(result.fightDamage>0,'only the explicit incoming event contributes reaction damage');
 assert.equal(result.remainingMp,93,'the selected responses each pay their own MP');
 assert.equal(result.equippedSkillIds.filter(id=>id===400790).length,1);
});
test('reaction setup requires both damage types and learned Mirror ownership',()=>{
 for(const options of [{learnMirror:false},{magic:false}])assert.equal(fixture({...options,incomingDamage:100}).result.turn.reactionSetup,undefined);
});
test('the physical and magical response abilities consume their unique AP and slots',()=>{
 const {result,catalog}=fixture({incomingDamage:100,learnedAttacks:true,budget:75,slots:3});
 assert.equal(result.turn.reactionSetup,true);
 assert.equal(result.skillCost,75);
 assert.equal(result.equippedSkillIds.length,3);
 assert.equal(result.skillCost,result.equippedSkillIds.reduce((sum,id)=>sum+catalog.skills.find(s=>s.id===id).equipCost,0));
 assert.equal(fixture({incomingDamage:100,learnedAttacks:true,budget:74,slots:3}).result.turn.reactionSetup,undefined);
 assert.equal(fixture({incomingDamage:100,learnedAttacks:true,budget:75,slots:2}).result.turn.reactionSetup,undefined);
});


test('Mirror reduction applies before HP loss and an incoming KO cannot trigger counters',()=>{
 const alive=fixture({incomingDamage:999}).result;
 assert.equal(alive.turn.reactionSetup,true);assert.equal(alive.remainingHp,1);
 const event=alive.resourceEvents.find(event=>event.kind==='incoming');
 assert.equal(event.damage,499);assert.equal(event.mirrorReduction,true);
 const ko=fixture({incomingDamage:1000}).result;
 assert.equal(ko.turn.reactionSetup,undefined,'a lethal mitigated hit cannot earn counter damage');
});

test('an initially affordable counter pair pays each response again and skips only the later unaffordable response',()=>{
 const result=simulateCounterPair({incomingDamage:100,mp:11,rounds:2});
 const counters=result.resourceEvents[1].filter(event=>[930001,930002].includes(event.skillId));
 assert.deepEqual(counters.map(event=>[event.round,event.skillId,event.mpCost]),[[1,930001,3],[1,930002,4],[2,930001,3]]);
 assert.equal(result.remainingMp[1],1,'first pair leaves 4 MP, then the next physical response spends 3');
 assert.deepEqual(result.resourceSkips[1].map(event=>[event.round,event.skillId,event.reason]),[[2,930002,'Insufficient MP for the selected child.']]);
 assert.equal(result.remainingHp[1],400,'both stances reduce their own incoming hit by half');
});

test('Darkness counter completes after paying its last HP, then the queued magical response cannot act',()=>{
 const result=simulateCounterPair({incomingDamage:950,mp:100,rounds:1,darkness:true});
 const incoming=result.resourceEvents[1].find(event=>event.kind==='incoming');
 assert.equal(incoming.damage,475);assert.equal(incoming.hpAfter,25);
 const darkness=result.resourceEvents[1].find(event=>event.skillId===400490);
 assert.equal(darkness.hpBefore,25);assert.equal(darkness.hpCost,25);assert.equal(darkness.hpAfter,0);
 assert.ok(darkness.damage>0,'the equality-cost physical response completes despite reaching zero HP');
 assert.equal(result.resourceEvents[1].some(event=>event.skillId===930002),false);
 assert.deepEqual(result.resourceSkips[1].map(event=>[event.skillId,event.reason]),[[930002,'The caster has no HP remaining.']]);
 assert.equal(result.remainingHp[1],0);assert.equal(result.remainingMp[1],100);
});

test('generated reaction budgets require an affordable complete pair on each fresh stance',()=>{
 assert.equal(fixture({incomingDamage:100}).result.turn.selectionMp,7);
 const result=simulateCounterPair({incomingDamage:100,mp:11,rounds:2,selectionMp:7});
 assert.equal(result.remainingMp[1],4);assert.equal(result.remainingHp[1],350);
 assert.deepEqual(result.mpExhaustedRounds[1],[2]);
 assert.equal(result.resourceEvents[1].filter(event=>[930001,930002].includes(event.skillId)).length,2);
});

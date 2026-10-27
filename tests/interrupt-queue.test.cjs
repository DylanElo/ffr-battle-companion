const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),D=require('../docs/damage.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');

function execute(phases,{rounds=phases.length}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const character={id:1,name:'Queue tester',levelParamId:1,stats:{HitPoint:100,MagicPoint:999,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:500,passiveIds:[]};
 const catalog={...native,skillRules:rules,characters:[character],statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[]}]}},visions:[],equipment:[],artifacts:[],masterSkills:[]};
 const ids=[...new Set(phases.flatMap(phase=>phase.ids))];
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:ids,equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Queue target',level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Agility:0,Defence:1,Mind:1},resistances:{},passiveIds:[]};
 const turns=phases.map(({ids,wrapper=false})=>{
  const leaves=ids.map((id,actionIndex)=>{const skill=native.skills.find(s=>s.id===id);return {skillId:id,kind:skill.relation==='Enemies'?'attack':'support',actionIndex,context:{}};});
  const steps=[...(wrapper?[{skillId:400650,kind:'wrapper',depth:0}]:[]),...leaves.map(leaf=>({...leaf,depth:wrapper?1:0}))];
  return {leaves,steps,mp:(wrapper?40:0)+ids.reduce((sum,id)=>sum+native.skills.find(s=>s.id===id).cost,0)};
 });
 const plan={turn:turns[0],rotationTurns:turns,characterId:1,equipment,passiveIds:[],maxHp:100,maxMp:999};
 const evaluation={damage:1,brokenDamage:1,breakDamage:0,availableMp:999,turnMp:turns[0].mp,stats:{Agility:50,MaxHitPoint:100,PhysicalDefense:20,MagicalDefense:20},limit:null,supportActions:[],actionPlan:plan};
 return B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds}).evaluateParty([{characterId:1,equipment,evaluation}]);
}

test('an unavailable Good Luck command pays nothing and preserves active Overclock charges',()=>{
 const result=execute([{ids:[404130]},{ids:[406050]}]);
 assert.deepEqual(result.resourceEvents[1].map(event=>event.skillId),[404130]);
 assert.equal(result.remainingMp[1],999-native.skills.find(s=>s.id===404130).cost);
 assert.equal(result.remainingGoodLuck[1],0);
 assert.deepEqual(result.overclockStates[1],[{effectId:19003,charges:3}]);
 assert.ok(result.resourceSkips[1].some(event=>event.round===2 && /GoodLuck/.test(event.reason)));
});

test('a committed equality-HP child finishes while the dead-source sibling rejects without undoing it',()=>{
 const phases=Array.from({length:19},()=>({ids:[400490]}));
 phases.push({ids:[400490,401010],wrapper:true});
 const result=execute(phases),last=result.resourceEvents[1].filter(event=>event.round===20);
 assert.equal(last.length,1);assert.equal(last[0].skillId,400490);
 assert.equal(last[0].hpBefore,5);assert.equal(last[0].hpAfter,0);assert.equal(last[0].hpCost,5);assert.ok(last[0].damage>0);
 assert.equal(result.resourceEvents[1].filter(event=>event.skillId===400490).length,20);
 assert.equal(result.hpSpent[1],100);assert.equal(result.remainingMp[1],959);
 assert.ok(result.resourceSkips[1].some(event=>event.round===20 && event.skillId===401010 && /no HP/.test(event.reason)));
});

test('a selected nested attack missing all parts does not cancel its paid same-source sibling',()=>{
 const original=D.skillHitSuccess;let accuracyDraws=0;
 D.skillHitSuccess=(chance,...rest)=>chance===100?(++accuracyDraws-1)%6>=3:original(chance,...rest);
 try{
  const result=execute([{ids:[447410,447410],wrapper:true}]),events=result.resourceEvents[1];
  assert.equal(events.length,2);assert.equal(events[0].damage,0);assert.ok(events[1].damage>0);
  assert.equal(events[0].mpCost,54);assert.equal(events[1].mpCost,54);
  assert.equal(result.remainingMp[1],851);assert.deepEqual(result.resourceSkips[1],[]);
 }finally{D.skillHitSuccess=original;}
});

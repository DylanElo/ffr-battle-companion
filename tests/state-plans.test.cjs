const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../docs/battle.js'),native=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
function fixture({attacks=[220010],setups=[],mp=999,rounds=5,defense=1,changes={},includeSupport=false}={}){
 const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
 const skills=[...new Set([...attacks,...setups])].map(id=>({...native.skills.find(s=>s.id===id),...(changes[id] || {})}));
 const catalog={...native,skillRules:rules,characters:[{id:1,name:'State unit',levelParamId:1,stats:{HitPoint:500,MagicPoint:mp,Attack:100,Intelligence:100,Mind:20,Defence:20,Agility:50},baseSkillEquipCost:500,passiveIds:[]}],
 statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:setups}]}},visions:[],equipment:[],artifacts:[],masterSkills:[],passives:[],skills};
 const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,experience:0,baseParameters:[],activeSkillIds:attacks,equippedSkillIds:Array(8).fill(-1),equipment}],resonances:[],inventory:[],party:[1],player:{difficulty:'Normal'}};
 const enemy={id:2,name:'Target',level:1,stats:{MaxHitPoint:1e9,MaxBreakPoint:1e9,Defence:defense,Mind:defense,Agility:0},resistances:{},passiveIds:[]};
 const result=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds,includeSupportOptions:includeSupport}).evaluate({characterId:1,visionId:-1,equipment});
 return {result,catalog};
}
test('standalone Focus alternates with attacks without requiring Arms Akimbo',()=>{
 const input={mp:60,changes:{220010:{cost:30,mag:100,breakDmg:0,criticalHitRate:0}}};
 const plain=fixture(input).result,focused=fixture({...input,setups:[400460]}).result;
 assert.ok(focused.turn.rotationTurns);
 assert.deepEqual(focused.turn.rotationTurns.map(turn=>turn.leaves[0].skillId),[400460,220010]);
 assert.equal(focused.turn.wrapperIds.includes(400650),false);
 assert.ok(focused.fightDamage>plain.fightDamage);
 assert.equal(focused.remainingMp,0);
 assert.equal(focused.equippedSkillIds.filter(id=>id===400460).length,1);
});
test('Witching Hour is an opening action, not a free starting form or a repeated transform',()=>{
 const input={defense:100,changes:{220010:{cost:0,mag:100,breakDmg:0,criticalHitRate:0}}};
 const plain=fixture(input).result,formed=fixture({...input,setups:[408090]}).result;
 assert.equal(formed.turn.openingTurn.leaves[0].skillId,408090);
 assert.equal(formed.turn.openingTurn.mp,8);
 assert.ok(!formed.turn.context.activeEffectIds?.includes(16603),'positive form context is supplied only by live state');
 assert.ok(formed.fightDamage>plain.fightDamage);
 assert.equal(formed.remainingMp,991);
 assert.equal(formed.equippedSkillIds.filter(id=>id===408090).length,1);
});
test('Overclock setup pays its own opening turn and is reserved in the AP package',()=>{
 const result=fixture({attacks:[404060],setups:[404130]}).result;
 assert.equal(result.turn.openingTurn.leaves[0].skillId,404130);
 assert.equal(result.turn.openingTurn.mp,12);
 assert.ok(result.equippedSkillIds.includes(404130));
 assert.ok(!result.turn.context.activeEffectIds?.includes(12913));
});
test('luck plans include generator turns before a threshold-gated spender',()=>{
 const result=fixture({attacks:[406080,406050],setups:[400650,400710],changes:{406080:{mag:1,breakDmg:0,criticalHitRate:0},406050:{mag:200,breakDmg:0,criticalHitRate:0}}}).result;
 assert.ok(result.turn.rotationTurns);
 const firstSkills=result.turn.rotationTurns.map(turn=>turn.leaves[0].skillId);
 assert.equal(firstSkills[0],406080);assert.equal(firstSkills.at(-1),406050);
 assert.ok(result.fightDamage>0);
 assert.equal(new Set(result.equippedSkillIds).size,result.equippedSkillIds.length);
});

test('Overclock can build the distinct I and Zero stack through paid setup turns without Arms',()=>{
 const plain=fixture({attacks:[404060],setups:[404130]}).result;
 const stacked=fixture({attacks:[404060],setups:[404130,404140]}).result;
 assert.deepEqual(stacked.turn.rotationTurns.map(turn=>turn.leaves[0].skillId),[404130,404140,404130,404060,404060]);
 assert.equal(stacked.turn.wrapperIds.includes(400650),false);
 assert.ok(stacked.fightDamage>plain.fightDamage);
 assert.equal(stacked.equippedSkillIds.filter(id=>id===404130).length,1);
 assert.equal(stacked.equippedSkillIds.filter(id=>id===404140).length,1);
});

test('state-family budget cannot hide an Overclock stack behind Focus and form policies for other skills',()=>{
 const result=fixture({attacks:[220010,401010,220090,404060],setups:[400460,408090,404130,404140],defense:100,changes:{
  220010:{mag:100,cost:30,breakDmg:0,criticalHitRate:0},401010:{mag:90,cost:40,breakDmg:100,criticalHitRate:0},
  220090:{mag:80,cost:0,breakDmg:0,criticalHitRate:0},404060:{mag:85,cost:1,breakDmg:0,criticalHitRate:0}
 }}).result;
 assert.deepEqual(result.turn.rotationTurns?.map(turn=>turn.leaves[0].skillId),[404130,404140,404130,404060,404060]);
});


test('a transformed caster can retain white healing for other eligible allies',()=>{
 const result=fixture({setups:[408090,210010],includeSupport:true,defense:100,changes:{220010:{cost:0,mag:100,breakDmg:0,criticalHitRate:0}}}).result;
 assert.ok(result.turn.openingTurn);
 assert.equal(result.canHeal,true);
});

test('a selected multi-command cannot queue more luck spenders than the native maximum can fund',()=>{
 const rush=fixture({attacks:[406050],setups:[400650,400710]}).result;
 const blitz=fixture({attacks:[406070],setups:[400650,400710]}).result;
 assert.ok(rush.turn.leaves.filter(leaf=>leaf.skillId===406050).length<=1,'Demolisher checks 8 before every 5-stack payment');
 assert.ok(blitz.turn.leaves.filter(leaf=>leaf.skillId===406070).length<=3,'at most three 3-stack payments fit the maximum 10');
});

test('luck policy generates until the queued spender is selectable, rather than attempting fixed premature spends',()=>{
 const result=fixture({attacks:[406080,406050],setups:[400650,400710],changes:{406080:{mag:1,breakDmg:0,criticalHitRate:0},406050:{mag:200,breakDmg:0,criticalHitRate:0}}}).result;
 assert.equal(result.turn.luckPolicy?.requiredLuck,8);
 assert.equal(result.turn.luckPolicy?.requiredTurnLuck,8);
 const spends=result.resourceEvents.filter(event=>event.skillId===406050);
 assert.ok(spends.length>0);
 assert.equal(spends[0].round,3);
 assert.ok(spends.every(event=>event.goodLuckBefore>=8 && event.goodLuckAfter===event.goodLuckBefore-5));
 assert.deepEqual(result.resourceSkips.filter(skip=>skip.skillId===406050),[]);
 assert.equal(result.remainingGoodLuck,10);
});

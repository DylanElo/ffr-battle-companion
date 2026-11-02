const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');

function fixture({characterId=1003,skillIds=[403530],passiveIds=[1491,1496],critical=false}={}){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const character={...source.characters.find(row=>row.id===characterId),levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:100,MagicPoint:999,Attack:800,Intelligence:700,Divine:73,Defence:30,Mind:30,Agility:50}};
  const catalog={...source,skillRules:rules,characters:[character],skills:source.skills.filter(row=>skillIds.includes(row.id)),
    visions:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:passiveIds}]}}};
  const snapshot={characters:[{id:characterId,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:skillIds,equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[characterId],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage','stagger'],rounds:1,critical,includeSupportOptions:false});
  const input={characterId,visionId:-1,equipment};
  const fixed=ids=>{
    const result=model.evaluate({...input,equippedSkillIds:ids});
    assert.equal(result.valid,true,JSON.stringify(result));
    assert.ok(result.skillCost<=result.skillBudget);
    assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
    return result;
  };
  return {catalog,snapshot,enemy,model,input,fixed};
}

test('native Fina Light Magic scales from Divine even with stronger ATK/MAG and DominantPower',()=>{
  const {fixed}=fixture();
  const plain=fixed([]),adaptive=fixed([1491]);
  assert.ok(adaptive.stats.PhysicalAttack>adaptive.stats.Divine);
  assert.ok(adaptive.stats.MagicalAttack>adaptive.stats.Divine);
  assert.equal(adaptive.passiveAnalysis.modifiers.dominantPower,true);
  for(const result of [plain,adaptive]){
    assert.equal(result.skillId,403530);
    assert.equal(result.leafResults[0].common.attackSource,'Divine');
    assert.equal(result.leafResults[0].common.attack,result.stats.Divine);
  }
  assert.equal(adaptive.damage,plain.damage);
  assert.equal(adaptive.fightDamage,plain.fightDamage);
});

test('native CritMul contributes to critical stagger in fixed builds and complete party scoring',()=>{
  const {catalog,enemy,model,input,fixed}=fixture({critical:true});
  const plain=fixed([]),boosted=fixed([1496]);
  const skill=catalog.skills.find(row=>row.id===boosted.skillId);
  const expected=D.breakDamage({skill,level:1,targetLevel:enemy.level,critical:true,criticalBonus:.3,
    outgoingFactor:boosted.passiveAnalysis.breakFactor,rules:catalog.battleRules});
  assert.equal(boosted.breakDamage,expected.amount);
  assert.ok(boosted.breakDamage>plain.breakDamage);
  const before=model.evaluateParty([{...input,evaluation:plain}]);
  const after=model.evaluateParty([{...input,evaluation:boosted}]);
  assert.equal(after.roundBreakDamage,expected.amount);
  assert.ok(after.breakDamage>before.breakDamage);
});

test('paid HP leaves transport exact current HP and the owner normal attack to stepped passives',()=>{
  const {model,input}=fixture({characterId:1001,skillIds:[400490,401010,220010],passiveIds:[1424,1431]});
  const leaves=[400490,400490,401010,220010].map((skillId,actionIndex)=>({skillId,actionIndex,kind:'attack',context:{}}));
  const turn={leaves,steps:leaves};
  const evaluation={skillId:400490,damage:0,brokenDamage:0,breakDamage:0,availableMp:999,turnMp:4,
    stats:{Agility:50,MaxHitPoint:100,MaxMagicPoint:999,PhysicalDefense:30,MagicalDefense:30},supportActions:[],
    actionPlan:{turn,characterId:1001,equipment:input.equipment,passiveIds:[1424,1431],maxHp:100,maxMp:999}};
  const result=model.evaluateParty([{...input,evaluation}]);
  assert.equal(result.remainingHp[1001],90);
  assert.equal(result.hpSpent[1001],10);
  const rows=result.stateLeafResults[1001];
  assert.deepEqual(rows.map(row=>[row.skillId,row.context.currentHp,row.context.maxHp]),[
    [400490,95,100],[400490,90,100],[401010,90,100],[220010,90,100]
  ]);
  assert.ok(rows.every(row=>row.context.normalAttackSkillId===401010));
  assert.ok(rules.general.normalAttackSkills.includes(400490),'native normal predicate also accepts configured battle skills');
  assert.ok(rows[0].common.outgoingFactor>1.04 && rows[0].common.outgoingFactor<1.06,'Latent Potential observes the first paid five HP');
  assert.ok(rows[1].common.outgoingFactor>1.09 && rows[1].common.outgoingFactor<1.11,'the second payment increases Latent Potential again');
  assert.ok(rows[2].common.outgoingFactor>1.09 && rows[2].common.outgoingFactor<1.11,'the owner normal attack retains the paid-down HP state');
  assert.ok(rows[3].common.outgoingFactor>1.05 && rows[3].common.outgoingFactor<1.07,'Dark Rite sees ten percent HP loss on the following Magic attribute');
});

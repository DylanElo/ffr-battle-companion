const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const B=require('../docs/battle.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-mp-threshold.json');
const magic=source.skills.find(row=>row.id===220010);

test('native Mana Overload vectors use cached pre-payment MP rather than current MP',()=>{
  for(const row of native.rows){
    const result=P.analyze(source,[1445],{skill:magic,mpThresholdPercent:row.cachedPrePaymentMp/row.maxMp*100,mpPercent:row.currentPostPaymentMp/row.maxMp*100});
    assert.ok(Math.abs((result.damageFactor-1)-row.nativeContribution)<1e-6,JSON.stringify(row));
    assert.equal(result.modifiers.damagePercent,row.nativeContribution?35:0);
  }
});

test('Mana Overload threshold context is independent of current HP and paid MP',()=>{
  for(const hpPercent of [0,25,100]){
    assert.equal(P.analyze(source,[1445],{skill:magic,hpPercent,mpThresholdPercent:75,mpPercent:0}).modifiers.damagePercent,35);
    assert.equal(P.analyze(source,[1445],{skill:magic,hpPercent,mpThresholdPercent:74.75,mpPercent:100}).modifiers.damagePercent,0);
  }
  assert.equal(P.analyze(source,[1445],{skill:magic,mpPercent:75}).modifiers.damagePercent,35,'preview callers retain their supplied MP state');
});

function paidFixture(hpFirst){
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId:-1};
  const character={...source.characters.find(row=>row.id===1001),levelParamId:1,passiveIds:[],baseSkillEquipCost:100,
    stats:{HitPoint:100,MagicPoint:400,Attack:100,Intelligence:100,Defence:30,Mind:30,Agility:50}};
  // Only cost is varied to put the actual native Fire action exactly across the75% boundary in one payment.
  const pricedMagic={...magic,cost:60};
  const skills=[pricedMagic,source.skills.find(row=>row.id===400490)];
  const catalog={...source,skillRules:rules,characters:[character],skills,visions:[],masterSkills:[],equipment:[],artifacts:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[1445]}]}}};
  const snapshot={characters:[{id:1001,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),
    activeSkillIds:skills.map(row=>row.id),equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],resonances:[],party:[1001],player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
  const leaves=[...(hpFirst?[400490]:[]),magic.id,magic.id].map((skillId,actionIndex)=>({skillId,actionIndex,kind:'attack',context:{}}));
  const turn={leaves,steps:leaves};
  const evaluation={skillId:magic.id,damage:0,brokenDamage:0,breakDamage:0,availableMp:300,turnMp:120,
    stats:{Agility:50,MaxHitPoint:100,MaxMagicPoint:400,PhysicalDefense:30,MagicalDefense:30},supportActions:[],
    actionPlan:{turn,characterId:1001,equipment,passiveIds:[1445],maxHp:100,maxMp:400}};
  return model.evaluateParty([{characterId:1001,visionId:-1,equipment,evaluation}]);
}

test('fixed party paid leaves retain the first pre-payment threshold and drop it on the next action',()=>{
  for(const hpFirst of [false,true]){
    const result=paidFixture(hpFirst),rows=result.stateLeafResults[1001].filter(row=>row.skillId===magic.id);
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(row=>[row.mpCost,row.context.mpThresholdPercent,row.context.mpPercent]),[[60,75,60],[60,60,45]]);
    assert.ok(rows[0].common.outgoingFactor>1.349999 && rows[0].common.outgoingFactor<1.350001);
    assert.equal(rows[1].common.outgoingFactor,1);
    assert.equal(result.remainingMp[1001],180);
    assert.equal(result.hpSpent[1001],hpFirst?5:0);
    assert.ok(rows.every(row=>row.context.currentHp===(hpFirst?95:100)));
    assert.ok(rows[0].damage>rows[1].damage);
    assert.deepEqual(result.resourceSkips[1001],[]);
  }
});

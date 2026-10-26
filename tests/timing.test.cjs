const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const native=require('../docs/data/catalog.json');
const commands=require('./fixtures/native-commands.json');
const gaugeOracle=require('./fixtures/native-gauge.json');
const rules=require('../docs/skill-rules.json');

function model(options={}){
  return B.createModel({...native,characters:[],visions:[],equipment:[],artifacts:[]},
    {characters:[],inventory:[],resonances:[],party:[],player:{difficulty:'Normal'}},
    {id:1,name:'Single enemy',level:30,stats:{MaxHitPoint:1e9,MaxBreakPoint:100,Agility:0},resistances:{},passiveIds:[]},
    {goals:['limit'],rounds:1,...options});
}
function member(id,agility,breakDamage,traits={}){
  return {characterId:id,evaluation:{damage:100,brokenDamage:150,breakDamage,availableMp:100,turnMp:0,
    stats:{Agility:agility,MaxHitPoint:100,PhysicalDefense:0,MagicalDefense:0},
    limit:{max:200,mult:1,fillOnStagger:0,recuperate:0,options:[],...traits},supportActions:[]}};
}

test('single-enemy all-stagger base reward belongs to the attacker only',()=>{
  const result=model().evaluateParty([member(1,100,100),member(2,50,0)]);
  assert.equal(result.gauge[1],50);
  assert.equal(result.gauge[2],0);
});

test('Fill LB on Stagger applies to the attacker, not unrelated allies',()=>{
  const result=model().evaluateParty([member(1,100,100,{fillOnStagger:10}),member(2,50,0,{fillOnStagger:10})]);
  assert.equal(result.gauge[1],60);
  assert.equal(result.gauge[2],0);
});

test('all-stagger base and passive rewards apply the attacker fill multiplier',()=>{
  const result=model().evaluateParty([member(1,100,100,{mult:3,fillOnStagger:10}),member(2,50,0,{mult:2,fillOnStagger:10})]);
  assert.equal(result.gauge[1],180);
  assert.equal(result.gauge[2],0);
});

test('a stagger-causing hit uses normal damage and subsequent hits use staggered damage',()=>{
  const actor=member(1,100,200);
  actor.evaluation.hits=[{damage:100,brokenDamage:150,breakDamage:100},{damage:100,brokenDamage:150,breakDamage:100}];
  actor.evaluation.damage=200;
  actor.evaluation.brokenDamage=300;
  const result=model().evaluateParty([actor]);
  assert.equal(result.damage,250);
  assert.equal(result.breakDamage,100,'hits against an already staggered target deal no further BP damage');
  assert.equal(result.staggers,1);
  assert.equal(result.gauge[1],50);
});

test('hits before and including the break keep normal damage, and only later hits gain the bonus',()=>{
  const actor=member(1,100,100);
  actor.evaluation.hits=[{damage:100,brokenDamage:150,breakDamage:50},{damage:100,brokenDamage:150,breakDamage:50},{damage:100,brokenDamage:150,breakDamage:0}];
  actor.evaluation.damage=300;
  actor.evaluation.brokenDamage=450;
  assert.equal(model().evaluateParty([actor]).damage,350);
});

test('ordinary stagger recovers at the next global turn boundary',()=>{
  const result=model({rounds:3}).evaluateParty([member(1,100,100),member(2,50,0)]);
  assert.equal(result.staggers,3);
  assert.equal(result.damage,250);
});

test('LB selection never values additional stagger against an already staggered target',()=>{
  const early=member(1,100,10);
  const middle=member(2,75,100,{max:100,mult:2,options:[{skillId:1,cost:100,damage:1e12,brokenDamage:1.5e12,breakDamage:0}]});
  const late=member(3,50,100,{max:100,mult:2,options:[{skillId:2,cost:100,damage:1,brokenDamage:1.5,breakDamage:200}]});
  const result=model({rounds:3,goals:['damage','stagger']}).evaluateParty([early,middle,late]);
  assert.equal(result.limitUses[2][0].round,2);
  assert.deepEqual(result.limitUses[3],[]);
});

test('native opening gauge is assigned once, is not multiplied and is not earned fill',()=>{
  const actor=member(1,100,0,{initial:50,mult:3,options:[{skillId:1,cost:100,damage:1e12,brokenDamage:1.5e12,breakDamage:0}]});
  const result=model({rounds:2}).evaluateParty([actor]);
  assert.deepEqual(result.limitUses[1],[],'Triple Charge must not turn the opening 50 into 150');
  assert.equal(result.gauge[1],0,'opening gauge is not newly earned fill');
});

test('opening gauge plus a native break reward makes an LB available on the following turn',()=>{
  const actor=member(1,100,100,{initial:50,max:100,options:[{skillId:1,cost:100,damage:1e12,brokenDamage:1.5e12,breakDamage:0}]});
  const result=model({rounds:2}).evaluateParty([actor]);
  assert.deepEqual(result.limitUses[1],[{round:2,skillId:1}]);
});

test('wrapper action counts agree with extracted native sequential command recipes',()=>{
  for(const name of ['armsAkimbo','dualcast','doubleAction']){
    const selector=rules.selectors[name],recipe=commands.wrappers.find(w=>w.id===selector.skillId);
    assert.equal(recipe.execution,'Sequential');
    assert.equal(selector.actionCount,recipe.steps.filter(step=>step.startsWith('List.')).length);
    assert.equal(recipe.steps.filter(step=>step==='Node.SelfCast').length,1);
  }
});

for(const row of gaugeOracle.cases.filter(row=>row.input.gauge===0))test(`native gauge arithmetic: ${row.input.amount} × ${row.input.multiplier}`,()=>{
  const result=model({enemyCount:row.input.amount===25?2:1}).evaluateParty([
    member(1,100,100,{max:row.input.cap,mult:row.input.multiplier})]);
  assert.equal(result.gauge[1],row.expected.gauge);
});

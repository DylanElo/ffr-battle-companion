const test=require('node:test'),assert=require('node:assert/strict'),D=require('../docs/damage.js');
const native=require('./fixtures/native-hp-costs.json');
test('HP cost arithmetic and affordability match copied native scalar instructions',()=>{
 for(const row of native.fixtures){
  const {currentHp,maxHp,percent}=row.input;
  assert.equal(row.kind==='cost'?D.skillHpCost(maxHp,percent):D.canPayHpCost(currentHp,maxHp,percent),row.expected,JSON.stringify(row.input));
 }
});
test('HP affordability uses the exact percentage even when the payment rounds down',()=>{
 assert.equal(D.skillHpCost(99,5),4);assert.equal(D.canPayHpCost(4,99,5),false);
 assert.equal(D.canPayHpCost(5,100,5),true,'an exact-cost self-KO is not rejected by native ratio comparison');
 assert.equal(D.skillHpCost(19,5),0);assert.equal(D.canPayHpCost(1,19,5),true);
 assert.throws(()=>D.skillHpCost(100.5,5),RangeError);assert.throws(()=>D.skillHpCost(1e9,100),RangeError);
 assert.throws(()=>D.canPayHpCost(-1,100,5),RangeError);
});

test('received-damage LB gain matches independently executed native arithmetic',()=>{
 const oracle=require('./fixtures/native-incoming-lb.json');
 for(const row of oracle.fixtures){const {damage,preHp,maxHp,baseGain}=row.input;assert.equal(D.damageTakenLb(damage,preHp,maxHp,baseGain),row.expected);}
 assert.equal(D.damageTakenLb(99,1000,1000),4,'base gain truncates before a later Double Charge multiplier');
 assert.equal(D.damageTakenLb(2000,100,1000),5,'damage is capped by pre-hit HP for LB gain');
 assert.throws(()=>D.damageTakenLb(10.5,100,100),RangeError);
});

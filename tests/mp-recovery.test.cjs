const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../docs/damage.js'),oracle=require('./fixtures/native-mp-recovery.json');
test('MP percentage recovery matches30 isolated installed-native scalar executions',()=>{
 for(const c of oracle.cases)assert.equal(D.mpRecoveryAmount(c.maxMp,c.value,c.ratio),c.expected,JSON.stringify(c));
});
test('flat MP recovery and sub-one percentages have no artificial minimum',()=>{
 assert.equal(D.mpRecoveryAmount(617,5),5);assert.equal(D.mpRecoveryAmount(19,5,true),0);
 assert.throws(()=>D.mpRecoveryAmount(NaN,5),RangeError);assert.throws(()=>D.mpRecoveryAmount(617,-1),RangeError);
});

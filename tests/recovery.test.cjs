const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../docs/damage.js'),native=require('./fixtures/native-recovery.json');
for(const row of native.fixtures)test(`executed native recovery: Divine ${row.input.divine}, coefficient ${row.input.coefficient}, RNG ${row.input.random15}`,()=>assert.equal(D.recovery(row.input).amount,row.expected));
test('recovery preserves zero, caps each event and validates native input',()=>{
 assert.equal(D.recovery({divine:9999,coefficient:0}).amount,0);
 assert.equal(D.recovery({divine:9999,coefficient:9999,cap:9999}).amount,9999);
 assert.throws(()=>D.recovery({divine:-1,coefficient:100}),RangeError);
 assert.throws(()=>D.recovery({divine:10,coefficient:100,random15:1.5}),RangeError);
});

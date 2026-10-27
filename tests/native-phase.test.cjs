const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../docs/damage.js');
const fixture=require('./fixtures/native-phase.json');
for(const row of fixture.procVectors)test(`native phase proc threshold ${row.threshold}`,()=>{
 let successes=0;
 for(let rng=0;rng<row.totalSamples;rng++)if(D.skillHitSuccess(row.threshold,rng))successes++;
 assert.equal(successes,row.successSamples);
});

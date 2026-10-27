const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../docs/damage.js'),P=require('../docs/passives.js'),catalog=require('../docs/data/catalog.json');
const skill=catalog.skills.find(s=>s.id===406060);
test('Gamble uses its discrete integer roll and becomes guaranteed at five luck',()=>{
 assert.equal(D.gambleHitProbability(0),.5);
 assert.equal(D.gambleHitProbability(1),19661/32768);
 assert.equal(D.gambleHitProbability(4),29491/32768);
 assert.equal(D.gambleHitProbability(5),1);assert.equal(D.gambleHitProbability(10),1);
 assert.equal(D.gambleSuccess(0,16383),true);assert.equal(D.gambleSuccess(0,16384),false);
 assert.equal(D.gambleSuccess(5,32767),true);
 assert.equal(D.gambleHitProbability(0,-20),9831/32768);
 assert.equal(D.gambleHitProbability(0,10000),1);
 assert.throws(()=>D.gambleHitProbability(.5),RangeError);
 assert.throws(()=>D.gambleSuccess(0,32768),RangeError);
});
test('only the verified luck-based CritOrMiss layout is decoded',()=>{
 const native=catalog.effects.find(e=>e.id===13201);
 assert.equal(P.decode(native).kind,'gambleShot');
 assert.ok(P.decode(catalog.effects.find(e=>e.id===13200)).unsupported);
 assert.ok(P.decode({...native,params:native.params.map((v,i)=>i===2?11:v)}).unsupported);
 const a=P.analyze(catalog,[],{skill,activeEffectIds:[13201,1027]});
 assert.equal(a.modifiers.gambleShot,true);assert.equal(a.modifiers.accuracyBonus,-20);
 const other=P.analyze(catalog,[],{skill:{id:220010},activeEffectIds:[1027]});
 assert.equal(other.modifiers.accuracyBonus,0);assert.ok(other.deferred.some(t=>t.effectId===1027));
});

test('Gamble successful-branch accuracy still pays the native evasion and accuracy penalties',()=>{
 assert.equal(D.skillHitProbability(100),1);
 assert.equal(D.skillHitProbability(100,{accuracyBonus:-20}),26214/32768);
 assert.equal(D.skillHitProbability(100,{evasion:1000}),8192/32768);
 assert.equal(D.skillHitProbability(100,{accuracyBonus:10000,evasion:75}),1);
 assert.equal(D.skillHitProbability(100,{statusResistance:100}),0);
 assert.equal(D.skillHitSuccess(100,32767),true);
 assert.equal(D.skillHitSuccess(0,0),false);
});

test('Gamble and ordinary-hit probabilities match isolated copied native instruction vectors',()=>{
 const oracle=require('./fixtures/native-gamble.json');
 for(const row of oracle.vectors)assert.equal(D.gambleHitProbability(row.luck,row.accuracyBonus),row.successSamples/row.totalSamples);
 for(const row of oracle.ordinaryHitVectors)assert.equal(D.skillHitProbability(100,{accuracyBonus:row.accuracyBonus,evasion:row.targetEvasion,statusResistance:row.targetStatusResistance}),row.successSamples/row.totalSamples);
});

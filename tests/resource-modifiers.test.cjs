const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../docs/passives.js'),catalog=require('../docs/data/catalog.json');
const skill=catalog.skills.find(s=>s.id===406080);
const analyze=(ids,context={})=>P.analyze(catalog,[],{skill,critical:false,activeEffectIds:ids,...context});
test('Good Luck provides three critical-rate points per current stack and no guessed initial stacks',()=>{
 assert.equal(analyze([1195],{goodLuck:4}).modifiers.critRatePercent,12);
 assert.equal(analyze([1195],{goodLuck:0}).modifiers.critRatePercent,0);
 assert.ok(analyze([1195]).deferred.some(t=>t.effectId===1195));
});
test('Gale Strike adds seven raw coefficient units only on critical hits',()=>{
 assert.equal(analyze([12918],{critical:false}).modifiers.coefficientAdd,0);
 assert.equal(analyze([12918],{critical:true}).modifiers.coefficientAdd,7);
});
test('luck-scaled Limit Burst coefficient is additive after the level scale',()=>{
 const result=analyze([12930,12966],{goodLuck:8});
 assert.equal(result.modifiers.coefficientAdd,24);
 assert.equal(result.modifiers.coefficientPerLevel,1/15);
 assert.equal(33*(1+30*result.modifiers.coefficientPerLevel)+result.modifiers.coefficientAdd,123);
});
test('Blitzstrahl luck modifier is stagger, using the supplied current post-payment level',()=>{
 const result=analyze([15124],{goodLuck:5});
 assert.equal(result.modifiers.breakPercent,50);
 assert.equal(result.modifiers.damagePercent,0);
});
test('Overclock boosts base coefficient and base stagger only for the four native target skills',()=>{
 for(const [ids,percent] of [[[12913,15113],150],[[12914,15114],300]]){
  const target=analyze(ids,{skill:catalog.skills.find(s=>s.id===404080)});
  assert.equal(target.modifiers.coefficientScalePercent,percent);
  assert.equal(target.modifiers.baseBreakScalePercent,percent);
  const other=analyze(ids);
  assert.equal(other.modifiers.coefficientScalePercent,0);
  assert.equal(other.modifiers.baseBreakScalePercent,0);
 }
});

test('unverified additive coefficient selector layouts remain excluded',()=>{
 const native=catalog.effects.find(effect=>effect.id===12918);
 assert.match(P.decode({...native,params:native.params.map((value,index)=>index===1?0:value)}).unsupported,/additive coefficient/);
});

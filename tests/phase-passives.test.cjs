const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const catalog=require('../docs/data/catalog.json');
const skill={id:400100,target:'Single',dmgType:'Physic',attr:'Ability',element:'None'};
const analyze=context=>P.analyze(catalog,[1404],{skill,...context});

test('Pilebunker compares raw gauge with the actual 100/200-point capacity',()=>{
  for(const [lbPercent,lbCapacity,expected] of [[100,100,50],[100,200,0],[200,200,50],[99,100,0]]){
    const result=analyze({lbPercent,lbCapacity});
    assert.equal(result.modifiers.breakPercent,expected);
    assert.equal(result.breakFactor,1+expected/100);
    assert.equal(result.unsupported.length,0);
    if(expected)assert.equal(result.applied[0].kind,'breakPercent');
  }
});

test('Pilebunker is restricted to single-target physical skills',()=>{
  for(const override of [{target:'Group'},{target:'All'},{dmgType:'Magic'}]){
    const result=analyze({lbPercent:200,lbCapacity:200,skill:{...skill,...override}});
    assert.equal(result.modifiers.breakPercent,0);
    assert.equal(result.inactive.length,1);
  }
});

test('Pilebunker defers when current gauge or actual capacity is unavailable',()=>{
  for(const context of [{lbPercent:100},{lbCapacity:100},{lbPercent:100,lbCapacity:0},{lbPercent:NaN,lbCapacity:100}]){
    const result=analyze(context);
    assert.equal(result.modifiers.breakPercent,0);
    assert.equal(result.deferred.length,1);
    assert.equal(result.complete,false);
  }
});

test('Pilebunker getter has no attribute-level LB exclusion',()=>{
  assert.equal(analyze({lbPercent:200,lbCapacity:200,skill:{...skill,attr:'LimitBurst'}}).modifiers.breakPercent,50);
  // The caller must supply gauge after the action pays its cost.
  assert.equal(analyze({lbPercent:100,lbCapacity:200,skill:{...skill,attr:'LimitBurst'}}).modifiers.breakPercent,0);
});

test('Crusher rejects unknown parameter layouts and adds outgoing BP percentage points',()=>{
  const effect=catalog.effects.find(effect=>effect.id===15150);
  assert.ok(P.decode({...effect,params:[50,1,...effect.params.slice(2)]}).unsupported);
  assert.ok(P.decode({...effect,params:[100,...effect.params.slice(1)]}).unsupported);
  const ordinary=catalog.effects.find(effect=>effect.type==='BreakDamageVariation' && P.decode(effect).kind==='breakPercent' && !P.decode(effect).tests.length);
  assert.ok(ordinary,'native unconditional outgoing BP bonus fixture');
  const result=P.analyze(catalog,[1404],{skill,lbPercent:100,lbCapacity:100,activeEffectIds:[ordinary.id]});
  assert.equal(result.modifiers.breakPercent,50+P.decode(ordinary).value);
  assert.equal(result.modifiers.baseBreakScalePercent,0);
});

test('Hit and Run grants one incoming physical nullification chance only after an own attack',()=>{
  const result=P.analyze(catalog,[1334],{incomingType:'Physic',performedAttackThisRound:true});
  assert.equal(result.modifiers.incomingPhysicalNullifyChance,35);
  assert.equal(result.applied[0].kind,'incomingPhysicalNullifyChance');
  assert.equal(result.damageFactor,1);
  assert.equal(result.modifiers.physicalEvasionPercent,0);
  assert.equal(result.modifiers.physicalReductionPercent,0);
});

test('Hit and Run is inactive before an attack or against incoming magic',()=>{
  for(const context of [{incomingType:'Physic',performedAttackThisRound:false},{incomingType:'Physic',performedAttackThisRound:0},{incomingType:'Magic',performedAttackThisRound:true}]){
    const result=P.analyze(catalog,[1334],context);
    assert.equal(result.modifiers.incomingPhysicalNullifyChance,0);
    assert.equal(result.inactive.length,1);
  }
});

test('Hit and Run defers absent incoming/history context, including outgoing analysis',()=>{
  for(const context of [{},{skill},{incomingType:'Physic'},{performedAttackThisRound:true}]){
    const result=P.analyze(catalog,[1334],context);
    assert.equal(result.modifiers.incomingPhysicalNullifyChance,0);
    assert.equal(result.deferred.length,1);
    assert.equal(result.complete,false);
  }
});

test('HitAndWay only accepts the verified 35-percent native parameter layout',()=>{
  const effect=catalog.effects.find(effect=>effect.id===19034);
  assert.equal(P.decode(effect).value,35);
  assert.ok(P.decode({...effect,params:[50,...effect.params.slice(1)]}).unsupported);
  assert.ok(P.decode({...effect,params:[35,0,...effect.params.slice(2)]}).unsupported);
  assert.ok(P.decode({...effect,params:[35,-1]}).unsupported);
});

test('Deft Warp contributes 50 additive bonus-phase percentage points only to its native skills',()=>{
  for(const id of [447800,447810]){
    const result=P.analyze(catalog,[1361],{skill:{...skill,id}});
    assert.equal(result.modifiers.bonusPhaseChancePercent,50);
    assert.equal(25+result.modifiers.bonusPhaseChancePercent,75);
    assert.equal(result.damageFactor,1);
  }
  assert.equal(P.analyze(catalog,[1361],{skill}).modifiers.bonusPhaseChancePercent,0);
});

test('Warp Crit adds 100 only with actual anyCritical history, and stacks additively',()=>{
  const context={skill:{...skill,id:447800}};
  const critical=P.analyze(catalog,[1361,1466],{...context,anyCritical:true});
  assert.equal(critical.modifiers.bonusPhaseChancePercent,150);
  for(const anyCritical of [false,0,'true'])assert.equal(P.analyze(catalog,[1466],{...context,anyCritical}).modifiers.bonusPhaseChancePercent,0);
  const missing=P.analyze(catalog,[1466],context);
  assert.equal(missing.modifiers.bonusPhaseChancePercent,0);
  assert.equal(missing.deferred.length,1);
  assert.equal(P.analyze(catalog,[1466],{skill,anyCritical:true}).modifiers.bonusPhaseChancePercent,0);
});

test('Wings of Freedom contributes 15 points only for Red Spiral and White Whorl',()=>{
  for(const id of [447400,447410])assert.equal(P.analyze(catalog,[1436],{skill:{...skill,id}}).modifiers.bonusPhaseChancePercent,15);
  assert.equal(P.analyze(catalog,[1436],{skill:{...skill,id:447800}}).modifiers.bonusPhaseChancePercent,0);
});

test('IncExAddProb rejects unknown selectors, critical predicates and trailing parameters',()=>{
  const effect=catalog.effects.find(effect=>effect.id===54102);
  for(const params of [[50,447800,447810,-1,0,...Array(10).fill(-1)],[50,0,447810,-1,-1,...Array(10).fill(-1)],[...effect.params.slice(0,14),0],effect.params.slice(0,5)]){
    assert.ok(P.decode({...effect,params}).unsupported);
  }
});

test('ordinary Noctis accuracy modifiers require the explicit modeled-accuracy context',()=>{
  const context={skill:{...skill,id:447800},activeEffectIds:[1027]};
  const modeled=P.analyze(catalog,[],{...context,accuracyModeled:true});
  assert.equal(modeled.modifiers.accuracyBonus,-20);
  assert.equal(modeled.deferred.length,0);
  for(const accuracyModeled of [undefined,false,'true']){
    const result=P.analyze(catalog,[],{...context,accuracyModeled});
    assert.equal(result.modifiers.accuracyBonus,0);
    assert.equal(result.deferred.length,1);
  }
});

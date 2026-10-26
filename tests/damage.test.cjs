const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../docs/damage.js');
const fixture={attack:100,defense:100,level:30,skill:{calcType:'Physic',mag:100},minimumDamage:1};

test('initiative jitter and priorities match independently executed native instruction fixtures',()=>{
  const native=require('./fixtures/native-initiative.json');
  for(const row of native.fixtures){
    const actual=row.kind==='jitter'?D.initiativeJitter(row.input.rng,row.input.amplitude):D.initiativePriority(row.input);
    assert.equal(actual,row.expected,JSON.stringify(row.input));
  }
});

test('initiative RNG reproduces the native discrete bucket distributions',()=>{
  const native=require('./fixtures/native-initiative.json');
  for(const [amplitude,histogram] of Object.entries(native.jitterHistogram)){
    const counts={};
    for(let rng=0;rng<32768;rng++){const value=D.initiativeJitter(rng,Number(amplitude));counts[value]=(counts[value]||0)+1;}
    assert.deepEqual(counts,histogram);
  }
  assert.throws(()=>D.initiativeJitter(32768,20),RangeError);
  assert.throws(()=>D.initiativeJitter(.5,20),RangeError);
  assert.throws(()=>D.initiativePriority({agility:50,denominator:0}),RangeError);
});

test('native multiplier epsilon preserves the independently executed HP counterexample',()=>{
  const result=D.damage({attack:998,defense:86,level:40,skill:{calcType:'Physic',mag:268,isApplyAllMag:true},
    critical:true,broken:true,elementFactor:.5,outgoingFactor:1.2,hitRatio:.5,damageCap:99999});
  assert.equal(result.raw,9117.0029296875);
  assert.equal(result.amount,9117);
});

test('break level scaling uses the exact native image constant',()=>{
  const result=D.breakDamage({skill:{breakDmg:935},level:1,targetLevel:15});
  assert.equal(result.levelFactor,.5128343105316162);
  assert.equal(result.amount,480);
});

test('SameLevel uses the native doubled coefficient only when levels match',()=>{
  const input={...fixture,skill:{calcType:'SameLevel',mag:100}};
  assert.equal(D.damage({...input,targetLevel:30}).amount,3840);
  assert.equal(D.damage({...input,targetLevel:29}).amount,1920);
  assert.equal(D.damage(input).supported,false);
});
test('native equal-stat level30 raw coefficient100 produces1920 before special multipliers',()=>{
  const hit=D.damage(fixture);
  assert.equal(hit.supported,true);assert.equal(hit.amount,1920);
  assert.equal(hit.min,1824);assert.equal(hit.max,2016);
});
test('native ratio branches agree at .5 and1 and saturate below factor5',()=>{
  assert.ok(Math.abs(D.ratioFactor(25,100)-0.125)<1e-6);
  assert.ok(Math.abs(D.ratioFactor(50,100)-0.25)<1e-6);
  assert.ok(Math.abs(D.ratioFactor(75,100)-0.5625)<1e-6);
  assert.ok(Math.abs(D.ratioFactor(100,100)-1)<1e-6);
  assert.ok(Math.abs(D.ratioFactor(200,100)-(8/(1+Math.exp(-1))-3))<1e-6);
  assert.ok(D.ratioFactor(2000,100)<=5);
});
test('critical, elemental weakness and break multiply in native buckets',()=>{
  assert.equal(D.damage({...fixture,critical:true}).amount,2880);
  assert.equal(D.damage({...fixture,elementFactor:1.5}).amount,2880);
  assert.equal(D.damage({...fixture,critical:true,elementFactor:1.5,broken:true}).amount,6480);
});
test('all-target reduction uses isApplyAllMag and can be explicitly negated',()=>{
  const all={...fixture,skill:{...fixture.skill,isApplyAllMag:true}};
  assert.equal(D.damage(all).amount,768);
  assert.equal(D.damage({...all,ignoreAllDamagePenalty:true}).amount,1920);
  assert.equal(D.damage({...fixture,skill:{...fixture.skill,target:'EnemiesAll'}}).amount,1920);
});
test('coefficient is raw and finite-hit ratios are not multiplied by hit count',()=>{
  assert.equal(D.damage({...fixture,skill:{...fixture.skill,hits:3,ratios:[0.2,0.3,0.5]},hitRatio:0.2}).amount,384);
  assert.equal(D.damage({...fixture,coefficientScale:1.1,coefficientAdd:10}).amount,2304);
});
test('difficulty, outgoing passive bucket, invalid and absorb remain separate',()=>{
  assert.equal(D.damage({...fixture,difficultyGiven:0.8}).amount,1536);
  assert.equal(D.damage({...fixture,outgoingFactor:1.3}).amount,2496);
  assert.equal(D.damage({...fixture,elementFactor:0}).amount,0);
  const absorb=D.damage({...fixture,elementFactor:-1});assert.equal(absorb.amount,1920);assert.equal(absorb.healsTarget,true);
});
test('escape scaling requires owned progress and caps at256',()=>{
  assert.equal(D.damage({...fixture,skill:{calcType:'EscapeNum',mag:100}}).supported,false);
  assert.equal(D.damage({...fixture,skill:{calcType:'EscapeNum',mag:100},successfulEscapes:128}).amount,3840);
  assert.equal(D.damage({...fixture,skill:{calcType:'EscapeNum',mag:100},successfulEscapes:256}).amount,5760);
  assert.equal(D.damage({...fixture,skill:{calcType:'EscapeNum',mag:100},successfulEscapes:999}).amount,5760);
});
test('unknown calculation types reject rather than pretending to be standard magic',()=>{
  assert.equal(D.damage({...fixture,skill:{calcType:'DeffenceIgnore',mag:100}}).supported,false);
  assert.throws(()=>D.baseDamage({...fixture,attack:NaN}),RangeError);
  assert.equal(D.criticalProbability(0),0);assert.equal(D.criticalProbability(100),1);
  assert.ok(D.criticalProbability(50)>0.49&&D.criticalProbability(50)<0.5);
});
test('break uses separate native buckets, raw break points, level and nearest-integer rounding',()=>{
  const same={skill:{breakDmg:100},level:30,targetLevel:30};
  assert.equal(D.breakDamage(same).amount,100);
  assert.equal(D.breakDamage({...same,elementFactor:3,critical:true}).amount,450);
  assert.equal(D.breakDamage({...same,skill:{breakDmg:100,isApplyAllMag:true},elementFactor:3}).amount,120);
  assert.equal(D.breakDamage({...same,percentFactor:1.2,flatBonus:10}).amount,130);
  assert.equal(D.breakDamage({...same,level:31}).amount,110);
  assert.equal(D.breakDamage({...same,level:29}).amount,90);
  assert.equal(D.breakDamage({...same,level:1,targetLevel:1000}).amount,10);
});

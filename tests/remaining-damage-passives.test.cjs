const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const hp=require('./fixtures/native-hp-stepped.json');
const trailing=require('./fixtures/native-break-trailing.json');
const aggravation=require('./fixtures/native-aggravation.json');
const attack=source.skills.find(row=>row.id===401010);
const context={skill:attack,lbPercent:0,critical:false,extraPhase:false,hpPercent:100};
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const active=(effect,extra={},catalog=source)=>P.analyze(catalog,[],{...context,...extra,activeEffectIds:[effect.id]});

test('stepped HP damage and stagger match all isolated native getter vectors, including overheal',()=>{
  for(const row of hp.vectors){
    const effect=source.effects.find(effect=>effect.id===row.effectId);
    const skill={...attack,attr:row.attribute===4?'Magic':'Fight'};
    const result=active(effect,{skill,currentHp:row.hp,maxHp:row.maxHp,normalAttackSkillId:row.normalAttack?skill.id:999999});
    const factor=effect.applyTiming==='BreakDmgCalculation'?result.breakFactor:result.damageFactor;
    approx(factor-1,row.nativeContribution);
  }
});

test('HP getters require finite usable state and prefer exact current/max HP over a percentage approximation',()=>{
  const effect=source.effects.find(row=>row.id===12908),skill={...attack,attr:'Magic'};
  for(const state of [{},{currentHp:-1,maxHp:1000},{currentHp:1,maxHp:0},{currentHp:NaN,maxHp:1000},
    {currentHp:1,maxHp:Infinity},{hpPercent:-1},{hpPercent:Infinity},{hpPercent:NaN},
    {currentHp:1e308,maxHp:1e308},{currentHp:1,maxHp:1e-300},{hpPercent:1e308}]){
    const result=active(effect,{skill,hpPercent:undefined,...state});
    assert.equal(result.damageFactor,1,JSON.stringify(state));
    assert.ok(result.deferred.some(term=>term.effectId===effect.id));
  }
  const exact=active(effect,{skill,currentHp:500,maxHp:1000,hpPercent:100});
  const percent=active(effect,{skill,hpPercent:50});
  assert.equal(exact.damageFactor,percent.damageFactor);
  assert.ok(exact.damageFactor>1);
  const overheal=active(effect,{skill,currentHp:1500,maxHp:1000});
  assert.ok(overheal.damageFactor<1,'native negative lost HP is not clamped away');
});

test('Dark Rite uses Magic attribute and Latent Potential uses owner or configured normal attacks',()=>{
  const dark=source.effects.find(row=>row.id===12908),latent=source.effects.find(row=>row.id===12925);
  assert.equal(active(dark,{skill:{...attack,attr:'Ability',dmgType:'Magic'},hpPercent:10}).damageFactor,1);
  assert.ok(active(dark,{skill:{...attack,attr:'Magic',dmgType:'Physic'},hpPercent:10}).damageFactor>1);
  assert.equal(active(latent,{normalAttackSkillId:999999,hpPercent:10}).damageFactor,1);
  const unknown=active(latent,{hpPercent:10});
  assert.ok(unknown.deferred.length);
  const general={...source,skillRules:rules},skill={...attack,id:rules.general.normalAttackSkills[0],attr:'Ability'};
  assert.ok(active(latent,{skill,hpPercent:10},general).damageFactor>1);
});

test('Staggering Spells trailing action gate matches native metadata and calculation-rule vectors',()=>{
  const base=source.effects.find(row=>row.id===15116);
  for(const row of trailing.vectors){
    const effect={...base,params:base.params.map((value,index)=>index===14?row.p14:value)};
    const skill={...attack,calcType:'Magic',dmgType:['None','Physic','Magic'][row.damageType],
      parameterType:['None','HitPoint','MagicPoint'][row.parameterType],
      parameterVariationType:['Increase','Decrease','RatioIncrease','RatioDecrease','None'][row.variationType]};
    const catalog={...source,effects:[effect],skillRules:{...rules,damageCalc:{Magic:{doCalcSkillEffect:row.doCalcSkillEffect,doCalcSkillDamage:!row.doCalcSkillEffect}}}};
    approx(active(effect,{skill},catalog).breakFactor-1,row.nativeContribution);
  }
  const missing=active(base,{skill:{id:1,dmgType:'Magic'}});
  assert.ok(missing.deferred.length);
  assert.ok(P.decode({...base,params:base.params.map((value,index)=>index===14?2:value)}).unsupported);
});

test('Aggravation consumes the qualified native effect-instance count without deduplicating statuses',()=>{
  const effect=source.effects.find(row=>row.id===12910);
  for(const row of aggravation.vectors){
    const result=active(effect,{targetBadStatusCount:row.eligibleCount});
    approx(result.damageFactor-1,row.nativeContribution);
  }
  for(const targetBadStatusCount of [-1,.5,NaN,Infinity])assert.ok(active(effect,{targetBadStatusCount}).deferred.length);
  assert.ok(active(effect,{targetStatusIds:[1,1]}).deferred.length,'raw status IDs do not establish eligible instance count');
  const empty=active(effect,{targetStatusIds:[]});
  approx(empty.damageFactor-1,2**-23);
});

test('bad-status activation gates need their separate qualified boolean; zero and minus-one bypass',()=>{
  for(const effectId of [12915,15101]){
    const base=source.effects.find(row=>row.id===effectId),isHp=effectId===12915;
    const skill={...attack,dmgType:'Magic'},factor=result=>isHp?result.damageFactor:result.breakFactor;
    assert.equal(factor(active(base,{skill,targetStatusIds:[]})),1);
    assert.ok(active(base,{skill,targetStatusIds:[1],targetBadStatusCount:1}).deferred.length);
    assert.ok(factor(active(base,{skill,targetHasActiveBadStatus:true}))>1);
    assert.equal(factor(active(base,{skill,targetHasActiveBadStatus:false,targetBadStatusCount:3})),1);
    for(const bypass of [-1,0]){
      const effect={...base,params:base.params.map((value,index)=>index===(isHp?6:2)?bypass:value)};
      assert.ok(factor(active(effect,{skill},{...source,effects:[effect]}))>1);
    }
  }
});

test('Scan damage bonus requires both analyzed target and actual weakness',()=>{
  const effect=source.effects.find(row=>row.id===12903);
  for(const analyzed of [false,true])for(const weakness of [false,true]){
    const result=active(effect,{analyzed,weakness});
    assert.equal(result.modifiers.damagePercent,analyzed&&weakness?25:0);
  }
  assert.ok(active(effect,{analyzed:true}).deferred.length);
  for(const bypass of [-1,0]){
    const unconditional={...effect,params:effect.params.map((value,index)=>index===4?bypass:value)};
    assert.equal(active(unconditional,{}, {...source,effects:[unconditional]}).modifiers.damagePercent,25);
  }
});

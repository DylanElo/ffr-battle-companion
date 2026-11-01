const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../docs/mp-costs.js'),D=require('../docs/damage.js'),P=require('../docs/passives.js');
const source=require('../docs/data/catalog.json'),rules=require('../docs/skill-rules.json');
const oracle=require('./fixtures/mp-cost-native.json');
const catalog={...source,skillRules:rules};
const magic={...source.skills.find(skill=>skill.id===220010),cost:19};
const physical={...source.skills.find(skill=>skill.id===401010),cost:19};
const passiveFor=effectId=>source.passives.find(passive=>passive.effects.includes(effectId)).id;

test('native float32 MP-cost oracle covers products, truncation, minimum and zero',()=>{
  for(const row of oracle.cases){
    const effects=row.percentages.map((percent,n)=>({...source.effects.find(effect=>effect.id===61011),id:90000+n,
      params:[2,percent,0,-1,-1,-1,0,-1,0,-1,-1,-1,-1,-1,-1]}));
    const result=M.costForSkill({...catalog,effects},[],{...magic,cost:row.raw},{activeEffectIds:effects.map(effect=>effect.id)});
    assert.equal(result.cost,row.cost,JSON.stringify(row));
    assert.deepEqual(result.percentFactors,row.percentages);
    assert.deepEqual(result.deferred,[]);
  }
});

test('Half MP preserves physical source multiplicity and Unlock Magic suppresses only Magic Boost',()=>{
  const before=JSON.stringify({magic,context:{activeEffectIds:[61004]}});
  const once=M.costForSkill(catalog,[1045],magic,{boost:true,activeEffectIds:[61004]});
  assert.equal(once.cost,14);assert.deepEqual(once.percentFactors,[50,150]);
  const twice=M.costForSkill(catalog,[1045,1045],magic);
  assert.equal(twice.cost,4);assert.deepEqual(twice.appliedEffectIds,[61011,61011]);
  const unlocked=M.costForSkill(catalog,[1045,1417],magic,{boost:true});
  assert.equal(unlocked.cost,9);assert.deepEqual(unlocked.suppressedEffectIds,[61004]);
  const older=M.costForSkill(catalog,[1417],magic,{activeEffectIds:[1228]});
  assert.equal(older.cost,28);assert.deepEqual(older.suppressedEffectIds,[]);
  const reckless=M.costForSkill(catalog,[1417],physical,{reckless:true});
  assert.equal(reckless.cost,28);assert.deepEqual(reckless.appliedEffectIds,[61003]);
  assert.equal(JSON.stringify({magic,context:{activeEffectIds:[61004]}}),before);
});

test('physical and magical surcharge filters follow native skill fields',()=>{
  assert.equal(M.costForSkill(catalog,[passiveFor(61006)],physical).cost,28);
  assert.equal(M.costForSkill(catalog,[passiveFor(61006)],magic).cost,19);
  assert.equal(M.costForSkill(catalog,[passiveFor(61007)],magic).cost,28);
  const heal={...source.skills.find(skill=>skill.id===210010),cost:19};
  assert.equal(M.costForSkill(catalog,[passiveFor(61007)],heal).cost,19);
  const blade={...source.skills.find(skill=>skill.attr==='MagicSword'),cost:19};
  assert.equal(M.costForSkill(catalog,[passiveFor(61009)],blade).cost,9);
  assert.equal(M.costForSkill(catalog,[passiveFor(61009)],magic).cost,19);
  assert.equal(M.costForSkill(catalog,[],physical,{activeEffectIds:[1228]}).cost,19);
});

test('LB and command-scoped reductions require complete explicit context',()=>{
  const ids=[passiveFor(61000)];
  assert.equal(M.costForSkill(catalog,ids,magic,{limitBurstPoints:50,commandId:123}).cost,9);
  assert.equal(M.costForSkill(catalog,ids,magic,{limitBurstPoints:49,commandId:123}).cost,19);
  assert.equal(M.costForSkill(catalog,ids,magic,{limitBurstPoints:50,commandId:1}).cost,19);
  const missing=M.costForSkill(catalog,ids,magic);
  assert.equal(missing.cost,19);assert.ok(missing.deferred.some(effect=>effect.effectId===61000));
});

test('area MP surcharge uses explicit native cost flag and does not infer it from the damage spread flag',()=>{
  const ids=[passiveFor(61001)],spell={...magic,isApplyAllMag:true};
  assert.equal(M.costForSkill(catalog,ids,spell,{areaEffect:true}).cost,38);
  assert.equal(M.costForSkill(catalog,ids,spell,{areaEffect:false}).cost,19);
  const unknown=M.costForSkill(catalog,ids,spell);
  assert.equal(unknown.cost,19);assert.ok(unknown.deferred.some(effect=>effect.effectId===61001));
  assert.equal(M.costForSkill(catalog,[],{...magic,target:'Group'},{activeEffectIds:[61008]}).cost,28);
  assert.equal(M.costForSkill(catalog,[],{...magic,target:'Random'},{activeEffectIds:[61008],areaEffect:false}).cost,19);
});

test('unknown layouts, uncertain activation and unsupported recipients remain explicit',()=>{
  const base=source.effects.find(effect=>effect.id===61011),passive=source.passives.find(passive=>passive.id===1045);
  for(const changed of [{...base,prob:50},{...base,params:[...base.params.slice(0,6),99,...base.params.slice(7)]},
    {...base,condition:{Condition:'UnknownNativeCondition',param1:0,param2:0,param3:0}}]){
    const result=M.costForSkill({...catalog,effects:[changed]},[1045],magic);
    assert.equal(result.cost,19);assert.equal(result.deferred.length,1);
  }
  const result=M.costForSkill({...catalog,passives:[{...passive,effectBundles:passive.effectBundles.map(bundle=>({...bundle,TargetType:'Group'}))}]},[1045],magic);
  assert.equal(result.cost,19);assert.ok(result.deferred.length>0);
});

test('browser UMD exposes the same cost API',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),context={NativeDamage:D,CompanionPassives:P};
  vm.runInNewContext(fs.readFileSync(require.resolve('../docs/mp-costs.js'),'utf8'),context);
  assert.equal(context.CompanionMpCosts.costForSkill(catalog,[1045],magic).cost,9);
});

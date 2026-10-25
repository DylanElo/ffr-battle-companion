const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const P=require('../web/passives.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/companion-catalog.json'),'utf8'));
const skillRules=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/skill-rules.json'),'utf8'));
const skill={id:400100,dmgType:'Physic',attr:'Ability',element:'None'};
const context={skill,hpPercent:100,mpPercent:100,lbPercent:0,commandId:1,broken:false,critical:false,extraPhase:false,statusIds:[],targetStatusIds:[]};
const passiveFor=effectId=>catalog.passives.find(p=>p.effects.includes(effectId)).id;

test('native physical and magic damage passives filter by damage type and stack in one additive bucket',()=>{
  const physical=passiveFor(16001),magic=passiveFor(16011);
  const result=P.analyze(catalog,[physical,magic],context);
  assert.equal(result.modifiers.damagePercent,10);
  assert.equal(result.damageFactor,1.1);
  const both=P.analyze(catalog,[physical,passiveFor(16002)],context);
  assert.equal(both.modifiers.damagePercent,30);
  assert.equal(both.damageFactor,1.3);
  assert.notEqual(both.damageFactor,1.1*1.2);
});

test('passive counter and after-kill effects cannot be treated as permanent damage bonuses',()=>{
  const counter=P.analyze(catalog,[1408],context);
  assert.equal(counter.modifiers.breakPercent,0);
  assert.equal(counter.modifiers.element,'None');
  assert.equal(counter.deferred.length,2);
  const kill=P.analyze(catalog,[1438],context);
  assert.equal(kill.modifiers.breakPercent,0);
  assert.match(kill.deferred[0].reason,/OnDefeat/);
});

test('Power Stagger is conditional on target break even though its effect is a DamageMultiplier',()=>{
  assert.equal(P.analyze(catalog,[1385],context).damageFactor,1);
  assert.equal(P.analyze(catalog,[1385],{...context,broken:true}).damageFactor,1.35);
});

test('critical physical damage bonus is absent on a noncritical hit and included on critical',()=>{
  const id=passiveFor(12928);
  assert.equal(P.analyze(catalog,[id],context).damageFactor,1);
  assert.equal(P.analyze(catalog,[id],{...context,critical:true}).damageFactor,1.4);
});

test('HP/MP/speed percentages come from native parameter enum, not descriptions',()=>{
  const hp=P.analyze(catalog,[passiveFor(16301)],context);
  assert.equal(hp.modifiers.statPercent.HitPoint,10);
  const mp=P.analyze(catalog,[passiveFor(16401)],context);
  assert.equal(mp.modifiers.statPercent.MagicPoint,10);
  const speed=P.analyze(catalog,[passiveFor(1403)],context);
  assert.equal(speed.modifiers.statPercent.Agility,20);
});

test('native elemental resistance priority selects absorption over half damage',()=>{
  const half=passiveFor(1276);
  const windAbsorb=catalog.passives.find(p=>p.effects.some(id=>{const e=catalog.effects.find(e=>e.id===id);return e?.type==='AddElementResistance' && e.params[0]===3 && e.params[1]===4;}));
  assert.equal(P.analyze(catalog,[half],context).modifiers.resistances.Wind,'Halved');
  if(windAbsorb)assert.equal(P.analyze(catalog,[half,windAbsorb.id],context).modifiers.resistances.Wind,'Absorb');
});

test('none-only imbue enables matching elemental bonus without changing an already elemental skill',()=>{
  const imbue=passiveFor(40202),boost=passiveFor(12955);
  const result=P.analyze(catalog,[boost,imbue],context);
  assert.equal(result.modifiers.element,'Fire');
  assert.equal(result.modifiers.elementDamagePercent,20);
  const ice=P.analyze(catalog,[boost,imbue],{...context,skill:{...skill,element:'Ice'}});
  assert.equal(ice.modifiers.element,'Ice');
  assert.equal(ice.modifiers.elementDamagePercent,0);
});

test('conflicting imbues and missing conditional inputs are reported rather than silently applied',()=>{
  const conflicting=P.analyze(catalog,[passiveFor(40202),passiveFor(40203)],context);
  assert.equal(conflicting.elementAmbiguous,true);
  assert.equal(conflicting.modifiers.element,'None');
  assert.equal(conflicting.complete,false);
  const hpConditional=passiveFor(12924);
  const missing=P.analyze(catalog,[hpConditional],{skill});
  assert.equal(missing.damageFactor,1);
  assert.match(missing.deferred[0].reason,/hpPercent/);
});

test('elemental break bonus is never included in normal HP damage',()=>{
  const result=P.analyze(catalog,[passiveFor(15141)],{...context,skill:{...skill,element:'Thunder'}});
  assert.equal(result.modifiers.elementDamagePercent,0);
  assert.equal(result.modifiers.elementBreakPercent,30);
  assert.equal(result.damageFactor,1);
  assert.equal(result.breakFactor,1.3);
});

test('probabilistic and non-self party effects stay out of deterministic modifiers',()=>{
  const party=P.analyze(catalog,[1391],context);
  assert.equal(party.applied.length,0);
  assert.match(party.deferred[0].reason,/Non-self/);
  const effect={...catalog.effects.find(e=>e.id===16001),id:999999,prob:50};
  const p={id:999999,name:'fixture',effects:[999999],effectBundles:[{effectId:999999,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit',conditionData:{Condition:'None'}}]};
  const result=P.analyze({...catalog,effects:[effect],passives:[p]},[p.id],context);
  assert.equal(result.damageFactor,1);
  assert.match(result.deferred[0].reason,/Random/);
});

test('every current native passive produces finite supported modifiers or an explicit exclusion',()=>{
  for(const passive of catalog.passives){
    const result=P.analyze(catalog,[passive.id],context);
    assert.ok(Number.isFinite(result.damageFactor),`Damage factor for ${passive.id}`);
    assert.ok(Number.isFinite(result.breakFactor),`Break factor for ${passive.id}`);
    assert.equal(result.coverage.effects,result.applied.length+result.inactive.length+result.deferred.length+result.unsupported.length,`Coverage accounting ${passive.id}`);
  }
});

test('support actions retain real enemy/friendly scope, duration and multi-action restrictions',()=>{
  const actions=P.supportActions(catalog,[230080,400650,400730]);
  const deprotect=actions.debuffs.find(a=>a.effectId===19054);
  assert.equal(deprotect.parameter,'Defence');
  assert.equal(deprotect.value,-30);
  assert.equal(deprotect.duration,5);
  assert.equal(deprotect.rootRelation,'Enemies');
  assert.equal(actions.multiActions.find(a=>a.skillId===400650).mpCost,40);
  assert.equal(actions.multiActions.find(a=>a.skillId===400730).scope,'blackWhiteMagic');
  assert.equal(actions.multiActions.find(a=>a.skillId===400730).verifiedRestrictions,false);
});

test('already-applied party buffs join the same native bucket as passive damage bonuses',()=>{
  const result=P.analyze(catalog,[passiveFor(16001)],{...context,activeEffectIds:[16101]});
  assert.equal(result.modifiers.damagePercent,60);
  assert.equal(result.damageFactor,1.6);
  assert.equal(result.applied.find(t=>t.effectId===16101).source,'activeEffect');
  const debuff=P.analyze(catalog,[],{...context,activeEffectIds:[19054]});
  assert.equal(debuff.modifiers.statPercent.Defence,-30);
});

test('fresh native state rules exclude story-only finishers and wrong-form actions',()=>{
  const get=id=>catalog.skills.find(s=>s.id===id);
  const normal={demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0};
  assert.equal(P.skillEligibility(get(401300),normal,skillRules).eligible,false);
  assert.match(P.skillEligibility(get(401300),normal,skillRules).deferred[0],/DivineRadiance/);
  assert.equal(P.skillEligibility(get(408150),normal,skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(408150),{...normal,demonForm:true},skillRules).eligible,true);
  assert.equal(P.skillEligibility(get(408090),{...normal,demonForm:true},skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(404080),normal,skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(404080),{...normal,validatedUsableSkillIds:[404080]},skillRules).eligible,true);
});

test('native wrapper exclusions and selector attributes are enforced without extrapolating nesting',()=>{
  const get=id=>catalog.skills.find(s=>s.id===id),normal={demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0};
  assert.equal(P.skillEligibility(get(400650),{...normal,selectorId:400650},skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(220010),{...normal,selectorId:400730},skillRules).eligible,true);
  assert.equal(P.skillEligibility(get(446000),{...normal,selectorId:400730},skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(220010),{...normal,selectorId:400710},skillRules).eligible,false);
  assert.equal(P.skillEligibility(get(401140),{...normal,extraPhase:true},skillRules).eligible,false);
});

test('native damage calculation flags prevent fixed damage receiving regular damage modifiers',()=>{
  assert.equal(skillRules.damageCalc.Fixed.doCalcSkillDamage,false);
  assert.equal(skillRules.damageCalc.Fixed.doCalcElement,false);
  assert.equal(skillRules.damageCalc.Fixed.doCalcCritical,false);
  assert.equal(skillRules.damageCalc.Fixed.doCalcSkillEffect,false);
  assert.equal(skillRules.damageCalc.Physic.doCalcSkillDamage,true);
  assert.ok(skillRules.provenance.every(p=>p.currentGameExtract && p.matchesHistoricalSnapshot));
});

test('Decimating Attacks scales with targets on area attacks only; Tip-Top Shape scales with buffs',()=>{
  const catalog=require('../docs/data/catalog.json'),P=require('../docs/passives.js');
  const area={id:1,target:'Group',attr:'Magic',dmgType:'Magic',element:'None'},single={...area,target:'Single'};
  assert.equal(P.analyze(catalog,[1337],{skill:area,targetCount:3}).modifiers.damagePercent,30);
  assert.equal(P.analyze(catalog,[1337],{skill:single,targetCount:3}).modifiers.damagePercent,0);
  assert.equal(P.analyze(catalog,[1428],{skill:area,buffCount:0}).modifiers.damagePercent,0);
  assert.equal(P.analyze(catalog,[1428],{skill:area,buffCount:2}).modifiers.damagePercent,30);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const C=require('../docs/core.js');
const D=require('../docs/damage.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-ordinary-accuracy.json');
const normalIds={1001:401010,1002:402010,1003:403010,1004:404010,1005:405010,1006:408010,1007:406010,1008:407010};
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-9,`${message}: ${a} != ${b}`);

// Filter the command pool, preserving actual character growth, Vision awakening and mastery grants.
function fixture(characterId=1001,skillId=414200,targetChanges={},options={}){
  const visionId=skillId===400530?-1:13017;
  const equipment={weaponId:-1,armorId:-1,accessoryIds:[],visionId};
  const skillIds=new Set([normalIds[characterId],skillId]);
  const catalog={...source,skillRules:rules,skills:source.skills.filter(s=>skillIds.has(s.id)),
    visions:source.visions.filter(v=>[13017,13110].includes(v.id)),equipment:[],artifacts:[],masterSkills:[]};
  const character=source.characters.find(c=>c.id===characterId);
  const growth=source.statGrowth[character.levelParamId].rows.filter(r=>r.level<=55);
  const snapshot={characters:[{id:characterId,joinStatus:'Join',usable:true,
    experience:growth.reduce((n,r)=>n+r.requiredExperience,0),baseParameters:[],
    activeSkillIds:[normalIds[characterId],...growth.flatMap(r=>r.skillIds).filter(id=>skillIds.has(id))],
    equippedSkillIds:Array(8).fill(-1),equipment}],inventory:[],
    resonances:[{id:13017,awakeningPoints:2,sync:[{characterId,points:0}]},
      {id:13110,awakeningPoints:0,sync:[{characterId,points:95}]}],party:[characterId],player:{difficulty:'Normal'}};
  const enemy={id:999,level:55,stats:{MaxHitPoint:1e12,MaxBreakPoint:1e12,Defence:600,Mind:600,Agility:0},
    resistances:{},statusResistances:{},passiveIds:[],skillIds:[],...targetChanges};
  const model=B.createModel(catalog,snapshot,enemy,{goals:['damage'],rounds:1,actionId:skillId,includeSupportOptions:false,...options});
  const input={characterId,visionId,equipment,equippedSkillIds:skillId===400530?[skillId]:[]};
  const result=model.evaluate(input);
  assert.equal(result.valid,true,`${characterId}/${skillId}: ${result.reason}`);
  assert.equal(result.skillId,skillId,'fixed native action must not be replaced by a default attack');
  return {catalog,snapshot,enemy,model,input,result,party:()=>model.evaluateParty([{...input,evaluation:result}])};
}

function vectorOptions(vector){
  const skill=source.skills.find(s=>s.id===vector.input.skillId);
  const options={accuracyBonus:0,evasion:0,maxEvasion:75,statusResistance:vector.input.statusResistance||0};
  for(const id of vector.input.sourceIds||[])options.accuracyBonus+=native.effectInputs[id].accuracyBonus||0;
  for(const id of vector.input.targetIds||[]){const e=native.effectInputs[id];if(e.damageType===skill.dmgType)options.evasion+=e.evasion;}
  return {accuracy:vector.input.accuracyOverride??skill.accuracy,options};
}

test('ordinary hit helper reproduces 15 original native kernels and their exact RNG boundaries',()=>{
  assert.equal(native.kernelVectors.length,15);
  assert.equal(native.statusLookupVectors.length,8);
  for(const vector of native.kernelVectors){
    const {accuracy,options}=vectorOptions(vector);
    assert.equal(D.skillHitProbability(accuracy,options),vector.probability,JSON.stringify(vector.input));
    for(const boundary of vector.boundary)assert.equal(D.skillHitSuccess(accuracy,boundary.rngRaw,options),!boundary.miss,JSON.stringify({input:vector.input,rng:boundary.rngRaw}));
  }
  for(const [accuracy,successes] of Object.entries(native.scalarSuccessCounts)){
    let actual=0;for(let rng=0;rng<32768;rng++)actual+=Number(D.skillHitSuccess(Number(accuracy),rng));
    assert.equal(actual,successes,`all 32768 native draws at accuracy ${accuracy}`);
  }
  assert.equal(native.scalarRngChecks,131072);
});

test('actual low accuracy is admitted without admitting unknown accuracy or exceptional formulas',()=>{
  for(const id of [400530,414200,414210])assert.equal(C.isOrdinaryAttack(source.skills.find(s=>s.id===id)),true);
  const rapid=source.skills.find(s=>s.id===414200);
  for(const accuracy of [null,undefined,NaN,-1,'unknown'])assert.equal(C.isOrdinaryAttack({...rapid,accuracy}),false);
  assert.equal(C.isOrdinaryAttack({...rapid,accuracy:0}),true,'native zero accuracy is a modeled miss, not an unknown sentinel');
  for(const id of [400020,100210,500790,501570])assert.equal(C.isOrdinaryAttack(source.skills.find(s=>s.id===id)),false);
  assert.equal(rapid.dmgType,'Magic');assert.equal(rapid.calcType,'Magic');
  const disorder=source.skills.find(s=>s.id===414210);
  assert.equal(disorder.dmgType,'Magic');assert.equal(disorder.calcType,'Magic');
});

test('all eight characters score three legally unlocked low-accuracy skills in character and party paths',()=>{
  for(const {id:characterId} of source.characters)for(const skillId of [400530,414200,414210]){
    const f=fixture(characterId,skillId),r=f.result,p=f.party();
    const q=skillId===400530?.5:27852/32768;
    assert.equal(r.accuracyProbability,q);
    assert.equal(r.actionPlan.accuracyModeled,true);
    assert.equal(r.combatSamples,32);assert.equal(p.combatSamples,32);
    assert.ok(Number.isFinite(r.score)&&r.fightDamage>0&&r.fightBreakDamage>0);
    close(p.damage,r.fightDamage,'same build complete fight damage');
    close(p.breakDamage,r.fightBreakDamage,'same build complete fight stagger');
    assert.ok(r.skillCost<=r.skillBudget);assert.ok(r.equippedSkillIds.length<=r.maxSkillSlots);
    const events=r.resourceEvents.filter(e=>e.phase==='normal'&&e.skillId===skillId);
    assert.ok(events.length);
    for(const event of events){
      const hit=event.context.attackHitOutcomes,critical=event.context.criticalOutcomes;
      assert.equal(hit.length,skillId===400530?1:4);assert.equal(critical.length,hit.length);
      for(let i=0;i<hit.length;i++)if(!hit[i])assert.equal(critical[i],false,'miss never receives a critical outcome');
      if(!hit.some(Boolean)){assert.equal(event.damage,0);assert.equal(event.breakDamage,0);}
      assert.equal(event.mpCost,source.skills.find(s=>s.id===skillId).cost,'executed actions pay full MP even when they miss');
    }
    if(skillId===400530)assert.deepEqual(r.equippedSkillIds,[400530],'Cloud MR3 transfers Deathblow with its actual slot and AP cost');
    else {
      assert.ok(r.actionPlan.passiveIds.includes(1443),'Amelia awakening keeps actual free Dual Guns');
      assert.ok(r.actionPlan.turn.leaves.some(leaf=>leaf.nativeRepeat&&leaf.skillId===skillId));
      assert.equal(r.actionPlan.turn.leaves.find(leaf=>leaf.nativeRepeat).repeatChances[0],25);
    }
  }
});

test('matching target evasion follows native damage classification in both builders',()=>{
  for(const skillId of [400530,414200,414210]){
    const plain=fixture(1001,skillId),physical=fixture(1001,skillId,{passiveIds:[1085]}),magic=fixture(1001,skillId,{passiveIds:[1086]});
    if(skillId===400530){
      assert.equal(physical.result.accuracyProbability,0);assert.equal(physical.result.fightDamage,0);
      assert.equal(magic.result.accuracyProbability,.5);close(magic.party().damage,plain.party().damage,'magic evasion ignores physical Deathblow');
    }else{
      assert.equal(physical.result.accuracyProbability,27852/32768);close(physical.party().damage,plain.party().damage,'physical evasion ignores Amelia magic');
      assert.equal(magic.result.accuracyProbability,.25);assert.ok(magic.party().damage<plain.party().damage);
    }
  }
});

test('Versatility fills physical slots from learned actions while awakening-only Fire stays free to cast',()=>{
  const f=fixture(1004,414200);
  const freePassives=new Set(f.result.actionPlan.passiveIds);
  const catalog={...f.catalog,skills:source.skills.filter(s=>[404010,414200,220010,400550].includes(s.id)),
    passives:source.passives.filter(p=>p.id===1340||freePassives.has(p.id)),
    visions:source.visions.filter(v=>[13017,13110,13045].includes(v.id))};
  const snapshot={...f.snapshot,resonances:[
    {id:13017,awakeningPoints:2,sync:[{characterId:1004,points:4195}]},
    {id:13110,awakeningPoints:0,sync:[{characterId:1004,points:95}]},
    {id:13045,awakeningPoints:0,sync:[{characterId:1004,points:10}]}]};
  const model=B.createModel(catalog,snapshot,f.enemy,{goals:['damage'],rounds:1,actionId:414200,
    includeSupportOptions:false,jointOptimization:true,jointAbilityBudget:16});
  const prepared=model.prep(1004,13017);
  assert.ok(prepared.free.has(220010),'native Amelia awakening grants Fire casting availability');
  assert.equal(prepared.learn.learnedActiveIds.includes(220010),false,'Fire has no transferred mastery source in this fixture');
  assert.ok(prepared.learn.learnedActiveIds.includes(400550),'Leah MR1 grants equippable First Aid');
  const {equippedSkillIds,...input}=f.input;
  const result=model.evaluate(input);
  assert.equal(result.valid,true);assert.equal(result.skillId,414200);
  assert.equal(result.equippedSkillIds.includes(220010),false,'free awakening availability alone cannot buy a physical Versatility slot');
  assert.ok(result.actionPlan.passiveIds.includes(1340),'equipped Amelia MR9 supplies native Versatility');
  assert.ok(result.equippedSkillIds.includes(400550),'a learned, paid unused command remains a useful legal count source');
  assert.ok(result.skillCost<=result.skillBudget);
});

test('two legal four-character parties preserve low-accuracy plans and source ownership',()=>{
  for(const [ids,ameliaSkill] of [[[1001,1002,1003,1004],414200],[[1005,1006,1007,1008],414210]]){
    const fixtures=ids.map((id,i)=>fixture(id,i===0?ameliaSkill:400530));
    const skillIds=new Set(fixtures.flatMap(f=>f.catalog.skills.map(s=>s.id)));
    const catalog={...fixtures[0].catalog,skills:source.skills.filter(s=>skillIds.has(s.id))};
    const snapshot={...fixtures[0].snapshot,characters:fixtures.flatMap(f=>f.snapshot.characters),party:ids,
      resonances:[{id:13017,awakeningPoints:2,sync:ids.map(characterId=>({characterId,points:0}))},
        {id:13110,awakeningPoints:0,sync:ids.map(characterId=>({characterId,points:95}))}]};
    assert.equal(snapshot.characters.filter(c=>c.equipment.visionId===13017).length,1,'one actual Amelia copy per party');
    const model=B.createModel(catalog,snapshot,fixtures[0].enemy,{goals:['damage'],rounds:1,includeSupportOptions:false});
    const party=model.evaluateParty(fixtures.map(f=>({...f.input,evaluation:f.result})));
    assert.equal(party.combatSamples,32);assert.ok(party.damage>0&&party.breakDamage>0);
    for(const f of fixtures){
      const events=party.resourceEvents[f.input.characterId].filter(e=>e.phase==='normal');
      assert.ok(events.some(e=>e.skillId===f.result.skillId));
      for(const event of events){assert.equal(event.skillId,f.result.skillId);assert.ok(Array.isArray(event.context.attackHitOutcomes));}
    }
  }
});

test('native None status-map lookup applies before broken accuracy bypass',()=>{
  for(const vector of native.statusLookupVectors.filter(v=>v.queryStatus===0))for(const broken of [false,true]){
    const key=vector.mapKey===0?'None':vector.mapKey===16?'Slow':null;
    const statusResistances=key===null?{}:{[key]:vector.mapValue};
    const f=fixture(1001,414200,{statusResistances},{broken});
    const expected=vector.nativeCallerAutomaticMiss?0:broken?1:D.skillHitProbability(85,{statusResistance:vector.nativeResistance});
    assert.equal(f.result.accuracyProbability,expected,JSON.stringify({vector,broken}));
    if(vector.nativeCallerAutomaticMiss){
      assert.equal(f.result.damage,0);assert.equal(f.result.brokenDamage,0);assert.equal(f.party().damage,0);
      for(const event of f.result.resourceEvents.filter(e=>e.skillId===414200)){
        assert.ok(event.context.attackHitOutcomes.every(hit=>!hit));assert.ok(event.context.criticalOutcomes.every(hit=>!hit));
        assert.equal(event.damage,0);assert.equal(event.breakDamage,0);assert.equal(event.mpCost,18);
      }
    }
  }
});

test('partial multihit misses retain independent hit outcomes and full repeated-action payments',()=>{
  const f=fixture(1001,414200,{passiveIds:[1086]}),events=f.result.resourceEvents.filter(e=>e.skillId===414200);
  assert.ok(events.some(e=>e.context.attackHitOutcomes.some(Boolean)&&!e.context.attackHitOutcomes.every(Boolean)),'four hit opportunities must not collapse into one action roll');
  assert.ok(events.some(e=>!e.context.attackHitOutcomes.some(Boolean)),'representative native repeat contains a fully missed action');
  assert.equal(events.length,2);assert.equal(events.reduce((sum,e)=>sum+e.mpCost,0),36);
  assert.equal(events[1].damage,0);assert.equal(events[1].breakDamage,0);assert.equal(events[1].mpBefore-events[1].mpAfter,18);
  for(const event of events)for(let i=0;i<4;i++)if(!event.context.attackHitOutcomes[i])assert.equal(event.context.criticalOutcomes[i],false);
});

test('Halved and Absorb elemental results never receive sampled critical flags',()=>{
  for(const resistance of ['Halved','Absorb']){
    const f=fixture(1001,414200,{resistances:{Fire:resistance}},{critical:true});
    if(resistance==='Halved')assert.equal(f.result.criticalChance,0);
    else {assert.equal(f.result.damage,0);assert.equal(f.party().damage,0);}
    for(const event of f.result.resourceEvents)if(event.context?.criticalOutcomes)assert.ok(event.context.criticalOutcomes.every(hit=>!hit));
  }
});

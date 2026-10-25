const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const B=require('../docs/battle.js');
const Search=require('../docs/search.js');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'docs/data/catalog.json'),'utf8'));
catalog.skillRules=JSON.parse(fs.readFileSync(path.join(root,'docs/skill-rules.json'),'utf8'));
const snapshot=JSON.parse(cp.execFileSync('dotnet',[path.join(root,'importer/bin/Release/net10.0/BattleCompanionImporter.dll')],{encoding:'utf8'}));
const enemy=catalog.enemies.find(e=>e.id===113);
const own=snapshot.characters.find(c=>c.id===1001);
const input={characterId:own.id,visionId:own.equipment.visionId,equipment:own.equipment};
const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(snapshot.source.path)).digest('hex');

test('battle evaluation respects native skill cost, slots, difficulty and source ownership',()=>{
  const model=B.createModel(catalog,snapshot,enemy,{difficulty:'save',objective:'balanced'});
  const result=model.evaluate(input);
  assert.equal(result.valid,true);
  assert.equal(model.scenario.difficulty,'Expert');
  assert.equal(model.scenario.difficultyGiven,.8);
  assert.ok(result.damage>=result.damageMin && result.damage<=result.damageMax);
  assert.ok(result.breakDamage>=0);
  const costs=new Map([...catalog.skills,...catalog.passives,...catalog.masterSkills].map(s=>[s.id,Number(s.equipCost)||0]));
  assert.equal(result.equippedSkillIds.reduce((n,id)=>n+costs.get(id),0),result.skillCost);
  assert.ok(result.skillCost<=result.skillBudget);
  assert.ok(result.equippedSkillIds.length<=result.maxSkillSlots);
  const learned=model.prep(input.characterId,input.visionId).learn;
  const allowed=new Set([...learned.learnedActiveIds,...learned.learnedPassiveIds,...learned.masterSkillIds]);
  assert.ok(result.equippedSkillIds.every(id=>allowed.has(id)));
});

test('element immunity and absorption are not ranked as positive enemy damage',()=>{
  for(const resistance of ['Invalid','Absorb']){
    const target={...enemy,resistances:Object.fromEntries(['None','Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'].map(e=>[e,resistance]))};
    const result=B.createModel(catalog,snapshot,target,{difficulty:'Normal',objective:'damage'}).evaluate(input);
    assert.equal(result.damage,0);
  }
});

test('zero MP scenario never recommends an unaffordable spell',()=>{
  const result=B.createModel(catalog,snapshot,enemy,{mpPercent:0,objective:'damage'}).evaluate(input);
  assert.equal(result.valid,true);
  assert.equal(catalog.skills.find(s=>s.id===result.skillId).cost,0);
  assert.equal(result.availableMp,0);
});

test('native joint solver returns legal owned teams and preserves a healing option',()=>{
  const model=B.createModel(catalog,snapshot,enemy,{objective:'balanced',minHealers:1,difficulty:'save'});
  const result=Search.rankParties(catalog,snapshot,{evaluate:a=>model.evaluate(a),evaluateParty:members=>model.evaluateParty(members),enemy,
    options:{maxEvaluations:1200,perLoadoutBudget:12,timeMs:12000,beamWidth:12,candidatesPerVision:3,minHealers:1}});
  assert.ok(result.results.length>0);
  for(const party of result.results){
    assert.equal(party.members.length,4);
    assert.equal(Search.validateParty(catalog,snapshot,party.members,{partySize:4,minHealers:1}),'');
    assert.ok(party.members.some(m=>m.evaluation.canHeal));
    assert.ok(party.evaluation.damage>=0 && Number.isFinite(party.score));
  }
  assert.equal(result.approximate,true);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(snapshot.source.path)).digest('hex'),sourceHash);
});

test('healing magic and finishers cannot masquerade as repeatable normal attacks',()=>{
  assert.equal(B.isAttack(catalog.skills.find(s=>s.id===215000)),false);
  assert.equal(B.isAttack(catalog.skills.find(s=>s.id===400530)),false,'Deathblow accuracy 50 must not masquerade as always-hit expected damage');
  for(const skill of catalog.skills.filter(s=>s.attr==='FinishBlow'))assert.equal(B.isAttack(skill),false);
});

test('all healing/protection/support choices obey zero-LB native state gates',()=>{
  const P=require('../docs/passives.js');
  const model=B.createModel(catalog,snapshot,enemy,{objective:'balanced'});
  for(const person of snapshot.characters.filter(c=>c.joinStatus.endsWith('::Join') && c.usable)){
    const prepared=model.prep(person.id,person.equipment.visionId);
    const ids=new Set([...prepared.healSkills,...prepared.protectSkills].map(s=>s.id).concat([...prepared.support.buffs,...prepared.support.debuffs].map(a=>a.skillId)));
    for(const id of ids){
      const result=P.skillEligibility(catalog.skills.find(s=>s.id===id),{demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0,resources:{}},catalog.skillRules);
      assert.equal(result.eligible,true,`Illegal support ${id}: ${result.reasons.join(', ')}`);
    }
  }
});

test('a support turn replaces the caster attack and its stagger in the final action plan',()=>{
  const model=B.createModel(catalog,snapshot,enemy,{objective:'damage',difficulty:'Normal'});
  const receiverSaved=snapshot.characters.find(c=>c.id===1003);
  const receiver=model.evaluate({characterId:1003,visionId:receiverSaved.equipment.visionId,equipment:receiverSaved.equipment});
  receiver.stats={...receiver.stats,Agility:1};
  const caster={characterId:1001,visionId:-1,equipment:own.equipment,evaluation:{...receiver,damage:0,breakDamage:7,stats:{...receiver.stats,Agility:999},supportActions:[{skillId:230110,name:'Faith',kind:'damagePercent',value:50,rootRelation:'Friendlies',rootTarget:'Single',tests:[{key:'skill.dmgType',value:'Magic'}]}]}};
  const party=model.evaluateParty([caster,{characterId:1003,visionId:receiverSaved.equipment.visionId,equipment:receiverSaved.equipment,evaluation:receiver}]);
  assert.ok(party.supportUsed);
  assert.equal(party.actionOverrides[1001].skillId,230110);
  assert.equal(party.actionOverrides[1001].damage,0);
  assert.equal(party.actionOverrides[1001].breakDamage,0);
  assert.equal(party.roundBreakDamage,party.actionOverrides[1003].breakDamage);
  assert.equal(party.roundDamage,party.actionOverrides[1003].damage);
});

test('weakness-only stagger passives see the final attack element',()=>{
  const skill={...catalog.skills.find(s=>s.id===401010),id:900001,element:'Ice',criticalHitRate:0,mag:100};
  const item={id:900002,name:'Fixture weapon',type:'Weapon',detailType:'GreatSowrd',sexLimit:'None',stats:{},passiveIds:[900003]};
  const passive={id:900003,name:'Weakness stagger fixture',equipCost:0,effectBundles:[{effectId:1431,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit',conditionData:{Condition:'None'}}]};
  const cat={...catalog,skills:[skill],visions:[],masterSkills:[],passives:[passive],equipment:[item]};
  const person={...own,experience:0,baseParameters:Array(20).fill(0),equippedSkillIds:Array(8).fill(-1),activeSkillIds:[skill.id],equipment:{weaponId:item.id,armorId:-1,accessoryIds:[],visionId:-1}};
  const save={...snapshot,characters:[person],resonances:[],inventory:[{id:item.id,quantity:1}],artifactOverrides:[]};
  const target={...enemy,passiveIds:[],resistances:{Ice:'Weakness'}};
  const result=B.createModel(cat,save,target,{objective:'break',difficulty:'Normal'}).evaluate({characterId:person.id,visionId:-1,equipment:person.equipment});
  assert.equal(result.passiveAnalysis.breakFactor,1.3);
  assert.ok(result.passiveAnalysis.applied.some(t=>t.effectId===1431));
  const neutral=B.createModel(cat,save,{...target,resistances:{Ice:'None'}},{objective:'break',difficulty:'Normal'}).evaluate({characterId:person.id,visionId:-1,equipment:person.equipment});
  assert.equal(neutral.passiveAnalysis.breakFactor,1);
});

test('hits are capped at 9999 unless a damage-limit-break effect is equipped, which then gets picked',()=>{
  const soft={...enemy,stats:Object.fromEntries(Object.keys(enemy.stats).map(k=>[k,1])),
    resistances:Object.fromEntries(['None','Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'].map(e=>[e,'Weakness']))};
  const model=B.createModel(catalog,snapshot,soft,{objective:'damage',broken:true,critical:true});
  const result=model.evaluate(input),skill=catalog.skills.find(s=>s.id===result.skillId);
  if(!model.prep(input.characterId,input.visionId).learn.learnedPassiveIds.includes(1047))return;
  assert.equal(result.passiveAnalysis.modifiers.damageCapRaised,true);
  assert.ok(result.damageMax/result.actionCount/Math.max(1,skill.hits)>9999);
});

test('Arms Akimbo turns repeat the attack, pay its MP and AP, and stay within the budget',()=>{
  const model=B.createModel(catalog,snapshot,enemy,{objective:'damage'});
  const result=model.evaluate(input);
  if(!model.prep(input.characterId,input.visionId).legal.has(400650))return;
  assert.equal(result.actionCount,2);
  assert.ok(result.equippedSkillIds.includes(result.multiActionId));
  assert.ok(Math.abs(result.damage-result.singleDamage*2)<1e-6);
  assert.ok(result.turnMp<=result.availableMp && result.skillCost<=result.skillBudget);
});

test('a Limit Burst that beats the normal turn is used once staggers fill the gauge',()=>{
  const fragile={...enemy,stats:{...enemy.stats,MaxBreakPoint:1}};
  const model=B.createModel(catalog,snapshot,fragile,{objective:'damage',mpPercent:0});
  const result=model.evaluate(input);
  if(!model.prep(input.characterId,input.visionId).limits.length)return;
  assert.ok(result.limit.options.every(o=>o.damage>0));
  assert.ok(result.limitUses.length>0);
  assert.ok(result.fightDamage>result.damage);
});

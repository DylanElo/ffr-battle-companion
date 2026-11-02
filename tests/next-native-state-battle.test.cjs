const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../docs/battle.js');
const D=require('../docs/damage.js');
const native=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const f=Math.fround,EPS=f(2**-23);

function fixture({normalId=401010,passives=[],rounds=2,partySize=1,incomingDamage=100,breakPoint=1,finishId=null,mind=30,maxHp=1000,visionId=-1,awakeningPoints=0,alliesPassives=[],extraSkills=[],enemyCount=1}={}){
  // Isolate supplied passives while retaining native reached-Awakening active command grants.
  const selectedVision=visionId>0?visionId:finishId?13051:-1;
  const equipmentFor=id=>({weaponId:-1,armorId:-1,accessoryIds:[],visionId:id===1001?selectedVision:-1});
  const characters=Array.from({length:partySize},(_,i)=>({...native.characters.find(row=>row.id===1001+i),id:1001+i,levelParamId:1,passiveIds:[],baseSkillEquipCost:500,
    stats:{HitPoint:maxHp,MagicPoint:999,Attack:300,Intelligence:200,Divine:0,Defence:30,Mind:mind,Agility:50}}));
  const catalog={...native,skillRules:rules,characters,skills:native.skills.filter(row=>[normalId,finishId,...extraSkills].includes(row.id)),visions:selectedVision>0?[{...native.visions.find(row=>row.id===selectedVision),finishBlow:finishId??-1,stats:{},awakening:visionId>0?native.visions.find(row=>row.id===selectedVision).awakening.map(stage=>({...stage,grants:stage.grants.filter(grant=>grant.type==='ActiveSkill')})):[],synchro:[],baseSkillIds:[],innatePassiveIds:[],passiveIds:[]}]:[],equipment:[],artifacts:[],masterSkills:[],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[...passives,...alliesPassives,...extraSkills]}]}}};
  const snapshot={characters:characters.map(row=>({id:row.id,joinStatus:'Join',usable:true,experience:0,baseParameters:Array(20).fill(0),activeSkillIds:[normalId],equippedSkillIds:Array(8).fill(-1),equipment:equipmentFor(row.id)})),
    inventory:[],resonances:selectedVision>0?[{id:selectedVision,awakeningPoints,sync:[]}]:[],party:characters.map(row=>row.id),player:{difficulty:'Normal'}};
  const enemy={id:999,level:1,stats:{MaxHitPoint:1e12,MaxBreakPoint:breakPoint,Defence:50,Mind:50,Agility:0},resistances:{},passiveIds:[],skillIds:[]};
  const model=B.createModel(catalog,snapshot,enemy,{goals:finishId?['durability']:['damage'],rounds,incomingDamage,enemyCount,actionId:normalId,includeSupportOptions:false,jointOptimization:true,jointAbilityBudget:8});
  const input=id=>({characterId:id,visionId:equipmentFor(id).visionId,equipment:equipmentFor(id)});
  const fixed=(ids=passives,id=1001)=>{const result=model.evaluate({...input(id),equippedSkillIds:ids});assert.equal(result.valid,true,JSON.stringify(result));return result;};
  const party=ids=>{const members=characters.map(row=>({...input(row.id),evaluation:fixed(row.id===1001?ids:alliesPassives,row.id)}));return model.evaluateParty(members);};
  return {catalog,snapshot,model,fixed,party,input};
}
const attacks=events=>events.filter(row=>row.common?.outgoingFactor!==undefined);
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-9,`${label}: ${a} vs ${b}`);
const accumulate=(old,recipients)=>recipients.reduce((bonus,row)=>Math.max(0,Math.min(f(f(50)*f(.01)+EPS),f(f(f(f(f(f(row.healed)/f(row.maxHp))*f(10))*f(.01))+EPS)+bonus))),old);

test('Heroic Nature counts one configured incoming selected attack after Normal, including Magic damage actions',()=>{
  for(const normalId of [401010,220010]){
    const z=fixture({normalId,passives:[1409]});
    const fixed=z.fixed(),party=z.party([1409]);
    for(const events of [fixed.resourceEvents,party.resourceEvents[1001]]){
      const rows=attacks(events);
      assert.deepEqual(rows.map(row=>[row.round,row.phase,row.context.receivedAttackCountThisRound]),[[1,'normal',0],[1,'additional',1],[2,'normal',0],[2,'additional',1]]);
      assert.ok(rows[0].common.outgoingFactor<1.000001);
      assert.ok(rows[1].common.outgoingFactor>1.149&&rows[1].common.outgoingFactor<1.151,'Additional observes the completed incoming selected action');
      assert.equal(events.filter(row=>row.kind==='incoming').length,2);
    }
    close(party.damage,fixed.fightDamage,'fixed and party share the same stateful score');
  }
});

test('Heroic Nature gets no invented incoming event without configured damage',()=>{
  const z=fixture({passives:[1409],incomingDamage:0}),result=z.fixed();
  assert.equal(result.resourceEvents.some(row=>row.kind==='incoming'),false);
  assert.ok(attacks(result.resourceEvents).every(row=>row.context.receivedAttackCountThisRound===0));
  assert.ok(attacks(result.resourceEvents).every(row=>row.common.outgoingFactor<1.000001));
});

test('a nullified physical selected attack still advances Heroic Nature once',()=>{
  const original=D.skillHitSuccess;
  D.skillHitSuccess=(chance,...args)=>chance===35?true:original(chance,...args);
  try{
    const z=fixture({passives:[1409,1334]}),result=z.fixed();
    const hits=result.resourceEvents.filter(row=>row.kind==='incoming');
    assert.ok(hits.every(row=>row.nullified&&row.damage===0));
    assert.deepEqual(attacks(result.resourceEvents).map(row=>row.context.receivedAttackCountThisRound),[0,1,0,1]);
    assert.ok(attacks(result.resourceEvents).filter(row=>row.phase==='additional').every(row=>row.common.outgoingFactor>1.149));
  }finally{D.skillHitSuccess=original;}
});

test('Hand That Heals updates from completed Finish recipient deltas, including self, before later actions',()=>{
  const z=fixture({passives:[1393],partySize:2,finishId:412510}),fixed=z.fixed(),party=z.party([1393]);
  for(const events of [fixed.resourceEvents,party.resourceEvents[1001]]){
    const heal=events.find(row=>row.kind==='finish-heal'&&row.round===1);
    assert.ok(heal);assert.ok(heal.recipients.some(row=>row.characterId===1001&&row.healed>0),'self restoration is a qualifying record');
    assert.ok(heal.recipients.every(row=>row.healed===row.hpAfter-row.hpBefore));
    const expected=accumulate(0,heal.recipients),before=attacks(events).filter(row=>row.round===1),later=attacks(events).find(row=>row.round===2&&row.phase==='normal');
    assert.ok(before.every(row=>row.context.recoveryDamageBonus===0&&row.context.recoveryBreakBonus===0),'healing does not boost earlier Normal or Additional attacks');
    close(later.context.recoveryDamageBonus,expected,'post-completion HP bonus');
    close(later.context.recoveryBreakBonus,expected,'separate post-completion BP accumulator');
    close(later.common.outgoingFactor,1+expected,'later damage uses exact native accumulator');
  }
  const heal=party.resourceEvents[1001].find(row=>row.kind==='finish-heal'&&row.round===1);
  assert.equal(heal.recipients.length,2,'group healing records both actual living recipients');
  assert.equal(party.resourceEvents[1002].filter(row=>row.kind==='finish-heal').length,0,'other members do not receive an invented healing action');
});

test('zero actual healing still adds native epsilon per qualifying recipient without inventing restored HP',()=>{
  const z=fixture({passives:[1393],partySize:2,finishId:412510,incomingDamage:0}),result=z.party([1393]);
  const events=result.resourceEvents[1001],heal=events.find(row=>row.kind==='finish-heal'&&row.round===1);
  assert.ok(heal);assert.equal(heal.effectiveHealing,0);assert.ok(heal.recipients.every(row=>row.healed===0));
  const next=attacks(events).find(row=>row.round===2&&row.phase==='normal');
  assert.equal(next.context.recoveryDamageBonus,f(EPS+EPS));
  assert.equal(result.remainingHp[1001],1000);assert.equal(result.remainingHp[1002],1000);
});

test('large real OverHeal deltas cap Hand That Heals at its native fifty percent factor',()=>{
  const z=fixture({passives:[1393],partySize:2,finishId:414100,incomingDamage:0,mind:999,maxHp:100}),result=z.party([1393]);
  const events=result.resourceEvents[1001],heal=events.find(row=>row.kind==='finish-heal'&&row.round===1);
  assert.ok(heal&&heal.common.overheal);assert.ok(heal.recipients.reduce((sum,row)=>sum+row.healed/row.maxHp,0)>5);
  const next=attacks(events).find(row=>row.round===2&&row.phase==='normal');
  assert.equal(next.context.recoveryDamageBonus,.5000001192092896);
  assert.equal(next.context.recoveryBreakBonus,.5000001192092896);
  assert.equal(next.common.outgoingFactor,1.5000001192092896);
});

test('Bastion does not count unrelated Great Wall guards as native Protect statuses',()=>{
  const z=fixture({passives:[1454],partySize:2,finishId:412620,incomingDamage:0}),result=z.party([1454]);
  assert.ok(result.resourceEvents[1001].some(row=>row.kind==='finish-protection'&&row.guards.some(guard=>guard.effectId===16129)));
  assert.ok(attacks(result.resourceEvents[1001]).every(row=>row.context.sameSideProtectCount===0));
  assert.ok(result.remainingGuards[1001].some(guard=>guard.status==='GreatWall'));
  assert.ok(result.remainingGuards[1002].some(guard=>guard.status==='GreatWall'));
});


test('Bastion sees each same-side Auto-Protect unit once on an explicit reached Wilhelm command',()=>{
  for(const partySize of [1,2,4]){
    const z=fixture({normalId:414700,passives:[1454,1072,1290],alliesPassives:[1072,1290],partySize,
      visionId:13062,awakeningPoints:1,incomingDamage:0,breakPoint:1e12});
    const fixed=z.fixed(),party=z.party([1454,1072,1290]);
    const single=attacks(fixed.resourceEvents);
    assert.ok(single.every(row=>row.context.sameSideProtectCount===1),'multiple Protect effects on the owner count once');
    assert.ok(single.every(row=>row.context.commandId===207&&row.context.queuedCommandId===207));
    const rows=attacks(party.resourceEvents[1001]);
    assert.ok(rows.every(row=>row.context.sameSideProtectCount===partySize),'same-side count includes each protected member once');
    assert.ok(rows.every(row=>row.context.commandId===207));
    const unboosted=z.party([1072,1290]);
    assert.ok(party.breakDamage>unboosted.breakDamage,'completed party score uses the live protected-unit stagger bonus');
  }
});

test('Bastion Protect Opener lasts through round three and expires before round four',()=>{
  const z=fixture({normalId:414700,passives:[1454,1290],visionId:13062,awakeningPoints:1,rounds:5,incomingDamage:0,breakPoint:1e12});
  for(const events of [z.fixed().resourceEvents,z.party([1454,1290]).resourceEvents[1001]]){
    const rows=attacks(events).filter(row=>row.phase==='normal');
    assert.deepEqual(rows.map(row=>row.context.sameSideProtectCount),[1,1,1,0,0]);
    assert.ok(rows[0].breakDamage>rows[3].breakDamage);
  }
});

test('Bastion sees a paid Protect cast only after its result completes',()=>{
  const z=fixture({normalId:414700,passives:[1454],visionId:13062,awakeningPoints:1,rounds:1,incomingDamage:0,breakPoint:1e12,extraSkills:[230040]});
  // A controlled leaf queue isolates result-order transport; native recipe legality has separate tests.
  const initial=z.fixed(),support={skillId:230040,kind:'support',actionIndex:1,context:{friendlyTargetId:1001}},attack={skillId:414700,kind:'attack',context:{commandId:207,queuedCommandId:207}};
  const steps=[{...attack,actionIndex:0},support,{...attack,actionIndex:2}],turn={...initial.turn,leaves:steps,steps,actions:3};
  const evaluation={...initial,turn,actionPlan:{...initial.actionPlan,turn},fallbackActionPlan:{...initial.fallbackActionPlan,turn}};
  const result=z.model.evaluateParty([{...z.input(1001),evaluation}]),events=result.resourceEvents[1001];
  const rows=attacks(events);
  assert.deepEqual(rows.map(row=>row.context.sameSideProtectCount),[0,1]);
  assert.ok(rows[1].breakDamage>rows[0].breakDamage);
  assert.ok(events.find(row=>row.skillId===230040).mpCost>0,'Protect spends its real MP');
});

test('Play Rough applies only its native skill whitelist after this target actually attacked the source',()=>{
  for(const normalId of [447300,447310,401010]){
    const z=fixture({normalId,passives:[1433]}),fixed=z.fixed(),party=z.party([1433]);
    for(const events of [fixed.resourceEvents,party.resourceEvents[1001]]){
      const rows=attacks(events);
      assert.deepEqual(rows.map(row=>row.context.targetPreviouslyAttackedSource),[false,true,true,true]);
      if(normalId===401010)assert.ok(rows.every(row=>row.common.outgoingFactor<1.000001),'unrelated ordinary Attack never receives Play Rough');
      else {assert.ok(rows[0].common.outgoingFactor<1.000001);assert.ok(rows.slice(1).every(row=>row.common.outgoingFactor>1.399&&row.common.outgoingFactor<1.401));}
    }
  }
});


test('a single paid Protect result lasts five BeginTurn intervals without being refreshed',()=>{
  const z=fixture({normalId:414700,passives:[1454],visionId:13062,awakeningPoints:1,rounds:6,incomingDamage:0,breakPoint:1e12,extraSkills:[230040]});
  const initial=z.fixed(),support={skillId:230040,kind:'support',actionIndex:0,context:{friendlyTargetId:1001}},attack={skillId:414700,kind:'attack',actionIndex:1,context:{commandId:207,queuedCommandId:207}};
  const openingTurn={...initial.turn,leaves:[support,attack],steps:[support,attack],actions:2};
  const actionPlan={...initial.actionPlan,openingTurn},evaluation={...initial,actionPlan,fallbackActionPlan:actionPlan};
  const result=z.model.evaluateParty([{...z.input(1001),evaluation}]),events=result.resourceEvents[1001];
  assert.equal(events.filter(row=>row.skillId===230040).length,1);
  assert.deepEqual(attacks(events).map(row=>row.context.sameSideProtectCount),[1,1,1,1,1,0]);
});

test('Play Rough leaves ambiguous multi-enemy prior-attacker state uncredited',()=>{
  const z=fixture({normalId:447300,passives:[1433],enemyCount:2,breakPoint:1e12}),result=z.fixed(),rows=attacks(result.resourceEvents);
  assert.equal(rows[0].context.targetPreviouslyAttackedSource,false);
  assert.equal(rows[1].context.targetPreviouslyAttackedSource,undefined);
  assert.ok(rows.every(row=>row.common.outgoingFactor<1.000001));
});

const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../docs/passives.js');
const source=require('../docs/data/catalog.json');
const rules=require('../docs/skill-rules.json');
const native=require('./fixtures/native-remaining-passive-decode.json');
const catalog={...source,skillRules:rules};
const base=source.skills.find(row=>row.id===401010);
const effect=id=>source.effects.find(row=>row.id===id);
const active=(id,context={},cat=catalog)=>P.analyze(cat,[],{skill:base,activeEffectIds:[id],...context});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const contribution=(result,id)=>result.terms.filter(term=>term.effectId===id).reduce((sum,term)=>sum+Number(term.value||0)/100,0);

test('Improvement and Versatility reproduce original native counter getter outputs',()=>{
  for(const row of native.counts){
    const key=row.effectId===12939?'equippedCommandActiveCount':'completedNormalAttackCount';
    const result=active(row.effectId,{[key]:row.count});
    if(row.count<0){assert.ok(result.deferred.length);continue;}
    close(contribution(result,row.effectId),row.contribution);
  }
  assert.equal(active(12904,{completedNormalAttackCount:0}).terms[0].nativeCount,0);
  assert.ok(active(12939,{equippedCommandActiveCount:100}).modifiers.damagePercent>99,'Versatility has no five-entry cap');
});

test('count bonuses defer absent, fractional, negative and overflowing native state',()=>{
  for(const [id,key] of [[12904,'completedNormalAttackCount'],[12939,'equippedCommandActiveCount'],[15127,'sameSideProtectCount']]){
    for(const value of [undefined,-1,.5,NaN,Infinity,2147483648]){
      const result=active(id,{[key]:value,commandId:207});
      assert.ok(result.deferred.length,`${id}/${value}`);
      assert.equal(result.modifiers.damagePercent,0);assert.equal(result.modifiers.breakPercent,0);
    }
  }
});

test('Heroic Nature consumes completed received-action count without a physical restriction or cap',()=>{
  for(const row of native.heroic)for(const dmgType of ['Physic','Magic']){
    const result=active(12901,{receivedAttackCountThisRound:row.receivedActionTargetCounter,skill:{...base,dmgType,attr:'Magic'}});
    close(contribution(result,12901),row.nativeDamageContribution);
    assert.equal(result.modifiers.breakPercent,0);
  }
  for(const receivedAttackCountThisRound of [undefined,-1,.5,NaN,Infinity,2147483648])assert.ok(active(12901,{receivedAttackCountThisRound}).deferred.length);
  assert.ok(active(12901,{incomingDamage:100,hitCount:5}).deferred.length,'damage amount and visual hits are not the native completed-command count');
});

test('Trigger uses native current normal ID or General aliases, not skill attributes',()=>{
  for(const row of native.trigger){
    const result=active(row.effectId,{normalAttackSkillId:row.normalAttackSkillId,skill:{...base,id:row.skillId}});
    close(contribution(result,row.effectId),row.contribution);
  }
  assert.ok(active(12906,{skill:{...base,id:220340,attr:'Fight'}}).deferred.length);
  assert.ok(active(12906,{normalAttackSkillId:401010,skill:{...base,id:220340,attr:'Fight'}}).inactive.length);
});

test('Perfect Serenity changes the coefficient bucket immediately, independently of attack history',()=>{
  for(const row of native.serenity){
    const result=active(12973,{normalAttackSkillId:row.normalAttackSkillId,skill:{...base,id:row.skillId}});
    close(1+result.modifiers.coefficientScalePercent/100,row.coefficientScale);
    assert.equal(result.modifiers.damagePercent,0);
  }
  for(const completedNormalAttackCount of [0,1,99])assert.ok(active(12973,{normalAttackSkillId:base.id,completedNormalAttackCount}).modifiers.coefficientScalePercent>50);
  assert.ok(active(12973).deferred.length);
});

test('Odin distinguishes HP and stagger whitelists and accepts independently skipped ID holes',()=>{
  for(const row of native.odin){
    const result=active(row.effectId,{skill:{...base,id:row.skillId}});
    close(contribution(result,row.effectId),row.contribution);
  }
  const original=effect(12927),params=original.params.slice();params[1]=11;params[2]=-1;params[3]=13;params[4]=13;params[5]=19;
  const cat={...catalog,effects:[{...original,params}]};
  close(contribution(active(12927,{skill:{...base,id:13}},cat),12927),0.25000011920928955);
  assert.equal(active(12927,{skill:{...base,id:12}},cat).modifiers.damagePercent,0);
});

test('True Stagger requires actual command and explicit native suppression boolean',()=>{
  for(const row of native.trueStagger){
    const result=active(15125,row);
    assert.equal(result.modifiers.baseBreakAdd,row.addition);
    assert.equal(result.modifiers.breakPercent,0,'base addition is not an outgoing percentage');
  }
  for(const context of [{},{commandId:200},{baseBreakSuppressed:false}])assert.ok(active(15125,context).deferred.length);
  assert.equal(active(15125,{commandId:200,baseBreakSuppressed:false,broken:true,weakness:true}).modifiers.baseBreakAdd,6);
});

test('Bastion consumes qualified same-side Protect unit count without assuming all allies are protected',()=>{
  for(const row of native.bastion)close(contribution(active(15127,row),15127),row.contribution);
  assert.ok(active(15127,{commandId:207,targetStatusIds:[25],partySize:4}).deferred.length);
  assert.equal(active(15127,{commandId:206,sameSideProtectCount:4}).modifiers.breakPercent,0);
});

test('Lone Lion requires a real Improvement instance at its native threshold and scales only five primaries',()=>{
  const lone=active(16601,{completedNormalAttackCount:99});
  assert.equal(Object.keys(lone.modifiers.statScale).length,0,'a numeric counter alone does not install the native gate');
  for(const count of [0,4,5,99]){
    const result=P.analyze(catalog,[],{skill:base,completedNormalAttackCount:count,activeEffectIds:[16601,12904]});
    assert.deepEqual(result.modifiers.statScale,count<5?{}:{Attack:130,Defence:130,Intelligence:130,Mind:130,Agility:130});
  }
  const missing=P.analyze(catalog,[],{skill:base,activeEffectIds:[16601,12904]});
  assert.ok(missing.deferred.some(term=>term.effectId===16601));
});

test('Thievery uses saved global success count at native 0.1 percent increments and no-epsilon cap',()=>{
  for(const row of native.steals){
    const result=active(12905,{successfulSteals:row.stealSuccessNum});
    if(row.stealSuccessNum<0){assert.ok(result.deferred.length);continue;}
    close(contribution(result,12905),row.nativeContribution);
  }
  for(const successfulSteals of [undefined,-1,.5,NaN,Infinity,2147483648])assert.ok(active(12905,{successfulSteals}).deferred.length);
});

test('Hand That Heals reads independent native accumulated floats and defers unknown prior healing',()=>{
  const cap=Math.fround(Math.fround(50*Math.fround(.01))+Math.fround(2**-23));
  for(const [id,key,metric] of [[12947,'recoveryDamageBonus','damagePercent'],[15130,'recoveryBreakBonus','breakPercent']]){
    for(const value of [0,.1,cap]){
      const result=active(id,{[key]:value});close(result.modifiers[metric]/100,Math.fround(value));
    }
    for(const value of [undefined,-1,NaN,Infinity,cap+1])assert.ok(active(id,{[key]:value}).deferred.length);
    assert.ok(active(id,{healingDone:10000}).deferred.length);
  }
});

test('Dual Guns exposes a conditional paid repeat only with verified queue command and ancestry',()=>{
  const context={queuedCommandId:202,hierarchySkills:[],skill:{...base,attr:'Magic',dmgType:'Magic'}};
  const result=active(54220,context),repeat=result.modifiers.automaticRepeats[0];
  assert.equal(repeat.chance,25);assert.equal(repeat.value,1);assert.equal(repeat.priority,200);
  assert.equal(result.modifiers.damagePercent,0,'P does not replace the real chance and paid queue with a damage multiplier');
  for(const id of [400710,400650,400330])assert.equal(active(54220,{...context,hierarchySkills:[id]}).modifiers.automaticRepeats.length,0);
  assert.equal(active(54220,{...context,queuedCommandId:201}).modifiers.automaticRepeats.length,0);
  assert.equal(active(54220,{...context,skill:{...base,attr:'LimitBurst'}}).modifiers.automaticRepeats.length,0);
  assert.equal(active(54220,{...context,skill:{...base,parameterVariationType:'Increase'}}).modifiers.automaticRepeats.length,0);
  for(const state of [{},{queuedCommandId:202},{...context,hierarchySkills:undefined}])assert.ok(active(54220,state).deferred.length);
});

test('Play Rough requires actual target history and its native skill whitelist',()=>{
  for(const row of native.playRough){
    const result=active(12926,{skill:{...base,id:row.skillId},targetPreviouslyAttackedSource:row.targetPreviouslyAttackedSource});
    close(contribution(result,12926),row.contribution);
  }
  assert.ok(active(12926,{skill:{...base,id:447300}}).deferred.length);
  assert.equal(active(12926,{skill:{...base,id:220340},targetPreviouslyAttackedSource:true}).modifiers.damagePercent,0);
  assert.ok(active(12926,{skill:{...base,id:447300},incomingDamage:100,round:5}).deferred.length);
});

test('Trigger Happy matches qualified native target statuses and sums only explicit physical source copies',()=>{
  for(const row of native.triggerHappy){
    const result=P.analyze(catalog,[],{skill:base,targetLiveStatusIds:row.targetLiveStatusIds,activeEffectIds:Array(row.sourceCopies).fill(54221)});
    assert.equal(result.modifiers.automaticRepeatChanceBonus,row.chanceBonus);
  }
  const twice=P.analyze(catalog,[1444],{skill:base,targetLiveStatusIds:[16],passiveIdOccurrences:[1444,1444]});
  assert.equal(twice.modifiers.automaticRepeatChanceBonus,100);
  const semantic=P.analyze(catalog,[1444,1444],{skill:base,targetLiveStatusIds:[16]});
  assert.equal(semantic.modifiers.automaticRepeatChanceBonus,50);assert.ok(semantic.deferred.length);
  for(const targetLiveStatusIds of [undefined,[16.5],[-1],[256],[[16]]])assert.ok(active(54221,{targetLiveStatusIds}).deferred.length);
  assert.ok(active(54221,{targetStatusIds:[16]}).deferred.length,'an unqualified or partial status list is not the native live-target list');
});

test('new native families reject changed or incomplete layouts instead of granting optimistic bonuses',()=>{
  for(const id of [12901,12904,12939,12906,12927,12973,15125,15127,12905,12947,15130,16601,54220,12926,54221]){
    const original=effect(id),params=original.params.slice();params[14]=7;
    assert.ok(P.decode({...original,params}).unsupported,String(id));
    assert.ok(P.decode({...original,params:original.params.slice(0,3)}).unsupported,String(id));
  }
});

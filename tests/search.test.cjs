const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../docs/search.js');

function fixture(n=4) {
  return {
    catalog:{characters:Array.from({length:n},(_,i)=>({id:i+1,name:`C${i+1}`,sex:'Male',weaponType:'Sword',armorTypes:['Light']})),
      visions:Array.from({length:n},(_,i)=>({id:100+i,name:`Vision${i}`})),equipment:[
        {id:10,name:'Sword',type:'Weapon',detailType:'Sword',sexLimit:'None',stats:{PhysicalAttack:10}},
        {id:20,name:'Armor',type:'Armor',detailType:'Light',sexLimit:'None',stats:{}},
        {id:30,name:'A',type:'Accessory',detailType:'None',sexLimit:'None',stats:{},passiveIds:[1]},
        {id:31,name:'B',type:'Accessory',detailType:'None',sexLimit:'None',stats:{},passiveIds:[2]},
        {id:32,name:'Plain',type:'Accessory',detailType:'None',sexLimit:'None',stats:{PhysicalAttack:4}}
      ]},
    snapshot:{characters:Array.from({length:n},(_,i)=>({id:i+1,joinStatus:'Join',usable:true,
      equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1,-1],visionId:100+i}})),
      inventory:[{id:10,quantity:1},{id:20,quantity:n},{id:30,quantity:1},{id:31,quantity:1},{id:32,quantity:8}],
      resonances:Array.from({length:n},(_,i)=>({id:100+i})),party:Array.from({length:Math.min(4,n)},(_,i)=>i+1)}
  };
}
const options={timeMs:0,maxEvaluations:100000,perLoadoutBudget:10000,candidatesPerVision:6,beamWidth:100,maxResults:3};

test('a budget exhausted by initial evaluations still returns the saved Resonance seed',()=>{
  const {catalog,snapshot}=fixture();
  const result=S.buildCandidates(catalog,snapshot,1,{evaluate:()=>({valid:true,score:10})},
    {maxEvaluations:1,timeMs:0,perLoadoutBudget:1,candidatesPerVision:1});
  assert.ok(result.some(c=>c.visionId===snapshot.characters[0].equipment.visionId));
});
test('evaluates passive accessory pairs together instead of discarding individually weak effects',()=>{
  const {catalog,snapshot}=fixture(1);
  const candidates=S.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>({score:
    equipment.accessoryIds.includes(30)&&equipment.accessoryIds.includes(31)?100:
      equipment.accessoryIds.filter(id=>id===32).length*4})},options);
  const best=candidates.sort((a,b)=>b.score-a.score)[0];
  assert.equal(best.score,100);
  assert.deepEqual(best.equipment.accessoryIds,[30,31]);
});
test('joint party search obeys stock and conservative distinct Resonance reservations',()=>{
  const {catalog,snapshot}=fixture();
  const result=S.rankParties(catalog,snapshot,{options,evaluate:({equipment,visionId})=>({score:
    (equipment.weaponId===10?100:0)+(visionId>0?10:0)})});
  assert.ok(result.results.length);
  for(const party of result.results) {
    assert.equal(S.validateParty(catalog,snapshot,party.members,{partySize:4}),'');
    assert.equal(party.members.filter(m=>m.equipment.weaponId===10).length,1);
    const assigned=party.members.map(m=>m.visionId).filter(id=>id>0);
    assert.equal(new Set(assigned).size,assigned.length);
  }
  assert.equal(result.results[0].score,140);
  assert.equal(result.baseline.valid,true);
  assert.equal(result.baseline.score,40);
});
test('role constraints retain a low personal-damage healer instead of choosing four attackers',()=>{
  const {catalog,snapshot}=fixture(5);
  const result=S.rankParties(catalog,snapshot,{options:{...options,minHealers:1},
    evaluate:({characterId,visionId})=>({score:characterId===5?0:100,canHeal:characterId===5,healing:characterId===5?50:0})});
  assert.ok(result.results.length);
  for(const party of result.results)assert.ok(party.members.some(m=>m.characterId===5 && m.roles.includes('healer')));
  assert.equal(result.results[0].score,300);
});
test('retains a nearly-best weapon alternative when a stronger weapon has only one copy',()=>{
  const {catalog,snapshot}=fixture(2);
  catalog.equipment.push({id:11,name:'Alternative',type:'Weapon',detailType:'Sword',sexLimit:'None',stats:{PhysicalAttack:9}});
  snapshot.inventory.push({id:11,quantity:1});
  const result=S.rankParties(catalog,snapshot,{options:{...options,partySize:2,candidatesPerVision:1},
    evaluate:({equipment})=>({score:equipment.weaponId===10?100:equipment.weaponId===11?99:0})});
  assert.equal(result.results[0].score,199);
});
test('party callback scores support synergy instead of summing only individual attack scores',()=>{
  const {catalog,snapshot}=fixture(5);
  const result=S.rankParties(catalog,snapshot,{options,
    evaluate:({characterId})=>({score:characterId===5?0:10,supportScore:characterId===5?1:0}),
    evaluateParty:members=>({score:members.reduce((n,m)=>n+m.score,0)*(members.some(m=>m.characterId===5)?2:1)})});
  assert.ok(result.results[0].members.some(m=>m.characterId===5));
  assert.equal(result.results[0].score,60);
});
test('cannot borrow equipment reserved on recruited characters outside a chosen party',()=>{
  const {catalog,snapshot}=fixture(5);
  snapshot.characters[4].equipment.weaponId=10;
  const result=S.rankParties(catalog,snapshot,{options:{...options,reserveNonParty:true,fixedCharacterIds:[1,2,3,4]},
    evaluate:({equipment})=>({score:equipment.weaponId===10?100:1})});
  assert.ok(result.results.length);
  assert.equal(result.results[0].members.some(m=>m.equipment.weaponId===10),false);
});
test('invalid evaluator output is excluded, unknown IDs stay excluded and budget limits are explicit',()=>{
  const {catalog,snapshot}=fixture();
  snapshot.resonances.push({id:999});snapshot.inventory.push({id:999,quantity:99});
  const result=S.rankParties(catalog,snapshot,{options:{...options,perLoadoutBudget:2,beamWidth:3},
    evaluate:({visionId})=>visionId===100?{score:NaN}:{score:1}});
  assert.ok(result.approximate);
  assert.ok(result.reasons.includes('loadout budget'));
  for(const party of result.results)for(const member of party.members){
    assert.notEqual(member.visionId,999);
    assert.equal([member.equipment.weaponId,member.equipment.armorId,...member.equipment.accessoryIds].includes(999),false);
  }
});
test('fills slots that later members would otherwise leave empty from leftover stock',()=>{
  const {catalog,snapshot}=fixture();
  const result=S.rankParties(catalog,snapshot,{options:{...options,candidatesPerVision:1},
    evaluate:({equipment})=>({score:equipment.weaponId===10?100:0})});
  for(const party of result.results) {
    assert.equal(S.validateParty(catalog,snapshot,party.members,{partySize:4}),'');
    for(const m of party.members) {
      assert.equal(m.equipment.armorId,20);
      assert.ok(m.equipment.accessoryIds.every(id=>id>0));
    }
  }
});

test('single-character finalization fills neutral accessories left empty by a score tie',()=>{
  const {catalog,snapshot}=fixture(1);
  const callbacks={evaluate:()=>({score:10,damage:10,equippedSkillIds:[500]})};
  const candidates=S.buildCandidates(catalog,snapshot,1,callbacks,options).sort((a,b)=>b.score-a.score);
  assert.ok(candidates[0].equipment.accessoryIds.some(id=>id<0),'fixture reproduces the bounded search result');
  const [result]=S.finalizeBuilds(catalog,snapshot,[candidates[0]],S.inventory(snapshot),callbacks);
  assert.ok(result.equipment.accessoryIds.every(id=>id>0));
  assert.equal(result.gearReasons.filter(r=>r.slot==='accessory').every(r=>r.reason==='neutral-model'),true);
  assert.equal(S.validateParty(catalog,snapshot,[result],{partySize:1}),'');
});

test('finalization respects reserved stock and explains unavailable accessory copies',()=>{
  const {catalog,snapshot}=fixture(1);
  const stock=new Map([[10,1],[20,1],[30,0],[31,0],[32,1]]);
  const callbacks={evaluate:()=>({score:10})};
  const candidate=S.buildCandidates(catalog,snapshot,1,callbacks,options,stock)[0];
  const [result]=S.finalizeBuilds(catalog,snapshot,[candidate],stock,callbacks);
  assert.equal(result.equipment.accessoryIds.filter(id=>id>0).length,1);
  assert.equal(result.gearReasons.find(r=>r.slot==='accessory' && r.status==='empty').reason,'reserved-or-used');
});

test('empty-slot finalization cannot lower the party score or remove a required role',()=>{
  const {catalog,snapshot}=fixture(1);
  const callbacks={evaluate:({equipment})=>({score:10,canHeal:equipment.armorId<0}),
    evaluateParty:members=>({score:members.some(m=>m.equipment.accessoryIds.some(id=>id>0))?5:10})};
  const candidate=S.buildCandidates(catalog,snapshot,1,callbacks,options).find(c=>c.equipment.armorId<0 && c.equipment.accessoryIds.every(id=>id<0));
  const [result]=S.finalizeBuilds(catalog,snapshot,[candidate],S.inventory(snapshot),callbacks);
  assert.equal(result.equipment.armorId,-1);
  assert.ok(result.equipment.accessoryIds.every(id=>id<0));
  assert.equal(result.gearReasons.find(r=>r.slot==='armor').reason,'preserves-role');
  assert.equal(result.gearReasons.find(r=>r.slot==='accessory').reason,'lowers-model');
});

test('gear explanations hold equipped abilities fixed and do not invent deltas for unsupported probes',()=>{
  const {catalog,snapshot}=fixture(1);
  const seen=[];
  const callbacks={evaluate:args=>{
    seen.push(args);
    if(args.equippedSkillIds && args.equipment.weaponId<0)return {valid:false};
    return {score:10+(args.equipment.weaponId===10?5:0),damage:10,equippedSkillIds:[500]};
  }};
  const candidate=S.buildCandidates(catalog,snapshot,1,callbacks,options).sort((a,b)=>b.score-a.score)[0];
  const [result]=S.finalizeBuilds(catalog,snapshot,[candidate],S.inventory(snapshot),callbacks);
  const weapon=result.gearReasons.find(r=>r.slot==='weapon');
  assert.equal(weapon.reason,'required-for-evaluation');
  assert.equal(weapon.damageDelta,undefined);
  assert.ok(seen.some(args=>args.equippedSkillIds?.[0]===500));
});

test('completion does not silently fill an accessory whose effects cannot be evaluated',()=>{
  const {catalog,snapshot}=fixture(1);
  snapshot.inventory=snapshot.inventory.filter(item=>item.id===30);
  const callbacks={evaluate:({equipment})=>({score:10,passiveAnalysis:{unsupported:equipment.accessoryIds.includes(30)?[{passiveId:1,reason:'Unknown effect.'}]:[]}})};
  const candidate=S.buildCandidates(catalog,snapshot,1,callbacks,options).find(c=>c.equipment.accessoryIds.every(id=>id<0));
  const [result]=S.finalizeBuilds(catalog,snapshot,[candidate],S.inventory(snapshot),callbacks);
  assert.ok(result.equipment.accessoryIds.every(id=>id<0));
  assert.ok(result.gearReasons.filter(r=>r.slot==='accessory').every(r=>r.reason==='unsupported'));
});

test('party startup preserves saved setups without an unbounded alternative-Resonance sweep',()=>{
  const {catalog,snapshot}=fixture();
  const seen=[],originalNow=Date.now;
  let tick=0;
  try{
    Date.now=()=>tick++*100;
    S.rankParties(catalog,snapshot,{options:{...options,timeMs:1,perLoadoutBudget:0,maxResults:1},evaluate:input=>{
      seen.push(input);return {valid:true,score:1};
    }});
  }finally{Date.now=originalNow;}
  assert.deepEqual(seen.slice(0,4).map(input=>input.characterId),[1,2,3,4]);
  assert.ok(seen.every(input=>input.visionId===snapshot.characters.find(c=>c.id===input.characterId).equipment.visionId));
});
// A fake clock: each call advances it, so time budgets are exercised deterministically.
function withClock(fn){
  const originalNow=Date.now;let clock=0;
  try{Date.now=()=>clock;return fn(ms=>{clock+=ms;});}finally{Date.now=originalNow;}
}
test('a slow party simulation cannot run the search past its party time budget',()=>withClock(tick=>{
  const {catalog,snapshot}=fixture(6);
  let simulations=0;
  S.rankParties(catalog,snapshot,{options:{...options,timeMs:1000,partyTimeMs:1000},evaluate:({characterId})=>({score:characterId}),
    evaluateParty:members=>{simulations++;tick(100);return {score:members.reduce((sum,m)=>sum+m.score,0)};}});
  // Ten simulations fit the budget; the rest are the re-scored finalists and their slot completion.
  assert.ok(simulations<500,`${simulations} party simulations`);
}));
test('teams ranked after the party time budget are still compared, so the strongest team can win',()=>withClock(tick=>{
  const {catalog,snapshot}=fixture(6);
  const result=S.rankParties(catalog,snapshot,{options:{...options,timeMs:1000,partyTimeMs:1000},evaluate:({characterId})=>({score:characterId}),
    evaluateParty:members=>{tick(100);return {score:members.reduce((sum,m)=>sum+m.score,0)};}});
  assert.deepEqual(result.results[0].members.map(m=>m.characterId).sort(),[3,4,5,6]);
}));
test('a candidate time budget spent on the first characters does not limit the search to the first team',()=>withClock(tick=>{
  const {catalog,snapshot}=fixture(6);
  const result=S.rankParties(catalog,snapshot,{options:{...options,timeMs:40},evaluate:({characterId})=>{tick(1);return {score:characterId};}});
  assert.deepEqual(result.results[0].members.map(m=>m.characterId).sort(),[3,4,5,6]);
}));
test('every character gets a share of the candidate time budget',()=>withClock(tick=>{
  const {catalog,snapshot}=fixture(6);
  const explored=new Set();
  S.rankParties(catalog,snapshot,{options:{...options,timeMs:60},evaluate:({characterId,equipment})=>{
    tick(1);if(equipment.weaponId>0)explored.add(characterId);return {score:characterId};}});
  assert.deepEqual([...explored].sort(),[1,2,3,4,5,6]);
}));
test('party search reports progress while it runs',()=>{
  const {catalog,snapshot}=fixture(5);
  const messages=[];
  S.rankParties(catalog,snapshot,{options,progress:message=>messages.push(message),evaluate:({characterId})=>({score:characterId})});
  assert.deepEqual([messages[0],messages.at(-1)],['Building C1’s options (1 of 5)…','Finishing the top parties…']);
});
test('the search ranks parties on a few samples and scores every party it shows on all of them',()=>{
  const {catalog,snapshot}=fixture(5);
  const requested=[];
  const result=S.rankParties(catalog,snapshot,{options,evaluate:({characterId})=>({score:characterId}),
    evaluateParty:(members,{samples}={})=>{requested.push(samples);return {score:members.reduce((sum,m)=>sum+m.score,0),samples:samples ?? 'all'};}});
  assert.deepEqual([requested.includes(4),result.results.map(r=>r.evaluation.samples)],[true,['all','all','all']]);
});

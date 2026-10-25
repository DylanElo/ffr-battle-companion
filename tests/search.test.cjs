const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../docs/search.js');

function fixture(n=4) {
  return {
    catalog:{characters:Array.from({length:n},(_,i)=>({id:i+1,sex:'Male',weaponType:'Sword',armorTypes:['Light']})),
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

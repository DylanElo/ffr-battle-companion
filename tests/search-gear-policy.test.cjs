const test=require('node:test'),assert=require('node:assert/strict');
const Search=require('../docs/search.js'),C=require('../docs/core.js');
function fixture(){
  const equipment=[{id:1,type:'Weapon',detailType:'Staff',stats:{MagicalAttack:10}},
    {id:2,type:'Armor',detailType:'Robe',stats:{MagicalDefense:20}},
    {id:3,type:'Accessory',stats:{HitPoint:100}},{id:4,type:'Accessory',stats:{HitPoint:50}}];
  const characters=[1,2].map(id=>({id,sex:'Female',weaponType:'Staff',armorTypes:['Robe'],stats:{Intelligence:30,Attack:5}}));
  const snapshot={characters:characters.map(({id})=>({id,joinStatus:'Join',usable:true,equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1],visionId:100}})),inventory:equipment.map(({id})=>({id,quantity:1})),resonances:[{id:100}]};
  return {catalog:{characters,equipment,visions:[{id:100,attackType:'Magic'}]},snapshot};
}
const options={jointOptimization:true,visionIds:[100],goals:['damage'],maxEvaluations:1,timeMs:0,partySize:1};
test('one evaluation publishes a fully scored mage seed including damage-neutral armor and accessory',()=>{
  const {catalog,snapshot}=fixture(),checkpoints=[];
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>({valid:true,score:equipment.weaponId===1?10:0}),candidate:c=>checkpoints.push(c)},options);
  assert.equal(results.length,1);assert.equal(checkpoints.length,1);
  assert.deepEqual(results[0].equipment,{weaponId:1,armorId:2,accessoryIds:[3],visionId:100});
  assert.equal(results[0].score,10);
});
test('a completed seed survives the deadline without a later unscored gear fill',()=>{
  const {catalog,snapshot}=fixture(),original=Date.now;let now=0,calls=0;
  try{Date.now=()=>now;
    const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:()=>{calls++;now=10;return {valid:true,score:10};}}, {...options,maxEvaluations:10,deadline:5});
    assert.equal(calls,1);assert.equal(C.equipmentIds(results[0].equipment).length,3);
  }finally{Date.now=original;}
});
test('a one-evaluation mage seed prefers stronger neutral defense over a low item ID',()=>{
  const {catalog,snapshot}=fixture();
  catalog.equipment.push({id:9,type:'Armor',detailType:'Robe',stats:{MagicalDefense:100}});
  snapshot.inventory.push({id:9,quantity:1});
  const [result]=Search.buildCandidates(catalog,snapshot,1,{evaluate:()=>({valid:true,score:10})},options);
  assert.equal(result.equipment.armorId,9);
});
test('sequential builds use only stock remaining after the first kept plan',()=>{
  const {catalog,snapshot}=fixture(),evaluate=()=>({valid:true,score:10});
  const first=Search.buildCandidates(catalog,snapshot,1,{evaluate},options)[0];
  const stock=C.stock(snapshot,2,{1:first.equipment},false);
  const second=Search.buildCandidates(catalog,snapshot,2,{evaluate},{...options,visionIds:[-1]},stock)[0];
  assert.equal(second.equipment.weaponId,-1);assert.equal(second.equipment.armorId,-1);
  assert.deepEqual(second.equipment.accessoryIds,[4]);
  assert.equal(C.validPlan(catalog,snapshot,2,second.equipment,{1:first.equipment},false),'');
});
test('gear fill wins equal-score equal-AP ties, while lower AP remains the earlier preference',()=>{
  const bare={score:10,key:'-1',equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1]},evaluation:{skillCost:5}};
  const filled={...bare,key:'1',equipment:{weaponId:1,armorId:2,accessoryIds:[3]}};
  assert.ok(Search.compareCandidates(filled,bare)<0);
  assert.ok(Search.compareCandidates({...filled,evaluation:{skillCost:6}},bare)>0);
  assert.ok(Search.compareCandidates({...filled,key:'9',evaluation:{skillCost:5,durability:100}},
    {...filled,key:'1',evaluation:{skillCost:5,durability:10}})<0);
});

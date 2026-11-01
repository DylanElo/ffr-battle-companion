const test=require('node:test'),assert=require('node:assert/strict');
const Search=require('../docs/search.js');
const item=(id,stats,passiveIds=[])=>({id,type:'Accessory',detailType:'None',sexLimit:'None',stats,passiveIds});
function run(items,options={},score=ids=>ids.includes(1)?10:0){
  const catalog={characters:[{id:1,sex:'Male',weaponType:'Sword',armorTypes:[],stats:{Attack:30,Intelligence:10}}],
    visions:[{id:100,attackType:'Physic'}],skills:[{id:10,calcType:'Magic',cost:0},{id:11,calcType:'Physic',cost:0}],equipment:items};
  const snapshot={characters:[{id:1,joinStatus:'Join',usable:true,equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1],visionId:100}}],
    inventory:items.map(x=>({id:x.id,quantity:1})),resonances:[{id:100}]};
  const seen=[];
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{seen.push(equipment.accessoryIds[0]);return {valid:true,score:score(equipment.accessoryIds)};}},
    {visionIds:[100],goals:['damage'],partySize:1,timeMs:0,maxEvaluations:2,perLoadoutBudget:100,candidatesPerVision:10,...options});
  return {seen,results};
}
test('a tight damage budget reaches relevant ATK before a much larger irrelevant MP bonus',()=>{
  const {seen,results}=run([item(1,{PhysicalAttack:20}),item(2,{MagicPoint:900})]);
  assert.deepEqual(seen,[-1,1]);assert.equal(Math.max(...results.map(x=>x.score)),10);
});
test('a selected magic action orders MAG/INT ahead of physical gear',()=>{
  assert.deepEqual(run([item(1,{Intelligence:20}),item(2,{PhysicalAttack:900})],{actionId:10}).seen,[-1,1]);
  assert.deepEqual(run([item(1,{MagicalAttack:20}),item(2,{PhysicalAttack:900})],{actionId:10}).seen,[-1,1]);
});
test('a selected physical action overrides native or magical stat magnitude',()=>{
  assert.deepEqual(run([item(1,{Attack:20}),item(2,{MagicalAttack:900})],{actionId:11}).seen,[-1,1]);
});
test('HP requirements bring HP gear ahead of unrelated MP',()=>{
  assert.deepEqual(run([item(1,{HitPoint:200}),item(2,{MagicPoint:900})],{requirements:{minHp:500}}).seen,[-1,1]);
});
test('survival and durability goals consider defensive dependencies',()=>{
  for(const options of [{requirements:{survive:true}},{goals:['durability']}])
    assert.deepEqual(run([item(1,{MagicalDefense:20}),item(2,{MagicPoint:900})],options).seen,[-1,1]);
});
test('negative relevant stats do not earn magnitude priority',()=>{
  assert.deepEqual(run([item(1,{PhysicalAttack:2}),item(2,{PhysicalAttack:-900})]).seen,[-1,1]);
});
test('ordering retains conditional, inverse-stat and element enabling sources for complete scoring',()=>{
  const items=[item(1,{PhysicalAttack:10}),item(2,{PhysicalAttack:-100},[55]),item(3,{MagicPoint:1000})];
  const {seen,results}=run(items,{maxEvaluations:100,requirements:{element:'Fire'}},ids=>ids.includes(2)?100:0);
  assert.deepEqual(new Set(seen),new Set([-1,1,2,3]));assert.equal(Math.max(...results.map(x=>x.score)),100);
});

test('completed build ties prefer lower AP before stable equipment identity',()=>{
  const expensive={score:10,key:'a',evaluation:{skillCost:100}},cheap={score:10,key:'z',evaluation:{skillCost:20}};
  assert.ok(Search.compareCandidates(cheap,expensive)<0);
  assert.ok(Search.compareCandidates({...expensive,score:11},cheap)<0);
  assert.ok(Search.compareCandidates({...cheap,key:'a'},cheap)<0);
});

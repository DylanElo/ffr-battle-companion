const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/core.js');

function fixture() {
  const equipment = [
    {id:101,name:'Sword',type:'Weapon',detailType:'Sword',sexLimit:'None',stats:{PhysicalAttack:40}},
    {id:102,name:'Staff',type:'Weapon',detailType:'Staff',sexLimit:'None',stats:{MagicalAttack:99}},
    {id:201,name:'Armor',type:'Armor',detailType:'HeavyArmor',sexLimit:'None',stats:{PhysicalDefense:30,HitPoint:100}},
    {id:301,name:'Strong ring',type:'Accessory',detailType:'Accessory',sexLimit:'None',stats:{PhysicalAttack:20}},
    {id:302,name:'Spare ring',type:'Accessory',detailType:'Accessory',sexLimit:'None',stats:{PhysicalAttack:10}},
    {id:303,name:'Female only ring',type:'Accessory',detailType:'Accessory',sexLimit:'Female',stats:{PhysicalAttack:999}},
  ];
  const gear = {weaponId:101,armorId:201,accessoryIds:[301,302],visionId:13001};
  const catalog = {equipment,characters:[{id:1001,sex:'Male',weaponType:'Sword',armorTypes:['HeavyArmor']}],visions:[],skills:[]};
  const snapshot = {
    inventory:[{id:101,quantity:1},{id:102,quantity:1},{id:201,quantity:2},{id:301,quantity:1},{id:302,quantity:2},{id:303,quantity:1}],
    characters:[
      {id:1001,joinStatus:'eUnitJoinStatus::Join',usable:true,equipment:gear},
      {id:1002,joinStatus:'eUnitJoinStatus::Join',usable:true,equipment:{weaponId:102,armorId:201,accessoryIds:[302],visionId:13002}},
      {id:1003,joinStatus:'eUnitJoinStatus::NotJoin',usable:true,equipment:gear},
    ],
    resonances:[{id:13001,awakeningPoints:1,sync:[{characterId:1001,points:9},{characterId:1002,points:10}]}],
  };
  return {catalog,snapshot};
}

test('stock treats inventory as totals, reserves other available characters, ignores locked defaults',()=>{
  const {snapshot} = fixture();
  const stock=core.stock(snapshot,1001,{},true);
  assert.equal(stock.get(101),1);
  assert.equal(stock.get(201),1);
  assert.equal(stock.get(301),1);
  assert.equal(stock.get(302),1);
  assert.equal(stock.get(102),0);
});

test('staged plans replace previous equipment reservations even when unstaged reservations are released',()=>{
  const {snapshot} = fixture();
  const staged={1002:{weaponId:-1,armorId:-1,accessoryIds:[301],visionId:-1}};
  const stock=core.stock(snapshot,1001,staged,false);
  assert.equal(stock.get(301),0);
  assert.equal(stock.get(302),2);
  assert.equal(stock.get(201),2);
});

test('recommend respects item categories, sex restrictions and finite accessory copies',()=>{
  const {catalog,snapshot}=fixture();
  const plan=core.recommend(catalog,snapshot,1001,'physical');
  assert.equal(plan.weaponId,101);
  assert.deepEqual(plan.accessoryIds,[301,302]);
  assert.equal(core.validPlan(catalog,snapshot,1001,plan),'');
  assert.match(core.validPlan(catalog,snapshot,1001,{...plan,accessoryIds:[301,301]}),/copy/i);
  assert.match(core.validPlan(catalog,snapshot,1001,{...plan,accessoryIds:[303,302]}),/compatible/i);
});

test('durability goal recognizes native PhysicalDefense and HitPoint item keys',()=>{
  assert.equal(core.score({stats:{PhysicalDefense:30,HitPoint:100}},'physicalTank'),32);
});

test('mastery uses source point thresholds and per-character sync, not stage count or max awakening',()=>{
  const {snapshot}=fixture();
  const vision={id:13001,awakening:[
    {level:0,masteryPoint:0,grants:[{type:'ActiveSkill',id:1}]},
    {level:1,masteryPoint:1,grants:[{type:'ActiveSkill',id:2}]},
    {level:2,masteryPoint:2,grants:[{type:'ActiveSkill',id:3}]},
  ],synchro:[
    {level:1,masteryPoint:10,grants:[{type:'ActiveSkill',id:4}]},
    {level:2,masteryPoint:35,grants:[{type:'ActiveSkill',id:5}]},
  ],baseSkillIds:[99]};
  const catalog={skills:[1,2,3,4,5,99].map(id=>({id}))};
  assert.deepEqual(core.accessibleSkills(vision,snapshot.resonances[0],1001,catalog).map(s=>s.id),[1,2]);
  assert.deepEqual(core.accessibleSkills(vision,snapshot.resonances[0],1002,catalog).map(s=>s.id),[1,2,4]);
  assert.deepEqual(core.accessibleSkills(vision,null,1002,catalog),[]);
});

test('encounter helper warns about native Halved, Invalid and Absorb elemental resistances',()=>{
  const {snapshot}=fixture();
  const vision={id:13001,name:'Test',awakening:[{level:0,masteryPoint:0,grants:[{type:'ActiveSkill',id:1},{type:'ActiveSkill',id:2}]}]};
  const catalog={visions:[vision],skills:[{id:1,mag:20,element:'Fire',relation:'Enemies'},{id:2,mag:20,element:'Ice',relation:'Enemies'}]};
  const result=core.encounterOptions(catalog,snapshot,{resistances:{Fire:'Halved',Ice:'Weakness'}},1001)[0];
  assert.deepEqual(result.matches.map(s=>s.id),[2]);
  assert.deepEqual(result.risky.map(s=>s.id),[1]);
});

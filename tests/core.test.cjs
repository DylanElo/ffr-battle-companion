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

test('priority goals balance stats by their own equipment range',()=>{
  const catalog={equipment:[{id:1,stats:{PhysicalAttack:100}},{id:2,stats:{PhysicalDefense:50}},{id:3,stats:{PhysicalAttack:50,PhysicalDefense:25}}]};
  const goal=core.priorityGoal(catalog,['PhysicalAttack','PhysicalDefense']);
  // Each top piece scores 100; a half-strength hybrid ties with neither.
  assert.equal(core.score(catalog.equipment[0],goal),100);
  assert.equal(core.score(catalog.equipment[1],goal),100);
  assert.equal(core.score(catalog.equipment[2],goal),100);
  assert.equal(core.score({stats:{PhysicalAttack:40}},'physical'),40);
});

test('kit profile follows the skills the character can use, plus their role',()=>{
  const skill=(id,calcType,relation,dir,mag)=>({id,calcType,relation,parameterType:'HitPoint',parameterVariationType:dir,mag,hits:1});
  const slash=skill(1,'Physic','Enemies','Decrease',300),fire=skill(2,'Magic','Enemies','Decrease',100),cure=skill(3,'Magic','Friendlies','Increase',200);
  // A Defender's spare heal doesn't pull them towards Magic.
  const rain=core.kitProfile([slash,cure],{roles:['Defender'],stats:{Attack:35,Intelligence:16}});
  assert.deepEqual(rain.keys,['PhysicalAttack','PhysicalDefense','MagicalDefense']);
  assert.equal(rain.healSkills,1);
  // A Healer's heals count, and scale on Magic like her spells.
  const fina=core.kitProfile([slash,fire,cure],{roles:['Healer'],stats:{Attack:25,Intelligence:15}});
  assert.deepEqual(fina.keys,['PhysicalAttack','MagicalAttack','MagicalDefense','HitPoint']);
  const none=core.kitProfile([],{roles:['Attacker'],stats:{Attack:18,Intelligence:40}});
  assert.deepEqual(none.keys,['MagicalAttack']);
});

test('resonance fit counts only skills in the stats being geared for',()=>{
  const skill=(calcType,relation,dir,mag,hits=1)=>({calcType,relation,parameterType:'HitPoint',parameterVariationType:dir,mag,hits});
  const slash=skill('Physic','Enemies','Decrease',100,3),fire=skill('Magic','Enemies','Decrease',250),cure=skill('Magic','Friendlies','Increase',200);
  assert.deepEqual(core.resonanceFit([slash,fire,cure],['PhysicalAttack','PhysicalDefense'],false),{fit:300,attacks:1});
  assert.deepEqual(core.resonanceFit([slash,fire,cure],['MagicalAttack'],false),{fit:250,attacks:1});
  assert.deepEqual(core.resonanceFit([slash,fire,cure],['MagicalAttack'],true),{fit:450,attacks:1});
  assert.equal(core.resonanceFit([slash],['HitPoint'],false).fit,0);
});

test('resonance facts tag breaks, statuses and support with the right targets',()=>{
  const effects=[{id:1,type:'DamageMultiplier',status:'AttackDown'},{id:2,type:'ParameterVariation',status:'Regene'},{id:3,type:'Revival',status:'None'}];
  const b=(effectId,TargetType,targetRelation='Friendlies')=>({effectId,TargetType,targetRelation});
  const wave={id:10,calcType:'Physic',element:'Light',target:'Group',relation:'Enemies',parameterType:'HitPoint',parameterVariationType:'Decrease',mag:150,
    effectBundles:[b(1,'SkillTarget'),b(2,'Self'),b(-1,'Self')]};
  const raise={id:11,calcType:'None',target:'Single',relation:'Friendlies',mag:0,effectBundles:[b(3,'SkillTarget')]};
  const catalog={effects,skills:[wave,raise],passives:[]};
  const vision={id:9,finishBlow:0,skillIds:[],passiveIds:[],awakening:[{level:0,requiredPoints:0,grants:[{type:'ActiveSkill',id:10}]}],synchro:[{level:3,requiredPoints:40,grants:[{type:'ActiveSkill',id:11}]}]};
  const facts=core.resonanceFacts(catalog,vision);
  const tags=facts.map(f=>`${f.tag}@${f.target}`).sort();
  assert.deepEqual(tags,['damage@enemies','down:ATK@enemies','regen@self','revive@ally']);
  assert.deepEqual(facts.find(f=>f.tag==='revive').unlock,{kind:'Sync',required:40});
  // ATK down on all enemies from a physical skill matches; on a single enemy it doesn't.
  assert.ok(core.matchFacts(facts,{tags:['down:ATK'],targets:['enemies'],calcs:['Physic']}));
  assert.equal(core.matchFacts(facts,{tags:['down:ATK'],targets:['enemy']}),null);
  // Every chosen effect must be present; damage filters alone look at damage skills.
  assert.equal(core.matchFacts(facts,{tags:['down:ATK','cure']}),null);
  assert.ok(core.matchFacts(facts,{elements:['Light']}));
  assert.equal(core.matchFacts(facts,{calcs:['Magic']}),null);
});

test('emptyLocks has one unpinned entry per accessory slot',()=>{
  assert.deepEqual(core.emptyLocks(2),{vision:false,weapon:false,armor:false,accessories:[false,false],skillIds:[]});
  assert.deepEqual(core.emptyLocks(0).accessories,[]);
});

test('lockedPieces keeps only locked, set pieces; a locked empty slot is not a pin',()=>{
  const plan={visionId:13001,weaponId:101,armorId:-1,accessoryIds:[301,-1],equippedSkillIds:[5,6]};
  const locks={vision:true,weapon:true,armor:true,accessories:[false,true],skillIds:[6,9]};
  assert.deepEqual(core.lockedPieces({...plan,locks}),{visionId:13001,weaponId:101,armorId:null,accessoryIds:[],skillIds:[6]});
  assert.deepEqual(core.lockedPieces({...plan,accessoryIds:[301,302],locks}).accessoryIds,[302]);
  assert.deepEqual(core.lockedPieces({...plan,locks:core.emptyLocks(2)}),{visionId:null,weaponId:null,armorId:null,accessoryIds:[],skillIds:[]});
});

test('checkLocks reports a pin whose only copy another plan holds, and passes a free item',()=>{
  const {catalog,snapshot}=fixture();
  const locks={...core.emptyLocks(2),weapon:true};
  const plan=w=>({weaponId:w,armorId:-1,accessoryIds:[-1,-1],visionId:-1,locks});
  assert.equal(core.checkLocks(catalog,snapshot,1001,plan(101),{},true),'');
  const others={1002:{weaponId:101,armorId:-1,accessoryIds:[-1],visionId:-1}};
  assert.equal(core.checkLocks(catalog,snapshot,1001,plan(101),others,true),'No unreserved copy of Sword.');
});

test('checkLocks works for a character with no accessory slots',()=>{
  const {catalog,snapshot}=fixture();
  snapshot.characters[0].equipment={...snapshot.characters[0].equipment,accessoryIds:[]};
  const plan={weaponId:101,armorId:-1,accessoryIds:[],visionId:-1,locks:{...core.emptyLocks(0),weapon:true}};
  assert.equal(core.checkLocks(catalog,snapshot,1001,plan,{},true),'');
});

test('withLocks adds unpinned locks without touching existing ones',()=>{
  const b={weaponId:1,accessoryIds:[2]};
  assert.deepEqual(core.withLocks(b,1).locks,core.emptyLocks(1));
  const l={...core.emptyLocks(1),weapon:true};
  assert.equal(core.withLocks({...b,locks:l},1).locks,l);
  assert.equal(b.locks,undefined);
});

test('searchOptionsFor pins the Resonance only when it is pinned and set',()=>{
  const plan={weaponId:101,armorId:-1,visionId:13001,accessoryIds:[-1],equippedSkillIds:[],locks:{vision:true,weapon:true,armor:false,accessories:[false],skillIds:[]}};
  assert.deepEqual(core.searchOptionsFor(plan).visionIds,[13001]);
  assert.equal(core.searchOptionsFor(plan).locks.weaponId,101);
  assert.equal(core.searchOptionsFor({...plan,locks:{...plan.locks,vision:false}}).visionIds,null);
  assert.equal(core.searchOptionsFor({...plan,visionId:-1}).visionIds,null);
  assert.equal(core.searchOptionsFor({...plan,locks:undefined}).visionIds,null);
});

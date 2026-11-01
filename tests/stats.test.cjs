const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const Stats=require('../docs/stats.js');

function fixture(){
  const catalog={characters:[{id:1,levelParamId:1,stats:{MaxHitPoint:100,MaxMagicPoint:50,Attack:10,Defence:20,Intelligence:30,Mind:40,Agility:5},baseSkillEquipCost:100,passiveIds:[]}],
    statGrowth:{1:{rows:[{level:1,requiredExperience:0,adds:{},skillIds:[101]},{level:2,requiredExperience:10,adds:{Attack:2,MaxHitPoint:10},skillIds:[102]}]}},
    equipment:[{id:10,stats:{PhysicalAttack:3,MagicalAttack:6,HitPoint:4}},{id:11,stats:{PhysicalDefense:5}}],
    skills:[{id:100},{id:101},{id:102},{id:103}],passives:[{id:200},{id:201}],
    visions:[{id:20,awakening:[{requiredPoints:0,grants:[{type:'ActiveSkill',id:103},{type:'PassiveSkill',id:201}]}],synchro:[{requiredPoints:10,grants:[{type:'BaseParameter',id:1,value:20},{type:'BaseParameter',id:5,value:4},{type:'BaseParameter',id:11,value:5},{type:'ActiveSkill',id:100},{type:'PassiveSkill',id:200}]}]},
      {id:21,synchro:[{requiredPoints:10,grants:[{type:'BaseParameter',id:1,value:30},{type:'BaseParameter',id:11,value:7}]}]}]};
  const snapshot={characters:[{id:1,experience:10,baseParameters:[0,0,0,0,0,1],equippedSkillIds:[200,-1,-1,-1,-1,-1,-1,-1],activeSkillIds:[101],equipment:{weaponId:10,armorId:11,accessoryIds:[],visionId:20}}],
    resonances:[{id:20,awakeningPoints:0,sync:[{characterId:1,points:10}]},{id:21,awakeningPoints:0,sync:[{characterId:1,points:10}]}]};
  return {catalog,snapshot};
}
test('character stats include growth, seed, all owned permanent sync and gear exactly once',()=>{
  const {catalog,snapshot}=fixture(),before=JSON.stringify({catalog,snapshot});
  const result=Stats.characterStats(catalog,snapshot,1);
  assert.equal(result.level,2);
  assert.equal(result.stats.HitPoint,164);
  assert.equal(result.stats.Attack,17);
  assert.equal(result.stats.PhysicalAttack,20);
  assert.equal(result.stats.PhysicalDefense,25);
  assert.equal(result.stats.MagicalAttack,36);
  assert.equal(result.stats.MagicalDefense,40);
  assert.equal(result.stats.Divine,40);
  assert.equal(result.skillBudget,112);
  assert.equal(result.maxSkillSlots,8);
  assert.equal(JSON.stringify({catalog,snapshot}),before);
  assert.equal(Stats.characterStats(catalog,snapshot,1,{weaponId:-1,armorId:-1,accessoryIds:[]}).stats.PhysicalAttack,17,'cache must not retain prior loadout gear');
  assert.equal(Stats.characterStats(catalog,snapshot,1).stats.PhysicalAttack,20);
});

test('buildStats includes innate, Resonance, gear and equipped master passives without double counting',()=>{
  const {catalog,snapshot}=fixture();
  const passive=(id,value)=>({id,name:`Defense ${id}`,effectBundles:[{effectId:id,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit',conditionData:{Condition:'None'}}]});
  catalog.passives=[passive(200,10),passive(201,20),passive(202,30),passive(203,40)];
  catalog.effects=catalog.passives.map((p,i)=>({id:p.id,type:'ParameterContinuousVariation',params:[(i+1)*10,6,2,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],condition:{Condition:'None'},activationProbability:100}));
  catalog.characters[0].passiveIds=[200];
  catalog.equipment[1].passiveIds=[202];
  catalog.masterSkills=[{id:300,grants:{passiveIds:[203]}}];
  snapshot.characters[0].equippedSkillIds=[200,300,-1,-1,-1,-1,-1,-1];
  const result=Stats.buildStats(catalog,snapshot,1);
  assert.equal(result.stats.Defence,40,'base 20 receives each 10/20/30/40 percent effect once');
  assert.equal(result.stats.PhysicalDefense,45,'gear defense remains additive to passive-scaled base defense');
  assert.equal(result.deferredStatEffects.length,1,'The repeated stat effect remains excluded, now with its second source visible');
  assert.match(result.deferredStatEffects[0].reason,/identical-effect stacking has not been verified/);
  const empty=Stats.buildStats(catalog,snapshot,1,{...snapshot.characters[0].equipment,equippedSkillIds:[]});
  assert.equal(empty.stats.Defence,32,'explicit empty abilities removes the master grant but retains always-on effects');
  assert.equal(Stats.buildStats(catalog,snapshot,1).stats.Defence,40,'cache separates equipped ability loadouts');
});

test('buildStats defers combat-conditional stat effects instead of inventing a combat state',()=>{
  const {catalog,snapshot}=fixture();
  catalog.passives=[{id:200,effectBundles:[{effectId:400,TargetType:'Self',targetRelation:'Friendlies',passiveSkillAddTiming:'SpawnUnit',conditionData:{Condition:'HasStatusCondition',param1:123}}]}];
  catalog.effects=[{id:400,type:'ParameterContinuousVariation',params:[50,6,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],condition:{Condition:'None'},activationProbability:100}];
  const result=Stats.buildStats(catalog,snapshot,1);
  assert.equal(result.stats.Defence,20);
  assert.equal(result.deferredStatEffects.length,2,'Both the automatic Sync and equipped references require the missing condition');
  assert.ok(result.deferredStatEffects.every(effect=>/status condition/.test(effect.reason)));
});
test('each effect delta truncates independently and attribute modifiers propagate into derived attack',()=>{
  const {catalog,snapshot}=fixture();
  const percent=Stats.characterStats(catalog,snapshot,1,null,[{kind:'statPercent',parameter:'Attack',value:5},{kind:'statPercent',parameter:'Attack',value:5}]);
  assert.equal(percent.stats.Attack,17,'two .85 deltas truncate separately to zero');
  assert.ok(!percent.warnings.some(w=>/basis.*not yet been verified/.test(w)));
  const flat=Stats.characterStats(catalog,snapshot,1,null,[{kind:'statFlat',parameter:'Attack',value:2.9}]);
  assert.equal(flat.stats.Attack,19);
  assert.equal(flat.stats.PhysicalAttack,22);
});
test('native float32 epsilon and clamped percent basis preserve native reduction rounding',()=>{
  const {catalog,snapshot}=fixture();catalog.characters[0].stats.Attack=93;
  const base=Stats.characterStats(catalog,snapshot,1);
  assert.equal(base.stats.Attack,100);
  const reduced=Stats.characterStats(catalog,snapshot,1,null,[{kind:'statPercent',parameter:'Attack',value:-30}]);
  assert.equal(reduced.stats.Attack,71,'native -29.99999 delta truncates toward zero to -29');
  assert.equal(reduced.stats.PhysicalAttack,74,'derived PhysicalAttack sees current reduced STR');
  const additive=Stats.characterStats(catalog,snapshot,1,null,[{kind:'statPercent',parameter:'Attack',value:10},{kind:'statPercent',parameter:'Attack',value:10}]);
  assert.equal(additive.stats.Attack,120,'same-parameter effects share a basis, not multiplicative compounding');
  const capped=fixture();capped.catalog.characters[0].stats.MaxHitPoint=20000;
  const stat=Stats.characterStats(capped.catalog,capped.snapshot,1,null,[{kind:'statPercent',parameter:'HitPoint',value:-50}]);
  assert.equal(stat.beforeEffects.HitPoint,9999,'percentage basis is capped independently from raw base+additions');
  assert.equal(stat.stats.HitPoint,9999,'final getter adds delta to uncapped raw base before final cap');
});
test('native caps and invalid experience are handled without mutating source',()=>{
  const {catalog,snapshot}=fixture();
  assert.equal(Stats.characterStats(catalog,snapshot,1,null,[{kind:'statFlat',parameter:'HitPoint',value:20000}]).stats.HitPoint,9999);
  assert.equal(Stats.characterStats(catalog,snapshot,1,null,[{kind:'statFlat',parameter:'Attack',value:-20000}]).stats.Attack,0);
  const broken=structuredClone(snapshot);broken.characters[0].experience=-1;
  assert.throws(()=>Stats.characterStats(catalog,broken,1),/experience/);
});
test('learned skills use permanent sync and equipped Resonance grants require ownership',()=>{
  const {catalog,snapshot}=fixture();
  const pool=Stats.learned(catalog,snapshot,1,20);
  assert.deepEqual(pool.freeActiveIds,[101,103,100]);
  assert.deepEqual(pool.learnedActiveIds.sort(),[100,101,102]);
  assert.deepEqual(pool.alwaysPassiveIds,[201,200]);
  assert.deepEqual(pool.learnedPassiveIds,[200]);
  assert.equal(pool.skillBudget,112);
  const absent=Stats.learned(catalog,snapshot,1,999);
  assert.deepEqual(absent.freeActiveIds,[101]);
  assert.ok(absent.warnings.some(w=>/not owned/.test(w)));
});

test('equipped Terra automatically grants reached Sync active and passive milestones',()=>{
  // Native1452510D0/14524FDE0 gather equipped Vision Sync types2/1 through145021000.
  // Reflected eVisionMasteryParameterType: ActiveSkill1,PassiveSkill2,MasterSkill4.
  const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/data/catalog.json'),'utf8'));
  const terra=source.visions.find(v=>v.id===13108);
  assert.ok(terra);
  for(const [points,expectedPassives,expectedActive] of [
    [0,[],[]],[9,[],[]],[10,[1430],[]],[94,[1430],[]],
    [95,[1430],[400660]],[434,[1430],[400660]],
    [435,[1430,1000],[400660]],[1545,[1430,1000,1332],[400660]],
    [5095,[1430,1000,1332,1047],[400660]],
  ]){
    const {catalog,snapshot}=fixture();
    catalog.visions=[{...terra,awakening:[]}];
    catalog.masterSkills=[{id:1310800,grants:{passiveIds:[2999]}}];
    snapshot.resonances=[{id:13108,sync:[{characterId:1,points}]}];
    snapshot.characters[0].equipment.visionId=13108;
    snapshot.characters[0].equippedSkillIds=[];
    const before=JSON.stringify({catalog,snapshot});
    const pool=Stats.learned(catalog,snapshot,1,13108);
    assert.deepEqual(pool.alwaysPassiveIds,expectedPassives,`Sync points ${points}`);
    assert.deepEqual(pool.freeActiveIds,[101,...expectedActive],`Sync points ${points}`);
    assert.ok(!pool.alwaysPassiveIds.includes(1310800),'MasterSkill milestone does not expand its bundle automatically');
    assert.ok(!pool.alwaysPassiveIds.includes(2999),'a MasterSkill bundle does not contribute extra automatic passives');
    assert.equal(JSON.stringify({catalog,snapshot}),before);
  }
});

test('automatic Sync grants require current ownership and this character milestone record',()=>{
  for(const mode of ['otherVision','unowned','unknown','otherCharacter','missingRecord','belowThreshold']){
    const {catalog,snapshot}=fixture();
    catalog.visions[0].awakening=[];
    let visionId=20;
    if(mode==='otherVision')visionId=21;
    if(mode==='unowned')snapshot.resonances=snapshot.resonances.filter(v=>v.id!==20);
    if(mode==='unknown')visionId=999;
    if(mode==='otherCharacter')snapshot.resonances[0].sync=[{characterId:2,points:100}];
    if(mode==='missingRecord')snapshot.resonances[0].sync=[];
    if(mode==='belowThreshold')snapshot.resonances[0].sync[0].points=9;
    const pool=Stats.learned(catalog,snapshot,1,visionId);
    assert.deepEqual(pool.freeActiveIds,[101],mode);
    assert.deepEqual(pool.alwaysPassiveIds,[],mode);
    if(mode==='otherVision'){
      assert.ok(pool.learnedActiveIds.includes(100),'all-owned learned abilities remain equipable');
      assert.ok(pool.learnedPassiveIds.includes(200));
    }
  }
  const {catalog,snapshot}=fixture();
  catalog.visions[0].awakening=[];
  catalog.visions[0].synchro=[{requiredPoints:0,grants:[{type:'PassiveSkill',id:200}]}];
  snapshot.resonances[0].sync=[];
  assert.deepEqual(Stats.learned(catalog,snapshot,1,20).alwaysPassiveIds,[],'missing Sync record is native−1, not an explicit zero-point record');
  snapshot.resonances[0].sync=[{characterId:1,points:0}];
  assert.deepEqual(Stats.learned(catalog,snapshot,1,20).alwaysPassiveIds,[200],'explicit zero-point record reaches an actual zero-point grant');
});
test('native latest full-health snapshot validates all eight HP values and learned-cost budgets',t=>{
  const root=path.resolve(__dirname,'..'),dll=path.join(root,'importer/bin/Release/net10.0/BattleCompanionImporter.dll');
  if(!fs.existsSync(dll))return t.skip('Local read-only desktop importer is not present in the published site.');
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'docs/data/catalog.json'),'utf8'));
  const snapshot=JSON.parse(cp.execFileSync('dotnet',[dll],{encoding:'utf8'}));
  const expected={1001:[30,2458,236],1002:[30,2058,236],1003:[30,1813,228],1004:[30,1812,236],1005:[27,1451,220],1006:[30,1634,220],1007:[27,1723,220],1008:[33,1643,220]};
  if(snapshot.source.sha256!=='61CD19F6E4262A62E40D27B03A42C50915F49A5C5144582A8A11C4DBADD03C4D')return t.skip('Current save differs from the recorded native full-health evidence snapshot.');
  for(const character of snapshot.characters){
    const stats=Stats.characterStats(catalog,snapshot,character.id);
    assert.deepEqual([stats.level,stats.stats.HitPoint,stats.skillBudget],expected[character.id],`Native comparison ${character.id}`);
    assert.equal(stats.stats.HitPoint,character.hp);
    assert.equal(stats.maxSkillSlots,8);
  }
});

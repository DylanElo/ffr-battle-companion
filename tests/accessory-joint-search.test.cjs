const test=require('node:test'),assert=require('node:assert/strict');
const Search=require('../docs/search.js');
const baseOptions={timeMs:0,maxEvaluations:100000,perLoadoutBudget:100000,candidatesPerVision:20,visionIds:[100],partySize:1};
const accessory=(id,stats={},passiveIds=[])=>({id,name:'Accessory '+id,type:'Accessory',detailType:'None',sexLimit:'None',stats,passiveIds});
function fixture(items,slots=2,quantities={}){
  return {catalog:{characters:[{id:1,name:'Tester',sex:'Male',weaponType:'Sword',armorTypes:[]}],equipment:items,visions:[{id:100}]},
    snapshot:{characters:[{id:1,joinStatus:'Join',usable:true,equipment:{weaponId:-1,armorId:-1,accessoryIds:Array(slots).fill(-1),visionId:100}}],
      inventory:items.map(item=>({id:item.id,quantity:quantities[item.id] ?? 1})),resonances:[{id:100}],party:[1]}};
}
const key=ids=>ids.slice().sort((a,b)=>a-b).join(',');
function brute(items,slots,available){
  const out=[],ids=[-1,...items.map(item=>item.id)].sort((a,b)=>a-b),chosen=[];
  function visit(start){
    if(chosen.length===slots){out.push(chosen.slice());return;}
    for(let i=start;i<ids.length;i++){
      const id=ids[i];if(id>0 && chosen.filter(value=>value===id).length>=(available.get(id)||0))continue;
      chosen.push(id);visit(i);chosen.pop();
    }
  }
  visit(0);return out;
}

test('joint recursive traversal matches brute force, evaluates only full assignments and avoids mirrored permutations',()=>{
  const items=[accessory(1,{HitPoint:3}),accessory(2,{PhysicalAttack:5}),accessory(3,{},[103]),accessory(4,{HitPoint:-2},[104])];
  const {catalog,snapshot}=fixture(items,3,{1:2,2:2}),seen=[];
  const score=ids=>ids.includes(3)&&ids.includes(4)?1000:ids.reduce((sum,id)=>sum+(id>0?id:0),0);
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{
    assert.equal(equipment.accessoryIds.length,3);seen.push(key(equipment.accessoryIds));return {valid:true,score:score(equipment.accessoryIds)};
  }},baseOptions);
  const expected=brute(items,3,Search.inventory(snapshot));
  assert.deepEqual(new Set(seen),new Set(expected.map(key)));
  assert.equal(seen.length,new Set(seen).size);
  assert.equal(Math.max(...results.map(result=>result.score)),Math.max(...expected.map(score)));
});

test('conditional and inverse-stat tradeoffs survive; an individually dominated source can complete the best pair',()=>{
  const items=[accessory(1,{PhysicalAttack:20,HitPoint:2},[101]),accessory(2,{PhysicalAttack:25,HitPoint:3},[101]),accessory(3,{},[102]),accessory(4,{PhysicalAttack:100})];
  const {catalog,snapshot}=fixture(items),seen=new Set();
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{
    const ids=equipment.accessoryIds;ids.filter(id=>id>0).forEach(id=>seen.add(id));
    return {score:ids.includes(1)&&ids.includes(3)?1000:ids.reduce((sum,id)=>sum+(items.find(item=>item.id===id)?.stats.PhysicalAttack||0),0)};
  }},baseOptions);
  assert.deepEqual(seen,new Set(items.map(item=>item.id)));
  const best=results.slice().sort((a,b)=>b.score-a.score)[0];
  assert.equal(best.score,1000);
  assert.deepEqual(best.equipment.accessoryIds,[1,3]);
});

test('exact equivalent pools retain enough physical copies and saved low-ID identities',()=>{
  const items=Array.from({length:96},(_,i)=>accessory(i+1,{PhysicalAttack:4},[101]));
  const {catalog,snapshot}=fixture(items);snapshot.characters[0].equipment.accessoryIds=[1,-1];
  let calls=0;
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{calls++;return {score:4*equipment.accessoryIds.filter(id=>id>0).length};}},baseOptions);
  assert.ok(calls<=4,'Equivalent identities must not create thousands of indistinguishable pairs');
  assert.equal(Math.max(...results.map(result=>result.score)),8);
  assert.ok(results.some(result=>result.equipment.accessoryIds.includes(1)));
  for(const result of results)assert.equal(new Set(result.equipment.accessoryIds.filter(id=>id>0)).size,result.equipment.accessoryIds.filter(id=>id>0).length);
});

test('recursive slots honor finite copies and keep pinned identities outside equivalent pruning',()=>{
  const items=[accessory(1,{PhysicalAttack:7}),accessory(2,{PhysicalAttack:7}),accessory(3,{PhysicalAttack:7})];
  const {catalog,snapshot}=fixture(items,3,{1:1,2:1,3:2});
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{
    assert.ok(equipment.accessoryIds.includes(1));
    assert.equal(equipment.accessoryIds.filter(id=>id===1).length,1);
    assert.ok(equipment.accessoryIds.filter(id=>id===2).length<=1);
    assert.ok(equipment.accessoryIds.filter(id=>id===3).length<=2);
    return {score:7*equipment.accessoryIds.filter(id=>id>0).length};
  }},{...baseOptions,locks:{accessoryIds:[1]}});
  assert.equal(Math.max(...results.map(result=>result.score)),21);
  let calls=0;
  assert.deepEqual(Search.buildCandidates(catalog,snapshot,1,{evaluate:()=>{calls++;return {score:0};}},{...baseOptions,locks:{accessoryIds:[1,1]}}),[]);
  assert.equal(calls,0);
});

test('equivalent accessory identities remain available for disjoint party allocations',()=>{
  const items=Array.from({length:16},(_,i)=>accessory(i+1,{PhysicalAttack:4}));
  const {catalog,snapshot}=fixture(items);
  catalog.characters=Array.from({length:4},(_,i)=>({...catalog.characters[0],id:i+1,name:'Tester '+i}));
  catalog.visions=Array.from({length:4},(_,i)=>({id:100+i}));
  snapshot.characters=catalog.characters.map((character,i)=>({id:character.id,joinStatus:'Join',usable:true,equipment:{weaponId:-1,armorId:-1,accessoryIds:[-1,-1],visionId:100+i}}));
  snapshot.resonances=catalog.visions.map(vision=>({id:vision.id}));snapshot.party=[1,2,3,4];
  const result=Search.rankParties(catalog,snapshot,{options:{...baseOptions,visionIds:undefined,partySize:4,candidatesPerVision:1,beamWidth:100,maxResults:1},
    evaluate:({equipment})=>({valid:true,score:equipment.accessoryIds.filter(id=>id>0).length*4})});
  assert.ok(result.results.length);
  const members=result.results[0].members;
  assert.equal(members.length,4);
  const allocated=members.flatMap(member=>member.equipment.accessoryIds).filter(id=>id>0);
  assert.equal(allocated.length,8);
  assert.equal(new Set(allocated).size,8);
});

test('deadline, maximum evaluations and per-loadout bounds stop recursive traversal without losing seeds',()=>{
  const original=Date.now;let clock=0;
  try{
    Date.now=()=>clock;
    const {catalog,snapshot}=fixture(Array.from({length:80},(_,i)=>accessory(i+1,{HitPoint:i+1})),4);
    let calls=0;
    const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:({equipment})=>{calls++;clock+=2;return {score:equipment.accessoryIds.filter(id=>id>0).length};}},
      {...baseOptions,deadline:5,maxEvaluations:3,perLoadoutBudget:2});
    assert.ok(calls<=3);
    assert.ok(results.length);
    assert.ok(results.some(result=>result.equipment.accessoryIds.every(id=>id===-1)));
  }finally{Date.now=original;}
});

test('Resonance seeds receive their smaller evaluation cap while full assignments keep the ordinary cap',()=>{
  const {catalog,snapshot}=fixture([accessory(1,{PhysicalAttack:1}),accessory(2,{PhysicalAttack:2})]),seen=[];
  Search.buildCandidates(catalog,snapshot,1,{evaluate:args=>{seen.push(args);return {valid:true,score:1};}},
    {...baseOptions,seedEvaluationTimeMs:80,evaluationTimeMs:500});
  assert.ok(seen.length>1);
  assert.equal(seen[0].evaluationTimeMs,80);
  assert.ok(seen.slice(1).every(args=>args.evaluationTimeMs===500));
});

test('a cheap cached seed is refined once at the full cap before the joint accessory walk',()=>{
  const {catalog,snapshot}=fixture([accessory(1,{PhysicalAttack:1})]),calls=[];
  const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:args=>{
    calls.push({cap:args.evaluationTimeMs,key:key(args.equipment.accessoryIds)});
    return {valid:true,score:args.evaluationTimeMs===80?1:10};
  }},{...baseOptions,seedEvaluationTimeMs:80,evaluationTimeMs:500});
  const baseKey=key(snapshot.characters[0].equipment.accessoryIds),baseCalls=calls.filter(call=>call.key===baseKey);
  assert.deepEqual(baseCalls.map(call=>call.cap),[80,500]);
  assert.equal(results.find(result=>key(result.equipment.accessoryIds)===baseKey).score,10);
  assert.deepEqual(calls.slice(0,2).map(call=>call.cap),[80,500]);
});

test('failed or weaker full-cap refinement preserves the legal cheap incumbent and is not retried repeatedly',()=>{
  for(const refinement of [{valid:false,score:0},{valid:true,score:0}]){
    const {catalog,snapshot}=fixture([accessory(1,{PhysicalAttack:1})]),baseKey=key(snapshot.characters[0].equipment.accessoryIds);
    let baseCalls=0;
    const results=Search.buildCandidates(catalog,snapshot,1,{evaluate:args=>{
      if(key(args.equipment.accessoryIds)!==baseKey)return {valid:true,score:2};
      baseCalls++;return args.evaluationTimeMs===80?{valid:true,score:1}:refinement;
    }},{...baseOptions,seedEvaluationTimeMs:80,evaluationTimeMs:500});
    assert.equal(baseCalls,2);
    assert.equal(results.find(result=>key(result.equipment.accessoryIds)===baseKey).score,1);
  }
});

test('joint weighted vision slices leave room for accessory assignments after many cheap seeds',()=>{
  const original=Date.now;
  const run=jointOptimization=>{
    let clock=0;Date.now=()=>clock;
    const {catalog,snapshot}=fixture([accessory(1,{PhysicalAttack:1}),accessory(2,{PhysicalAttack:2})]);
    catalog.visions=Array.from({length:12},(_,i)=>({id:100+i}));
    snapshot.resonances=catalog.visions.map(vision=>({id:vision.id}));
    const seen=[];
    Search.buildCandidates(catalog,snapshot,1,{evaluate:args=>{
      assert.ok(clock<60,'No evaluation may start after the shared deadline');
      seen.push({cap:args.evaluationTimeMs,changed:args.equipment.accessoryIds.some(id=>id>0)});
      clock=Math.min(60,clock+args.evaluationTimeMs);
      return {valid:true,score:args.equipment.accessoryIds.filter(id=>id>0).length};
    }},{...baseOptions,visionIds:catalog.visions.map(vision=>vision.id),visionSlices:true,jointOptimization,
      deadline:60,seedEvaluationTimeMs:1,evaluationTimeMs:10});
    assert.equal(seen.filter(call=>call.cap===1).length,12,'All owned Resonances retain their cheap seed');
    assert.ok(clock<=60);
    return seen.filter(call=>call.changed).length;
  };
  try{
    assert.equal(run(false),0,'Legacy equal slices can spend each tiny slice solely on base refinement');
    assert.ok(run(true)>0,'Joint mode must visit complete accessory assignments before the deadline');
  }finally{Date.now=original;}
});

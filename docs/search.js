(function(root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.Companion;
  const positive = value => Number.isInteger(Number(value)) && Number(value) > 0;
  const keyOf = equipment => [equipment.weaponId, equipment.armorId, ...equipment.accessoryIds.slice().sort((a,b)=>a-b)].join(',');
  // Completed builds use the same tie rule in search, previews and final results.
  const compareCandidates = (a,b) => b.score-a.score ||
    (Number(a.evaluation?.skillCost)||0)-(Number(b.evaluation?.skillCost)||0) ||
    C.equipmentIds(b.equipment || {}).length-C.equipmentIds(a.equipment || {}).length ||
    (Number(b.evaluation?.durability)||0)-(Number(a.evaluation?.durability)||0) ||
    String(a.key || '').localeCompare(String(b.key || ''));
  const countsOf = ids => {
    const counts = new Map();
    for (const id of ids.filter(positive).map(Number)) counts.set(id,(counts.get(id)||0)+1);
    return counts;
  };
  function inventory(snapshot) {
    return C.ownedStock(snapshot);
  }
  function fits(equipment, available) {
    return [...countsOf(C.equipmentIds(equipment))].every(([id,n])=>(available.get(id)||0)>=n);
  }
  function reserveOutside(snapshot, selected, available) {
    const result = new Map(available);
    for (const person of snapshot.characters || []) if (C.joined(person) && !selected.includes(person.id))
      for (const id of C.equipmentIds(person.equipment)) result.set(id,Math.max(0,(result.get(id)||0)-1));
    return result;
  }
  function rolesOf(evaluation) {
    const roles = new Set(evaluation.roles || []);
    if (evaluation.canHeal) roles.add('healer');
    if (evaluation.canProtect) roles.add('protector');
    if (Number(evaluation.breakDamage)>0) roles.add('breaker');
    if (Number(evaluation.supportScore)>0) roles.add('support');
    return [...roles];
  }
  function defaults(options) {
    return {partySize:4,maxResults:3,maxEvaluations:120000,perLoadoutBudget:2500,
      candidatesPerVision:6,beamWidth:120,timeMs:12000,minHealers:0,minProtectors:0,
      reserveNonParty:false,...options};
  }
  const deadlineAfter = ms => ms>0?Date.now()+ms:Infinity;
  const evaluationCap=(options,baseline=false)=>{
    const cap=baseline?(options.seedEvaluationTimeMs ?? options.evaluationTimeMs):options.evaluationTimeMs;
    return Number.isFinite(cap) && cap>0?cap:Infinity;
  };
  // Party simulations while searching use the first few of their reproducible paths; every party shown is re-scored on all of them.
  const QUICK_SAMPLES = 4;
  function stateFor(options) {
    return {evaluations:0,cache:new Map(),cacheBudgets:new Map(),truncated:false,reasons:new Set(),
      started:Date.now(),deadline:Number.isFinite(options.deadline)?options.deadline:deadlineAfter(options.timeMs),options};
  }
  function stopped(state) {
    const {options} = state;
    const reason = state.evaluations>=options.maxEvaluations?'evaluation budget':
      Date.now()>=state.deadline?'time budget':'';
    if (reason) { state.truncated=true;state.reasons.add(reason);return true; }
    return false;
  }
  function evaluateOne(state, callbacks, characterId, visionId, equipment, baseline=false) {
    const key = `${characterId}:${visionId}:${keyOf(equipment)}`;
    const requestedCap=evaluationCap(state.options,baseline),cached=state.cache.get(key);
    state.cacheBudgets ||= new Map();
    if (state.cache.has(key) && (state.cacheBudgets.get(key) ?? Infinity)>=requestedCap) return cached;
    if (stopped(state) && !(baseline && state.evaluations===0 && state.options.maxEvaluations>0)) return cached || null;
    state.evaluations++;
    // A larger-cap attempt replaces the cache fidelity even if it fails; retain any earlier legal incumbent.
    state.cacheBudgets.set(key,requestedCap);
    const evaluation = callbacks.evaluate({characterId,visionId,equipment,enemy:callbacks.enemy,options:state.options,
      ...(Number.isFinite(requestedCap)?{evaluationTimeMs:requestedCap}:{}),
      ...(state.options.locks?.skillIds?.length?{lockedSkillIds:state.options.locks.skillIds}:{})});
    if (!evaluation || evaluation.valid===false || !Number.isFinite(Number(evaluation.score))) {
      if(cached)return cached;
      state.cache.set(key,null);return null;
    }
    const candidate={characterId,visionId,equipment:{...equipment,accessoryIds:equipment.accessoryIds.slice()},
      score:Number(evaluation.score),evaluation,roles:rolesOf(evaluation),key};
    if(cached && compareCandidates(cached,candidate)<0)return cached;
    state.cache.set(key,candidate);
    callbacks.candidate?.(candidate);
    return candidate;
  }
  // Prune only exact combat equivalents. Stat tradeoffs and every distinct passive signature stay in the pool.
  function accessoryPool(ids,equipment,available,protectedIds,slots,partySize){
    const groups=new Map(),keep=new Set(),protectedSet=new Set(protectedIds);
    for(const id of ids){
      const item=equipment.get(id),stats=Object.entries(item.stats || {}).sort(([a],[b])=>a.localeCompare(b));
      const passives=item.passiveIds || [];
      const comparable=stats.every(([,value])=>typeof value==='number' && Number.isFinite(value)) && Array.isArray(passives) && passives.every(id=>Number.isInteger(id) && id>0);
      const key=comparable?JSON.stringify([item.type,item.detailType,item.sexLimit,stats,passives.slice().sort((a,b)=>a-b)]):`unknown:${id}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(id);
    }
    const needed=slots*Math.max(1,partySize);
    for(const group of groups.values()){
      group.sort((a,b)=>Number(protectedSet.has(b))-Number(protectedSet.has(a)) || b-a);
      let copies=0;
      for(const id of group)if(protectedSet.has(id) || copies<needed){keep.add(id);copies+=available.get(id)||0;}
    }
    return [...keep];
  }
  // Canonical free-slot order prevents mirrored permutations; locked copies are removed before descending.
  function* accessorySets(items,slots,available,locked,stop){
    const remaining=new Map(available),chosen=locked.slice();
    for(const id of locked)remaining.set(id,(remaining.get(id)||0)-1);
    function* visit(start){
      if(stop())return;
      if(chosen.length===slots){yield [...locked,...chosen.slice(locked.length).sort((a,b)=>a-b)];return;}
      for(let i=start;i<items.length;i++){
        if(stop())return;
        const id=items[i];
        if(id>0 && !(remaining.get(id)>0))continue;
        chosen.push(id);if(id>0)remaining.set(id,remaining.get(id)-1);
        yield* visit(i);
        chosen.pop();if(id>0)remaining.set(id,remaining.get(id)+1);
      }
    }
    yield* visit(0);
  }
  function equipmentOrdering(catalog,native,visionId,options){
    const action=(catalog.skills || []).find(skill=>skill.id===Number(options.actionId));
    const keys=new Set(),addAttack=type=>{
      if(C.clean(type)==='Magic'){keys.add('Intelligence');keys.add('MagicalAttack');}
      else if(C.clean(type)==='Physic'){keys.add('Attack');keys.add('PhysicalAttack');}
      else if(C.clean(type)==='Divine')keys.add('Divine');
    };
    if(action)addAttack(action.calcType);
    if(!keys.size){
      addAttack((catalog.visions || []).find(vision=>vision.id===visionId)?.attackType);
      for(const key of C.kitProfile([],native).keys)if(['PhysicalAttack','MagicalAttack'].includes(key)){
        keys.add(key);keys.add(key==='MagicalAttack'?'Intelligence':'Attack');
      }
    }
    const requirements=options.requirements || {},survival=requirements.survive || (options.goals || []).includes('durability');
    if(survival)for(const key of ['HitPoint','MaxHitPoint','PhysicalDefense','MagicalDefense','Defence','Mind'])keys.add(key);
    if(Number(requirements.minHp)>0){keys.add('HitPoint');keys.add('MaxHitPoint');}
    // Ordering is a search hint only: inverse scales, conditions and all distinct passive sources remain searchable.
    const goal=C.priorityGoal(catalog,[...keys]);
    if(action && Number(action.cost)>0){
      const mp=C.priorityGoal(catalog,['MagicPoint','MaxMagicPoint']);
      for(const [key,weight] of Object.entries(mp.weights))goal.weights[key]=weight*.1;
    }
    return item=>C.score(item,goal);
  }
  function buildCandidates(catalog,snapshot,characterId,callbacks,options={},availableArg,stateArg) {
    options=defaults(options);
    if (typeof callbacks.evaluate!=='function') throw new Error('A native-mechanics evaluator is required.');
    const state=stateArg || stateFor(options),available=availableArg || inventory(snapshot);
    const native=catalog.characters.find(c=>c.id===Number(characterId));
    const saved=snapshot.characters.find(c=>c.id===Number(characterId));
    if (!native || !saved || !C.joined(saved)) return [];
    const equipment=new Map(catalog.equipment.map(e=>[e.id,e]));
    const legal=(id,slot)=>Number(id)>0 && (available.get(Number(id))||0)>0 && C.eligible(equipment.get(Number(id)),native,slot);
    // Pinned pieces (options.locks, from lockedPieces) are fixed; one that can't be satisfied leaves nothing to search.
    const locks=options.locks || {};
    const lockedAcc=(locks.accessoryIds || []).filter(positive).map(Number);
    const lockedCounts=countsOf(lockedAcc);
    if ((positive(locks.weaponId) && !legal(locks.weaponId,'weapon')) || (positive(locks.armorId) && !legal(locks.armorId,'armor')) ||
      lockedAcc.some(id=>!legal(id,'accessory')) || [...lockedCounts].some(([id,n])=>n>(available.get(id)||0))) return [];
    const weaponIds=positive(locks.weaponId)?[Number(locks.weaponId)]:[-1,...catalog.equipment.filter(e=>legal(e.id,'weapon')).map(e=>e.id)];
    const armorIds=positive(locks.armorId)?[Number(locks.armorId)]:[-1,...catalog.equipment.filter(e=>legal(e.id,'armor')).map(e=>e.id)];
    const accessoryIds=catalog.equipment.filter(e=>legal(e.id,'accessory')).map(e=>e.id);
    const slots=(saved.equipment.accessoryIds || []).length;
    if (slots>4) throw new Error('Unsupported accessory slot count.');
    if (lockedAcc.length>slots) return [];
    const holdsLocks=set=>{const have=countsOf(set);return [...lockedCounts].every(([id,n])=>(have.get(id)||0)>=n);};
    const base={weaponId:positive(locks.weaponId)?Number(locks.weaponId):legal(saved.equipment.weaponId,'weapon')?saved.equipment.weaponId:-1,
      armorId:positive(locks.armorId)?Number(locks.armorId):legal(saved.equipment.armorId,'armor')?saved.equipment.armorId:-1,
      accessoryIds:(saved.equipment.accessoryIds || []).map(id=>legal(id,'accessory')?id:-1)};
    if (lockedAcc.length) {
      // Pinned accessories first, then the saved ones that aren't already covering a pin.
      const spare=new Map(lockedCounts);
      const rest=base.accessoryIds.filter(id=>!(spare.get(id)>0 && spare.set(id,spare.get(id)-1)));
      base.accessoryIds=[...lockedAcc,...rest].slice(0,slots);
      while (base.accessoryIds.length<slots) base.accessoryIds.push(-1);
    }
    if (!fits(base,available)) base.accessoryIds=[...lockedAcc,...Array(slots-lockedAcc.length).fill(-1)];
    const accessoryCandidates=accessoryPool(accessoryIds,equipment,available,[...lockedAcc,...base.accessoryIds],slots,options.partySize);
    const emptyGear={weaponId:positive(locks.weaponId)?Number(locks.weaponId):-1,armorId:positive(locks.armorId)?Number(locks.armorId):-1,
      accessoryIds:[...lockedAcc,...Array(slots-lockedAcc.length).fill(-1)]};
    const owned=new Set((snapshot.resonances || []).map(v=>v.id));
    // Seed owned Resonances with saved gear before walking loadouts. Joint mode gives the leading seeds longer walks;
    // legacy mode keeps equal remaining shares, and the saved Resonance always retains its first comparison.
    if (positive(locks.visionId) && !owned.has(Number(locks.visionId))) return [];
    const pool=[...(positive(locks.visionId)?[Number(locks.visionId)]:options.visionIds || [-1,...catalog.visions.filter(v=>owned.has(v.id)).map(v=>v.id)])]
      .sort((a,b)=>(b===saved.equipment.visionId)-(a===saved.equipment.visionId));
    const seeds=new Map(pool.map(id=>{
      if(!options.jointOptimization)return [id,evaluateOne(state,callbacks,saved.id,id,{...base,visionId:id},true)];
      const complete={...base,accessoryIds:base.accessoryIds.slice(),visionId:id},remaining=new Map(available);
      for(const usedId of C.equipmentIds(complete))remaining.set(usedId,(remaining.get(usedId)||0)-1);
      const priority=equipmentOrdering(catalog,native,id,options);
      const defense=C.priorityGoal(catalog,['HitPoint','MaxHitPoint','PhysicalDefense','MagicalDefense','Defence','Mind']);
      const fill=slot=>catalog.equipment.filter(item=>C.eligible(item,native,slot) && (remaining.get(item.id)||0)>0)
        .sort((a,b)=>priority(b)-priority(a) || C.score(b,defense)-C.score(a,defense) ||
          (a.passiveIds || []).length-(b.passiveIds || []).length || a.id-b.id)[0];
      for(const slot of ['weapon','armor'])if(!(complete[slot+'Id']>0)){
        const item=fill(slot);if(item){complete[slot+'Id']=item.id;remaining.set(item.id,remaining.get(item.id)-1);}
      }
      for(let n=0;n<slots;n++)if(!(complete.accessoryIds[n]>0)){
        const item=fill('accessory');if(item){complete.accessoryIds[n]=item.id;remaining.set(item.id,remaining.get(item.id)-1);}
      }
      // Publish scored gear before the expensive walk; never append unscored filler after time expires.
      const seed=evaluateOne(state,callbacks,saved.id,id,complete,true) || evaluateOne(state,callbacks,saved.id,id,{...base,visionId:id},true);
      return [id,seed];
    }));
    const visions=[...seeds.keys()].sort((a,b)=>(b===saved.equipment.visionId)-(a===saved.equipment.visionId) || (seeds.get(b)?.score ?? -Infinity)-(seeds.get(a)?.score ?? -Infinity));
    const all=new Map([...seeds.values()].filter(Boolean).map(c=>[c.key,c]));
    for (const [n,visionId] of visions.entries()) {
      const local=new Map();
      // Native timing checks can exhaust the budget during seeding; retain that completed comparison.
      if(seeds.get(visionId))local.set(keyOf(seeds.get(visionId).equipment),seeds.get(visionId));
      let attempts=0;
      let best=seeds.get(visionId);
      const fairShare=1/(visions.length-n);
      const sliceShare=options.jointOptimization && n<3?Math.max(.5,fairShare):fairShare;
      const sliceEnd=options.visionSlices?Date.now()+(state.deadline-Date.now())*sliceShare:Infinity;
      const consider=(weaponId,armorId,accessoryIds)=>{
        if ((positive(locks.weaponId) && weaponId!==weaponIds[0]) || (positive(locks.armorId) && armorId!==armorIds[0]) || !holdsLocks(accessoryIds)) return true;
        const equip={weaponId,armorId,accessoryIds,visionId},key=keyOf(equip);
        const cachedCap=state.cacheBudgets?.get(`${saved.id}:${visionId}:${key}`) ?? Infinity;
        if (local.has(key) && cachedCap>=evaluationCap(state.options)) return true;
        if (attempts>=options.perLoadoutBudget || stopped(state) || Date.now()>=sliceEnd) return false;
        if (!fits(equip,available)) return true;
        attempts++;
        const candidate=evaluateOne(state,callbacks,saved.id,visionId,equip);
        local.set(key,candidate);
        if (candidate && (!best || compareCandidates(candidate,best)<0)) best=candidate;
        return true;
      };
      // Seed the saved loadout before pruning so a search budget never hides its comparison.
      if(options.jointOptimization && best)consider(best.equipment.weaponId,best.equipment.armorId,best.equipment.accessoryIds);
      consider(base.weaponId,base.armorId,base.accessoryIds);
      consider(emptyGear.weaponId,emptyGear.armorId,emptyGear.accessoryIds);
      const priority=equipmentOrdering(catalog,native,visionId,options),priorityOf=id=>priority(equipment.get(id));
      const order=(ids,preferred)=>ids.slice().sort((a,b)=>Number(b===preferred && b>0)-Number(a===preferred && a>0) ||
        Number(b>0)-Number(a>0) || priorityOf(b)-priorityOf(a) || b-a);
      // Whole-build weapon/armor probes seed the joint walk, without eliminating any stat tradeoff.
      const probeLimit=Math.floor(options.perLoadoutBudget/4),probeEnd=Date.now()+(Math.min(sliceEnd,state.deadline)-Date.now())/4;
      for(const weapon of order(weaponIds,base.weaponId)){
        if(attempts>=probeLimit || Date.now()>=probeEnd)break;
        const current=best?.equipment || base;if(!consider(weapon,current.armorId,current.accessoryIds))break;
      }
      for(const armor of order(armorIds,base.armorId)){
        if(attempts>=probeLimit || Date.now()>=probeEnd)break;
        const current=best?.equipment || base;if(!consider(current.weaponId,armor,current.accessoryIds))break;
      }
      const start=best?.equipment || base,preferredAccessories=new Set(start.accessoryIds);
      const jointAccessories=accessoryCandidates.slice().sort((a,b)=>Number(preferredAccessories.has(b))-Number(preferredAccessories.has(a)) ||
        Number((equipment.get(b)?.passiveIds || []).length>0)-Number((equipment.get(a)?.passiveIds || []).length>0) || priorityOf(b)-priorityOf(a) || b-a);
      jointAccessories.push(-1);
      let interrupted=false;
      const stop=()=>{
        if(attempts>=options.perLoadoutBudget || stopped(state) || Date.now()>=sliceEnd){interrupted=true;return true;}
        return false;
      };
      traverse:for(const weapon of order(weaponIds,start.weaponId))for(const armor of order(armorIds,start.armorId)){
        for(const set of accessorySets(jointAccessories,slots,available,lockedAcc,stop)){
          if(!consider(weapon,armor,set)){interrupted=true;break traverse;}
        }
        if(interrupted)break traverse;
      }
      if(interrupted){state.truncated=true;state.reasons.add('loadout budget');}
      const ranked=[...local.values()].filter(Boolean).sort(compareCandidates);
      const keep=new Map(ranked.slice(0,options.candidatesPerVision).map(c=>[c.key,c]));
      // Keep stock alternatives: giving a scarce best item to one member can change the best team.
      const contested=new Set(ranked.slice(0,options.candidatesPerVision).flatMap(c=>C.equipmentIds(c.equipment)));
      for(const id of contested) {
        const alternate=ranked.find(c=>!C.equipmentIds(c.equipment).includes(id));
        if(alternate)keep.set(alternate.key,alternate);
      }
      // Retain disjoint concrete accessory allocations, so equivalent IDs remain usable across a party.
      const spareAccessories=new Map(available);
      for(let i=0;i<options.partySize;i++){
        const alternate=ranked.find(c=>c.equipment.accessoryIds.some(positive) &&
          [...countsOf(c.equipment.accessoryIds)].every(([id,count])=>count<=(spareAccessories.get(id)||0)));
        if(!alternate)break;
        keep.set(alternate.key,alternate);
        for(const id of alternate.equipment.accessoryIds.filter(positive))spareAccessories.set(id,spareAccessories.get(id)-1);
      }
      // Retain role specialists and the original comparison even if their individual damage is low.
      for (const role of new Set(ranked.flatMap(c=>c.roles))) {
        const candidates=ranked.filter(c=>c.roles.includes(role));
        const metric=c=>role==='healer'?Number(c.evaluation.healing || c.evaluation.heal || 0):
          role==='protector'?Number(c.evaluation.protection || 0):role==='breaker'?Number(c.evaluation.breakDamage || 0):
          role==='support'?Number(c.evaluation.supportScore || 0):c.score;
        candidates.sort((a,b)=>metric(b)-metric(a)||b.score-a.score);
        for (const c of candidates.slice(0,2))keep.set(c.key,c);
      }
      const baseline=local.get(keyOf({...base,visionId}));
      if (baseline)keep.set(baseline.key,baseline);
      const empty=local.get(keyOf({...emptyGear,visionId}));
      if (empty)keep.set(empty.key,empty);
      if (ranked.length>keep.size) {state.truncated=true;state.reasons.add('candidate pruning');}
      for(const c of keep.values())all.set(c.key,c);
      if (stopped(state))break;
    }
    return [...all.values()];
  }
  function validateParty(catalog,snapshot,members,options={}) {
    options=defaults(options);
    if (members.length!==options.partySize) return 'Wrong party size.';
    const ids=members.map(m=>Number(m.characterId));
    if (new Set(ids).size!==ids.length) return 'Duplicate character.';
    const native=new Map(catalog.characters.map(c=>[c.id,c]));
    const saved=new Map(snapshot.characters.map(c=>[c.id,c]));
    const gear=new Map(catalog.equipment.map(e=>[e.id,e]));
    const knownVisions=new Set(catalog.visions.map(v=>v.id));
    const ownedVisions=new Set((snapshot.resonances || []).map(v=>v.id));
    const visions=new Set(),used=new Map();
    const available=options.reserveNonParty?reserveOutside(snapshot,ids,inventory(snapshot)):inventory(snapshot);
    for (const member of members) {
      const person=saved.get(Number(member.characterId)),data=native.get(Number(member.characterId));
      if (!person || !data || !C.joined(person)) return 'Character is not recruited and available.';
      if (!member.equipment || member.equipment.accessoryIds.length!==(person.equipment.accessoryIds || []).length) return 'Accessory slot count mismatch.';
      const slots=[['weapon',member.equipment.weaponId],['armor',member.equipment.armorId],...member.equipment.accessoryIds.map(id=>['accessory',id])];
      for (const [slot,id] of slots) if(Number(id)>0) {
        if (!C.eligible(gear.get(Number(id)),data,slot)) return 'Incompatible or unknown equipment.';
        used.set(Number(id),(used.get(Number(id))||0)+1);
        if (used.get(Number(id))>(available.get(Number(id))||0)) return 'Equipment stock exceeded.';
      }
      const visionId=Number(member.visionId);
      if (Number(member.equipment.visionId)!==visionId) return 'Resonance assignment mismatch.';
      if (visionId>0) {
        if(!knownVisions.has(visionId) || !ownedVisions.has(visionId))return 'Resonance is unknown or not owned.';
        if(visions.has(visionId))return 'Resonance assigned twice.';
        visions.add(visionId);
      }
    }
    if (members.filter(m=>(m.roles||[]).includes('healer')).length<options.minHealers) return 'Healer requirement not met.';
    if (members.filter(m=>(m.roles||[]).includes('protector')).length<options.minProtectors) return 'Protector requirement not met.';
    return '';
  }
  function combinations(values,size) {
    const out=[];
    function visit(start,selected) {
      if(selected.length===size){out.push(selected.slice());return;}
      for(let i=start;i<=values.length-(size-selected.length);i++){selected.push(values[i]);visit(i+1,selected);selected.pop();}
    }
    visit(0,[]);return out;
  }
  // Complete returned builds after bounded search. Both single and party results use the same stock checks.
  function finalizeBuilds(catalog,snapshot,members,stock,callbacks,state) {
    const gear=new Map(catalog.equipment.map(e=>[e.id,e]));
    const used=countsOf(members.flatMap(m=>C.equipmentIds(m.equipment)));
    const owned=inventory(snapshot);
    const abilityCost=member=>Number(member.evaluation?.skillCost)||0;
    const worth=id=>Object.values(gear.get(id)?.stats || {}).reduce((a,b)=>a+Number(b||0),0);
    const unmodeled=(evaluation,item)=>[...(evaluation.passiveAnalysis?.unsupported || []),...(evaluation.passiveAnalysis?.deferred || [])]
      .filter(effect=>(item?.passiveIds || []).includes(effect.passiveId));
    const fillState=state || stateFor(defaults(callbacks.options || {}));
    const slotsOf=equipment=>[['weapon',0,e=>e.weaponId,(e,id)=>({...e,weaponId:id})],['armor',0,e=>e.armorId,(e,id)=>({...e,armorId:id})],
      ...equipment.accessoryIds.map((_,i)=>['accessory',i,e=>e.accessoryIds[i],(e,id)=>({...e,accessoryIds:e.accessoryIds.map((x,j)=>j===i?id:x)})])];
    const out=members.slice();
    const partyScore=rows=>{
      if(stopped(fillState))return NaN;
      const result=callbacks.evaluateParty?.(rows,{enemy:callbacks.enemy,options:fillState.options,samples:QUICK_SAMPLES});
      return callbacks.evaluateParty?Number(result?.score):rows.reduce((sum,m)=>sum+m.score,0);
    };
    for(let memberIndex=0;memberIndex<out.length;memberIndex++){
      if(stopped(fillState))break;
      const member=out[memberIndex];
      const native=catalog.characters.find(c=>c.id===member.characterId);
      let best=member;
      for (const [slot,index,get,set] of slotsOf(best.equipment)) {
        if(stopped(fillState))break;
        if (Number(get(best.equipment))>0) continue;
        let pick=null;
        const previousPartyScore=partyScore(out);
        if(!Number.isFinite(previousPartyScore))continue;
        for (const item of catalog.equipment) {
          if(stopped(fillState))break;
          if ((stock.get(item.id)||0)-(used.get(item.id)||0)<1 || !C.eligible(item,native,slot)) continue;
          const c=evaluateOne(fillState,callbacks,member.characterId,member.visionId,set(best.equipment,item.id));
          if (!c || unmodeled(c.evaluation,item).length || c.score<best.score || !best.roles.every(role=>c.roles.includes(role))) continue;
          const next=out.slice();next[memberIndex]=c;
          const nextPartyScore=partyScore(next);
          if (!Number.isFinite(nextPartyScore) || nextPartyScore<previousPartyScore) continue;
          if(nextPartyScore===previousPartyScore && c.score===best.score && abilityCost(c)>abilityCost(best))continue;
          if (!pick || nextPartyScore>pick.partyScore || (nextPartyScore===pick.partyScore && (c.score>pick.c.score || c.score===pick.c.score &&
            (abilityCost(c)<abilityCost(pick.c) || abilityCost(c)===abilityCost(pick.c) && worth(item.id)>worth(pick.id)))))pick={c,id:item.id,partyScore:nextPartyScore};
        }
        // The cache keys accessories unordered, so keep this slot order rather than the cached one.
        if (pick) {best={...pick.c,equipment:set(best.equipment,pick.id)};used.set(pick.id,(used.get(pick.id)||0)+1);out[memberIndex]=best;}
      }
    }
    // Explain the final allocation with the same equipped abilities and this slot empty.
    for(const [memberIndex,member] of out.entries()){
      const native=catalog.characters.find(c=>c.id===member.characterId);
      const gearReasons=slotsOf(member.equipment).map(([slot,index,get,set])=>{
        const itemId=Number(get(member.equipment));
        const base={slot,index,itemId,status:itemId>0?'selected':'empty',unmodeledEffects:unmodeled(member.evaluation,gear.get(itemId))};
        if(stopped(fillState))return {...base,reason:'budget-exhausted'};
        if(itemId>0){
          fillState.evaluations++;
          const without=callbacks.evaluate({characterId:member.characterId,visionId:member.visionId,equipment:set(member.equipment,-1),
            equippedSkillIds:member.evaluation.equippedSkillIds,enemy:callbacks.enemy,options:fillState.options});
          if(!without || without.valid===false || !Number.isFinite(Number(without.score)))return {...base,reason:'required-for-evaluation'};
          const metrics=e=>({damage:e.fightDamage ?? e.damage,stagger:e.fightBreakDamage ?? e.breakDamage});
          const current=metrics(member.evaluation),empty=metrics(without);
          const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
          const scoreDelta=member.score-without.score;
          return {...base,reason:scoreDelta>0?'improves-model':scoreDelta<0?'tradeoff-model':'neutral-model',scoreDelta,
            damageDelta:delta(current.damage,empty.damage),staggerDelta:delta(current.stagger,empty.stagger),evaluationMode:'same-abilities-without-item'};
        }
        const compatible=catalog.equipment.filter(item=>C.eligible(item,native,slot) && (owned.get(item.id)||0)>0);
        if(!compatible.length)return {...base,reason:'no-owned-compatible'};
        const remaining=compatible.filter(item=>(stock.get(item.id)||0)-(used.get(item.id)||0)>0);
        if(!remaining.length)return {...base,reason:'reserved-or-used'};
        let supported=false,roleLoss=false;
        for(const item of remaining){
          if(stopped(fillState))return {...base,reason:'budget-exhausted'};
          const candidate=evaluateOne(fillState,callbacks,member.characterId,member.visionId,set(member.equipment,item.id));
          if(!candidate || unmodeled(candidate.evaluation,item).length)continue;
          supported=true;
          if(!member.roles.every(role=>candidate.roles.includes(role)))roleLoss=true;
        }
        return {...base,reason:!supported?'unsupported':roleLoss?'preserves-role':'lowers-model'};
      });
      out[memberIndex]={...member,gearReasons};
    }
    if(state)state.evaluations=fillState.evaluations;
    return out;
  }
  function rankParties(catalog,snapshot,callbacks) {
    const options=defaults(callbacks.options || {}),state=stateFor(options);
    const globalDeadline=Number.isFinite(options.deadline)?options.deadline:Infinity;
    state.deadline=Math.min(globalDeadline,deadlineAfter(options.timeMs));
    if (typeof callbacks.evaluate!=='function') throw new Error('A native-mechanics evaluator is required.');
    if (!Number.isInteger(options.partySize) || options.partySize<1 || options.partySize>8) throw new Error('Party size must be between 1 and 8.');
    const native=new Set(catalog.characters.map(c=>c.id));
    const availablePeople=snapshot.characters.filter(c=>C.joined(c)&&native.has(c.id)).map(c=>c.id);
    const fixed=(options.fixedCharacterIds || []).map(Number);
    if (fixed.some(id=>!availablePeople.includes(id)) || new Set(fixed).size!==fixed.length || fixed.length>options.partySize) throw new Error('Fixed characters must be available, unique, and fit the party.');
    const people=fixed.length===options.partySize?fixed:availablePeople;
    const teams=combinations(people.filter(id=>!fixed.includes(id)),options.partySize-fixed.length).map(ids=>[...fixed,...ids]);
    const results=[],candidateCache=new Map();
    const visionCount=1+catalog.visions.filter(v=>(snapshot.resonances || []).some(o=>o.id===v.id)).length;
    const fairBudget=Math.floor(options.maxEvaluations/Math.max(1,people.length*visionCount*(options.reserveNonParty?teams.length:1)));
    options.perLoadoutBudget=Math.min(options.perLoadoutBudget,Math.max(2,fairBudget));
    // Preserve one saved setup per character; alternative Resonances belong to the bounded search.
    const seedState=stateFor({...options,timeMs:0,deadline:globalDeadline}),fallback=new Map();
    for(const id of people){
      const person=snapshot.characters.find(c=>c.id===id);
      fallback.set(id,buildCandidates(catalog,snapshot,id,callbacks,{...options,jointOptimization:false,perLoadoutBudget:0,visionIds:[Number(person.equipment.visionId)]},inventory(snapshot),seedState));
    }
    state.cache=seedState.cache;state.cacheBudgets=seedState.cacheBudgets;state.evaluations=seedState.evaluations;
    let considered=0,teamCount=0,reported=0;
    const progress=(message,force)=>{if(force || Date.now()-reported>=250){reported=Date.now();callbacks.progress?.(message);}};
    const nameOf=id=>catalog.characters.find(c=>c.id===id)?.name || `#${id}`;
    const sumOf=members=>({score:members.reduce((sum,m)=>sum+m.score,0),evaluation:null});
    const partyScore=(members,samples,deadline=globalDeadline)=>{
      if(Date.now()>=globalDeadline){state.truncated=true;state.reasons.add('time budget');return null;}
      const detail=callbacks.evaluateParty?.(members,{enemy:callbacks.enemy,options,deadline:Math.min(globalDeadline,deadline),...(samples?{samples}:{})});
      return callbacks.evaluateParty?(detail && Number.isFinite(Number(detail.score))?{score:Number(detail.score),evaluation:detail}:null):sumOf(members);
    };
    const stockFor=team=>options.reserveNonParty?reserveOutside(snapshot,team,inventory(snapshot)):inventory(snapshot);
    let checkpointBest=null;
    const partyCost=result=>result.members.reduce((sum,member)=>sum+(Number(member.evaluation?.skillCost)||0),0);
    const checkpoint=result=>{
      if(!Number.isFinite(result.score) || validateParty(catalog,snapshot,result.members,options) ||
        checkpointBest && (result.score<checkpointBest.score || result.score===checkpointBest.score && partyCost(result)>=partyCost(checkpointBest)))return;
      checkpointBest={...result,members:result.members.slice()};
      callbacks.checkpoint?.({results:[checkpointBest]});
    };
    const baselineIds=(snapshot.party || []).filter(id=>people.includes(id)).slice(0,options.partySize);
    let baseline=null;
    // Establish a fully simulated stock-safe incumbent before spending time on alternative gear and Resonances.
    for(const team of [fixed.length===options.partySize?fixed:baselineIds,...teams]){
      if(team.length!==options.partySize || new Set(team).size!==team.length)continue;
      const members=team.map(id=>(fallback.get(id)||[])[0]),stock=stockFor(team);
      if(!members.every(Boolean) || validateParty(catalog,snapshot,members,options) ||
        [...countsOf(members.flatMap(member=>C.equipmentIds(member.equipment)))].some(([id,count])=>count>(stock.get(id)||0)))continue;
      const scored=partyScore(members,undefined,Math.min(globalDeadline,Date.now()+1000));
      if(!scored)break;
      const result={members,...scored,stock,estimated:false};
      results.push(result);checkpoint(result);
      if(team.length===baselineIds.length && team.every(id=>baselineIds.includes(id)))baseline={...result,valid:true,warning:''};
      break;
    }
    const candidatesFor=(id,stock)=>{
      const key=`${id}:${[...stock].sort((a,b)=>a[0]-b[0]).map(([item,n])=>`${item}:${n}`).join(',')}`;
      if(!candidateCache.has(key)) {
        const generated=stopped(state)?[]:buildCandidates(catalog,snapshot,id,callbacks,options,stock,state);
        const combined=new Map();
        for(const candidate of [...generated,...(fallback.get(id)||[]).filter(c=>fits(c.equipment,stock))]){
          const previous=combined.get(candidate.key);
          if(!previous || compareCandidates(candidate,previous)<0)combined.set(candidate.key,candidate);
        }
        candidateCache.set(key,[...combined.values()]);
      }
      return candidateCache.get(key);
    };
    if(!options.reserveNonParty) {
      // Every character gets an equal share of the remaining time before any team is ranked. Building them
      // team by team let the first team spend the whole budget, leaving later characters only their saved setup.
      for(const [n,id] of people.entries()) {
        progress(`Building ${nameOf(id)}’s options (${n+1} of ${people.length})…`,true);
        const end=state.deadline;
        state.deadline=Math.min(end,Date.now()+(end-Date.now())/(people.length-n));
        candidatesFor(id,inventory(snapshot));
        state.deadline=end;
      }
      // Strongest teams first, so a party time budget only ever cuts the least promising ones short.
      const bound=new Map(teams.map(team=>[team,team.reduce((sum,id)=>sum+Math.max(0,...candidatesFor(id,inventory(snapshot)).map(c=>c.score)),0)]));
      teams.sort((a,b)=>bound.get(b)-bound.get(a));
    }
    // MP-dependent state can make full party scoring expensive; reserve time for refinement and final scoring. After this deadline the beam ranks the
    // remaining parties by their members' own scores, so every team is still compared and the search ends.
    const partyBudget=options.partyTimeMs ?? options.timeMs,partyDeadline=Math.min(globalDeadline,deadlineAfter(partyBudget));
    const comparisonDeadline=partyDeadline-(options.jointOptimization && partyBudget>0?Math.min(4000,partyBudget*2/3):0);
    const rank=members=>{
      if(Date.now()<comparisonDeadline)return {...(partyScore(members,QUICK_SAMPLES,comparisonDeadline) || sumOf(members)),estimated:true};
      state.truncated=true;state.reasons.add('party time budget');
      return {...sumOf(members),estimated:true};
    };
    if(!baseline && baselineIds.length===options.partySize) {
      const members=baselineIds.map(id=>{
        const person=snapshot.characters.find(c=>c.id===id);
        return (fallback.get(id)||[]).find(c=>c.visionId===Number(person.equipment.visionId) && keyOf(c.equipment)===keyOf(person.equipment));
      });
      if(members.every(Boolean)) {
        const warning=validateParty(catalog,snapshot,members,options);
        const scored=partyScore(members);
        if(scored){baseline={members,...scored,valid:!warning,warning};if(!warning)checkpoint(baseline);}
      }
    }
    for (const team of teams) {
      teamCount++;
      progress(`Comparing parties (${teamCount} of ${teams.length})…`);
      const stock=stockFor(team);
      const candidates=new Map(team.map(id=>[id,candidatesFor(id,stock)]));
      const order=team.slice().sort((a,b)=>candidates.get(a).length-candidates.get(b).length);
      let beam=[{members:[],used:new Map(),visions:new Set(),score:0}];
      for(let depth=0;depth<order.length;depth++) {
        const next=[];
        for(const partial of beam)for(const candidate of candidates.get(order[depth])) {
          if(candidate.visionId>0 && partial.visions.has(candidate.visionId))continue;
          const counts=countsOf(C.equipmentIds(candidate.equipment));
          if([...counts].some(([id,n])=>(partial.used.get(id)||0)+n>(stock.get(id)||0)))continue;
          const members=[...partial.members,candidate],remaining=order.length-depth-1;
          if(members.filter(m=>m.roles.includes('healer')).length+remaining<options.minHealers ||
             members.filter(m=>m.roles.includes('protector')).length+remaining<options.minProtectors)continue;
          const used=new Map(partial.used);for(const [id,n]of counts)used.set(id,(used.get(id)||0)+n);
          const visions=new Set(partial.visions);if(candidate.visionId>0)visions.add(candidate.visionId);
          const score=rank(members);considered++;
          next.push({members,used,visions,...score});
        }
        next.sort((a,b)=>b.score-a.score);
        if(next.length>options.beamWidth){state.truncated=true;state.reasons.add('party beam');}
        beam=next.slice(0,options.beamWidth);
        if(!beam.length)break;
      }
      for(const result of beam)if(!validateParty(catalog,snapshot,result.members,options))results.push({...result,stock});
      results.sort((a,b)=>b.score-a.score);
      // Spare results: filling empty slots can make near-duplicates identical.
      if(results.length>options.maxResults*5)results.length=options.maxResults*5;
    }
    // Compare the leading finalists on every sample: the beam ranked them on a few, or on members' own scores after
    // its deadline. The rest are spares for duplicates, and each party kept below is re-scored in full anyway.
    results.sort((a,b)=>b.score-a.score);
    for(const result of results.slice(0,options.jointOptimization?1:options.maxResults*2))if(result.estimated){
      const scored=partyScore(result.members,undefined,options.jointOptimization?comparisonDeadline:globalDeadline);
      if(scored){Object.assign(result,scored,{estimated:false});checkpoint(result);}
    }
    results.sort((a,b)=>b.score-a.score);
    progress('Finishing the top parties…',true);
    if(options.jointOptimization){
      for(const result of results.filter(result=>!result.estimated).slice(0,1)){
      const proposals=[],originalMembers=result.members;
      const refineDeadline=partyDeadline-Math.min(1000,Math.max(0,(partyDeadline-Date.now())*.35));
      let remaining=result.members.length;
      for(let n=0;n<result.members.length;n++){
        const member=result.members[n],left=refineDeadline-Date.now(),share=left/Math.max(1,remaining--);
        if(left<=0 || state.evaluations>=options.maxEvaluations || !member.evaluation?.turn)continue;
        progress(`Refining ${nameOf(member.characterId)} in a complete party…`);
        state.evaluations++;
        const supportRoles=['healer','protector'].filter(role=>{
          const minimum=role==='healer'?options.minHealers:options.minProtectors;
          return result.members.filter((other,index)=>index!==n && other.roles.includes(role)).length<minimum;
        });
        const evaluation=(callbacks.refine || callbacks.evaluate)({characterId:member.characterId,visionId:member.visionId,equipment:member.equipment,
          refineEvaluation:member.evaluation,supportRoles,evaluationTimeMs:Math.min(500,Math.max(1,share*.85)),
          ...(options.locks?.skillIds?.length?{lockedSkillIds:options.locks.skillIds}:{})});
        if(!evaluation || evaluation.valid===false || !Number.isFinite(Number(evaluation.score)))continue;
        const candidate={...member,evaluation,score:Number(evaluation.score),roles:rolesOf(evaluation)};
        proposals.push({n,candidate});
      }
      const quickScore=members=>partyScore(members,QUICK_SAMPLES,Math.min(globalDeadline,Date.now()+Math.max(1,Math.min(250,(partyDeadline-Date.now())*.15))));
      let members=result.members,quick=proposals.length?quickScore(members):null;
      for(const {n,candidate} of proposals){
        const member=members[n],next=members.slice();next[n]=candidate;
        if(!fits(candidate.equipment,result.stock) || validateParty(catalog,snapshot,next,options))continue;
        const scored=quick?quickScore(next):null;
        if(!scored || scored.score<quick.score)continue;
        if(scored.score===quick.score && (Number(candidate.evaluation.skillCost)||0)>(Number(member.evaluation.skillCost)||0))continue;
        members=next;quick=scored;
      }
      if(members!==originalMembers){
        const scored=partyScore(members);
        if(scored && scored.score>=result.score){result.members=members;Object.assign(result,scored);checkpoint(result);}
      }
      }
      results.sort((a,b)=>b.score-a.score);
    }
    const seen=new Set(),unique=[];
    for(const result of results) {
      if(unique.length>=options.maxResults)break;
      const previousMembers=result.members;
      result.members=finalizeBuilds(catalog,snapshot,result.members,result.stock,callbacks,state);
      const key=result.members.map(m=>`${m.characterId}:${m.visionId}:${keyOf(m.equipment)}`).sort().join('|');
      if(seen.has(key))continue;
      let scored=partyScore(result.members);
      if(!scored && !result.estimated){result.members=previousMembers;scored={score:result.score,evaluation:result.evaluation};}
      if(!scored)continue;
      seen.add(key);unique.push(Object.assign(result,scored));checkpoint(result);
    }
    unique.sort((a,b)=>b.score-a.score);
    results.length=0;results.push(...unique);
    if(!results.length && checkpointBest)results.push(checkpointBest);
    return {approximate:state.truncated,considered,evaluations:state.evaluations,truncated:state.truncated,
      reasons:[...state.reasons],teamsConsidered:teamCount,totalTeams:teams.length,
      results:results.map(({members,score,evaluation})=>({members,score,evaluation})),baseline,elapsedMs:Date.now()-state.started};
  }
  const api={rankParties,buildCandidates,finalizeBuilds,validateParty,inventory,compareCandidates};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);

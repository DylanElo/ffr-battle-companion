(function(root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.Companion;
  const positive = value => Number.isInteger(Number(value)) && Number(value) > 0;
  const keyOf = equipment => [equipment.weaponId, equipment.armorId, ...equipment.accessoryIds.slice().sort((a,b)=>a-b)].join(',');
  const countsOf = ids => {
    const counts = new Map();
    for (const id of ids.filter(positive).map(Number)) counts.set(id,(counts.get(id)||0)+1);
    return counts;
  };
  function inventory(snapshot) {
    const counts = new Map();
    for (const item of snapshot.inventory || []) if (positive(item.id) && Number(item.quantity)>0)
      counts.set(Number(item.id),(counts.get(Number(item.id))||0)+Math.floor(Number(item.quantity)));
    return counts;
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
  function stateFor(options) {
    return {evaluations:0,cache:new Map(),truncated:false,reasons:new Set(),
      started:Date.now(),options};
  }
  function stopped(state) {
    const {options} = state;
    const reason = state.evaluations>=options.maxEvaluations?'evaluation budget':
      options.timeMs>0 && Date.now()-state.started>=options.timeMs?'time budget':'';
    if (reason) { state.truncated=true;state.reasons.add(reason);return true; }
    return false;
  }
  function evaluateOne(state, callbacks, characterId, visionId, equipment) {
    const key = `${characterId}:${visionId}:${keyOf(equipment)}`;
    if (state.cache.has(key)) return state.cache.get(key);
    if (stopped(state)) return null;
    state.evaluations++;
    const evaluation = callbacks.evaluate({characterId,visionId,equipment,enemy:callbacks.enemy,options:state.options});
    if (!evaluation || evaluation.valid===false || !Number.isFinite(Number(evaluation.score))) {
      state.cache.set(key,null);return null;
    }
    const candidate={characterId,visionId,equipment:{...equipment,accessoryIds:equipment.accessoryIds.slice()},
      score:Number(evaluation.score),evaluation,roles:rolesOf(evaluation),key};
    state.cache.set(key,candidate);
    return candidate;
  }
  function accessorySets(items, slots, available) {
    const out=[];
    function visit(start, chosen, counts) {
      if (chosen.length===slots) {out.push(chosen.slice());return;}
      for (let i=start;i<items.length;i++) {
        const id=items[i],n=(counts.get(id)||0)+1;
        if (id>0 && n>(available.get(id)||0)) continue;
        counts.set(id,n);chosen.push(id);visit(i,chosen,counts);chosen.pop();
        counts.set(id,n-1);
      }
    }
    visit(0,[],new Map());
    return out;
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
    const weaponIds=[-1,...catalog.equipment.filter(e=>legal(e.id,'weapon')).map(e=>e.id)];
    const armorIds=[-1,...catalog.equipment.filter(e=>legal(e.id,'armor')).map(e=>e.id)];
    const accessoryIds=[-1,...catalog.equipment.filter(e=>legal(e.id,'accessory')).map(e=>e.id)].sort((a,b)=>a-b);
    const slots=(saved.equipment.accessoryIds || []).length;
    if (slots>4) throw new Error('Unsupported accessory slot count.');
    const accessories=accessorySets(accessoryIds,slots,available);
    const base={weaponId:legal(saved.equipment.weaponId,'weapon')?saved.equipment.weaponId:-1,
      armorId:legal(saved.equipment.armorId,'armor')?saved.equipment.armorId:-1,
      accessoryIds:(saved.equipment.accessoryIds || []).map(id=>legal(id,'accessory')?id:-1)};
    if (!fits(base,available)) base.accessoryIds=Array(slots).fill(-1);
    const owned=new Set((snapshot.resonances || []).map(v=>v.id));
    // Try every Resonance with the saved gear first, then search the strongest first, each with an equal share of the
    // remaining time, so a time budget can't end the search before the best (or the saved) Resonance is tried.
    const seed=visionId=>evaluateOne(state,callbacks,saved.id,visionId,{...base,visionId})?.score ?? -Infinity;
    const pool=options.visionIds || [-1,...catalog.visions.filter(v=>owned.has(v.id)).map(v=>v.id)];
    const seeds=new Map(pool.map(id=>[id,seed(id)]));
    const visions=[...seeds.keys()].sort((a,b)=>(b===saved.equipment.visionId)-(a===saved.equipment.visionId) || seeds.get(b)-seeds.get(a));
    const all=[];
    for (const [n,visionId] of visions.entries()) {
      const local=new Map();
      let attempts=0;
      const sliceEnd=options.visionSlices && options.timeMs>0?Date.now()+(options.timeMs-(Date.now()-state.started))/(visions.length-n):Infinity;
      const consider=(weaponId,armorId,accessoryIds)=>{
        const equip={weaponId,armorId,accessoryIds,visionId},key=keyOf(equip);
        if (local.has(key)) return true;
        if (attempts>=options.perLoadoutBudget || stopped(state) || Date.now()>=sliceEnd) return false;
        if (!fits(equip,available)) return true;
        attempts++;
        const candidate=evaluateOne(state,callbacks,saved.id,visionId,equip);
        local.set(key,candidate);
        return true;
      };
      // Seed the saved loadout before pruning so a search budget never hides its comparison.
      consider(base.weaponId,base.armorId,base.accessoryIds);
      consider(-1,-1,Array(slots).fill(-1));
      for (const weapon of weaponIds) if (!consider(weapon,base.armorId,base.accessoryIds)) break;
      for (const armor of armorIds) if (!consider(base.weaponId,armor,base.accessoryIds)) break;
      // Evaluate accessory pairs together: individually weak passives may have a strong combined effect.
      for (const pair of accessories) if (!consider(base.weaponId,base.armorId,pair)) break;
      const total=weaponIds.length*armorIds.length*accessories.length;
      let enumerated=0;
      // shortcut: the bounded sweep samples large spaces; raise budgets or use exact search for proof of optimality.
      const gcd=(a,b)=>b?gcd(b,a%b):a;
      let stride=Math.max(1,Math.floor(total/Math.max(1,options.perLoadoutBudget)));
      while (gcd(stride,total)!==1)stride++;
      for (let n=0;n<total;n++) {
        const flat=(n*stride)%total,ai=flat%accessories.length;
        const remainder=Math.floor(flat/accessories.length),ri=remainder%armorIds.length;
        const wi=Math.floor(remainder/armorIds.length);
        if (!consider(weaponIds[wi],armorIds[ri],accessories[ai])) break;
        enumerated++;
      }
      if (enumerated<total) {state.truncated=true;state.reasons.add('loadout budget');}
      const ranked=[...local.values()].filter(Boolean).sort((a,b)=>b.score-a.score || a.key.localeCompare(b.key));
      const keep=new Map(ranked.slice(0,options.candidatesPerVision).map(c=>[c.key,c]));
      // Keep stock alternatives: giving a scarce best item to one member can change the best team.
      const contested=new Set(ranked.slice(0,options.candidatesPerVision).flatMap(c=>C.equipmentIds(c.equipment)));
      for(const id of contested) {
        const alternate=ranked.find(c=>!C.equipmentIds(c.equipment).includes(id));
        if(alternate)keep.set(alternate.key,alternate);
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
      const empty=local.get(keyOf({weaponId:-1,armorId:-1,accessoryIds:Array(slots).fill(-1),visionId}));
      if (empty)keep.set(empty.key,empty);
      if (ranked.length>keep.size) {state.truncated=true;state.reasons.add('candidate pruning');}
      all.push(...keep.values());
      if (stopped(state))break;
    }
    return all;
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
    const worth=id=>Object.values(gear.get(id)?.stats || {}).reduce((a,b)=>a+Number(b||0),0);
    const unmodeled=(evaluation,item)=>[...(evaluation.passiveAnalysis?.unsupported || []),...(evaluation.passiveAnalysis?.deferred || [])]
      .filter(effect=>(item?.passiveIds || []).includes(effect.passiveId));
    const fillState=state?{...state,options:{...state.options,maxEvaluations:Infinity,timeMs:0}}:
      stateFor({...defaults(callbacks.options || {}),maxEvaluations:Infinity,timeMs:0});
    const slotsOf=equipment=>[['weapon',0,e=>e.weaponId,(e,id)=>({...e,weaponId:id})],['armor',0,e=>e.armorId,(e,id)=>({...e,armorId:id})],
      ...equipment.accessoryIds.map((_,i)=>['accessory',i,e=>e.accessoryIds[i],(e,id)=>({...e,accessoryIds:e.accessoryIds.map((x,j)=>j===i?id:x)})])];
    const out=members.slice();
    const partyScore=rows=>{
      const result=callbacks.evaluateParty?.(rows,{enemy:callbacks.enemy,options:fillState.options});
      return callbacks.evaluateParty?Number(result?.score):rows.reduce((sum,m)=>sum+m.score,0);
    };
    for(let memberIndex=0;memberIndex<out.length;memberIndex++){
      const member=out[memberIndex];
      const native=catalog.characters.find(c=>c.id===member.characterId);
      let best=member;
      for (const [slot,index,get,set] of slotsOf(best.equipment)) {
        if (Number(get(best.equipment))>0) continue;
        let pick=null;
        const previousPartyScore=partyScore(out);
        if(!Number.isFinite(previousPartyScore))continue;
        for (const item of catalog.equipment) {
          if ((stock.get(item.id)||0)-(used.get(item.id)||0)<1 || !C.eligible(item,native,slot)) continue;
          const c=evaluateOne(fillState,callbacks,member.characterId,member.visionId,set(best.equipment,item.id));
          if (!c || unmodeled(c.evaluation,item).length || c.score<best.score || !best.roles.every(role=>c.roles.includes(role))) continue;
          const next=out.slice();next[memberIndex]=c;
          const nextPartyScore=partyScore(next);
          if (!Number.isFinite(nextPartyScore) || nextPartyScore<previousPartyScore) continue;
          if (!pick || nextPartyScore>pick.partyScore || (nextPartyScore===pick.partyScore && (c.score>pick.c.score || c.score===pick.c.score && worth(item.id)>worth(pick.id))))pick={c,id:item.id,partyScore:nextPartyScore};
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
    if (typeof callbacks.evaluate!=='function') throw new Error('A native-mechanics evaluator is required.');
    if (!Number.isInteger(options.partySize) || options.partySize<1 || options.partySize>8) throw new Error('Party size must be between 1 and 8.');
    const native=new Set(catalog.characters.map(c=>c.id));
    const people=snapshot.characters.filter(c=>C.joined(c)&&native.has(c.id)).map(c=>c.id);
    const fixed=(options.fixedCharacterIds || []).map(Number);
    if (fixed.some(id=>!people.includes(id)) || new Set(fixed).size!==fixed.length || fixed.length>options.partySize) throw new Error('Fixed characters must be available, unique, and fit the party.');
    const teams=combinations(people.filter(id=>!fixed.includes(id)),options.partySize-fixed.length).map(ids=>[...fixed,...ids]);
    const results=[],candidateCache=new Map();
    const visionCount=1+catalog.visions.filter(v=>(snapshot.resonances || []).some(o=>o.id===v.id)).length;
    const fairBudget=Math.floor(options.maxEvaluations/Math.max(1,people.length*visionCount*(options.reserveNonParty?teams.length:1)));
    options.perLoadoutBudget=Math.min(options.perLoadoutBudget,Math.max(2,fairBudget));
    // Reserve a comparison for every character/vision before expensive search can consume the budget.
    const seedState=stateFor({...options,timeMs:0}),fallback=new Map();
    for(const id of people)fallback.set(id,buildCandidates(catalog,snapshot,id,callbacks,{...options,perLoadoutBudget:2},inventory(snapshot),seedState));
    state.cache=seedState.cache;state.evaluations=seedState.evaluations;
    let considered=0,teamCount=0;
    const partyScore=members=>{
      const detail=callbacks.evaluateParty?.(members,{enemy:callbacks.enemy,options});
      return detail && Number.isFinite(Number(detail.score))?{score:Number(detail.score),evaluation:detail}:
        {score:members.reduce((sum,m)=>sum+m.score,0),evaluation:null};
    };
    const baselineIds=(snapshot.party || []).filter(id=>people.includes(id)).slice(0,options.partySize);
    let baseline=null;
    if(baselineIds.length===options.partySize) {
      const members=baselineIds.map(id=>{
        const person=snapshot.characters.find(c=>c.id===id);
        return (fallback.get(id)||[]).find(c=>c.visionId===Number(person.equipment.visionId) && keyOf(c.equipment)===keyOf(person.equipment));
      });
      if(members.every(Boolean)) {
        const warning=validateParty(catalog,snapshot,members,options);
        baseline={members,...partyScore(members),valid:!warning,warning};
      }
    }
    for (const team of teams) {
      if (stopped(state) && results.length)break;
      teamCount++;
      const stock=options.reserveNonParty?reserveOutside(snapshot,team,inventory(snapshot)):inventory(snapshot);
      const stockKey=[...stock].sort((a,b)=>a[0]-b[0]).map(([id,n])=>`${id}:${n}`).join(',');
      const candidates=new Map();
      for(const id of team) {
        const key=`${id}:${stockKey}`;
        if(!candidateCache.has(key)) {
          const generated=stopped(state)?[]:buildCandidates(catalog,snapshot,id,callbacks,options,stock,state);
          const combined=new Map([...generated,...(fallback.get(id)||[]).filter(c=>fits(c.equipment,stock))].map(c=>[c.key,c]));
          candidateCache.set(key,[...combined.values()]);
        }
        candidates.set(id,candidateCache.get(key));
      }
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
          const score=partyScore(members);considered++;
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
    const seen=new Set(),unique=[];
    for(const result of results) {
      if(unique.length>=options.maxResults)break;
      result.members=finalizeBuilds(catalog,snapshot,result.members,result.stock,callbacks,state);
      const key=result.members.map(m=>`${m.characterId}:${m.visionId}:${keyOf(m.equipment)}`).sort().join('|');
      if(seen.has(key))continue;
      seen.add(key);unique.push(Object.assign(result,partyScore(result.members)));
    }
    unique.sort((a,b)=>b.score-a.score);
    results.length=0;results.push(...unique);
    return {approximate:state.truncated,considered,evaluations:state.evaluations,truncated:state.truncated,
      reasons:[...state.reasons],teamsConsidered:teamCount,totalTeams:teams.length,
      results:results.map(({members,score,evaluation})=>({members,score,evaluation})),baseline,elapsedMs:Date.now()-state.started};
  }
  const api={rankParties,buildCandidates,finalizeBuilds,validateParty,inventory};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);

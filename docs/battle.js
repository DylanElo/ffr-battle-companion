/* Owned-build evaluator. Native arithmetic lives in damage.js; supported effects in passives.js. */
(function(root){
  'use strict';
  const C=typeof module!=='undefined'?require('./core.js'):root.Companion;
  const P=typeof module!=='undefined'?require('./passives.js'):root.CompanionPassives;
  const D=typeof module!=='undefined'?require('./damage.js'):root.NativeDamage;
  const S=typeof module!=='undefined'?require('./stats.js'):root.CompanionStats;
  const clean=C.clean,unique=values=>[...new Set(values.filter(x=>Number(x)>0).map(Number))];
  const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const isAttack=skill=>skill && skill.relation==='Enemies' && clean(skill.parameterVariationType)==='Decrease' && clean(skill.parameterType)==='HitPoint' && number(skill.accuracy,100)===100 && number(skill.mag)>0 && ['Physic','Magic','EscapeNum','SameLevel'].includes(clean(skill.calcType)) && !['FinishBlow','LimitBurst','Summon','Mechabo','ThrowMoney'].includes(clean(skill.attr));
  // Native damage cap getter: 9999, or 99999 with a DamageLimitBreak effect (FFRS-Win64-Shipping.exe, file offset 0x5147360).
  const DAMAGE_CAP=9999,RAISED_DAMAGE_CAP=99999;
  // Turn modifiers with special command handling. Magic Boost's own damage effect (12911) is native; its 1.5x MP cost is applied here.
  const ARMS_AKIMBO=400650,DUALCAST=400730,MAGIC_BOOST=400660,MAGIC_BOOST_EFFECT=12911;
  // Limit Bursts: the 100-gauge one comes with the character; bigger ones once learned (saved activeSkillIdList).
  // Native skill rows name their owner; Archwitch Fina's rows say Darkfina.
  const LB_OWNER_ALIASES={Darkfina:1006},LB_PARAMETER=4,STAGGER_PARTY_SCALE=4;
  const LB_CHARGE_IDS=[1000,1031],LB_EXTRA_IDS=[1280,1338];
  const isHealing=skill=>skill && skill.relation==='Friendlies' && clean(skill.parameterVariationType)==='Increase' && clean(skill.parameterType)==='HitPoint' && number(skill.mag)>0;
  function knapsack(entries,budget,slots){
    const states=new Map([['0:0',{cost:0,slots:0,score:0,ids:[]}]]);
    for(const item of entries){
      if(!(item.value>0) || item.cost>budget)continue;
      const old=[...states.values()];
      for(const state of old){
        const cost=state.cost+item.cost,count=state.slots+1;
        if(cost>budget || count>slots)continue;
        const score=state.score+item.value,key=`${cost}:${count}`,current=states.get(key);
        if(!current || score>current.score)states.set(key,{cost,slots:count,score,ids:[...state.ids,item.id]});
      }
    }
    return [...states.values()].sort((a,b)=>b.score-a.score || a.cost-b.cost)[0]?.ids || [];
  }
  function createModel(catalog,snapshot,enemy,provided={}){
    if(!catalog.statGrowth || !catalog.battleRules)throw new Error('The battle catalog is missing native growth and calculation tables. Refresh game data.');
    const options={objective:'balanced',critical:false,broken:false,mpPercent:100,minHealers:0,minProtectors:0,includeSupportOptions:true,...provided};
    // Goals combine: each is the share of a bar filled per round (enemy HP, enemy stagger bar, own LB gauge),
    // so a breaker that also deals damage scores on both. Durability keeps the old balanced weighting in HP units.
    const LEGACY_GOALS={balanced:['damage','durability'],damage:['damage'],break:['stagger']};
    const goals=new Set(Array.isArray(options.goals) && options.goals.length?options.goals:LEGACY_GOALS[options.objective] || ['damage']);
    const goalKey=[...goals].sort().join('+');
    const enemyHp=Math.max(1,number(enemy.stats?.MaxHitPoint,1)),enemyBreak=Math.max(1,number(enemy.stats?.MaxBreakPoint,100));
    const goalScore=({damage=0,breakDamage=0,gauge=0,durability=0})=>(goals.has('damage')?damage/enemyHp:0)+(goals.has('stagger')?breakDamage/enemyBreak:0)+
      (goals.has('limit')?gauge/100:0)+(goals.has('durability')?durability/enemyHp:0)+(goals.has('damage')?0:damage/enemyHp*1e-3);
    const indexes=Object.fromEntries(['characters','visions','skills','passives','effects','equipment','masterSkills'].map(kind=>[kind,new Map((catalog[kind]||[]).map(row=>[row.id,row]))]));
    const savedById=new Map(snapshot.characters.map(c=>[c.id,c]));
    const savedDifficulty=clean(snapshot.player?.gameDifficulty ?? snapshot.player?.GameDifficulty ?? snapshot.player?.difficulty ?? Object.entries(snapshot.player||{}).find(([k])=>/difficulty/i.test(k))?.[1] ?? 'Normal');
    const difficultyName=options.difficulty && options.difficulty!=='save'?options.difficulty:savedDifficulty;
    const difficultyRows=catalog.difficultyRules || {};
    const difficulty=Array.isArray(difficultyRows)?difficultyRows.find(d=>clean(d.id || d.name || d.difficulty)===difficultyName):difficultyRows[difficultyName];
    const difficultyGiven=number(difficulty?.DamageGivenRate,1);
    const difficultyTaken=number(difficulty?.DamageTakenRate,1);
    const scenario={enemyId:enemy.id,enemyName:enemy.name,difficulty:difficultyName,difficultyGiven,difficultyTaken,
      broken:!!options.broken,critical:!!options.critical,mpPercent:Math.max(0,Math.min(100,number(options.mpPercent,100))),
      enemyCount:Math.max(1,number(options.enemyCount,1)),rounds:Math.max(1,Math.round(number(options.rounds,5))),
      horizon:'Round-based estimate from full HP and the selected MP percentage. Chosen actions spend MP; no MP recovery or replacement action is assumed after exhaustion. Arms Akimbo/Dualcast repeats the same attack twice.'};
    const evidence={formula:'Native executable damage helpers; see docs/damage-research.md.',stats:'Native XP/growth/seed/sync/equipment derivation; cross-save HP checks.',
      passives:'Native effect IDs, timing, conditions and additive damage bucket.',
      search:'Bounded joint search; passive packages use a knapsack surrogate and are then evaluated with native math.',
      calibration:'Static native-formula verification, not a live battle measurement.'};
    const prepCache=new Map(),analysisCache=new Map(),packageCache=new Map(),valueCache=new Map();
    const unknownArtifacts=(snapshot.artifactOverrides || []).filter(a=>a.active && !(catalog.artifacts || []).some(row=>row.id===a.id));
    const activeNativeArtifacts=(catalog.artifacts || []).filter(a=>snapshot.inventory.some(i=>i.id===a.id && i.quantity>0) && ((snapshot.artifactOverrides||[]).find(o=>o.id===a.id)?.active ?? a.initialActive));
    const globalWarnings=[];
    if(unknownArtifacts.length)globalWarnings.push(`Unmapped active artifact IDs ${unknownArtifacts.map(a=>a.id).join(', ')}: their battle effects are not inferred.`);
    if(activeNativeArtifacts.length)globalWarnings.push(`Active artifacts ${activeNativeArtifacts.map(a=>a.name || a.id).join(', ')} are listed but their modifiers are not modeled.`);
    globalWarnings.push('Native damage predictions have not been calibrated against a recorded battle. Enemy base rows may differ from the actual encounter.');
    globalWarnings.push('Numeric rankings exclude attacks below 100 native accuracy. Enemy evasion and reactive counters are not simulated.');
    // Fixed loadouts preserve every recorded equipped ability; unrecorded Mastery choices are not inferred.
    function prep(characterId,visionId,current=false,fixedSkillIds){
      const fixed=current || Array.isArray(fixedSkillIds);
      const key=`${characterId}:${visionId}:${current}:${fixed}:${Array.isArray(fixedSkillIds)?fixedSkillIds.join(','):''}`;
      if(prepCache.has(key))return prepCache.get(key);
      const saved=savedById.get(characterId),native=indexes.characters.get(characterId);
      const equipped=new Set(unique(fixedSkillIds ?? saved?.equippedSkillIds ?? [])),keep=id=>!fixed || equipped.has(id);
      const fullLearn=S.learned(catalog,snapshot,characterId,visionId),learn=fixed?{...fullLearn,masterSkillIds:fullLearn.masterSkillIds.filter(keep)}:fullLearn;
      const free=new Set([...(learn.freeActiveIds || []),...(fixed?learn.masterSkillIds.flatMap(id=>indexes.masterSkills.get(id)?.grants?.activeIds || []):[])]);
      const skills=unique([...free,...(learn.learnedActiveIds || []).filter(keep)]).map(id=>indexes.skills.get(id)).filter(Boolean);
      const stateContext={demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0,resources:{}};
      const eligibility=skill=>{
        const result=catalog.skillRules?P.skillEligibility(skill,stateContext,catalog.skillRules):{eligible:true,reasons:[],deferred:['Native action-state rules were not loaded.']};
        if(result.additionalCosts?.length || result.costOverride){result.eligible=false;result.reasons.push('Special resource cost/override is not modeled.');}
        return result;
      };
      const legalSkills=skills.filter(skill=>eligibility(skill).eligible);
      const active=legalSkills.filter(isAttack);
      const excludedActions=skills.filter(isAttack).map(skill=>({skill,result:eligibility(skill)})).filter(row=>!row.result.eligible).map(row=>`${row.skill.name}: ${[...row.result.reasons,...row.result.deferred].join('; ')}`);
      const borrowed=unique(learn.alwaysPassiveIds || []),learned=unique(learn.learnedPassiveIds || []).filter(keep);
      const support=P.supportActions(catalog,legalSkills.map(s=>s.id));
      const healSkills=legalSkills.filter(isHealing);
      const protectSkills=unique([...support.buffs.filter(a=>['physicalReductionPercent','magicReductionPercent'].includes(a.kind)).map(a=>a.skillId),
        ...legalSkills.filter(s=>s.relation==='Friendlies' && (s.effects || []).some(id=>clean(indexes.effects.get(id)?.type)==='Cover')).map(s=>s.id)]).map(id=>indexes.skills.get(id));
      const legal=new Set(legalSkills.map(s=>s.id));
      const learnedSpecials=new Set(saved?.activeSkillIds || []);
      const limits=(catalog.skills || []).filter(s=>clean(s.attr)==='LimitBurst' && (LB_OWNER_ALIASES[s.hasUnit] ?? catalog.characters.find(c=>c.name===s.hasUnit)?.id)===characterId &&
        (number(s.cost)<=100 || learnedSpecials.has(s.id)) && s.relation==='Enemies' && ['Physic','Magic'].includes(clean(s.calcType)) && number(s.mag)>0);
      const result={saved,native,learn,free,skills,active,legal,limits,borrowed,learned,support,healSkills,protectSkills,excludedActions,current,fixed,equippedIds:[...equipped]};
      prepCache.set(key,result);return result;
    }
    function analysis(ids,skill,extra={}){
      const key=ids.slice().sort((a,b)=>a-b).join(',')+':'+skill.id+':'+JSON.stringify(extra);
      if(analysisCache.has(key))return analysisCache.get(key);
      const context={skill,element:clean(skill.element),hpPercent:100,mpPercent:scenario.mpPercent,lbPercent:0,
        broken:scenario.broken,extraPhase:false,critical:scenario.critical,analyzed:false,notTargeted:false,statusIds:[],targetStatusIds:[],
        targetCount:scenario.enemyCount,buffCount:0,...extra};
      let result=P.analyze(catalog,ids,context);
      const weakness=clean(enemy.resistances?.[result.modifiers.element] || 'None')==='Weakness';
      if(context.weakness!==weakness)result=P.analyze(catalog,ids,{...context,weakness});
      // Prevent an unbounded optimization cache while retaining commonly repeated effect sets.
      if(analysisCache.size<25000)analysisCache.set(key,result);
      return result;
    }
    function rollDamage(stats,skill,passiveAnalysis,context={}){
      const magical=clean(skill.calcType)==='Magic';
      const attack=number(stats[magical?'MagicalAttack':'PhysicalAttack']);
      const element=passiveAnalysis.modifiers.element || clean(skill.element);
      const targetAnalysis=P.analyze(catalog,enemy.passiveIds || [],{skill,element,hpPercent:100,mpPercent:100,lbPercent:0,broken:scenario.broken,extraPhase:false,critical:scenario.critical,statusIds:[],targetStatusIds:[]});
      function enemyParameter(key){
        const base=number(enemy.stats?.[key]);
        const terms=targetAnalysis.terms.filter(t=>t.parameter===key && ['statFlat','statPercent'].includes(t.kind));
        if(context.targetStatPercent?.parameter===key)terms.push({kind:'statPercent',value:context.targetStatPercent.value});
        return Math.max(0,base+terms.reduce((sum,term)=>sum+S.effectDelta(base,term),0));
      }
      const attribute=magical?'Mind':'Defence',derived=magical?'MagicalDefense':'PhysicalDefense';
      const defense=number(context.defense,Math.max(1,enemyParameter(attribute)+enemyParameter(derived)));
      const originalResistance=clean(enemy.resistances?.[element] || 'None'),addedResistance=targetAnalysis.modifiers.resistances[element] || 'None';
      const priority={None:0,Weakness:25,Halved:50,Invalid:75,Absorb:100};
      const resistance=priority[addedResistance]>priority[originalResistance]?addedResistance:originalResistance;
      // Native target Deffence effects multiply individually; they are not one additive percentage bucket.
      const incomingFactor=targetAnalysis.terms.filter(term=>term.kind===(magical?'magicReductionPercent':'physicalReductionPercent'))
        .reduce((product,term)=>Math.fround(product*Math.fround(Math.max(0,Math.min(100,100-number(term.value)))/100+2**-23)),1);
      const factor=number(catalog.battleRules.elementResistanceValues?.[`eResistance::${resistance}`] ?? catalog.battleRules.elementResistanceValues?.[resistance],{None:1,Weakness:1.5,Halved:0.5,Invalid:0,Absorb:-1}[resistance]??1);
      const common={attack,defense,level:stats.level || context.level,targetLevel:number(enemy.level,1),skill,elementFactor:factor,
        outgoingFactor:Math.max(0,passiveAnalysis.damageFactor+number(context.additionalDamagePercent)/100)*incomingFactor,
        criticalBonus:number(passiveAnalysis.modifiers.critDamagePercent)/100,broken:context.broken ?? scenario.broken,exPhase:false,
        difficultyGiven:scenario.difficultyGiven,rules:catalog.battleRules,
        coefficientScale:1+number(passiveAnalysis.modifiers.coefficientPerLevel)*Math.trunc(number(stats.level || context.level,1)),damageCap:passiveAnalysis.modifiers.damageCapRaised?RAISED_DAMAGE_CAP:DAMAGE_CAP,
        successfulEscapes:number(snapshot.player?.escapeCount ?? snapshot.player?.escapeNum ?? snapshot.player?.successfulEscapes,NaN)};
      const ratios=(skill.ratios || []).slice(0,Math.max(1,number(skill.hits,1))).map(Number).filter(v=>v>0);
      const useRatios=ratios.length?ratios:[1];
      let expected=0,min=0,max=0,breakDamage=0;
      const critRate=number(skill.criticalHitRate)+number(passiveAnalysis.modifiers.critRatePercent);
      const criticalChance=scenario.critical?1:D.criticalProbability(critRate);
      for(const hitRatio of useRatios){
        const critAnalysis=context.criticalAnalysis || passiveAnalysis;
        const criticalInput={...common,hitRatio,critical:true,
          attack:context.criticalStats?number(context.criticalStats[magical?'MagicalAttack':'PhysicalAttack']):common.attack,
          outgoingFactor:Math.max(0,critAnalysis.damageFactor+number(context.additionalDamagePercent)/100)*incomingFactor,
          criticalBonus:number(critAnalysis.modifiers.critDamagePercent)/100,damageCap:critAnalysis.modifiers.damageCapRaised?RAISED_DAMAGE_CAP:DAMAGE_CAP};
        const normal=D.damage({...common,hitRatio,critical:false}),critical=D.damage(criticalInput);
        if(!normal.supported)return {...normal,damage:0,damageMin:0,damageMax:0};
        if(normal.healsTarget)return {supported:true,damage:0,damageMin:0,damageMax:0,absorbed:true,element,resistance,common};
        expected+=normal.amount*(1-criticalChance)+critical.amount*criticalChance;
        min+=criticalChance===1?critical.min:normal.min;
        max+=criticalChance>0?critical.max:normal.max;
        if(typeof D.breakDamage==='function'){
          const breakFactor=number(catalog.battleRules.breakElementResistanceValues?.[`eResistance::${resistance}`] ?? catalog.battleRules.breakElementResistanceValues?.[resistance],{None:1,Weakness:3,Halved:.5,Invalid:0,Absorb:0}[resistance]??1);
          const input={skill,level:common.level,targetLevel:number(enemy.level,1),elementFactor:breakFactor,outgoingFactor:passiveAnalysis.breakFactor,rules:catalog.battleRules,hitRatio};
          const normalBreak=D.breakDamage({...input,critical:false}),criticalBreak=D.breakDamage({...input,critical:true});
          breakDamage+=normalBreak.amount*(1-criticalChance)+criticalBreak.amount*criticalChance;
        }
      }
      return {supported:true,damage:expected,damageMin:min,damageMax:max,element,resistance,criticalChance,
        breakDamage,breakVerified:typeof D.breakDamage==='function',common};
    }
    function gearPassives(equipment){return unique(C.equipmentIds(equipment).flatMap(id=>indexes.equipment.get(id)?.passiveIds || []));}
    function passivePackage(prepared,visionId,skill,equipment,freeIds,turn={reservedIds:[],context:{}}){
      if(prepared.fixed){
        const masterIds=prepared.equippedIds.filter(id=>indexes.masterSkills.has(id));
        const ids=prepared.equippedIds.filter(id=>indexes.passives.has(id));
        const equippedIds=prepared.equippedIds.filter(id=>id!==skill.id && !turn.reservedIds.includes(id));
        const activeEquipped=prepared.equippedIds.includes(skill.id);
        return {ids,masterIds,passiveIds:unique([...ids,...masterIds.flatMap(id=>indexes.masterSkills.get(id)?.grants?.passiveIds || [])]),
          equippedIds,freeActiveIds:activeEquipped?[...prepared.free].filter(id=>id!==skill.id):[...prepared.free],
          cost:equipCostOf(equippedIds)+(activeEquipped?number(skill.equipCost):0),activeCost:activeEquipped?number(skill.equipCost):0,activeSlots:activeEquipped?1:0};
      }
      const stats0=S.characterStats(catalog,snapshot,prepared.saved.id,equipment,[]);
      const reservedCost=equipCostOf(turn.reservedIds);
      const totalBudget=number(stats0.skillBudget,prepared.learn.skillBudget)-reservedCost,totalSlots=number(stats0.maxSkillSlots,8)-turn.reservedIds.length;
      const effectiveElement=analysis(freeIds,skill).modifiers.element;
      const key=`${prepared.saved.id}:${visionId}:${prepared.current}:${skill.id}:${effectiveElement}:${totalBudget}:${totalSlots}:${goalKey}:${turn.reservedIds.join(',')}`;
      if(packageCache.has(key))return packageCache.get(key);
      const reference=prepared.saved.equipment;
      const baseIds=unique(prepared.borrowed),baseAnalysis=analysis(baseIds,skill,turn.context);
      const baseFinal=S.characterStats(catalog,snapshot,prepared.saved.id,reference,baseAnalysis.terms);
      baseFinal.stats.level=baseFinal.level;
      const baseline=rollDamage(baseFinal.stats,skill,baseAnalysis,{level:baseFinal.level});
      // A passive set's value uses the saved reference gear, so it is shared across loadouts, budgets and reserved abilities.
      const valuePrefix=`${prepared.saved.id}:${visionId}:${skill.id}:${effectiveElement}:${JSON.stringify(turn.context)}:`;
      function valueOf(ids){
        const valueKey=valuePrefix+ids.slice().sort((a,b)=>a-b).join(',');
        if(!valueCache.has(valueKey) && valueCache.size<200000)valueCache.set(valueKey,computeValue(ids));
        return valueCache.get(valueKey) ?? computeValue(ids);
      }
      function computeValue(ids){
        const candidateAnalysis=analysis(unique([...baseIds,...ids]),skill,{element:effectiveElement,...turn.context});
        const final=S.characterStats(catalog,snapshot,prepared.saved.id,reference,candidateAnalysis.terms);final.stats.level=final.level;
        const calculated=rollDamage(final.stats,skill,candidateAnalysis,{level:final.level});
        const value=goalScore({damage:Math.max(0,calculated.damage-baseline.damage),breakDamage:Math.max(0,calculated.breakDamage-baseline.breakDamage),
          durability:Math.max(0,number(final.stats.MaxHitPoint)-number(baseFinal.stats.MaxHitPoint))*.05+
          Math.max(0,number(final.stats.PhysicalDefense)-number(baseFinal.stats.PhysicalDefense))*2+
          Math.max(0,number(final.stats.MagicalDefense)-number(baseFinal.stats.MagicalDefense))*2});
        return Number.isFinite(value)?value:0;
      }
      const masters=(prepared.learn.masterSkillIds || []).map(id=>indexes.masterSkills.get(id)).filter(m=>m && m.grants && ((m.grants.passiveIds || []).length || (m.grants.activeIds || []).length));
      const source=id=>indexes.passives.get(id) || indexes.masterSkills.get(id);
      const expanded=ids=>unique(ids.flatMap(id=>indexes.masterSkills.get(id)?.grants?.passiveIds || [id]));
      const freeSkills=ids=>new Set([...prepared.free,...ids.flatMap(id=>indexes.masterSkills.get(id)?.grants?.activeIds || [])]);
      const forced=[null,...masters.filter(m=>(m.grants.activeIds || []).includes(skill.id))];
      let result=null,bestValue=-Infinity;
      for(const fixed of forced){
        const fixedIds=fixed?[fixed.id]:[],fixedPassives=expanded(fixedIds),activeFree=freeSkills(fixedIds).has(skill.id);
        const activeCost=activeFree?0:number(skill.equipCost),activeSlots=activeFree?0:1;
        const fixedCost=fixed?number(fixed.equipCost):0;
        const budget=totalBudget-activeCost-fixedCost,slots=totalSlots-activeSlots-fixedIds.length;
        if(budget<0 || slots<0)continue;
        const fixedValue=valueOf(fixedPassives),entries=[];
        for(const id of unique([...prepared.learned,...masters.map(m=>m.id)])){
          if(fixedIds.includes(id) || fixedPassives.includes(id) || baseIds.includes(id) || turn.reservedIds.includes(id))continue;
          const item=source(id);if(!item)continue;
          const value=Math.max(0,valueOf(unique([...fixedPassives,...expanded([id])]))-fixedValue);
          if(value>0)entries.push({id,cost:Math.max(0,number(item.equipCost)),value});
        }
        const selected=unique([...fixedIds,...knapsack(entries,budget,slots)]);
        const masterIds=selected.filter(id=>indexes.masterSkills.has(id));
        const covered=new Set(expanded(masterIds));
        const ids=selected.filter(id=>indexes.passives.has(id) && !covered.has(id));
        const equippedIds=unique([...masterIds,...ids]);
        const allPassiveIds=expanded(equippedIds);
        const finalFree=freeSkills(masterIds),finalActiveFree=finalFree.has(skill.id);
        const cost=equippedIds.reduce((sum,id)=>sum+number(source(id)?.equipCost),0)+(finalActiveFree?0:number(skill.equipCost));
        const count=equippedIds.length+(finalActiveFree?0:1);
        if(cost>totalBudget || count>totalSlots)continue;
        const value=valueOf(allPassiveIds);
        if(value>bestValue || value===bestValue && (!result || cost<result.cost)){
          bestValue=value;result={ids,passiveIds:allPassiveIds,masterIds,equippedIds,freeActiveIds:[...finalFree],cost,
            activeCost:finalActiveFree?0:number(skill.equipCost),activeSlots:finalActiveFree?0:1};
        }
      }
      if(!result)result={ids:[],passiveIds:[],masterIds:[],equippedIds:[],freeActiveIds:[...prepared.free],cost:prepared.free.has(skill.id)?0:number(skill.equipCost),activeCost:prepared.free.has(skill.id)?0:number(skill.equipCost),activeSlots:prepared.free.has(skill.id)?0:1};
      packageCache.set(key,result);return result;
    }
    const equipCostOf=ids=>ids.reduce((sum,id)=>sum+number((indexes.skills.get(id) || indexes.passives.get(id) || indexes.masterSkills.get(id))?.equipCost),0);
    // LB gauge passives: fill-rate multiplier (IncreaseParameterVariation on LimitBurstPoint; strongest one counts),
    // flat fill when this unit staggers (ParameterVariation at Break) and refund after a Limit Burst (Recuperate).
    function limitTraits(passiveIds){
      const traits={mult:1,fillOnStagger:0,recuperate:0};
      for(const id of passiveIds)for(const bundle of indexes.passives.get(id)?.effectBundles || []){
        const effect=indexes.effects.get(Number(bundle.effectId));
        if(!effect || Number(effect.params?.[1])!==LB_PARAMETER)continue;
        const value=number(effect.params[0]);
        if(clean(effect.type)==='IncreaseParameterVariation')traits.mult=Math.max(traits.mult,value/100);
        else if(clean(effect.type)==='ParameterVariation' && clean(effect.applyTiming)==='Break')traits.fillOnStagger+=value;
        else if(clean(effect.type)==='ParameterVariation' && clean(bundle.passiveSkillAddTiming)==='ActivateLimitBurst')traits.recuperate+=value;
      }
      return traits;
    }
    const limitCache=new Map();
    function limitInfo(prepared,equipment,passiveIds){
      const key=`${prepared.saved.id}:${C.equipmentIds(equipment).join(',')}:${passiveIds.slice().sort((a,b)=>a-b).join(',')}`;
      if(!limitCache.has(key))limitCache.set(key,computeLimitInfo(prepared,equipment,passiveIds));
      return limitCache.get(key);
    }
    function computeLimitInfo(prepared,equipment,passiveIds){
      const traits=limitTraits(passiveIds),max=prepared.limits.some(s=>number(s.cost)>100)?200:100;
      const options=prepared.limits.map(skill=>{
        const selfEffects=(skill.effectBundles || []).filter(b=>Number(b.effectId)>0 && clean(b.TargetType)==='Self').map(b=>Number(b.effectId));
        const passiveAnalysis=analysis(passiveIds,skill,{activeEffectIds:selfEffects});
        const final=S.characterStats(catalog,snapshot,prepared.saved.id,equipment,passiveAnalysis.terms);
        const r=rollDamage({...final.stats,level:final.level},skill,passiveAnalysis,{level:final.level});
        if(!r.supported)return null;
        const brokenAnalysis=analysis(passiveIds,skill,{activeEffectIds:selfEffects,broken:true});
        const brokenFinal=S.characterStats(catalog,snapshot,prepared.saved.id,equipment,brokenAnalysis.terms);
        const b=scenario.broken?r:rollDamage({...brokenFinal.stats,level:brokenFinal.level},skill,brokenAnalysis,{level:brokenFinal.level,broken:true});
        return {skillId:skill.id,cost:number(skill.cost),damage:r.damage,brokenDamage:b.damage,breakDamage:number(r.breakDamage)};
      }).filter(Boolean);
      return {...traits,max,options};
    }
    // Rounds in Agility order. Hits after a stagger, and through the next round, use staggered damage (native
    // breakDamageMagnification and on-stagger effects). A stagger gives everyone the native breakLBIncrease and its
    // dealer Fill LB on Stagger, scaled by each unit's fill rate. Damage taken is not simulated.
    function simulateFight(members,breakScale=1){
      const rounds=scenario.rounds,gain=number(catalog.battleRules.breakLBIncrease,25);
      const value=(o,staggered)=>{
        const hit=staggered?number(o.brokenDamage,o.damage):o.damage;
        return goals.has('damage') || goals.has('stagger')?(goals.has('damage')?hit/enemyHp:0)+(goals.has('stagger')?o.breakDamage/enemyBreak:0):hit;
      };
      const state=members.map(m=>({m,gauge:0,gained:0,uses:[],mp:number(m.availableMp),mpExhaustedRounds:[]})),order=state.slice().sort((a,b)=>number(b.m.agility)-number(a.m.agility));
      const fill=(s,amount)=>{const before=s.gauge;s.gauge=Math.min(s.m.limit.max,s.gauge+amount);s.gained+=s.gauge-before;};
      let damage=0,breakDamage=0,gauge=0,recoverAt=0,staggers=0,firstStagger=0;
      for(let round=1;round<=rounds;round++)for(const s of order){
        const staggered=scenario.broken || round<recoverAt,lb=s.m.limit;
        const turn={damage:s.m.damage,brokenDamage:s.m.brokenDamage,breakDamage:s.m.breakDamage};
        // With the Limit Burst goal ticked it fires as soon as it is ready; otherwise only when it beats the normal turn.
        const burst=(lb?.options || []).filter(o=>o.cost<=s.gauge && (goals.has('limit') || value(o,staggered)>value(turn,staggered))).sort((a,b)=>value(b,staggered)-value(a,staggered))[0];
        if(burst){s.gauge-=burst.cost;fill(s,lb.recuperate*lb.mult);s.uses.push({round,skillId:burst.skillId});}
        let act=burst || turn;
        if(!burst){
          if(number(s.m.turnMp)>s.mp){s.mpExhaustedRounds.push(round);act={damage:0,brokenDamage:0,breakDamage:0};}
          else s.mp-=number(s.m.turnMp);
        }
        damage+=staggered?number(act.brokenDamage,act.damage):act.damage;breakDamage+=act.breakDamage;
        if(staggered)continue;
        gauge+=act.breakDamage*breakScale;
        if(gauge<enemyBreak)continue;
        gauge=0;recoverAt=round+2;staggers++;firstStagger||=round;
        for(const o of state)if(o.m.limit)fill(o,gain*o.m.limit.mult);
        if(lb)fill(s,lb.fillOnStagger*lb.mult);
      }
      return {damage:damage/rounds,breakDamage:breakDamage/rounds,staggers,firstStagger,
        uses:Object.fromEntries(state.map(s=>[s.m.id,s.uses])),gauge:Object.fromEntries(state.map(s=>[s.m.id,s.gained/rounds])),
        mpExhaustedRounds:Object.fromEntries(state.map(s=>[s.m.id,s.mpExhaustedRounds])),remainingMp:Object.fromEntries(state.map(s=>[s.m.id,s.mp]))};
    }
    // Ways to spend a turn on this attack: plain, Magic Boost (magic damage), Arms Akimbo or Dualcast (spells) for two actions.
    // ponytail: the second action repeats the first attack; mixed pairs (e.g. buff + attack) are not searched.
    function turnsFor(prepared,skill){
      const has=id=>prepared.legal.has(id),boosts=[false],multis=[null];
      if(has(MAGIC_BOOST) && clean(skill.dmgType)==='Magic')boosts.push(true);
      if(has(ARMS_AKIMBO))multis.push(ARMS_AKIMBO);
      if(has(DUALCAST) && clean(skill.attr)==='Magic')multis.push(DUALCAST);
      const turns=[];
      for(const boost of boosts)for(const multi of multis){
        const reservedIds=[...(boost?[MAGIC_BOOST]:[]),...(multi?[multi]:[])].filter(id=>!prepared.free.has(id));
        const actions=multi?2:1,perAction=boost?Math.ceil(number(skill.cost)*1.5):number(skill.cost);
        turns.push({reservedIds,reservedCost:equipCostOf(reservedIds),actions,multi,boost,
          mp:actions*perAction+(multi?number(indexes.skills.get(multi)?.cost):0),context:boost?{activeEffectIds:[MAGIC_BOOST_EFFECT]}:{}});
      }
      return turns;
    }
    function evaluate({characterId,visionId,equipment,current=false,equippedSkillIds}){
      const prepared=prep(characterId,visionId,current,equippedSkillIds);
      if(!prepared.saved || !C.joined(prepared.saved))return {valid:false,score:-Infinity};
      if(prepared.fixed){
        const allowed=new Set([...prepared.learn.learnedActiveIds,...prepared.learn.learnedPassiveIds,...prepared.learn.masterSkillIds,...prepared.free]);
        if(prepared.equippedIds.some(id=>!allowed.has(id)))return {valid:false,score:-Infinity,reason:'The fixed ability loadout contains an unknown or unlearned ability.'};
      }
      const freeIds=unique([...prepared.borrowed,...gearPassives(equipment)]),results=[];
      const consider=(skill,turn)=>{
        const packageInfo=passivePackage(prepared,visionId,skill,equipment,freeIds,turn);
        const allPassives=unique([...freeIds,...packageInfo.passiveIds]);
        const passiveAnalysis=analysis(allPassives,skill,turn.context);
        const calculated=S.characterStats(catalog,snapshot,characterId,equipment,passiveAnalysis.terms);
        const stats={...calculated.stats,level:calculated.level};
        const criticalAnalysis=analysis(allPassives,skill,{critical:true,...turn.context});
        const criticalStats=S.characterStats(catalog,snapshot,characterId,equipment,criticalAnalysis.terms).stats;
        const availableMp=Math.floor(number(stats.MaxMagicPoint ?? stats.MagicPoint)*scenario.mpPercent/100);
        if(turn.mp>availableMp || packageInfo.cost+turn.reservedCost>calculated.skillBudget || packageInfo.equippedIds.length+packageInfo.activeSlots+turn.reservedIds.length>calculated.maxSkillSlots)return;
        const single=rollDamage(stats,skill,passiveAnalysis,{level:calculated.level,criticalAnalysis,criticalStats});
        if(!single.supported)return;
        let staggeredSingle=single;
        if(!scenario.broken){
          const brokenAnalysis=analysis(allPassives,skill,{...turn.context,broken:true});
          const brokenFinal=S.characterStats(catalog,snapshot,characterId,equipment,brokenAnalysis.terms);
          staggeredSingle=rollDamage({...brokenFinal.stats,level:brokenFinal.level},skill,brokenAnalysis,{level:brokenFinal.level,broken:true});
        }
        const damage={...single,damage:single.damage*turn.actions,damageMin:single.damageMin*turn.actions,damageMax:single.damageMax*turn.actions,
          brokenDamage:staggeredSingle.damage*turn.actions,breakDamage:single.breakDamage*turn.actions};
        const cost=packageInfo.cost+turn.reservedCost,selected=[...packageInfo.equippedIds,...turn.reservedIds],packageFree=new Set(packageInfo.freeActiveIds),activeSelected=packageFree.has(skill.id)?[]:[skill.id];
        const supports=[];
        let supportCost=cost,slotsUsed=selected.length+activeSelected.length;
        function ensureSupport(candidates,role){
          const affordable=candidates.filter(Boolean).filter(s=>number(s.cost)<=availableMp).sort((a,b)=>(packageFree.has(a.id)?0:number(a.equipCost))-(packageFree.has(b.id)?0:number(b.equipCost)));
          for(const action of affordable){
            const alreadyFree=packageFree.has(action.id) || activeSelected.includes(action.id) || selected.includes(action.id);
            if((prepared.fixed || !options.includeSupportOptions) && !alreadyFree)continue;
            const extra=alreadyFree?0:number(action.equipCost),extraSlots=alreadyFree?0:1;
            if(supportCost+extra>calculated.skillBudget || slotsUsed+extraSlots>calculated.maxSkillSlots)continue;
            if(extraSlots){activeSelected.push(action.id);supportCost+=extra;slotsUsed++;}
            supports.push({role,skillId:action.id});return true;
          }
          return false;
        }
        const canHeal=ensureSupport(prepared.healSkills,'healer'),canProtect=ensureSupport(prepared.protectSkills,'protector');
        for(const supportId of unique([...prepared.support.buffs,...prepared.support.debuffs].filter(a=>['damagePercent','statPercent'].includes(a.kind)).map(a=>a.skillId)).slice(0,3))ensureSupport([indexes.skills.get(supportId)],'support');
        const legalSkills=new Set([...packageFree,...activeSelected,...selected]);
        const supportActions=[...prepared.support.buffs,...prepared.support.debuffs].filter(a=>legalSkills.has(a.skillId) && number(a.mpCost)<=availableMp && number(a.probability,100)===100 && number(a.activationProbability,100)===100);
        const survivability=number(stats.MaxHitPoint)*.02+number(stats.PhysicalDefense)+number(stats.MagicalDefense);
        const limit=prepared.limits.length?limitInfo(prepared,equipment,unique([...allPassives,...turn.reservedIds])):null;
        const fight=simulateFight([{id:characterId,agility:stats.Agility,damage:damage.damage,brokenDamage:damage.brokenDamage,breakDamage:damage.breakDamage,limit,availableMp,turnMp:turn.mp}],STAGGER_PARTY_SCALE);
        const score=goalScore({damage:fight.damage,breakDamage:damage.breakVerified?fight.breakDamage:0,gauge:fight.gauge[characterId],durability:survivability*.5});
        const warnings=[...(calculated.warnings || []),...(prepared.learn.warnings || [])];
        if(packageInfo.masterIds.length)warnings.push('Spirit bundles use native mastery grants and their descriptions; exact runtime expansion has not been traced.');
        if(prepared.excludedActions.length)warnings.push(`Actions excluded by native state/resource rules: ${prepared.excludedActions.join(' | ')}`);
        if(!catalog.skillRules)warnings.push('Action-state rules were not loaded; this is an arithmetic-only check.');
        if(!damage.breakVerified && goals.has('stagger'))warnings.push('Stagger damage formula is not implemented; this objective is unavailable.');
        if(turn.multi)warnings.push(`${indexes.skills.get(turn.multi).name}: both actions use ${skill.name}; native limits on repeating it are not verified.`);
        if(turn.boost)warnings.push('Magic Boost: assumed MP cost rounds up; with Dualcast it boosts both spells (not verified).');
        if(fight.mpExhaustedRounds[characterId].length)warnings.push(`Not enough MP for the chosen action in rounds ${fight.mpExhaustedRounds[characterId].join(', ')}; those turns contribute no damage. MP recovery and replacement actions are not modeled.`);
        results.push({valid:true,score,...damage,turn,limit,fightDamage:fight.damage,fightBreakDamage:fight.breakDamage,limitUses:fight.uses[characterId],gaugePerRound:fight.gauge[characterId],firstStagger:fight.firstStagger,mpExhaustedRounds:fight.mpExhaustedRounds[characterId],remainingMp:fight.remainingMp[characterId],skillId:skill.id,actionCount:turn.actions,multiActionId:turn.multi,magicBoost:turn.boost,turnMp:turn.mp,singleDamage:single.damage,skillCost:supportCost,skillBudget:calculated.skillBudget,maxSkillSlots:calculated.maxSkillSlots,
          passiveIds:packageInfo.passiveIds,equippedSkillIds:unique([...selected,...activeSelected]),alwaysPassiveIds:freeIds,stats,level:calculated.level,
          canHeal,canProtect,supportTags:supports.map(s=>s.role),supportSkillIds:supports.map(s=>s.skillId),supportActions,
          appliedSynergies:passiveAnalysis.applied.map(t=>({name:t.passiveName || t.type,reason:`${t.passiveName || t.type}: ${t.kind} ${t.value ?? t.element} ${t.parameter || ''}`})),
          passiveAnalysis,criticalAnalysis,criticalStats,coverage:passiveAnalysis.coverage,warnings,availableMp});
      };
      for(const skill of prepared.active)for(const turn of turnsFor(prepared,skill))consider(skill,turn);
      // Retry the best turns with LB gauge passives reserved; they only pay off through Limit Bursts in the fight simulation.
      // Only the strongest learned fill-rate passive is tried (Triple over Double), on the best turn.
      const charges=LB_CHARGE_IDS.filter(id=>prepared.learned.includes(id)).slice(-1),extras=LB_EXTRA_IDS.filter(id=>prepared.learned.includes(id));
      if(!prepared.fixed && prepared.limits.length && charges.length+extras.length){
        const sets=[];
        for(const charge of [null,...charges])for(let mask=0;mask<(1<<extras.length);mask++){
          const ids=[...(charge?[charge]:[]),...extras.filter((_,i)=>mask&(1<<i))];
          if(ids.length)sets.push(ids);
        }
        for(const base of results.slice().sort((a,b)=>b.score-a.score).slice(0,1))for(const ids of sets){
          const reservedIds=[...base.turn.reservedIds,...ids];
          consider(indexes.skills.get(base.skillId),{...base.turn,reservedIds,reservedCost:equipCostOf(reservedIds)});
        }
      }
      if(!results.length)return {valid:false,score:-Infinity,reason:'No supported, affordable, legally learned ordinary attack.'};
      // Ties go to the cheaper loadout, so abilities that change nothing for these goals aren't equipped.
      return results.sort((a,b)=>b.score-a.score || b.damage-a.damage || a.turn.reservedIds.length-b.turn.reservedIds.length)[0];
    }
    function evaluateParty(members){
      const baseline=members.reduce((sum,m)=>sum+m.evaluation.damage,0);
      const baselineBreak=members.reduce((sum,m)=>sum+number(m.evaluation.breakDamage),0);
      let damage=baseline,breakDamage=baselineBreak,supportDescription='',supportUsed=null,actionOverrides={};
      const simulate=overrides=>simulateFight(members.map(m=>{
        const e={...m.evaluation,...overrides[m.characterId]};
        return {id:m.characterId,agility:e.stats.Agility,damage:e.damage,brokenDamage:e.brokenDamage,breakDamage:number(e.breakDamage),limit:e.limit,availableMp:e.availableMp,turnMp:e.turnMp};
      }));
      let fight=simulate({});
      const fightScore=f=>goalScore({damage:f.damage,breakDamage:f.breakDamage,gauge:members.reduce((sum,m)=>sum+number(f.gauge[m.characterId]),0)/Math.max(1,members.length)});
      // A support action replaces its caster's attack. No free pre-buff or off-turn setup.
      for(const caster of members){
        if(!goals.has('damage'))break;
        for(const action of caster.evaluation.supportActions || []){
          if(!['damagePercent','statPercent'].includes(action.kind))continue;
          if(isAttack(indexes.skills.get(action.skillId)))continue;
          const supportMp=number(action.mpCost,number(indexes.skills.get(action.skillId)?.cost));
          // Same-turn support is recast each round; partial buff uptime and MP recovery are not inferred.
          if(supportMp*scenario.rounds>number(caster.evaluation.availableMp))continue;
          const casterAgility=number(caster.evaluation.stats.Agility);
          const recipients=members.filter(m=>m!==caster && number(m.evaluation.stats.Agility)<=casterAgility);
          if(!recipients.length)continue;
          if(action.kind==='statPercent' && !['Defence','Mind'].includes(action.parameter))continue;
          if(action.rootRelation==='Enemies' && number(enemy.statusResistances?.[action.parameter==='Defence'?'DeffenceDown':'MindDown'])>0)continue;
          const groups=action.rootRelation==='Enemies' || /All|Multi/.test(action.rootTarget)?[recipients]:recipients.map(m=>[m]);
          for(const targets of groups){
            let next=baseline-caster.evaluation.damage;
            let nextBreak=baselineBreak-number(caster.evaluation.breakDamage);
            const overrides={[caster.characterId]:{skillId:action.skillId,damage:0,damageMin:0,damageMax:0,brokenDamage:0,breakDamage:0,turnMp:supportMp,actionCount:1,multiActionId:null,magicBoost:false,limit:null,actionDescription:'Recasts a support action each round instead of attacking.'}};
            for(const target of targets){
              const evaluation=target.evaluation,skill=indexes.skills.get(evaluation.skillId);
              if(action.tests?.some(test=>test.key==='skill.dmgType' && clean(skill.dmgType)!==clean(test.value)))continue;
              if((action.tests || []).some(test=>test.key!=='skill.dmgType'))continue;
              if(action.kind==='statPercent' && action.parameter!==(clean(skill.calcType)==='Magic'?'Mind':'Defence'))continue;
              const context=action.kind==='damagePercent'?{additionalDamagePercent:action.value}:
                {targetStatPercent:{parameter:action.parameter,value:action.value}};
              const revised=rollDamage(evaluation.stats,skill,evaluation.passiveAnalysis,{level:evaluation.level,criticalAnalysis:evaluation.criticalAnalysis,criticalStats:evaluation.criticalStats,...context});
              const brokenAnalysis=analysis(unique([...evaluation.alwaysPassiveIds,...evaluation.passiveIds]),skill,{...evaluation.turn?.context,broken:true});
              const brokenStats=S.characterStats(catalog,snapshot,target.characterId,target.equipment || savedById.get(target.characterId)?.equipment,brokenAnalysis.terms);
              const revisedBroken=rollDamage({...brokenStats.stats,level:brokenStats.level},skill,brokenAnalysis,{level:brokenStats.level,...context,broken:true});
              const n=number(evaluation.actionCount,1);
              next+=revised.damage*n-evaluation.damage;
              nextBreak+=number(revised.breakDamage)*n-number(evaluation.breakDamage);
              overrides[target.characterId]={skillId:skill.id,damage:revised.damage*n,damageMin:revised.damageMin*n,damageMax:revised.damageMax*n,brokenDamage:revisedBroken.damage*n,breakDamage:revised.breakDamage*n,actionDescription:`Receives ${action.name} before acting.`};
            }
            const nextFight=simulate(overrides);
            if(fightScore(nextFight)>fightScore(fight)){fight=nextFight;damage=next;breakDamage=nextBreak;actionOverrides=overrides;supportUsed={characterId:caster.characterId,skillId:action.skillId,targetIds:targets.map(m=>m.characterId)};
              supportDescription=`${indexes.characters.get(caster.characterId).name} uses ${action.name} instead of attacking; only allies acting later by Agility receive the same-turn benefit.`;}
          }
        }
      }
      const roundDamage=damage,roundBreakDamage=breakDamage;
      damage=fight.damage;breakDamage=fight.breakDamage;
      const defenseScore=members.reduce((sum,m)=>sum+number(m.evaluation.stats.MaxHitPoint)*.01+(number(m.evaluation.stats.PhysicalDefense)+number(m.evaluation.stats.MagicalDefense))*.5,0);
      const gaugePerRound=members.reduce((sum,m)=>sum+number(fight.gauge[m.characterId]),0)/Math.max(1,members.length);
      const score=goalScore({damage,breakDamage,gauge:gaugePerRound,durability:defenseScore});
      return {score,damage,breakDamage,roundDamage,roundBreakDamage,limitUses:fight.uses,gauge:fight.gauge,mpExhaustedRounds:fight.mpExhaustedRounds,remainingMp:fight.remainingMp,staggers:fight.staggers,firstStagger:fight.firstStagger,rounds:scenario.rounds,supportUsed,supportDescription,actionOverrides,warnings:globalWarnings,
        baselineDamage:baseline,goals:[...goals],objectiveWeights:'Sum of shares filled per round: enemy HP (damage), enemy stagger bar (stagger), average LB gauge (limit), durability in enemy-HP units.'};
    }
    function explainAbilities({characterId,visionId,equipment,evaluation}){
      const ids=evaluation.equippedSkillIds || [];
      const fixed=evaluate({characterId,visionId,equipment,equippedSkillIds:ids});
      return ids.map(id=>{
        const without=evaluate({characterId,visionId,equipment,equippedSkillIds:ids.filter(other=>other!==id)});
        const metrics=without.valid?{valid:true,damage:without.fightDamage,stagger:without.fightBreakDamage,score:without.score}: {valid:false,reason:without.reason};
        return {id,cost:equipCostOf([id]),without:metrics,
          damageDelta:fixed.valid && without.valid?fixed.fightDamage-without.fightDamage:null,
          staggerDelta:fixed.valid && without.valid?fixed.fightBreakDamage-without.fightBreakDamage:null,
          scoreDelta:fixed.valid && without.valid?fixed.score-without.score:null};
      });
    }
    return {evaluate,evaluateParty,explainAbilities,scenario,evidence,globalWarnings,prep};
  }
  // "Any fight": a neutral boss at the party's average level, with the median stats of the bosses nearest that level
  // and no elemental weaknesses, resistances, passives or status resistances, so no element or matchup is favoured.
  const GENERAL_ENEMY_ID='general';
  function generalEnemy(catalog,snapshot){
    const levels=snapshot.characters.filter(C.joined).filter(c=>catalog.characters.some(n=>n.id===c.id))
      .map(c=>S.characterStats(catalog,snapshot,c.id,c.equipment,[]).level).filter(Number.isFinite);
    const level=Math.max(1,Math.round(levels.reduce((a,b)=>a+b,0)/Math.max(1,levels.length)));
    const bosses=(catalog.enemies || []).filter(e=>e.isBoss && e.stats).sort((a,b)=>Math.abs(a.level-level)-Math.abs(b.level-level)).slice(0,7);
    const median=key=>{const v=bosses.map(e=>number(e.stats[key])).sort((a,b)=>a-b);return v.length?v[v.length>>1]:0;};
    const stats=Object.fromEntries(Object.keys(bosses[0]?.stats || {}).map(key=>[key,median(key)]));
    return {id:GENERAL_ENEMY_ID,name:'Any fight',level,isBoss:true,general:true,basis:bosses.map(e=>e.name),stats,
      resistances:Object.fromEntries(['Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'].map(e=>[e,'None'])),
      statusResistances:{},skillIds:[],passiveIds:[]};
  }
  const api={createModel,knapsack,isAttack,isHealing,generalEnemy,GENERAL_ENEMY_ID};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionBattle=api;
})(typeof globalThis!=='undefined'?globalThis:this);

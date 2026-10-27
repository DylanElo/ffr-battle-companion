/* Owned-build evaluator. Native arithmetic lives in damage.js; supported effects in passives.js. */
(function(root){
  'use strict';
  const C=typeof module!=='undefined'?require('./core.js'):root.Companion;
  const P=typeof module!=='undefined'?require('./passives.js'):root.CompanionPassives;
  const D=typeof module!=='undefined'?require('./damage.js'):root.NativeDamage;
  const S=typeof module!=='undefined'?require('./stats.js'):root.CompanionStats;
  const clean=C.clean,unique=values=>[...new Set(values.filter(x=>Number(x)>0).map(Number))];
  const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const isAttack=skill=>skill && skill.relation==='Enemies' && clean(skill.parameterVariationType)==='Decrease' && clean(skill.parameterType)==='HitPoint' && number(skill.accuracy,100)===100 && number(skill.mag)>0 && ['Physic','Magic','EscapeNum','SameLevel','GoodLuck'].includes(clean(skill.calcType)) && !['FinishBlow','LimitBurst','Summon','ThrowMoney'].includes(clean(skill.attr));
  // Native damage cap getter: 9999, or 99999 with a DamageLimitBreak effect (FFRS-Win64-Shipping.exe, file offset 0x5147360).
  const DAMAGE_CAP=9999,RAISED_DAMAGE_CAP=99999;
  // Turn modifiers with special command handling. Magic Boost's own damage effect (12911) is native; its 1.5x MP cost is applied here.
  const ARMS_AKIMBO=400650,DUALCAST=400730,MAGIC_BOOST=400660,MAGIC_BOOST_EFFECT=12911;
  // Limit Bursts: the 100-gauge one comes with the character; bigger ones once learned (saved activeSkillIdList).
  // Native skill rows name their owner; Archwitch Fina's rows say Darkfina.
  const LB_OWNER_ALIASES={Darkfina:1006},LB_PARAMETER=4;
  const LB_CHARGE_IDS=[1000,1031],LB_EXTRA_IDS=[1004,1280,1338];
  const isGambleSkill=skill=>(skill?.effectBundles || []).some(bundle=>Number(bundle.effectId)===13201 && clean(bundle.TargetType)==='Self' && clean(bundle.activeSkillAddTiming)==='BeforeDamageCalculation');
  const isHealing=skill=>skill && skill.relation==='Friendlies' && clean(skill.parameterVariationType)==='Increase' && clean(skill.parameterType)==='HitPoint' && number(skill.mag)>0;
  const defenseSum=(stats,modifiers)=>modifiers?.dominantDefence?2*Math.max(number(stats.PhysicalDefense),number(stats.MagicalDefense)):number(stats.PhysicalDefense)+number(stats.MagicalDefense);
  const combatHits=(normal,broken,count=1)=>Array.from({length:count},(_,actionIndex)=>
    (normal.hits || [{damage:normal.damage,breakDamage:normal.breakDamage}]).map((hit,i)=>({...hit,actionIndex,brokenDamage:broken.hits?.[i]?.damage ?? broken.damage}))).flat();
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
      incomingDamage:Math.max(0,Math.min(99999999,Math.trunc(number(options.incomingDamage)))),incomingType:options.incomingType==='Magic'?'Magic':'Physic',enemyCount:Math.max(1,number(options.enemyCount,1)),rounds:Math.max(1,Math.round(number(options.rounds,5))),
      horizon:'Global-turn planning estimate from full HP, native opening LB effects and the selected MP percentage. Only the listed members contribute stagger. Chosen actions spend MP; no MP recovery or replacement action is assumed after exhaustion. Enemy hits occur only when explicitly configured. Compatible nested wrappers and mixed attack skills use a bounded shortlist. Supported setup effects refresh without stacking; only the listed character’s benefit is scored. Initiative uses reproducible samples of native random priority, not guaranteed Agility order.'};
    const evidence={formula:'Native executable damage helpers; see docs/damage-research.md.',stats:'Native XP/growth/seed/sync/equipment derivation; cross-save HP checks.',
      passives:'Native effect IDs, timing, conditions and additive damage bucket.',
      search:'Bounded joint search; passive packages use a knapsack surrogate and are then evaluated with native math.',
      calibration:'Damage arithmetic matches independently executed native instruction samples; see docs/combat-verification.md. Battle sequencing remains a model.'};
    const prepCache=new Map(),analysisCache=new Map(),packageCache=new Map(),valueCache=new Map(),referenceRollCache=new Map(),targetCache=new Map();
    const unknownArtifacts=(snapshot.artifactOverrides || []).filter(a=>a.active && !(catalog.artifacts || []).some(row=>row.id===a.id));
    const activeNativeArtifacts=(catalog.artifacts || []).filter(a=>snapshot.inventory.some(i=>i.id===a.id && i.quantity>0) && ((snapshot.artifactOverrides||[]).find(o=>o.id===a.id)?.active ?? a.initialActive));
    const globalWarnings=[];
    if(unknownArtifacts.length)globalWarnings.push(`Unmapped active artifact IDs ${unknownArtifacts.map(a=>a.id).join(', ')}: their battle effects are not inferred.`);
    if(activeNativeArtifacts.length)globalWarnings.push(`Active artifacts ${activeNativeArtifacts.map(a=>a.name || a.id).join(', ')} are listed but their modifiers are not modeled.`);
    globalWarnings.push('Damage arithmetic was checked against the installed executable. Actual encounter stats and battle timing can differ from the five-round model; see combat-verification.md.');
    globalWarnings.push('Numeric rankings exclude attacks below 100 native accuracy. Enemy evasion and unconfigured enemy actions are not simulated.');
    globalWarnings.push('Five-turn throughput assumes enemies stay alive. Enemy HP depletion and earlier kills are not simulated; actual kills can remove later Finish opportunities.');
    globalWarnings.push('LB starts at zero plus modeled opening effects. Native command expiry and duplicate queue order are applied for normal targeted commands. Received-damage LB and supported counters require explicit incoming-hit settings.');
    function equippedFinishFor(visionId){
      const vision=indexes.visions.get(Number(visionId));
      if(!vision || !(snapshot.resonances || []).some(owned=>Number(owned.id)===Number(visionId)))return null;
      const skill=indexes.skills.get(Number(vision.finishBlow));
      if(!skill || clean(skill.attr)!=='FinishBlow')return {visionId:vision.id,skillId:Number(vision.finishBlow),supported:false,reason:'The equipped Resonance has no mapped native FinishBlow skill.'};
      const offensive=clean(skill.relation)==='Enemies' && clean(skill.parameterType)==='HitPoint' && clean(skill.parameterVariationType)==='Decrease' &&
        ['Physic','Magic'].includes(clean(skill.calcType)) && number(skill.mag)>0;
      const healing=[414100,412510,412600].includes(skill.id) && clean(skill.relation)==='Friendlies' && clean(skill.parameterType)==='HitPoint' &&
        clean(skill.parameterVariationType)==='Increase' && clean(skill.calcType)==='Magic' && number(skill.mag)>0;
      const protectionEffect=indexes.effects.get(16129);
      const protection=skill.id===412620 && clean(skill.relation)==='Friendlies' && clean(skill.target)==='Group' && clean(skill.calcType)==='None' &&
        (skill.effectBundles || []).some(bundle=>Number(bundle.effectId)===16129 && clean(bundle.TargetType)==='SkillTarget' && clean(bundle.targetRelation)==='Friendlies') &&
        clean(protectionEffect?.type)==='Deffence' && Number(protectionEffect?.params?.[0])===0 && Number(protectionEffect?.params?.[1])===70 &&
        number(protectionEffect?.duration)===1 && clean(protectionEffect?.proceedTiming)==='SkillEndReducedDamage';
      const supported=offensive || healing || protection;
      const secondaryEffects=(skill.effectBundles || []).filter(bundle=>number(bundle.effectId)>0 && clean(bundle.activeSkillAddTiming)!=='BeforeDamageCalculation')
        .map(bundle=>indexes.effects.get(Number(bundle.effectId))).filter(Boolean);
      return {visionId:vision.id,skillId:skill.id,name:skill.name,supported,kind:healing?'healing':protection?'protection':offensive?'damage':'utility',mpCost:number(skill.cost),apCost:0,
        ...(supported?{}:{reason:'This finisher supplies protection or other support effects; their combat benefit is not scored.'}),
        secondaryEffects:secondaryEffects.map(effect=>({effectId:effect.id,type:clean(effect.type)})),
        secondaryReasons:[...(healing?['Additional recovery passives are not yet scored.']:[]),...secondaryEffects.filter(effect=>![59000,62000,21200,16100,16129].includes(effect.id)).map(effect=>`${clean(effect.type)} (effect ${effect.id}) is separate from the base finisher effect and needs its own supported state handling.`)]};
    }
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
      const stateContext={demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0,resources:{GoodLuck:10,OverClock:1}};
      const eligibility=skill=>{
        const result=catalog.skillRules?P.skillEligibility(skill,stateContext,catalog.skillRules):{eligible:true,reasons:[],deferred:['Native action-state rules were not loaded.']};
        if((skill.effects || []).some(id=>clean(indexes.effects.get(id)?.type)==='CritOrMiss' && P.decode(indexes.effects.get(id)).unsupported)){result.eligible=false;result.reasons.push('This critical-or-miss layout is not verified.');}
        const supportedHp=[400490,408070,406050,406070,406110,406120,406130].includes(skill.id) && [...(result.additionalCosts || []),...(result.costOverride?[result.costOverride]:[])].every(cost=>['HPRatio','GoodLuck'].includes(clean(cost.costType)));
        if((result.additionalCosts?.length || result.costOverride) && !supportedHp){result.eligible=false;result.reasons.push('Special resource cost/override is not modeled.');}
        return result;
      };
      const legalSkills=skills.filter(skill=>eligibility(skill).eligible);
      const active=legalSkills.filter(isAttack);
      const excludedActions=skills.filter(isAttack).map(skill=>({skill,result:eligibility(skill)})).filter(row=>!row.result.eligible).map(row=>`${row.skill.name}: ${[...row.result.reasons,...row.result.deferred].join('; ')}`);
      const borrowed=unique(learn.alwaysPassiveIds || []),learned=unique(learn.learnedPassiveIds || []).filter(keep);
      const initialSkills=legalSkills.filter(skill=>!catalog.skillRules || P.skillEligibility(skill,{...stateContext,resources:{GoodLuck:0,OverClock:0}},catalog.skillRules).eligible);
      const support=P.supportActions(catalog,initialSkills.map(s=>s.id));
      const healSkills=legalSkills.filter(isHealing);
      const protectSkills=unique([...support.buffs.filter(a=>['physicalReductionPercent','magicReductionPercent'].includes(a.kind)).map(a=>a.skillId),
        ...legalSkills.filter(s=>s.relation==='Friendlies' && (s.effects || []).some(id=>clean(indexes.effects.get(id)?.type)==='Cover')).map(s=>s.id)]).map(id=>indexes.skills.get(id));
      const legal=new Set(legalSkills.map(s=>s.id));
      const learnedSpecials=new Set(saved?.activeSkillIds || []);
      const knownLimits=(catalog.skills || []).filter(s=>clean(s.attr)==='LimitBurst' && (LB_OWNER_ALIASES[s.hasUnit] ?? catalog.characters.find(c=>c.name===s.hasUnit)?.id)===characterId &&
        (number(s.cost)<=100 || learnedSpecials.has(s.id)));
      const limits=knownLimits.filter(s=>s.relation==='Enemies' && ['Physic','Magic','GoodLuck'].includes(clean(s.calcType)) && number(s.mag)>0);
      const limitMax=Math.max(0,...knownLimits.map(s=>number(s.cost)));
      const result={saved,native,learn,free,skills,active,legal,limits,limitMax,finish:equippedFinishFor(visionId),borrowed,learned,support,healSkills,protectSkills,excludedActions,current,fixed,stateContext,equippedIds:[...equipped]};
      prepCache.set(key,result);return result;
    }
    function analysis(ids,skill,extra={}){
      const key=ids.slice().sort((a,b)=>a-b).join(',')+':'+skill.id+':'+JSON.stringify(extra);
      if(analysisCache.has(key))return analysisCache.get(key);
      const context={skill,element:clean(skill.element),hpPercent:100,mpPercent:scenario.mpPercent,lbPercent:0,
        broken:scenario.broken,extraPhase:false,critical:scenario.critical,analyzed:false,notTargeted:false,statusIds:[],targetStatusIds:[],
        targetCount:scenario.enemyCount,buffCount:0,...extra};
      if(isGambleSkill(skill))context.activeEffectIds=unique([...(context.activeEffectIds || []),13201]);
      let result=P.analyze(catalog,ids,context);
      const weakness=clean(enemy.resistances?.[result.modifiers.element] || 'None')==='Weakness';
      if(context.weakness!==weakness)result=P.analyze(catalog,ids,{...context,weakness});
      // Prevent an unbounded optimization cache while retaining commonly repeated effect sets.
      if(analysisCache.size<25000)analysisCache.set(key,result);
      return result;
    }
    function rollDamage(stats,skill,passiveAnalysis,context={}){
      const magical=clean(skill.calcType)==='Magic';
      const attackFor=(values,modifiers)=>modifiers.dominantPower?Math.max(number(values.PhysicalAttack),number(values.MagicalAttack)):number(values[magical?'MagicalAttack':'PhysicalAttack']);
      const attack=attackFor(stats,passiveAnalysis.modifiers);
      const element=passiveAnalysis.modifiers.element || clean(skill.element);
      const targetKey=`${skill.id}:${element}`;
      if(!targetCache.has(targetKey))targetCache.set(targetKey,P.analyze(catalog,enemy.passiveIds || [],{skill,element,hpPercent:100,mpPercent:100,lbPercent:0,broken:scenario.broken,extraPhase:false,critical:scenario.critical,statusIds:[],targetStatusIds:[]}));
      const targetAnalysis=targetCache.get(targetKey);
      function enemyParameter(key){
        const base=number(enemy.stats?.[key]);
        const terms=targetAnalysis.terms.filter(t=>t.parameter===key && ['statFlat','statPercent'].includes(t.kind));
        if(context.targetStatPercent?.parameter===key)terms.push({kind:'statPercent',value:context.targetStatPercent.value});
        return Math.max(0,base+terms.reduce((sum,term)=>sum+S.effectDelta(base,term),0));
      }
      const physicalDefense=enemyParameter('Defence')+enemyParameter('PhysicalDefense'),magicDefense=enemyParameter('Mind')+enemyParameter('MagicalDefense');
      const defense=number(context.defense,Math.max(1,targetAnalysis.modifiers.dominantDefence?Math.max(physicalDefense,magicDefense):magical?magicDefense:physicalDefense));
      const originalResistance=clean(enemy.resistances?.[element] || 'None'),addedResistance=targetAnalysis.modifiers.resistances[element] || 'None';
      const priority={None:0,Weakness:25,Halved:50,Invalid:75,Absorb:100};
      const resistance=priority[addedResistance]>priority[originalResistance]?addedResistance:originalResistance;
      // Native target Deffence effects multiply individually; they are not one additive percentage bucket.
      const incomingFactor=targetAnalysis.terms.filter(term=>term.kind===(magical?'magicReductionPercent':'physicalReductionPercent'))
        .reduce((product,term)=>Math.fround(product*Math.fround(Math.max(0,Math.min(100,100-number(term.value)))/100+2**-23)),1);
      const factor=number(catalog.battleRules.elementResistanceValues?.[`eResistance::${resistance}`] ?? catalog.battleRules.elementResistanceValues?.[resistance],{None:1,Weakness:1.5,Halved:0.5,Invalid:0,Absorb:-1}[resistance]??1);
      const common={attack,defense,attackSource:passiveAnalysis.modifiers.dominantPower?'higher of ATK and MAG':magical?'MAG':'ATK',defenseSource:targetAnalysis.modifiers.dominantDefence?'higher of physical and magic':magical?'magic':'physical',level:stats.level || context.level,targetLevel:number(enemy.level,1),skill,elementFactor:factor,
        outgoingFactor:Math.max(0,passiveAnalysis.damageFactor+number(context.additionalDamagePercent)/100)*incomingFactor,
        criticalBonus:number(passiveAnalysis.modifiers.critDamagePercent)/100,broken:context.broken ?? scenario.broken,exPhase:!!context.extraPhase,
        difficultyGiven:scenario.difficultyGiven,rules:catalog.battleRules,
        coefficientScale:1+number(passiveAnalysis.modifiers.coefficientPerLevel)*Math.trunc(number(stats.level || context.level,1))+number(passiveAnalysis.modifiers.coefficientScalePercent)/100,coefficientAdd:number(passiveAnalysis.modifiers.coefficientAdd)+number(passiveAnalysis.modifiers.coefficientPerLuck)*number(context.goodLuck),damageCap:passiveAnalysis.modifiers.damageCapRaised?RAISED_DAMAGE_CAP:DAMAGE_CAP,
        successfulEscapes:number(snapshot.player?.escapeCount ?? snapshot.player?.escapeNum ?? snapshot.player?.successfulEscapes,NaN)};
      const ratios=(skill.ratios || []).slice(0,Math.max(1,number(skill.hits,1))).map(Number).filter(v=>v>0);
      const useRatios=ratios.length?ratios:[1];
      let expected=0,min=0,max=0,breakDamage=0;
      const hits=[];
      const critRate=number(skill.criticalHitRate)+number(passiveAnalysis.modifiers.critRatePercent);
      const gamble=!!passiveAnalysis.modifiers.gambleShot;
      const gambleStageProbability=gamble?(common.broken || context.extraPhase?1:D.gambleHitProbability(number(context.goodLuck),number(passiveAnalysis.modifiers.accuracyBonus))):1;
      const accuracyOptions={accuracyBonus:number(passiveAnalysis.modifiers.accuracyBonus),evasion:number(targetAnalysis.modifiers.physicalEvasionPercent),maxEvasion:number(catalog.battleRules.evasionLimit,75),statusResistance:number(enemy.statusResistances?.None)};
      const accuracyProbability=gamble?(common.broken || context.extraPhase?1:D.skillHitProbability(number(skill.accuracy,100),accuracyOptions)):1;
      const hitProbability=gambleStageProbability*accuracyProbability;
      const criticalChance=gamble?hitProbability:scenario.critical?1:D.criticalProbability(critRate);
      for(const [hitIndex,hitRatio] of useRatios.entries()){
        const accuracyWeight=!gamble && Array.isArray(context.attackHitOutcomes)?(common.broken || context.extraPhase?1:Number(context.attackHitOutcomes[hitIndex])):1;
        const hitChance=gamble?(common.broken || context.extraPhase?1:Array.isArray(context.gambleHitOutcomes)?Number(context.gambleHitOutcomes[hitIndex]):hitProbability):Array.isArray(context.criticalOutcomes)?Number(context.criticalOutcomes[hitIndex]):criticalChance;
        const critAnalysis=context.criticalAnalysis || passiveAnalysis;
        const criticalInput={...common,hitRatio,critical:true,
          attack:attackFor(context.criticalStats || stats,critAnalysis.modifiers),
          outgoingFactor:Math.max(0,critAnalysis.damageFactor+number(context.additionalDamagePercent)/100)*incomingFactor,
          criticalBonus:number(critAnalysis.modifiers.critDamagePercent)/100,coefficientScale:1+number(critAnalysis.modifiers.coefficientPerLevel)*Math.trunc(number(stats.level || context.level,1))+number(critAnalysis.modifiers.coefficientScalePercent)/100,coefficientAdd:number(critAnalysis.modifiers.coefficientAdd)+number(critAnalysis.modifiers.coefficientPerLuck)*number(context.goodLuck),damageCap:critAnalysis.modifiers.damageCapRaised?RAISED_DAMAGE_CAP:DAMAGE_CAP};
        const normal=D.damage({...common,hitRatio,critical:false}),critical=D.damage(criticalInput);
        if(!normal.supported)return {...normal,damage:0,damageMin:0,damageMax:0};
        if(normal.healsTarget)return {supported:true,damage:0,damageMin:0,damageMax:0,breakDamage:0,hits:[{damage:0,breakDamage:0}],breakVerified:true,absorbed:true,element,resistance,common};
        const hitDamage=accuracyWeight*((gamble?0:normal.amount*(1-hitChance))+critical.amount*hitChance);
        expected+=hitDamage;
        min+=accuracyWeight*(gamble?(hitChance===1?critical.min:0):hitChance===1?critical.min:normal.min);
        max+=accuracyWeight*(gamble?(hitChance>0?critical.max:0):hitChance>0?critical.max:normal.max);
        let hitBreak=0;
        if(typeof D.breakDamage==='function'){
          const breakFactor=number(catalog.battleRules.breakElementResistanceValues?.[`eResistance::${resistance}`] ?? catalog.battleRules.breakElementResistanceValues?.[resistance],{None:1,Weakness:3,Halved:.5,Invalid:0,Absorb:0}[resistance]??1);
          const input={skill:{...skill,breakDmg:Math.fround(number(skill.breakDmg)*Math.fround(1+number(passiveAnalysis.modifiers.baseBreakScalePercent)/100))},level:common.level,targetLevel:number(enemy.level,1),elementFactor:breakFactor,outgoingFactor:passiveAnalysis.breakFactor,rules:catalog.battleRules,hitRatio};
          const normalBreak=D.breakDamage({...input,critical:false}),criticalBreak=D.breakDamage({...input,skill:{...skill,breakDmg:Math.fround(number(skill.breakDmg)*Math.fround(1+number(critAnalysis.modifiers.baseBreakScalePercent)/100))},outgoingFactor:critAnalysis.breakFactor,critical:true});
          hitBreak=accuracyWeight*((gamble?0:normalBreak.amount*(1-hitChance))+criticalBreak.amount*hitChance);
          breakDamage+=hitBreak;
        }
        hits.push({damage:hitDamage,breakDamage:hitBreak});
      }
      return {supported:true,damage:expected,damageMin:min,damageMax:max,element,resistance,criticalChance,hitProbability,gambleStageProbability,accuracyProbability,gambleOutcome:gamble?context.gambleOutcome:undefined,
        breakDamage,hits,breakVerified:typeof D.breakDamage==='function',common};
    }
    function gearPassives(equipment){return unique(C.equipmentIds(equipment).flatMap(id=>indexes.equipment.get(id)?.passiveIds || []));}
    function rollState(passiveIds,skill,characterId,equipment,context){
      const stateAnalysis=analysis(passiveIds,skill,context),criticalAnalysis=analysis(passiveIds,skill,{...context,critical:true});
      const state=S.characterStats(catalog,snapshot,characterId,equipment,stateAnalysis.terms);
      const criticalStats=S.characterStats(catalog,snapshot,characterId,equipment,criticalAnalysis.terms).stats;
      return rollDamage({...state.stats,level:state.level},skill,stateAnalysis,{...context,level:state.level,criticalAnalysis,criticalStats});
    }
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
      const leafContexts=(turn.scoringLeaves || turn.leaves)?.map(leaf=>({skillId:leaf.skillId,context:leaf.context})) || [{skillId:skill.id,context:turn.context}];
      const contextCounts=new Map();
      for(const leaf of leafContexts){const key=JSON.stringify(leaf),entry=contextCounts.get(key);if(entry)entry.count++;else contextCounts.set(key,{...leaf,count:1});}
      const gcd=(a,b)=>b?gcd(b,a%b):a;
      const divisor=[...contextCounts.values()].reduce((factor,entry)=>gcd(factor,entry.count),0);
      // Surrogate values average the leaves: repetition count and sibling order do not change that average.
      const contextKey=JSON.stringify([...contextCounts].sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,entry.count/divisor]));
      const key=`${prepared.saved.id}:${visionId}:${prepared.current}:${skill.id}:${effectiveElement}:${totalBudget}:${totalSlots}:${goalKey}:${turn.reservedIds.join(',')}:${contextKey}`;
      if(packageCache.has(key))return packageCache.get(key);
      const reference=prepared.saved.equipment;
      const baseIds=unique(prepared.borrowed),baseAnalysis=analysis(baseIds,skill,turn.context);
      const baseFinal=S.characterStats(catalog,snapshot,prepared.saved.id,reference,baseAnalysis.terms);
      // One roll per (leaf skill, context, passive set) on the saved gear; recipes and Resonances reuse it.
      function referenceRoll(ids,leafSkill,context){
        const rollKey=`${prepared.saved.id}:${leafSkill.id}:${JSON.stringify(context)}:${ids.slice().sort((a,b)=>a-b).join(',')}`;
        if(referenceRollCache.has(rollKey))return referenceRollCache.get(rollKey);
        const effects=analysis(ids,leafSkill,context);
        const state=S.characterStats(catalog,snapshot,prepared.saved.id,reference,effects.terms);
        const roll=rollDamage({...state.stats,level:state.level},leafSkill,effects,{level:state.level});
        const result={damage:roll.damage,breakDamage:roll.breakDamage};
        if(referenceRollCache.size<200000)referenceRollCache.set(rollKey,result);
        return result;
      }
      function referenceDamage(ids){
        const rolls=[...contextCounts.values()].map(({skillId,context,count})=>{
          const leafSkill=indexes.skills.get(skillId);
          if(turn.leaves?.find(leaf=>leaf.skillId===skillId && leaf.kind==='support'))return {damage:0,breakDamage:0};
          const roll=referenceRoll(ids,leafSkill,context);
          return {damage:roll.damage*count,breakDamage:roll.breakDamage*count};
        });
        return {damage:rolls.reduce((sum,roll)=>sum+roll.damage,0)/leafContexts.length,breakDamage:rolls.reduce((sum,roll)=>sum+roll.breakDamage,0)/leafContexts.length};
      }
      const baseline=referenceDamage(baseIds);
      // A passive set's value uses the saved reference gear, so it is shared across loadouts, budgets and reserved abilities.
      const valuePrefix=`${prepared.saved.id}:${visionId}:${skill.id}:${effectiveElement}:${contextKey}:`;
      function valueOf(ids){
        const valueKey=valuePrefix+ids.slice().sort((a,b)=>a-b).join(',');
        if(!valueCache.has(valueKey) && valueCache.size<200000)valueCache.set(valueKey,computeValue(ids));
        return valueCache.get(valueKey) ?? computeValue(ids);
      }
      function computeValue(ids){
        const candidateAnalysis=analysis(unique([...baseIds,...ids]),skill,{element:effectiveElement,...turn.context});
        const final=S.characterStats(catalog,snapshot,prepared.saved.id,reference,candidateAnalysis.terms);
        const calculated=referenceDamage(unique([...baseIds,...ids]));
        const value=goalScore({damage:Math.max(0,calculated.damage-baseline.damage),breakDamage:Math.max(0,calculated.breakDamage-baseline.breakDamage),
          durability:Math.max(0,number(final.stats.MaxHitPoint)-number(baseFinal.stats.MaxHitPoint))*.05+
          ['PhysicalDefense','MagicalDefense'].reduce((sum,key)=>sum+Math.max(0,
            (candidateAnalysis.modifiers.dominantDefence?defenseSum(final.stats,candidateAnalysis.modifiers)/2:number(final.stats[key]))-
            (baseAnalysis.modifiers.dominantDefence?defenseSum(baseFinal.stats,baseAnalysis.modifiers)/2:number(baseFinal.stats[key])))*2,0)});
        return Number.isFinite(value)?value:0;
      }
      const masters=(prepared.learn.masterSkillIds || []).map(id=>indexes.masterSkills.get(id)).filter(m=>m && m.grants && ((m.grants.passiveIds || []).length || (m.grants.activeIds || []).length));
      const source=id=>indexes.passives.get(id) || indexes.masterSkills.get(id);
      const expanded=ids=>unique(ids.flatMap(id=>indexes.masterSkills.get(id)?.grants?.passiveIds || [id]));
      const freeSkills=ids=>new Set([...prepared.free,...ids.flatMap(id=>indexes.masterSkills.get(id)?.grants?.activeIds || [])]);
      const requiredIds=unique([skill.id,...turn.reservedIds]);
      const forced=[null,...masters.filter(m=>(m.grants.activeIds || []).some(id=>requiredIds.includes(id)))];
      let result=null,bestValue=-Infinity;
      for(const fixed of forced){
        const fixedIds=fixed?[fixed.id]:[],fixedPassives=expanded(fixedIds),activeFree=freeSkills(fixedIds).has(skill.id);
        const reservedIds=turn.reservedIds.filter(id=>!freeSkills(fixedIds).has(id));
        const activeCost=activeFree?0:number(skill.equipCost),activeSlots=activeFree?0:1;
        const fixedCost=fixed?number(fixed.equipCost):0;
        const budget=number(stats0.skillBudget)-equipCostOf(reservedIds)-activeCost-fixedCost,slots=number(stats0.maxSkillSlots,8)-reservedIds.length-activeSlots-fixedIds.length;
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
        const finalReservedIds=turn.reservedIds.filter(id=>!finalFree.has(id));
        if(cost+equipCostOf(finalReservedIds)>number(stats0.skillBudget) || count+finalReservedIds.length>number(stats0.maxSkillSlots,8))continue;
        const value=valueOf(allPassiveIds);
        if(value>bestValue || value===bestValue && (!result || cost<result.cost)){
          bestValue=value;result={ids,passiveIds:allPassiveIds,masterIds,equippedIds,freeActiveIds:[...finalFree],cost,
            activeCost:finalActiveFree?0:number(skill.equipCost),activeSlots:finalActiveFree?0:1,reservedIds:finalReservedIds};
        }
      }
      if(!result)result={ids:[],passiveIds:[],masterIds:[],equippedIds:[],freeActiveIds:[...prepared.free],cost:prepared.free.has(skill.id)?0:number(skill.equipCost),activeCost:prepared.free.has(skill.id)?0:number(skill.equipCost),activeSlots:prepared.free.has(skill.id)?0:1};
      packageCache.set(key,result);return result;
    }
    const equipCostOf=ids=>ids.reduce((sum,id)=>sum+number((indexes.skills.get(id) || indexes.passives.get(id) || indexes.masterSkills.get(id))?.equipCost),0);
    // LB gauge passives: fill-rate multiplier (IncreaseParameterVariation on LimitBurstPoint; strongest one counts),
    // flat fill when this unit staggers (ParameterVariation at Break) and refund after a Limit Burst (Recuperate).
    function limitTraits(passiveIds){
      const traits={mult:1,initial:0,fillOnStagger:0,recuperate:0,effectIds:[]};
      for(const id of passiveIds)for(const bundle of indexes.passives.get(id)?.effectBundles || []){
        const effect=indexes.effects.get(Number(bundle.effectId));
        if(!effect || clean(bundle.TargetType)!=='Self' || clean(bundle.targetRelation)!=='Friendlies' ||
          clean(bundle.conditionData?.Condition || 'None')!=='None' || clean(effect.condition?.Condition || 'None')!=='None' ||
          number(effect.prob,100)!==100 || number(effect.activationProbability,100)!==100 || traits.effectIds.includes(effect.id))continue;
        const value=number(effect.params[0]);
        const type=clean(effect.type),timing=clean(bundle.passiveSkillAddTiming);
        if(type==='InitialLimitBurstPoint' && timing==='SpawnUnit')traits.initial+=value;
        else if(Number(effect.params?.[1])!==LB_PARAMETER)continue;
        else if(type==='IncreaseParameterVariation' && timing==='SpawnUnit')traits.mult=Math.max(traits.mult,value/100);
        else if(type==='ParameterVariation' && [0,2].includes(Number(effect.params[2])) && timing==='SpawnUnit' && clean(effect.applyTiming)==='Break')traits.fillOnStagger+=value;
        else if(type==='ParameterVariation' && [0,2].includes(Number(effect.params[2])) && timing==='ActivateLimitBurst')traits.recuperate+=value;
        else continue;
        traits.effectIds.push(effect.id);
      }
      return traits;
    }
    const limitCache=new Map();
    function limitInfo(prepared,equipment,passiveIds,context={}){
      const key=`${prepared.saved.id}:${C.equipmentIds(equipment).join(',')}:${passiveIds.slice().sort((a,b)=>a-b).join(',')}:${JSON.stringify(context)}`;
      if(!limitCache.has(key))limitCache.set(key,computeLimitInfo(prepared,equipment,passiveIds,context));
      return limitCache.get(key);
    }
    function computeLimitInfo(prepared,equipment,passiveIds,context={}){
      const traits=limitTraits(passiveIds),max=prepared.limitMax;
      const options=prepared.limits.map(skill=>{
        const selfEffects=(skill.effectBundles || []).filter(b=>Number(b.effectId)>0 && clean(b.TargetType)==='Self').map(b=>Number(b.effectId));
        const activeEffectIds=unique([...(context.activeEffectIds || []),...selfEffects]);
        const r=rollState(passiveIds,skill,prepared.saved.id,equipment,{...context,activeEffectIds});
        if(!r.supported)return null;
        const b=scenario.broken?r:rollState(passiveIds,skill,prepared.saved.id,equipment,{...context,activeEffectIds,broken:true});
        return {skillId:skill.id,cost:number(skill.cost),damage:r.damage,brokenDamage:b.damage,breakDamage:number(r.breakDamage),hits:combatHits(r,b)};
      }).filter(Boolean);
      return {...traits,max,baseStaggerGain:number(scenario.enemyCount===1?catalog.battleRules.allBreakLBIncrease:catalog.battleRules.breakLBIncrease,scenario.enemyCount===1?50:25),options};
    }
    const hpCostsFor=skillId=>{
      const general=catalog.skillRules?.general || {};
      return [...(general.costOverrideData || []),...(general.additionalCostData || [])]
        .filter(row=>Number(row.SkillId)===Number(skillId) && clean(row.costType)==='HPRatio');
    };
    const clockTargets=new Set((catalog.skillRules?.general?.overclockTargetSkills || []).map(Number));
    const stateEffect=(s,effectId,round)=>{
      if(effectId===63001)s.goodLuck=Math.min(10,s.goodLuck+1);
      else if(effectId===63002)s.goodLuck=0;
      else if(effectId===19003 || effectId===19004){
        if(s.overclocks.some(clock=>clock.effectId===effectId))return;
        if(effectId===19004)s.overclocks=s.overclocks.filter(clock=>clock.effectId!==19003);
        s.overclocks.push({effectId,charges:3});s.overheatUntil=0;
      }else if(effectId===19015)s.demonForm=true;
      else if(effectId===19016)s.demonForm=false;
      else if(effectId===12907)s.focusLife=2;
      else if(effectId===1382)s.focusSpeedUntil=round+2;
    };
    function skillStateEffects(s,skill,timing,round,outcome={}){
      for(const bundle of skill.effectBundles || []){
        const effect=indexes.effects.get(Number(bundle.effectId));
        if(!effect || clean(bundle.activeSkillAddTiming)!==timing || !(clean(bundle.TargetType)==='Self' || clean(bundle.TargetType)==='SkillTarget' && clean(skill.target)==='Self' && clean(skill.relation)==='Friendlies') ||
          clean(bundle.conditionData?.Condition || 'None')!=='None' || clean(effect.condition?.Condition || 'None')!=='None' ||
          number(effect.prob,100)!==100 || number(effect.activationProbability,100)!==100)continue;
        if(effect.id===65006 && isGambleSkill(skill)){if(outcome.gambleOutcome===true)s.goodLuck=Math.min(10,s.goodLuck+5);continue;}
        stateEffect(s,effect.id,round);
      }
    }
    function liveContext(s,plan,context={}){
      const clock=s.overclocks.flatMap(clock=>clock.effectId===19004?[12914,15114]:[12913,15113]);
      return {...context,broken:s.targetBroken?.() ?? context.broken,hpPercent:s.hp/Math.max(1,plan.maxHp)*100,
        mpPercent:s.mp/Math.max(1,number(plan.maxMp,s.m.availableMp))*100,goodLuck:s.goodLuck,
        activeEffectIds:unique([...(context.activeEffectIds || []),...(s.goodLuck>0?[1195]:[]),...clock,...(s.demonForm?[16603]:[]),...(s.focusLife>0?[12907]:[]),...(s.round<s.focusSpeedUntil?[1382]:[])]),
        resources:{...(context.resources || {}),GoodLuck:s.goodLuck,OverClock:s.overclocks.length?1:0},
        demonForm:!!s.demonForm,extraPhase:s.phase==='additional' || s.phase==='finish',awakeningPower:false,hasEscaped:false,lbPercent:s.gauge,lbCapacity:number(s.m.limit?.max),
        statusNames:[...(context.statusNames || []),...s.overclocks.map(clock=>clock.effectId===19004?'OverClockZero':'OverClock'),...(s.round<s.overheatUntil?['OverHeat']:[])]};
    }
    function freshTurnAvailable(s,plan,round){
      const general=catalog.skillRules?.general || {},steps=plan.turn.steps || plan.turn.leaves;
      if(plan.turn.selectionMp!==undefined && s.mp<number(plan.turn.selectionMp))return {skillId:steps[0]?.skillId || 0,resource:'MP',reason:'Insufficient MP to select the complete reaction command.'};
      let spent=0,required=number(plan.turn.requiredGoodLuck);
      for(const step of steps){
        if(step.paymentSuppressed)continue;
        const id=Number(step.skillId);
        for(const check of general.costCheckData || [])if(Number(check.SkillId)===id && clean(check.costType)==='GoodLuck')required=Math.max(required,spent+Number(check.Cost));
        for(const cost of general.additionalCostData || [])if(Number(cost.SkillId)===id && clean(cost.costType)==='GoodLuck'){required=Math.max(required,spent+Number(cost.Cost));spent+=Number(cost.Cost);}
      }
      if(s.goodLuck<required)return {skillId:steps.find(step=>(general.costCheckData || []).some(check=>Number(check.SkillId)===Number(step.skillId) && clean(check.costType)==='GoodLuck'))?.skillId || 0,reason:`Insufficient GoodLuck for the fresh command (requires ${required}).`};
      let pendingHp=s.hp,pendingMp=s.mp;
      for(const step of steps){
        const skill=indexes.skills.get(Number(step.skillId));if(!skill)continue;
        if(step.context?.friendlyTargetId!==undefined && !s.targetAlive?.(Number(step.context.friendlyTargetId)))return {skillId:skill.id,reason:'The selected friendly target is unavailable or has no HP remaining.'};
        if(round<s.overheatUntil && clean(skill.attr)==='Mechabo')return {skillId:skill.id,reason:'Overheat prevents a fresh Mechabo command.'};
        const check=P.skillEligibility(skill,liveContext(s,plan,step.context),catalog.skillRules || {});
        if(!check.eligible)return {skillId:skill.id,reason:check.reasons.concat(check.deferred).join('; ')};
        if(!step.paymentSuppressed){
          for(const cost of hpCostsFor(skill.id)){
            if(!D.canPayHpCost(pendingHp,plan.maxHp,Number(cost.Cost)))return {skillId:skill.id,reason:'Insufficient HP for the fresh command percentage check.'};
            pendingHp=Math.max(0,pendingHp-D.skillHpCost(plan.maxHp,Number(cost.Cost)));
          }
          const override=general.costOverrideData?.find(row=>Number(row.SkillId)===skill.id);
          const mp=number(step.mpCost,clean(override?.costType)==='HPRatio'?0:D.skillMpCost(number(skill.cost),step.boost || step.reckless?[150]:[]));
          if(mp>pendingMp)return {skillId:skill.id,resource:'MP',reason:'Insufficient MP for the fresh command.'};
          pendingMp-=mp;
        }
      }
      return null;
    }
    function payLiveSkill(s,plan,skill,step,round){
      // Native ordinary queued children do not rerun the command-menu resource/status gates.
      if(s.hp<=0){s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:skill.id,reason:'The caster has no HP remaining.'});return null;}
      const recheck=!!(step.context?.reaction || step.context?.triggered);
      if(recheck){
        const unavailable=round<s.overheatUntil && clean(skill.attr)==='Mechabo'?'Overheat prevents the triggered Mechabo action.':null;
        const check=P.skillEligibility(skill,liveContext(s,plan,step.context),catalog.skillRules || {});
        if(unavailable || !check.eligible){s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:skill.id,reason:unavailable || check.reasons.concat(check.deferred).join('; ')});return null;}
      }
      const general=catalog.skillRules?.general || {},costs=step.paymentSuppressed?[]:hpCostsFor(skill.id);
      if(recheck && costs.some(cost=>!D.canPayHpCost(s.hp,plan.maxHp,Number(cost.Cost)))){
        s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:skill.id,reason:'Insufficient HP for the native percentage check.'});return null;
      }
      const luckCosts=step.paymentSuppressed?[]:(general.additionalCostData || []).filter(row=>Number(row.SkillId)===skill.id && clean(row.costType)==='GoodLuck');
      const luckCost=luckCosts.reduce((sum,cost)=>sum+Number(cost.Cost),0);
      const override=general.costOverrideData?.find(row=>Number(row.SkillId)===skill.id);
      const mp=step.paymentSuppressed?0:number(step.mpCost,clean(override?.costType)==='HPRatio'?0:D.skillMpCost(number(skill.cost),step.boost || step.reckless?[150]:[]));
      if(recheck && mp>s.mp){s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:skill.id,reason:'Insufficient MP for the selected child.'});return null;}
      const before={hp:s.hp,mp:s.mp,goodLuck:s.goodLuck};
      s.mp=Math.max(0,s.mp-mp);s.goodLuck=Math.max(0,s.goodLuck-luckCost);
      for(const cost of costs){const previous=s.hp;s.hp=Math.max(0,s.hp-D.skillHpCost(plan.maxHp,Number(cost.Cost)));s.hpSpent+=previous-s.hp;}
      return {hpBefore:before.hp,hpAfter:s.hp,hpCost:before.hp-s.hp,mpCost:mp,goodLuckBefore:before.goodLuck,goodLuckAfter:s.goodLuck};
    }
    function* liveTurnHits(s,plan,round){
      let leafIndex=0,blockedDepth=null;
      for(const step of plan.turn.steps || plan.turn.leaves){
        // The preceding child finishes before this command pays its resources.
        yield {actionBoundary:true,actionIndex:leafIndex};
        const skill=indexes.skills.get(Number(step.skillId));if(!skill)continue;
        const isWrapper=step.kind==='wrapper',depth=number(step.depth,isWrapper?0:1);
        if(blockedDepth!==null && depth>blockedDepth){if(!isWrapper)leafIndex++;continue;}
        blockedDepth=null;
        const leaf=isWrapper?step:plan.turn.leaves[leafIndex++] || step,actionIndex=leafIndex-1;
        const payment=payLiveSkill(s,plan,skill,leaf,round);
        if(!payment){if(isWrapper)blockedDepth=depth;continue;}
        skillStateEffects(s,skill,'BeforeDamageCalculation',round);
        if(isWrapper){skillStateEffects(s,skill,'AfterDamageCalculation',round);continue;}
        s.currentActionNewStagger=false;
        if(['Decrease','RatioDecrease'].includes(clean(skill.parameterVariationType)) && clean(skill.parameterType)==='HitPoint')s.performedAttackThisRound=true;
        const temporary=(skill.effectBundles || []).filter(bundle=>clean(bundle.TargetType)==='Self' && clean(bundle.activeSkillAddTiming)==='BeforeDamageCalculation')
          .map(bundle=>Number(bundle.effectId)).filter(id=>{const effect=indexes.effects.get(id);return effect && !P.decode(effect).unsupported;});
        const context=liveContext(s,plan,{...leaf.context,anyCritical:false,activeEffectIds:unique([...(leaf.context?.activeEffectIds || []),...temporary])});
        if(isGambleSkill(skill)){
          const modifiers=analysis(plan.passiveIds || [],skill,context).modifiers;
          const target=P.analyze(catalog,enemy.passiveIds || [],{skill,hpPercent:100,mpPercent:100,broken:context.broken});
          const accuracyOptions={accuracyBonus:number(modifiers.accuracyBonus),evasion:number(target.modifiers.physicalEvasionPercent),maxEvasion:number(catalog.battleRules.evasionLimit,75),statusResistance:number(enemy.statusResistances?.None)};
          context.gambleProbability=context.broken || context.extraPhase?1:D.gambleHitProbability(s.goodLuck,number(modifiers.accuracyBonus));
          context.gambleStageOutcome=!!context.broken || !!context.extraPhase || D.gambleSuccess(s.goodLuck,s.gambleRng(round),number(modifiers.accuracyBonus));
          context.gambleHitOutcomes=Array.from({length:Math.max(1,number(skill.hits,1))},()=>{if(context.broken || context.extraPhase)return true;const hit=D.skillHitSuccess(number(skill.accuracy,100),s.gambleRng(round),accuracyOptions);return context.gambleStageOutcome && hit;});
          context.gambleOutcome=context.gambleHitOutcomes.some(Boolean);context.anyCritical=context.gambleOutcome;
        }
        if((skill.effects || []).some(id=>[54100,54101].includes(Number(id)))){
          context.accuracyModeled=true;
          const modifiers=analysis(plan.passiveIds || [],skill,context).modifiers;
          const target=P.analyze(catalog,enemy.passiveIds || [],{skill,element:clean(skill.element),hpPercent:100,mpPercent:100,broken:context.broken});
          const accuracyOptions={accuracyBonus:number(modifiers.accuracyBonus),evasion:number(target.modifiers.physicalEvasionPercent),maxEvasion:number(catalog.battleRules.evasionLimit,75),statusResistance:number(enemy.statusResistances?.None)};
          const probability=D.criticalProbability(number(skill.criticalHitRate)+number(modifiers.critRatePercent));
          context.attackHitOutcomes=[];context.criticalOutcomes=[];context.criticalProbability=probability;
          for(let i=0;i<Math.max(1,number(skill.hits,1));i++){
            const hit=!!context.broken || !!context.extraPhase || D.skillHitSuccess(number(skill.accuracy,100),s.combatRng(round),accuracyOptions);
            context.attackHitOutcomes.push(hit);context.criticalOutcomes.push(hit && (scenario.critical || s.combatRng(round)<probability*32768));
          }
          context.anyHit=context.attackHitOutcomes.some(Boolean);context.anyCritical=context.criticalOutcomes.some(Boolean);
        }
        let damageEvent={damage:0,breakDamage:0},appendedEvent;
        if(leaf.kind==='support'){
          if(round===s.traceTurn)s.stateLeafResults.push({phase:s.phase || 'normal',skillId:skill.id,kind:'support',context,...payment,damage:0,breakDamage:0,common:{}});
        }else{
          const normal=rollState(plan.passiveIds || [],skill,plan.characterId,plan.equipment,context);
          if(!normal.supported){s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:skill.id,reason:'The live-state damage calculation is unsupported.'});continue;}
          const broken=scenario.broken?normal:rollState(plan.passiveIds || [],skill,plan.characterId,plan.equipment,{...context,broken:true});
          damageEvent={damage:normal.damage,breakDamage:normal.breakDamage,common:normal.common,context,hitProbability:normal.hitProbability,gambleOutcome:normal.gambleOutcome};
          if(round===s.traceTurn)s.stateLeafResults.push({phase:s.phase || 'normal',skillId:skill.id,kind:leaf.kind || 'attack',context,...payment,damage:normal.damage,breakDamage:normal.breakDamage,common:normal.common});
          for(const [hitIndex,originalHit] of combatHits(normal,broken).entries()){
            let hit=originalHit;
            if(context.accuracyModeled && s.targetBroken?.() && !context.attackHitOutcomes[hitIndex]){
              context.attackHitOutcomes[hitIndex]=true;context.criticalOutcomes[hitIndex]=scenario.critical || s.combatRng(round)<context.criticalProbability*32768;context.anyHit=true;context.anyCritical=context.criticalOutcomes.some(Boolean);
              const corrected=rollState(plan.passiveIds || [],skill,plan.characterId,plan.equipment,{...context,broken:true});
              hit={...hit,brokenDamage:corrected.hits[hitIndex].damage};
            }
            if(isGambleSkill(skill) && s.targetBroken?.()){context.gambleOutcome=true;context.anyCritical=true;context.gambleHitOutcomes[hitIndex]=true;}
            yield {...hit,actionIndex,skillId:skill.id};
          }
        }
        if(isGambleSkill(skill))damageEvent.gambleOutcome=context.gambleOutcome;
        skillStateEffects(s,skill,'AfterDamageCalculation',round,context);
        if(s.phase==='finish' && skill.id===440210 && context.anyHit!==false){
          const child=indexes.skills.get(440230);
          if(child){
            // AppendDamage inherits owner effects and selected command; it does not install child bundles.
            const appendContext={...context,commandId:context.commandId ?? skill.id};
            const appended=rollState(plan.passiveIds || [],child,plan.characterId,plan.equipment,appendContext);
            if(appended.supported){
              for(const hit of appended.hits || [])yield {...hit,brokenDamage:hit.damage,actionIndex,skillId:child.id};
              appendedEvent={round,phase:'finish',kind:'finish-append',skillId:child.id,parentSkillId:skill.id,visionId:s.m.finish?.visionId,damage:appended.damage,breakDamage:appended.breakDamage,common:appended.common,context:appendContext,paymentSuppressed:true,mpCost:0,hpCost:0,hpAfter:s.hp,mpAfter:s.mp};
              if(round===s.traceTurn)s.stateLeafResults.push({phase:'finish',kind:'append',skillId:child.id,parentSkillId:skill.id,context:appendContext,damage:appended.damage,breakDamage:appended.breakDamage,common:appended.common,mpCost:0,hpCost:0,paymentSuppressed:true});
            }
          }
        }
        context.causedStagger=!!s.currentActionNewStagger;
        if(context.causedStagger)s.onSourceBreak?.(skill,context);
        if(skill.id===400790 && plan.turn.reactionSkills){s.reactionUntil=round+1;s.reactionSkills=plan.turn.reactionSkills;}
        if(clockTargets.has(skill.id)){
          for(const clock of s.overclocks)clock.charges--;
          if(s.overclocks.some(clock=>clock.charges===0))s.overheatUntil=round+2;
          s.overclocks=s.overclocks.filter(clock=>clock.charges>0);
        }
        const gaugeBeforeSkillEnd=s.gauge;
        s.onSkillEnd?.(skill,context);
        s.resourceEvents.push({round,phase:s.phase || 'normal',...(s.phase==='finish'?{kind:'finish',visionId:s.m.finish?.visionId,mpAfter:s.mp,gaugeAfter:s.gauge,lbGained:s.gauge-gaugeBeforeSkillEnd}:{}),skillId:skill.id,...payment,...damageEvent,goodLuckAfter:s.goodLuck,overclockCharges:Math.max(0,...s.overclocks.map(clock=>clock.charges)),overclockStates:s.overclocks.map(clock=>({...clock})),overheat:round<s.overheatUntil,demonForm:s.demonForm,focusLife:s.focusLife});
        if(appendedEvent)s.resourceEvents.push(appendedEvent);
      }
    }
    function liveBurst(s,plan,option,round){
      const skill=indexes.skills.get(option.skillId);
      if(!skill)return option;
      const setup=round<s.setupUntil?plan.turn.setupContext || {}:{};
      const activeEffectIds=unique([...(setup.activeEffectIds || []),...(skill.effectBundles || [])
        .filter(bundle=>number(bundle.effectId)>0 && clean(bundle.TargetType)==='Self').map(bundle=>Number(bundle.effectId))]);
      const context={...liveContext(s,plan,{...setup,activeEffectIds}),lbPercent:Math.max(0,s.gauge-option.cost)};
      const normal=rollState(plan.passiveIds || [],skill,plan.characterId,plan.equipment,context);
      if(!normal.supported)return null;
      const broken=scenario.broken?normal:rollState(plan.passiveIds || [],skill,plan.characterId,plan.equipment,{...context,broken:true});
      return {...option,damage:normal.damage,brokenDamage:broken.damage,breakDamage:normal.breakDamage,hits:combatHits(normal,broken)};
    }
    // HP precedes each hit's BP change. Ordinary break recovers at the next global turn boundary.
    // Base LB belongs to the attacker; active Break/Recuperate effects follow at action end.
    const finishGuards=skill=>(skill?.effects || []).filter(id=>[16100,16129].includes(Number(id))).map(id=>{
      const effect=indexes.effects.get(Number(id));return {effectId:Number(id),status:clean(effect.status),percent:number(effect.params[1])};
    });
    const guardedIncoming=(amount,guards,mirror=false)=>{
      const factorFor=percent=>Math.fround(Math.fround((100-percent)*Math.fround(.01))+2**-23);
      let factor=mirror?factorFor(50):1;
      for(const guard of guards)factor=Math.fround(factor*factorFor(guard.percent));
      return {factor,amount:Math.trunc(Math.max(1,Math.fround(Math.fround(amount)*factor)))};
    };
    function simulateFight(members){
      const rounds=scenario.rounds,allStaggered=scenario.enemyCount===1;
      const gain=number(allStaggered?catalog.battleRules.allBreakLBIncrease:catalog.battleRules.breakLBIncrease,allStaggered?50:25);
      const phaseHasGamble=turn=>turn && [...(turn.leaves || []).map(leaf=>leaf.skillId),...(turn.reactionSkills || [])].some(id=>isGambleSkill(indexes.skills.get(Number(id))));
      const gamblePresent=members.some(member=>{const plan=member.actionPlan || member.fallbackActionPlan;return plan && [plan.turn,plan.bonusTurn,plan.openingTurn,...(plan.rotationTurns || []),plan.luckPolicy?.generatorTurn,plan.luckPolicy?.spenderTurn].some(phaseHasGamble);});
      const allPlanTurns=members.flatMap(member=>{const plan=member.actionPlan || member.fallbackActionPlan;return plan?[plan.turn,plan.bonusTurn,plan.openingTurn,...(plan.rotationTurns || []),plan.luckPolicy?.generatorTurn,plan.luckPolicy?.spenderTurn].filter(Boolean):[];});
      const bonusPresent=members.some(member=>number(member.breakDamage)>0) || allPlanTurns.some(turn=>(turn.leaves || []).some(leaf=>(indexes.skills.get(leaf.skillId)?.effectBundles || []).some(bundle=>[54100,54101,54105].includes(Number(bundle.effectId)))));
      const defenseChancePresent=scenario.incomingDamage>0 && members.some(member=>(member.actionPlan?.passiveIds || []).some(id=>(indexes.passives.get(id)?.effects || []).includes(19034)));
      const phaseProcPresent=allPlanTurns.some(turn=>(turn.leaves || []).some(leaf=>(indexes.skills.get(leaf.skillId)?.effects || []).some(id=>[54100,54101].includes(Number(id)))));
      const combatRandom=gamblePresent || phaseProcPresent || defenseChancePresent;
      const samples=combatRandom?32:members.length>1?16:1,partyOrder=new Map((snapshot.party || []).map((id,i)=>[Number(id),i]));
      const rateAmplitude=number(catalog.battleRules.actionTimeCalcValueWithAgilityRatio,20),flatAmplitude=number(catalog.battleRules.actionTimeCalcValueWithFixValue,5);
      const draw=(sample,round,id,stream)=>{
        let seed=Math.imul(sample+1,0x85ebca6b)^Math.imul(round,0xc2b2ae35)^Math.imul(Number(id),0x27d4eb2d)^stream;
        seed=Math.imul(seed^(seed>>>16),0x7feb352d);seed=Math.imul(seed^(seed>>>15),0x846ca68b);
        return (seed^(seed>>>16))>>>17;
      };
      const firstStrike=m=>{
        let offset=0;
        for(const id of m.passiveIds || [])for(const bundle of indexes.passives.get(id)?.effectBundles || []){
          const effect=indexes.effects.get(Number(bundle.effectId));
          if(clean(bundle.passiveSkillAddTiming)!=='BeginBattle' || clean(bundle.TargetType)!=='Self' ||
            !['None',''].includes(clean(bundle.conditionData?.Condition)) || !effect || clean(effect.type)!=='WaitTimeOffset' ||
            Number(effect.params?.[1])!==0 || Number(effect.duration)!==1 || clean(effect.proceedTiming)!=='BeginTurn' ||
            !['None',''].includes(clean(effect.condition?.Condition)) || number(effect.prob,100)!==100)continue;
          offset+=number(effect.params[0]);
        }
        return offset;
      };
      const luckTraits=m=>{
        let initialLuck=0,actionBeginLuck=0;
        const seen=new Set();
        for(const id of m.actionPlan?.passiveIds || [])for(const bundle of indexes.passives.get(id)?.effectBundles || []){
          const effect=indexes.effects.get(Number(bundle.effectId));
          if(!effect || seen.has(effect.id) || ![65004,65005].includes(effect.id) || clean(bundle.TargetType)!=='Self' || clean(bundle.passiveSkillAddTiming)!=='SpawnUnit' ||
            clean(bundle.conditionData?.Condition || 'None')!=='None' || clean(effect.condition?.Condition || 'None')!=='None' || number(effect.prob,100)!==100 || number(effect.activationProbability,100)!==100)continue;
          seen.add(effect.id);
          if(clean(effect.applyTiming)==='AddEffect')initialLuck+=number(effect.params[0]);
          else if(clean(effect.applyTiming)==='ActionBegin')actionBeginLuck+=number(effect.params[0]);
        }
        return {initialLuck:Math.min(10,initialLuck),actionBeginLuck};
      };
      const initial=members.map((m,index)=>({m,index,tieOrder:partyOrder.get(Number(m.id)) ?? partyOrder.size+index,firstStrike:firstStrike(m),...luckTraits(m)}));
      const value=(o,staggered)=>{
        const hit=staggered?number(o.brokenDamage,o.damage):o.damage;
        return goals.has('damage') || goals.has('stagger')?(goals.has('damage')?hit/enemyHp:0)+(goals.has('stagger') && !staggered?o.breakDamage/enemyBreak:0):hit;
      };
      const fill=(s,amount)=>{const before=s.gauge;s.gauge=Math.max(0,Math.min(s.m.limit.max,s.gauge+Math.trunc(Math.fround(amount))));s.gained+=s.gauge-before;};
      const outcomes=[];
      for(let sample=0;sample<samples;sample++){
        const state=initial.map(s=>({...s,gauge:Math.max(0,Math.min(number(s.m.limit?.max),number(s.m.limit?.initial))),gained:0,uses:[],finishUses:[],guards:[],extraActions:0,phaseEvents:[],mp:number(s.m.availableMp),mpExhaustedRounds:[],
          hp:number((s.m.actionPlan || s.m.fallbackActionPlan)?.maxHp),hpSpent:0,resourceSkips:[],stateLeafResults:[],resourceEvents:[],goodLuck:s.initialLuck,overclocks:[],overheatUntil:0,openingDone:false,rotationIndex:0,demonForm:false,focusLife:0,focusSpeedUntil:0,gambleDraws:0,combatDraws:0}));
        for(const s of state)s.combatRng=round=>draw(sample,round,s.m.id,0x3ac81f09^Math.imul(++s.combatDraws,0x9e3779b9));
        for(const s of state)s.gambleRng=round=>draw(sample,round,s.m.id,0x2d6a5bc1^Math.imul(++s.gambleDraws,0x9e3779b9));
        let damage=0,breakDamage=0,gauge=0,recoverAt=0,staggers=0,firstStagger=0;
        for(let round=1;round<=rounds;round++){
          const acted=new Set(),pending=new Set(),participated=new Set();
          const grant=(source,target,reason)=>{
            if(source.phase!=='normal' || !target || (target.m.actionPlan || target.m.fallbackActionPlan) && target.hp<=0 || participated.has(target) || pending.has(target))return;
            pending.add(target);target.phaseEvents.push({round,phase:'normal',kind:'bonus-granted',sourceId:source.m.id,reason});
          };
          for(const s of state){
            s.performedAttackThisRound=false;s.phase='normal';s.targetAlive=id=>state.some(target=>target.m.id===id && target.hp>0);
            s.onSourceBreak=(skill,context)=>{
              if(!(skill.effects || []).includes(54101))return;
              const effect=indexes.effects.get(54101),eligible=state.filter(target=>target!==s && !pending.has(target) && !participated.has(target) && (!(target.m.actionPlan || target.m.fallbackActionPlan) || target.hp>0));
              const chance=number(effect.params[0])+number(analysis(s.m.actionPlan?.passiveIds || s.m.fallbackActionPlan?.passiveIds || [],skill,context).modifiers.bonusPhaseChancePercent);
              const proc=D.skillHitSuccess(chance,s.combatRng(round));
              if(proc && eligible.length)grant(s,eligible[Math.min(eligible.length-1,Math.trunc(Math.fround(Math.fround(Math.fround(s.combatRng(round))*Math.fround(1/32767))*Math.fround(eligible.length))))],'random-ally-stagger');
            };
            s.onSkillEnd=(skill,context)=>{
              if(s.phase==='finish' && context.anyHit!==false && number(s.m.limit?.max)>0 && (skill.effectBundles || []).some(bundle=>Number(bundle.effectId)===62000 && clean(bundle.TargetType)==='Self' && clean(bundle.activeSkillAddTiming)==='AfterDamageCalculation'))fill(s,20*number(s.m.limit.mult,1));
              for(const bundle of skill.effectBundles || []){
                const id=Number(bundle.effectId),effect=indexes.effects.get(id);if(!effect)continue;
                if(id===54100 && context.anyHit!==false){const chance=number(effect.params[0])+number(analysis(s.m.actionPlan?.passiveIds || s.m.fallbackActionPlan?.passiveIds || [],skill,{...context,anyCritical:context.anyCritical}).modifiers.bonusPhaseChancePercent);if(D.skillHitSuccess(chance,s.combatRng(round)))grant(s,s,'skill-end');}
                if(id===54105){const proc=D.skillHitSuccess(number(effect.params[0]),s.combatRng(round)),target=state.find(other=>other.m.id===Number(context.friendlyTargetId));if(proc)grant(s,target,'call-to-action');}
              }
            };
          }
          for(const s of state){s.round=round;s.targetBroken=()=>scenario.broken || round<recoverAt;}
          const liveAgility=s=>{
            if(!s.m.actionPlan)return number(s.m.agility);
            const plan=s.m.actionPlan,context=liveContext(s,plan);
            const effects=analysis(plan.passiveIds || [],indexes.skills.get(plan.turn.leaves.find(leaf=>leaf.kind!=='support')?.skillId) || indexes.skills.get(plan.turn.leaves[0]?.skillId),context);
            return number(S.characterStats(catalog,snapshot,plan.characterId,plan.equipment,effects.terms).stats.Agility,s.m.agility);
          };
          const order=state.map(s=>({s,priority:D.initiativePriority({agility:s.m.actionPlan?liveAgility(s):number(round<s.setupUntil?s.m.setupAgility ?? s.m.agility:s.m.agility),
            randomRate:D.initiativeJitter(draw(sample,round,s.m.id,0x51ed270b),rateAmplitude),
            randomFlat:D.initiativeJitter(draw(sample,round,s.m.id,0x68bc21eb),flatAmplitude),waitOffset:round===1?s.firstStrike:0})}))
            .sort((a,b)=>b.priority-a.priority || b.s.tieOrder-a.s.tieOrder || b.s.index-a.s.index).map(o=>o.s);
          const runActor=(s,phase)=>{
            s.phase=phase;
            s.round=round;
        const staggered=scenario.broken || round<recoverAt,lb=s.m.setupLimit && round<s.setupUntil?s.m.setupLimit:phase==='additional' && s.m.bonusLimit?s.m.bonusLimit:s.m.limit;
            const supported=acted.has(s.m.supportSourceId),basePlan=supported && s.m.supportedActionPlan?s.m.supportedActionPlan:s.m.actionPlan || (phase==='additional'?s.m.fallbackActionPlan:null);
            const opening=phase==='normal' && basePlan?.openingTurn && !s.openingDone;
            const policy=basePlan?.luckPolicy,requiredLuck=policy?Math.max(number(policy.requiredLuck),number(policy.requiredTurnLuck)):0;
            const selectedTurn=basePlan && (opening?basePlan.openingTurn:policy?(s.goodLuck>=requiredLuck?policy.spenderTurn:policy.generatorTurn):phase==='additional' && basePlan.bonusTurn || basePlan.rotationTurns?.[s.rotationIndex%basePlan.rotationTurns.length] || basePlan.turn);
            const plan=basePlan && {...basePlan,turn:selectedTurn};
            if(plan && s.hp<=0){s.resourceSkips.push({round,phase:s.phase || 'normal',skillId:0,reason:'The caster has no HP remaining.'});return;}
            const selectionIssue=plan?freshTurnAvailable(s,plan,round):null;
            if(phase==='normal'){s.goodLuck=Math.min(10,s.goodLuck+s.actionBeginLuck);s.focusLife=Math.max(0,s.focusLife-1);}
            const turn=s.m.supportedTurn && supported?s.m.supportedTurn:
              {damage:s.m.damage,brokenDamage:s.m.brokenDamage,breakDamage:s.m.breakDamage,hits:s.m.hits};
            // With the Limit Burst goal ticked it fires as soon as it is ready; otherwise only when it beats the normal turn.
            const bursts=(lb?.options || []).filter(o=>o.cost<=s.gauge).map(o=>plan?liveBurst(s,plan,o,round):o).filter(Boolean);
            const burst=bursts.filter(o=>goals.has('limit') || value(o,staggered)>value(turn,staggered)).sort((a,b)=>value(b,staggered)-value(a,staggered))[0];
            if(burst){s.gauge-=burst.cost;s.uses.push({round,phase,skillId:burst.skillId});}
            let act=burst || turn,paidSupport=false;
            if(!burst){
              if(selectionIssue){if(selectionIssue.resource==='MP')s.mpExhaustedRounds.push(round);s.resourceSkips.push({round,phase,...selectionIssue});act={damage:0,brokenDamage:0,breakDamage:0,hits:[]};}
              else if(number(plan?.turn.mp,s.m.turnMp)>s.mp){s.mpExhaustedRounds.push(round);act={damage:0,brokenDamage:0,breakDamage:0,hits:[]};}
          else{if(plan){s.traceTurn ??= round;act={...turn,hits:liveTurnHits(s,plan,round)};if(opening)s.openingDone=true;else s.rotationIndex++;}else s.mp-=number(s.m.turnMp);paidSupport=true;if(s.m.setupDuration)s.setupUntil=round+s.m.setupDuration;}
            }
            let causedStagger=false,actionIndex=0;
            const finishAction=()=>{if(causedStagger && lb)fill(s,lb.fillOnStagger*lb.mult);causedStagger=false;};
            const consume=hits=>{for(const hit of hits){
              if(hit.actionBoundary){finishAction();actionIndex=number(hit.actionIndex);continue;}
              if(number(hit.actionIndex)!==actionIndex){finishAction();actionIndex=number(hit.actionIndex);}
              const broken=scenario.broken || round<recoverAt;
              // Native HP calculation precedes the new break state; later hits observe the change.
              damage+=broken?number(hit.brokenDamage,hit.damage):hit.damage;
              if(broken)continue;
              breakDamage+=hit.breakDamage;
              gauge+=hit.breakDamage;
              if(gauge<enemyBreak)continue;
              gauge=0;recoverAt=round+1;staggers++;firstStagger||=round;causedStagger=true;
              if(lb)fill(s,gain*lb.mult);
              grant(s,s,'stagger');
              if(allStaggered)for(const target of state)grant(s,target,'all-enemies-staggered');
              s.currentActionNewStagger=true;
            }
              finishAction();
            };
            if(burst){const skill=indexes.skills.get(burst.skillId);if(skill && ['Decrease','RatioDecrease'].includes(clean(skill.parameterVariationType)) && clean(skill.parameterType)==='HitPoint')s.performedAttackThisRound=true;}
            consume(act.hits || [act]);
            if(burst && plan){const used=indexes.skills.get(burst.skillId);if(used)skillStateEffects(s,used,'AfterDamageCalculation',round);s.resourceEvents.push({round,kind:'limit',skillId:burst.skillId,damage:burst.damage,hpAfter:s.hp,mpAfter:s.mp,goodLuckAfter:s.goodLuck});}
            if(burst)fill(s,lb.recuperate*lb.mult);
            if(phase==='normal' && scenario.incomingDamage>0 && plan && s.hp>0){
              const hpBefore=s.hp,mirror=round<s.reactionUntil;
              const guardEffects=s.guards.map(guard=>({...guard})),incomingGuard=guardedIncoming(scenario.incomingDamage,guardEffects,mirror);
              let received=incomingGuard.amount;
              const incoming=analysis(plan.passiveIds || [],indexes.skills.get(plan.turn.leaves.find(leaf=>leaf.kind!=='support')?.skillId) || indexes.skills.get(plan.turn.leaves[0]?.skillId),liveContext(s,plan,{incomingType:scenario.incomingType,performedAttackThisRound:s.performedAttackThisRound}));
              const nullifyChance=number(incoming.modifiers.incomingPhysicalNullifyChance);
              const nullified=nullifyChance>0 && D.skillHitSuccess(nullifyChance,s.combatRng(round));
              if(nullified)received=0;
              s.hp=Math.max(0,s.hp-received);
              s.guards=[];
              if(lb)fill(s,D.damageTakenLb(received,hpBefore,plan.maxHp,number(catalog.battleRules.damagedLBIncrease,50))*lb.mult);
              s.resourceEvents.push({round,kind:'incoming',phase,nullified,damageType:scenario.incomingType,damage:received,hpBefore,hpAfter:s.hp,mirrorReduction:mirror,guardEffects,guardFactor:incomingGuard.factor,guardsConsumed:guardEffects.length>0});
              if(mirror && s.hp>0){
                for(const id of s.reactionSkills || []){
                  const reactionTurn={steps:[{skillId:id,kind:'attack',context:{reaction:true,triggered:true}}],leaves:[{skillId:id,kind:'attack',context:{reaction:true,triggered:true},actionIndex:0}]};
                  consume(liveTurnHits(s,{...plan,turn:reactionTurn},round));
                }
              }
            }
            if(paidSupport && phase==='normal')acted.add(s.m.id);
            if(phase==='additional' && (paidSupport || burst))s.extraActions++;
            s.phaseEvents.push({round,phase,kind:'actor-finished',paid:!!(paidSupport || burst)});
          };
          for(const s of order)runActor(s,'normal');
          // Native Additional commands execute in unique pending-grant insertion order.
          for(const s of pending){participated.add(s);runActor(s,'additional');}
          // Finish opens only after an entered Additional phase, with every living enemy staggered.
          if(pending.size && (scenario.broken || allStaggered && round<recoverAt)){
            const protectionValue=guards=>{
              if(!guards.length || !(scenario.incomingDamage>0) || round>=rounds)return 0;
              return state.filter(target=>target.hp>0).reduce((sum,target)=>{
                const next=[...target.guards.filter(guard=>!guards.some(newGuard=>newGuard.effectId===guard.effectId)),...guards];
                const before=guardedIncoming(scenario.incomingDamage,target.guards).amount,after=guardedIncoming(scenario.incomingDamage,next).amount;
                return sum+Math.max(0,Math.max(0,target.hp-after)-Math.max(0,target.hp-before));
              },0);
            };
            const candidates=[];
            for(const s of state){
              const finish=s.m.finish,basePlan=s.m.actionPlan || s.m.fallbackActionPlan,skill=indexes.skills.get(Number(finish?.skillId));
              if(!finish?.supported || !basePlan || !skill || s.hp<=0)continue;
              s.phase='finish';
              const activeEffectIds=(skill.effectBundles || []).filter(bundle=>clean(bundle.TargetType)==='Self' && clean(bundle.activeSkillAddTiming)==='BeforeDamageCalculation')
                .map(bundle=>Number(bundle.effectId)).filter(id=>{const effect=indexes.effects.get(id);return effect && !P.decode(effect).unsupported;});
              const supportContext=acted.has(s.m.supportSourceId)?s.m.supportedFinishContext || {}:{};
              const context=liveContext(s,basePlan,{...supportContext,activeEffectIds:unique([...(supportContext.activeEffectIds || []),...activeEffectIds])});
              const guards=finishGuards(skill),expectedProtection=protectionValue(guards);
              if(finish.kind==='protection'){
                candidates.push({s,skill,basePlan,supportContext,guards,expectedProtection,score:goalScore({durability:expectedProtection*.02}),damage:0});
              }else if(finish.kind==='healing'){
                const passiveAnalysis=analysis(basePlan.passiveIds || [],skill,context);
                const current=S.characterStats(catalog,snapshot,basePlan.characterId,basePlan.equipment,passiveAnalysis.terms),modifiers=passiveAnalysis.modifiers;
                const scale=1+number(modifiers.coefficientPerLevel)*Math.trunc(current.level)+number(modifiers.coefficientScalePercent)/100;
                const coefficient=Math.fround(Math.fround(Math.fround(number(skill.mag))*Math.fround(scale))+Math.fround(number(modifiers.coefficientAdd)));
                const cap=modifiers.damageCapRaised?RAISED_DAMAGE_CAP:DAMAGE_CAP,divine=number(current.stats.Divine);
                const recovered=D.recovery({divine,coefficient,rules:catalog.battleRules,exPhase:true,cap,allDamage:!!skill.isApplyAllMag});
                const overheal=skill.id===414100,recipients=state.filter(target=>target.hp>0).map(target=>{
                  const maxHp=number((target.m.actionPlan || target.m.fallbackActionPlan)?.maxHp,target.m.stats?.MaxHitPoint);
                  const extraHpBefore=Math.max(0,target.hp-maxHp);
                  const hpAfter=overheal?target.hp+recovered.amount:Math.max(0,Math.min(target.hp+recovered.amount,maxHp+extraHpBefore));
                  return {target,characterId:target.m.id,hpBefore:target.hp,hpAfter,healed:hpAfter-target.hp,maxHp,extraHpBefore};
                });
                const effectiveHealing=recipients.reduce((sum,target)=>sum+target.healed,0);
                candidates.push({s,skill,basePlan,supportContext,context,healing:recovered.amount,recipients,effectiveHealing,common:{statSource:'Divine',divine,coefficient,cap,level:current.level,skill,extraPhase:true,overheal},score:goalScore({durability:effectiveHealing*.02}),damage:0});
              }else{
                const preview=rollState(basePlan.passiveIds || [],skill,basePlan.characterId,basePlan.equipment,context);
                if(!preview.supported)continue;
                candidates.push({s,skill,basePlan,supportContext,guards,expectedProtection,score:goalScore({damage:preview.damage,durability:expectedProtection*.02}),damage:preview.damage});
              }
            }
            const selected=candidates.sort((a,b)=>b.score-a.score || b.damage-a.damage || a.s.tieOrder-b.s.tieOrder)[0];
            if(selected){
              const {s,skill,basePlan}=selected,finish=s.m.finish;
              const leaf={skillId:skill.id,kind:'attack',actionIndex:0,context:{...selected.supportContext}};
              const plan={...basePlan,turn:{leaves:[leaf],steps:[leaf],mp:number(skill.cost)}};
              s.traceTurn ??= round;
              s.phaseEvents.push({round,phase:'finish',kind:'finish-selected',skillId:skill.id,visionId:finish.visionId,secondaryReasons:finish.secondaryReasons || []});
              const applyProtection=(payment,paymentSuppressed)=>{
                const recipients=state.filter(target=>target.hp>0).map(target=>{
                  target.guards=[...target.guards.filter(guard=>!selected.guards.some(newGuard=>newGuard.effectId===guard.effectId)),...selected.guards.map(guard=>({...guard}))];
                  return {characterId:target.m.id,guards:target.guards.map(guard=>({...guard}))};
                });
                s.resourceEvents.push({round,phase:'finish',kind:'finish-protection',skillId:skill.id,visionId:finish.visionId,...payment,mpCost:0,hpCost:0,hpAfter:s.hp,mpAfter:s.mp,paymentSuppressed,guards:selected.guards,recipients,expectedProtection:selected.expectedProtection});
              };
              // The direct Finish command bypasses ordinary menu/AP checks; native leaf payment still runs.
              let executed=false;
              if(finish.kind==='protection'){
                const payment=payLiveSkill(s,plan,skill,leaf,round);
                if(payment){skillStateEffects(s,skill,'BeforeDamageCalculation',round);applyProtection(payment,false);skillStateEffects(s,skill,'AfterDamageCalculation',round,{anyHit:true});s.onSkillEnd?.(skill,{anyHit:true});executed=true;}
              }else if(finish.kind==='healing'){
                const payment=payLiveSkill(s,plan,skill,leaf,round);
                if(payment){
                  skillStateEffects(s,skill,'BeforeDamageCalculation',round);
                  for(const recipient of selected.recipients)recipient.target.hp=recipient.hpAfter;
                  skillStateEffects(s,skill,'AfterDamageCalculation',round,{anyHit:true});s.onSkillEnd?.(skill,{anyHit:true});
                  s.resourceEvents.push({round,phase:'finish',kind:'finish-heal',skillId:skill.id,visionId:finish.visionId,...payment,hpAfter:s.hp,mpAfter:s.mp,healing:selected.healing,effectiveHealing:selected.effectiveHealing,recipients:selected.recipients.map(({target,...recipient})=>recipient),context:selected.context,common:selected.common});
                  executed=true;
                }
              }else for(const hit of liveTurnHits(s,plan,round)){
                if(hit.actionBoundary)continue;
                executed=true;damage+=number(hit.brokenDamage,hit.damage);
              }
              if(executed && finish.kind!=='protection' && selected.guards?.length)applyProtection({},true);
              if(executed)s.finishUses.push({round,phase:'finish',skillId:skill.id,visionId:finish.visionId});
            }
          }

        }
        outcomes.push({sample,damage:damage/rounds,breakDamage:breakDamage/rounds,staggers,firstStagger,
          extraActions:Object.fromEntries(state.map(s=>[s.m.id,s.extraActions])),phaseEvents:Object.fromEntries(state.map(s=>[s.m.id,s.phaseEvents])),
          remainingGuards:Object.fromEntries(state.map(s=>[s.m.id,s.guards.map(guard=>({...guard}))])),finishUses:Object.fromEntries(state.map(s=>[s.m.id,s.finishUses])),uses:Object.fromEntries(state.map(s=>[s.m.id,s.uses])),gauge:Object.fromEntries(state.map(s=>[s.m.id,s.gained/rounds])),
          mpExhaustedRounds:Object.fromEntries(state.map(s=>[s.m.id,s.mpExhaustedRounds])),remainingMp:Object.fromEntries(state.map(s=>[s.m.id,s.mp])),
          remainingHp:Object.fromEntries(state.map(s=>[s.m.id,s.hp])),hpSpent:Object.fromEntries(state.map(s=>[s.m.id,s.hpSpent])),resourceSkips:Object.fromEntries(state.map(s=>[s.m.id,s.resourceSkips])),
          stateLeafResults:Object.fromEntries(state.map(s=>[s.m.id,s.stateLeafResults])),resourceEvents:Object.fromEntries(state.map(s=>[s.m.id,s.resourceEvents])),
          remainingGoodLuck:Object.fromEntries(state.map(s=>[s.m.id,s.goodLuck])),overclockCharges:Object.fromEntries(state.map(s=>[s.m.id,Math.max(0,...s.overclocks.map(clock=>clock.charges))])),overheat:Object.fromEntries(state.map(s=>[s.m.id,rounds<s.overheatUntil])),overclockStates:Object.fromEntries(state.map(s=>[s.m.id,s.overclocks.map(clock=>({...clock}))])),demonForm:Object.fromEntries(state.map(s=>[s.m.id,s.demonForm]))});
      }
      const mean=key=>outcomes.reduce((sum,o)=>sum+o[key],0)/samples;
      const damage=mean('damage'),breakDamage=mean('breakDamage');
      const representative=outcomes.slice().sort((a,b)=>Math.abs(a.damage-damage)/enemyHp+Math.abs(a.breakDamage-breakDamage)/enemyBreak-
        Math.abs(b.damage-damage)/enemyHp-Math.abs(b.breakDamage-breakDamage)/enemyBreak || a.sample-b.sample)[0];
      const averageByMember=key=>Object.fromEntries(members.map(m=>[m.id,outcomes.reduce((sum,o)=>sum+o[key][m.id],0)/samples]));
      return {...representative,damage,breakDamage,staggers:mean('staggers'),gauge:averageByMember('gauge'),remainingMp:averageByMember('remainingMp'),remainingHp:averageByMember('remainingHp'),hpSpent:averageByMember('hpSpent'),
        combatSamples:combatRandom?samples:0,initiativeSamples:samples,gambleSamples:gamblePresent?samples:0,sampleKind:bonusPresent || defenseChancePresent?'native-initiative-and-combat':gamblePresent?'native-initiative-and-gamble':'native-initiative',representativeSample:representative.sample,usesAreRepresentative:samples>1,
        expectedExtraActions:averageByMember('extraActions'),expectedFinishUses:Object.fromEntries(members.map(m=>[m.id,outcomes.reduce((sum,o)=>sum+o.finishUses[m.id].length,0)/samples])),expectedLimitUses:Object.fromEntries(members.map(m=>[m.id,outcomes.reduce((sum,o)=>sum+o.uses[m.id].length,0)/samples]))};
    }
    function setupTurnsFor(prepared,skill){
      const turns=[];
      // These native statuses refresh without stacking; friendly selections target the caster.
      for(const id of [230100,230110,230080,230090]){
        if(!prepared.legal.has(id))continue;
        const setup=indexes.skills.get(id),bundle=setup?.effectBundles?.find(b=>number(b.effectId)>0),effect=indexes.effects.get(Number(bundle?.effectId));
        if(!effect || clean(bundle.activeSkillAddTiming)!=='AfterDamageCalculation' || number(effect.prob,100)!==100 ||
          number(effect.activationProbability,100)!==100 || number(effect.duration)!==5 || clean(effect.proceedTiming)!=='BeginTurn' ||
          clean(effect.condition?.Condition)!=='None' || clean(bundle.conditionData?.Condition)!=='None')continue;
        const term=P.decode(effect);
        let context;
        if(setup.relation==='Friendlies' && term.kind==='damagePercent')context={activeEffectIds:[effect.id],buffCount:1};
        else if(setup.relation==='Enemies' && term.kind==='statPercent' && ['Defence','Mind'].includes(term.parameter)){
          if(number(enemy.statusResistances?.[clean(effect.status)])>0)continue;
          context={targetStatPercent:{parameter:term.parameter,value:term.value}};
        }else continue;
        for(const wrapper of [DUALCAST,ARMS_AKIMBO]){
          if(!prepared.legal.has(wrapper) || !indexes.skills.has(wrapper))continue;
          if(wrapper===DUALCAST && [setup,skill].some(s=>clean(s.attr)!=='Magic'))continue;
          if(catalog.skillRules && [setup,skill].some(s=>!P.skillEligibility(s,{...prepared.stateContext,hierarchySkills:[wrapper],selectorId:wrapper},catalog.skillRules).eligible))continue;
          const reservedIds=unique([wrapper,id]).filter(id=>!prepared.free.has(id));
          const leaves=[{skillId:id,kind:'support',context:{},actionIndex:0},{skillId:skill.id,kind:'attack',context,actionIndex:1}];
          turns.push({reservedIds,reservedCost:equipCostOf(reservedIds),wrapperIds:[wrapper],leaves,
            steps:[{skillId:wrapper,kind:'wrapper',depth:0},...leaves.map(leaf=>({...leaf,depth:1}))],
            recipeLabel:`${indexes.skills.get(wrapper).name} → ${setup.name} (${setup.relation==='Friendlies'?'self':'enemy'}) + ${skill.name}`,
            actions:2,multi:wrapper,boost:false,mp:number(indexes.skills.get(wrapper).cost)+D.skillMpCost(number(setup.cost))+D.skillMpCost(number(skill.cost)),
            context,setupContext:context,setupDuration:5,mixed:true});
        }
      }
      const focusId=400460,focus=indexes.skills.get(focusId);
      if(focus && prepared.legal.has(focusId) && prepared.legal.has(ARMS_AKIMBO) &&
        (!catalog.skillRules || P.skillEligibility(focus,{...prepared.stateContext,hierarchySkills:[ARMS_AKIMBO],selectorId:ARMS_AKIMBO},catalog.skillRules).eligible)){
        for(const child of turnsFor(prepared,skill).filter(turn=>turn.steps[0]?.skillId!==ARMS_AKIMBO)){
          const ancestors=[ARMS_AKIMBO];
          let legal=true;
          for(const step of child.steps){
            ancestors.length=step.depth+1;
            if(catalog.skillRules && !P.skillEligibility(indexes.skills.get(step.skillId),{...prepared.stateContext,hierarchySkills:ancestors,selectorId:ancestors.at(-1)},catalog.skillRules).eligible){legal=false;break;}
            if(step.kind==='wrapper')ancestors.push(step.skillId);
          }
          if(!legal)continue;
          const contextFor=context=>({...context,activeEffectIds:unique([12907,1382,...(context?.activeEffectIds || [])])});
          const leaves=[{skillId:focusId,kind:'support',context:{},actionIndex:0},...child.leaves.map((leaf,index)=>({...leaf,context:contextFor(leaf.context),actionIndex:index+1}))];
          const reservedIds=unique([ARMS_AKIMBO,focusId,...child.reservedIds]).filter(id=>!prepared.free.has(id));
          turns.push({...child,reservedIds,reservedCost:equipCostOf(reservedIds),wrapperIds:unique([ARMS_AKIMBO,...child.wrapperIds]),leaves,
            steps:[{skillId:ARMS_AKIMBO,kind:'wrapper',depth:0},{skillId:focusId,kind:'support',context:{},depth:1},
              ...child.steps.map(step=>({...step,context:step.kind==='wrapper'?step.context:contextFor(step.context),depth:step.depth+1}))],
            recipeLabel:`${indexes.skills.get(ARMS_AKIMBO).name} → Focus (self) + [${child.recipeLabel}]`,actions:child.actions+1,multi:ARMS_AKIMBO,
            mp:number(indexes.skills.get(ARMS_AKIMBO).cost)+number(focus.cost)+child.mp,context:leaves[1].context,
            baseContext:child.context,setupContext:{activeEffectIds:[12907,1382]},setupDuration:2,focus:true,mixed:true});
        }
      }
      return turns;
    }
    function goodLuckRequired(leaves){
      const general=catalog.skillRules?.general || {};
      let spent=0,required=0;
      for(const leaf of leaves){
        const checks=(general.costCheckData || []).filter(row=>Number(row.SkillId)===leaf.skillId && clean(row.costType)==='GoodLuck');
        const cost=leaf.paymentSuppressed?0:(general.additionalCostData || []).filter(row=>Number(row.SkillId)===leaf.skillId && clean(row.costType)==='GoodLuck').reduce((sum,row)=>sum+number(row.Cost),0);
        required=Math.max(required,spent+cost,...checks.map(row=>spent+number(row.Cost)));
        spent+=cost;
      }
      return required;
    }
    function stateTurnsFor(prepared,skill,bestBySkill){
      const base=bestBySkill.get(skill.id)?.turn;
      if(!base)return [];
      const turns=[],has=id=>prepared.legal.has(id) && indexes.skills.has(id);
      const single=id=>({reservedIds:[],reservedCost:0,wrapperIds:[],leaves:[{skillId:id,kind:'support',context:{},actionIndex:0}],
        steps:[{skillId:id,kind:'support',context:{},depth:0}],actions:1,multi:null,boost:false,mp:number(indexes.skills.get(id)?.cost),context:{},recipeLabel:indexes.skills.get(id)?.name});
      const combine=(policy,label,statePolicyKind)=>{
        const phases=[base,...(policy.openingTurn?[policy.openingTurn]:[]),...(policy.rotationTurns || [])];
        const reservedIds=unique(phases.flatMap(turn=>[...(turn.reservedIds || []),...(turn.wrapperIds || []),...turn.leaves.map(leaf=>leaf.skillId).filter(id=>id!==skill.id)]))
          .filter(id=>!prepared.free.has(id));
        turns.push({...base,...policy,reservedIds,reservedCost:equipCostOf(reservedIds),
          wrapperIds:unique(phases.flatMap(turn=>turn.wrapperIds || [])),stateful:true,statePolicyKind,recipeLabel:label});
      };
      if(has(400460))combine({rotationTurns:[single(400460),base]},`Cycle: Focus (self) → ${base.recipeLabel}`,'focus');
      if(has(408090))combine({openingTurn:single(408090)},`Open with Witching Hour; then ${base.recipeLabel}`,'form');
      const mechabo=new Set(catalog.skillRules?.general?.overclockTargetSkills || []);
      if(base.leaves.some(leaf=>mechabo.has(leaf.skillId)) && has(404130)){
        combine({openingTurn:single(404130)},`Open with Overclock; then ${base.recipeLabel}`,'overclock');
        if(has(404140))combine({rotationTurns:[single(404130),single(404140),single(404130),base,base]},
          `Cycle: Overclock → Overclock Zero → Overclock → ${base.recipeLabel} → ${base.recipeLabel}`,'overclock-stack');
      }
      if([406050,406070].includes(skill.id) && has(406080)){
        const generator=bestBySkill.get(406080)?.turn;
        if(generator){
          const checks=(catalog.skillRules?.general?.costCheckData || []).filter(row=>Number(row.SkillId)===skill.id && clean(row.costType)==='GoodLuck');
          const requiredLuck=Math.max(0,...checks.map(row=>number(row.Cost))),requiredTurnLuck=goodLuckRequired(base.leaves);
          combine({rotationTurns:[generator,base],luckPolicy:{generatorTurn:generator,spenderTurn:base,requiredLuck,requiredTurnLuck}},
            `Generate Good Luck to ${Math.max(requiredLuck,requiredTurnLuck)} with ${generator.recipeLabel}; then ${base.recipeLabel}`,'luck');
        }
      }
      return turns;
    }
    function reactionTurnsFor(prepared,bestBySkill){
      const mirror=indexes.skills.get(400790);
      if(!(number(options.incomingDamage)>0) || !mirror || !prepared.legal.has(mirror.id))return [];
      const eligible=skill=>!catalog.skillRules || P.skillEligibility(skill,{...prepared.stateContext,reaction:true,triggered:true},catalog.skillRules).eligible;
      const select=type=>prepared.active.filter(skill=>clean(skill.dmgType)===type && skill.id!==400240 && eligible(skill) && bestBySkill.has(skill.id))
        .sort((a,b)=>bestBySkill.get(b.id).score-bestBySkill.get(a.id).score || number(a.cost)-number(b.cost)).slice(0,2);
      const plans=[];
      for(const physical of select('Physic'))for(const magical of select('Magic')){
        const reactionSkills=[physical.id,magical.id];
        const reservedIds=unique([mirror.id,magical.id]).filter(id=>!prepared.free.has(id));
        const leaf={skillId:mirror.id,kind:'support',context:{},actionIndex:0};
        plans.push({skill:physical,turn:{reservedIds,reservedCost:equipCostOf(reservedIds),wrapperIds:[mirror.id],
          leaves:[leaf],steps:[{...leaf,depth:0}],scoringLeaves:reactionSkills.map(skillId=>({skillId,kind:'attack',context:{}})),
          reactionSkills,selectionMp:number(mirror.cost)+number(physical.cost)+number(magical.cost),reactionSetup:true,stateful:true,actions:1,multi:null,boost:false,mp:number(mirror.cost),context:{},
          reactionRequirements:'Requires the configured incoming damage event after this stance; each selected response pays its own cost and cannot start an ordinary counter chain.',
          recipeLabel:`${mirror.name} → on incoming damage: ${physical.name} + ${magical.name}`}});
      }
      return plans;
    }
    // Native recipes preserve independent child choices; mixed search uses a bounded shortlist.
    function turnsFor(prepared,skill,otherSkill=null){
      const DOUBLE_ACTION=400710;
      const eligible=(action,parents)=>!catalog.skillRules || P.skillEligibility(action,{...prepared.stateContext,
        hierarchySkills:parents,selectorId:parents.at(-1)},catalog.skillRules).eligible;
      const has=(id,parents)=>prepared.legal.has(id) && indexes.skills.has(id) && eligible(indexes.skills.get(id),parents);
      const attack=(action,boost=false,reckless=false)=>{const context=boost?{activeEffectIds:[MAGIC_BOOST_EFFECT]}:reckless?{activeEffectIds:[15112]}:{};
        return {wrapper:null,leaves:[{skillId:action.id,boost,reckless,context}],steps:[{skillId:action.id,kind:'attack',boost,reckless,context,depth:0}],
          wrapperIds:[],mp:D.skillMpCost(number(action.cost),boost || reckless?[150]:[]),label:action.name};};
      const wrap=(id,children)=>({wrapper:id,leaves:children.flatMap(child=>child.leaves),
        steps:[{skillId:id,kind:'wrapper',depth:0},...children.flatMap(child=>child.steps.map(step=>({...step,depth:step.depth+1})))],
        wrapperIds:unique([id,...children.flatMap(child=>child.wrapperIds)]),
        mp:number(indexes.skills.get(id)?.cost)+children.reduce((sum,child)=>sum+child.mp,0),
        label:`${indexes.skills.get(id)?.name || id} → ${children.map(child=>child.wrapper?`[${child.label}]`:child.label).join(' + ')}`});
      const pair=(id,left,right,parents)=>has(id,parents) && eligible(left,[...parents,id]) && eligible(right,[...parents,id]) &&
        (id!==DUALCAST || [left,right].every(action=>clean(action.attr)==='Magic')) &&
        (id!==DOUBLE_ACTION || [left,right].every(action=>clean(action.attr)!=='Magic'));
      function branches(action,parents=[]){
        const choices=[];
        if(eligible(action,parents))choices.push(attack(action));
        if(has(MAGIC_BOOST,parents) && clean(action.dmgType)==='Magic' && eligible(action,[...parents,MAGIC_BOOST]))choices.push(wrap(MAGIC_BOOST,[attack(action,true)]));
        if(has(400700,parents) && clean(action.dmgType)==='Physic' && eligible(action,[...parents,400700]))choices.push(wrap(400700,[attack(action,false,true)]));
        if(scenario.enemyCount===1 && has(400360,parents) && clean(action.attr)==='Magic' && eligible(action,[...parents,400360])){
          const children=Array.from({length:4},(_,index)=>{
            const child=attack(action),context={activeEffectIds:[12945,15128]};
            const payment={mpCost:index===0?D.skillMpCost(number(action.cost),[]):0,paymentSuppressed:index>0};
            child.leaves=child.leaves.map(leaf=>({...leaf,...payment,context}));
            child.steps=child.steps.map(step=>({...step,...payment,context}));
            return child;
          });
          // Native Magic Barrage reruns one chosen spell four times; only its first child pays.
          choices.push({...wrap(400360,children),mp:number(indexes.skills.get(400360)?.cost)+D.skillMpCost(number(action.cost),[])});
        }
        for(const id of [DUALCAST,DOUBLE_ACTION])if(pair(id,action,action,parents))choices.push(wrap(id,[attack(action),attack(action)]));
        return choices;
      }
      let recipes=otherSkill?[]:branches(skill);
      if(otherSkill){
        for(const id of [DUALCAST,DOUBLE_ACTION])if(pair(id,skill,otherSkill,[]))recipes.push(wrap(id,[attack(skill),attack(otherSkill)]));
      }
      if(has(ARMS_AKIMBO,[])){
        for(const left of branches(skill,[ARMS_AKIMBO]))for(const right of branches(otherSkill || skill,[ARMS_AKIMBO]))recipes.push(wrap(ARMS_AKIMBO,[left,right]));
      }
      // The selector spends from a maximum of ten; do not queue siblings that require unavailable luck.
      return recipes.filter(recipe=>goodLuckRequired(recipe.leaves)<=10).map(recipe=>{
        const reservedIds=unique([...recipe.wrapperIds,...recipe.leaves.map(leaf=>leaf.skillId).filter(id=>id!==skill.id)]).filter(id=>!prepared.free.has(id));
        const leaves=recipe.leaves.map((action,actionIndex)=>({...action,actionIndex}));
        return {reservedIds,reservedCost:equipCostOf(reservedIds),wrapperIds:recipe.wrapperIds,leaves,steps:recipe.steps,requiredGoodLuck:goodLuckRequired(leaves),
          recipeLabel:recipe.label,actions:leaves.length,multi:leaves.length>1?recipe.wrapper:null,boost:leaves.some(action=>action.boost),
          mp:recipe.mp,context:leaves[0]?.context || {},mixed:!!otherSkill,reckless:leaves.some(action=>action.reckless)};
      });
    }
    function evaluate({characterId,visionId,equipment,current=false,equippedSkillIds}){
      const prepared=prep(characterId,visionId,current,equippedSkillIds);
      if(!prepared.saved || !C.joined(prepared.saved))return {valid:false,score:-Infinity};
      if(prepared.fixed){
        const allowed=new Set([...prepared.learn.learnedActiveIds,...prepared.learn.learnedPassiveIds,...prepared.learn.masterSkillIds,...prepared.free]);
        if(prepared.equippedIds.some(id=>!allowed.has(id)))return {valid:false,score:-Infinity,reason:'The fixed ability loadout contains an unknown or unlearned ability.'};
      }
      const freeIds=unique([...prepared.borrowed,...gearPassives(equipment)]),results=[],rollByContext=new Map();
      const consider=(skill,turn)=>{
        const packageInfo=passivePackage(prepared,visionId,skill,equipment,freeIds,turn);
        const allPassives=unique([...freeIds,...packageInfo.passiveIds,...turn.reservedIds.filter(id=>indexes.passives.has(id))]);
        const passiveAnalysis=analysis(allPassives,skill,{...turn.context,lbCapacity:prepared.limitMax});
        const calculated=S.characterStats(catalog,snapshot,characterId,equipment,passiveAnalysis.terms);
        const stats={...calculated.stats,level:calculated.level};
        const baseAgility=turn.focus?S.characterStats(catalog,snapshot,characterId,equipment,analysis(allPassives,skill,turn.baseContext || {}).terms).stats.Agility:stats.Agility;
        const criticalAnalysis=analysis(allPassives,skill,{critical:true,...turn.context});
        const criticalStats=S.characterStats(catalog,snapshot,characterId,equipment,criticalAnalysis.terms).stats;
        const availableMp=Math.floor(number(stats.MaxMagicPoint ?? stats.MagicPoint)*scenario.mpPercent/100);
        const reservedIds=packageInfo.reservedIds || turn.reservedIds,reservedCost=equipCostOf(reservedIds);
        // Initial pair reservation is unverified; recommend only initially affordable complete pairs.
        if(turn.reactionSkills && turn.mp+turn.reactionSkills.reduce((sum,id)=>sum+number(indexes.skills.get(id)?.cost),0)>availableMp)return;
        if(turn.mp>availableMp || packageInfo.cost+reservedCost>calculated.skillBudget || packageInfo.equippedIds.length+packageInfo.activeSlots+reservedIds.length>calculated.maxSkillSlots)return;
        const leafRolls=turn.leaves.map(leaf=>{
          const leafSkill=indexes.skills.get(leaf.skillId);
          if(leaf.kind==='support'){
            const empty={supported:true,damage:0,damageMin:0,damageMax:0,breakDamage:0,breakVerified:true,hits:[]};
            return {normal:empty,broken:empty,actionIndex:leaf.actionIndex,skillId:leaf.skillId,kind:leaf.kind,context:leaf.context};
          }
          const key=`${leaf.skillId}:${allPassives.slice().sort((a,b)=>a-b).join(',')}:${JSON.stringify(leaf.context)}`;
          if(!rollByContext.has(key)){
            const normal=rollState(allPassives,leafSkill,characterId,equipment,leaf.context);
            const broken=scenario.broken?normal:rollState(allPassives,leafSkill,characterId,equipment,{...leaf.context,broken:true});
            rollByContext.set(key,{normal,broken});
          }
          return {...rollByContext.get(key),actionIndex:leaf.actionIndex,skillId:leaf.skillId,kind:leaf.kind || 'attack',context:leaf.context,mpCost:leaf.mpCost,paymentSuppressed:leaf.paymentSuppressed};
        });
        if(leafRolls.some(leaf=>!leaf.normal.supported))return;
        const single=leafRolls.find(leaf=>leaf.kind!=='support')?.normal || leafRolls[0].normal;
        const damage={...single,damage:leafRolls.reduce((sum,leaf)=>sum+leaf.normal.damage,0),
          damageMin:leafRolls.reduce((sum,leaf)=>sum+leaf.normal.damageMin,0),damageMax:leafRolls.reduce((sum,leaf)=>sum+leaf.normal.damageMax,0),
          hits:leafRolls.flatMap(leaf=>combatHits(leaf.normal,leaf.broken).map(hit=>({...hit,actionIndex:leaf.actionIndex}))),
          brokenDamage:leafRolls.reduce((sum,leaf)=>sum+leaf.broken.damage,0),breakDamage:leafRolls.reduce((sum,leaf)=>sum+leaf.normal.breakDamage,0)};
        const cost=packageInfo.cost+reservedCost,selected=[...packageInfo.equippedIds,...reservedIds],packageFree=new Set(packageInfo.freeActiveIds),activeSelected=packageFree.has(skill.id)?[]:[skill.id];
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
        const call=indexes.skills.get(401140),callBundle=call?.effectBundles?.find(bundle=>Number(bundle.effectId)===54105),callEffect=indexes.effects.get(54105);
        const callSupported=prepared.legal.has(401140) && call?.relation==='Friendlies' && clean(call.target)==='Single' &&
          clean(callBundle?.TargetType)==='SkillTarget' && clean(callBundle?.targetRelation)==='Friendlies' && clean(callBundle?.activeSkillAddTiming)==='AfterDamageCalculation' &&
          clean(callBundle?.conditionData?.Condition || 'None')==='None' && clean(callEffect?.type)==='AddExPhase' && number(callEffect?.params?.[0])===100 &&
          number(callEffect?.prob,100)===100 && number(callEffect?.activationProbability,100)===100 && clean(callEffect?.condition?.Condition || 'None')==='None';
        if(callSupported)ensureSupport([call],'bonusPhase');
        const legalSkills=new Set([...packageFree,...activeSelected,...selected]);
        const supportActions=[...prepared.support.buffs,...prepared.support.debuffs].filter(a=>legalSkills.has(a.skillId) && number(a.mpCost)<=availableMp && number(a.probability,100)===100 && number(a.activationProbability,100)===100);
        if(callSupported && legalSkills.has(call.id) && number(call.cost)<=availableMp)supportActions.push({skillId:call.id,name:call.name,kind:'bonusPhase',mpCost:number(call.cost),rootRelation:'Friendlies',rootTarget:'Single',effectId:54105,probability:100,activationProbability:100});
        const survivability=number(stats.MaxHitPoint)*.02+defenseSum(stats,passiveAnalysis.modifiers);
        const limit=prepared.limitMax>0?limitInfo(prepared,equipment,unique([...allPassives,...turn.reservedIds])):null;
        const setupLimit=limit && turn.setupContext?limitInfo(prepared,equipment,unique([...allPassives,...turn.reservedIds]),turn.setupContext):null;
        const fallbackActionPlan={turn,openingTurn:turn.openingTurn,rotationTurns:turn.rotationTurns,luckPolicy:turn.luckPolicy,characterId,equipment,passiveIds:allPassives,maxHp:number(stats.MaxHitPoint),maxMp:number(stats.MaxMagicPoint ?? stats.MagicPoint)};
        const actionPlan=scenario.incomingDamage>0 || turn.focus || turn.stateful || turn.openingTurn || turn.rotationTurns || turn.leaves.some(leaf=>hpCostsFor(leaf.skillId).length || indexes.skills.get(leaf.skillId)?.hasUnit==='Jake' || clean(indexes.skills.get(leaf.skillId)?.attr)==='Mechabo' || (indexes.skills.get(leaf.skillId)?.effects || []).some(id=>[54100,54101].includes(id))) || allPassives.some(id=>[1511,1499,1404].includes(id))?fallbackActionPlan:null;
        const fight=simulateFight([{id:characterId,agility:baseAgility,setupAgility:turn.focus?stats.Agility:undefined,passiveIds:allPassives,damage:damage.damage,brokenDamage:damage.brokenDamage,breakDamage:damage.breakDamage,hits:damage.hits,limit,setupLimit,setupDuration:turn.setupDuration,availableMp,turnMp:turn.mp,actionPlan,fallbackActionPlan,finish:prepared.finish}]);
        const score=goalScore({damage:fight.damage,breakDamage:damage.breakVerified?fight.breakDamage:0,gauge:fight.gauge[characterId],durability:number(fight.remainingHp[characterId],stats.MaxHitPoint)>0?(survivability+.02*(number(fight.remainingHp[characterId],stats.MaxHitPoint)-number(stats.MaxHitPoint)))*.5:0});
        const warnings=[...(calculated.warnings || []),...(prepared.learn.warnings || [])];
        if(packageInfo.masterIds.length)warnings.push('Spirit bundles use native mastery grants and their descriptions; exact runtime expansion has not been traced.');
        if(prepared.excludedActions.length)warnings.push(`Actions excluded by native state/resource rules: ${prepared.excludedActions.join(' | ')}`);
        if(!catalog.skillRules)warnings.push('Action-state rules were not loaded; this is an arithmetic-only check.');
        if(!damage.breakVerified && goals.has('stagger'))warnings.push('Stagger damage formula is not implemented; this objective is unavailable.');
        if(turn.multi)warnings.push(`${turn.recipeLabel}. Native child filters, hierarchy restrictions and queue order are enforced.`);
        if(turn.boost)warnings.push('Each Magic Boost applies to its own following magic attack; its native MP factor uses truncation.');
        if(fight.mpExhaustedRounds[characterId].length)warnings.push(`Not enough MP for the chosen action in rounds ${fight.mpExhaustedRounds[characterId].join(', ')}; those turns contribute no damage. MP recovery and replacement actions are not modeled.`);
        results.push({valid:true,score,...damage,turn,limit,setupLimit,finish:prepared.finish,actionPlan,fallbackActionPlan,baseAgility:turn.focus?baseAgility:undefined,setupAgility:turn.focus?stats.Agility:undefined,focus:!!turn.focus,remainingHp:fight.remainingHp[characterId],hpSpent:fight.hpSpent[characterId],resourceSkips:fight.resourceSkips[characterId],fightDamage:fight.damage,fightBreakDamage:fight.breakDamage,limitUses:fight.uses[characterId],finishUses:fight.finishUses?.[characterId] || [],expectedFinishUses:number(fight.expectedFinishUses?.[characterId]),finishCount:(fight.finishUses?.[characterId] || []).length,remainingGuards:fight.remainingGuards?.[characterId] || [],gaugePerRound:fight.gauge[characterId],firstStagger:fight.firstStagger,mpExhaustedRounds:fight.mpExhaustedRounds[characterId],remainingMp:fight.remainingMp[characterId],skillId:skill.id,actionCount:turn.actions,multiActionId:turn.multi,magicBoost:turn.boost,turnMp:turn.mp,singleDamage:single.damage,skillCost:supportCost,skillBudget:calculated.skillBudget,maxSkillSlots:calculated.maxSkillSlots,
          stateLeafResults:fight.stateLeafResults[characterId],resourceEvents:fight.resourceEvents[characterId],remainingGoodLuck:fight.remainingGoodLuck[characterId],overclockCharges:fight.overclockCharges[characterId],overclockStates:fight.overclockStates[characterId],overheat:fight.overheat[characterId],demonForm:fight.demonForm[characterId],
          leafResults:fight.stateLeafResults[characterId]?.length?fight.stateLeafResults[characterId]:leafRolls.map(leaf=>({skillId:leaf.skillId,kind:leaf.kind,context:leaf.context,mpCost:leaf.mpCost,paymentSuppressed:leaf.paymentSuppressed,damage:leaf.normal.damage,breakDamage:leaf.normal.breakDamage,common:leaf.normal.common})),
          recipeLabel:turn.recipeLabel,recipeSteps:turn.steps,skillIds:unique([...turn.leaves.map(leaf=>leaf.skillId),...(turn.reactionSkills || [])]),recklessAbandonment:!!turn.reckless,mixedSearchApproximate:true,initiativeSamples:fight.initiativeSamples,gambleSamples:fight.gambleSamples,combatSamples:fight.combatSamples,extraActions:fight.extraActions?.[characterId],expectedExtraActions:fight.expectedExtraActions?.[characterId],phaseEvents:fight.phaseEvents?.[characterId],sampleKind:fight.sampleKind,expectedLimitUses:fight.expectedLimitUses,representativeSample:fight.representativeSample,
          passiveIds:packageInfo.passiveIds,equippedSkillIds:unique([...selected,...activeSelected]),alwaysPassiveIds:freeIds,stats,level:calculated.level,
          canHeal,canProtect:canProtect || !!turn.reactionSetup,supportTags:supports.map(s=>s.role),supportSkillIds:supports.map(s=>s.skillId),supportActions,
          appliedSynergies:passiveAnalysis.applied.map(t=>({name:t.passiveName || t.type,reason:`${t.passiveName || t.type}: ${t.kind} ${t.value ?? t.element} ${t.parameter || ''}`})),
          passiveAnalysis,criticalAnalysis,criticalStats,coverage:passiveAnalysis.coverage,warnings,availableMp});
      };
      for(const skill of prepared.active)for(const turn of turnsFor(prepared,skill))consider(skill,turn);
      // Preserve repeated baselines, then test at most four mixed recipes from damage/stagger/MP leaders.
      const bestBySkill=new Map();
      for(const result of results){const current=bestBySkill.get(result.skillId);if(!current || result.score>current.score)bestBySkill.set(result.skillId,result);}
      const baseline=[...bestBySkill.values()];
      const shortlist=unique([
        ...baseline.slice().sort((a,b)=>b.score-a.score).slice(0,1).map(r=>r.skillId),
        ...baseline.slice().sort((a,b)=>b.damage/b.actionCount-a.damage/a.actionCount).slice(0,1).map(r=>r.skillId),
        ...baseline.slice().sort((a,b)=>b.breakDamage/b.actionCount-a.breakDamage/a.actionCount).slice(0,1).map(r=>r.skillId),
        ...baseline.slice().sort((a,b)=>number(indexes.skills.get(a.skillId)?.cost)-number(indexes.skills.get(b.skillId)?.cost)).slice(0,1).map(r=>r.skillId),
        ...baseline.slice().sort((a,b)=>b.score-a.score).map(r=>r.skillId)
      ]).slice(0,4);
      const leafProxy=new Map();
      for(const result of results)for(const [index,leaf] of result.turn.leaves.entries()){
        const key=`${leaf.skillId}:${JSON.stringify(leaf.context)}`;
        const hits=result.hits.filter(hit=>number(hit.actionIndex)===index);
        const score=goalScore({damage:hits.reduce((sum,hit)=>sum+hit.damage,0),breakDamage:hits.reduce((sum,hit)=>sum+hit.breakDamage,0)});
        if(!leafProxy.has(key) || score>leafProxy.get(key).score)leafProxy.set(key,{hits,score});
      }
      const mixed=[];
      for(const first of shortlist)for(const second of shortlist){
        if(first===second)continue;
        const skill=indexes.skills.get(first),base=bestBySkill.get(first);
        for(const turn of turnsFor(prepared,skill,indexes.skills.get(second))){
          if(turn.mp>base.availableMp)continue;
          const hits=turn.leaves.flatMap((leaf,index)=>{
            const sample=leafProxy.get(`${leaf.skillId}:${JSON.stringify(leaf.context)}`);
            return (sample?.hits || []).map(hit=>({...hit,actionIndex:index}));
          });
          if(!hits.length)continue;
          const proxy=simulateFight([{id:characterId,agility:base.stats.Agility,damage:hits.reduce((sum,hit)=>sum+hit.damage,0),
            brokenDamage:hits.reduce((sum,hit)=>sum+hit.brokenDamage,0),breakDamage:hits.reduce((sum,hit)=>sum+hit.breakDamage,0),
            hits,limit:base.limit,availableMp:base.availableMp,turnMp:turn.mp}]);
          const approx=goalScore({damage:proxy.damage,breakDamage:proxy.breakDamage,gauge:proxy.gauge[characterId]});
          mixed.push({skill,turn,approx});
        }
      }
      const chosen=new Set();
      let successfulMixed=0;
      // Reuse already calculated hit records; invalid AP/slot mixtures do not spend a successful candidate slot.
      for(const entry of mixed.sort((a,b)=>b.approx-a.approx || a.turn.mp-b.turn.mp)){
        if(successfulMixed>=4)break;
        const key=entry.turn.steps.map(step=>step.skillId).join(',');
        if(chosen.has(key))continue;
        chosen.add(key);
        const before=results.length;
        consider(entry.skill,entry.turn);
        if(results.length>before)successfulMixed++;
      }
      for(const id of shortlist){const skill=indexes.skills.get(id);for(const turn of setupTurnsFor(prepared,skill))consider(skill,turn);}

      const stateSkills=unique([...shortlist,...[406050,406070].filter(id=>bestBySkill.has(id))]);
      const stateFamilies=new Map();
      for(const id of stateSkills){
        const skill=indexes.skills.get(id);
        for(const turn of stateTurnsFor(prepared,skill,bestBySkill)){
          if(!stateFamilies.has(turn.statePolicyKind))stateFamilies.set(turn.statePolicyKind,[]);
          stateFamilies.get(turn.statePolicyKind).push({skill,turn});
        }
      }
      let statePolicies=0;
      // Try each native state family before spending the remaining budget on alternative skills in that family.
      while(statePolicies<8 && [...stateFamilies.values()].some(queue=>queue.length)){
        for(const queue of stateFamilies.values()){
          if(statePolicies>=8)break;
          while(queue.length){
            const {skill,turn}=queue.shift(),before=results.length;
            consider(skill,turn);
            if(results.length>before){statePolicies++;break;}
          }
        }
      }

      for(const {skill,turn} of reactionTurnsFor(prepared,bestBySkill))consider(skill,turn);

      const luckPassives=[1511,1499].filter(id=>prepared.learned.includes(id));
      if(!prepared.fixed && luckPassives.length){
        const bases=results.slice().sort((a,b)=>b.score-a.score).slice(0,2);
        for(const base of bases)for(let mask=1;mask<(1<<luckPassives.length);mask++){
          const reservedIds=unique([...base.turn.reservedIds,...luckPassives.filter((_,i)=>mask&(1<<i))]);
          consider(indexes.skills.get(base.skillId),{...base.turn,reservedIds,reservedCost:equipCostOf(reservedIds)});
        }
      }

      // Phase-only abilities have zero value in a normal-turn surrogate; compare their legal packages explicitly.
      if(!prepared.fixed){
        const ranked=results.slice().sort((a,b)=>b.score-a.score),phaseBases=new Set([ranked[0]]);
        for(const ids of [[447800,447810],[447400,447410]])phaseBases.add(ranked.find(result=>result.turn.leaves.some(leaf=>ids.includes(leaf.skillId))));
        for(const base of [...phaseBases].filter(Boolean)){
          const ids=[1335,...(base.turn.leaves.some(leaf=>[447800,447810].includes(leaf.skillId))?[1361,1466]:[]),...(base.turn.leaves.some(leaf=>[447400,447410].includes(leaf.skillId))?[1436]:[])].filter(id=>prepared.learned.includes(id));
          for(let mask=1;mask<(1<<ids.length);mask++){
            const reservedIds=unique([...base.turn.reservedIds,...ids.filter((_,index)=>mask&(1<<index))]);
            consider(indexes.skills.get(base.skillId),{...base.turn,reservedIds,reservedCost:equipCostOf(reservedIds)});
          }
        }
      }

      const conditionalPassives=[...(prepared.limitMax>0?[1404]:[]),...(scenario.incomingDamage>0 && scenario.incomingType==='Physic'?[1334]:[])].filter(id=>prepared.learned.includes(id));
      if(!prepared.fixed && conditionalPassives.length)for(const base of results.slice().sort((a,b)=>b.score-a.score).slice(0,2)){
        for(const id of conditionalPassives){
          const optionalOpening=id===1404 && prepared.learned.includes(1004)?[[],[1004]]:[[]];
          for(const opening of optionalOpening){const reservedIds=unique([...base.turn.reservedIds,id,...opening]);consider(indexes.skills.get(base.skillId),{...base.turn,reservedIds,reservedCost:equipCostOf(reservedIds)});}
        }
      }

      // Retry the best turns with LB gauge passives reserved; they only pay off through Limit Bursts in the fight simulation.
      // Only the strongest learned fill-rate passive is tried (Triple over Double), on the best turn.
      const charges=LB_CHARGE_IDS.filter(id=>prepared.learned.includes(id)).slice(-1),extras=LB_EXTRA_IDS.filter(id=>prepared.learned.includes(id));
      if(!prepared.fixed && (prepared.limits.length || (goals.has('limit') && prepared.limitMax>0)) && charges.length+extras.length){
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
        const override=overrides[m.characterId];
        const e=override?.supportedTurn?{...m.evaluation,supportSourceId:override.supportSourceId,supportedTurn:override.supportedTurn,supportedActionPlan:override.supportedActionPlan,supportedFinishContext:override.supportedFinishContext}:{...m.evaluation,...override};
        return {id:m.characterId,agility:e.baseAgility ?? e.stats.Agility,setupAgility:e.setupAgility,damage:e.damage,brokenDamage:e.brokenDamage,breakDamage:number(e.breakDamage),hits:e.hits,limit:e.limit,availableMp:e.availableMp,turnMp:e.turnMp,setupLimit:e.setupLimit,setupDuration:e.turn?.setupDuration,actionPlan:e.actionPlan,fallbackActionPlan:e.fallbackActionPlan,finish:e.finish,bonusLimit:e.bonusLimit,supportedActionPlan:e.supportedActionPlan,supportedFinishContext:e.supportedFinishContext,
          passiveIds:unique([...(e.alwaysPassiveIds || []),...(e.passiveIds || [])]),supportSourceId:e.supportSourceId,supportedTurn:e.supportedTurn};
      }));
      let fight=simulate({});
      const fightScore=f=>goalScore({damage:f.damage,breakDamage:f.breakDamage,gauge:members.reduce((sum,m)=>sum+number(f.gauge[m.characterId]),0)/Math.max(1,members.length)});
      // Call replaces the normal command; the selected ally's paid additional turn is queued by the native phase model.
      for(const caster of members)for(const action of caster.evaluation.supportActions || []){
        if(action.kind!=='bonusPhase' || action.skillId!==401140)continue;
        const source=caster.evaluation,original=source.actionPlan || source.fallbackActionPlan;
        if(!original?.turn)continue;
        for(const target of members.filter(member=>member!==caster)){
          const targetPlan=target.evaluation.actionPlan || target.evaluation.fallbackActionPlan;
          if(!targetPlan || number(targetPlan.maxHp)<=0)continue;
          const context={friendlyTargetId:target.characterId},mpCost=number(action.mpCost,number(indexes.skills.get(action.skillId)?.cost));
          const leaf={skillId:action.skillId,kind:'support',context,mpCost,actionIndex:0};
          const callTurn={leaves:[leaf],steps:[{...leaf,depth:0}],mp:mpCost,recipeLabel:`${action.name} → ${indexes.characters.get(target.characterId)?.name || target.characterId}`};
          const callPlan={...original,turn:callTurn,openingTurn:undefined,rotationTurns:undefined,luckPolicy:undefined,bonusTurn:original.turn};
          const overrides={[caster.characterId]:{skillId:action.skillId,skillIds:[action.skillId],damage:0,damageMin:0,damageMax:0,brokenDamage:0,breakDamage:0,hits:[],
            turnMp:mpCost,actionCount:1,multiActionId:null,magicBoost:false,limit:source.limit?{...source.limit,options:[]}:null,bonusLimit:source.bonusLimit || source.limit,
            setupLimit:null,turn:callTurn,actionPlan:callPlan,recipeLabel:callTurn.recipeLabel,recipeSteps:callTurn.steps,
            leafResults:[{skillId:action.skillId,kind:'support',context,mpCost,damage:0,breakDamage:0,common:{}}],
            actionDescription:`Uses ${action.name} instead of its normal attack; ${indexes.characters.get(target.characterId)?.name || target.characterId} may take one paid additional participation after normal actors finish.`}};
          const nextFight=simulate(overrides);
          if(fightScore(nextFight)>fightScore(fight)){
            fight=nextFight;damage=baseline-source.damage;breakDamage=baselineBreak-number(source.breakDamage);actionOverrides=overrides;
            supportUsed={characterId:caster.characterId,skillId:action.skillId,kind:'bonusPhase',targetIds:[target.characterId]};
            supportDescription=`${indexes.characters.get(caster.characterId)?.name || caster.characterId} uses ${action.name} on ${indexes.characters.get(target.characterId)?.name || target.characterId}. It costs ${mpCost} MP each normal turn; the recipient pays its own additional action cost. Duplicate grants do not add another participation.`;
          }
        }
      }
      // A support action replaces its caster's attack. No free pre-buff or off-turn setup.
      for(const caster of members){
        if(!goals.has('damage'))break;
        for(const action of caster.evaluation.supportActions || []){
          if(!['damagePercent','statPercent'].includes(action.kind))continue;
          if(clean(action.rootTarget)==='Self' || clean(action.bundleTarget)==='Self')continue;
          if(isAttack(indexes.skills.get(action.skillId)))continue;
          const supportMp=number(action.mpCost,number(indexes.skills.get(action.skillId)?.cost));
          // Same-turn support is recast each round; partial buff uptime and MP recovery are not inferred.
          if(supportMp*scenario.rounds>number(caster.evaluation.availableMp))continue;
          const recipients=members.filter(m=>m!==caster);
          if(!recipients.length)continue;
          if(action.kind==='statPercent' && (action.rootRelation!=='Enemies' || !['Defence','Mind'].includes(action.parameter)))continue;
          if(action.rootRelation==='Enemies' && number(enemy.statusResistances?.[action.parameter==='Defence'?'DeffenceDown':'MindDown'])>0)continue;
          const groups=action.rootRelation==='Enemies' || /All|Multi|Group/.test(action.rootTarget)?[recipients]:recipients.map(m=>[m]);
          for(const targets of groups){
            let next=baseline-caster.evaluation.damage;
            let nextBreak=baselineBreak-number(caster.evaluation.breakDamage);
            const casterEvaluation=caster.evaluation;
            const supportTurn={leaves:[{skillId:action.skillId,kind:'support',context:{},mpCost:supportMp,actionIndex:0}],steps:[{skillId:action.skillId,kind:'support',context:{},mpCost:supportMp,depth:0}],mp:supportMp,recipeLabel:action.name};
            const supportPlan=scenario.incomingDamage>0 || casterEvaluation.actionPlan?{turn:supportTurn,bonusTurn:casterEvaluation.turn,characterId:caster.characterId,
              equipment:caster.equipment || savedById.get(caster.characterId)?.equipment,
              passiveIds:unique([...(casterEvaluation.alwaysPassiveIds || []),...(casterEvaluation.passiveIds || []),...(casterEvaluation.actionPlan?.passiveIds || [])]),
              maxHp:number(casterEvaluation.stats.MaxHitPoint),maxMp:number(casterEvaluation.stats.MaxMagicPoint ?? casterEvaluation.availableMp)}:null;
            const overrides={[caster.characterId]:{skillId:action.skillId,damage:0,damageMin:0,damageMax:0,brokenDamage:0,breakDamage:0,hits:[],turnMp:supportMp,actionCount:1,multiActionId:null,magicBoost:false,limit:casterEvaluation.limit?{...casterEvaluation.limit,options:[]}:null,bonusLimit:casterEvaluation.limit,setupLimit:null,turn:supportPlan?supportTurn:null,actionPlan:supportPlan,recipeLabel:action.name,actionDescription:'Recasts a support action each round instead of attacking.'}};
            for(const target of targets){
              const evaluation=target.evaluation,skill=indexes.skills.get(evaluation.skillId);
              if((action.tests || []).some(test=>test.key!=='skill.dmgType'))continue;
              const context=action.kind==='damagePercent'?{additionalDamagePercent:action.value}:
                {targetStatPercent:{parameter:action.parameter,value:action.value}};
              const passiveIds=unique([...(evaluation.alwaysPassiveIds || []),...(evaluation.passiveIds || [])]);
              const equipment=target.equipment || savedById.get(target.characterId)?.equipment;
              const leaves=evaluation.turn?.leaves || Array.from({length:number(evaluation.actionCount,1)},()=>({skillId:skill.id,context:evaluation.turn?.context || {}}));
              const supportContext=leaf=>{
                const selected=indexes.skills.get(leaf.skillId ?? skill.id);
                const existingIds=leaf.context?.activeEffectIds || [];
                const duplicate=existingIds.some(id=>id===action.effectId || (clean(indexes.effects.get(id)?.status)!=='None' && clean(indexes.effects.get(id)?.status)===clean(indexes.effects.get(action.effectId)?.status))) || (action.kind==='statPercent' && leaf.context?.targetStatPercent?.parameter===action.parameter);
                const matches=!duplicate && !(action.tests || []).some(test=>test.key==='skill.dmgType' && clean(selected.dmgType)!==clean(test.value)) &&
                  (action.kind!=='statPercent' || action.parameter===(clean(selected.calcType)==='Magic'?'Mind':'Defence'));
                return matches?context:{};
              };
              const revise=(leaf,isBroken)=>leaf.kind==='support'?{damage:0,damageMin:0,damageMax:0,breakDamage:0,hits:[]}:rollState(passiveIds,indexes.skills.get(leaf.skillId ?? skill.id),target.characterId,equipment,{...leaf.context,...supportContext(leaf),...(isBroken?{broken:true}:{})});
              const revised=leaves.map(leaf=>revise(leaf,false));
              const broken=leaves.map(leaf=>revise(leaf,true));
              const sum=key=>revised.reduce((total,r)=>total+number(r[key]),0);
              const supportedTurn={damage:sum('damage'),damageMin:sum('damageMin'),damageMax:sum('damageMax'),brokenDamage:broken.reduce((total,r)=>total+r.damage,0),
                breakDamage:sum('breakDamage'),hits:revised.flatMap((r,i)=>combatHits(r,broken[i]).map(hit=>({...hit,actionIndex:i})))};
              next+=supportedTurn.damage-evaluation.damage;
              nextBreak+=supportedTurn.breakDamage-number(evaluation.breakDamage);
              const supportPhase=phase=>phase && ({...phase,leaves:phase.leaves.map(leaf=>({...leaf,context:{...leaf.context,...supportContext(leaf)}}))});
              const referencePlan=evaluation.actionPlan || evaluation.fallbackActionPlan;
              const supportedActionPlan=referencePlan?{...referencePlan,turn:supportPhase(evaluation.turn),bonusTurn:supportPhase(referencePlan.bonusTurn),openingTurn:supportPhase(referencePlan.openingTurn),rotationTurns:referencePlan.rotationTurns?.map(supportPhase),luckPolicy:referencePlan.luckPolicy?{...referencePlan.luckPolicy,generatorTurn:supportPhase(referencePlan.luckPolicy.generatorTurn),spenderTurn:supportPhase(referencePlan.luckPolicy.spenderTurn)}:undefined}:null;
              overrides[target.characterId]={...supportedTurn,skillId:skill.id,supportedTurn,supportedActionPlan,supportedFinishContext:evaluation.finish?.supported?supportContext({skillId:evaluation.finish.skillId,context:{}}):{},supportSourceId:caster.characterId,actionDescription:`Receives ${action.name} only when its caster acts earlier in the sampled round.`};
            }
            const nextFight=simulate(overrides);
            if(fightScore(nextFight)>fightScore(fight)){fight=nextFight;damage=next;breakDamage=nextBreak;actionOverrides=overrides;supportUsed={characterId:caster.characterId,skillId:action.skillId,targetIds:targets.map(m=>m.characterId)};
              supportDescription=`${indexes.characters.get(caster.characterId).name} uses ${action.name} instead of attacking; allies receive its same-turn benefit only when the caster acts earlier in each sampled round.`;}
          }
        }
      }
      const roundDamage=damage,roundBreakDamage=breakDamage;
      damage=fight.damage;breakDamage=fight.breakDamage;
      const defenseScore=members.reduce((sum,m)=>{const hp=m.evaluation.actionPlan || m.evaluation.fallbackActionPlan?number(fight.remainingHp[m.characterId],m.evaluation.stats.MaxHitPoint):number(m.evaluation.stats.MaxHitPoint);return sum+(hp>0?hp*.01+defenseSum(m.evaluation.stats,m.evaluation.passiveAnalysis?.modifiers)*.5:0);},0);
      const gaugePerRound=members.reduce((sum,m)=>sum+number(fight.gauge[m.characterId]),0)/Math.max(1,members.length);
      const score=goalScore({damage,breakDamage,gauge:gaugePerRound,durability:defenseScore});
      return {score,damage,breakDamage,roundDamage,roundBreakDamage,limitUses:fight.uses,gauge:fight.gauge,mpExhaustedRounds:fight.mpExhaustedRounds,remainingMp:fight.remainingMp,remainingHp:fight.remainingHp,hpSpent:fight.hpSpent,resourceSkips:fight.resourceSkips,stateLeafResults:fight.stateLeafResults,resourceEvents:fight.resourceEvents,remainingGoodLuck:fight.remainingGoodLuck,overclockCharges:fight.overclockCharges,overclockStates:fight.overclockStates,overheat:fight.overheat,demonForm:fight.demonForm,staggers:fight.staggers,firstStagger:fight.firstStagger,rounds:scenario.rounds,supportUsed,supportDescription,actionOverrides,warnings:globalWarnings,
        initiativeSamples:fight.initiativeSamples,gambleSamples:fight.gambleSamples,combatSamples:fight.combatSamples,extraActions:fight.extraActions,expectedExtraActions:fight.expectedExtraActions,finishUses:fight.finishUses || {},expectedFinishUses:fight.expectedFinishUses || {},finishCount:Object.values(fight.finishUses || {}).reduce((sum,uses)=>sum+uses.length,0),remainingGuards:fight.remainingGuards || {},phaseEvents:fight.phaseEvents,sampleKind:fight.sampleKind,representativeSample:fight.representativeSample,usesAreRepresentative:true,expectedLimitUses:fight.expectedLimitUses,
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

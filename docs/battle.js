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
    const options={objective:'balanced',critical:false,broken:false,mpPercent:100,minHealers:0,minProtectors:0,...provided};
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
      horizon:'One ordinary action per member; legal support actions spend that member’s action. No free setup, finisher or multi-command activation assumed.'};
    const evidence={formula:'Native executable damage helpers; see docs/damage-research.md.',stats:'Native XP/growth/seed/sync/equipment derivation; cross-save HP checks.',
      passives:'Native effect IDs, timing, conditions and additive damage bucket.',
      search:'Bounded joint search; passive packages use a knapsack surrogate and are then evaluated with native math.',
      calibration:'Static native-formula verification, not a live battle measurement.'};
    const prepCache=new Map(),analysisCache=new Map(),packageCache=new Map();
    const unknownArtifacts=(snapshot.artifactOverrides || []).filter(a=>a.active && !(catalog.artifacts || []).some(row=>row.id===a.id));
    const activeNativeArtifacts=(catalog.artifacts || []).filter(a=>snapshot.inventory.some(i=>i.id===a.id && i.quantity>0) && ((snapshot.artifactOverrides||[]).find(o=>o.id===a.id)?.active ?? a.initialActive));
    const globalWarnings=[];
    if(unknownArtifacts.length)globalWarnings.push(`Unmapped active artifact IDs ${unknownArtifacts.map(a=>a.id).join(', ')}: their battle effects are not inferred.`);
    if(activeNativeArtifacts.length)globalWarnings.push(`Active artifacts ${activeNativeArtifacts.map(a=>a.name || a.id).join(', ')} are listed but their modifiers are not modeled.`);
    globalWarnings.push('Native damage predictions have not been calibrated against a recorded battle. Enemy base rows may differ from the actual encounter.');
    globalWarnings.push('Numeric rankings exclude attacks below 100 native accuracy. Enemy evasion and reactive counters are not simulated.');
    function prep(characterId,visionId){
      const key=`${characterId}:${visionId}`;
      if(prepCache.has(key))return prepCache.get(key);
      const saved=savedById.get(characterId),native=indexes.characters.get(characterId);
      const learn=S.learned(catalog,snapshot,characterId,visionId);
      const free=new Set(learn.freeActiveIds || []);
      const skills=unique([...free,...(learn.learnedActiveIds || [])]).map(id=>indexes.skills.get(id)).filter(Boolean);
      const stateContext={demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0,resources:{}};
      const eligibility=skill=>{
        const result=catalog.skillRules?P.skillEligibility(skill,stateContext,catalog.skillRules):{eligible:true,reasons:[],deferred:['Native action-state rules were not loaded.']};
        if(result.additionalCosts?.length || result.costOverride){result.eligible=false;result.reasons.push('Special resource cost/override is not modeled.');}
        return result;
      };
      const legalSkills=skills.filter(skill=>eligibility(skill).eligible);
      const active=legalSkills.filter(isAttack);
      const excludedActions=skills.filter(isAttack).map(skill=>({skill,result:eligibility(skill)})).filter(row=>!row.result.eligible).map(row=>`${row.skill.name}: ${[...row.result.reasons,...row.result.deferred].join('; ')}`);
      const borrowed=unique(learn.alwaysPassiveIds || []),learned=unique(learn.learnedPassiveIds || []);
      const support=P.supportActions(catalog,legalSkills.map(s=>s.id));
      const healSkills=legalSkills.filter(isHealing);
      const protectSkills=unique([...support.buffs.filter(a=>['physicalReductionPercent','magicReductionPercent'].includes(a.kind)).map(a=>a.skillId),
        ...legalSkills.filter(s=>s.relation==='Friendlies' && (s.effects || []).some(id=>clean(indexes.effects.get(id)?.type)==='Cover')).map(s=>s.id)]).map(id=>indexes.skills.get(id));
      const result={saved,native,learn,free,skills,active,borrowed,learned,support,healSkills,protectSkills,excludedActions};
      prepCache.set(key,result);return result;
    }
    function analysis(ids,skill,extra={}){
      const key=ids.slice().sort((a,b)=>a-b).join(',')+':'+skill.id+':'+JSON.stringify(extra);
      if(analysisCache.has(key))return analysisCache.get(key);
      const context={skill,element:clean(skill.element),hpPercent:100,mpPercent:scenario.mpPercent,lbPercent:0,
        broken:scenario.broken,extraPhase:false,critical:scenario.critical,analyzed:false,notTargeted:false,statusIds:[],targetStatusIds:[],...extra};
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
        criticalBonus:number(passiveAnalysis.modifiers.critDamagePercent)/100,broken:scenario.broken,exPhase:false,
        difficultyGiven:scenario.difficultyGiven,rules:catalog.battleRules,
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
          criticalBonus:number(critAnalysis.modifiers.critDamagePercent)/100};
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
    function passivePackage(prepared,visionId,skill,equipment,freeIds){
      const stats0=S.characterStats(catalog,snapshot,prepared.saved.id,equipment,[]);
      const totalBudget=number(stats0.skillBudget,prepared.learn.skillBudget),totalSlots=number(stats0.maxSkillSlots,8);
      const effectiveElement=analysis(freeIds,skill).modifiers.element;
      const key=`${prepared.saved.id}:${visionId}:${skill.id}:${effectiveElement}:${totalBudget}:${totalSlots}:${options.objective}`;
      if(packageCache.has(key))return packageCache.get(key);
      const reference=prepared.saved.equipment;
      const baseIds=unique(prepared.borrowed),baseAnalysis=analysis(baseIds,skill);
      const baseFinal=S.characterStats(catalog,snapshot,prepared.saved.id,reference,baseAnalysis.terms);
      baseFinal.stats.level=baseFinal.level;
      const baseline=rollDamage(baseFinal.stats,skill,baseAnalysis,{level:baseFinal.level});
      function valueOf(ids){
        const candidateAnalysis=analysis(unique([...baseIds,...ids]),skill,{element:effectiveElement});
        const final=S.characterStats(catalog,snapshot,prepared.saved.id,reference,candidateAnalysis.terms);final.stats.level=final.level;
        const calculated=rollDamage(final.stats,skill,candidateAnalysis,{level:final.level});
        let value=Math.max(0,calculated.damage-baseline.damage);
        if(options.objective==='break')value+=Math.max(0,calculated.breakDamage-baseline.breakDamage)*100;
        if(options.objective==='balanced')value+=Math.max(0,number(final.stats.MaxHitPoint)-number(baseFinal.stats.MaxHitPoint))*.05+
          Math.max(0,number(final.stats.PhysicalDefense)-number(baseFinal.stats.PhysicalDefense))*2+
          Math.max(0,number(final.stats.MagicalDefense)-number(baseFinal.stats.MagicalDefense))*2;
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
          if(fixedIds.includes(id) || fixedPassives.includes(id) || baseIds.includes(id))continue;
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
    function evaluate({characterId,visionId,equipment}){
      const prepared=prep(characterId,visionId);
      if(!prepared.saved || !C.joined(prepared.saved))return {valid:false,score:-Infinity};
      const freeIds=unique([...prepared.borrowed,...gearPassives(equipment)]),results=[];
      for(const skill of prepared.active){
        const packageInfo=passivePackage(prepared,visionId,skill,equipment,freeIds);
        const allPassives=unique([...freeIds,...packageInfo.passiveIds]);
        const passiveAnalysis=analysis(allPassives,skill);
        const calculated=S.characterStats(catalog,snapshot,characterId,equipment,passiveAnalysis.terms);
        const stats={...calculated.stats,level:calculated.level};
        const criticalAnalysis=analysis(allPassives,skill,{critical:true});
        const criticalStats=S.characterStats(catalog,snapshot,characterId,equipment,criticalAnalysis.terms).stats;
        const availableMp=Math.floor(number(stats.MaxMagicPoint ?? stats.MagicPoint)*scenario.mpPercent/100);
        if(number(skill.cost)>availableMp || packageInfo.cost>calculated.skillBudget || packageInfo.equippedIds.length+packageInfo.activeSlots>calculated.maxSkillSlots)continue;
        const damage=rollDamage(stats,skill,passiveAnalysis,{level:calculated.level,criticalAnalysis,criticalStats});
        if(!damage.supported)continue;
        const cost=packageInfo.cost,selected=packageInfo.equippedIds.slice(),packageFree=new Set(packageInfo.freeActiveIds),activeSelected=packageFree.has(skill.id)?[]:[skill.id];
        const supports=[];
        let supportCost=cost,slotsUsed=selected.length+activeSelected.length;
        function ensureSupport(candidates,role){
          const affordable=candidates.filter(Boolean).filter(s=>number(s.cost)<=availableMp).sort((a,b)=>(packageFree.has(a.id)?0:number(a.equipCost))-(packageFree.has(b.id)?0:number(b.equipCost)));
          for(const action of affordable){
            const alreadyFree=packageFree.has(action.id) || activeSelected.includes(action.id);
            const extra=alreadyFree?0:number(action.equipCost),extraSlots=alreadyFree?0:1;
            if(supportCost+extra>calculated.skillBudget || slotsUsed+extraSlots>calculated.maxSkillSlots)continue;
            if(extraSlots){activeSelected.push(action.id);supportCost+=extra;slotsUsed++;}
            supports.push({role,skillId:action.id});return true;
          }
          return false;
        }
        const canHeal=ensureSupport(prepared.healSkills,'healer'),canProtect=ensureSupport(prepared.protectSkills,'protector');
        for(const supportId of unique([...prepared.support.buffs,...prepared.support.debuffs].filter(a=>['damagePercent','statPercent'].includes(a.kind)).map(a=>a.skillId)).slice(0,3))ensureSupport([indexes.skills.get(supportId)],'support');
        const legalSkills=new Set([...packageFree,...activeSelected]);
        const supportActions=[...prepared.support.buffs,...prepared.support.debuffs].filter(a=>legalSkills.has(a.skillId) && number(a.mpCost)<=availableMp && number(a.probability,100)===100 && number(a.activationProbability,100)===100);
        const survivability=number(stats.MaxHitPoint)*.02+number(stats.PhysicalDefense)+number(stats.MagicalDefense);
        const score=options.objective==='break'?(damage.breakVerified?damage.breakDamage:0):damage.damage+(options.objective==='balanced'?survivability*.5:0);
        const warnings=[...(calculated.warnings || []),...(prepared.learn.warnings || [])];
        if(packageInfo.masterIds.length)warnings.push('Spirit bundles use native mastery grants and their descriptions; exact runtime expansion has not been traced.');
        if(prepared.excludedActions.length)warnings.push(`Actions excluded by native state/resource rules: ${prepared.excludedActions.join(' | ')}`);
        if(!catalog.skillRules)warnings.push('Action-state rules were not loaded; this is an arithmetic-only check.');
        if(!damage.breakVerified && options.objective==='break')warnings.push('Stagger damage formula is not implemented; this objective is unavailable.');
        if(prepared.support.multiActions.length)warnings.push('Multi-action commands are owned, but their special command restrictions are not yet simulated. These are ordinary single-action predictions.');
        results.push({valid:true,score,...damage,skillId:skill.id,skillCost:supportCost,skillBudget:calculated.skillBudget,maxSkillSlots:calculated.maxSkillSlots,
          passiveIds:packageInfo.passiveIds,equippedSkillIds:unique([...selected,...activeSelected]),alwaysPassiveIds:freeIds,stats,level:calculated.level,
          canHeal,canProtect,supportTags:supports.map(s=>s.role),supportSkillIds:supports.map(s=>s.skillId),supportActions,
          appliedSynergies:passiveAnalysis.applied.map(t=>({name:t.passiveName || t.type,reason:`${t.passiveName || t.type}: ${t.kind} ${t.value ?? t.element} ${t.parameter || ''}`})),
          passiveAnalysis,criticalAnalysis,criticalStats,coverage:passiveAnalysis.coverage,warnings,availableMp});
      }
      if(!results.length)return {valid:false,score:-Infinity,reason:'No supported, affordable, legally learned ordinary attack.'};
      return results.sort((a,b)=>b.score-a.score || b.damage-a.damage)[0];
    }
    function evaluateParty(members){
      const baseline=members.reduce((sum,m)=>sum+m.evaluation.damage,0);
      const baselineBreak=members.reduce((sum,m)=>sum+number(m.evaluation.breakDamage),0);
      let damage=baseline,breakDamage=baselineBreak,supportDescription='',supportUsed=null,actionOverrides={};
      // A support action replaces its caster's attack. No free pre-buff or off-turn setup.
      for(const caster of members){
        if(options.objective==='break')break;
        for(const action of caster.evaluation.supportActions || []){
          if(!['damagePercent','statPercent'].includes(action.kind))continue;
          if(isAttack(indexes.skills.get(action.skillId)))continue;
          const casterAgility=number(caster.evaluation.stats.Agility);
          const recipients=members.filter(m=>m!==caster && number(m.evaluation.stats.Agility)<=casterAgility);
          if(!recipients.length)continue;
          if(action.kind==='statPercent' && !['Defence','Mind'].includes(action.parameter))continue;
          if(action.rootRelation==='Enemies' && number(enemy.statusResistances?.[action.parameter==='Defence'?'DeffenceDown':'MindDown'])>0)continue;
          const groups=action.rootRelation==='Enemies' || /All|Multi/.test(action.rootTarget)?[recipients]:recipients.map(m=>[m]);
          for(const targets of groups){
            let next=baseline-caster.evaluation.damage;
            let nextBreak=baselineBreak-number(caster.evaluation.breakDamage);
            const overrides={[caster.characterId]:{skillId:action.skillId,damage:0,damageMin:0,damageMax:0,breakDamage:0,actionDescription:'Uses a support action instead of attacking.'}};
            for(const target of targets){
              const evaluation=target.evaluation,skill=indexes.skills.get(evaluation.skillId);
              if(action.tests?.some(test=>test.key==='skill.dmgType' && clean(skill.dmgType)!==clean(test.value)))continue;
              if((action.tests || []).some(test=>test.key!=='skill.dmgType'))continue;
              if(action.kind==='statPercent' && action.parameter!==(clean(skill.calcType)==='Magic'?'Mind':'Defence'))continue;
              const context=action.kind==='damagePercent'?{additionalDamagePercent:action.value}:
                {defense:Math.max(1,number(enemy.stats[action.parameter]) + S.effectDelta(number(enemy.stats[action.parameter]),{kind:'statPercent',value:action.value}))};
              const revised=rollDamage(evaluation.stats,skill,evaluation.passiveAnalysis,{level:evaluation.level,criticalAnalysis:evaluation.criticalAnalysis,criticalStats:evaluation.criticalStats,...context});
              next+=revised.damage-evaluation.damage;
              nextBreak+=number(revised.breakDamage)-number(evaluation.breakDamage);
              overrides[target.characterId]={skillId:skill.id,damage:revised.damage,damageMin:revised.damageMin,damageMax:revised.damageMax,breakDamage:revised.breakDamage,actionDescription:`Receives ${action.name} before acting.`};
            }
            if(next>damage){damage=next;breakDamage=nextBreak;actionOverrides=overrides;supportUsed={characterId:caster.characterId,skillId:action.skillId,targetIds:targets.map(m=>m.characterId)};
              supportDescription=`${indexes.characters.get(caster.characterId).name} uses ${action.name} instead of attacking; only allies acting later by Agility receive the same-turn benefit.`;}
          }
        }
      }
      const defenseScore=members.reduce((sum,m)=>sum+number(m.evaluation.stats.MaxHitPoint)*.01+(number(m.evaluation.stats.PhysicalDefense)+number(m.evaluation.stats.MagicalDefense))*.5,0);
      const score=options.objective==='break'?breakDamage:damage+(options.objective==='balanced'?defenseScore:0);
      return {score,damage,breakDamage,supportUsed,supportDescription,actionOverrides,warnings:globalWarnings,
        baselineDamage:baseline,objective:options.objective,objectiveWeights:options.objective==='balanced'?'expected damage + 0.01 × HP + 0.5 × (DEF + MDEF) per member':'expected damage'};
    }
    return {evaluate,evaluateParty,scenario,evidence,globalWarnings,prep};
  }
  const api={createModel,knapsack,isAttack,isHealing};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionBattle=api;
})(typeof globalThis!=='undefined'?globalThis:this);

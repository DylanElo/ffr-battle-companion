(function(root){
  'use strict';
  const D=typeof module!=='undefined'?require('./damage.js'):root.NativeDamage;
  const P=typeof module!=='undefined'?require('./passives.js'):root.CompanionPassives;
  const clean=value=>String(value ?? '').split('::').pop();
  const cache=new WeakMap();
  function costForSkill(catalog,passiveOccurrences,skill,context={}){
    let indexes=cache.get(catalog);
    if(!indexes || indexes.effects!==catalog.effects || indexes.passives!==catalog.passives){
      indexes={effects:catalog.effects,passives:catalog.passives,effectById:new Map((catalog.effects || []).map(row=>[row.id,row])),
        passiveById:new Map((catalog.passives || []).map(row=>[row.id,row]))};
      cache.set(catalog,indexes);
    }
    const deferred=[],effects=[],appliedEffectIds=[],suppressedEffectIds=[],percentFactors=[];
    const defer=(effectId,reason)=>deferred.push({effectId,reason});
    function add(id,bundle){
      const effect=indexes.effectById.get(Number(id));
      if(!effect || !['CostVariation','IgnoreCostChange'].includes(clean(effect.type)))return;
      if(Number(effect.prob ?? 100)!==100 || Number(effect.activationProbability ?? 100)!==100){defer(effect.id,'MP cost effect probability is not deterministic.');return;}
      for(const condition of [bundle?.conditionData,effect.condition]){
        const state=P.condition(condition || {Condition:'None'},{...context,skill});
        if(state.state==='no')return;
        if(state.state!=='yes'){defer(effect.id,state.reason || 'MP cost condition is unresolved.');return;}
      }
      effects.push(effect);
    }
    for(const id of passiveOccurrences || []){
      const passive=indexes.passiveById.get(Number(id));
      const seen=new Set();
      for(const bundle of passive?.effectBundles || []){
        if(seen.has(Number(bundle.effectId)))continue;
        seen.add(Number(bundle.effectId));
        const effect=indexes.effectById.get(Number(bundle.effectId));
        if(!effect || !['CostVariation','IgnoreCostChange'].includes(clean(effect.type)))continue;
        if(clean(bundle.passiveSkillAddTiming)!=='SpawnUnit' || clean(bundle.TargetType)!=='Self' || clean(bundle.targetRelation)!=='Friendlies'){
          defer(effect.id,'MP cost effect requires an unmodeled activation event or recipient.');continue;
        }
        add(bundle.effectId,bundle);
      }
    }
    const active=(context.activeEffectIds || []).map(Number);
    if(context.boost && !active.includes(61004))active.push(61004);
    if(context.reckless && !active.includes(61003))active.push(61003);
    for(const id of active)add(id);
    const ignored=new Set(effects.filter(effect=>clean(effect.type)==='IgnoreCostChange').map(effect=>Number(effect.params?.[0])));
    const area=context.areaEffect;
    for(const effect of effects){
      if(clean(effect.type)!=='CostVariation')continue;
      if(ignored.has(effect.id)){suppressedEffectIds.push(effect.id);continue;}
      const p=effect.params || [];
      if(p.length<9 || !Number.isFinite(p[1]) || p[1]<0 || ![0,1].includes(p[8]) || p.slice(9).some(value=>value!==-1)){
        defer(effect.id,'Unrecognized native MP cost layout.');continue;
      }
      if(p[0]!==2)continue;
      if(p[2]!==0){
        if(!P.attributes[p[2]]){defer(effect.id,'Unknown MP cost skill attribute.');continue;}
        if(clean(skill.attr)!==P.attributes[p[2]])continue;
      }
      if(p[3]>0){
        if(!Number.isFinite(context.limitBurstPoints)){defer(effect.id,'Current LB points are required for this MP cost effect.');continue;}
        if(context.limitBurstPoints<p[3])continue;
      }
      if(p[4]!==-1){
        if(!Number.isInteger(context.commandId)){defer(effect.id,'Current command ID is required for this MP cost effect.');continue;}
        if(context.commandId!==p[4])continue;
      }
      if(p[6]!==0){
        if(!P.damageTypes[p[6]]){defer(effect.id,'Unknown MP cost damage type.');continue;}
        if(clean(skill.dmgType)!==P.damageTypes[p[6]])continue;
      }
      if(p[5]!==-1){
        if(typeof area!=='boolean'){defer(effect.id,'The native area-cost flag is required for this MP cost effect.');continue;}
        if(!area)continue;
      }
      if(p[7]===0){
        if(catalog.skillRules?.damageCalc?.[clean(skill.calcType)]?.doCalcSkillDamage===false || clean(skill.parameterType)!=='HitPoint' ||
          !['Decrease','RatioDecrease'].includes(clean(skill.parameterVariationType)))continue;
      }else if(p[7]===1){
        if(clean(skill.parameterType)!=='HitPoint' || !['Increase','RatioIncrease'].includes(clean(skill.parameterVariationType)))continue;
      }else if(p[7]!==-1){defer(effect.id,'Unknown MP cost action-kind filter.');continue;}
      if(p[8]===1 && !['Group','Spread','All'].includes(clean(skill.target))){
        if(typeof area!=='boolean'){defer(effect.id,'The native area-cost flag is required for this MP cost target filter.');continue;}
        if(!area)continue;
      }
      percentFactors.push(p[1]);appliedEffectIds.push(effect.id);
    }
    return {cost:D.skillMpCost(Number(skill.cost ?? 0),percentFactors),percentFactors,appliedEffectIds,suppressedEffectIds,deferred};
  }
  const api={costForSkill};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionMpCosts=api;
})(typeof globalThis!=='undefined'?globalThis:this);

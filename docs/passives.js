(function(root){
  'use strict';
  const clean=value=>String(value??'').split('::').pop();
  const elements=['None','Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'];
  const parameters=['None','HitPoint','MagicPoint','BreakPoint','LimitBurstPoint','Attack','Defence','Intelligence','Mind','Agility','Level','EquipCost','PhysicalAttack','PhysicalDefense','MagicalAttack','MagicalDefense','Divine','Role','SkillDamageType','AP'];
  const attributes=['None','Fight','ChaseAttack','Ability','Magic','LimitBurst','Item','Summon','Mechabo','FinishBlow','MixItem','Throw','ThrowMoney','Dualcast','Mimic','MagicSword','Escape'];
  const damageTypes=['None','Physic','Magic'];
  const resistances=['None','Weakness','Halved','Invalid','Absorb','Reflect'];
  const resistancePriority={None:0,Weakness:25,Halved:50,Invalid:75,Absorb:100};
  const utilityTypes=new Set(['ExperienceUp','ExperienceUpCap','MoneyUp','MoneyUpCap','APUp','APUpCap','ItemDropUp','EncountRatio','Preemtive','StealRate','StealRareRate']);
  const catalogCache=new WeakMap(),effectCache=new WeakMap();
  const evidence={
    parameters:'Native eUnitParameterType / eUnitParameterVariationType; current DT_SkillEffectData ParamList.',
    additiveDamage:'Installed executable common multiplier helper 0x14523e3e0 sums DamageCalculation and target-break effect factors into one bucket, clamped >= 0.',
    critical:'Installed executable helper 0x145238c00 adds critical effect factors to the native critical base.',
    limits:'Unsupported timing, conditions, effect types, random activation and parameter layouts are excluded explicitly. Multi-copy identical-effect stacking is not verified.'
  };
  const add=(object,key,value)=>{object[key]=(object[key]||0)+value;};
  const known=value=>value!==undefined && value!==null;
  function condition(condition,context){
    if(!condition || clean(condition.Condition)==='None')return {state:'yes'};
    const kind=clean(condition.Condition),p=Number(condition.param1);
    if(kind==='HasStatusCondition')return known(context.statusIds)?{state:context.statusIds.includes(p)?'yes':'no'}:{state:'unknown',reason:'Self status condition not supplied.'};
    if(kind==='DealDamageType')return context.skill?{state:clean(context.skill.dmgType)===damageTypes[p]?'yes':'no'}:{state:'unknown',reason:'Damage type context required.'};
    if(kind==='DealSkillAttrType')return context.skill?{state:clean(context.skill.attr)===attributes[p]?'yes':'no'}:{state:'unknown',reason:'Skill attribute context required.'};
    return {state:'unknown',reason:`Unmodeled activation condition ${kind}.`};
  }
  function filters(term,context){
    for(const test of term.tests || []){
      const {key,value,comparison}=test;
      const actual=key.startsWith('skill.')?context.skill?.[key.slice(6)]:context[key];
      if(!known(actual))return {state:'unknown',reason:`Requires ${key}.`};
      const passed=comparison==='min'?Number(actual)>=value:comparison==='nonempty'?actual.length>0:clean(actual)===clean(value);
      if(!passed)return {state:'no'};
    }
    return {state:'yes'};
  }
  function decode(effect){
    const p=effect.params || [],type=clean(effect.type),term={effectId:effect.id,type,tests:[]};
    const requireValue=(key,value,comparison='equal')=>term.tests.push({key,value,comparison});
    const reject=reason=>({unsupported:reason});
    const allDefault=(start,allowed=-1)=>p.slice(start).every(n=>Number(n)===allowed);
    if(type==='ParameterContinuousVariation'){
      if(!parameters[p[1]] || ![0,1,2,3].includes(p[2]) || !p.slice(3,6).every(n=>Number(n)===0) || !allDefault(6))return reject('Unrecognized continuous parameter layout.');
      term.kind=[0,1].includes(p[2])?'statFlat':'statPercent';term.parameter=parameters[p[1]];term.value=Number(p[0])*([1,3].includes(p[2])?-1:1);return term;
    }
    if(type==='DamageMultiplier'){
      if(![0,1,2].includes(p[5]) || !attributes[p[3]] || ![-1,0].includes(p[8]) || Number(p[11])!==-1)return reject('Unmodeled damage multiplier filter.');
      if(Number(p[1])>0)requireValue('lbPercent',Number(p[1]),'min');
      if(Number(p[2])>=0)requireValue('commandId',Number(p[2]));
      if(Number(p[3])>0)requireValue('skill.attr',attributes[p[3]]);
      if(Number(p[4])>=0)requireValue('analyzed',Number(p[4])!==0);
      if(Number(p[5])>0)requireValue('skill.dmgType',damageTypes[p[5]]);
      if(Number(p[6])>=0)requireValue('targetStatusIds',null,'nonempty');
      if(Number(p[7])>=0)requireValue('extraPhase',Number(p[7])!==0);
      if(Number(p[9])>0)requireValue('hpPercent',Number(p[9]),'min');
      if(Number(p[10])>=0)requireValue('critical',Number(p[10])!==0);
      if(Number(p[12])>=0)requireValue('notTargeted',Number(p[12])!==0);
      if(Number(p[13])>=0)requireValue('mpPercent',Number(p[13]),'min');
      if(Number(p[14])>=0)requireValue('element','None');
      if(clean(effect.applyTiming)==='DamageCalculationOnBreak')requireValue('broken',true);
      term.kind='damagePercent';term.value=Number(p[0]);return term;
    }
    if(type==='DmgMulElement'){
      if(!elements[p[1]] || !allDefault(2))return reject('Unrecognized elemental multiplier layout.');
      term.kind=clean(effect.applyTiming)==='BreakDmgCalculation'?'elementBreakPercent':'elementDamagePercent';
      term.element=elements[p[1]];term.value=Number(p[0]);requireValue('element',term.element);return term;
    }
    if(type==='CriticalRateVariation'){
      if(![-1,0,1].includes(p[1]) || !attributes[p[2]] || !allDefault(8))return reject('Unrecognized critical-rate layout.');
      if(Number(p[1])>=0)requireValue('broken',Number(p[1])!==0);
      if(Number(p[2])>0)requireValue('skill.attr',attributes[p[2]]);
      const skills=p.slice(3,6).filter(n=>Number(n)>=0);
      if(skills.length)term.skillIds=skills;
      if(Number(p[6])>=0)requireValue('commandId',Number(p[6]));
      if(Number(p[7])>=0)requireValue('hpPercent',Number(p[7]),'min');
      term.kind='critRatePercent';term.value=Number(p[0]);return term;
    }
    if(type==='CritMul'){
      if(Number(p[1])!==0 || !allDefault(2))return reject('Unrecognized critical-damage layout.');
      term.kind='critDamagePercent';term.value=Number(p[0]);return term;
    }
    if(type==='BreakDamageVariation'){
      if(![-1,0,1].includes(p[1]) || !attributes[p[3]] || ![0,1,2].includes(p[7]) || ![-1,0].includes(p[8]) || Number(p[10])!==-1)return reject('Unmodeled break multiplier filter.');
      if(Number(p[1])===1)requireValue('weakness',true);
      if(Number(p[2])>=0)requireValue('targetStatusIds',null,'nonempty');
      if(Number(p[3])>0)requireValue('skill.attr',attributes[p[3]]);
      if(Number(p[4])>=0)requireValue('stolenFromTarget',Number(p[4])!==0);
      if(Number(p[5])>=0)requireValue('extraPhase',Number(p[5])!==0);
      if(Number(p[6])>0)requireValue('hpPercent',Number(p[6]),'min');
      if(Number(p[7])>0)requireValue('skill.dmgType',damageTypes[p[7]]);
      if(Number(p[9])>=0)requireValue('critical',Number(p[9])!==0);
      if(Number(p[11])>=0)requireValue('element','None');
      if(Number(p[12])>=0)requireValue('commandId',Number(p[12]));
      if(Number(p[13])>=0)requireValue('protectedOrShelled',Number(p[13])!==0);
      if(Number(p[14])>=0)return reject('Unmodeled trailing break multiplier filter.');
      term.kind='breakPercent';term.value=Number(p[0]);return term;
    }
    if(type==='AddElementWhenNoneElement' || type==='AddElement'){
      if(!elements[p[0]] || (type==='AddElementWhenNoneElement' && !allDefault(1)))return reject('Unrecognized imbue layout.');
      if(type==='AddElement' && !allDefault(2))return reject('Unrecognized forced imbue layout.');
      if(type==='AddElement' && Number(p[1])>=0)requireValue('skill.id',Number(p[1]));
      term.kind='imbue';term.element=elements[p[0]];term.whenNoneOnly=type==='AddElementWhenNoneElement';return term;
    }
    if(type==='AddElementResistance'){
      if(!elements[p[0]] || !resistances[p[1]] || !allDefault(2))return reject('Unrecognized elemental resistance layout.');
      term.kind='resistance';term.element=elements[p[0]];term.resistance=resistances[p[1]];return term;
    }
    if(type==='AddStatusConditionRegist'){
      if(Number(p[0])<0 || !allDefault(2))return reject('Unrecognized status resistance layout.');
      term.kind='statusResistance';term.statusId=Number(p[0]);term.value=Number(p[1]);return term;
    }
    if(type==='Deffence'){
      if(![1,2].includes(p[0]) || !p.slice(2,4).every(n=>Number(n)===0) || !allDefault(4))return reject('Unmodeled defensive condition.');
      term.kind=p[0]===1?'physicalReductionPercent':'magicReductionPercent';term.value=Number(p[1]);return term;
    }
    if(type==='Avoidance'){
      if(![1,2].includes(p[1]) || !allDefault(2))return reject('Unrecognized evasion layout.');
      term.kind=p[1]===1?'physicalEvasionPercent':'magicEvasionPercent';term.value=Number(p[0]);return term;
    }
    if(type==='DamageLimitBreak')return {...term,kind:'damageCapRaised',value:true};
    if(type==='DominantPower'){
      if(!Number.isInteger(Number(p[0])) || Number(p[0])<-1 || !allDefault(1))return reject('Unrecognized higher-attack condition.');
      if(Number(p[0])>=0)requireValue('commandId',Number(p[0]));
      return {...term,kind:'dominantPower',value:true};
    }
    if(type==='DominantDefence'){
      if(!allDefault(0))return reject('Unrecognized higher-defense condition.');
      return {...term,kind:'dominantDefence',value:true};
    }
    // Limit Burst / finisher / summon power: native vtable+0x5A8 adds trunc(level) * 100/p0 to the coefficient scale (base 1).
    if(type==='MulBaseSkillByLevel'){
      if(!(Number(p[0])>0) || !allDefault(1))return reject('Unrecognized level-scaled power layout.');
      term.kind='coefficientPerLevel';term.value=100/Number(p[0]);return term;
    }
    // Decimating Attacks: +p0% per target, when attacking all enemies. Tip-Top Shape: +p0% per buff on the user.
    if(type==='DmgMulTargetlNum' || type==='DmgMulBuffNum'){
      if(!allDefault(1))return reject('Unrecognized count-scaled damage layout.');
      term.kind=type==='DmgMulTargetlNum'?'damagePerTarget':'damagePerBuff';term.value=Number(p[0]);return term;
    }
    if(utilityTypes.has(type))return {...term,kind:'utility',value:0};
    return reject(`Effect type ${type} is not modeled.`);
  }
  function analyze(catalog,passiveIds,providedContext={}){
    let indexes=catalogCache.get(catalog);
    if(!indexes){indexes={byPassive:new Map((catalog.passives||[]).map(p=>[p.id,p])),byEffect:new Map((catalog.effects||[]).map(e=>[e.id,e]))};catalogCache.set(catalog,indexes);}
    const context={...providedContext},{byPassive,byEffect}=indexes;
    const modifiers={statFlat:{},statPercent:{},damagePercent:0,elementDamagePercent:0,elementBreakPercent:0,breakPercent:0,critRatePercent:0,critDamagePercent:0,resistances:{},statusResists:{},imbues:[],physicalReductionPercent:0,magicReductionPercent:0,physicalEvasionPercent:0,magicEvasionPercent:0,damageCapRaised:false,dominantPower:false,dominantDefence:false,coefficientPerLevel:0};
    const result={modifiers,terms:[],applied:[],deferred:[],inactive:[],unsupported:[],coverage:{passives:0,effects:0,applied:0,deferred:0,unsupported:0},damageStackingVerified:true,identicalEffectStackingVerified:false,evidence};
    const candidates=[],seenEffects=new Set();
    for(const id of passiveIds || []){
      const passive=byPassive.get(Number(id));result.coverage.passives++;
      if(!passive){result.unsupported.push({passiveId:id,reason:'Unknown passive ID.'});continue;}
      if(!Array.isArray(passive.effectBundles)){result.unsupported.push({passiveId:id,name:passive.name,reason:'Native passive bundle timing is missing.'});continue;}
      for(const bundle of passive.effectBundles.filter(b=>Number(b.effectId)>0)){
        result.coverage.effects++;
        const effect=byEffect.get(Number(bundle.effectId)),record={passiveId:passive.id,passiveName:passive.name,effectId:Number(bundle.effectId),timing:clean(bundle.passiveSkillAddTiming)};
        if(!effect){result.unsupported.push({...record,reason:'Unknown effect ID.'});continue;}
        record.type=clean(effect.type);
        if(clean(bundle.TargetType)!=='Self' || clean(bundle.targetRelation)!=='Friendlies'){result.deferred.push({...record,reason:`Non-self effect (${bundle.TargetType}, ${bundle.targetRelation}) needs recipient/event simulation.`});continue;}
        const timing=record.timing;
        const events=providedContext.eventTimings || [];
        if(!['SpawnUnit','BeginDmgCalc'].includes(timing) && !events.includes(timing)){result.deferred.push({...record,reason:`Requires passive event ${timing}.`});continue;}
        let blocked=false;
        for(const gate of [bundle.conditionData,effect.condition]){
          const evaluated=condition(gate,context);
          if(evaluated.state==='unknown'){result.deferred.push({...record,reason:evaluated.reason});blocked=true;break;}
          if(evaluated.state==='no'){result.inactive.push({...record,reason:'Activation condition does not match.'});blocked=true;break;}
        }
        if(blocked)continue;
        if(Number(effect.prob??100)!==100 || Number(effect.activationProbability??100)!==100){result.deferred.push({...record,reason:'Random activation requires a stochastic/event model.',probability:effect.prob,activationProbability:effect.activationProbability});continue;}
        if(seenEffects.has(effect.id)){result.deferred.push({...record,reason:'Duplicate native effect: identical-effect stacking has not been verified.'});continue;}
        seenEffects.add(effect.id);
        let term=effectCache.get(effect);
        if(!term){term=decode(effect);effectCache.set(effect,term);}
        if(term.unsupported){result.unsupported.push({...record,reason:term.unsupported});continue;}
        candidates.push({...term,...record});
      }
    }
    // The caller supplies only already-applied effects on this subject; action/recipient legality stays in the battle planner.
    for(const id of providedContext.activeEffectIds || []){
      const effect=byEffect.get(Number(id)),record={effectId:Number(id),source:'activeEffect'};
      result.coverage.effects++;
      if(!effect){result.unsupported.push({...record,reason:'Unknown active effect ID.'});continue;}
      if(seenEffects.has(effect.id)){result.deferred.push({...record,reason:'Duplicate native effect: identical-effect stacking has not been verified.'});continue;}
      seenEffects.add(effect.id);
      const gate=condition(effect.condition,context);
      if(gate.state==='unknown'){result.deferred.push({...record,reason:gate.reason});continue;}
      if(gate.state==='no'){result.inactive.push(record);continue;}
      if(Number(effect.activationProbability??100)!==100){result.deferred.push({...record,reason:'Random activation requires a stochastic/event model.'});continue;}
      let term=effectCache.get(effect);
      if(!term){term=decode(effect);effectCache.set(effect,term);}
      if(term.unsupported){result.unsupported.push({...record,reason:term.unsupported});continue;}
      candidates.push({...term,...record});
    }
    // Resolve a single unambiguous imbue before evaluating element-specific damage terms.
    const originalElement=clean(context.element ?? context.skill?.element ?? 'None');
    const potential=[];
    for(const term of candidates.filter(t=>t.kind==='imbue')){
      const gate=filters(term,context);
      if(gate.state==='unknown'){result.deferred.push({...term,reason:gate.reason});continue;}
      if(gate.state==='no'){result.inactive.push(term);continue;}
      if(term.whenNoneOnly && originalElement!=='None'){result.inactive.push({...term,reason:'The skill already has an element.'});continue;}
      if(!term.whenNoneOnly && !['Fight','Ability','MagicSword'].includes(clean(context.skill?.attr))){result.deferred.push({...term,reason:'Forced imbue scope is limited to fight/ability/magic-sword actions.'});continue;}
      potential.push(term);
    }
    const uniqueElements=[...new Set(potential.map(t=>t.element))];
    if(uniqueElements.length>1){
      for(const term of potential)result.deferred.push({...term,reason:'Conflicting imbues; native precedence is not verified.'});
      context.element=originalElement;result.elementAmbiguous=true;
    }else{
      context.element=uniqueElements[0] || originalElement;
      for(const term of potential){modifiers.imbues.push({element:term.element,whenNoneOnly:term.whenNoneOnly,effectId:term.effectId});result.applied.push(term);result.terms.push(term);}
    }
    modifiers.element=context.element;
    for(const term of candidates.filter(t=>t.kind!=='imbue')){
      if(term.skillIds && (!context.skill || !term.skillIds.includes(Number(context.skill.id)))){
        if(!context.skill)result.deferred.push({...term,reason:'Requires skill ID context.'});else result.inactive.push(term);
        continue;
      }
      const gate=filters(term,context);
      if(gate.state==='unknown'){result.deferred.push({...term,reason:gate.reason});continue;}
      if(gate.state==='no'){result.inactive.push(term);continue;}
      if(term.kind==='damagePerTarget' || term.kind==='damagePerBuff'){
        if(term.kind==='damagePerTarget' && !['Group','All'].includes(clean(context.skill?.target))){result.inactive.push({...term,reason:'Only when attacking all enemies.'});continue;}
        const count=context[term.kind==='damagePerTarget'?'targetCount':'buffCount'];
        if(!known(count)){result.deferred.push({...term,reason:`Requires ${term.kind==='damagePerTarget'?'targetCount':'buffCount'}.`});continue;}
        modifiers.damagePercent+=term.value*Number(count);result.applied.push({...term,value:term.value*Number(count)});result.terms.push(term);continue;
      }
      if(term.kind==='statFlat' || term.kind==='statPercent')add(modifiers[term.kind],term.parameter,term.value);
      else if(term.kind==='resistance'){
        const old=modifiers.resistances[term.element] || 'None';
        if(!known(resistancePriority[term.resistance])){result.unsupported.push({...term,reason:'Resistance priority is not defined in current battle rules.'});continue;}
        if(resistancePriority[term.resistance]>resistancePriority[old])modifiers.resistances[term.element]=term.resistance;
      }else if(term.kind==='statusResistance')add(modifiers.statusResists,term.statusId,term.value);
      else if(['damageCapRaised','dominantPower','dominantDefence'].includes(term.kind))modifiers[term.kind]=true;
      else if(term.kind!=='utility')modifiers[term.kind]+=term.value;
      result.applied.push(term);result.terms.push(term);
    }
    result.coverage.applied=result.applied.length;result.coverage.deferred=result.deferred.length;result.coverage.unsupported=result.unsupported.length;
    result.complete=result.deferred.length===0 && result.unsupported.length===0 && !result.elementAmbiguous;
    result.damageFactor=Math.max(0,1+(modifiers.damagePercent+modifiers.elementDamagePercent)/100);
    result.breakFactor=Math.max(0,1+(modifiers.breakPercent+modifiers.elementBreakPercent)/100);
    return result;
  }
  function supportActions(catalog,skillIds){
    const bySkill=new Map((catalog.skills||[]).map(s=>[s.id,s])),byEffect=new Map((catalog.effects||[]).map(e=>[e.id,e]));
    const result={buffs:[],debuffs:[],multiActions:[],unsupported:[]};
    for(const id of skillIds || []){
      const skill=bySkill.get(Number(id));
      if(!skill)continue;
      if([400650,400730].includes(skill.id))result.multiActions.push({skillId:skill.id,name:skill.name,actionCount:2,mpCost:Number(skill.cost),equipCost:Number(skill.equipCost),scope:skill.id===400730?'blackWhiteMagic':'selectedActions',evidence:'Native localized description; special command handling is outside the effect table.',nativeSpecialHandling:true,verifiedRestrictions:false});
      for(const bundle of (skill.effectBundles || []).filter(b=>Number(b.effectId)>0)){
        const effect=byEffect.get(Number(bundle.effectId));
        if(!effect)continue;
        const term=decode(effect);
        if(term.unsupported || !['statFlat','statPercent','damagePercent','physicalReductionPercent','magicReductionPercent'].includes(term.kind))continue;
        const record={skillId:skill.id,name:skill.name,mpCost:Number(skill.cost),effectId:effect.id,kind:term.kind,value:term.value,parameter:term.parameter,tests:term.tests,duration:effect.duration,status:effect.status,rootRelation:skill.relation,rootTarget:skill.target,bundleTarget:bundle.TargetType,addTiming:bundle.activeSkillAddTiming,probability:effect.prob,activationProbability:effect.activationProbability};
        if(clean(bundle.conditionData?.Condition || 'None')!=='None' || clean(effect.condition?.Condition || 'None')!=='None'){
          result.unsupported.push({...record,reason:'Conditional support action requires event context.'});continue;
        }
        if(skill.relation==='Enemies')result.debuffs.push(record);else result.buffs.push(record);
      }
    }
    return result;
  }
  function skillEligibility(skill,context={},rules={}){
    const result={eligible:true,reasons:[],deferred:[],nativeRulesUsed:[],additionalCosts:[],resourceChecks:[]};
    if(!skill){result.eligible=false;result.reasons.push('Missing skill.');return result;}
    const id=Number(skill.id),general=rules.general || {},validated=(context.validatedUsableSkillIds || []).includes(id);
    const deny=message=>result.reasons.push(message),defer=message=>result.deferred.push(message);
    if(clean(skill.availableLocation)==='MapOnly')deny('Native skill is map-only.');
    if(clean(skill.attr)==='ChaseAttack' && !context.reaction)deny('Follow-up action is not a normal selectable action.');
    if(context.triggered && (general.untriggerableSkills || []).includes(id))deny('Native untriggerable skill.');
    if(context.repeated && (general.nonRepeatSkillsIds || []).includes(id))deny('Native non-repeatable skill.');
    const hierarchy=context.hierarchySkills || (context.selectorId?[Number(context.selectorId)]:[]);
    for(const rule of general.usableData || []){
      if(!(rule.lockSkills || []).includes(id))continue;
      const type=clean(rule.lockType);result.nativeRulesUsed.push({lockType:type,flagId:rule.FlagID,hierarchySkills:rule.hierarchySkills || []});
      if(type==='FoundSkillInHierarchy'){
        if((rule.hierarchySkills || []).some(parent=>hierarchy.includes(parent)))deny('Native hierarchy rule forbids this action inside the selected wrapper.');
      }else if(type==='DemonForm' || type==='NormalForm'){
        if(!known(context.demonForm)){if(!validated)defer('Native form lock requires demon/normal-form context.');}
        else if(type==='DemonForm'?context.demonForm:!context.demonForm)deny(`Native ${type} lock is active.`);
      }else if(type==='ExPhase'){
        if(!known(context.extraPhase)){if(!validated)defer('Native ExPhase lock requires phase context.');}
        else if(context.extraPhase)deny('Native ExPhase lock forbids this action during extra phase.');
      }else if(type==='AwakeningPower'){
        if(!known(context.awakeningPower)){if(!validated)defer('Native AwakeningPower lock requires buff context.');}
        else if(context.awakeningPower)deny('The Power Within cannot be reapplied while its native lock is active.');
      }else if(type==='HasEscaped'){
        if(!known(context.hasEscaped)){if(!validated)defer('Native HasEscaped lock requires escape-state context.');}
        else if(context.hasEscaped)deny('Native escape-state lock is active.');
      }else if(!validated){
        // Lock direction is bespoke; skill ownership or a flag alone is not proof of current usability.
        defer(`Native ${type} gate${Number(rule.FlagID)>=0?' #'+rule.FlagID:''} needs validated in-battle usability.`);
      }
    }
    const selector=Number(context.selectorId || 0),selectors=rules.selectors || {};
    if(selector===Number(selectors.dualcast?.skillId) && clean(skill.attr)!==clean(selectors.dualcast.requiredAttribute))deny('Dualcast accepts native Magic actions only.');
    if(selector===Number(selectors.doubleAction?.skillId) && clean(skill.attr)===clean(selectors.doubleAction.forbiddenAttribute))deny('Double Action excludes native Magic actions.');
    const attrRule=Object.values(rules.attributeDetail || {}).find(row=>clean(row.skillAttrType)===clean(skill.attr));
    if(attrRule){
      const blockedStatuses=(attrRule.unusableListInStatusCondition || []).map(clean);
      if((context.statusNames || []).map(clean).some(status=>blockedStatuses.includes(status)))deny('A native status condition prevents this skill attribute.');
      if(attrRule.isUnusableInCannotLimitBurst && context.cannotLimitBurst)deny('Native limit-burst prohibition is active.');
      if(clean(attrRule.costType)==='LB'){
        if(!known(context.lbPercent)){if(!validated)defer('Limit burst requires current LB gauge.');}
        else if(Number(context.lbPercent)<Number(skill.cost))deny('Insufficient native LB gauge.');
      }
    }
    for(const check of (general.costCheckData || []).filter(row=>Number(row.SkillId)===id)){
      result.resourceChecks.push(check);
      const amount=context.resources?.[clean(check.costType)];
      if(!known(amount) || Number(check.Cost)===0){if(!validated)defer(`Native ${clean(check.costType)} resource check requires validated state.`);}
      else if(Number(amount)<Number(check.Cost))deny(`Insufficient ${clean(check.costType)} for native cost check.`);
    }
    result.additionalCosts=(general.additionalCostData || []).filter(row=>Number(row.SkillId)===id);
    result.costOverride=(general.costOverrideData || []).find(row=>Number(row.SkillId)===id) || null;
    result.eligible=result.reasons.length===0 && result.deferred.length===0;
    return result;
  }
  const api={analyze,decode,supportActions,skillEligibility,condition,elements,parameters,attributes,damageTypes,resistances,evidence};
  if(typeof module!=='undefined')module.exports=api;else root.CompanionPassives=api;
})(typeof globalThis!=='undefined'?globalThis:this);

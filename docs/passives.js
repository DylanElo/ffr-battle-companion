(function(root){
  'use strict';
  // Hot in the optimizer: native enum strings repeat, so memoize.
  const cleaned=new Map(),clean=x=>{const s=String(x??'');let v=cleaned.get(s);if(v===undefined){v=s.split('::').pop();if(cleaned.size<50000)cleaned.set(s,v);}return v;};
  const elements=['None','Fire','Ice','Wind','Earth','Thunder','Water','Light','Dark'];
  const parameters=['None','HitPoint','MagicPoint','BreakPoint','LimitBurstPoint','Attack','Defence','Intelligence','Mind','Agility','Level','EquipCost','PhysicalAttack','PhysicalDefense','MagicalAttack','MagicalDefense','Divine','Role','SkillDamageType','AP'];
  const attributes=['None','Fight','ChaseAttack','Ability','Magic','LimitBurst','Item','Summon','Mechabo','FinishBlow','MixItem','Throw','ThrowMoney','Dualcast','Mimic','MagicSword','Escape'];
  const damageTypes=['None','Physic','Magic'];
  const resistances=['None','Weakness','Halved','Invalid','Absorb','Reflect'];
  const resistancePriority={None:0,Weakness:25,Halved:50,Invalid:75,Absorb:100};
  const f=Math.fround,EPS=f(2**-23);
  const instanceStackingTypes=new Set(['DamageMultiplier','DmgMulSkillNumUp','IgnoreAllMagicReduction','ResistMagVariation','ActRepeatProbUp']);
  const utilityTypes=new Set(['ExperienceUp','ExperienceUpCap','MoneyUp','MoneyUpCap','APUp','APUpCap','ItemDropUp','EncountRatio','Preemtive','StealRate','StealRareRate']);
  const catalogCache=new WeakMap(),effectCache=new WeakMap();
  const evidence={
    parameters:'Native eUnitParameterType / eUnitParameterVariationType; current DT_SkillEffectData ParamList.',
    additiveDamage:'Installed executable common multiplier helper 0x14523e3e0 sums DamageCalculation and target-break effect factors into one bucket, clamped >= 0; eligible DamageMultiplier instances are summed even when their effect IDs match.',
    critical:'Installed executable helper 0x145238c00 adds critical effect factors to the native critical base.',
    limits:'Unsupported timing, conditions, effect types, random activation and parameter layouts are excluded explicitly. Identical-effect stacking beyond DamageMultiplier instances from explicitly counted sources is not verified.'
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
      if(key==='targetCount' && (!Number.isInteger(actual) || actual<0))return {state:'unknown',reason:'Requires an actual integer target count.'};
      const passed=comparison==='min'?Number(actual)>=value:comparison==='nonempty'?actual.length>0:comparison==='exact'?actual===value:comparison==='oneOf'?value.includes(clean(actual)):clean(actual)===clean(value);
      if(!passed)return {state:'no'};
    }
    return {state:'yes'};
  }
  function decode(effect){
    const p=effect.params || [],type=clean(effect.type),term={effectId:effect.id,type,tests:[]};
    const requireValue=(key,value,comparison='equal')=>term.tests.push({key,value,comparison});
    const reject=reason=>({unsupported:reason});
    const allDefault=(start,allowed=-1)=>p.slice(start).every(n=>Number(n)===allowed);
    if(type==='ParameterVariation' && [1282,1283,1284].includes(Number(effect.id))){
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || Number(p[0])<0 || Number(p[1])!==2 || ![0,2].includes(Number(p[2])) || Number(p[3])!==-1 || Number(p[4])!==0 || !allDefault(5) || clean(effect.applyTiming)!=='ActionBegin' || clean(effect.proceedTiming)!=='ActionBegin' || Number(effect.duration)!==-1)return reject('Unrecognized action-begin MP recovery layout.');
      return {...term,kind:Number(p[2])===0?'mpRecoveryFlat':'mpRecoveryPercent',value:Number(p[0]),eventTiming:'ActionBegin'};
    }
    if(type==='ParameterContinuousVariation'){
      if(!parameters[p[1]] || ![0,1,2,3].includes(p[2]) || !p.slice(3,6).every(n=>Number(n)===0) || !allDefault(6))return reject('Unrecognized continuous parameter layout.');
      term.kind=[0,1].includes(p[2])?'statFlat':'statPercent';term.parameter=parameters[p[1]];term.value=Number(p[0])*([1,3].includes(p[2])?-1:1);return term;
    }
    if(type==='AllParamUp'){
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || Number(p[0])<0 || ![-1,1].includes(Number(p[1])) || !allDefault(2))return reject('Unrecognized primary-stat scale layout.');
      return {...term,kind:'primaryStatScale',value:Number(p[0]),requiresCompletedNormalCap:Number(p[1])===1};
    }
    if(type==='DamageMultiplier'){
      if(![0,1,2].includes(p[5]) || !attributes[p[3]] || ![-1,0].includes(p[8]) || Number(p[11])!==-1)return reject('Unmodeled damage multiplier filter.');
      if(Number(p[1])>0)requireValue('lbPercent',Number(p[1]),'min');
      if(Number(p[2])>=0)requireValue('commandId',Number(p[2]));
      if(Number(p[3])>0)requireValue('skill.attr',attributes[p[3]]);
      if(Number(p[4])>0){requireValue('analyzed',true,'exact');requireValue('weakness',true,'exact');}
      if(Number(p[5])>0)requireValue('skill.dmgType',damageTypes[p[5]]);
      if(Number(p[6])>0)requireValue('targetHasActiveBadStatus',true,'exact');
      if(Number(p[7])>=0)requireValue('extraPhase',Number(p[7])!==0);
      if(Number(p[9])>0)requireValue('hpPercent',Number(p[9]),'min');
      if(Number(p[10])>=0)requireValue('critical',Number(p[10])!==0);
      if(Number(p[12])>=0)requireValue('notTargeted',Number(p[12])!==0);
      if(Number(p[13])>=0)requireValue('mpThresholdPercent',Number(p[13]),'min');
      if(Number(p[14])>=0)requireValue('skill.element','None');
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
    if(type==='IncExAddProb'){
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || !p.slice(1,4).every(id=>Number(id)===-1 || Number.isInteger(Number(id)) && Number(id)>0) || ![-1,1].includes(Number(p[4])) || !allDefault(5))return reject('Unverified bonus-phase probability layout.');
      if(Number(p[4])===1)requireValue('anyCritical',true,'exact');
      return {...term,kind:'bonusPhaseChancePercent',value:Number(p[0]),skillIds:p.slice(1,4).filter(id=>Number(id)>0).map(Number)};
    }
    if(type==='HitAndWay'){
      if(Number(p[0])!==35 || p.length!==15 || !allDefault(1))return reject('Unverified HitAndWay parameter layout.');
      requireValue('incomingType','Physic');requireValue('performedAttackThisRound',true,'exact');
      return {...term,kind:'incomingPhysicalNullifyChance',value:Number(p[0])};
    }
    if(type==='Crusher'){
      if(Number(p[0])!==50 || p.length!==15 || !allDefault(1))return reject('Unverified Crusher parameter layout.');
      requireValue('skill.target','Single');requireValue('skill.dmgType','Physic');
      return {...term,kind:'fullGaugeBreakPercent',value:Number(p[0])};
    }
    if(type==='BreakDamageVariation'){
      if(![-1,0,1].includes(p[1]) || !attributes[p[3]] || ![0,1,2].includes(p[7]) || ![-1,0].includes(p[8]) || Number(p[10])!==-1)return reject('Unmodeled break multiplier filter.');
      if(Number(p[1])===1)requireValue('weakness',true);
      if(Number(p[2])>0)requireValue('targetHasActiveBadStatus',true,'exact');
      if(Number(p[3])>0)requireValue('skill.attr',attributes[p[3]]);
      if(Number(p[4])>=0)requireValue('stolenFromTarget',Number(p[4])!==0);
      if(Number(p[5])>=0)requireValue('extraPhase',Number(p[5])!==0);
      if(Number(p[6])>0)requireValue('hpPercent',Number(p[6]),'min');
      if(Number(p[7])>0)requireValue('skill.dmgType',damageTypes[p[7]]);
      if(Number(p[9])>=0)requireValue('critical',Number(p[9])!==0);
      if(Number(p[11])>=0)requireValue('skill.element','None');
      if(Number(p[12])>=0)requireValue('commandId',Number(p[12]));
      if(Number(p[13])>=0)requireValue('protectedOrShelled',Number(p[13])!==0);
      if(![-1,0,1].includes(Number(p[14])))return reject('Unmodeled trailing break multiplier filter.');
      if(Number(p[14])>=0)term.actionFilter=Number(p[14]);
      term.kind='breakPercent';term.value=Number(p[0]);return term;
    }
    if(type==='AddElementWhenNoneElement' || type==='AddElement'){
      if(!elements[p[0]] || (type==='AddElementWhenNoneElement' && !allDefault(1)))return reject('Unrecognized imbue layout.');
      if(type==='AddElement' && !allDefault(2))return reject('Unrecognized forced imbue layout.');
      if(type==='AddElement' && Number(p[1])>=0)requireValue('skill.id',Number(p[1]));
      if(type==='AddElementWhenNoneElement'){requireValue('skill.element','None');requireValue('skill.parameterType','HitPoint');requireValue('skill.parameterVariationType',['Decrease','RatioDecrease'],'oneOf');requireValue('skill.dmgType','Physic');}
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
    if(type==='AccuracyVariation'){
      if(!Number.isInteger(Number(p[0])) || !allDefault(1))return reject('Unverified accuracy modifier layout.');
      return {...term,kind:'accuracyBonus',value:Number(p[0])};
    }
    if(type==='CritOrMiss'){
      if(Number(p[0])!==50 || Number(p[1])!==1 || Number(p[2])!==10 || !allDefault(3))return reject('Unverified critical-or-miss layout.');
      return {...term,kind:'gambleShot',value:true};
    }
    if(type==='GoodLuck' || type==='AddSkillBaseMagGoodLuck' || type==='DmgMulGoodLuckNum'){
      if(!Number.isFinite(Number(p[0])) || !allDefault(1))return reject('Unrecognized luck-scaled modifier layout.');
      return {...term,kind:type==='GoodLuck'?'critRatePerLuck':type==='AddSkillBaseMagGoodLuck'?'coefficientPerLuck':'breakPerLuck',value:Number(p[0])};
    }
    if(type==='AddSkillBaseMag'){
      if(!Number.isFinite(Number(p[0])) || ![-1,1].includes(Number(p[1])) || !allDefault(2))return reject('Unrecognized additive coefficient layout.');
      if(Number(p[1])!==-1)requireValue('critical',true);
      return {...term,kind:'coefficientAdd',value:Number(p[0])};
    }
    if(type==='MulBaseSkillBySkill' || type==='MulBaseBreakBySkill'){
      if(!Number.isFinite(Number(p[0])) || !p.slice(1).every(id=>Number(id)===-1 || Number.isInteger(Number(id)) && Number(id)>0))return reject('Unrecognized skill-specific coefficient scale layout.');
      return {...term,kind:type==='MulBaseSkillBySkill'?'coefficientScalePercent':'baseBreakScalePercent',value:Number(p[0]),skillIds:p.slice(1).filter(id=>Number(id)>0).map(Number)};
    }
    // Limit Burst / finisher / summon power: native vtable+0x5A8 adds trunc(level) * 100/p0 to the coefficient scale (base 1).
    if(type==='MulBaseSkillByLevel'){
      if(!(Number(p[0])>0) || !allDefault(1))return reject('Unrecognized level-scaled power layout.');
      term.kind='coefficientPerLevel';term.value=100/Number(p[0]);return term;
    }
    if(type==='DmgMulAllToSingle'){
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || Number(p[0])<0 || !allDefault(1))return reject('Unrecognized all-to-single damage layout.');
      requireValue('skill.target',['Group','All'],'oneOf');requireValue('targetCount',1,'exact');
      return {...term,kind:'damagePercent',value:Number(p[0])};
    }
    if(type==='HoningSense'){
      if(p.length!==15 || !Number.isFinite(p[0]) || p[0]<0 || !Number.isFinite(p[1]) || !allDefault(2))return reject('Unrecognized Honing Sense layout.');
      return {...term,kind:'honingSense',value:p[0],criticalThreshold:p[1]};
    }
    if(type==='ActRepeatProbUp'){
      if(effect.id!==54221 || p.length!==15 || ![50,1,16,18,12].every((value,index)=>p[index]===value) || !allDefault(5) || clean(effect.applyTiming)!=='None')return reject('Unverified target-status repeat-chance layout.');
      return {...term,kind:'automaticRepeatChanceBonus',value:p[0],statusIds:p.slice(2,5)};
    }
    if(type==='RepeatAction'){
      if(effect.id===54220){
        if(p.length!==15 || ![1,0,1,1,1,1,25,202,1,1,200].every((value,index)=>p[index]===value) || !allDefault(11))return reject('Unverified conditional automatic-repeat layout.');
        requireValue('queuedCommandId',202,'exact');requireValue('skill.parameterType','HitPoint');requireValue('skill.parameterVariationType',['Decrease','RatioDecrease'],'oneOf');
        return {...term,kind:'automaticRepeat',value:1,priority:200,chance:25,requiredQueuedCommandId:202,excludedHierarchySkillIds:[400710,400650,400330]};
      }
      if(effect.id!==54212 || p.length!==15 || p[0]!==1 || p[1]!==15 || !p.slice(2,6).every(id=>id===-1) || p[6]!==100 || p[7]!==-1 || p[8]!==1 || p[9]!==-1 || p[10]!==200 || !allDefault(11))return reject('Unverified automatic-repeat layout.');
      requireValue('skill.attr','MagicSword');return {...term,kind:'automaticRepeat',value:1,priority:p[10]};
    }
    if(type==='ResistMagVariation'){
      if(p.length!==15 || p[0]!==1 || !Number.isFinite(p[1]) || p[1]<0 || !allDefault(2))return reject('Unrecognized weakness-factor variation layout.');
      requireValue('weakness',true,'exact');
      return {...term,kind:'weaknessFactorAdd',value:f(f(f(p[1])*f(.01))-f(1-EPS))};
    }
    if(type==='DmgMulByRecoveryVal'){
      const timing=clean(effect.applyTiming);
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !Number.isInteger(p[1]) || p[1]<0 || !allDefault(2) || !['DamageCalculation','BreakDmgCalculation'].includes(timing))return reject('Unrecognized accumulated-recovery power layout.');
      return {...term,kind:'recoveryAccumulator',cap:p[0],recoveryScale:p[1],countKey:timing==='BreakDmgCalculation'?'recoveryBreakBonus':'recoveryDamageBonus',resultKind:timing==='BreakDmgCalculation'?'breakPercent':'damagePercent'};
    }
    if(type==='AddBaseBreakDmg'){
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !Number.isInteger(p[1]) || p[1]<-1 || ![-1,1].includes(p[2]) || !allDefault(3) || clean(effect.applyTiming)!=='None')return reject('Unrecognized additive base-stagger layout.');
      if(p[1]!==-1)requireValue('commandId',p[1],'exact');
      if(p[2]!==-1)requireValue('baseBreakSuppressed',false,'exact');
      return {...term,kind:'baseBreakAdd',value:p[0]};
    }
    if(type==='BreakDmgByProtect'){
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !Number.isInteger(p[1]) || p[1]<-1 || !allDefault(2) || clean(effect.applyTiming)!=='BreakDmgCalculation')return reject('Unrecognized protected-ally stagger layout.');
      if(p[1]!==-1)requireValue('commandId',p[1],'exact');
      return {...term,kind:'nativeCountBonus',value:p[0],countKey:'sameSideProtectCount',capCount:null,resultKind:'breakPercent'};
    }
    if(type==='BreakDmgMulStealNum'){
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !allDefault(1) || clean(effect.applyTiming)!=='DamageCalculation')return reject('Unrecognized accumulated-steal damage layout.');
      return {...term,kind:'stealCountBonus',cap:p[0]};
    }
    if(type==='DmgMulNTNum' || type==='DmgMulCmdNum' || type==='DmgMulHitCnt'){
      const timing=clean(effect.applyTiming),normal=type==='DmgMulNTNum';
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || normal && (!Number.isInteger(p[1]) || p[1]<0) || !allDefault(normal?2:1) || !(normal?['DamageCalculation','BreakDmgCalculation']:['DamageCalculation']).includes(timing))return reject('Unrecognized native completed-action or command-count layout.');
      return {...term,kind:'nativeCountBonus',value:p[0],countKey:normal?'completedNormalAttackCount':type==='DmgMulHitCnt'?'receivedAttackCountThisRound':'equippedCommandActiveCount',capCount:normal?p[1]:null,resultKind:timing==='BreakDmgCalculation'?'breakPercent':'damagePercent'};
    }
    if(type==='DmgMulByNT' || type==='MulBaseSkillByNlAtk'){
      const timing=clean(effect.applyTiming),coefficient=type==='MulBaseSkillByNlAtk';
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !allDefault(1) || !(coefficient?['None']:['DamageCalculation','BreakDmgCalculation']).includes(timing))return reject('Unrecognized normal-attack power layout.');
      return {...term,kind:'normalAttackBonus',value:p[0],resultKind:coefficient?'coefficientScalePercent':timing==='BreakDmgCalculation'?'breakPercent':'damagePercent'};
    }
    if(type==='DmgMulRetaliation'){
      if(effect.id!==12926 || p.length!==15 || ![40,447300,447310,440240].every((value,index)=>p[index]===value) || !allDefault(4) || clean(effect.applyTiming)!=='DamageCalculation')return reject('Unverified prior-attacker damage layout.');
      requireValue('targetPreviouslyAttackedSource',true,'exact');
      return {...term,kind:'damagePercent',value:f(f(f(p[0])*f(.01))+EPS)*100,skillIds:p.slice(1,4)};
    }
    if(type==='DmgMulSpecificSkill'){
      const timing=clean(effect.applyTiming),ids=p.slice(1,10);
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !ids.every(id=>id===-1 || Number.isInteger(id) && id>0) || !allDefault(10) || !['DamageCalculation','BreakDmgCalculation'].includes(timing))return reject('Unrecognized native specific-skill damage layout.');
      return {...term,kind:timing==='BreakDmgCalculation'?'breakPercent':'damagePercent',value:f(f(f(p[0])*f(.01))+EPS)*100,skillIds:ids.filter(id=>id>0)};
    }
    if(type==='DmgMulHitPoint'){
      if(p.length!==15 || !Number.isInteger(p[0]) || p[0]<0 || !Number.isInteger(p[1]) || p[1]<=0 || !attributes[p[2]] || ![-1,1].includes(p[3]) || !allDefault(4) || !['DamageCalculation','BreakDmgCalculation'].includes(clean(effect.applyTiming)))return reject('Unrecognized stepped HP damage layout.');
      if(p[2]>0)requireValue('skill.attr',attributes[p[2]]);
      return {...term,kind:'missingHpBonus',value:p[0],step:p[1],normalOnly:p[3]!==-1,resultKind:clean(effect.applyTiming)==='BreakDmgCalculation'?'breakPercent':'damagePercent'};
    }
    if(type==='DmgMulStatusConditionNum'){
      if(p.length!==15 || !Number.isFinite(p[0]) || p[0]<0 || !Number.isFinite(p[1]) || p[1]<0 || !allDefault(2) || clean(effect.applyTiming)!=='DamageCalculation')return reject('Unrecognized bad-status instance damage layout.');
      return {...term,kind:'badStatusBonus',value:p[0],cap:p[1]};
    }
    if(type==='DmgMulSkillNumUp'){
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || Number(p[0])<0 || !allDefault(1))return reject('Unrecognized skill-history scale layout.');
      return {...term,kind:'skillHistoryMultiplier',value:Number(p[0])};
    }
    if(type==='IgnoreAllMagicReduction'){
      if(p.length!==15 || !allDefault(0))return reject('Unrecognized area-reduction bypass layout.');
      return {...term,kind:'ignoreAreaReduction',value:true};
    }
    if(type==='DmgMulSkillNum'){
      const timing=clean(effect.applyTiming);
      if(p.length!==15 || !Number.isFinite(Number(p[0])) || Number(p[0])<0 || !Number.isFinite(Number(p[1])) || Number(p[1])<0 || !Number.isInteger(Number(p[2])) || Number(p[2])<0 || Number(p[2])>128 || !allDefault(3) || !['DamageCalculation','DamageCalculationOnBreak','BreakDmgCalculation'].includes(timing))return reject('Unrecognized skill-history multiplier layout.');
      if(timing==='DamageCalculationOnBreak')requireValue('broken',true);
      return {...term,kind:timing==='BreakDmgCalculation'?'breakPerSkill':'damagePerSkill',value:Number(p[0]),cap:Number(p[1]),historyTurns:Number(p[2])};
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
    context.mpThresholdPercent ??= context.mpPercent;
    if(Array.isArray(context.targetStatusIds) && context.targetStatusIds.length===0){context.targetBadStatusCount ??= 0;context.targetHasActiveBadStatus ??= false;}
    const modifiers={statFlat:{},statPercent:{},statScale:{},damagePercent:0,elementDamagePercent:0,elementBreakPercent:0,breakPercent:0,critRatePercent:0,critDamagePercent:0,resistances:{},statusResists:{},imbues:[],physicalReductionPercent:0,magicReductionPercent:0,physicalEvasionPercent:0,magicEvasionPercent:0,damageCapRaised:false,dominantPower:false,dominantDefence:false,coefficientPerLevel:0,coefficientAdd:0,coefficientScalePercent:0,baseBreakScalePercent:0,gambleShot:false,accuracyBonus:0};
    modifiers.incomingPhysicalNullifyChance=0;
    modifiers.bonusPhaseChancePercent=0;
    modifiers.skillHistoryMultiplier=1;modifiers.ignoreAreaReduction=false;
    modifiers.mpRecoveryFlat=0;modifiers.mpRecoveryPercent=0;modifiers.weaknessFactorAdd=0;modifiers.automaticRepeats=[];modifiers.automaticRepeatChanceBonus=0;modifiers.baseBreakAdd=0;
    const result={modifiers,terms:[],applied:[],deferred:[],inactive:[],unsupported:[],coverage:{passives:0,effects:0,applied:0,deferred:0,unsupported:0},damageStackingVerified:true,identicalEffectStackingVerified:false,evidence};
    const candidates=[],seenEffects=new Set();
    // An occurrence list replaces semantic references; it never adds a second copy of the reference list.
    const occurrences=Array.isArray(providedContext.passiveIdOccurrences)?providedContext.passiveIdOccurrences:null;
    for(const id of occurrences || passiveIds || []){
      const passive=byPassive.get(Number(id));result.coverage.passives++;
      if(!passive){result.unsupported.push({passiveId:id,reason:'Unknown passive ID.'});continue;}
      if(!Array.isArray(passive.effectBundles)){result.unsupported.push({passiveId:id,name:passive.name,reason:'Native passive bundle timing is missing.'});continue;}
      for(const bundle of passive.effectBundles.filter(b=>Number(b.effectId)>0)){
        result.coverage.effects++;
        const effect=byEffect.get(Number(bundle.effectId)),record={passiveId:passive.id,passiveName:passive.name,effectId:Number(bundle.effectId),timing:clean(bundle.passiveSkillAddTiming)};
        if(!effect){result.unsupported.push({...record,reason:'Unknown effect ID.'});continue;}
        record.type=clean(effect.type);
        if(clean(bundle.TargetType)!=='Self' || clean(bundle.targetRelation)!=='Friendlies'){result.deferred.push({...record,reason:`Non-self effect (${bundle.TargetType}, ${bundle.targetRelation}) needs recipient/event simulation.`});continue;}
        if(record.timing==='SpawnUnit' && clean(effect.proceedTiming)==='BeginTurn' && Number(effect.duration)>0){
          const round=Number(context.round ?? context.turn ?? 1);
          if(!Number.isInteger(round) || round<1){result.deferred.push({...record,reason:'Requires an actual fresh-battle round for opening-effect expiry.'});continue;}
          if(round>Number(effect.duration)){result.inactive.push({...record,reason:'The opening effect has expired.'});continue;}
        }
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
        if(['CostVariation','IgnoreCostChange'].includes(record.type)){result.deferred.push({...record,reason:'Resource cost is evaluated separately for the selected command.'});continue;}
        if(Number(effect.prob??100)!==100 || Number(effect.activationProbability??100)!==100){result.deferred.push({...record,reason:'Random activation requires a stochastic/event model.',probability:effect.prob,activationProbability:effect.activationProbability});continue;}
        if(seenEffects.has(effect.id) && !(occurrences && instanceStackingTypes.has(record.type))){result.deferred.push({...record,reason:'Duplicate native effect: identical-effect stacking has not been verified.'});continue;}
        seenEffects.add(effect.id);
        let term=effectCache.get(effect);
        if(!term){term=decode(effect);effectCache.set(effect,term);}
        if(term.unsupported){result.unsupported.push({...record,reason:term.unsupported});continue;}
        candidates.push({...term,...record});
      }
    }
    // The caller supplies only already-applied effects on this subject; action/recipient legality stays in the battle planner.
    // Repeated DamageMultiplier IDs here represent distinct applied instances, not repeated semantic passive references.
    for(const id of providedContext.activeEffectIds || []){
      const effect=byEffect.get(Number(id)),record={effectId:Number(id),source:'activeEffect'};
      result.coverage.effects++;
      if(!effect){result.unsupported.push({...record,reason:'Unknown active effect ID.'});continue;}
      if(seenEffects.has(effect.id) && !instanceStackingTypes.has(clean(effect.type))){result.deferred.push({...record,reason:'Duplicate native effect: identical-effect stacking has not been verified.'});continue;}
      seenEffects.add(effect.id);
      const gate=condition(effect.condition,context);
      if(gate.state==='unknown'){result.deferred.push({...record,reason:gate.reason});continue;}
      if(gate.state==='no'){result.inactive.push(record);continue;}
      if(['CostVariation','IgnoreCostChange'].includes(clean(effect.type))){result.deferred.push({...record,type:clean(effect.type),reason:'Resource cost is evaluated separately for the selected command.'});continue;}
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
      if(term.whenNoneOnly && catalog.skillRules?.damageCalc?.[clean(context.skill?.calcType)]?.doCalcElement===false){result.inactive.push({...term,reason:'Native calculation rules disable element calculation.'});continue;}
      if(!term.whenNoneOnly && !['Fight','Ability','MagicSword'].includes(clean(context.skill?.attr))){result.deferred.push({...term,reason:'Forced imbue scope is limited to fight/ability/magic-sword actions.'});continue;}
      potential.push(term);
    }
    // Native forced elements suppress the separate when-None getter.
    const forced=potential.filter(term=>!term.whenNoneOnly);
    const resolved=forced.length?forced:potential;
    if(forced.length)for(const term of potential.filter(term=>term.whenNoneOnly))result.inactive.push({...term,reason:'A forced element takes precedence over a when-None imbue.'});
    const uniqueElements=[...new Set(resolved.map(t=>t.element))];
    if(uniqueElements.length>1){
      for(const term of resolved)result.deferred.push({...term,reason:'Conflicting imbues; native precedence is not verified.'});
      context.element=originalElement;result.elementAmbiguous=true;
    }else{
      context.element=uniqueElements[0] || originalElement;
      for(const term of resolved){modifiers.imbues.push({element:term.element,whenNoneOnly:term.whenNoneOnly,effectId:term.effectId});result.applied.push(term);result.terms.push(term);}
    }
    modifiers.element=context.element;
    // Native Skill Flow reads this product for both its value and cap, independent of effect-list order.
    for(const term of candidates.filter(t=>t.kind==='skillHistoryMultiplier')){
      modifiers.skillHistoryMultiplier=f(modifiers.skillHistoryMultiplier*f(f(f(term.value)*f(.01))+EPS));
      result.applied.push(term);result.terms.push(term);
    }
    let honingApplied=false;
    for(const term of candidates.filter(t=>!['imbue','skillHistoryMultiplier'].includes(t.kind))){
      if(term.eventTiming && !(Array.isArray(context.eventTimings) && context.eventTimings.some(t=>clean(t)===term.eventTiming))){
        result.deferred.push({...term,reason:`Requires passive event ${term.eventTiming}.`});continue;
      }
      if(term.skillIds && (!context.skill || !term.skillIds.includes(Number(context.skill.id)))){
        if(!context.skill)result.deferred.push({...term,reason:'Requires skill ID context.'});else result.inactive.push(term);
        continue;
      }
      const gate=filters(term,context);
      if(gate.state==='unknown'){result.deferred.push({...term,reason:gate.reason});continue;}
      if(gate.state==='no'){result.inactive.push(term);continue;}
      if(term.kind==='honingSense'){
        const ids=catalog.skillRules?.general?.meikyoIds;
        if(!Array.isArray(ids) || !context.skill){result.deferred.push({...term,reason:'Requires the native Honing Sense skill-ID list and current skill.'});continue;}
        if(!ids.includes(Number(context.skill.id))){result.inactive.push(term);continue;}
        if(honingApplied){result.deferred.push({...term,reason:'Overlapping Honing Sense statuses do not receive an unverified additive bonus.'});continue;}
        honingApplied=true;const value=f(f(f(term.value)*f(.01))+EPS)*100;
        modifiers.damagePercent+=value;modifiers.critRatePercent+=term.criticalThreshold;
        result.applied.push(term);result.terms.push({...term,kind:'damagePercent',value},{...term,kind:'critRatePercent',value:term.criticalThreshold});continue;
      }
      if(term.kind==='automaticRepeatChanceBonus'){
        const ids=context.targetLiveStatusIds;
        if(!Array.isArray(ids) || !ids.every(id=>Number.isInteger(id) && id>=0 && id<=255)){result.deferred.push({...term,reason:'Requires qualified live repeat-target status IDs.'});continue;}
        if(!ids.some(id=>term.statusIds.includes(id))){result.inactive.push(term);continue;}
        modifiers.automaticRepeatChanceBonus+=term.value;result.applied.push(term);result.terms.push(term);continue;
      }
      if(term.kind==='automaticRepeat'){
        if(term.requiredQueuedCommandId!==undefined){
          const hierarchy=context.hierarchySkills,nonRepeat=catalog.skillRules?.general?.nonRepeatSkillsIds;
          if(!Array.isArray(hierarchy) || hierarchy.length>256 || !hierarchy.every(id=>Number.isInteger(id) && id>0)){result.deferred.push({...term,reason:'Requires explicit native queued-command wrapper ancestry.'});continue;}
          if(!Array.isArray(nonRepeat)){result.deferred.push({...term,reason:'Requires the native non-repeatable skill list.'});continue;}
          if(clean(context.skill?.attr)==='LimitBurst' || hierarchy.some(id=>term.excludedHierarchySkillIds.includes(id)) || nonRepeat.includes(Number(context.skill?.id))){result.inactive.push(term);continue;}
        }
        modifiers.automaticRepeats.push(term);result.applied.push(term);result.terms.push(term);continue;
      }
      if(term.actionFilter!==undefined){
        const parameter=context.skill?.parameterType,variation=context.skill?.parameterVariationType;
        if(!known(parameter) || !known(variation)){result.deferred.push({...term,reason:'Requires native action parameter and variation metadata.'});continue;}
        const variations=term.actionFilter===0?['Decrease','RatioDecrease']:['Increase','RatioIncrease'];
        if(clean(parameter)!=='HitPoint' || !variations.includes(clean(variation)) || term.actionFilter===0 && catalog.skillRules?.damageCalc?.[clean(context.skill?.calcType)]?.doCalcSkillEffect===false){result.inactive.push(term);continue;}
      }
      if(term.kind==='recoveryAccumulator'){
        const factor=context[term.countKey],cap=f(f(f(term.cap)*f(.01))+EPS);
        if(!Number.isFinite(factor) || factor<0 || factor>cap){result.deferred.push({...term,reason:`Requires the native accumulated ${term.countKey} factor.`});continue;}
        const value=f(factor)*100;
        modifiers[term.resultKind]+=value;const applied={...term,kind:term.resultKind,value};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='stealCountBonus'){
        const count=context.successfulSteals;
        if(!Number.isInteger(count) || count<0 || count>2147483647){result.deferred.push({...term,reason:'Requires the native saved successful-steal count.'});continue;}
        const value=Math.max(0,Math.min(f(f(f(count)*f(.001))+EPS),f(f(term.cap)*f(.01))))*100;
        modifiers.damagePercent+=value;const applied={...term,kind:'damagePercent',value,nativeCount:count};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='nativeCountBonus'){
        const count=context[term.countKey],product=term.value*count;
        if(!Number.isInteger(count) || count<0 || count>2147483647 || !Number.isSafeInteger(product) || product>2147483647 || term.capCount!==null && term.value*term.capCount>2147483647){result.deferred.push({...term,reason:`Requires a nonnegative native integer ${term.countKey}.`});continue;}
        const percent=value=>f(f(f(value)*f(.01))+EPS);
        const value=(term.capCount===null?percent(product):Math.max(0,Math.min(percent(product),percent(term.value*term.capCount))))*100;
        modifiers[term.resultKind]+=value;const applied={...term,kind:term.resultKind,value,nativeCount:count};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='normalAttackBonus'){
        const normal=Number(context.normalAttackSkillId),general=catalog.skillRules?.general?.normalAttackSkills;
        if(!(Number(context.skill?.id)===normal || Array.isArray(general) && general.includes(Number(context.skill?.id)))){
          if(!context.skill || !Number.isInteger(normal) || normal<=0)result.deferred.push({...term,reason:'Requires the native owner normal-attack ID or configured normal-attack skill list.'});else result.inactive.push(term);
          continue;
        }
        const value=f(f(f(term.value)*f(.01))+EPS)*100;
        modifiers[term.resultKind]+=value;const applied={...term,kind:term.resultKind,value};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='missingHpBonus'){
        if(term.normalOnly){
          const general=catalog.skillRules?.general?.normalAttackSkills;
          const normal=Number(context.normalAttackSkillId);
          if(!(Number(context.skill?.id)===normal || Array.isArray(general) && general.includes(Number(context.skill?.id)))){
            if(!Number.isInteger(normal) || normal<=0)result.deferred.push({...term,reason:'Requires the native owner normal-attack ID or configured normal-attack skill list.'});else result.inactive.push(term);
            continue;
          }
        }
        let ratio;
        if(known(context.currentHp) || known(context.maxHp)){
          if(Number.isFinite(context.currentHp) && context.currentHp>=0 && Number.isFinite(context.maxHp) && context.maxHp>0)ratio=f(f(context.currentHp)/f(context.maxHp));
        }else if(Number.isFinite(context.hpPercent) && context.hpPercent>=0)ratio=f(context.hpPercent/100);
        const lost=Math.trunc(f(f(100)-f(ratio*f(100)))),steps=Math.trunc(lost/term.step);
        const value=f(f(f(f(term.value)*f(.01))+EPS)*f(steps))*100;
        if(!Number.isFinite(ratio) || !Number.isFinite(value) || lost<-2147483648 || lost>2147483647){result.deferred.push({...term,reason:'Requires finite native-representable HP state and a positive maximum HP.'});continue;}
        modifiers[term.resultKind]+=value;
        const applied={...term,kind:term.resultKind,value,lostHpPercent:lost,steps};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='badStatusBonus'){
        const count=context.targetBadStatusCount;
        if(!Number.isInteger(count) || count<0){result.deferred.push({...term,reason:'Requires the verified count of eligible target bad-status effect instances.'});continue;}
        const value=Math.max(0,Math.min(f(f(term.cap)*f(.01)),f(f(f(term.value*count)*f(.01))+EPS)))*100;
        modifiers.damagePercent+=value;const applied={...term,kind:'damagePercent',value,badStatusInstances:count};result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='fullGaugeBreakPercent'){
        // Native 0x145114310 compares current raw LB points with owner+0x2A0 capacity.
        // Costs are paid by the caller before this getter; there is no skill-attribute exclusion.
        if(!Number.isFinite(context.lbPercent) || context.lbPercent<0 || !Number.isFinite(context.lbCapacity) || context.lbCapacity<=0){
          result.deferred.push({...term,reason:'Requires current raw LB gauge and actual positive LB capacity.'});continue;
        }
        if(context.lbPercent<context.lbCapacity){result.inactive.push(term);continue;}
        const applied={...term,kind:'breakPercent'};
        modifiers.breakPercent+=term.value;result.applied.push(applied);result.terms.push(applied);continue;
      }
      if(term.kind==='accuracyBonus' && Number(context.skill?.id)!==406060 && context.accuracyModeled!==true){
        result.deferred.push({...term,reason:'Accuracy changes require Gamble Shot or explicitly modeled native accuracy.'});continue;
      }
      if(term.kind==='gambleShot'){
        modifiers.gambleShot=true;result.applied.push(term);result.terms.push(term);continue;
      }
      if(['critRatePerLuck','coefficientPerLuck','breakPerLuck'].includes(term.kind)){
        if(!Number.isFinite(context.goodLuck) || context.goodLuck<0 || context.goodLuck>10){result.deferred.push({...term,reason:'Requires current native Good Luck level (0–10).'});continue;}
        const kind={critRatePerLuck:'critRatePercent',coefficientPerLuck:'coefficientAdd',breakPerLuck:'breakPercent'}[term.kind],value=term.value*context.goodLuck;
        modifiers[kind]+=value;result.applied.push({...term,kind,value});result.terms.push({...term,kind,value});continue;
      }
      if(term.kind==='primaryStatScale'){
        if(term.requiresCompletedNormalCap){
          const thresholds=candidates.filter(candidate=>candidate.type==='DmgMulNTNum').map(candidate=>candidate.capCount),count=context.completedNormalAttackCount;
          if(!thresholds.length){result.inactive.push({...term,reason:'Requires an actual completed-normal-attack modifier instance.'});continue;}
          if(!Number.isInteger(count) || count<0 || count>2147483647){result.deferred.push({...term,reason:'Requires the native completed-normal-attack count.'});continue;}
          if(!thresholds.some(threshold=>count>=threshold)){result.inactive.push({...term,reason:'The completed-normal-attack modifier has not reached its threshold.'});continue;}
        }
        for(const parameter of parameters.slice(5,10)){
          const expanded={...term,kind:'statScale',parameter};
          add(modifiers.statScale,parameter,term.value);result.terms.push(expanded);
        }
        result.applied.push(term);
        continue;
      }
      if(term.kind==='damagePerSkill' || term.kind==='breakPerSkill'){
        if(term.historyTurns===0){result.applied.push({...term,value:0,skillCount:0});result.terms.push({...term,value:0,skillCount:0});continue;}
        const validIds=ids=>Array.isArray(ids) && ids.length<=256 && ids.every(id=>Number.isInteger(id) && id>0);
        const history=context.skillHistory,current=context.currentSkillIds;
        if(!validIds(current) || !Array.isArray(history) || history.length>128 || !history.every(validIds)){
          result.deferred.push({...term,reason:'Requires complete current skill IDs and completed global-turn history.'});continue;
        }
        const previous=term.historyTurns?history.slice(-term.historyTurns):[];
        const skillCount=new Set([...current,...previous.flat()]).size;
        const scale=modifiers.skillHistoryMultiplier;
        const percent=value=>f(f(f(value)*f(.01))+EPS);
        const value=scale===1?Math.min(term.cap,skillCount*term.value):
          Math.max(0,Math.min(f(scale*percent(term.cap)),f(scale*percent(skillCount*term.value))))*100;
        modifiers[term.kind==='damagePerSkill'?'damagePercent':'breakPercent']+=value;
        result.applied.push({...term,value,skillCount});result.terms.push({...term,value,skillCount});continue;
      }
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
      else if(['damageCapRaised','dominantPower','dominantDefence','ignoreAreaReduction'].includes(term.kind))modifiers[term.kind]=true;
      else if(term.kind!=='utility')modifiers[term.kind]+=term.value;
      result.applied.push(term);result.terms.push(term);
    }
    result.coverage.applied=result.applied.length;result.coverage.deferred=result.deferred.length;result.coverage.unsupported=result.unsupported.length;
    result.complete=result.deferred.length===0 && result.unsupported.length===0 && !result.elementAmbiguous;
    // shortcut: preserve epsilon for verified Mundanity getters; extend after tracing other effect families.
    const nativeCorrection=effectId=>result.terms.filter(term=>term.effectId===effectId)
      .reduce((sum,term)=>sum+f(f(f(term.value)*f(.01))+EPS)-term.value/100,0);
    result.damageFactor=Math.max(0,1+(modifiers.damagePercent+modifiers.elementDamagePercent)/100+nativeCorrection(12944));
    result.breakFactor=Math.max(0,1+(modifiers.breakPercent+modifiers.elementBreakPercent)/100+nativeCorrection(15126));
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
      if(clean(check.costType)==='OverClock' && Number(check.Cost)===0){if(!known(amount)){if(!validated)defer('Native Overclock effect presence is required.');}else if(!(Number(amount)>0))deny('An active Overclock effect is required.');}
      else if(!known(amount) || Number(check.Cost)===0){if(!validated)defer(`Native ${clean(check.costType)} resource check requires validated state.`);}
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

/* Normal physical/magic damage recovered from the installed native executable.
   Evidence and limits: docs/damage-research.md. Pure math; no save/game writes. */
(function (root) {
  'use strict';
  const f = Math.fround;
  const EPS = f(2 ** -23);
  const nativePercent = percent => f(f(f(percent)*f(.01))+EPS);
  // Image 0x148959F34 is one float below .1; the lower bound remains float(.1).
  const BREAK_LEVEL_SCALE = 0.09999999403953552;
  const DEFAULT_RULES = Object.freeze({atkDefRandomMag:0.05,criticalDamageMagnification:150,
    breakDamageMagnification:150,exPhaseDamageMagnification:100,allDamageMagnification:40,
    maxEscapeDamageMul:3});
  const clean=x=>String(x??'').split('::').pop();
  function finite(name,value,min=-Infinity,max=Infinity) {
    if(!Number.isFinite(value) || value<min || value>max)throw new RangeError(`${name} must be finite in [${min}, ${max}].`);
    return value;
  }
  function ratioFactor(attack,defense) {
    finite('attack',attack,0);finite('defense',defense,0);
    const ratio=f(f(f(attack)/f(Math.max(defense,1)))+EPS);
    if(ratio<f(0.5))return f(f(ratio*f(0.5))+EPS);
    if(ratio<1)return f(ratio*ratio);
    const exp=f(Math.exp(f(1-ratio)));
    return f(f(f(8)/f(exp+1))-f(3));
  }
  function baseDamage({attack,defense,level,variance=1,difficultyGiven=1,difficultyTaken=1}) {
    finite('level',level,1);finite('variance',variance,0);finite('difficultyGiven',difficultyGiven,0);finite('difficultyTaken',difficultyTaken,0);
    const scaled=f(f(ratioFactor(attack,defense)*f(0.6))*f(level+2));
    const situation=f(f(f(variance)*f(difficultyGiven))*f(difficultyTaken));
    return f(scaled*situation);
  }
  function criticalProbability(rate) {
    finite('critical rate',rate);
    // Native roll is 1 + (rand() & 32767) * float(99 / 32767), compared <= rate.
    const step=f(99/32767);
    let lo=0,hi=32768;
    while(lo<hi){const mid=(lo+hi)>>>1;if(f(f(mid)*step+1)<=f(rate))lo=mid+1;else hi=mid;}
    return lo/32768;
  }
  function gambleSuccess(goodLuck,rng,accuracyBonus=0) {
    finite('Good Luck',goodLuck,0,10);finite('Gamble RNG',rng,0,32767);finite('accuracy bonus',accuracyBonus);
    if(!Number.isInteger(goodLuck) || !Number.isInteger(rng))throw new RangeError('Gamble luck and RNG must be native integers.');
    const roll=1+Math.min(99,Math.trunc(f(f(rng)*f(100/32767))));
    const threshold=f(f(50+f(accuracyBonus))+f(10*goodLuck));
    return roll<=threshold;
  }
  function gambleHitProbability(goodLuck,accuracyBonus=0) {
    let lo=0,hi=32768;
    while(lo<hi){const mid=(lo+hi)>>>1;if(gambleSuccess(goodLuck,mid,accuracyBonus))lo=mid+1;else hi=mid;}
    return lo/32768;
  }
  function skillHitSuccess(accuracy,rng,{accuracyBonus=0,evasion=0,maxEvasion=75,statusResistance=0}={}) {
    finite('accuracy',accuracy);finite('hit RNG',rng,0,32767);finite('accuracy bonus',accuracyBonus);
    finite('evasion',evasion);finite('maximum evasion',maxEvasion,0);finite('status resistance',statusResistance);
    if(!Number.isInteger(rng))throw new RangeError('Hit RNG must be a native integer.');
    const chance=Math.max(0,Math.min(100,accuracy+accuracyBonus-Math.min(maxEvasion,evasion)));
    const threshold=Math.trunc(f(f(chance)*f(f(f(100-statusResistance)*f(.01))+EPS)));
    const roll=1+Math.min(99,Math.trunc(f(f(rng)*f(100/32767))));
    return roll<=threshold;
  }
  function skillHitProbability(accuracy,options={}) {
    let lo=0,hi=32768;
    while(lo<hi){const mid=(lo+hi)>>>1;if(skillHitSuccess(accuracy,mid,options))lo=mid+1;else hi=mid;}
    return lo/32768;
  }
  function skillMpCost(cost,percentFactors=[]) {
    finite('MP cost',cost,0);
    let factor=1;
    for(const percent of percentFactors){finite('MP cost percentage',percent,0);factor=f(factor*nativePercent(percent));}
    return cost===0?0:Math.trunc(Math.max(1,f(f(cost)*factor)));
  }
  function skillHpCost(maxHp,percent) {
    finite('maximum HP',maxHp,1,0x7fffffff);finite('HP cost percentage',percent,0,100);
    if(!Number.isInteger(maxHp) || !Number.isInteger(percent) || maxHp*percent>0x7fffffff)throw new RangeError('HP cost inputs must be integers with a signed 32-bit product.');
    return Math.trunc(f(f(Math.imul(maxHp,percent))*f(.01)));
  }
  function canPayHpCost(currentHp,maxHp,percent) {
    skillHpCost(maxHp,percent);finite('current HP',currentHp,0);
    if(!Number.isInteger(currentHp))throw new RangeError('Current HP must be an integer.');
    // Native usability compares ratios, not the rounded integer payment; equality is allowed.
    return f(f(currentHp)/f(maxHp))>=f(f(percent)*f(.01));
  }
  function damageTakenLb(damage,preHp,maxHp,baseGain=50) {
    finite('received damage',damage,0,0x7fffffff);finite('pre-hit HP',preHp,0,0x7fffffff);
    finite('maximum HP',maxHp,1,0x7fffffff);finite('received-damage LB factor',baseGain,0);
    if(![damage,preHp,maxHp].every(Number.isInteger))throw new RangeError('Received damage and HP inputs must be integers.');
    return Math.trunc(f(f(f(Math.min(damage,preHp))/f(maxHp))*f(baseGain)));
  }
  function initiativeJitter(rng,amplitude){
    finite('initiative RNG',rng,0,32767);finite('initiative amplitude',amplitude,0);
    if(!Number.isInteger(rng) || !Number.isInteger(amplitude))throw new RangeError('Initiative RNG and amplitude must be integers.');
    return Math.min(2*amplitude,Math.trunc(f(f(f(rng)*f(1/32767))*f(2*amplitude+1))))-amplitude;
  }
  function initiativePriority({agility,denominator=1,randomRate=0,randomFlat=0,waitOffset=0}){
    finite('initiative Agility',agility,0);finite('initiative denominator',denominator,1);
    finite('initiative rate jitter',randomRate);finite('initiative flat jitter',randomFlat);finite('initiative offset',waitOffset);
    const speed=f(f(agility)/f(denominator)),rate=f(f(f(100)-f(randomRate))*f(.01));
    return Math.trunc(f(f(f(waitOffset)+f(rate*speed))-f(randomFlat)));
  }
  function damage(input) {
    const skill=input.skill || {};
    const calcType=clean(skill.calcType ?? skill.damageCalcType);
    if(!['Physic','Magic','EscapeNum','SameLevel','GoodLuck'].includes(calcType))return {supported:false,calcType,amount:null,min:null,max:null,reason:`Native calculation ${calcType || 'unknown'} is not implemented.`,warnings:['This action is excluded from numeric rankings.']};
    const mag=Number(skill.mag ?? skill.magnification);
    const elementFactor=input.elementFactor??1;
    finite('skill coefficient',mag,0);finite('element factor',elementFactor,-Infinity,Infinity);
    finite('outgoing factor',input.outgoingFactor??1,0);finite('coefficient scale',input.coefficientScale??1,0);
    finite('coefficient add',input.coefficientAdd??0);
    finite('critical bonus',input.criticalBonus??0);
    finite('hit ratio',input.hitRatio??1,0);
    finite('minimum damage',input.minimumDamage??1,0);finite('damage cap',input.damageCap??99999999,0);
    const rules={...DEFAULT_RULES,...input.rules};
    if(calcType==='SameLevel' && (!Number.isFinite(input.targetLevel) || input.targetLevel<1))return {supported:false,calcType,amount:null,min:null,max:null,reason:'SameLevel needs the actual target level.',warnings:['No equal-level bonus is assumed without a target level.']};
    const sameLevelScale=calcType==='SameLevel' && input.level===input.targetLevel?Number(input.rules?.sameLevelDamageCalcMagnification??2):1;
    const coefficient=f(f(f(mag)*f((input.coefficientScale??1)*sameLevelScale))+f(input.coefficientAdd??0));
    let special=1;
    if(calcType==='EscapeNum'){
      if(!Number.isInteger(input.successfulEscapes) || input.successfulEscapes<0)return {supported:false,calcType,amount:null,min:null,max:null,reason:'EscapeNum needs the recorded successful escape count.',warnings:['Escape count is required; no maximum multiplier is assumed.']};
      special=f(Math.min(f(1+f(input.successfulEscapes/128)),rules.maxEscapeDamageMul));
    }
    const multipliers={element:elementFactor,outgoing:input.outgoingFactor??1,
      critical:input.critical?f(nativePercent(rules.criticalDamageMagnification)+f(input.criticalBonus??0)):1,
      broken:input.broken?nativePercent(rules.breakDamageMagnification):1,
      exPhase:input.exPhase?nativePercent(rules.exPhaseDamageMagnification):1,
      allDamage:skill.isApplyAllMag && !input.ignoreAllDamagePenalty?nativePercent(rules.allDamageMagnification):1,
      hitRatio:input.hitRatio??1,special};
    function calculate(variance){
      const base=baseDamage({...input,variance});
      let raw=f(f(base*f(special))*coefficient);
      raw=f(raw*f(Math.abs(elementFactor)));
      raw=f(raw*f(multipliers.critical));
      raw=f(raw*f(multipliers.broken));
      raw=f(raw*f(multipliers.allDamage));
      raw=f(raw*f(multipliers.exPhase));
      raw=f(raw*f(multipliers.outgoing));
      raw=f(raw*f(multipliers.hitRatio));
      if(elementFactor!==0)raw=Math.max(raw,input.minimumDamage??1);
      const amount=Math.trunc(Math.min(raw,input.damageCap??99999999));
      return {base,raw,amount:elementFactor===0?0:amount};
    }
    const main=calculate(input.variance??1),variance=Number(rules.atkDefRandomMag);
    const low=calculate(1-variance),high=calculate(1+variance);
    return {supported:true,calcType,base:main.base,coefficient,multipliers,raw:main.raw,
      amount:main.amount,min:low.amount,max:high.amount,healsTarget:elementFactor<0,
      warnings:['Native formula verified statically; not calibrated against an observed battle damage trace.',
        'Caller must supply actual computed combat stats, legal skill availability, active passives, encounter scaling and battle-state factors.',
        'One damage event: do not multiply again by hit count; use native per-hit ratios and sum rounded events when available.']};
  }
  function breakDamage(input) {
    const skill=input.skill || {},rules={...DEFAULT_RULES,...input.rules};
    const value=Number(skill.breakDmg??skill.breakDamageValue);
    const level=Number(input.level),targetLevel=Number(input.targetLevel);
    finite('break damage',value,0);finite('attacker level',level,1);finite('target level',targetLevel,1);
    for(const key of ['percentFactor','outgoingFactor','targetFactor','hitRatio','elementFactor'])finite(key,input[key]??1,0);
    finite('flat bonus',input.flatBonus??0);finite('critical bonus',input.criticalBonus??0);
    const difference=Math.abs(level-targetLevel),power=f(Math.pow(f(difference),f(0.6)));
    let levelFactor=1;
    if(level>targetLevel)levelFactor=f(f(power*BREAK_LEVEL_SCALE)+f(1+EPS));
    else if(level<targetLevel)levelFactor=Math.max(f(0.1),f(f(1-f(power*BREAK_LEVEL_SCALE))+EPS));
    const allDamage=skill.isApplyAllMag && !input.ignoreAllDamagePenalty?nativePercent(rules.allDamageMagnification):1;
    const critical=input.critical?f(nativePercent(rules.criticalDamageMagnification)+f(input.criticalBonus??0)):1;
    let raw=f(f(f(value)*f(input.percentFactor??1))+f(input.flatBonus??0));
    raw=f(raw*f(allDamage));raw=f(raw*f(f(critical)*f(input.elementFactor??1)));
    raw=f(raw*f(input.outgoingFactor??1));raw=f(raw*f(input.targetFactor??1));
    raw=f(raw*f(input.hitRatio??1));raw=f(raw*f(levelFactor));
    return {supported:true,raw,amount:Math.max(0,Math.trunc(f(raw+f(0.5)))),levelFactor,
      multipliers:{critical,allDamage,element:input.elementFactor??1,percent:input.percentFactor??1,outgoing:input.outgoingFactor??1,target:input.targetFactor??1,hitRatio:input.hitRatio??1},
      warnings:['Native break formula verified statically, not calibrated against an observed battle trace.','Caller supplies break-specific element factors and effect buckets; HP-damage multipliers must not be substituted.']};
  }
  const api={DEFAULT_RULES,ratioFactor,baseDamage,criticalProbability,gambleSuccess,gambleHitProbability,skillHitSuccess,skillHitProbability,skillMpCost,skillHpCost,canPayHpCost,damageTakenLb,initiativeJitter,initiativePriority,damage,breakDamage};
  if(typeof module!=='undefined')module.exports=api;else root.NativeDamage=api;
})(typeof globalThis!=='undefined'?globalThis:this);

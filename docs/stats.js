(function(root){
  'use strict';
  // Hot in the optimizer: native enum strings repeat, so memoize.
  const cleaned=new Map(),clean=x=>{const s=String(x??'');let v=cleaned.get(s);if(v===undefined){v=s.split('::').pop();if(cleaned.size<50000)cleaned.set(s,v);}return v;};
  const f=Math.fround,EPS=f(2**-23);
  const parameterNames={1:'HitPoint',2:'MagicPoint',3:'BreakPoint',4:'LimitBurstPoint',5:'Attack',6:'Defence',7:'Intelligence',8:'Mind',9:'Agility',10:'Level',11:'EquipCost',12:'PhysicalAttack',13:'PhysicalDefense',14:'MagicalAttack',15:'MagicalDefense',16:'Divine'};
  const aliases={MaxHitPoint:'HitPoint',MaxMagicPoint:'MagicPoint',MaxBreakPoint:'BreakPoint',SkillEquipCost:'EquipCost'};
  const normalize=key=>aliases[key]||key;
  const positiveIds=values=>[...new Set((values||[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))];
  const catalogCache=new WeakMap(),snapshotCache=new WeakMap();
  function catalogIndex(catalog){
    if(!catalogCache.has(catalog))catalogCache.set(catalog,Object.fromEntries(['characters','visions','equipment','skills','passives','masterSkills'].map(key=>[key,new Map((catalog[key]||[]).map(row=>[Number(row.id),row]))])));
    return catalogCache.get(catalog);
  }
  function add(target,key,value){key=normalize(clean(key));target[key]=(target[key]||0)+(Number(value)||0);}
  function effectDelta(clampedBasis,term){
    if(term.kind==='statScale')return Math.trunc(f(f(f(clampedBasis)*f(f(f(Number(term.value))*f(.01))+EPS))-f(clampedBasis)));
    if(term.kind!=='statPercent')return Math.trunc(f(Number(term.value)));
    // Native handler 0x145145150 uses float epsilon before the final per-effect integer conversion.
    const ratio=f(f(Math.abs(Number(term.value)))*f(.01));
    const factor=Number(term.value)<0?f(EPS-ratio):f(ratio+EPS);
    return Math.trunc(f(f(clampedBasis)*factor));
  }
  function growth(catalog,native,experience){
    const table=catalog.statGrowth?.[native.levelParamId];
    if(!table)return {level:Number(native.nativeLevel)||1,stats:{},skillIds:[],warnings:['Native growth table is unavailable.']};
    let remaining=Number(experience),level=1;
    if(!Number.isFinite(remaining)||remaining<0)throw new Error('Saved experience is missing or invalid.');
    const stats={},skillIds=[];
    for(const row of table.rows){
      remaining-=Number(row.requiredExperience)||0;
      if(remaining<0)break;
      level=Number(row.level);
      for(const [key,value] of Object.entries(row.adds||{}))add(stats,key,value);
      skillIds.push(...(row.skillIds||[]));
    }
    return {level,stats,skillIds:positiveIds(skillIds),warnings:[]};
  }
  function permanentSync(catalog,snapshot,charId){
    const stats={},activeIds=[],passiveIds=[],masterIds=[],warnings=[];
    const visions=catalogIndex(catalog).visions;
    for(const owned of snapshot.resonances||[]){
      const vision=visions.get(Number(owned.id));
      if(!vision){warnings.push(`Unknown owned Resonance ${owned.id}; its sync grants are not modeled.`);continue;}
      const points=Number((owned.sync||[]).find(s=>Number(s.characterId)===Number(charId))?.points||0);
      for(const stage of vision.synchro||[]){
        if(points<Number(stage.requiredPoints??stage.masteryPoint))continue;
        for(const grant of stage.grants||[]){
          if(grant.type==='BaseParameter'){
            const name=parameterNames[Number(grant.id)];
            if(name)add(stats,name,grant.value);
            else warnings.push(`Unknown permanent sync parameter ${grant.id}.`);
          }else if(grant.type==='ActiveSkill')activeIds.push(grant.id);
          else if(grant.type==='PassiveSkill')passiveIds.push(grant.id);
          else if(grant.type==='MasterSkill')masterIds.push(grant.id);
        }
      }
    }
    return {stats,activeIds:positiveIds(activeIds),passiveIds:positiveIds(passiveIds),masterIds:positiveIds(masterIds),warnings};
  }
  function characterContext(catalog,snapshot,charId){
    // Imported snapshots and catalogs are immutable; a new import is a new cache key.
    let byCatalog=snapshotCache.get(snapshot);
    if(!byCatalog)snapshotCache.set(snapshot,byCatalog=new WeakMap());
    let byCharacter=byCatalog.get(catalog);
    if(!byCharacter)byCatalog.set(catalog,byCharacter=new Map());
    if(byCharacter.has(Number(charId)))return byCharacter.get(Number(charId));
    const saved=(snapshot.characters||[]).find(c=>Number(c.id)===Number(charId));
    const native=catalogIndex(catalog).characters.get(Number(charId));
    if(!saved||!native)throw new Error('Unknown saved character.');
    const gained=growth(catalog,native,saved.experience),sync=permanentSync(catalog,snapshot,charId),warnings=[...gained.warnings,...sync.warnings];
    const baseStats={},seedStats={};
    for(const [key,value] of Object.entries(native.stats||{}))add(baseStats,key,value);
    let seeds=saved.baseParameters;
    if(!Array.isArray(seeds)){
      seeds=Array.from({length:20},(_,i)=>Number(saved.rawFields?.[`baseParameterList[${i}]`]||0));
      warnings.push('Save lacks normalized base seed parameters; retained raw fields were used.');
    }
    for(let i=0;i<seeds.length;i++)if(parameterNames[i])add(seedStats,parameterNames[i],seeds[i]);
    const additive={};
    for(const source of [baseStats,gained.stats,seedStats,sync.stats])for(const [key,value] of Object.entries(source))add(additive,key,value);
    additive.EquipCost=(additive.EquipCost||0)+Number(native.baseSkillEquipCost??catalog.battleRules?.baseSkillEquipCost??100)+Number(native.nativeSkillEquipCost||0);
    const maxSkillSlots=Array.isArray(saved.equippedSkillIds)?saved.equippedSkillIds.length:Object.keys(saved.rawFields||{}).filter(key=>/^equipSkillList\[\d+\]$/.test(key)).length;
    if(!maxSkillSlots)warnings.push('Saved skill-slot count is missing; no skill loadout should be inferred.');
    const context={saved,native,gained,sync,baseStats,seedStats,additive,maxSkillSlots,warnings};
    byCharacter.set(Number(charId),context);
    return context;
  }
  // Stats depend only on the character, the equipped item ids and the effect terms. Callers reuse cached term arrays,
  // so results are shared by identity; returned objects must be treated as read-only.
  const statsCache=new WeakMap(),NO_TERMS=[];
  function characterStats(catalog,snapshot,charId,equipment,terms=NO_TERMS){
    const context=characterContext(catalog,snapshot,charId),gear=equipment||context.saved.equipment||{};
    let byTerms=statsCache.get(context);
    if(!byTerms)statsCache.set(context,byTerms=new WeakMap());
    const termKey=terms.length?terms:NO_TERMS;
    let byGear=byTerms.get(termKey);
    if(!byGear)byTerms.set(termKey,byGear=new Map());
    const key=[gear.weaponId,gear.armorId,...(gear.accessoryIds||[])].join(',');
    if(!byGear.has(key))byGear.set(key,computeStats(catalog,snapshot,charId,gear,terms));
    return byGear.get(key);
  }
  function computeStats(catalog,snapshot,charId,equipment,terms){
    const context=characterContext(catalog,snapshot,charId);
    const {saved,native,gained,sync,baseStats,seedStats,maxSkillSlots}=context;
    const warnings=[...context.warnings],equipmentStats={};
    const gear=equipment||saved.equipment||{};
    const items=catalogIndex(catalog).equipment;
    for(const id of [gear.weaponId,gear.armorId,...(gear.accessoryIds||[])]){
      if(!(Number(id)>0))continue;
      const item=items.get(Number(id));
      if(!item){warnings.push(`Unknown equipped item ${id}; its stats and effects are not modeled.`);continue;}
      for(const [key,value] of Object.entries(item.stats||{}))add(equipmentStats,key,value);
    }
    const additive={...context.additive};
    for(const [key,value] of Object.entries(equipmentStats))add(additive,key,value);
    const effects=terms.filter(t=>t.kind==='statFlat'||t.kind==='statPercent'||t.kind==='statScale');
    const effectsByParameter=new Map();
    for(const term of effects){const key=normalize(term.parameter);if(!effectsByParameter.has(key))effectsByParameter.set(key,[]);effectsByParameter.get(key).push(term);}
    const stats={},beforeEffects={},computing=new Set();
    const parent={PhysicalAttack:'Attack',PhysicalDefense:'Defence',MagicalAttack:'Intelligence',MagicalDefense:'Mind',Divine:'Mind'};
    function calculate(key){
      if(Object.hasOwn(stats,key))return stats[key];
      if(computing.has(key))throw new Error(`Recursive stat effect on ${key}.`);
      computing.add(key);
      let baseline=Number(additive[key]||0);
      if(parent[key])baseline+=calculate(parent[key]);
      const cap=key==='BreakPoint'?99999999:9999;
      const effectBasis=Math.max(0,Math.min(cap,baseline));
      beforeEffects[key]=effectBasis;
      let value=baseline;
      for(const term of effectsByParameter.get(key)||[])value+=effectDelta(effectBasis,term);
      stats[key]=Math.max(0,Math.min(cap,Math.trunc(value)));
      computing.delete(key);
      return stats[key];
    }
    for(const key of ['HitPoint','MagicPoint','BreakPoint','Attack','Defence','Intelligence','Mind','Agility','Divine','PhysicalAttack','PhysicalDefense','MagicalAttack','MagicalDefense','EquipCost'])calculate(key);
    stats.MaxHitPoint=stats.HitPoint;stats.MaxMagicPoint=stats.MagicPoint;stats.MaxBreakPoint=stats.BreakPoint;
    return {level:gained.level,stats,beforeEffects,baseStats,growthStats:gained.stats,seedStats,syncStats:sync.stats,equipmentStats,skillBudget:stats.EquipCost,maxSkillSlots,warnings:[...new Set(warnings)]};
  }
  function learned(catalog,snapshot,charId,visionId){
    const {saved,native,gained,sync,warnings:baseWarnings}=characterContext(catalog,snapshot,charId);
    const warnings=[...baseWarnings],{skills:skillIds,passives:passiveIds}=catalogIndex(catalog);
    const freeActiveIds=positiveIds(saved.activeSkillIds||[]),alwaysPassiveIds=positiveIds(native.passiveIds||[]);
    const learnedActiveIds=[...gained.skillIds.filter(id=>skillIds.has(id)),...sync.activeIds];
    const learnedPassiveIds=[...gained.skillIds.filter(id=>passiveIds.has(id)),...sync.passiveIds],masterSkillIds=[...sync.masterIds];
    for(const id of positiveIds(saved.equippedSkillIds||[])){
      if(skillIds.has(id))learnedActiveIds.push(id);
      else if(passiveIds.has(id))learnedPassiveIds.push(id);
      else if(catalogIndex(catalog).masterSkills.has(id))masterSkillIds.push(id);
      else warnings.push(`Unknown saved equipped skill ${id}.`);
    }
    const vision=catalogIndex(catalog).visions.get(Number(visionId));
    const own=(snapshot.resonances||[]).find(v=>Number(v.id)===Number(visionId));
    if(Number(visionId)>0 && !own)warnings.push('Requested Resonance is not owned.');
    if(vision&&own)for(const stage of vision.awakening||[]){
      if(Number(own.awakeningPoints||0)<Number(stage.requiredPoints??stage.masteryPoint))continue;
      for(const grant of stage.grants||[]){
        if(grant.type==='ActiveSkill')freeActiveIds.push(grant.id);
        else if(grant.type==='PassiveSkill')alwaysPassiveIds.push(grant.id);
      }
    }
    const base=characterStats(catalog,snapshot,charId,saved.equipment);
    return {freeActiveIds:positiveIds(freeActiveIds),learnedActiveIds:positiveIds(learnedActiveIds),alwaysPassiveIds:positiveIds(alwaysPassiveIds),learnedPassiveIds:positiveIds(learnedPassiveIds),masterSkillIds:positiveIds(masterSkillIds),skillBudget:base.skillBudget,maxSkillSlots:base.maxSkillSlots,warnings:[...new Set([...warnings,...base.warnings])]};
  }
  const api={parameterNames,normalize,effectDelta,growth,permanentSync,characterStats,learned};
  if(typeof module!=='undefined')module.exports=api;
  else root.CompanionStats=api;
})(typeof globalThis!=='undefined'?globalThis:this);

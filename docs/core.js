(function(root) {
  'use strict';
  // Hot in the optimizer: native enum strings repeat, so memoize.
  const cleaned=new Map(),clean=x=>{const s=String(x??'');let v=cleaned.get(s);if(v===undefined){v=s.split('::').pop();if(cleaned.size<50000)cleaned.set(s,v);}return v;};
  const joined = c => clean(c.joinStatus) === 'Join' && c.usable === true;
  const goals = {
    physical: {label:'Physical damage', weights:{PhysicalAttack:1}},
    magic: {label:'Magic damage', weights:{MagicalAttack:1}},
    divine: {label:'Divine stat', weights:{Divine:1}},
    support: {label:'MP / magic defense', weights:{MagicalDefense:1,MagicPoint:0.2}},
    physicalTank: {label:'Physical durability', weights:{PhysicalDefense:1,HitPoint:0.02}},
    magicTank: {label:'Magic durability', weights:{MagicalDefense:1,HitPoint:0.02}},
    speed: {label:'Speed', weights:{Agility:1}}
  };
  const statLabels = {PhysicalAttack:'ATK',MagicalAttack:'MAG',PhysicalDefense:'DEF',MagicalDefense:'MDEF',HitPoint:'HP',MagicPoint:'MP',MaxHitPoint:'HP',MaxMagicPoint:'MP',Attack:'STR',Defence:'STA',Intelligence:'INT',Mind:'SPI',Agility:'AGI',Divine:'Divine'};
  function stats(items) {
    const total = {};
    for (const item of items.filter(Boolean)) for (const [key,value] of Object.entries(item.stats || {})) total[key] = (total[key] || 0) + Number(value);
    return total;
  }
  function score(item, goal) {
    // goal is a preset key ('physical') or a custom {weights} object from priorityGoal.
    const weights = goal && typeof goal === 'object' ? goal.weights : (goals[goal] || goals.physical).weights;
    return Object.entries(weights).reduce((sum,[key,weight])=>sum+(Number(item?.stats?.[key])||0)*weight,0);
  }
  const priorityStats = ['PhysicalAttack','MagicalAttack','PhysicalDefense','MagicalDefense','HitPoint','Agility','Divine','MagicPoint'];
  // Combine several stats fairly: each is scaled by the best single bonus any equipment gives,
  // so "+60 ATK" and "+60 DEF" only tie when both are equally close to their own maximum.
  function priorityGoal(catalog, keys) {
    const weights = {};
    for (const key of keys) {
      const top = Math.max(1, ...(catalog.equipment || []).map(e => Number(e.stats?.[key]) || 0));
      weights[key] = 100 / top;
    }
    return {weights};
  }
  // What a character's usable skills (own + Resonance) actually scale on. Damage and healing both
  // read the user's own PhysicalAttack (Physic) or MagicalAttack (Magic), whoever grants the skill.
  // Heals only steer the attack stat for Healers; a Defender's spare Cure shouldn't make them a mage.
  function kitProfile(skills, nativeCharacter) {
    const roles = (nativeCharacter?.roles || []).map(clean), healer = roles.includes('Healer');
    const power = {Physic:0, Magic:0}, counts = {damage:0, heal:0};
    for (const s of skills || []) {
      const calc = clean(s.calcType), mag = Number(s.mag) || 0;
      if (!(calc in power) || mag <= 0 || clean(s.parameterType) !== 'HitPoint') continue;
      const dir = clean(s.parameterVariationType);
      if (s.relation === 'Enemies' && dir === 'Decrease') counts.damage++;
      else if (s.relation === 'Friendlies' && dir === 'Increase') { counts.heal++; if (!healer) continue; }
      else continue;
      power[calc] += mag * Math.max(1, Number(s.hits) || 1);
    }
    const total = power.Physic + power.Magic, base = nativeCharacter?.stats || {};
    const keys = [];
    if (total > 0) {
      if (power.Physic >= total * 0.3) keys.push('PhysicalAttack');
      if (power.Magic >= total * 0.3) keys.push('MagicalAttack');
    } else keys.push(Number(base.Intelligence) > Number(base.Attack) ? 'MagicalAttack' : 'PhysicalAttack');
    if (roles.includes('Defender')) keys.push('PhysicalDefense', 'MagicalDefense');
    if (healer) keys.push('MagicalDefense', 'HitPoint');
    return {keys:[...new Set(keys)], physicalShare: total ? power.Physic / total : null, damageSkills: counts.damage, healSkills: counts.heal, roles};
  }
  // How much a Resonance's unlocked skills add in the attack stats being geared for.
  // `skills` are only what the Resonance adds (the character's own abilities don't change).
  function resonanceFit(skills, keys, healer) {
    const wants = {Physic: keys.includes('PhysicalAttack'), Magic: keys.includes('MagicalAttack')};
    let fit = 0, attacks = 0;
    for (const s of skills || []) {
      const calc = clean(s.calcType), mag = Number(s.mag) || 0, dir = clean(s.parameterVariationType);
      if (!wants[calc] || mag <= 0 || clean(s.parameterType) !== 'HitPoint') continue;
      const attack = s.relation === 'Enemies' && dir === 'Decrease', heal = healer && s.relation === 'Friendlies' && dir === 'Increase';
      if (!attack && !heal) continue;
      if (attack) attacks++;
      fit += mag * Math.max(1, Number(s.hits) || 1);
    }
    return {fit, attacks};
  }
  function eligible(item, character, slot) {
    if (!item || !character) return false;
    const sex = clean(item.sexLimit);
    if (sex && sex !== 'None' && sex !== clean(character.sex)) return false;
    if (slot === 'weapon') return item.type === 'Weapon' && clean(item.detailType) === clean(character.weaponType);
    if (slot === 'armor') return item.type === 'Armor' && (character.armorTypes || []).map(clean).includes(clean(item.detailType));
    return slot === 'accessory' && item.type === 'Accessory';
  }
  function equipmentIds(equipment) { return [equipment?.weaponId,equipment?.armorId,...(equipment?.accessoryIds || [])].filter(id=>Number(id)>0); }
  function stock(snapshot, selectedId, plans={}, reserve=true) {
    const available = new Map((snapshot.inventory || []).map(item=>[Number(item.id),Number(item.quantity)]));
    for (const character of snapshot.characters || []) {
      if (Number(character.id) === Number(selectedId) || !joined(character)) continue;
      const plan = plans[character.id];
      if (!plan && !reserve) continue;
      for (const id of equipmentIds(plan || character.equipment)) available.set(id,Math.max(0,(available.get(id)||0)-1));
    }
    return available;
  }
  function candidates(catalog, character, available, slot, goal) {
    return (catalog.equipment || []).filter(item=>(available.get(item.id)||0)>0 && eligible(item,character,slot)).sort((a,b)=>score(b,goal)-score(a,goal)||a.name.localeCompare(b.name));
  }
  function recommend(catalog,snapshot,characterId,goal,plans={},reserve=true) {
    const character = catalog.characters.find(c=>c.id===Number(characterId));
    const saved = snapshot.characters.find(c=>c.id===Number(characterId));
    if (!character || !saved || !joined(saved)) throw new Error('Choose a recruited, available character.');
    const available = stock(snapshot,characterId,plans,reserve);
    const weapons = candidates(catalog,character,available,'weapon',goal);
    const armors = candidates(catalog,character,available,'armor',goal);
    const accessories = candidates(catalog,character,available,'accessory',goal);
    // Slots use disjoint native equipment categories, so independent maxima are exact for this additive objective.
    function bestItem(items,currentId) {
      const best=items[0];
      if(!best || score(best,goal)<0)return null;
      // Keep existing gear on equal scores instead of making arbitrary sidegrades.
      return items.find(item=>item.id===currentId && score(item,goal)===score(best,goal)) || best;
    }
    const picks = {weaponId:bestItem(weapons,saved.equipment.weaponId)?.id || -1,armorId:bestItem(armors,saved.equipment.armorId)?.id || -1,accessoryIds:[],visionId:saved.equipment.visionId};
    for (let i=0;i<(saved.equipment.accessoryIds || []).length;i++) {
      const best = bestItem(accessories.filter(item=>(available.get(item.id)||0)>0),saved.equipment.accessoryIds[i]);
      picks.accessoryIds.push(best?.id || -1);
      if(best) available.set(best.id,available.get(best.id)-1);
    }
    return picks;
  }
  function validPlan(catalog,snapshot,id,plan,plans={},reserve=true) {
    const character = catalog.characters.find(c=>c.id===Number(id));
    const saved = snapshot.characters.find(c=>c.id===Number(id));
    if(!character || !saved || !joined(saved)) return 'Character is not available.';
    if(plan.accessoryIds.length !== saved.equipment.accessoryIds.length) return 'Accessory slot count changed.';
    const available = stock(snapshot,id,plans,reserve);
    const slots = [['weapon',plan.weaponId],['armor',plan.armorId],...plan.accessoryIds.map(x=>['accessory',x])];
    for(const [slot,itemId] of slots) {
      if(Number(itemId)<=0) continue;
      const item = catalog.equipment.find(e=>e.id===Number(itemId));
      if(!eligible(item,character,slot)) return `Item ${itemId} is not compatible.`;
      if((available.get(Number(itemId))||0)<1) return `No unreserved copy of ${item.name}.`;
      available.set(Number(itemId),available.get(Number(itemId))-1);
    }
    if(Number(plan.visionId)>0 && !(snapshot.resonances || []).some(v=>v.id===Number(plan.visionId))) return 'Resonance is not owned.';
    // Conservative plan rule: reserve one resonance per character; simultaneous sharing is not verified.
    if(Number(plan.visionId)>0 && (snapshot.characters || []).some(c=>c.id!==Number(id) && joined(c) && (plans[c.id] || (reserve?c.equipment:null))?.visionId===Number(plan.visionId))) return 'Resonance is reserved on another character. Release their reservation first.';
    return '';
  }
  function mastery(vision,owned,characterId) {
    const awake = Number(owned?.awakeningPoints || 0);
    const sync = Number((owned?.sync || []).find(x=>x.characterId===Number(characterId))?.points || 0);
    const rows=[];
    for(const [kind,stages,points] of [['Awakening',vision.awakening || [],awake],['Sync',vision.synchro || [],sync]]) {
      for(const stage of stages) for(const grant of stage.grants || []) {
        const required = Number(stage.requiredPoints ?? stage.masteryPoint);
        rows.push({...grant,kind,level:stage.level,required,reached:!!owned && points>=required});
      }
    }
    return {awake,sync,rows};
  }
  function accessibleSkills(vision,owned,characterId,catalog) {
    if(!owned) return [];
    const ids = new Set(mastery(vision,owned,characterId).rows.filter(r=>r.reached && r.type==='ActiveSkill').map(r=>r.id));
    // Command/mimic membership is not proof a skill is learned; do not add baseSkillIds.
    return catalog.skills.filter(s=>ids.has(s.id));
  }
  // ---------- what each Resonance skill/passive does, for the Resonances filters ----------
  // Native effect rows name their status (AttackDown, Haste, Poison…) or carry a typed effect (Revival, Counter…).
  const STATUS_TAGS = {AttackDown:'down:ATK',IntelligenceDown:'down:MAG',DeffenceDown:'down:DEF',MindDown:'down:SPR',Slow:'down:SPD',
    AttackUp:'up:ATK',IntelligenceUp:'up:MAG',DeffenceUp:'up:DEF',MindUp:'up:SPR',Haste:'up:SPD',
    Poison:'status:Poison',Blind:'status:Blind',Sleep:'status:Sleep',Silence:'status:Silence',Paralyzation:'status:Paralysis',
    Confusion:'status:Confusion',Berserk:'status:Berserk',
    Regene:'regen',Reraise:'reraise',Reflect:'reflect',Cover:'cover',CoverAll:'cover',RoyalGuard:'cover',Taunt:'taunt'};
  const TYPE_TAGS = {Revival:'revive',CureStatusCondition:'cure',Steal:'steal',StealStatus:'steal',Counter:'counter',HateTarget:'taunt',
    BreakDamageVariation:'stagger-up',CriticalRateVariation:'crit-up',AddElementWhenNoneElement:'imbue',AddElement:'imbue'};
  // Who an effect lands on: SkillTarget follows the skill; Self/Group/Random are explicit on the effect.
  function targetsOf(target, relation) {
    const t = clean(target), enemies = clean(relation) !== 'Friendlies';
    if (enemies) return t === 'Single' ? ['enemy'] : t === 'Random' ? ['random'] : t === 'SingleAndGroup' ? ['enemy','enemies'] : t === 'Self' ? ['self'] : ['enemies'];
    return t === 'Self' ? ['self'] : t === 'Single' ? ['ally'] : ['allies'];
  }
  function skillFacts(item, effectsById, passive) {
    const facts = [], calc = clean(item.calcType), element = clean(item.element);
    const skillTargets = passive ? ['self'] : targetsOf(item.target, item.relation);
    const add = (tag, targets) => { for (const target of targets) facts.push({tag, target, calc: calc in {Physic:1,Magic:1} ? calc : null, element: element !== 'None' && element ? element : null, id: item.id, passive}); };
    if (!passive && Number(item.mag) > 0 && clean(item.parameterType) === 'HitPoint') {
      const dir = clean(item.parameterVariationType);
      if (item.relation === 'Enemies' && dir === 'Decrease') add('damage', skillTargets);
      if (item.relation === 'Friendlies' && dir === 'Increase') add('heal', skillTargets);
    }
    for (const bundle of item.effectBundles || []) {
      const effect = effectsById.get(Number(bundle.effectId));
      if (!effect) continue;
      let tag = STATUS_TAGS[clean(effect.status)] || TYPE_TAGS[clean(effect.type)];
      if (!tag) continue;
      const kind = clean(bundle.TargetType);
      // Passive effect rows all say Self; passive debuffs/statuses ("Deprotect Opener", "Add Slow") land on enemies.
      const hostile = tag.startsWith('down:') || tag.startsWith('status:');
      const targets = passive ? [hostile ? 'enemy' : 'self'] : kind === 'SkillTarget' ? skillTargets : kind === 'Self' ? ['self']
        : targetsOf(kind === 'Group' ? 'Group' : kind, bundle.targetRelation);
      // Curing an enemy removes its buffs: that's Dispel, not a cure.
      if (tag === 'cure' && targets.every(t => ['enemy', 'enemies', 'random'].includes(t))) tag = 'dispel';
      add(tag, targets);
    }
    return facts;
  }
  const factsCache = new WeakMap();
  // Every fact a Resonance offers, with where it unlocks: {kind:'Awakening'|'Sync', required} or null (finisher/base kit).
  function resonanceFacts(catalog, vision) {
    if (!factsCache.has(catalog)) factsCache.set(catalog, new Map());
    const cache = factsCache.get(catalog);
    if (cache.has(vision.id)) return cache.get(vision.id);
    const effects = new Map((catalog.effects || []).map(e => [e.id, e])), skills = new Map((catalog.skills || []).map(s => [s.id, s])), passives = new Map((catalog.passives || []).map(p => [p.id, p]));
    const unlock = new Map();
    for (const [kind, stages] of [['Awakening', vision.awakening || []], ['Sync', vision.synchro || []]])
      for (const stage of stages) for (const g of stage.grants || []) if (!unlock.has(g.id)) unlock.set(g.id, {kind, required: Number(stage.requiredPoints ?? stage.masteryPoint)});
    const ids = new Set([vision.finishBlow, ...(vision.skillIds || []), ...(vision.passiveIds || []), ...unlock.keys()]);
    const facts = [];
    for (const id of ids) {
      const item = skills.get(id) || passives.get(id);
      if (!item) continue;
      for (const f of skillFacts(item, effects, !skills.has(id))) facts.push({...f, finisher: id === vision.finishBlow, unlock: unlock.get(id) || null});
    }
    cache.set(vision.id, facts);
    return facts;
  }
  // A Resonance matches when every chosen effect is offered by some fact that also fits the chosen targets,
  // damage types and elements. With no effects chosen, those other filters apply to its damage skills.
  function matchFacts(facts, filter) {
    const fits = f => (!filter.targets?.length || filter.targets.includes(f.target))
      && (!filter.calcs?.length || filter.calcs.includes(f.calc))
      && (!filter.elements?.length || filter.elements.includes(f.element));
    const wanted = filter.tags?.length ? filter.tags : (filter.targets?.length || filter.calcs?.length || filter.elements?.length ? ['damage'] : []);
    const hits = [];
    for (const tag of wanted) {
      const found = facts.filter(f => f.tag === tag && fits(f));
      if (!found.length) return null;
      hits.push(...found);
    }
    return hits;
  }

  function encounterOptions(catalog,snapshot,enemy,characterId) {
    const weaknesses = Object.entries(enemy.resistances || {}).filter(([,r])=>clean(r)==='Weakness').map(([e])=>clean(e));
    const bad = Object.entries(enemy.resistances || {}).filter(([,r])=>/Resist|Absorb|Null|Invalid|Halved/.test(clean(r))).map(([e])=>clean(e));
    return catalog.visions.filter(v=>snapshot.resonances.some(o=>o.id===v.id)).map(v=>{
      const owned=snapshot.resonances.find(o=>o.id===v.id);
      const skills=accessibleSkills(v,owned,characterId,catalog);
      const matches=skills.filter(s=>weaknesses.includes(clean(s.element)) && Number(s.mag)>0 && s.relation==='Enemies');
      const risky=skills.filter(s=>bad.includes(clean(s.element)) && Number(s.mag)>0);
      return {vision:v,skills,matches,risky,weaknesses};
    }).sort((a,b)=>b.matches.length-a.matches.length || a.vision.name.localeCompare(b.vision.name));
  }
  const api={clean,joined,goals,statLabels,stats,score,priorityStats,priorityGoal,kitProfile,resonanceFit,skillFacts,resonanceFacts,matchFacts,eligible,equipmentIds,stock,candidates,recommend,validPlan,mastery,accessibleSkills,encounterOptions};
  if(typeof module!=='undefined') module.exports=api;
  else root.Companion=api;
})(typeof globalThis!=='undefined'?globalThis:this);

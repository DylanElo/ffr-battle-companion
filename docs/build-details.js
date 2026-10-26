// Explanations use the evaluated build and removal checks, never generated claims of optimality.
const h = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const n = value => number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const clean = value => String(value ?? '').split('::').pop();
const labels = { PhysicalAttack: 'ATK', MagicalAttack: 'MAG', PhysicalDefense: 'DEF', MagicalDefense: 'MDEF',
  HitPoint: 'HP', MaxHitPoint: 'HP', MagicPoint: 'MP', MaxMagicPoint: 'MP', Strength: 'STR', Defence: 'STA',
  Intelligence: 'INT', Mind: 'SPR', Agility: 'SPD', Divine: 'Divine' };
const lookup = (indexes, kind, id) => indexes[kind]?.get(Number(id));
const ability = (indexes, id) => lookup(indexes, 'skills', id) || lookup(indexes, 'passives', id) || lookup(indexes, 'masterSkills', id);
function description(item, indexes) {
  return String(item?.desc || '').replace(/\{Effect(\d+)Param(\d+)\}/g, (_, effect, param) => {
    const bundle = item.effectBundles?.[Number(effect) - 1];
    const value = lookup(indexes, 'effects', bundle?.effectId)?.params?.[Number(param) - 1];
    return Number.isFinite(value) ? n(value) : 'unknown';
  });
}

export const estimateNotice = () => `<p class="model-notice small"><b>Model estimate</b> · Five rounds, starting at full HP and the selected MP level. Damage has not been checked against recorded battles. Search results are the strongest found within its budget.</p>`;

function removalText(reason) {
  if (!reason) return 'No removal comparison is available for this result.';
  if (reason.without?.valid === false || ['required-for-action', 'required-for-evaluation'].includes(reason.reason)) return 'Without this, no supported affordable attack was found with the remaining abilities.';
  const parts = [];
  for (const [key, label] of [['damageDelta', 'estimated damage per round'], ['staggerDelta', 'stagger per round']]) {
    if (!Number.isFinite(reason[key]) || Math.abs(reason[key]) < .05) continue;
    parts.push(`${n(Math.abs(reason[key]))} ${reason[key] > 0 ? 'less' : 'more'} ${label}`);
  }
  if (parts.length) return `Without it: ${parts.join('; ')}.`;
  if (Number.isFinite(reason.scoreDelta) && reason.scoreDelta > 1e-8) return 'Helps another selected goal, such as durability or LB generation; damage and stagger are unchanged.';
  return 'No estimated damage or stagger gain in this scenario. Its other benefits may not be scored.';
}

const emptyReasons = {
  'no-owned-compatible': 'You have no compatible owned item for this slot.',
  'reserved-or-used': 'Compatible copies are reserved by other characters or used elsewhere in this party.',
  'lowers-model': 'The available choices lowered the evaluated build score or removed a required role.',
  unsupported: 'The remaining choices could not be evaluated reliably.',
  'preserves-role': 'Filling this slot removed a required healing or protection option in the model.',
  'no-safe-fill': 'No available choice preserved the evaluated build and its required roles.'
};

export function gearExplanation(member, indexes) {
  const e = member.equipment || {}, reasons = list(member.gearReasons);
  const slots = [['weapon', null, 'Weapon', e.weaponId], ['armor', null, 'Armor', e.armorId],
    ...list(e.accessoryIds).map((id, i) => ['accessory', i, `Accessory ${i + 1}`, id])];
  return `<div class="build-gear" aria-label="Equipment and reasons">${slots.map(([slot, index, label, id]) => {
    const item = lookup(indexes, 'equipment', id), reason = reasons.find(r => r.slot === slot && (slot !== 'accessory' || r.index === index));
    const title = item?.name || (Number(id) > 0 ? `Unknown item #${id}` : 'Empty');
    const stats = Object.entries(item?.stats || {}).filter(([, v]) => Number(v) !== 0).map(([k, v]) => `${labels[k] || k} ${Number(v) > 0 ? '+' : ''}${n(v)}`).join(' · ');
    const effects = list(item?.passiveIds).map(pid => lookup(indexes, 'passives', pid)).filter(Boolean);
    return `<details class="gear-choice"><summary><span class="dim">${label}</span><b>${h(title)}</b></summary>
      ${item ? `<p>${h(removalText(reason))}</p>${stats ? `<p class="dim">${h(stats)}</p>` : ''}
      ${effects.map(p => `<p><b>${h(p.name)}</b>${p.desc ? ` — ${h(description(p, indexes))}` : ''}</p>`).join('')}
      ${list(reason?.unmodeledEffects).length ? `<p class="dim">Not included in this estimate: ${list(reason.unmodeledEffects).map(t => h(`${t.passiveName || 'Effect'} — ${t.reason}`)).join('; ')}</p>` : ''}`
      : `<p>${h(emptyReasons[reason?.reason] || 'No reason was recorded. This is an empty slot, not a recommendation to stay unequipped.')}</p>`}
    </details>`;
  }).join('')}</div>`;
}

function roleText(id, ev, indexes) {
  const reasons = [];
  if (id === Number(ev.skillId)) reasons.push('The attack selected for this build.');
  if (id === Number(ev.multiActionId)) reasons.push('Allows the modeled two-action turn. Repeating the same action remains unverified in-game.');
  if (id === 400660 && ev.magicBoost) reasons.push('Magic Boost is included in the attack’s damage and MP cost.');
  if (list(ev.supportSkillIds).includes(id)) {
    const role = ev.supportTags?.[ev.supportSkillIds.indexOf(id)];
    reasons.push(`Keeps ${role === 'healer' ? 'a healing' : role === 'protector' ? 'a protection' : 'a support'} action available. Using it takes a turn.`);
  }
  if (lookup(indexes, 'masterSkills', id)) reasons.push('Supplies a Mastery ability bundle. Its runtime expansion and save export need manual confirmation.');
  if (lookup(indexes, 'passives', id)) reasons.push('A passive in the selected ability package.');
  return reasons.join(' ') || 'Included in this loadout; it may provide an alternative action or a conditional benefit.';
}

function effectText(t) {
  const value = n(t.value), parameter = labels[t.parameter] || t.parameter || '';
  const names = { damagePercent: 'damage', elementDamagePercent: `${t.element || 'elemental'} damage`, breakPercent: 'stagger',
    elementBreakPercent: `${t.element || 'elemental'} stagger`, critRatePercent: 'critical chance', critDamagePercent: 'critical damage',
    physicalReductionPercent: 'physical damage reduction', magicReductionPercent: 'magic damage reduction' };
  if (t.kind === 'statFlat') return `${parameter} ${number(t.value) >= 0 ? '+' : ''}${value}`;
  if (t.kind === 'statPercent') return `${parameter} ${number(t.value) >= 0 ? '+' : ''}${value}%`;
  if (names[t.kind]) return `${names[t.kind]} ${number(t.value) >= 0 ? '+' : ''}${value}%`;
  if (t.kind === 'damageCapRaised') return 'Raises the per-hit damage cap to 99,999';
  if (t.kind === 'imbue') return `${t.element} imbue`;
  if (t.kind === 'resistance') return `${t.element} resistance: ${t.resistance}`;
  return t.passiveName || t.reason || 'Effect included in the model';
}

export function buildExplanation(member, indexes) {
  const ev = member.explanationEvaluation || member.evaluation || {}, skill = lookup(indexes, 'skills', ev.skillId), common = ev.common || {};
  const ids = list(ev.equippedSkillIds), reasons = list(member.abilityReasons), analysis = ev.passiveAnalysis || {};
  const magical = clean(skill?.calcType) === 'Magic';
  const counted = list(analysis.applied), omitted = [...list(analysis.deferred), ...list(analysis.unsupported)];
  return `<details class="build-explanation" data-keep="why-${member.characterId}"><summary>Why this build <span class="dim">· ${n(ev.skillCost)} / ${n(ev.skillBudget)} AP · ${ids.length} / ${n(ev.maxSkillSlots)} slots</span></summary>
    <p class="small">Removal checks keep the other equipment and equipped abilities fixed, then choose the best supported attack from what remains. They are individual estimates, not additive bonuses or a proof of the best possible build.</p>
    ${member.evaluation?.actionDescription ? `<p class="small"><b>Party action:</b> ${h(member.evaluation.actionDescription)} The checks below describe the character’s own attack before party support.</p>` : ''}
    ${list(ev.mpExhaustedRounds).length ? `<p class="model-notice small">Insufficient MP in round(s) ${ev.mpExhaustedRounds.map(n).join(', ')}. Those attacks contribute zero; MP recovery and a replacement action are not simulated.</p>` : ''}
    <h5>Equipped abilities</h5>
    <ul class="build-abilities">${ids.map(id => {
      const a = ability(indexes, id), reason = reasons.find(r => Number(r.id) === Number(id));
      return `<li><div><b>${h(a?.name || `Ability #${id}`)}</b><span>${n(reason?.cost ?? a?.equipCost)} AP</span></div>
        <p>${h(roleText(Number(id), ev, indexes))}</p><p>${h(removalText(reason))}</p>
        ${a?.desc ? `<p class="dim">${h(description(a, indexes))}</p>` : ''}
        ${a?.grants ? `<p class="dim">Grants: ${[...list(a.grants.activeIds), ...list(a.grants.passiveIds)].map(pid => h(ability(indexes, pid)?.name || `Ability #${pid}`)).join(', ')}.</p>` : ''}</li>`;
    }).join('') || '<li>No AP abilities are equipped; the chosen attack is available without an equipped slot.</li>'}</ul>
    ${list(ev.alwaysPassiveIds).length ? `<h5>Effects from gear and Resonance</h5><p class="small">${list(ev.alwaysPassiveIds).map(id => h(ability(indexes, id)?.name || `Passive #${id}`)).join(', ')}. These use no ability slot.</p>` : ''}
    ${counted.length ? `<h5>Counted for the normal attack</h5><ul class="notes">${counted.map(t => `<li>${h(t.passiveName ? `${t.passiveName}: ` : '')}${h(effectText(t))}</li>`).join('')}</ul>` : ''}
    ${ev.limit ? `<h5>LB model</h5><p class="small">Fill rate ×${n(ev.limit.mult)}; +${n(ev.limit.fillOnStagger)} base gauge when this character staggers; ${n(ev.limit.recuperate)} base gauge refunded after an LB. These are handled separately from normal-attack effects.</p>` : ''}
    ${omitted.length ? `<h5>Not counted in the normal attack</h5><ul class="notes">${omitted.map(t => `<li>${h(t.passiveName || `Effect ${t.effectId}`)}: ${h(t.reason)}</li>`).join('')}</ul>` : ''}
    <h5>Damage inputs</h5>
    <p class="small">${h(skill?.name || 'Selected attack')} uses this character’s ${magical ? 'MAG' : 'ATK'} (${n(common.attack)}) against ${magical ? 'magic' : 'physical'} defense (${n(common.defense)}). Level ${n(common.level)}; skill coefficient ${n(skill?.mag)}; ${n(ev.actionCount || 1)} action(s), ${n(ev.turnMp)} MP per turn, from ${n(ev.availableMp)} starting MP.</p>
    <p class="small">Element ${h(ev.element || 'None')} (${h(ev.resistance || 'None')}); elemental multiplier ×${n(common.elementFactor ?? 1)}; outgoing multiplier ×${n(common.outgoingFactor ?? 1)}; critical chance ${n(number(ev.criticalChance) * 100)}%; cap ${n(common.damageCap)} per hit.</p>
    <p class="dim small">These are inputs to the recovered damage formula. Each hit is rounded and capped separately; expected damage blends normal and critical outcomes. LB and stagger timing add assumptions to the five-round estimate.</p>
    ${list(ev.warnings).length ? `<h5>Limits of this result</h5><ul class="notes">${ev.warnings.map(w => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

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

const phaseSkills = turn => list(turn?.steps?.length ? turn.steps : turn?.leaves).map(step => Number(step.skillId));
const phaseName = (turn, indexes) => turn?.recipeLabel || phaseSkills(turn).map(id => ability(indexes, id)?.name || `Skill #${id}`).join(' → ');
export function commandPlan(ev, indexes) {
  const turn = ev.turn || {};
  const luck = turn.luckPolicy;
  const repeat = luck ? `generate Good Luck to ${n(Math.max(number(luck.requiredLuck),number(luck.requiredTurnLuck)))} with ${phaseName(luck.generatorTurn,indexes)}; then spend with ${phaseName(luck.spenderTurn,indexes)}` : list(turn.rotationTurns).length ? turn.rotationTurns.map(phase => phaseName(phase, indexes)).join(' → ') : ev.recipeLabel || phaseName(turn, indexes);
  return `${turn.openingTurn ? `Open with ${phaseName(turn.openingTurn, indexes)}; then ` : ''}${turn.rotationTurns?.length && !luck ? 'repeat ' : ''}${repeat}`;
}
function handlesGamble(ev) {
  if(!ev.actionPlan || !(number(ev.gambleSamples)>0) || ev.sampleKind!=='native-initiative-and-gamble')return false;
  const turn=ev.actionPlan.turn || ev.turn || {}, policy=turn.luckPolicy;
  const phases=[turn,ev.actionPlan.openingTurn,turn.openingTurn,...list(ev.actionPlan.rotationTurns),...list(turn.rotationTurns),policy?.generatorTurn,policy?.spenderTurn];
  return phases.some(phase=>phaseSkills(phase).includes(406060)) || list(ev.resourceEvents).some(event=>Number(event.skillId)===406060);
}
function gambleEventText(event) {
  const context=event.context || {}, outcomes=context.gambleHitOutcomes;
  const outcome=context.gambleOutcome ?? event.gambleOutcome;
  if(typeof outcome !== 'boolean')return '';
  const landed=Array.isArray(outcomes)?outcomes.filter(Boolean).length:null;
  const chance=Number.isFinite(event.hitProbability)?`; per-part hit chance ${n(event.hitProbability*100)}% at this state`:
    Number.isFinite(context.gambleProbability)?`; shared Gamble roll chance ${n(context.gambleProbability*100)}% at this state`:'';
  return `; sampled Gamble ${outcome?'critical hit':'miss'}${landed!==null?` (${landed}/${outcomes.length} parts landed)`:''}${chance}`;
}
function resourceEventText(event, indexes) {
  const round = `Round ${n(event.round)}`;
  if (event.kind === 'incoming') return `${round} · ${clean(event.damageType) === 'Magic' ? 'Magic' : 'Physical'} incoming hit: ${n(event.damage)} HP damage (${n(event.hpBefore)} → ${n(event.hpAfter)})${event.mirrorReduction ? '; Mirror reduction applied' : ''}.`;
  const skill = Number(event.skillId) > 0 ? ability(indexes,event.skillId)?.name || `Skill #${event.skillId}` : 'State event';
  if (event.kind === 'limit') return `${round} · Limit Burst: ${skill} — ${n(event.damage)} damage; HP remaining ${n(event.hpAfter)}, MP remaining ${n(event.mpAfter)}${event.goodLuckAfter !== undefined ? `; luck ${n(event.goodLuckAfter)}` : ''}.`;
  return `${round} · ${skill}${event.mpCost !== undefined ? `: ${n(event.mpCost)} MP` : ''}${number(event.hpCost) ? `, ${n(event.hpCost)} HP (${n(event.hpBefore)} → ${n(event.hpAfter)})` : ''}${event.goodLuckAfter !== undefined ? `; luck ${n(event.goodLuckAfter)}` : ''}${event.overclockStates?.length ? `; clock charges ${event.overclockStates.map(clock => n(clock.charges)).join(' / ')}` : ''}${event.overheat ? '; Overheat' : ''}${event.demonForm ? '; Witching Hour' : ''}${gambleEventText(event)}.`;
}
function stateExplanation(ev, indexes) {
  if (!ev.actionPlan) return '';
  const events = list(ev.resourceEvents), skips = list(ev.resourceSkips);
  const hasLuck = handlesGamble(ev) || number(ev.remainingGoodLuck) > 0 || events.some(event => number(event.goodLuckBefore) > 0 || number(event.goodLuckAfter) > 0);
  const clocks = list(ev.overclockStates);
  const luck=ev.turn?.luckPolicy;
  const phases = [...(ev.turn?.openingTurn ? [{turn:ev.turn.openingTurn,label:'Opening'}] : []), ...(luck ? [{turn:luck.generatorTurn,label:`Generate to ${n(Math.max(number(luck.requiredLuck),number(luck.requiredTurnLuck)))} luck`},{turn:luck.spenderTurn,label:'Spend when available'}] : list(ev.turn?.rotationTurns).map((turn,i)=>({turn,label:`Rotation ${i+1}`})))];
  return `${ev.gambleSamples ? `<p class="model-notice small">Damage and HP/MP totals are sampled averages across ${n(ev.gambleSamples)} reproducible native initiative and Gamble paths. Luck, skipped actions and the event trace show one representative path; those outcomes are not guaranteed.</p>` : ''}${phases.length ? `<h5>Action phases</h5><ol class="notes">${phases.map(({turn,label})=>`<li>${label}: ${h(phaseName(turn,indexes))} — ${n(turn.mp)} MP.</li>`).join('')}</ol>` : ''}<h5>Resource forecast</h5><p class="small">HP remaining ${n(ev.remainingHp)} / ${n(ev.actionPlan.maxHp)}; HP paid ${n(ev.hpSpent)}; MP remaining ${n(ev.remainingMp)}.${hasLuck ? ` Good Luck remaining ${n(ev.remainingGoodLuck)} / 10.` : ''}${clocks.length ? ` Overclock charges: ${clocks.map(clock => `${clock.effectId === 19004 ? 'Zero' : 'I'} ${n(clock.charges)}`).join(', ')}.` : ''}${ev.overheat ? ' Overheat is active at the end of the forecast.' : ''}${ev.demonForm ? ' Witching Hour is active at the end of the forecast.' : ''}</p>
    ${number(ev.remainingHp) <= 0 ? '<p class="bad small">The forecast ends at zero HP. A paid HP-cost attack can finish at zero HP; subsequent actions are blocked.</p>' : ''}
    ${skips.length ? `<h5>Actions skipped</h5><ul class="notes">${skips.map(skip => `<li>Round ${n(skip.round)} · ${h(ability(indexes, skip.skillId)?.name || `Skill #${skip.skillId}`)}: ${h(skip.reason)}</li>`).join('')}</ul>` : ''}
    ${events.length ? `<details><summary>Resource trace <span class="dim">· representative forecast</span></summary><ol class="notes">${events.slice(0,50).map(event => `<li>${h(resourceEventText(event,indexes))}</li>`).join('')}</ol>${events.length > 50 ? '<p class="dim small">First 50 events shown.</p>' : ''}</details>` : ''}`;
}

export const estimateNotice = () => `<p class="model-notice small"><b>Model estimate</b> · Damage arithmetic checked against the installed executable; native stagger/LB event order and nested command expiry are applied. Party order is averaged across reproducible native-priority samples. Five global turns, starting at full HP, native opening LB effects and the selected MP level. Scenario limits are listed below. Search results are the strongest found within its budget. <a href="https://github.com/DylanElo/ffr-battle-companion/blob/main/docs/combat-verification.md" target="_blank" rel="noopener noreferrer">What was verified</a></p>`;

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
  if (list(ev.skillIds || [ev.skillId]).includes(id) || [ev.turn?.openingTurn, ...list(ev.turn?.rotationTurns)].some(turn => phaseSkills(turn).includes(id))) reasons.push('Used in the selected command sequence; its own stats, cost and effects are evaluated.');
  if (list(ev.turn?.wrapperIds).includes(id) || id === Number(ev.multiActionId)) reasons.push('Runs the command branch shown below. Selected child order and repeated skills are preserved by the native queue.');
  if (id === 400660 && ev.magicBoost) reasons.push('Boosts only its selected spell. Each separate Boost pays the native modified spell cost; its effects expire before a plain sibling.');
  if (id === 400700 && ev.recklessAbandonment) reasons.push('Doubles the selected physical attack’s stagger contribution in the additive bonus bucket, at 1.5× its MP cost. The next plain sibling receives no bonus.');
  if (id === 400360) reasons.push('Casts one chosen spell four times, with -50 percentage points in the damage and stagger bonus buckets. Pays 20 MP plus that spell’s cost once per Barrage branch.');
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
  if (t.kind === 'gambleShot') return 'Gamble Shot: one shared critical-or-miss roll, followed by the eight parts’ accuracy checks. A successful part is critical; +5 luck is gained once when at least one part lands.';
  if (t.kind === 'accuracyBonus') return `accuracy +${value} points; modifies Gamble Shot’s native hit checks`;
  if (t.kind === 'primaryStatScale') return `STR / STA / INT / SPR / SPD scale ${value}%; native per-effect rounding. HP, MP and AP have no direct scale.`;
  if (t.kind === 'statFlat') return `${parameter} ${number(t.value) >= 0 ? '+' : ''}${value}`;
  if (t.kind === 'statPercent') return `${parameter} ${number(t.value) >= 0 ? '+' : ''}${value}%`;
  if (names[t.kind]) return `${names[t.kind]} ${number(t.value) >= 0 ? '+' : ''}${value}%`;
  if (t.kind === 'damageCapRaised') return 'Raises the per-hit damage cap to 99,999';
  if (t.kind === 'dominantPower') return 'Uses the higher of ATK and MAG';
  if (t.kind === 'dominantDefence') return 'Uses the higher of physical and magic defense';
  if (t.kind === 'imbue') return `${t.element} imbue`;
  if (t.kind === 'resistance') return `${t.element} resistance: ${t.resistance}`;
  return t.passiveName || t.reason || 'Effect included in the model';
}

export function buildExplanation(member, indexes) {
  const ev = member.explanationEvaluation || member.evaluation || {}, skill = lookup(indexes, 'skills', ev.skillId), common = ev.common || {};
  const ids = list(ev.equippedSkillIds), reasons = list(member.abilityReasons), analysis = ev.passiveAnalysis || {};
  const magical = clean(skill?.calcType) === 'Magic';
  const gamble=handlesGamble(ev), gambleChance=Number.isFinite(ev.hitProbability)?ev.hitProbability:number(ev.criticalChance);
  const counted = list(analysis.applied), omitted = [...list(analysis.deferred), ...list(analysis.unsupported)]
    .filter(t=>!list(ev.limit?.effectIds).includes(Number(t.effectId)) && !(ev.actionPlan && list(ev.actionPlan.passiveIds).includes(Number(t.effectId) === 65004 ? 1499 : Number(t.effectId) === 65005 ? 1511 : -1)) && !(Number(t.effectId)===65006 && handlesGamble(ev)));
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
    ${counted.length ? `<h5>${ev.actionPlan ? 'Reference passive inputs before resource payment' : 'Counted for the normal attack'}</h5><ul class="notes">${counted.map(t => `<li>${h(t.passiveName ? `${t.passiveName}: ` : '')}${h(effectText(t))}</li>`).join('')}</ul>` : ''}
    ${ev.limit ? `<h5>LB model</h5><p class="small">Opening gauge ${n(Math.min(ev.limit.max,ev.limit.initial || 0))}; capacity ${n(ev.limit.max)}, including known support LBs. This character receives ${n(ev.limit.baseStaggerGain)} base gauge when its hit staggers the target, plus ${n(ev.limit.fillOnStagger)} at action end; ${n(ev.limit.recuperate)} is refunded after LB damage and stagger effects. Fill rate ×${n(ev.limit.mult)} applies to each earned gain before truncation and the capacity limit, but does not multiply opening gauge. Other party members receive no base reward from this character’s stagger.</p>` : ''}
    ${omitted.length ? `<h5>Not counted in the normal attack</h5><ul class="notes">${omitted.map(t => `<li>${h(t.passiveName || `Effect ${t.effectId}`)}: ${h(t.reason)}</li>`).join('')}</ul>` : ''}
    ${ev.recipeLabel ? `<h5>Command sequence</h5><p class="small">${h(commandPlan(ev, indexes))}</p><p class="dim small">Each equipped ability occupies one slot even when selected more than once. MP is charged per executed command. Mixed sequences use a bounded shortlist; the search is not exhaustive.</p>` : ''}
    ${list(ev.leafResults).length > 1 ? `<h5>Each selection</h5><ol class="notes">${ev.leafResults.map(leaf => {
      const action = lookup(indexes, 'skills', leaf.skillId), inputs = leaf.common || {};
      return `<li><b>${h(action?.name || `Skill #${leaf.skillId}`)}</b>${leaf.kind === 'support' ? ' — setup effect; no direct damage.' : ` — ${h(inputs.attackSource || 'ATK/MAG')} ${n(inputs.attack)}, ${h(inputs.defenseSource || 'target')} defense ${n(inputs.defense)}; ${n(leaf.damage)} damage, ${n(leaf.breakDamage)} stagger before the simulated break state.`}${leaf.mpCost !== undefined ? ` ${n(leaf.mpCost)} MP${leaf.paymentSuppressed ? ' (Barrage repeat)' : ''}.` : ''}</li>`;
    }).join('')}</ol>` : ''}
    ${stateExplanation(ev, indexes)}
    <h5>${ev.actionPlan ? 'Reference damage inputs' : 'Damage inputs'}</h5>
    <p class="small">${h(skill?.name || 'Selected attack')} uses this character’s ${h(common.attackSource || (magical ? 'MAG' : 'ATK'))} (${n(common.attack)}) against ${h(common.defenseSource || (magical ? 'magic' : 'physical'))} defense (${n(common.defense)}). Level ${n(common.level)}; skill coefficient ${n(skill?.mag)}; ${n(ev.actionCount || 1)} action(s), ${n(ev.turnMp)} MP ${ev.actionPlan ? 'for the reference attack' : 'per turn'}, from ${n(ev.availableMp)} starting MP.</p>
    <p class="small">Element ${h(ev.element || 'None')} (${h(ev.resistance || 'None')}); elemental multiplier ×${n(common.elementFactor ?? 1)}; first attack’s outgoing multiplier ×${n(common.outgoingFactor ?? 1)}; ${gamble ? `every landed Gamble hit is critical; reference per-part hit chance ${n(gambleChance*100)}%` : `critical chance ${n(number(ev.criticalChance) * 100)}%`}; cap ${n(common.damageCap)} per hit.</p>
    <p class="dim small">These are inputs to the recovered damage formula. HP damage is truncated and capped per hit; stagger rounds to the nearest integer. ${handlesGamble(ev) ? 'Expected damage includes sampled Gamble hits and misses, plus the normal critical calculation for other actions.' : 'Expected damage blends normal and critical outcomes.'} Hits and stagger/LB events follow the recovered order; randomized ordering is sampled rather than predicted; starting state and unmodeled enemy actions remain scenario limits.</p>
    ${list(ev.warnings).length ? `<h5>Limits of this result</h5><ul class="notes">${ev.warnings.map(w => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

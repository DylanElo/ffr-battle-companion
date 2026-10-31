// What a build is made of, in player terms: the move, the gear, the abilities and what is always on.
// Each line opens to what it does (the game's own description) and what it adds in this build.
export const h = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const n = value => number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const whole = value => Math.round(number(value)).toLocaleString();
const labels = { PhysicalAttack: 'ATK', MagicalAttack: 'MAG', PhysicalDefense: 'DEF', MagicalDefense: 'MDEF',
  HitPoint: 'HP', MaxHitPoint: 'HP', MagicPoint: 'MP', MaxMagicPoint: 'MP', Strength: 'STR', Defence: 'STA',
  Intelligence: 'INT', Mind: 'SPR', Agility: 'SPD', Divine: 'Divine' };
const lookup = (indexes, kind, id) => indexes[kind]?.get(Number(id));
const ability = (indexes, id) => lookup(indexes, 'skills', id) || lookup(indexes, 'passives', id) || lookup(indexes, 'masterSkills', id);
export function description(item, indexes) {
  const effectOf = effect => lookup(indexes, 'effects', item.effectBundles?.[Number(effect) - 1]?.effectId);
  // "{Effect1Turn} {Effect1Turn}|plural(one=turn, other=turns)" is the effect's duration with its unit.
  return String(item?.desc || '').replace(/\{Effect(\d+)Turn\} \{Effect\d+Turn\}\|plural\(one=([^,]+), other=([^)]+)\)/g, (_, effect, one, other) => {
    const turns = effectOf(effect)?.duration;
    return Number.isFinite(turns) ? `${n(turns)} ${turns === 1 ? one : other}` : 'unknown';
  }).replace(/\{Effect(\d+)Param(\d+)(Rate)?\}/g, (_, effect, param, rate) => {
    const value = effectOf(effect)?.params?.[Number(param) - 1];
    // "Rate" params are multipliers (120 = +20%).
    return Number.isFinite(value) ? n(rate ? value - 100 : value) : 'unknown';
  });
}

// ---------- the move ----------

const phaseSkills = turn => list(turn?.steps?.length ? turn.steps : turn?.leaves).map(step => Number(step.skillId));
const phaseName = (turn, indexes) => turn?.recipeLabel || phaseSkills(turn).map(id => ability(indexes, id)?.name || `Skill #${id}`).join(' → ');
export function commandPlan(ev, indexes) {
  const turn = ev.turn || {};
  const luck = turn.luckPolicy;
  const repeat = luck ? `generate Good Luck to ${n(Math.max(number(luck.requiredLuck),number(luck.requiredTurnLuck)))} with ${phaseName(luck.generatorTurn,indexes)}; then spend with ${phaseName(luck.spenderTurn,indexes)}` : list(turn.rotationTurns).length ? turn.rotationTurns.map(phase => phaseName(phase, indexes)).join(' → ') : ev.recipeLabel || phaseName(turn, indexes);
  // Opening recipes from the battle model already name their opening action.
  const opening = turn.openingTurn && !repeat.startsWith('Open with ') ? `Open with ${phaseName(turn.openingTurn, indexes)}; then ` : '';
  return `${opening}${turn.rotationTurns?.length && !luck ? 'repeat ' : ''}${repeat}`;
}
// Every distinct skill the move uses, once, in the order it is used.
function moveSkillIds(ev) {
  const turn = ev.turn || {}, luck = turn.luckPolicy;
  const phases = [turn.openingTurn, ...list(turn.rotationTurns), luck?.generatorTurn, luck?.spenderTurn, turn];
  return [...new Set([...phases.flatMap(phaseSkills), ...list(ev.skillIds), Number(ev.skillId)].filter(id => id > 0))];
}
/** The move a character uses each turn; it opens to what each of its skills does. */
export function moveDetails(ev, indexes) {
  const skill = lookup(indexes, 'skills', ev.skillId);
  const label = h(commandPlan(ev, indexes) || skill?.name || 'No attack') + (skill ? ` <small>${whole(ev.turnMp ?? skill.cost)} MP</small>` : '');
  const skills = moveSkillIds(ev).map(id => lookup(indexes, 'skills', id)).filter(s => s?.desc);
  if (!skills.length) return `<span class="move">${label}</span>`;
  // A one-skill move is already named in the summary; a sequence names each of its skills.
  const lines = skills.length === 1 ? [h(description(skills[0], indexes))] : skills.map(s => `<b>${h(s.name)}</b> — ${h(description(s, indexes))}`);
  return `<details class="move"><summary>${label}</summary>${lines.map(line => `<p>${line}</p>`).join('')}</details>`;
}

// ---------- what each piece adds ----------

// A removal check: the same build without one piece. Positive deltas are what the piece adds.
function gainText(reason) {
  if (!reason) return '';
  if (reason.without?.valid === false || ['required-for-action', 'required-for-evaluation'].includes(reason.reason)) return 'Needed for the attack.';
  const parts = [['damageDelta', 'damage'], ['staggerDelta', 'stagger']].filter(([key]) => Number.isFinite(reason[key]) && Math.abs(reason[key]) >= .5)
    .map(([key, label]) => `${reason[key] > 0 ? '+' : '−'}${whole(Math.abs(reason[key]))} ${label} per round`);
  if (parts.length) return `${parts.join(', ')}.`;
  if (Number.isFinite(reason.scoreDelta) && reason.scoreDelta > 1e-8) return 'Helps durability or Limit Burst.';
  return 'No measurable gain in this fight.';
}
function roleOf(id, ev) {
  if (moveSkillIds(ev).includes(id) || list(ev.turn?.wrapperIds).includes(id) || id === Number(ev.multiActionId)) return 'Used every turn.';
  const at = list(ev.supportSkillIds).indexOf(id);
  if (at < 0) return '';
  return { healer: 'Lets this character heal.', protector: 'Lets this character protect the party.' }[ev.supportTags?.[at]] || 'A support option.';
}

const emptyReasons = {
  'no-owned-compatible': 'You own nothing for this slot.',
  'reserved-or-used': 'Your copies are used by other characters.',
  'lowers-model': 'Nothing you own improves this build here.',
  unsupported: 'Your options have effects this tool can’t estimate yet.',
  'preserves-role': 'Your options would cost this character a healing or protection role.',
  'no-safe-fill': 'Nothing you own fits without weakening the build.'
};

export function gearExplanation(member, indexes) {
  const e = member.equipment || {}, reasons = list(member.gearReasons);
  const slots = [['weapon', null, 'Weapon', e.weaponId], ['armor', null, 'Armor', e.armorId],
    ...list(e.accessoryIds).map((id, i) => ['accessory', i, `Accessory ${i + 1}`, id])];
  return `<div class="build-gear" aria-label="Equipment">${slots.map(([slot, index, label, id]) => {
    const item = lookup(indexes, 'equipment', id), reason = reasons.find(r => r.slot === slot && (slot !== 'accessory' || r.index === index));
    const title = item?.name || (Number(id) > 0 ? `New item #${id}` : 'Empty');
    const stats = Object.entries(item?.stats || {}).filter(([, v]) => Number(v) !== 0).map(([k, v]) => `${labels[k] || k} ${Number(v) > 0 ? '+' : ''}${n(v)}`).join(' · ');
    const effects = list(item?.passiveIds).map(pid => lookup(indexes, 'passives', pid)).filter(Boolean);
    const uncounted = new Set(list(reason?.unmodeledEffects).map(t => Number(t.passiveId)));
    return `<details class="gear-choice"><summary><span class="dim">${label}</span><b>${h(title)}</b></summary>
      ${item ? `${gainText(reason) ? `<p>${h(gainText(reason))}</p>` : ''}${stats ? `<p class="dim">${h(stats)}</p>` : ''}
      ${effects.map(p => `<p><b>${h(p.name)}</b>${uncounted.has(p.id) ? ' <span class="dim">(not counted)</span>' : ''}${p.desc ? ` — ${h(description(p, indexes))}` : ''}</p>`).join('')}`
      : `<p>${h(emptyReasons[reason?.reason] || 'Empty.')}</p>`}
    </details>`;
  }).join('')}</div>`;
}

/** The equipped abilities with their AP; each opens to what it does and what it adds here. */
export function abilityList(member, indexes) {
  const ev = member.explanationEvaluation || member.evaluation || {}, ids = list(ev.equippedSkillIds), reasons = list(member.abilityReasons);
  if (!ids.length) return '<p class="dim small">None needed: the move comes with the Resonance.</p>';
  return `<div class="build-gear" aria-label="Abilities">${ids.map(id => {
    const a = ability(indexes, id), reason = reasons.find(r => Number(r.id) === Number(id));
    const grants = a?.grants ? [...list(a.grants.activeIds), ...list(a.grants.passiveIds)].map(g => ability(indexes, g)?.name).filter(Boolean) : [];
    const value = roleOf(Number(id), ev) || gainText(reason);
    return `<details class="gear-choice ability"><summary><b>${h(a?.name || `New ability #${id}`)}</b><span class="dim">${n(reason?.cost ?? a?.equipCost)} AP</span></summary>
      ${value ? `<p>${h(value)}</p>` : ''}${a?.desc ? `<p class="dim">${h(description(a, indexes))}</p>` : ''}
      ${grants.length ? `<p class="dim">Includes ${h(grants.join(', '))}.</p>` : ''}
    </details>`;
  }).join('')}</div>`;
}

/** Effects that need no slot: the character's own and the Resonance's. Gear effects are listed under their item. */
export function alwaysOnList(member, indexes) {
  const ev = member.evaluation || {}, e = member.equipment || {};
  const fromGear = new Set([e.weaponId, e.armorId, ...list(e.accessoryIds)].flatMap(id => list(lookup(indexes, 'equipment', id)?.passiveIds)).map(Number));
  const effects = list(ev.alwaysPassiveIds).map(Number).filter(id => !fromGear.has(id)).map(id => lookup(indexes, 'passives', id)).filter(Boolean);
  if (!effects.length) return '';
  return `<div class="build-gear" aria-label="Always on">${effects.map(p => `<details class="gear-choice ability"><summary><b>${h(p.name)}</b></summary>
    ${p.desc ? `<p class="dim">${h(description(p, indexes))}</p>` : ''}</details>`).join('')}</div>`;
}

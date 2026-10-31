// Manually equipped abilities: what a character can equip, what it costs, and what no longer fits.
import { describeAbility } from './piece-details.js?v=1';

const costOf = (id, indexes) => describeAbility(id, indexes)?.cost || 0;
const learnedIds = l => [...(l.learnedActiveIds || []), ...(l.learnedPassiveIds || []), ...(l.masterSkillIds || [])];

/** Learned actives, passives and master skills; free actives cost nothing and are not equipped. */
export function equippableAbilities(learned, indexes) {
  return [...new Set(learnedIds(learned))].map(id => describeAbility(id, indexes)).filter(Boolean);
}

export function abilityLoad(ids, learned, indexes) {
  return { used: ids.reduce((sum, id) => sum + costOf(id, indexes), 0), budget: Number(learned.skillBudget) || 0, slots: ids.filter(id => id > 0).length, maxSlots: Number(learned.maxSkillSlots) || 0 };
}

/** '' when the ability fits, otherwise the reason it does not. */
export function canEquip(id, ids, learned, indexes) {
  const load = abilityLoad(ids, learned, indexes), cost = costOf(id, indexes);
  if (load.slots >= load.maxSlots) return 'No free ability slot.';
  if (load.used + cost > load.budget) return `Not enough AP (needs ${cost}, ${load.budget - load.used} left).`;
  return '';
}

export function dropUnavailable(ids, learned) {
  const ok = new Set(learnedIds(learned));
  return { kept: ids.filter(id => ok.has(id)), dropped: ids.filter(id => !ok.has(id)) };
}

/** A build with its abilities filled in (from `saved` when it has none), empty (-1) slots dropped, so builds compare and stringify alike. */
export const withAbilities = (build, saved) => ({ ...structuredClone(build), equippedSkillIds: (build.equippedSkillIds ?? saved?.equippedSkillIds ?? []).filter(id => id > 0) });

/** `learned` for a build. The AP budget follows the build's gear (EquipCost), not the saved gear stats.learned assumes. */
export function learnedForBuild(stats, catalog, snapshot, charId, build) {
  const learned = stats.learned(catalog, snapshot, charId, Number(build.visionId) > 0 ? Number(build.visionId) : -1);
  return { ...learned, skillBudget: stats.characterStats(catalog, snapshot, charId, build).skillBudget };
}

/**
 * A Build result laid over the draft without touching its pins. Pinned Resonance, weapon, armor and accessories (each in its own slot)
 * stay as they were; the rest comes from `result` ({equipment, visionId, evaluation}). A pinned ability the search left out is
 * re-added when it fits (`learnedFor(newDraft)` gives the learned data), else its pin is dropped.
 * Returns {draft, dropped: ability ids whose pin was dropped}. Does not mutate `draft`.
 */
export function applyBuildResult(draft, result, learnedFor, indexes) {
  const locks = draft.locks, eq = result.equipment, pin = (on, id) => on && Number(id) > 0;
  const fillers = [...eq.accessoryIds];
  draft.accessoryIds.forEach((id, n) => { const at = fillers.indexOf(id); if (pin(locks.accessories[n], id) && at >= 0) fillers.splice(at, 1); });
  const next = { ...eq, accessoryIds: draft.accessoryIds.map((id, n) => pin(locks.accessories[n], id) ? id : (fillers.shift() ?? -1)),
    visionId: pin(locks.vision, draft.visionId) ? draft.visionId : result.visionId,
    equippedSkillIds: (result.evaluation.equippedSkillIds || []).filter(id => id > 0), recommendedActionId: result.evaluation.skillId, locks: { ...locks, accessories: [...locks.accessories] } };
  if (pin(locks.weapon, draft.weaponId)) next.weaponId = draft.weaponId;
  if (pin(locks.armor, draft.armorId)) next.armorId = draft.armorId;
  const learned = learnedFor(next), dropped = [];
  for (const id of locks.skillIds) {
    if (next.equippedSkillIds.includes(id)) continue;
    if (learned && !canEquip(id, next.equippedSkillIds, learned, indexes)) next.equippedSkillIds.push(id); else dropped.push(id);
  }
  next.locks.skillIds = locks.skillIds.filter(id => !dropped.includes(id));
  return { draft: next, dropped };
}

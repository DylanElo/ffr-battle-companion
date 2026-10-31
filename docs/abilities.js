// Manually equipped abilities: what a character can equip, what it costs, and what no longer fits.
import { describeAbility } from './piece-details.js?v=1';

const costOf = (id, indexes) => describeAbility(id, indexes)?.cost || 0;
const learnedIds = l => [...(l.learnedActiveIds || []), ...(l.learnedPassiveIds || []), ...(l.masterSkillIds || [])];

/** Learned actives, passives and master skills; free actives cost nothing and are not equipped. */
export function equippableAbilities(learned, indexes) {
  return [...new Set(learnedIds(learned))].map(id => describeAbility(id, indexes)).filter(Boolean);
}

export function abilityLoad(ids, learned, indexes) {
  return { used: ids.reduce((sum, id) => sum + costOf(id, indexes), 0), budget: Number(learned.skillBudget) || 0, slots: ids.length, maxSlots: Number(learned.maxSkillSlots) || 0 };
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

/** A build with its abilities filled in (from `saved` when it has none), so builds compare and stringify alike. */
export const withAbilities = (build, saved) => ({ ...structuredClone(build), equippedSkillIds: [...(build.equippedSkillIds ?? saved?.equippedSkillIds ?? [])] });

/** `learned` for a build. The AP budget follows the build's gear (EquipCost), not the saved gear stats.learned assumes. */
export function learnedForBuild(stats, catalog, snapshot, charId, build) {
  const learned = stats.learned(catalog, snapshot, charId, Number(build.visionId) > 0 ? Number(build.visionId) : -1);
  return { ...learned, skillBudget: stats.characterStats(catalog, snapshot, charId, build).skillBudget };
}

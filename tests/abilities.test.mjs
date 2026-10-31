import test from 'node:test';
import assert from 'node:assert/strict';
import { equippableAbilities, abilityLoad, canEquip, dropUnavailable } from '../docs/abilities.js';

const indexes = {
  skills: new Map([[1, { id: 1, name: 'Free Strike', equipCost: 0 }], [2, { id: 2, name: 'Fira', equipCost: 20 }], [3, { id: 3, name: 'Cure', equipCost: 10 }]]),
  passives: new Map([[4, { id: 4, name: 'Guard', equipCost: 5 }]]),
  masterSkills: new Map([[5, { id: 5, name: 'Master', equipCost: 8 }]]),
  effects: new Map(),
};
const learned = (over = {}) => ({ freeActiveIds: [1], learnedActiveIds: [2, 3], learnedPassiveIds: [4], masterSkillIds: [5], skillBudget: 30, maxSkillSlots: 3, ...over });

test('abilityLoad sums equipCost and counts slots', () => {
  assert.deepEqual(abilityLoad([2, 4], learned(), indexes), { used: 25, budget: 30, slots: 2, maxSlots: 3 });
});
test('canEquip refuses an unaffordable ability with the exact reason', () => {
  assert.equal(canEquip(2, [3, 4], learned(), indexes), 'Not enough AP (needs 20, 15 left).');
});
test('canEquip refuses when slots are full', () => {
  assert.equal(canEquip(4, [2, 3, 5], learned({ skillBudget: 99 }), indexes), 'No free ability slot.');
});
test('canEquip allows when AP and a slot are free', () => {
  assert.equal(canEquip(3, [4], learned(), indexes), '');
});
test('dropUnavailable drops ids the new Resonance no longer teaches', () => {
  assert.deepEqual(dropUnavailable([2, 3, 4], learned({ learnedActiveIds: [3] , learnedPassiveIds: [4]})), { kept: [3, 4], dropped: [2] });
});
test('free active skills are not equippable items', () => {
  const list = equippableAbilities(learned(), indexes);
  assert.deepEqual(list.map(a => a.id).sort(), [2, 3, 4, 5]);
  assert.ok(!list.some(a => a.id === 1));
});

import { withAbilities, learnedForBuild } from '../docs/abilities.js';
test('learnedForBuild takes the AP budget from the build gear, not the saved gear', () => {
  const stats = { learned: (c, s, id, v) => ({ skillBudget: 10, seen: v }), characterStats: (c, s, id, b) => ({ skillBudget: b.weaponId === 2 ? 40 : 10 }) };
  assert.equal(learnedForBuild(stats, {}, {}, 1, { weaponId: 1, visionId: 7 }).skillBudget, 10);
  const swapped = learnedForBuild(stats, {}, {}, 1, { weaponId: 2, visionId: -1 });
  assert.equal(swapped.skillBudget, 40);
  assert.equal(swapped.seen, -1);
});
test('withAbilities makes an untouched draft stringify like the saved build', () => {
  const saved = { equipment: { weaponId: 1, visionId: 2 }, equippedSkillIds: [5] };
  assert.equal(JSON.stringify(withAbilities(saved.equipment, saved)), JSON.stringify(withAbilities(withAbilities(saved.equipment, saved), saved)));
  assert.deepEqual(withAbilities({ weaponId: 1, equippedSkillIds: [] }, saved).equippedSkillIds, []);
});

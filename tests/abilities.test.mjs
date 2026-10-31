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

test('padded empty slots (-1) are not used slots', () => {
  const l = learned({ maxSkillSlots: 3 });
  assert.equal(abilityLoad([2, -1, -1], l, indexes).slots, 1);
  assert.equal(canEquip(3, [2, -1, -1], l, indexes), '');
});
test('withAbilities drops empty slots and is stable', () => {
  const saved = { equipment: { weaponId: 1 }, equippedSkillIds: [2, -1, -1] };
  const once = withAbilities(saved.equipment, saved);
  assert.deepEqual(once.equippedSkillIds, [2]);
  assert.equal(JSON.stringify(withAbilities(once, saved)), JSON.stringify(once));
});

import { applyBuildResult } from '../docs/abilities.js';
const draftOf = (locks, over = {}) => ({ weaponId: 101, armorId: 201, accessoryIds: [301, 302, 303], visionId: 13001, equippedSkillIds: [2], recommendedActionId: 0,
  locks: { vision: false, weapon: false, armor: false, accessories: [false, false, false], skillIds: [], ...locks }, ...over });
const found = (over = {}) => ({ equipment: { weaponId: 102, armorId: 202, accessoryIds: [311, 312, 313] }, visionId: 13002, evaluation: { equippedSkillIds: [3], skillId: 9 }, ...over });
const fits = () => learned();

test('applyBuildResult keeps pinned weapon, armor and Resonance and takes the rest from the result', () => {
  const { draft } = applyBuildResult(draftOf({ weapon: true, vision: true }), found(), fits, indexes);
  assert.equal(draft.weaponId, 101); assert.equal(draft.armorId, 202); assert.equal(draft.visionId, 13001);
  assert.deepEqual(draft.accessoryIds, [311, 312, 313]); assert.equal(draft.recommendedActionId, 9);
});
test('applyBuildResult puts a pinned accessory back in its slot; other slots take the result fillers', () => {
  const r = found({ equipment: { weaponId: 102, armorId: 202, accessoryIds: [311, 302, 312] } });
  const { draft } = applyBuildResult(draftOf({ accessories: [false, true, false] }), r, fits, indexes);
  assert.deepEqual(draft.accessoryIds, [311, 302, 312]);
  const r2 = found({ equipment: { weaponId: 102, armorId: 202, accessoryIds: [311, 312, 303] } });
  assert.deepEqual(applyBuildResult(draftOf({ accessories: [false, false, true] }), r2, fits, indexes).draft.accessoryIds, [311, 312, 303]);
});
test('applyBuildResult preserves the locks object', () => {
  const { draft } = applyBuildResult(draftOf({ weapon: true }), found(), fits, indexes);
  assert.deepEqual(draft.locks, { vision: false, weapon: true, armor: false, accessories: [false, false, false], skillIds: [] });
});
test('applyBuildResult re-adds a pinned skill the result left out when it fits, drops the pin when it does not', () => {
  const kept = applyBuildResult(draftOf({ skillIds: [2] }), found(), fits, indexes);
  assert.deepEqual(kept.draft.equippedSkillIds, [3, 2]); assert.deepEqual(kept.draft.locks.skillIds, [2]); assert.deepEqual(kept.dropped, []);
  const full = applyBuildResult(draftOf({ skillIds: [2] }), found(), () => learned({ maxSkillSlots: 1 }), indexes);
  assert.deepEqual(full.draft.equippedSkillIds, [3]); assert.deepEqual(full.draft.locks.skillIds, []); assert.deepEqual(full.dropped, [2]);
});

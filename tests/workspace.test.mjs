import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../docs/core.js';
import { revalidateWorkspace, readWorkspace, workspaceChoices, rememberWorkspace } from '../docs/workspace.js';

const plan = (weaponId, extra = {}) => ({ weaponId, armorId: -1, visionId: -1, accessoryIds: [], equippedSkillIds: [5],
  locks: { weapon: true, armor: false, vision: false, accessories: [], skillIds: [5] }, ...extra });
function fixture() {
  const catalog = { characters: [1, 2, 3].map(id => ({id, weaponType: 'Sword'})), equipment: [10, 20, 30].map(id => ({id, name: `Sword ${id}`, type: 'Weapon', detailType: 'Sword'})), enemies: [{id: 40, isBoss: true}] };
  const snapshot = { characters: [1, 2, 3].map((id, i) => ({id, joinStatus: 'Join', usable: true, equipment: {weaponId: [10, 20, 30][i], armorId: -1, visionId: -1, accessoryIds: []}, equippedSkillIds: []})), inventory: [10, 20, 30].map(id => ({id, quantity: 1})), resonances: [] };
  const indexes = {skills: new Map([[5, {id: 5, name: 'Strike', equipCost: 5}]]), passives: new Map(), masterSkills: new Map(), effects: new Map()};
  const stats = {learned: () => ({learnedActiveIds: [5], maxSkillSlots: 2}), characterStats: () => ({skillBudget: 10})};
  return {catalog, snapshot, indexes, stats, core};
}

test('keeps legal plans, pins and normalized goals without mutating the old workspace', () => {
  const workspace = {plans: {1: plan(10)}, goals: {1: {goals: ['stagger'], enemyId: 40}, 99: {goals: ['damage']}}};
  const before = structuredClone(workspace), result = revalidateWorkspace(workspace, fixture());
  assert.deepEqual(result.plans[1], workspace.plans[1]);
  assert.equal(result.goals[1].enemyId, 40);
  assert.deepEqual(result.goals[1].goals, ['stagger']);
  assert.equal(result.goals[99], undefined);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(workspace, before);
  result.plans[1].locks.weapon = false;
  assert.deepEqual(workspace, before);
});

test('valid swaps are checked together rather than against old equipped reservations', () => {
  const result = revalidateWorkspace({plans: {1: plan(20), 2: plan(10)}}, fixture());
  assert.deepEqual(Object.keys(result.plans), ['1', '2']);
  assert.deepEqual(result.issues, []);
});

test('lost stock is flagged even when a stale save equipment entry still references it', () => {
  const f = fixture(); f.snapshot.inventory[0].quantity = 0;
  const result = revalidateWorkspace({plans: {1: plan(10)}}, f);
  assert.deepEqual(result.plans, {});
  assert.match(result.issues[0].reason, /No unreserved copy/);
});

test('changed mastery and AP invalidate the full plan with a visible reason', () => {
  for (const change of [f => { f.stats.learned = () => ({learnedActiveIds: [], maxSkillSlots: 2}); }, f => { f.stats.characterStats = () => ({skillBudget: 0}); }]) {
    const f = fixture(); change(f);
    const result = revalidateWorkspace({plans: {1: plan(10)}}, f);
    assert.deepEqual(result.plans, {});
    assert.match(result.issues[0].reason, /Not available|Not enough AP/);
  }
});

test('all plans claiming an oversubscribed copy are flagged instead of arbitrarily selecting a winner', () => {
  const f = fixture();
  const result = revalidateWorkspace({plans: {1: plan(10), 2: plan(10)}}, f);
  assert.deepEqual(result.plans, {});
  assert.deepEqual(result.issues.map(i => i.characterId), [1, 2]);
});

test('removing an invalid plan reinstates saved gear reservations and rechecks dependents', () => {
  const result = revalidateWorkspace({plans: {1: plan(20), 2: plan(99)}}, fixture());
  assert.deepEqual(result.plans, {});
  assert.deepEqual(result.issues.map(i => i.characterId), [2, 1]);
  assert.match(result.issues[1].reason, /No unreserved copy/);
});

test('changed slot count and unavailable characters are flagged', () => {
  const f = fixture(); f.snapshot.characters[1].usable = false;
  const result = revalidateWorkspace({plans: {1: plan(10, {accessoryIds: [-1], locks: undefined}), 2: plan(20)}}, f);
  assert.deepEqual(result.plans, {});
  assert.ok(result.issues.some(i => /slot count/.test(i.reason)));
  assert.ok(result.issues.some(i => /not available/.test(i.reason)));
});

test('malformed workspaces and plan fields fail closed without throwing', () => {
  for (const workspace of [null, {plans: []}, {goals: []}]) assert.equal(revalidateWorkspace(workspace, fixture()).issues.length, 1);
  for (const broken of [null, {}, plan('10'), plan(10, {accessoryIds: 'bad'}), plan(10, {equippedSkillIds: [NaN]}), plan(10, {locks: {}}), plan(10, {equippedSkillIds: []})]) {
    const result = revalidateWorkspace({plans: {1: broken}}, fixture());
    assert.deepEqual(result.plans, {});
    assert.equal(result.issues.length, 1);
  }
});

test('legacy plans without pins use current ability fallback and empty pins', () => {
  const result = revalidateWorkspace({plans: {1: {weaponId: 10, armorId: -1, visionId: -1, accessoryIds: []}}}, fixture());
  assert.deepEqual(result.plans[1].equippedSkillIds, []);
  assert.deepEqual(result.plans[1].locks, core.emptyLocks(0));
});

function storageOf(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('reads existing plans and goals without changing their storage schema', () => {
  const storage = storageOf({'ffr-companion-plans:old': JSON.stringify({1: plan(10)}), 'ffr-companion-goals:old': JSON.stringify({1: {goals: ['stagger']}})});
  assert.deepEqual(readWorkspace(storage, 'old'), {plans: {1: plan(10)}, goals: {1: {goals: ['stagger']}}});
  assert.deepEqual(readWorkspace(storage, 'absent'), {plans: {}, goals: {}});
});

test('discovers legacy plans and goal-only workspaces, excludes current and empty, and uses metadata labels', () => {
  const storage = storageOf({
    'ffr-companion-plans:current': JSON.stringify({1: plan(10)}),
    'ffr-companion-plans:old': JSON.stringify({1: plan(10)}),
    'ffr-companion-goals:old': JSON.stringify({1: {goals: ['stagger']}}),
    'ffr-companion-goals:legacy12345678': JSON.stringify({1: {goals: ['damage']}}),
    'ffr-companion-plans:empty': '{}',
    'ffr-companion-plans:corrupt': 'oops',
    'ffr-companion-workspaces': JSON.stringify({old: {fileName: 'Slot1.sav', updatedAt: '2026-11-01T00:00:00.000Z'}, ghost: {fileName: 'Absent'}}),
  });
  assert.deepEqual(workspaceChoices(storage, 'current'), [
    {hash: 'old', fileName: 'Slot1.sav', updatedAt: '2026-11-01T00:00:00.000Z'},
    {hash: 'legacy12345678', fileName: 'Save legacy12', updatedAt: ''},
  ]);
});

test('remembering a workspace records metadata and preserves old plan data', () => {
  const plans = JSON.stringify({1: plan(10)}), storage = storageOf({'ffr-companion-plans:old': plans});
  assert.equal(rememberWorkspace(storage, {sha256: 'old', fileName: 'Slot1.sav'}), true);
  const meta = JSON.parse(storage.getItem('ffr-companion-workspaces'));
  assert.equal(meta.old.fileName, 'Slot1.sav');
  assert.ok(Number.isFinite(Date.parse(meta.old.updatedAt)));
  assert.equal(storage.getItem('ffr-companion-plans:old'), plans);
});

test('all storage helpers tolerate unavailable or corrupt browser storage', () => {
  const unavailable = {get length() { throw Error('blocked'); }, getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  for (const storage of [undefined, unavailable, storageOf({'ffr-companion-plans:old': '[]', 'ffr-companion-goals:old': 'null', 'ffr-companion-workspaces': 'oops'})]) {
    assert.deepEqual(readWorkspace(storage, 'old'), {plans: {}, goals: {}});
    assert.deepEqual(workspaceChoices(storage, 'current'), []);
  }
  assert.equal(rememberWorkspace(unavailable, {sha256: 'old'}), false);
  assert.equal(rememberWorkspace(storageOf(), null), false);
});

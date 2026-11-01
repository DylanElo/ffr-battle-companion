import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../docs/core.js';
import {withAbilities} from '../docs/abilities.js';
import {readWorkspace, workspaceChoices, rememberWorkspace, revalidateWorkspace} from '../docs/workspace.js';

const source = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
function fixture() {
  const plan = weaponId => ({weaponId, armorId: -1, visionId: -1, accessoryIds: [], equippedSkillIds: []});
  const data = new Map([['ffr-companion-plans:previous', JSON.stringify({2: plan(20)})]]);
  const localStorage = {get length() {return data.size;}, key: i => [...data.keys()][i], getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
  const snapshot = {schemaVersion: 1, source: {sha256: 'current', fileName: 'Current.sav'}, party: [1, 2], characters: [1, 2].map(id => ({id, joinStatus: 'Join', usable: true, equipment: plan(id * 10)})), inventory: [{id: 10, quantity: 1}, {id: 20, quantity: 1}], resonances: []};
  const plans = {1: plan(10)};
  const catalog = {characters: [1, 2].map(id => ({id, weaponType: 'Sword'})), equipment: [10, 20].map(id => ({id, name: `Sword ${id}`, type: 'Weapon', detailType: 'Sword'})), enemies: []};
  const context = vm.createContext({structuredClone, localStorage, readWorkspace, workspaceChoices, rememberWorkspace, revalidateWorkspace,
    C: core, withAbilities, catalog, snapshot, plans, goals: {}, index: {skills: new Map(), passives: new Map(), masterSkills: new Map()},
    CompanionStats: {learned: () => ({learnedActiveIds: [], maxSkillSlots: 3}), characterStats: () => ({skillBudget: 10})},
    ui: {charId: 1, transferHash: 'previous', reserve: true, deep: {marker: 'old'}},
    draft: core.withLocks(withAbilities(plan(10)), 0),
    toast: message => context.message = message, render() {}, cancelDeep() {}, optimizerController: {cancel() {}},
    recruited: () => context.snapshot.characters.filter(core.joined), suggestedBoss: () => null,
    goalsKey: () => 'ffr-companion-goals:current',
    storePlans: () => {localStorage.setItem('ffr-companion-plans:current', JSON.stringify(context.plans)); return true;},
    setDraft: () => context.draft = core.withLocks(withAbilities(context.plans[1] || context.snapshot.characters[0].equipment), 0),
  });
  vm.runInContext(source.slice(source.indexOf('function browserStorage()'), source.indexOf('function workspacePanel()')), context);
  vm.runInContext(source.slice(source.indexOf('export function loadSnapshot('), source.indexOf('function storePlans()')).replace('export ', ''), context);
  return {context, data};
}

test('workspace copy preserves existing plans, goals and an unsaved active draft', () => {
  const {context, data} = fixture();
  context.goals[1] = {goals: ['stagger']};
  context.draft.weaponId = 20; context.draft.locks.weapon = true;
  const edited = JSON.stringify(context.draft), oldSource = data.get('ffr-companion-plans:previous');
  vm.runInContext('transferWorkspace()', context);
  assert.equal(context.plans[1].weaponId, 10); assert.equal(context.plans[2].weaponId, 20);
  assert.deepEqual(context.goals[1].goals, ['stagger']);
  assert.equal(JSON.stringify(context.draft), edited);
  assert.equal(data.get('ffr-companion-plans:previous'), oldSource);
  assert.equal(context.ui.deep, null);
});

for (const bad of [{}, {weaponId: 10, armorId: -1, visionId: -1, accessoryIds: [], equippedSkillIds: 'bad'}]) {
  test('same-save restore rejects malformed plans without crashing or overwriting source storage', () => {
    const {context, data} = fixture(), stored = JSON.stringify({1: bad});
    data.set('ffr-companion-plans:current', stored);
    vm.runInContext('loadSnapshot(snapshot)', context);
    assert.equal(Object.keys(context.plans).length, 0);
    assert.equal(context.ui.transferIssues.length, 1);
    assert.match(context.ui.transferIssues[0].reason, /invalid equipment or abilities/);
    assert.equal(context.draft.weaponId, 10);
    assert.equal(data.get('ffr-companion-plans:current'), stored);
  });
}

test('same-save restore keeps a legal borrowed-gear plan and leaves reservation conflicts to the editor', () => {
  const {context, data} = fixture();
  const plan = {...context.plans[1], weaponId: 20};
  data.set('ffr-companion-plans:current', JSON.stringify({1: plan}));
  assert.equal(context.ui.reserve, true);
  vm.runInContext('loadSnapshot(snapshot)', context);
  assert.equal(context.plans[1].weaponId, 20);
  assert.equal(context.draft.weaponId, 20);
  assert.equal(context.ui.transferIssues.length, 0);
  assert.match(core.validPlan(context.catalog, context.snapshot, 1, context.plans[1], context.plans, true), /No unreserved copy/);
  assert.equal(core.validPlan(context.catalog, context.snapshot, 1, context.plans[1], context.plans, false), '');
});

test('copy conflicting with a current plan leaves the complete workspace unchanged', () => {
  const {context, data} = fixture();
  const incoming = JSON.parse(data.get('ffr-companion-plans:previous')); incoming[2].weaponId = 10;
  data.set('ffr-companion-plans:previous', JSON.stringify(incoming));
  const before = JSON.stringify({plans: context.plans, goals: context.goals, draft: context.draft});
  vm.runInContext('transferWorkspace()', context);
  assert.equal(JSON.stringify({plans: context.plans, goals: context.goals, draft: context.draft}), before);
  assert.equal(data.has('ffr-companion-plans:current'), false);
  assert.ok(context.ui.transferIssues.length);
  assert.match(context.message, /unchanged/);
  assert.equal(context.ui.deep.marker, 'old');
});

test('storage failure after copy is reported without claiming persistence or losing the original', () => {
  const {context, data} = fixture(), original = data.get('ffr-companion-plans:previous');
  context.storePlans = () => false;
  vm.runInContext('transferWorkspace()', context);
  assert.equal(context.plans[2].weaponId, 20);
  assert.match(context.message, /session.*storage failed/i);
  assert.equal(data.get('ffr-companion-plans:previous'), original);
});

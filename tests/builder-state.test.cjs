const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../docs/core.js');
const source = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');

function fixture() {
  const handlers = {}, workers = [];
  const context = vm.createContext({
    structuredClone, URL,
    C: {...core, checkLocks: () => '', validPlan: () => '', stock: () => new Map()},
    document: {addEventListener: (event, handler) => { handlers[event] = handler; }},
    catalog: {}, snapshot: {characters: []}, plans: {},
    ui: {charId: 1, deep: null, reserve: false},
    draft: {weaponId: 10, armorId: 20, accessoryIds: [30], visionId: 100, equippedSkillIds: [],
      locks: {vision: true, weapon: true, armor: true, accessories: [true], skillIds: []}},
    render() {}, storePlans() {}, setDraft() {}, closePicker() {}, toast() {}, name: () => 'Fixture', takenVisions: () => [],
    validateAbilities: () => '', canEquip: () => '', learnedFor: () => ({maxSkillSlots: 8}), index: {},
    goalFor: () => ({goals: ['damage'], enemyId: 'general', incomingDamage: 0, incomingType: 'Physic'}),
    setGoal() {}, optimizerController: {setAgainst() {}},
    Worker: class { constructor() { workers.push(this); } postMessage(message) { this.message = message; } terminate() { this.terminated = true; } },
  });
  const deep = source.slice(source.indexOf('let deepWorker = null'), source.indexOf('function gearPriorities()'))
    .replaceAll('import.meta.url', "'http://example.test/'");
  vm.runInContext(deep, context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('change', e =>"), source.indexOf('const ready =')), context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('click', e =>"), source.indexOf("document.addEventListener('keydown'")), context);
  const start = () => { vm.runInContext('deepSearch()', context); return workers.at(-1); };
  const change = target => handlers.change({target: {matches: () => false, ...target}});
  const click = data => {
    const target = {dataset: {}, id: '', hasAttribute: () => false, ...data};
    target.closest = selector => selector === '[data-copy-path]' ? null : target;
    handlers.click({target});
  };
  return {context, workers, start, change, click};
}

test('fully pinned equipment still searches unlocked abilities', () => {
  const {context, workers, start} = fixture();
  const worker = start();
  assert.equal(workers.length, 1);
  assert.equal(context.ui.deep.busy, true);
  assert.equal(worker.message.options.locks.weaponId, 10);
  assert.equal(worker.message.options.locks.skillIds.length, 0);
});

for (const kind of ['gear', 'abilities']) test(`an invalid ${kind} baseline stays restorable but is not scored`, () => {
  const {context, start} = fixture(), reason = kind === 'gear' ? 'Resonance is reserved.' : 'Not enough AP.';
  if (kind === 'gear') context.C.validPlan = () => reason;
  else context.validateAbilities = () => reason;
  const before = JSON.stringify(context.draft), worker = start();
  assert.equal(worker.message.baseline, null);
  assert.equal(context.ui.deep.busy, true);
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [], before: null}}});
  assert.equal(context.ui.deep.beforeReason, reason);
  assert.equal(JSON.stringify(context.ui.deep.before), before);
});

for (const [label, target] of [
  ['reservations', {id: 'reserve', checked: true}],
  ['enemy', {id: 'deep-enemy', value: '44'}],
  ['goal', {name: 'deep-goal', value: 'stagger', checked: true}],
]) test(`changing ${label} cancels the Build, clears results and ignores a queued response`, () => {
  const {context, start, change} = fixture(), worker = start();
  change(target);
  assert.equal(worker.terminated, true);
  assert.equal(context.ui.deep, null);
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [], current: null}}});
  assert.equal(context.ui.deep, null);
});

test('removing a plan cancels the Build and clears its old results', () => {
  const {context, start, click} = fixture(), worker = start();
  context.plans[1] = {};
  click({dataset: {release: '1'}});
  assert.equal(worker.terminated, true);
  assert.equal(context.ui.deep, null);
  assert.equal(context.plans[1], undefined);
});

test('changing scenario after a completed Build clears the old result', () => {
  const {context, start, change} = fixture(), worker = start();
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [], current: null}}});
  assert.ok(context.ui.deep.results);
  change({id: 'deep-enemy', value: '44'});
  assert.equal(context.ui.deep, null);
});

test('empty slots cannot acquire locks through the event handler', () => {
  const {context, click} = fixture();
  context.draft.weaponId = -1;
  context.draft.locks.weapon = false;
  click({dataset: {lock: 'weapon'}});
  assert.equal(context.draft.locks.weapon, false);
});

test('selecting an empty replacement clears an existing slot lock', () => {
  const {context, click} = fixture();
  context.document.querySelectorAll = () => [];
  click({dataset: {pickSlot: 'weapon', id: '-1'}});
  assert.equal(context.draft.weaponId, -1);
  assert.equal(context.draft.locks.weapon, false);
});

test('Build captures the exact draft and restore makes an independent copy including pins and abilities', () => {
  const {context, start, click} = fixture();
  context.draft.equippedSkillIds = [42]; context.draft.locks.skillIds = [42];
  const original = JSON.stringify(context.draft), worker = start();
  assert.equal(JSON.stringify(worker.message.baseline), original);
  context.draft.weaponId = 99;
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [], before: {valid: false}}}});
  click({id: 'restore-build'});
  assert.equal(JSON.stringify(context.draft), original);
  assert.equal(context.ui.deep.restored, true);
  context.draft.locks.skillIds.push(43);
  assert.equal(JSON.stringify(context.ui.deep.before), original);
});

test('ability filters preserve the running Build and selected draft', () => {
  const {context, start, change} = fixture(), worker = start();
  context.ui.abilityFilters = {q: '', kind: 'all', affordable: false};
  const original = JSON.stringify(context.draft);
  change({id: 'ability-kind', value: 'passive'});
  change({id: 'ability-affordable', checked: true});
  assert.equal(context.ui.abilityFilters.kind, 'passive');
  assert.equal(context.ui.abilityFilters.affordable, true);
  assert.equal(worker.terminated, undefined);
  assert.equal(JSON.stringify(context.draft), original);
});

test('trying alternatives and retrying after restore always starts with the original pins', () => {
  const {context, start, click} = fixture(), inputs = [];
  context.index = {};
  context.applyBuildResult = (before, result) => {
    inputs.push(JSON.stringify(before));
    return {draft: {...structuredClone(before), ...result.equipment}, dropped: []};
  };
  const original = JSON.stringify(context.draft), worker = start();
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [
    {equipment: {weaponId: 90}}, {equipment: {weaponId: 91}},
  ]}}});
  click({dataset: {deepPick: '1'}});
  assert.equal(context.draft.weaponId, 91);
  click({id: 'restore-build'});
  assert.equal(JSON.stringify(context.draft), original);
  click({id: 'retry-build'});
  assert.equal(context.draft.weaponId, 91);
  assert.equal(context.ui.deep.restored, false);
  assert.deepEqual(inputs, [original, original, original]);
});

test('build comparison keeps fractional scores and escapes ability names', () => {
  const context = vm.createContext({
    h: value => String(value).replaceAll('<', '&lt;'), name: (kind, id) => `${kind} ${id}`,
    describeAbility: () => ({name: '<unsafe>'}), index: {},
  });
  vm.runInContext(source.slice(source.indexOf('function buildComparison('), source.indexOf('// One character\'s Build result')), context);
  const before = {weaponId: 1, armorId: -1, visionId: 2, accessoryIds: [], equippedSkillIds: [3]};
  context.d = {before, beforeEvaluation: {valid: true, score: 0.1234}, applied: before};
  context.result = {equipment: before, evaluation: {score: 0.3456}};
  const html = vm.runInContext('buildComparison(d, result)', context);
  assert.match(html, /0\.1234/); assert.match(html, /0\.3456/);
  assert.ok(!html.includes('<unsafe>'));
});

test('unlock recommendations stay outside the draft and kept plans', () => {
  const {context, workers, click} = fixture();
  const before = JSON.stringify({draft: context.draft, plans: context.plans});
  click({id: 'find-unlocks'});
  const worker = workers.at(-1);
  assert.equal(worker.message.mode, 'unlocks');
  assert.equal(JSON.stringify(worker.message.build), JSON.stringify(context.draft));
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [{required: 95}], checked: 1, total: 1}}});
  assert.equal(context.ui.unlocks.results[0].required, 95);
  assert.equal(JSON.stringify({draft: context.draft, plans: context.plans}), before);
});

for (const [label, data] of [
  ['goal change', {change: {name: 'deep-goal', value: 'stagger', checked: true}}],
  ['explicit cancel', {click: {id: 'unlock-cancel'}}],
  ['ability edit', {click: {dataset: {pickAbility: '42'}}}],
]) test(`${label} cancels unlock work and ignores its queued result`, () => {
  const {context, workers, click, change} = fixture();
  context.ui.openSlot = 'skill:0';
  click({id: 'find-unlocks'});
  const worker = workers.at(-1);
  if (data.change) change(data.change); else click(data.click);
  assert.equal(worker.terminated, true);
  assert.equal(context.ui.unlocks, null);
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [{required: 95}]}}});
  assert.equal(context.ui.unlocks, null);
});

test('ability replacement frees its slot before checking AP and transfers its pin', () => {
  const {context, click} = fixture();
  context.ui.openSlot = 'skill:0';
  context.draft.equippedSkillIds = [10, 20, 30, 40, 50, 60, 70, 80];
  context.draft.locks.skillIds = [10, 20];
  context.canEquip = (id, remaining) => { assert.equal(id, 42); assert.deepEqual([...remaining], [20, 30, 40, 50, 60, 70, 80]); return ''; };
  click({dataset: {pickAbility: '42'}});
  assert.deepEqual([...context.draft.equippedSkillIds], [42, 20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual([...context.draft.locks.skillIds], [42, 20]);
});

test('emptying and filling a chosen ability slot preserves other positions and clears its pin', () => {
  const {context, click} = fixture();
  context.ui.openSlot = 'skill:0';
  context.draft.equippedSkillIds = [10, 20]; context.draft.locks.skillIds = [10];
  click({dataset: {pickAbility: '-1'}});
  assert.deepEqual([...context.draft.equippedSkillIds], [-1, 20]);
  assert.deepEqual([...context.draft.locks.skillIds], []);
  context.ui.openSlot = 'skill:7';
  click({dataset: {pickAbility: '42'}});
  assert.deepEqual([...context.draft.equippedSkillIds], [-1, 20, -1, -1, -1, -1, -1, 42]);
});

test('blocked or duplicate ability choices leave the draft intact', () => {
  const {context, click} = fixture();
  context.ui.openSlot = 'skill:0'; context.draft.equippedSkillIds = [10, 20];
  const before = JSON.stringify(context.draft);
  click({dataset: {pickAbility: '20'}});
  assert.equal(JSON.stringify(context.draft), before);
  context.canEquip = () => 'Not enough AP.';
  click({dataset: {pickAbility: '42'}});
  assert.equal(JSON.stringify(context.draft), before);
});

test('unlock search refuses a reserved draft and cannot run alongside Build', () => {
  const {context, workers, click, start} = fixture();
  context.C.validPlan = () => 'Resonance is reserved.';
  click({id: 'find-unlocks'});
  assert.equal(workers.length, 0);
  assert.match(context.ui.unlocks.error, /reserved/);
  context.C.validPlan = () => '';
  start(); click({id: 'find-unlocks'});
  assert.equal(workers.length, 1);
  assert.equal(workers[0].message.mode, 'single');
});

test('staging a party cancels unlock work before replacing the draft', () => {
  const {context, workers, click} = fixture();
  let controllerOptions;
  context.createOptimizerController = options => {controllerOptions = options; return {};};
  context.partyPlans = () => ({1: {weaponId: 99}});
  context.applyPlans = () => {}; context.shareParty = () => {}; context.scrollTo = () => {};
  vm.runInContext(source.slice(source.indexOf('const optimizerController = createOptimizerController('), source.indexOf('// Copies a picture')), context);
  click({id: 'find-unlocks'});
  const worker = workers.at(-1);
  controllerOptions.stageParty([{characterId: 2}]);
  assert.equal(worker.terminated, true);
  assert.equal(context.ui.unlocks, null);
  assert.equal(context.ui.deep, null);
  assert.equal(context.ui.charId, 2);
  worker.onmessage({data: {id: worker.message.id, type: 'result', result: {results: [{required: 95}]}}});
  assert.equal(context.ui.unlocks, null);
});

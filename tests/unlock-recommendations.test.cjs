const test = require('node:test');
const assert = require('node:assert/strict');
const {candidates, recommend} = require('../docs/unlock-recommendations.js');

const grant = (type, id, value = -1) => ({type, id, value});
const stage = (requiredPoints, grants) => ({requiredPoints, masteryPoint: requiredPoints + 999, grants});
function fixture() {
  const catalog = {visions: [
    {id: 10, name: 'Ifrit', synchro: [stage(10, [grant('PassiveSkill', 101)]), stage(20, [grant('BaseParameter', 2, 3)]), stage(30, [grant('ActiveSkill', 102)])]},
    {id: 11, name: 'Shiva', synchro: [{masteryPoint: 12, grants: [grant('MasterSkill', 103)]}]},
    {id: 12, name: 'Unowned', synchro: [stage(1, [grant('ActiveSkill', 102)])]},
  ], skills: [{id: 102}], passives: [{id: 101}], masterSkills: [{id: 103}]};
  const build = {weaponId: 50, armorId: -1, accessoryIds: [-1, -1], visionId: 10, equippedSkillIds: [101], locks: {skillIds: [101]}};
  const snapshot = {characters: [{id: 1, equipment: structuredClone(build)}], resonances: [
    {id: 10, awakeningPoints: 5, sync: [{characterId: 1, points: 5}, {characterId: 2, points: 17}]},
    {id: 11, awakeningPoints: 0, sync: []},
  ], untouched: {inventory: [50], player: 'original'}};
  const calls = [], deps = {
    core: {validPlan: () => ''},
    stats: {learned: () => ({learnedActiveIds: [], learnedPassiveIds: [101], masterSkillIds: []})},
    battle: {createModel: (c, snap, enemy, options) => {
      calls.push({snapshot: structuredClone(snap), options: structuredClone(options)});
      const last = calls.at(-1);
      return {scenario: {rounds: options.rounds || 5}, evidence: {formula: 'fixture'}, globalWarnings: ['Artifact not modeled.'], evaluate: args => {
        last.args = structuredClone(args);
        const score = snap.resonances.reduce((sum, owned) => sum + Number(owned.sync.find(row => row.characterId === 1)?.points || 0), 0);
        return {valid: true, score, fightDamage: score * 10, fightBreakDamage: score * 2, warnings: ['Selected skill note.']};
      }};
    }},
  };
  return {catalog, snapshot, build, deps, calls, enemy: {id: 77}};
}

test('owned-only candidates skip known abilities, honor native thresholds and include every crossed reward', () => {
  const f = fixture(), before = structuredClone(f.catalog);
  const rows = candidates(f.catalog, f.snapshot, 1, f.deps, f.build);
  assert.deepEqual(rows.map(row => [row.visionId, row.current, row.required, row.remaining]), [[10, 5, 30, 25], [11, 0, 12, 12]]);
  assert.equal(rows[0].kind, 'Sync');
  assert.equal(rows[0].priorRequired, 20); assert.equal(rows[1].priorRequired, null);
  assert.deepEqual(rows[0].rewards, [grant('PassiveSkill', 101), grant('BaseParameter', 2, 3), grant('ActiveSkill', 102)]);
  assert.deepEqual(rows[1].rewards, [grant('MasterSkill', 103)]);
  rows[0].rewards[0].id = 999;
  assert.deepEqual(f.catalog, before);
});

test('all globally known stages and unknown ability records do not become candidates', () => {
  const f = fixture();
  f.catalog.visions[0].synchro.unshift(stage(6, [grant('ActiveSkill', 999999)]));
  f.catalog.visions[0].synchro.push(stage(40, [grant('ActiveSkill', 999999)]));
  assert.equal(candidates(f.catalog, f.snapshot, 1, f.deps, f.build)[0].required, 30);
  assert.ok(!candidates(f.catalog, f.snapshot, 1, f.deps, f.build)[0].rewards.some(row => row.id === 999999));
  f.deps.stats.learned = () => ({learnedActiveIds: [102], learnedPassiveIds: [101], masterSkillIds: [103]});
  assert.deepEqual(candidates(f.catalog, f.snapshot, 1, f.deps, f.build), []);
});

test('future models change only chosen Sync points and keep gear, pins and options identical', () => {
  const f = fixture(), before = JSON.stringify({catalog: f.catalog, snapshot: f.snapshot, build: f.build}), messages = [];
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {goals: ['damage'], rounds: 7, includeSupportOptions: true}, f.deps, message => messages.push(message));
  assert.equal(JSON.stringify({catalog: f.catalog, snapshot: f.snapshot, build: f.build}), before);
  assert.equal(result.checked, 2); assert.equal(result.total, 2); assert.equal(result.unscored, 0);
  assert.equal(result.results[0].visionId, 10); assert.equal(result.results[0].scoreDelta, 25);
  assert.equal(result.results[0].earlierScore, 20); assert.equal(result.results[0].milestoneScoreDelta, 10);
  assert.equal(result.evaluations, 4);
  assert.equal(result.results[0].damageDelta, 250); assert.equal(result.results[0].staggerDelta, 50);
  assert.deepEqual(result.scenario, {rounds: 7}); assert.deepEqual(result.modelEvidence, {formula: 'fixture'});
  assert.deepEqual(result.baseline.warnings, ['Artifact not modeled.', 'Selected skill note.']);
  assert.deepEqual(result.results[0].evaluation.warnings, result.baseline.warnings);
  for (const call of f.calls) {
    assert.deepEqual(call.args.equipment, f.build); assert.deepEqual(call.args.lockedSkillIds, [101]);
    assert.equal(call.args.current, undefined); assert.equal(call.args.equippedSkillIds, undefined);
    assert.deepEqual(call.options, {...f.calls[0].options, includeSupportOptions: false});
  }
  const expected1 = structuredClone(f.snapshot); expected1.resonances[0].sync[0].points = 30;
  const expected2 = structuredClone(f.snapshot); expected2.resonances[1].sync.push({characterId: 1, points: 12});
  const earlier = structuredClone(f.snapshot); earlier.resonances[0].sync[0].points = 20;
  assert.deepEqual(f.calls.map(call => call.snapshot), [f.snapshot, expected1, earlier, expected2]);
  assert.equal(messages.length, 4);
});

test('rejects illegal current gear before modeling or changing anything', () => {
  const f = fixture(); let args;
  f.deps.core.validPlan = (...values) => {args = values; return 'Item is not compatible.';};
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.match(result.reason, /not compatible/); assert.equal(f.calls.length, 0);
  assert.deepEqual(args.slice(-2), [{}, false]);
});

test('invalid or thrown evaluations are unscored and nonpositive gains never become recommendations', () => {
  const f = fixture(); let n = 0;
  f.deps.battle.createModel = () => ({evaluate: () => ++n === 1 ? {valid: true, score: 10} : n === 2 ? {valid: false, score: 1000} : {valid: true, score: 9}});
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.equal(result.checked, 2); assert.equal(result.unscored, 1); assert.deepEqual(result.results, []);
  n = 0; f.deps.battle.createModel = () => ({evaluate: () => {if (++n === 1) return {valid: true, score: 10}; throw new Error('Unmodeled.');}});
  assert.equal(recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps).unscored, 2);
});

test('an invalid baseline never turns ability optimization into an apparent unlock gain', () => {
  const f = fixture();
  f.deps.battle.createModel = () => ({evaluate: () => ({valid: false, score: Infinity, reason: 'Unsupported action.'})});
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.equal(result.unscored, 2); assert.equal(result.checked, 0); assert.deepEqual(result.results, []);
  assert.match(result.reason, /Unsupported action/);
});

test('finite evaluation budgets stop between calls while obsolete elapsed limits are ignored', () => {
  const f = fixture();
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {maxEvaluations: 2}, f.deps);
  assert.equal(result.checked, 1); assert.equal(result.timedOut, true); assert.equal(f.calls.length, 2);
  assert.equal(result.unscored, 1); assert.deepEqual(result.results, []); assert.equal(result.evaluations, 2);
  const noTime = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {timeMs: 0}, f.deps);
  assert.equal(noTime.checked, 2); assert.equal(noTime.timedOut, false); assert.equal(noTime.evaluations, 4);
  const originalNow = Date.now; let clock = 0;
  try {
    Date.now = () => clock += 1e12;
    const timed = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {timeMs: 15}, f.deps);
    assert.deepEqual(timed, noTime);
  } finally {Date.now = originalNow;}
});

test('fully reached Sync returns empty without baseline work', () => {
  const f = fixture(); for (const own of f.snapshot.resonances) own.sync = [{characterId: 1, points: 9999}];
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.deepEqual(result.results, []); assert.equal(result.total, 0); assert.equal(f.calls.length, 0);
});

test('earlier stat gains cannot make an ineffective later ability milestone look useful', () => {
  const f = fixture(); f.snapshot.resonances = [f.snapshot.resonances[0]];
  f.deps.battle.createModel = (catalog, snapshot) => ({evaluate: () => {
    const points = snapshot.resonances[0].sync[0].points;
    return {valid: true, score: points >= 20 ? 15 : 5, equippedSkillIds: [101]};
  }});
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.deepEqual(result.results, []);
  assert.equal(result.checked, 1); assert.equal(result.unscored, 0); assert.equal(result.evaluations, 3);
});

test('a milestone with its own permanent stat co-grant can still be useful', () => {
  const f = fixture(); f.snapshot.resonances = [f.snapshot.resonances[0]];
  f.catalog.visions[0].synchro.at(-1).grants.push(grant('BaseParameter', 2, 10));
  f.deps.battle.createModel = (catalog, snapshot) => ({evaluate: () => {
    const points = snapshot.resonances[0].sync[0].points;
    return {valid: true, score: points >= 30 ? 25 : points >= 20 ? 15 : 5, equippedSkillIds: [101]};
  }});
  const row = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps).results[0];
  assert.equal(row.scoreDelta, 20); assert.equal(row.milestoneScoreDelta, 10); assert.equal(row.earlierScore, 15);
  assert.ok(row.rewards.some(reward => reward.type === 'BaseParameter' && reward.value === 10));
});

test('an unscorable earlier threshold cannot produce a verified milestone gain', () => {
  const f = fixture(); f.snapshot.resonances = [f.snapshot.resonances[0]];
  f.deps.battle.createModel = (catalog, snapshot) => ({evaluate: () => {
    const points = snapshot.resonances[0].sync[0].points;
    return points === 20 ? {valid: false} : {valid: true, score: points};
  }});
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.deepEqual(result.results, []); assert.equal(result.unscored, 1); assert.equal(result.evaluations, 3);
});

test('ranks finite positive gains by score then remaining points and returns at most three', () => {
  const f = fixture();
  for (const [id, points] of [[20, 4], [21, 3], [22, 2]]) {
    f.catalog.visions.push({id, name: `Vision ${id}`, synchro: [stage(points, [grant('ActiveSkill', 102)])]});
    f.snapshot.resonances.push({id, sync: []});
  }
  f.deps.battle.createModel = (c, snap) => ({evaluate: () => ({valid: true, score: snap === f.snapshot ? 0 : 1})});
  const result = recommend(f.catalog, f.snapshot, 1, f.build, f.enemy, {}, f.deps);
  assert.deepEqual(result.results.map(row => row.visionId), [22, 21, 20]);
});

test('candidate selection agrees with bundled catalog thresholds and real global learned abilities', () => {
  const fs = require('node:fs'), path = require('node:path');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/catalog.json'), 'utf8'));
  const core = require('../docs/core.js'), stats = require('../docs/stats.js');
  const native = catalog.characters[0], vision = catalog.visions[0];
  const build = {weaponId: -1, armorId: -1, accessoryIds: [], visionId: vision.id};
  const snapshot = {characters: [{id: native.id, joinStatus: 'Join', usable: true, experience: 0, equippedSkillIds: [], baseParameters: [], equipment: build}],
    inventory: [], resonances: [{id: vision.id, awakeningPoints: 0, sync: []}]};
  const first = candidates(catalog, snapshot, native.id, {core, stats}, build)[0];
  assert.equal(first.visionId, vision.id);
  assert.equal(first.required, core.mastery(vision, snapshot.resonances[0], native.id).rows.find(row => row.kind === 'Sync' && row.type === 'PassiveSkill').required);
  assert.ok(first.rewards.every(row => row.type === 'BaseParameter' || catalog[({ActiveSkill: 'skills', PassiveSkill: 'passives', MasterSkill: 'masterSkills'})[row.type]].some(item => item.id === row.id)));
  snapshot.resonances[0].sync.push({characterId: native.id, points: first.required});
  const next = candidates(catalog, snapshot, native.id, {core, stats}, build)[0];
  assert.ok(next.required > first.required);
  assert.ok(next.rewards.some(row => row.type === 'BaseParameter'));
  assert.ok(!next.rewards.some(row => first.rewards.some(old => old.id === row.id && old.type === row.type)));
});

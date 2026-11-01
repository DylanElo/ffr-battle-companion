import test from 'node:test';
import assert from 'node:assert/strict';
import {renderUnlockRecommendations} from '../docs/unlock-ui.js';

const indexes = {skills: new Map([[5, {id: 5, name: 'Fire', desc: 'Deal Fire damage.'}]]), passives: new Map(), masterSkills: new Map()};
test('unlock previews show requirements, whole threshold rewards and hypothetical estimates without equip actions', () => {
  const html = renderUnlockRecommendations({indexes, parameterNames: {1: 'Attack'}, state: {
    checked: 2, total: 3, unscored: 1, timedOut: true, baseline: {fightDamage: 10, fightBreakDamage: 1},
    results: [{visionId: 7, visionName: 'Vision', current: 5, required: 20, remaining: 15, scoreDelta: 0.02, milestoneScoreDelta: 0.005, beforeScore: 0.01, afterScore: 0.03,
      rewards: [{type: 'ActiveSkill', id: 5}, {type: 'BaseParameter', id: 1, value: 3}], evaluation: {fightDamage: 30, fightBreakDamage: 2, equippedSkillIds: [5]}}],
  }});
  for (const text of ['Hypothetical preview', '15 more Sync points', '20 Sync points (5 recorded)', 'Fire: Deal Fire damage.', '+3 STR (permanent)', 'Checked 2 of 3', '1 could not be scored', 'other milestones may be better', 'not attributed to one ability', 'milestone itself adds +0.005', '0.01', '0.03', 'data-unlock-vision="7"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /data-ability-toggle|data-pick-slot|id="keep"/);
});
test('idle, busy, refusal and no-gain states are explicit and escape data', () => {
  assert.match(renderUnlockRecommendations({buildBusy: true}), /id="find-unlocks" disabled/);
  assert.match(renderUnlockRecommendations({state: {busy: true, progress: '<working>'}}), /Cancel unlock search/);
  assert.doesNotMatch(renderUnlockRecommendations({state: {error: '<script>'}}), /<script>/);
  assert.match(renderUnlockRecommendations({state: {results: [], checked: 0, total: 0}}), /No further ability milestones/);
  assert.match(renderUnlockRecommendations({state: {results: [], checked: 1, total: 1}}), /does not mean.*useless/);
});

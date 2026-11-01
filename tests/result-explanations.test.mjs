import test from 'node:test';
import assert from 'node:assert/strict';
import {renderResultExplanations} from '../docs/result-explanations.js';

test('shows actual variable scenario settings and search restrictions', () => {
  const html = renderResultExplanations({enemyName: 'Dragon', goals: ['stagger', 'limit'], pinned: true,
    scenario: {rounds: 8, difficulty: 'Hard', mpPercent: 35, critical: true, broken: true, enemyCount: 2, incomingDamage: 321, incomingType: 'Magic', horizon: 'Initiative uses sampled native priority.'}});
  for (const text of ['Dragon', '8 rounds', 'Hard', 'Starting MP: 35%', 'Guaranteed critical hits are enabled', 'already staggered', 'Enemy count: 2', 'magical hit of 321', 'pinned pieces', 'stagger, Limit Burst', 'sampled native priority', 'strongest builds found', 'not a proven global optimum']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /five.round|5 rounds/);
});

test('zero incoming and ordinary critical and stagger settings are not represented as guarantees', () => {
  const html = renderResultExplanations({scenario: {rounds: 3, critical: false, broken: false, incomingDamage: 0, mpPercent: 100}});
  assert.match(html, /No enemy hits are configured/);
  assert.match(html, /guaranteed critical hits are off/);
  assert.match(html, /starts unstaggered/);
  assert.doesNotMatch(html, /one fixed .* hit of 0/);
});

test('shows only supplied passive effects and separates initial calculation from event simulation', () => {
  const html = renderResultExplanations({evaluation: {coverage: {applied: 1, deferred: 1, unsupported: 1}, passiveAnalysis: {
    applied: [{passiveName: 'Magic +20%'}], deferred: [{passiveName: 'Counter', reason: 'Requires passive event AfterDamage.'}],
    unsupported: [{passiveId: 99, reason: 'Unknown effect ID.'}]}}});
  assert.match(html, /1 applied · 1 deferred · 1 unsupported/);
  assert.match(html, /Applied effects:[\s\S]*Magic \+20%/);
  assert.match(html, /Not applied in the initial damage calculation:[\s\S]*Counter: Requires passive event AfterDamage/);
  assert.match(html, /handled later in the modeled sequence/);
  assert.match(html, /Passive #99: Unknown effect ID/);
  assert.doesNotMatch(html, /Berserk|confidence:|100% verified/);
});

test('escapes result warnings, effect names, scenario fields, goals and evidence', () => {
  const html = renderResultExplanations({enemyName: '<img src=x>', goals: ['<goal>'], scenario: {difficulty: '<hard>', horizon: '<sequence>'},
    evaluation: {warnings: ['<script>alert(1)</script>', '<script>alert(1)</script>'], passiveAnalysis: {unsupported: [{name: '<effect>', reason: '<reason>'}]}}, evidence: {formula: '<evidence>'}});
  assert.doesNotMatch(html, /<img|<script>|<goal>|<hard>|<sequence>|<effect>|<reason>|<evidence>/);
  assert.match(html, /&#60;script&#62;/);
  assert.equal((html.match(/alert\(1\)/g) || []).length, 1);
});

test('missing data stays unknown and does not manufacture scenario or coverage', () => {
  const html = renderResultExplanations();
  assert.match(html, /Scenario settings were not supplied/);
  assert.match(html, /Passive coverage was not supplied/);
  assert.match(html, /has not been calibrated against a live fight/);
  assert.doesNotMatch(html, /Starting MP|Difficulty:|5 rounds|0 unsupported|All effects/);
  assert.doesNotThrow(() => renderResultExplanations({evaluation: null, scenario: null, evidence: null}));
});

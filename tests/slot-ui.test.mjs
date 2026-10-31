import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSlot } from '../docs/slot-ui.js';

const piece = (over = {}) => ({ id: 5, name: 'Iron Sword', statsText: 'ATK +10', delta: '', text: 'A plain blade.', effects: [{ name: 'Keen', text: 'Sharper.' }], ...over });
const slot = (over = {}) => renderSlot({ key: 'weapon', label: 'Weapon', current: piece(), locked: false, open: false, choices: [piece({ id: -1, name: 'Empty', statsText: '', text: '', effects: [] }), piece({ id: 7, name: 'Steel Sword', delta: '+12 ATK' })], ...over });

test('a closed slot shows the current piece and its description, no choices', () => {
  const html = slot();
  assert.match(html, /Iron Sword/);
  assert.match(html, /A plain blade\./);
  assert.match(html, /Keen/);
  assert.match(html, /data-open-slot="weapon"/);
  assert.doesNotMatch(html, /data-pick-slot/);
});

test('an open slot lists one pick button per choice, including Empty (-1)', () => {
  const html = slot({ open: true });
  assert.equal([...html.matchAll(/data-pick-slot="weapon"/g)].length, 2);
  assert.match(html, /data-id="-1"/);
  assert.match(html, /data-id="7"/);
  assert.match(html, /\+12 ATK/);
});

test('the lock button reflects locked', () => {
  assert.match(slot({ locked: true }), /data-lock="weapon"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-lock="weapon"/);
  assert.match(slot(), /aria-pressed="false"/);
});

test('catalog text is escaped', () => {
  const html = slot({ current: piece({ name: '<u>x</u>', text: '<u>y</u>' }) });
  assert.doesNotMatch(html, /<u>/);
  assert.match(html, /&#60;u&#62;x/);
});

test('a choice without text renders no empty paragraph', () => {
  assert.doesNotMatch(slot({ open: true }), /<p[^>]*><\/p>/);
});

import { renderAbilityList } from '../docs/slot-ui.js';
const ab = (id, name, text = '') => ({ id, name, kind: 'active', cost: 10, text });
const abilityList = (over = {}) => renderAbilityList({ abilities: [ab(2, 'Fira', 'Burns.'), ab(3, 'Cure')], equippedIds: [3], load: { used: 10, budget: 30, slots: 1, maxSlots: 3 }, lockedIds: [], reasons: {}, ...over });

test('ability list shows the AP and slot line', () => {
  assert.match(abilityList(), /10 \/ 30 AP/);
  assert.match(abilityList(), /1 \/ 3 slots/);
});
test('an unaffordable ability is disabled with its reason', () => {
  const html = abilityList({ reasons: { 2: 'Not enough AP (needs 20, 15 left).' } });
  assert.match(html, /<button[^>]*data-ability-toggle="2"[^>]*disabled/);
  assert.match(html, /Not enough AP \(needs 20, 15 left\)\./);
});
test('ability text is escaped', () => {
  const html = abilityList({ abilities: [ab(2, '<u>x</u>', '<u>y</u>')] });
  assert.doesNotMatch(html, /<u>/);
});
test('only equipped abilities get a lock button, and toggles name the ability', () => {
  const html = abilityList();
  assert.equal([...html.matchAll(/data-lock="skill:/g)].length, 1);
  assert.match(html, /data-lock="skill:3"/);
  assert.match(html, /aria-label="Remove Cure"/);
  assert.match(html, /aria-label="Equip Fira"/);
});

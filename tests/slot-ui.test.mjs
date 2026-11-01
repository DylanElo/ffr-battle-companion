import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSlot, renderPicker } from '../docs/slot-ui.js';

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

test('the picker lists choices, including Empty (-1), separately from the slot', () => {
  const html = renderPicker({ key: 'weapon', label: 'Weapon', current: piece(), choices: [piece({ id: -1, name: 'Empty', statsText: '', text: '', effects: [] }), piece({ id: 7, name: 'Steel Sword', delta: '+12 ATK' })] });
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

import { renderAbilityList, filterAvailableAbilities } from '../docs/slot-ui.js';
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

test('picker has a labelled dialog, search and current-piece marker', () => {
  const html = renderPicker({key: 'weapon', label: 'Weapon', current: piece(), choices: [piece(), piece({id: 7, name: '<script>x</script>'})]});
  assert.match(html, /<dialog[^>]*aria-labelledby="picker-title"/);
  assert.match(html, /type="search"/);
  assert.match(html, /data-close-picker/);
  assert.match(html, /data-id="5" aria-pressed="true"/);
  assert.match(html, /data-id="7" aria-pressed="false"/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(slot({open: true}), /data-pick-slot/);
});

test('empty slots cannot show a lock that the search would ignore', () => {
  const html = slot({current: piece({id: -1, name: 'Empty'}), locked: true});
  assert.match(html, /data-lock="weapon"[^>]*aria-pressed="false"[^>]*disabled/);
  assert.match(html, /Choose a piece before locking this slot/);
  assert.doesNotMatch(html, />Locked<\/button>/);
});

test('available ability filters combine text, kind and current equip constraints', () => {
  const abilities = [ab(1, 'Cure', 'Restore HP.'), ab(2, 'Regen', 'Restore HP over time.'),
    { ...ab(3, 'Healing boost', 'Restore more HP.'), kind: 'passive' },
    { ...ab(4, 'Healing mastery', 'Restore HP.'), kind: 'master' }, ab(5, 'Fira', 'Burns.')];
  const reasons = { 2: 'No free ability slots.' };
  assert.deepEqual(filterAvailableAbilities(abilities, [1], reasons, { q: ' RESTORE ', kind: 'active' }).map(a => a.id), [2]);
  assert.deepEqual(filterAvailableAbilities(abilities, [1], reasons, { q: 'restore', affordable: true }).map(a => a.id), [3, 4]);
  assert.deepEqual(filterAvailableAbilities(abilities, [1], reasons, { q: 'healing', kind: 'master' }).map(a => a.id), [4]);
  assert.deepEqual(filterAvailableAbilities(abilities, [1], reasons, { kind: 'all' }).map(a => a.id), [2, 3, 4, 5]);
});

test('filtering keeps equipped abilities and AP visible and explains empty matches', () => {
  const html = abilityList({ filters: { q: '<fire>', kind: 'passive', affordable: true } });
  assert.match(html, /aria-label="Remove Cure"/);
  assert.match(html, /10 \/ 30 AP/);
  assert.doesNotMatch(html, /data-ability-toggle="2"/);
  assert.match(html, /No abilities match these filters/);
  assert.match(html, /0 of 1 available abilities/);
  assert.match(html, /value="&#60;fire&#62;"/);
  assert.match(html, /<label>Search abilities<input[^>]*data-ability-filter="q"/);
  assert.match(html, /<option value="passive" selected>/);
  assert.match(html, /data-ability-filter="affordable" checked/);
});

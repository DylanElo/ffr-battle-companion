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

import { renderAbilityList, renderAbilityPicker, filterAvailableAbilities } from '../docs/slot-ui.js';
const ab = (id, name, text = '') => ({ id, name, kind: 'active', cost: 10, text });
const abilityState = { abilities: [ab(2, 'Fira', 'Burns.'), ab(3, 'Cure')], equippedIds: [3], load: { used: 10, budget: 30, slots: 1, maxSlots: 3 }, lockedIds: [], reasons: {}, filters: {} };
const abilityList = (over = {}) => renderAbilityList({ ...abilityState, ...over });
const abilityPicker = (over = {}) => renderAbilityPicker({ ...abilityState, slotIndex: 0, ...over });

test('ability grid shows the AP/slot meter and exactly the native number of cards', () => {
  const html = abilityList();
  assert.match(html, /10 \/ 30 AP/);
  assert.match(html, /1 \/ 3 slots/);
  assert.match(html, /class="ability-slot-grid"/);
  assert.equal([...html.matchAll(/class="slot ability-slot/g)].length, 3);
  for (const key of ['skill:0', 'skill:1', 'skill:2']) assert.ok(html.includes('data-open-slot="' + key + '"'));
  assert.equal([...html.matchAll(/<strong>Empty<\/strong>/g)].length, 2);
});

test('main ability grid contains no permanent catalog or legacy equip/remove toggles', () => {
  assert.doesNotMatch(abilityList(), /Fira|Available|ability-filters|data-ability-toggle|data-pick-ability/);
});

test('ability cards retain equipped order and preserve empty holes', () => {
  const html = abilityList({equippedIds: [3, -1, 2]});
  const cards = html.split('<section class="slot ability-slot').slice(1);
  assert.match(cards[0], /<strong>Cure<\/strong>/);
  assert.match(cards[1], /<strong>Empty<\/strong>/);
  assert.match(cards[1], /data-open-slot="skill:1"/);
  assert.doesNotMatch(cards[1], /data-lock=/);
  assert.match(cards[2], /<strong>Fira<\/strong>/);
  assert.match(cards[2], /data-open-slot="skill:2"/);
  assert.match(abilityPicker({equippedIds: [3, -1, 2], slotIndex: 2}), /data-pick-ability="2" aria-pressed="true"/);
  assert.match(abilityPicker({equippedIds: [3, -1, 2], slotIndex: 1}), /data-pick-ability="-1" aria-pressed="true"/);
});

test('only equipped ability slots have actionable locks; locked slots remain explicitly changeable', () => {
  const html = abilityList({lockedIds: [3], openSlot: 'skill:0'});
  assert.equal([...html.matchAll(/data-lock="skill:/g)].length, 1);
  assert.match(html, /data-lock="skill:3"[^>]*aria-pressed="true"/);
  assert.match(html, /data-open-slot="skill:0"[^>]*aria-expanded="true"/);
  assert.doesNotMatch(html, /data-open-slot="skill:0"[^>]*disabled/);
  assert.match(html, /aria-label="Change Ability 1 \(Cure\)"/);
  assert.match(abilityPicker({lockedIds: [3]}), /Locked for Build\. You can still change this slot\./);
});

test('ability catalog text and refusal reasons are escaped in grid and picker', () => {
  const html = abilityList({abilities: [ab(3, '<u>x</u>', '<u>y</u>')]});
  assert.doesNotMatch(html, /<u>/);
  assert.match(html, /&#60;u&#62;x/);
  const picker = abilityPicker({abilities: [ab(2, '<u>x</u>', '<u>y</u>')], reasons: {2: '<u>blocked</u>'}});
  assert.doesNotMatch(picker, /<u>/);
  assert.match(picker, /&#60;u&#62;blocked/);
});

test('ability picker is a labelled dialog with current, Empty and replacement choices', () => {
  const html = abilityPicker();
  assert.match(html, /<dialog[^>]*id="slot-picker"[^>]*aria-labelledby="picker-title"/);
  assert.match(html, /data-close-picker/);
  assert.match(html, /data-pick-ability="-1" aria-pressed="false"/);
  assert.match(html, /data-pick-ability="3" aria-pressed="true"/);
  assert.match(html, /data-pick-ability="2" aria-pressed="false"/);
  assert.doesNotMatch(html, /data-ability-toggle/);
});

test('ability picker excludes other equipped abilities and never blocks the current selection', () => {
  const html = abilityPicker({abilities: [ab(2, 'Fira'), ab(3, 'Cure'), ab(4, 'Blizzard')], equippedIds: [2, 3], slotIndex: 1, reasons: {3: 'No free ability slot.'}});
  assert.doesNotMatch(html, /data-pick-ability="2"/);
  assert.match(html, /data-pick-ability="3" aria-pressed="true"/);
  assert.doesNotMatch(html, /data-pick-ability="3"[^>]*disabled/);
  assert.doesNotMatch(html, /No free ability slot/);
  assert.match(html, /data-pick-ability="4"/);
});

test('unaffordable replacement abilities are disabled with the caller-provided reason', () => {
  const html = abilityPicker({reasons: {2: 'Not enough AP (needs 20, 15 left).'}});
  assert.match(html, /<button[^>]*data-pick-ability="2"[^>]*disabled/);
  assert.match(html, /Not enough AP \(needs 20, 15 left\)\./);
});

test('empty and zero-slot grids and unknown equipped abilities remain well formed', () => {
  const empty = abilityList({equippedIds: [], load: {used: 0, budget: 10, slots: 0, maxSlots: 2}});
  assert.equal([...empty.matchAll(/class="slot ability-slot/g)].length, 2);
  assert.doesNotMatch(empty, /data-lock=/);
  const zero = abilityList({equippedIds: [], load: {used: 0, budget: 10, slots: 0, maxSlots: 0}});
  assert.equal([...zero.matchAll(/class="slot ability-slot/g)].length, 0);
  assert.match(abilityList({equippedIds: [99]}), /Ability #99/);
  assert.doesNotMatch(abilityList({equippedIds: [99]}), /undefined|null/);
  assert.match(abilityPicker({equippedIds: [99]}), /data-pick-ability="99" aria-pressed="true"/);
  const picker = abilityPicker({slotIndex: 1});
  assert.match(picker, /data-pick-ability="-1" aria-pressed="true"/);
  assert.doesNotMatch(picker, /data-pick-ability="3"/);
});

test('picker filters retain current and Empty choices plus AP and explain an empty match', () => {
  const html = abilityPicker({filters: {q: '<fire>', kind: 'passive', affordable: true}});
  assert.match(html, /data-pick-ability="3" aria-pressed="true"/);
  assert.match(html, /data-pick-ability="-1"/);
  assert.match(html, /10 \/ 30 AP/);
  assert.doesNotMatch(html, /data-pick-ability="2"/);
  assert.match(html, /No abilities match these filters/);
  assert.match(html, /0 of 1 available abilities/);
  assert.match(html, /value="&#60;fire&#62;"/);
  assert.match(html, /<label>Search abilities<input[^>]*data-ability-filter="q"/);
  assert.match(html, /<option value="passive" selected>/);
  assert.match(html, /data-ability-filter="affordable" checked/);
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

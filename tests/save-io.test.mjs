import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as S from '../docs/save.js';
import { readSave, savedWithPlans, SAVE_CHANGED } from '../docs/save-io.js';

const require = createRequire(import.meta.url);
const core = require('../docs/core.js'), stats = require('../docs/stats.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../docs/data/catalog.json', import.meta.url), 'utf8'));
const deps = { catalog, core, stats };

// ---------- a minimal encrypted game save, written in the tagged-property layout save.js reads ----------

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};
const int = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
const fstr = s => { const b = new TextEncoder().encode(s + '\0'); return cat(int(b.length), b); };
const type = (name, ...children) => cat(fstr(name), int(children.length), ...children);
const prop = (name, t, payload, flags = 0) => cat(fstr(name), t, int(payload.length), Uint8Array.of(flags), payload);
const intProp = (name, v) => prop(name, type('IntProperty'), int(v));
const boolProp = (name, v) => prop(name, type('BoolProperty'), new Uint8Array(0), v ? 16 : 0);
const enumProp = (name, v) => prop(name, type('EnumProperty', type('Enum')), fstr(v));
const intList = (name, values) => prop(name, type('ArrayProperty', type('IntProperty')), cat(int(values.length), ...values.map(int)));
const structType = name => type('StructProperty', type(name, type('/Script/mucha')));
const struct = (name, kind, ...fields) => prop(name, structType(kind), cat(...fields, fstr('None')));
const structList = (name, kind, records) =>
  prop(name, type('ArrayProperty', structType(kind)), cat(int(records.length), ...records.map(r => cat(...r, fstr('None')))));
const intMap = (name, pairs) => prop(name, type('MapProperty', type('IntProperty'), type('IntProperty')),
  cat(int(0), int(pairs.length), ...pairs.flatMap(([k, v]) => [int(k), int(v)])));

const rain = catalog.characters.find(c => c.id === 1001), lasswell = catalog.characters.find(c => c.id === 1002);
const eligible = (who, slot) => catalog.equipment.filter(e => core.eligible(e, who, slot)).map(e => e.id);
const [sword, otherSword] = eligible(rain, 'weapon'), [katana] = eligible(lasswell, 'weapon');
const [ring, charm] = eligible(rain, 'accessory');
const [amelia, second] = catalog.visions.map(v => v.id);

function unit(id, { weaponId = -1, accessoryIds = [-1, -1], visionId = -1 } = {}) {
  return [intProp('UnitId', id), enumProp('JoinStatus', 'eUnitJoinStatus::Join'), boolProp('IsUsable', true),
    intProp('Experience', 200000), intProp('HitPoint', 100), intProp('MagicPoint', 50),
    intProp('EquipWeaponId', weaponId), intProp('EquipArmorId', -1), intList('EquipAccessoryIdList', accessoryIds),
    intProp('equipVisionId', visionId), intList('baseParameterList', Array(20).fill(0)),
    intList('equipSkillList', Array(8).fill(-1)), intList('activeSkillIdList', [])];
}

async function gameSave(money = 1000) {
  const body = cat(
    struct('Player', 'SaveData_Player', intProp('currentMoney', money), enumProp('GameDifficulty', 'EGameDifficulty::Normal')),
    struct('Party', 'SaveData_Party', intList('partyList', [1001, 1002, -1, -1])),
    structList('unitParameterList', 'SaveData_Unit', [
      unit(1001, { weaponId: sword, visionId: amelia }),
      unit(1002, { weaponId: katana, accessoryIds: [ring, -1], visionId: second })]),
    structList('inventory', 'SaveData_Inventory', [[sword, 1], [otherSword, 1], [katana, 1], [ring, 1], [charm, 1]]
      .map(([id, n]) => [intProp('ItemId', id), intProp('Num', n)])),
    structList('visionList', 'SaveData_Vision', [amelia, second]
      .map(id => [intProp('ID', id), intProp('awakeningPoint', 0), intMap('synchroPoints', [[1001, 0], [1002, 0]])])),
    fstr('None'));
  const gvas = cat(new TextEncoder().encode('GVAS'), int(3), new Uint8Array(18), fstr('++UE5+Release-5.4'), int(3), int(0),
    fstr('/Script/mucha.SaveGameData'), Uint8Array.of(0), body);
  // Native saves end with four zero bytes, then zero padding to the next 16-byte AES block.
  const data = new Uint8Array((Math.floor((gvas.length + 4) / 16) + 1) * 16);
  data.set(gvas);
  const header = cat(new TextEncoder().encode('SVHD'), int(0x10001), new Uint8Array(24));
  return S.encodeSave({ original: header, data }, data);
}

const asFile = bytes => new File([bytes], 'GameSaveData_0.sav', { lastModified: 0 });
const load = async bytes => readSave(asFile(bytes));
const character = (snapshot, id) => snapshot.characters.find(c => c.id === id);
const planFor = (snapshot, id, change) => ({ ...character(snapshot, id).equipment, ...change });

// ---------- tests ----------

test('an unchanged save re-encodes byte for byte', async () => {
  const file = await gameSave(), save = await S.openSave(file);
  assert.deepEqual(await S.encodeSave(save, save.data), file);
});

test('planned gear and Resonance read back from the written save', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const plan = planFor(snapshot, 1001, { weaponId: otherSword, accessoryIds: [charm, -1], visionId: second });
  const lasswell = planFor(snapshot, 1002, { visionId: amelia });
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: plan, 1002: lasswell }, deps);
  assert.deepEqual(character(await load(bytes), 1001).equipment, plan);
});

test('planned abilities are written into the skill slots', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const learned = stats.learned(catalog, snapshot, 1001, amelia).learnedActiveIds;
  const skill = learned.find(id => Number(catalog.skills.find(s => s.id === id)?.equipCost) > 0);
  const plan = { ...planFor(snapshot, 1001, {}), equippedSkillIds: [skill] };
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: plan }, deps);
  assert.equal(character(await load(bytes), 1001).equippedSkillIds[0], skill);
});

test('writing plans changes no field other than the equipment it was asked to change', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const plan = planFor(snapshot, 1001, { weaponId: otherSword });
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: plan }, deps);
  const before = S.parse((await S.openSave(file)).data), after = S.parse((await S.openSave(bytes)).data);
  const changed = after.filter((f, i) => f.path !== before[i].path || f.value !== before[i].value).map(f => f.path);
  assert.deepEqual(changed, ['unitParameterList[0].EquipWeaponId']);
});

test('a save that changed after loading is refused instead of losing its newer progress', async () => {
  const snapshot = await load(await gameSave(1000)), newer = await gameSave(2500);
  await assert.rejects(savedWithPlans(newer, snapshot, { 1001: planFor(snapshot, 1001, {}) }, deps), { message: SAVE_CHANGED });
});

test('plans cannot use more copies of an item than the save owns', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const plan = planFor(snapshot, 1001, { accessoryIds: [charm, charm] });
  await assert.rejects(savedWithPlans(file, snapshot, { 1001: plan }, deps), /2 times, but you own 1/);
});

test('two plans cannot use the same Resonance', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const plans = { 1001: planFor(snapshot, 1001, { visionId: second }), 1002: planFor(snapshot, 1002, {}) };
  await assert.rejects(savedWithPlans(file, snapshot, plans, deps), /both planned with/);
});

test('a character without a plan gives up an item a plan needs, and the change is reported', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const { bytes, removed } = await savedWithPlans(file, snapshot, { 1001: planFor(snapshot, 1001, { accessoryIds: [ring, -1] }) }, deps);
  assert.deepEqual({ removed, accessories: character(await load(bytes), 1002).equipment.accessoryIds },
    { removed: [`${lasswell.name}: ${catalog.equipment.find(e => e.id === ring).name}`], accessories: [-1, -1] });
});

// Fill the saved character's skill slots by writing a plan, then use that save as the starting point.
const costly = id => Number(catalog.skills.find(s => s.id === id)?.equipCost) > 0;
async function withSkill() {
  const file = await gameSave(), snapshot = await load(file);
  const skill = stats.learned(catalog, snapshot, 1001, amelia).learnedActiveIds.find(costly);
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: { ...planFor(snapshot, 1001, {}), equippedSkillIds: [skill] } }, deps);
  return { file: bytes, snapshot: await load(bytes), skill };
}

test('an abilities-only plan (same gear and Resonance) is written, including clearing them', async () => {
  const { file, snapshot, skill } = await withSkill();
  assert.deepEqual(character(snapshot, 1001).equippedSkillIds.filter(id => id > 0), [skill]);
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: { ...planFor(snapshot, 1001, {}), equippedSkillIds: [] } }, deps);
  assert.deepEqual(character(await load(bytes), 1001).equippedSkillIds.filter(id => id > 0), []);
});

test('a plan identical to the save writes nothing', async () => {
  const { file, snapshot } = await withSkill();
  const same = { ...planFor(snapshot, 1001, {}), equippedSkillIds: [...character(snapshot, 1001).equippedSkillIds.filter(id => id > 0)] };
  const { bytes } = await savedWithPlans(file, snapshot, { 1001: same }, deps);
  assert.deepEqual(bytes, file);
});

test('an abilities-only plan over the AP budget is refused', async () => {
  const file = await gameSave(), snapshot = await load(file);
  const skill = stats.learned(catalog, snapshot, 1001, amelia).learnedActiveIds.find(costly);
  const tight = { ...deps, stats: { ...stats, characterStats: (...args) => ({ ...stats.characterStats(...args), skillBudget: 0 }) } };
  await assert.rejects(savedWithPlans(file, snapshot, { 1001: { ...planFor(snapshot, 1001, {}), equippedSkillIds: [skill] } }, tight), /planned abilities don't fit/);
});

// Reading a save into a snapshot, and writing plans back into a copy of it. No DOM: runs in the browser and Node.
import * as S from './save.js?v=21';

export const SAVE_CHANGED = 'Your save changed after you loaded it (the game probably saved again). '
  + 'Load it again so your newer progress isn’t overwritten.';

/** Uppercase hex SHA-256, the same form the desktop importer records as snapshot.source.sha256. */
export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------- reading a save (same snapshot shape the desktop importer produced) ----------

export async function readSave(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const save = await S.openSave(bytes), fields = S.parse(save.data), by = new Map(fields.map(f => [f.path, f.value]));
  if (!by.has('Player.currentMoney')) throw new Error('That’s a settings file, not a game save. Pick a GameSaveData file.');
  const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const records = (root, key) => {
    const re = new RegExp(`^${rx(root)}\\[(\\d+)\\]\\.${key}$`);
    return [...new Set(fields.map(f => f.path.match(re)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  };
  const list = root => {
    const re = new RegExp(`^${rx(root)}\\[(\\d+)\\]$`);
    return fields.map(f => [f.path.match(re)?.[1], f.value]).filter(([i]) => i).sort((a, b) => a[0] - b[0]).map(([, v]) => Number(v));
  };
  const num = p => by.has(p) ? Number(by.get(p)) : null;
  return {
    schemaVersion: 1,
    source: { fileName: file.name, lastWriteUtc: new Date(file.lastModified).toISOString(), sha256: await sha256Hex(bytes) },
    party: list('Party.partyList'),
    inventory: records('inventory', 'ItemId').map(i => ({ id: num(`inventory[${i}].ItemId`), quantity: num(`inventory[${i}].Num`) })),
    characters: records('unitParameterList', 'UnitId').map(i => {
      const p = `unitParameterList[${i}].`;
      return {
        id: num(p + 'UnitId'), joinStatus: by.get(p + 'JoinStatus') ?? null, usable: by.get(p + 'IsUsable') ?? null,
        experience: num(p + 'Experience'), hp: num(p + 'HitPoint'), mp: num(p + 'MagicPoint'),
        equipment: { weaponId: num(p + 'EquipWeaponId'), armorId: num(p + 'EquipArmorId'), accessoryIds: list(p + 'EquipAccessoryIdList'), visionId: num(p + 'equipVisionId') },
        baseParameters: list(p + 'baseParameterList'), equippedSkillIds: list(p + 'equipSkillList'), activeSkillIds: list(p + 'activeSkillIdList'),
        rawFields: Object.fromEntries(fields.filter(f => f.path.startsWith(p)).map(f => [f.path.slice(p.length), f.value])),
      };
    }),
    resonances: records('visionList', 'ID').map(i => {
      const p = `visionList[${i}].`;
      return { id: num(p + 'ID'), awakeningPoints: num(p + 'awakeningPoint'),
        sync: records(p + 'synchroPoints', 'Key').map(j => ({ characterId: num(`${p}synchroPoints[${j}].Key`), points: num(`${p}synchroPoints[${j}].Value`) })),
        rawFields: Object.fromEntries(fields.filter(f => f.path.startsWith(p)).map(f => [f.path.slice(p.length), f.value])) };
    }),
    player: Object.fromEntries(fields.filter(f => f.path.startsWith('Player.')).map(f => [f.path.slice(7), f.value])),
    artifactOverrides: records('artifactList', 'Key').map(i => ({ id: num(`artifactList[${i}].Key`), active: by.get(`artifactList[${i}].Value.IsActive`) ?? null })),
  };
}

// ---------- writing plans into a copy of the save ----------

/**
 * Writes every plan's gear, Resonance and abilities into a copy of the save the snapshot was read from.
 * Only fixed-size ints change, so the file layout stays exactly the game's own.
 * `core` is Companion (core.js) and `stats` is CompanionStats (stats.js).
 */
export async function savedWithPlans(bytes, snap, plans, { catalog, core: C, stats }) {
  // Plans and stock checks come from the snapshot; writing them into a newer save would roll back its progress.
  if (await sha256Hex(bytes) !== snap.source?.sha256) throw new Error(SAVE_CHANGED);
  const index = Object.fromEntries(['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills']
    .map(kind => [kind, new Map((catalog[kind] || []).map(row => [row.id, row]))]));
  const name = (kind, id) => index[kind].get(Number(id))?.name ?? (Number(id) > 0 ? `New entry #${id}` : 'Empty');
  const people = snap.characters.filter(C.joined), inventory = snap.inventory;
  const save = await S.openSave(bytes);
  let data = save.data;
  const fields = S.parse(data), at = new Map(fields.map(f => [f.path, f]));
  const set = (path, value) => { const f = at.get(path); if (!f) throw new Error(`The save has no ${path}.`); data = S.writeField(data, f, value); };
  const have = new Map(inventory.map(i => [i.id, i.quantity])), used = new Map(), taken = new Map(), removed = [];
  // Some gear (Fina's Loxley Bow) exists only as equipped, with no inventory entry; it is still owned.
  const loose = new Map();
  for (const c of snap.characters) for (const item of C.equipmentIds(c.equipment).map(Number)) if (item > 0 && !inventory.some(i => i.id === item)) loose.set(item, (loose.get(item) || 0) + 1);
  for (const [item, n] of loose) have.set(item, n);
  const use = item => {
    const n = (used.get(item) || 0) + 1;
    if (n > (have.get(item) || 0)) throw new Error(`Your plans use ${name('equipment', item)} ${n} times, but you own ${have.get(item) || 0}.`);
    used.set(item, n);
  };
  for (const [id, plan] of Object.entries(plans)) {
    for (const item of C.equipmentIds(plan)) use(Number(item));
    const v = Number(plan.visionId);
    if (v > 0 && taken.has(v)) throw new Error(`${name('characters', taken.get(v))} and ${name('characters', id)} are both planned with ${name('visions', v)}.`);
    if (v > 0) taken.set(v, Number(id));
  }
  // Characters without a plan give up anything a plan needs, as the game's own equip screen would.
  const changes = { ...plans };
  for (const c of people) {
    if (plans[c.id]) continue;
    const e = c.equipment, keep = item => {
      if (!(Number(item) > 0)) return item;
      if ((used.get(Number(item)) || 0) < (have.get(Number(item)) || 0)) { use(Number(item)); return item; }
      removed.push(`${name('characters', c.id)}: ${name('equipment', item)}`); return -1;
    };
    const next = { weaponId: keep(e.weaponId), armorId: keep(e.armorId), accessoryIds: e.accessoryIds.map(keep), visionId: e.visionId };
    if (taken.has(Number(e.visionId))) { removed.push(`${name('characters', c.id)}: ${name('visions', e.visionId)}`); next.visionId = -1; }
    if (JSON.stringify(next) !== JSON.stringify({ ...e, accessoryIds: e.accessoryIds })) changes[c.id] = next;
  }
  const row = new Map(fields.filter(f => /^unitParameterList\[\d+\]\.UnitId$/.test(f.path)).map(f => [Number(f.value), f.path.slice(0, -'UnitId'.length)]));
  for (const [id, plan] of Object.entries(changes)) {
    const p = row.get(Number(id)), saved = people.find(c => c.id === Number(id));
    if (!p || !saved) continue;
    set(p + 'EquipWeaponId', plan.weaponId); set(p + 'EquipArmorId', plan.armorId); set(p + 'equipVisionId', plan.visionId);
    if (plan.accessoryIds.length !== saved.equipment.accessoryIds.length) throw new Error(`${name('characters', id)}'s plan has the wrong number of accessories.`);
    plan.accessoryIds.forEach((a, i) => set(`${p}EquipAccessoryIdList[${i}]`, a));
    const explicit = Array.isArray(plan.equippedSkillIds), wanted = (plan.equippedSkillIds || []).map(Number);
    // A plan that lists abilities is exact (an empty list clears them); one without keeps what is on while it still fits.
    const on = saved.equippedSkillIds.map(Number).filter(id => id > 0), want = wanted.filter(id => id > 0);
    const same = explicit ? want.length === on.length && want.every(id => on.includes(id)) : true;
    if (same && Number(plan.visionId) === Number(saved.equipment.visionId)) continue;
    // The plan's abilities first, then the ones already on, while they're learned and fit the slots and EquipCost budget.
    const cost = id => Number((index.skills.get(id) || index.passives.get(id) || index.masterSkills.get(id))?.equipCost || 0);
    const learn = stats.learned(catalog, snap, saved.id, plan.visionId), known = new Set([...learn.learnedPassiveIds, ...learn.learnedActiveIds, ...learn.masterSkillIds]);
    const budget = Number(stats.characterStats(catalog, snap, saved.id, plan).skillBudget), slots = saved.equippedSkillIds.length;
    const skills = [];
    let spent = 0;
    for (const id of (explicit ? wanted : [...wanted, ...saved.equippedSkillIds]).map(Number)) {
      if (!(id > 0) || skills.includes(id) || skills.length >= slots || spent + cost(id) > budget) continue;
      if (!wanted.includes(id) && !known.has(id)) continue;
      skills.push(id); spent += cost(id);
    }
    if (wanted.some(id => !skills.includes(id))) throw new Error(`${name('characters', id)}'s planned abilities don't fit its slots.`);
    for (let i = 0; i < slots; i++) set(`${p}equipSkillList[${i}]`, skills[i] ?? -1);
  }
  return { bytes: await S.encodeSave(save, data), removed };
}

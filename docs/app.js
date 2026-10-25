import * as S from './save.js';
import {createOptimizerController} from './optimizer-controller.js';

const C = globalThis.Companion;
const $ = s => document.querySelector(s);
const h = v => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ELEMENTS = ['Fire', 'Ice', 'Wind', 'Earth', 'Thunder', 'Water', 'Light', 'Dark'];
const EMPTY = { inventory: [], characters: [], resonances: [], party: [] };
const VIEWS = [['fight', 'Fight'], ['characters', 'Characters'], ['resonances', 'Resonances']];

let catalog, index = {}, snapshot = EMPTY, plans = {}, draft = null, view = 'fight';
const ui = { kitId: 0, enemyQ: '', bossOnly: true, enemyId: 0, perspective: 0, charId: 0, prio: {}, prioOpen: false, pickVision: true, visionWhy: '', visionAlts: [],
  reserve: true, kitQ: '', ownedOnly: true, gearQ: '', fightTab: 'resonances', charTab: 'effects' };

const name = (kind, id) => index[kind]?.get(Number(id))?.name ?? (Number(id) > 0 ? `Unknown #${id}` : 'Empty');
const owned = id => snapshot.resonances.find(r => r.id === Number(id));
const recruited = () => snapshot.characters.filter(C.joined).filter(c => index.characters.has(c.id));
const hasSave = () => snapshot !== EMPTY;
const el = (e, extra = '') => `<span class="el ${h(C.clean(e))}">${h(C.clean(e))}${extra}</span>`;
const statsText = item => Object.entries(item?.stats || {}).map(([k, v]) => `${C.statLabels[k] || k} ${v > 0 ? '+' : ''}${v}`).join(', ') || 'no stats';
const pretty = s => C.clean(s).replace('Sowrd', 'Sword').replace(/([a-z])([A-Z])/g, '$1 $2');
const opt = (value, text, selected) => `<option value="${h(value)}" ${selected ? 'selected' : ''}>${h(text)}</option>`;
// Portraits are the game's own face icons (img/), named unit<id>, summon<id> and mons<FaceIconId>.
let faces = {};
const img = (file, size = '') => file ? `<img class="face ${size}" src="img/${file}.webp" alt="" width="128" height="128" decoding="async">` : '';
const enemyFace = (id, size) => img(faces[id], size);
const charFace = (id, size) => index.characters?.has(Number(id)) ? img(`unit${id}`, size) : '';
const visionFace = (id, size) => index.visions?.has(Number(id)) ? img(`summon${id}`, size) : '';

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 3000);
}
function error(text = '') { $('#error').textContent = text; $('#error').hidden = !text; }

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
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return {
    schemaVersion: 1,
    source: { fileName: file.name, lastWriteUtc: new Date(file.lastModified).toISOString(), sha256: [...digest].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase() },
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

async function loadSave(file) {
  error();
  await ready;
  let parsed;
  try { parsed = await readSave(file); }
  catch (e) { return error(e.message); }
  loadSnapshot(parsed);
}

// Shared with the read-only desktop importer; the public site still reads uploaded files in the browser.
export function loadSnapshot(parsed) {
  if(parsed.schemaVersion!==1 || !parsed.source?.sha256 || !Array.isArray(parsed.characters) || !Array.isArray(parsed.inventory) || !Array.isArray(parsed.resonances))throw new Error('Unsupported inventory snapshot.');
  optimizerController.cancel();snapshot=parsed;
  try { plans = JSON.parse(localStorage.getItem('ffr-companion-plans:' + snapshot.source.sha256)) || {}; } catch { plans = {}; }
  const people = recruited(), first = snapshot.party.find(id => people.some(c => c.id === id)) ?? people[0]?.id ?? 0;
  ui.charId = ui.perspective = first; ui.ownedOnly = true;
  setDraft();
  render();
  toast(`Loaded ${snapshot.source.fileName}`);
}

function storePlans() {
  try { localStorage.setItem('ffr-companion-plans:' + snapshot.source.sha256, JSON.stringify(plans)); }
  catch { toast('This browser won’t store plans. Export them to keep them.'); }
}
function setDraft() {
  const saved = snapshot.characters.find(c => c.id === ui.charId);
  draft = structuredClone(plans[ui.charId] || saved?.equipment || null);
}

// ---------- shared bits ----------

function skillItem(s, got = false) {
  if (!s) return '';
  const meta = [s.dmgType !== 'None' && s.dmgType, C.clean(s.element) !== 'None' && C.clean(s.element), s.target, s.cost && `${s.cost} MP`, s.mag && `power ${s.mag}`].filter(Boolean).join(', ');
  return `<li class="${got ? 'got' : ''}"><b>${h(s.name)}</b> ${meta ? `<span class="meta">${h(meta)}</span>` : ''}${s.desc ? `<p>${h(s.desc)}</p>` : ''}</li>`;
}
const grantName = r => r.type === 'ActiveSkill' ? name('skills', r.id) : r.type === 'PassiveSkill' ? name('passives', r.id) : `${r.type} #${r.id}`;
const grantDesc = r => (r.type === 'ActiveSkill' ? index.skills : index.passives).get(r.id)?.desc ?? '';
const perspectivePicker = id => `<label class="check">Mastery for <select id="${id}">${recruited().map(c => opt(c.id, name('characters', c.id), c.id === ui.perspective)).join('')}</select></label>`;
// Browsers can't open a folder by path, so show it with a Copy button. Keep the plain file input:
// Chrome's showOpenFilePicker refuses AppData ("contains system files"), which is where saves live.
const SAVE_DIR = '%LOCALAPPDATA%\\FFRS\\Steam';
const whereHelp = `<details class="where"><summary>Where is my save?</summary><div>
  <p>Click <b>Copy</b>, then in the file window paste into the address bar at the top and press Enter:</p>
  <div class="path"><code>${SAVE_DIR}</code><button type="button" data-copy-path>Copy</button></div>
  <p class="dim small">Open the numbered folder inside and pick a <b>GameSaveData</b> file. The most recently modified one is your latest save. Next time, the file window usually reopens in this folder.</p>
</div></details>`;
const loadPrompt = text => `<div class="empty"><p class="dim">${text}</p><label class="load"><input type="file" accept=".sav" data-pick><span>Load your save</span></label>${whereHelp}</div>`;

const tabs = (key, items) => `<div class="tabs" role="tablist">${items.map(([id, label]) =>
  `<button type="button" role="tab" data-tab="${key}:${id}" aria-selected="${ui[key] === id}">${label}</button>`).join('')}</div>`;

// ---------- fight: who to bring against an enemy ----------

function fight() {
  const q = ui.enemyQ.trim().toLowerCase();
  const list = catalog.enemies.filter(e => (!ui.bossOnly || e.isBoss) && `${e.name} ${e.id}`.toLowerCase().includes(q))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!list.some(e => e.id === ui.enemyId)) ui.enemyId = list[0]?.id ?? 0;
  const enemy = index.enemies.get(ui.enemyId);
  if (enemy) optimizerController.setEnemy(enemy.id);
  return `<div class="split">
    <section class="window" aria-label="Choose an enemy">
      <input type="search" id="enemy-q" data-key="enemy-q" placeholder="Search enemies" value="${h(ui.enemyQ)}" aria-label="Search enemies">
      <label class="check"><input type="checkbox" id="boss-only" ${ui.bossOnly ? 'checked' : ''}> Bosses only</label>
      <ul class="pick" role="listbox" aria-label="Enemies">${list.map(e => `<li role="option" tabindex="0" data-enemy="${e.id}" data-key="e${e.id}" aria-selected="${e.id === ui.enemyId}">${enemyFace(e.id, 'sm')}<span>${h(e.name)}</span><small>Lv ${e.level}</small></li>`).join('') || '<li class="dim">No enemies match.</li>'}</ul>
    </section>
    ${enemy ? `<div class="stack">
      <section class="window">${bossCard(enemy)}</section>
      <section class="window"><h3>Best party</h3>${hasSave() ? optimizerController.render() : loadPrompt('Load your save to find the best party of four you can field against this enemy.')}</section>
      <section class="window">${fightDetails(enemy)}</section>
    </div>` : '<section class="window"><p class="dim">No enemy selected.</p></section>'}
  </div>`;
}

const enemyRes = enemy => Object.entries(enemy.resistances || {}).map(([e, r]) => [C.clean(e), C.clean(r)]);

function bossCard(enemy) {
  const res = enemyRes(enemy), weak = res.filter(([, r]) => r === 'Weakness').map(([e]) => e);
  const resist = res.filter(([, r]) => r !== 'None' && r !== 'Weakness');
  const threats = [...new Set(enemy.skillIds.map(id => index.skills.get(id)).filter(Boolean).map(s => C.clean(s.element)).filter(e => ELEMENTS.includes(e)))];
  const stats = Object.entries(enemy.stats || {}).filter(([k]) => ['MaxHitPoint', 'Attack', 'Intelligence', 'Defence', 'Mind', 'MaxBreakPoint'].includes(k))
    .map(([k, v]) => `<span>${h(k === 'MaxBreakPoint' ? 'Break' : C.statLabels[k] || k)}<b>${v.toLocaleString()}</b></span>`).join('');
  return `<div class="hero">${enemyFace(enemy.id, 'lg')}<div>
    <h2>${h(enemy.name)}</h2>
    <p class="sub">Level ${enemy.level}${enemy.isBoss ? ', boss' : ''}</p>
    <div class="weak-line">
      <span>Weak to</span><div class="els">${weak.map(e => el(e)).join('') || '<span class="dim">Nothing</span>'}</div>
      ${resist.length ? `<span>Resists</span><div class="els">${resist.map(([e, r]) => el(e, ` <span class="dim">${h(r)}</span>`)).join('')}</div>` : ''}
      ${threats.length ? `<span>Attacks with</span><div class="els">${threats.map(e => el(e)).join('')}</div>` : ''}
    </div>
    <div class="statline">${stats}</div>
  </div></div>`;
}

function fightDetails(enemy) {
  const weak = enemyRes(enemy).filter(([, r]) => r === 'Weakness').map(([e]) => e);
  const actions = enemy.skillIds.map(id => index.skills.get(id)).filter(Boolean);
  let body;
  if (ui.fightTab === 'skills') body = `<ul class="skills">${actions.map(s => skillItem(s)).join('') || '<li class="dim">No known skills.</li>'}</ul>`;
  else if (ui.fightTab === 'status') body = `<div class="statline">${Object.entries(enemy.statusResistances || {}).map(([k, v]) => `<span>${h(k)}<b>${v}</b></span>`).join('')}</div>`;
  else if (hasSave()) {
    const rows = C.encounterOptions(catalog, snapshot, enemy, ui.perspective).filter(r => r.matches.length);
    body = `<div class="row-head"><p class="dim small">Your Resonances with unlocked skills it’s weak to.</p>${perspectivePicker('perspective')}</div>
      <ul class="rows">${rows.map(r => `<li class="match">${visionFace(r.vision.id, 'md')}
        <div class="row-head"><h4>${h(r.vision.name)}</h4><span class="dim small">${h(r.vision.roles.join(', '))}</span></div>
        <p class="good small">${h(r.matches.map(s => s.name).join(', '))}</p>
        <div><button type="button" class="ghost" data-plan="${r.vision.id}">Gear ${h(name('characters', ui.perspective))} with ${h(r.vision.name)}</button></div>
      </li>`).join('') || `<li class="dim">${weak.length ? 'None of your unlocked skills hit its weakness yet.' : 'It has no elemental weakness.'}</li>`}</ul>`;
  } else {
    const hitters = catalog.visions.filter(v => v.skillIds.some(id => {
      const s = index.skills.get(id); return s && weak.includes(C.clean(s.element)) && Number(s.mag) > 0 && s.relation === 'Enemies';
    }));
    body = hitters.length ? `<ul class="gallery inline">${hitters.map(v => `<li data-kit="${v.id}" tabindex="0">${visionFace(v.id)}${h(v.name)}</li>`).join('')}</ul>`
      : `<p class="dim">${weak.length ? 'No Resonance has skills of that element.' : 'It has no elemental weakness.'}</p>`;
  }
  return `${tabs('fightTab', [['resonances', 'Resonances for this fight'], ['skills', `Its skills (${actions.length})`], ['status', 'Status resistances']])}${body}`;
}

// ---------- gear ----------

const PRIORITY_LABELS = { PhysicalAttack: 'Attack', MagicalAttack: 'Magic', PhysicalDefense: 'Defence', MagicalDefense: 'Magic defence', HitPoint: 'HP', Agility: 'Speed', Divine: 'Divine', MagicPoint: 'MP' };
// Everything the character can use with the planned Resonance: their own abilities, level and sync
// unlocks, and the Resonance's grants (same source the party optimizer uses).
function usableSkills(visionId) {
  try {
    const l = globalThis.CompanionStats.learned(catalog, snapshot, ui.charId, visionId);
    return [...new Set([...l.freeActiveIds, ...l.learnedActiveIds])].map(id => index.skills.get(id)).filter(Boolean);
  } catch { return []; }
}
// "Find the best loadout": choose the Resonance first (unless the player chose one), then gear for
// the priorities. If the priorities are the suggestion, re-suggest them for the new Resonance's kit.
function findBest() {
  if (ui.pickVision) {
    const own = new Set(usableSkills(-1).map(s => s.id)), healer = (index.characters.get(ui.charId)?.roles || []).map(C.clean).includes('Healer');
    const keys = gearPriorities().keys;
    // Same rule as validPlan: one Resonance per character, counting others' plans and (if reserving) their saved gear.
    const taken = new Set(snapshot.characters.filter(c => c.id !== ui.charId && C.joined(c))
      .map(c => (plans[c.id] || (ui.reserve ? c.equipment : null))?.visionId).filter(id => id > 0));
    // Ties keep the current Resonance instead of an arbitrary swap.
    const ranked = snapshot.resonances.filter(r => !taken.has(r.id))
      .map(r => ({ id: r.id, ...C.resonanceFit(usableSkills(r.id).filter(s => !own.has(s.id)), keys, healer) }))
      .sort((a, b) => b.fit - a.fit || (b.id === Number(draft.visionId)) - (a.id === Number(draft.visionId)));
    const best = ranked[0];
    // Fit only measures attack power, so offer the runners-up (with their roles) for a player's call.
    ui.visionAlts = ranked.slice(1, 4).filter(r => r.fit > 0);
    if (best) {
      draft.visionId = best.id;
      ui.visionWhy = best.fit > 0 ? `${name('visions', best.id)} adds the most ${keys.filter(k => k.endsWith('Attack')).map(k => PRIORITY_LABELS[k]).join(' and ')} power you’ve unlocked for ${name('characters', ui.charId)} (${best.attacks} attack${best.attacks === 1 ? '' : 's'}).`
        : `None of your free Resonances add unlocked skills for these stats yet, so ${name('visions', best.id)} stays.`;
    }
  }
  const goal = C.priorityGoal(catalog, gearPriorities().keys);
  draft = { ...C.recommend(catalog, snapshot, ui.charId, goal, plans, ui.reserve), visionId: draft.visionId };
}

function gearPriorities() {
  const kitVision = index.visions.get(Number(draft?.visionId));
  const profile = C.kitProfile(usableSkills(kitVision?.id ?? -1), index.characters.get(ui.charId));
  return { kitVision, profile, keys: ui.prio[ui.charId] ?? profile.keys };
}

// The stats shown on the character card, in the game's order.
const CARD_STATS = [['PhysicalAttack', 'ATK'], ['MagicalAttack', 'MAG'], ['PhysicalDefense', 'DEF'], ['MagicalDefense', 'MDEF'], ['HitPoint', 'HP'], ['MagicPoint', 'MP'], ['Agility', 'SPD'], ['Divine', 'Divine']];
// Real totals (base, level, sync and gear) when the stat model can run; equipment bonuses otherwise.
function totals(equipment) {
  try { const r = globalThis.CompanionStats.characterStats(catalog, snapshot, ui.charId, equipment); return { stats: r.stats, level: r.level }; }
  catch { return { stats: C.stats(C.equipmentIds(equipment).map(id => index.equipment.get(id))), level: null }; }
}

function characters() {
  if (!hasSave()) return `<section class="window"><h2>Characters</h2>${loadPrompt('Load your save to see your characters and find the best gear and Resonance for each.')}</section>`;
  const people = recruited(), saved = snapshot.characters.find(c => c.id === ui.charId), native = index.characters.get(ui.charId);
  const roster = `<section class="window roster" aria-label="Characters">
    <ul class="pick" role="listbox" aria-label="Characters">${people.map(c => `<li role="option" tabindex="0" data-char="${c.id}" data-key="c${c.id}" aria-selected="${c.id === ui.charId}">${charFace(c.id, 'sm')}<span>${h(name('characters', c.id))}</span>
      ${plans[c.id] ? '<i class="plan-dot" title="Has a gear plan"></i>' : ''}<small>${snapshot.party.includes(c.id) ? 'Party' : ''}</small></li>`).join('')}</ul>
    ${Object.keys(plans).length ? '<p class="dim small"><i class="plan-dot"></i> has a gear plan</p>' : ''}
    <label class="check"><input type="checkbox" id="reserve" ${ui.reserve ? 'checked' : ''}> Don’t take others’ gear</label>
    ${Object.keys(plans).length ? '<button type="button" class="ghost" id="export">Export plans</button>' : ''}
  </section>`;
  if (!saved || !native || !draft) return `<div class="chars">${roster}<section class="window"><p class="dim">Nobody in this save can equip gear yet.</p></section></div>`;

  // What to gear for: suggested from the character's usable skills and role, until the player picks.
  const { kitVision, profile, keys } = gearPriorities(), goal = C.priorityGoal(catalog, keys);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const why = profile.physicalShare === null ? `No damage skills unlocked${kitVision ? ` with ${kitVision.name}` : ''}, so this follows base stats.`
    : `${plural(profile.damageSkills, 'damage skill')}${profile.healSkills ? ` and ${plural(profile.healSkills, 'heal')}` : ''}${kitVision ? ` with ${kitVision.name}` : ''}, ${Math.round(profile.physicalShare * 100)}% physical.${profile.roles.length ? ` ${profile.roles.join(', ')}.` : ''}`;

  const before = totals(saved.equipment), after = totals(draft);
  const statRows = CARD_STATS.map(([k, label]) => {
    const a = Number(after.stats[k]) || 0, d = a - (Number(before.stats[k]) || 0);
    return `<div class="${keys.includes(k) ? 'focus' : ''}"><dt>${label}</dt><dd>${a.toLocaleString()}${d ? `<em class="${d > 0 ? 'good' : 'bad'}">${d > 0 ? '+' : ''}${d}</em>` : ''}</dd></div>`;
  }).join('');

  const card = `<section class="window card">
    <div class="card-head">${charFace(native.id, 'lg')}<div>
      <h2>${h(native.name)}</h2>
      <p class="sub">${after.level ? `Level ${after.level} · ` : ''}${h(pretty(native.weaponType))}</p>
    </div></div>
    <dl class="card-stats">${statRows}</dl>
    <div class="gear-for">
      <span class="dim small">Gear for</span>
      ${ui.prioOpen
        ? `<div class="chips" role="group" aria-label="Stats to prioritise">${C.priorityStats.map(k => `<button type="button" class="chip" data-prio="${k}" aria-pressed="${keys.includes(k)}"
            ${k === 'Divine' ? 'title="Spirit raises Divine. What Divine does in battle hasn’t been confirmed yet."' : ''}>${PRIORITY_LABELS[k]}</button>`).join('')}</div>
          <p class="dim small">${ui.prio[ui.charId] ? `<button type="button" class="ghost" data-prio-reset>Back to the suggestion</button>` : `Suggested from ${h(why)}`}</p>
          <button type="button" class="ghost" data-prio-open>Done</button>`
        : `<button type="button" class="goal" data-prio-open title="Change">${keys.map(k => `<span>${PRIORITY_LABELS[k]}</span>`).join('') || '<span>Pick stats</span>'}</button>`}
    </div>
    <div class="toolbar">
      <button type="button" class="primary" id="best" ${keys.length ? '' : 'disabled'}>Optimize</button>
      <button type="button" id="saved-gear">Reset</button>
    </div>
  </section>`;

  const available = C.stock(snapshot, ui.charId, plans, ui.reserve);
  const savedIds = [saved.equipment.weaponId, saved.equipment.armorId, ...saved.equipment.accessoryIds];
  const slotRows = [['weapon', 'Weapon', draft.weaponId], ['armor', 'Armor', draft.armorId], ...draft.accessoryIds.map((id, i) => ['accessory', `Accessory ${i + 1}`, id, i])]
    .map(([slot, label, id, i = 0], n) => {
      const list = C.candidates(catalog, native, available, slot, goal), cur = Number(id);
      return `<label for="slot${n}">${label}</label><select id="slot${n}" data-slot="${slot}" data-index="${i}" data-key="slot${n}" class="${cur !== Number(savedIds[n]) ? 'changed' : ''}">
        ${opt(-1, 'Empty', cur <= 0)}${cur > 0 && !list.some(x => x.id === cur) ? opt(cur, `${name('equipment', cur)} (equipped)`, true) : ''}
        ${list.map(x => opt(x.id, `${x.name}: ${statsText(x)}${available.get(x.id) > 1 ? ` (${available.get(x.id)} free)` : ''}`, x.id === cur)).join('')}</select>`;
    }).join('');
  const v = index.visions.get(Number(draft.visionId));
  const warning = C.validPlan(catalog, snapshot, ui.charId, draft, plans, ui.reserve);
  const isPlan = plans[ui.charId] && JSON.stringify(draft) === JSON.stringify(plans[ui.charId]);
  const changed = JSON.stringify(draft) !== JSON.stringify(plans[ui.charId] || saved.equipment);

  const equip = `<section class="window equip">
    <div class="vision-slot">${v ? visionFace(v.id, 'md') : '<span class="face md empty"></span>'}
      <div><label for="vision" class="dim small">Resonance</label>
        <select id="vision" data-key="vision" class="${Number(draft.visionId) !== Number(saved.equipment.visionId) ? 'changed' : ''}">${opt(-1, 'None', Number(draft.visionId) <= 0)}${snapshot.resonances.map(r => opt(r.id, name('visions', r.id), r.id === Number(draft.visionId))).join('')}</select>
        <label class="check small"><input type="checkbox" id="pick-vision" ${ui.pickVision ? 'checked' : ''}> Optimize picks it</label></div></div>
    ${ui.visionWhy ? `<div class="vision-why"><p class="small">${h(ui.visionWhy)}</p>
      ${ui.visionAlts.length ? `<div class="chips alts">${ui.visionAlts.map(a => `<button type="button" class="chip" data-use-vision="${a.id}">${visionFace(a.id, 'sm')}${h(name('visions', a.id))} <span class="dim">${h(index.visions.get(a.id).roles.join(', '))}</span></button>`).join('')}</div>` : ''}</div>` : ''}
    <div class="slots">${slotRows}</div>
    ${warning ? `<p class="note">${h(warning)}</p>` : ''}
    <div class="toolbar">
      ${isPlan ? `<span class="planned">Planned</span><button type="button" class="ghost" data-release="${ui.charId}">Remove plan</button>`
        : `<button type="button" id="keep" ${warning || !changed ? 'disabled' : ''}>Keep as plan</button>`}
    </div>
    ${equipTabs(native, v, available)}
  </section>`;
  return `<div class="chars">${roster}${card}${equip}</div>`;
}

function equipTabs(native, v, available) {
  const passiveIds = [...new Set(C.equipmentIds(draft).flatMap(id => index.equipment.get(id)?.passiveIds || []))];
  const unlocked = v ? C.accessibleSkills(v, owned(v.id), ui.charId, catalog) : [];
  const term = ui.gearQ.trim().toLowerCase();
  const inv = snapshot.inventory.map(o => [o, index.equipment.get(o.id)]).filter(([o, e]) => e && o.quantity > 0
    && (!term || `${e.name} ${e.detailType} ${(e.passiveIds || []).map(id => name('passives', id)).join(' ')}`.toLowerCase().includes(term)));
  let body;
  if (ui.charTab === 'skills') body = v ? `<ul class="skills">${unlocked.map(s => skillItem(s, true)).join('') || '<li class="dim">Nothing unlocked yet.</li>'}</ul>` : '<p class="dim">No Resonance equipped.</p>';
  else if (ui.charTab === 'items') body = `<input type="search" id="gear-q" data-key="gear-q" placeholder="Search equipment or effects" value="${h(ui.gearQ)}" aria-label="Search equipment">
    <table><thead><tr><th>Item</th><th>Free</th><th>Stats</th></tr></thead><tbody>
    ${inv.map(([o, e]) => `<tr class="${['weapon', 'armor', 'accessory'].some(s => C.eligible(e, native, s)) ? '' : 'dim'}"><td>${h(e.name)}</td><td>${available.get(e.id) || 0}/${o.quantity}</td><td>${h(statsText(e))}</td></tr>`).join('')}
    </tbody></table>`;
  else body = `<ul class="skills">${passiveIds.map(id => `<li><b>${h(name('passives', id))}</b><p>${h(index.passives.get(id)?.desc ?? '')}</p></li>`).join('') || '<li class="dim">This gear has no special effects.</li>'}</ul>
    ${passiveIds.length ? '<p class="dim small">Effects aren’t scored by Optimize. Check them before swapping.</p>' : ''}`;
  return `${tabs('charTab', [['effects', `Gear effects (${passiveIds.length})`], ['skills', v ? `${v.name} skills (${unlocked.length})` : 'Resonance skills'], ['items', `All equipment (${inv.length})`]])}${body}`;
}

// ---------- resonances ----------

function resonances() {
  const q = ui.kitQ.trim().toLowerCase(), mine = hasSave() && ui.ownedOnly;
  const text = v => `${v.name} ${v.roles.join(' ')} ${v.skillIds.map(id => { const s = index.skills.get(id); return `${s?.name} ${s?.desc} ${s?.element}`; }).join(' ')} ${v.passiveIds.map(id => name('passives', id)).join(' ')}`.toLowerCase();
  const list = catalog.visions.filter(v => (!mine || owned(v.id)) && (!q || text(v).includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.some(v => v.id === ui.kitId)) ui.kitId = list[0]?.id ?? 0;
  const tierOf = id => catalog.legacyTiers.find(t => t.id === id)?.impact;
  return `<div class="split">
    <section class="window" aria-label="Choose a Resonance">
      <input type="search" id="kit-q" data-key="kit-q" placeholder="Search names, roles, skills or effects" value="${h(ui.kitQ)}" aria-label="Search Resonances">
      ${hasSave() ? `<label class="check"><input type="checkbox" id="owned-only" ${ui.ownedOnly ? 'checked' : ''}> Only mine</label>` : ''}
      <ul class="gallery" role="listbox" aria-label="Resonances">${list.map(v => `<li role="option" tabindex="0" data-kit="${v.id}" data-key="k${v.id}" aria-selected="${v.id === ui.kitId}" class="${hasSave() && !owned(v.id) ? 'notmine' : ''}">
        ${tierOf(v.id) ? `<span class="tier ${h(tierOf(v.id))}">${h(tierOf(v.id))}</span>` : ''}${visionFace(v.id)}${h(v.name)}</li>`).join('')
        || `<li class="dim">Nothing matches.${mine ? ' Turn off “Only mine” to see all.' : ''}</li>`}</ul>
    </section>
    <section class="window">${index.visions.get(ui.kitId) ? kit(index.visions.get(ui.kitId)) : '<p class="dim">Pick a Resonance.</p>'}</section>
  </div>`;
}

function kit(v) {
  const o = owned(v.id), m = C.mastery(v, o, ui.perspective), tier = catalog.legacyTiers.find(t => t.id === v.id);
  const next = o && m.rows.filter(r => !r.reached && r.kind === 'Sync').sort((a, b) => a.required - b.required)[0];
  const stages = kind => `<details ${kind === 'Sync' && o ? 'open' : ''}><summary>${kind} unlocks</summary><ul class="skills">${m.rows.filter(r => r.kind === kind).map(r => `<li class="${r.reached ? 'got' : ''}">
    <b>${h(grantName(r))}</b> <span class="meta">at ${r.required} points${o ? (r.reached ? ', unlocked' : '') : ''}</span>${grantDesc(r) ? `<p>${h(grantDesc(r))}</p>` : ''}</li>`).join('')}</ul></details>`;
  return `<div class="hero">${visionFace(v.id, 'lg')}<div>
      <h2>${h(v.name)} ${tier ? `<span class="tier ${h(tier.impact)}" title="Impact tier">${h(tier.impact)}</span>` : ''}</h2>
      <p class="sub">${h(v.roles.join(', '))}, ${C.clean(v.attackType) === 'Magic' ? 'magic' : 'physical'} damage</p>
      ${o ? `<p class="small"><span class="owned">Yours.</span> Awakening ${m.awake}, ${h(name('characters', ui.perspective))}’s sync ${m.sync}.${next ? ` Next unlock at ${next.required} sync: ${h(grantName(next))}.` : ''}</p>` : hasSave() ? '<p class="dim small">Not in your save yet.</p>' : ''}
      ${o ? perspectivePicker('kit-perspective') : ''}
    </div></div>
    <h3>Finisher</h3><ul class="skills">${skillItem(index.skills.get(v.finishBlow))}</ul>
    ${stages('Awakening')}${stages('Sync')}`;
}

// ---------- about ----------

function about() {
  const tiers = ['S', 'A', 'B', 'C'].map(t => [t, catalog.legacyTiers.filter(v => v.impact === t)]);
  return `<section>
    <h2>How this works</h2>
    <p class="sub">Everything here comes from the game’s own data tables: ${catalog.visions.length} Resonances, ${catalog.equipment.length} pieces of equipment, ${catalog.characters.length} playable characters and ${catalog.enemies.length} enemies. English text comes from an earlier version of the game, so a few names may be outdated.</p>
    <h3>What the recommendations do and don’t cover</h3>
    <ul>
      <li><b>Optimize</b> (Characters) adds up flat equipment stats for the stats you gear for, each scaled to its own range. Effects like “+20% Fire damage” aren’t scored, so they’re listed for you to judge. It picks the Resonance whose unlocked skills add the most power in those stats.</li>
      <li>Damage and healing use the user’s own Attack (physical skills) or Magic (magic skills), whichever Resonance grants the skill. What Divine does in battle hasn’t been confirmed.</li>
      <li><b>Best party</b> (Fight) uses the damage formula recovered from the game, your progression and modelled passive effects, and predicts one round with one action each. It’s a bounded search: the strongest parties it found, not proof of the best. <a href="https://github.com/DylanElo/ffr-battle-companion/blob/main/docs/model-notes.md" target="_blank" rel="noopener">Model notes</a>.</li>
      <li>Owned counts include equipped copies. With “Don’t take other characters’ gear” on, their current gear and any plans are reserved.</li>
      <li>A Resonance is reserved for one character at a time. Whether two characters can share one hasn’t been confirmed.</li>
      <li>Weakness matches count skills you’ve unlocked at the selected character’s awakening and sync. They aren’t a damage ranking, and battle conditions still decide what you can use.</li>
      <li>Enemy entries are base data. A specific fight may change level, stats or actions. Enemy data can spoil later content.</li>
    </ul>
    <h3>Impact tiers</h3>
    <p class="dim small">${h(catalog.meta.legacyTierMethod)} Calculated on 28 September 2026.</p>
    <table><tbody>${tiers.map(([t, l]) => `<tr><td><span class="tier ${t}">${t}</span></td><td>${l.map(v => h(v.name)).join(', ') || '<span class="dim">None</span>'}</td></tr>`).join('')}</tbody></table>
    <details><summary>Source tables</summary>
      <table><thead><tr><th>Table</th><th>Rows</th><th>SHA-256</th></tr></thead><tbody>
      ${catalog.provenance.map(p => `<tr><td>${h(p.table)}</td><td>${p.rows}</td><td><code>${h(p.sha256)}</code></td></tr>`).join('')}</tbody></table></details>
  </section>`;
}

// ---------- frame ----------

const optimizerController=createOptimizerController({getCatalog:()=>catalog,getSnapshot:()=>snapshot,getFaces:()=>faces,rerender:()=>render(),stageParty:members=>{
  const next=Object.fromEntries(members.map(member=>[member.characterId,{...member.equipment,visionId:member.visionId,
    equippedSkillIds:member.evaluation.equippedSkillIds || [],recommendedActionId:member.evaluation.skillId}]));
  for(const member of members){const invalid=C.validPlan(catalog,snapshot,member.characterId,next[member.characterId],next,false);if(invalid)throw new Error(invalid);}
  plans=next;ui.reserve=false;ui.charId=members[0].characterId;storePlans();setDraft();toast('Party planned. Their gear is on the Characters page; your save is unchanged.');
}});
const RENDER = { fight, characters, resonances };

function render() {
  const key = document.activeElement?.dataset?.key, sel = document.activeElement?.selectionStart;
  // Panels marked data-keep stay open across re-renders (e.g. the party search's "More" settings).
  const keepOpen = new Set([...document.querySelectorAll('details[data-keep][open]')].map(d => d.dataset.keep));
  $('#save').innerHTML = hasSave()
    ? `<span class="party" title="Your party">${snapshot.party.filter(id => id > 0).map(id => charFace(id, 'sm')).join('')}</span>
       <b>${h(snapshot.source.fileName)}</b><span class="dim">${recruited().length} characters, ${snapshot.resonances.length} Resonances</span>
       <label class="load"><input type="file" accept=".sav" data-pick><span>Load another</span></label>`
    : `<label class="load"><input type="file" accept=".sav" data-pick><span>Load your save</span></label>${whereHelp}`;
  $('#app').innerHTML = `<nav class="window commands" aria-label="Sections"><ul>${VIEWS.map(([id, label]) =>
    `<li><button type="button" data-view="${id}" ${id === view ? 'aria-current="page"' : ''}>${label}</button></li>`).join('')}</ul></nav>${RENDER[view]()}`;
  for (const d of document.querySelectorAll('details[data-keep]')) if (keepOpen.has(d.dataset.keep)) d.open = true;
  const target = key && [...document.querySelectorAll('[data-key]')].find(e => e.dataset.key === key);
  if (target) { target.focus({ preventScroll: true }); if (sel != null && target.type === 'search') target.setSelectionRange(sel, sel); }
  $('.pick [aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
}

// Page-level changes animate with View Transitions (where supported). When a list item was
// clicked, its portrait is the one that flies into the hero slot; otherwise pages just crossfade.
function go(update, from) {
  const run = () => { update(); render(); };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return run();
  const hero = $('.hero .face, .card-head .face'), face = from?.querySelector('.face');
  if (hero) hero.style.viewTransitionName = 'none';
  if (face) face.style.viewTransitionName = 'hero-face';
  // A skipped or interrupted transition (rapid clicks, hidden tab) still runs the update; just don't report it.
  const t = document.startViewTransition(run);
  for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => {});
}

function exportPlans() {
  const content = { created: new Date().toISOString(), save: snapshot.source.fileName, note: 'Gear plans from Resonance Battle Companion. Not a game save.',
    plans: Object.entries(plans).map(([id, p]) => ({ character: name('characters', id), weapon: name('equipment', p.weaponId), armor: name('equipment', p.armorId),
      accessories: p.accessoryIds.map(a => name('equipment', a)), resonance: name('visions', p.visionId), ids: p })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  a.download = 'ffr-gear-plans.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-copy-path]')) {
    navigator.clipboard.writeText(SAVE_DIR).then(() => toast('Copied. Paste it into the file window’s address bar.'), () => toast(SAVE_DIR));
    return;
  }
  const t = e.target.closest('button, [data-enemy], [data-char], [data-kit]'); if (!t || !catalog) return;
  if (t.dataset.view) { if (t.dataset.view !== view) go(() => { view = t.dataset.view; }); return; }
  if (t.dataset.enemy) { if (+t.dataset.enemy !== ui.enemyId) go(() => { ui.enemyId = +t.dataset.enemy; }, t); return; }
  if (t.dataset.tab) { const [key, value] = t.dataset.tab.split(':'); ui[key] = value; render(); return; }
  if ('prioOpen' in t.dataset) { ui.prioOpen = !ui.prioOpen; render(); return; }
  if (t.id === 'how') { $('#about-body').innerHTML = about(); $('#about').showModal(); return; }
  if (t.dataset.kit) {
    go(() => {
      ui.kitId = +t.dataset.kit;
      if (view !== 'resonances') { view = 'resonances'; ui.kitQ = ''; ui.ownedOnly = false; scrollTo({ top: 0 }); }
    }, t); return;
  }
  if (t.dataset.char) { if (+t.dataset.char !== ui.charId) go(() => { ui.charId = +t.dataset.char; ui.pickVision = true; ui.visionWhy = ''; setDraft(); }, t); return; }
  if (t.dataset.plan) {
    const v = index.visions.get(+t.dataset.plan);
    go(() => {
      ui.charId = ui.perspective;
      setDraft(); draft.visionId = v.id; ui.pickVision = false; ui.visionWhy = ''; view = 'characters'; scrollTo({ top: 0 });
    }); return;
  }
  if (t.dataset.release) { delete plans[t.dataset.release]; storePlans(); setDraft(); render(); return; }
  if (t.dataset.prio) {
    const keys = gearPriorities().keys, k = t.dataset.prio;
    ui.prio[ui.charId] = keys.includes(k) ? keys.filter(x => x !== k) : [...keys, k];
    render(); return;
  }
  if ('prioReset' in t.dataset) { delete ui.prio[ui.charId]; render(); return; }
  if (t.dataset.useVision) {
    draft.visionId = +t.dataset.useVision; ui.pickVision = false; ui.visionWhy = '';
    try { findBest(); } catch (err) { error(err.message); }
    render(); return;
  }
  if (t.id === 'best') { try { findBest(); render(); } catch (err) { error(err.message); } return; }
  if (t.id === 'saved-gear') { draft = structuredClone(snapshot.characters.find(c => c.id === ui.charId).equipment); ui.visionWhy = ''; render(); return; }
  if (t.id === 'keep') { plans[ui.charId] = structuredClone(draft); storePlans(); render(); toast(`Kept plan for ${name('characters', ui.charId)}`); return; }
  if (t.id === 'export') exportPlans();
});

document.addEventListener('keydown', e => {
  const row = e.target.closest?.('[data-enemy], [data-char], [data-kit]');
  if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
});

document.addEventListener('input', e => {
  const t = e.target, map = { 'enemy-q': 'enemyQ', 'kit-q': 'kitQ', 'gear-q': 'gearQ' };
  if (map[t.id]) { ui[map[t.id]] = t.value; render(); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-pick], #pick')) { if (t.files[0]) loadSave(t.files[0]); return; }
  if (t.id === 'boss-only') ui.bossOnly = t.checked;
  else if (t.id === 'owned-only') ui.ownedOnly = t.checked;
  else if (t.id === 'perspective' || t.id === 'kit-perspective') ui.perspective = +t.value;
  else if (t.id === 'reserve') ui.reserve = t.checked;
  else if (t.id === 'vision') { draft.visionId = +t.value; ui.pickVision = false; ui.visionWhy = ''; }
  else if (t.id === 'pick-vision') ui.pickVision = t.checked;
  else if (t.dataset.slot) { const id = +t.value; if (t.dataset.slot === 'accessory') draft.accessoryIds[+t.dataset.index] = id; else draft[t.dataset.slot + 'Id'] = id; }
  else return;
  render();
});

const ready = (async () => {
  try {
    const r = await fetch('data/catalog.json');
    if (!r.ok) throw new Error(`Couldn’t load game data (${r.status}). Reload to try again.`);
    catalog = await r.json();
    faces = await fetch('data/faces.json').then(x => x.ok ? x.json() : {}, () => ({}));
    for (const k of ['characters', 'visions', 'equipment', 'skills', 'passives', 'enemies']) index[k] = new Map(catalog[k].map(x => [x.id, x]));
    document.body.classList.add('entering');
    render();
    setTimeout(() => document.body.classList.remove('entering'), 900);
  } catch (e) { error(e.message); $('#app').innerHTML = ''; throw e; }
})();

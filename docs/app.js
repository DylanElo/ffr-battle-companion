import * as S from './save.js?v=21';
import {createOptimizerController} from './optimizer-controller.js?v=34';
import {comparison} from './optimizer-ui.js?v=34';
import {gearExplanation, buildExplanation, estimateNotice} from './build-details.js?v=4';

const C = globalThis.Companion;
const $ = s => document.querySelector(s);
const h = v => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ELEMENTS = ['Fire', 'Ice', 'Wind', 'Earth', 'Thunder', 'Water', 'Light', 'Dark'];
const EMPTY = { inventory: [], characters: [], resonances: [], party: [] };
const VIEWS = [['next', 'Next fight'], ['fight', 'Fight'], ['characters', 'Characters'], ['resonances', 'Resonances']];

let saveFile = null, catalog, index = {}, snapshot = EMPTY, plans = {}, draft = null, view = 'fight';
const ui = { kitId: 0, enemyQ: '', bossOnly: true, enemyId: 0, perspective: 0, charId: 0, pickVision: true,
  reserve: true, kitQ: '', ownedOnly: true, gearQ: '', fightTab: 'resonances', charTab: 'effects', deepGoals: ['damage'], deepGeneral: true, deep: null,
  rf: { tags: [], targets: [], calcs: [], elements: [] }, rfUnlocked: false };

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
  saveFile = file;
}

// Shared with the read-only desktop importer; the public site still reads uploaded files in the browser.
export function loadSnapshot(parsed) {
  if(parsed.schemaVersion!==1 || !parsed.source?.sha256 || !Array.isArray(parsed.characters) || !Array.isArray(parsed.inventory) || !Array.isArray(parsed.resonances))throw new Error('Unsupported inventory snapshot.');
  optimizerController.cancel();cancelDeep();ui.deep=null;snapshot=parsed;
  try { plans = JSON.parse(localStorage.getItem('ffr-companion-plans:' + snapshot.source.sha256)) || {}; } catch { plans = {}; }
  const people = recruited(), first = snapshot.party.find(id => people.some(c => c.id === id)) ?? people[0]?.id ?? 0;
  ui.charId = ui.perspective = first; ui.ownedOnly = true;
  ui.enemyId = suggestedBoss()?.id ?? ui.enemyId; ui.bossOnly = true; view = 'next';
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

// ---------- next fight: the home page once a save is loaded ----------

// The first boss at or above the party's average level, so the page opens on the fight ahead, not the first one.
function partyLevel() {
  const levels = snapshot.party.filter(id => id > 0).map(id => { try { return globalThis.CompanionStats.characterStats(catalog, snapshot, id, snapshot.characters.find(c => c.id === id)?.equipment).level; } catch { return NaN; } }).filter(Number.isFinite);
  return levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 1;
}
function suggestedBoss() {
  const level = partyLevel(), bosses = catalog.enemies.filter(e => e.isBoss).sort((a, b) => a.level - b.level);
  return bosses.find(e => e.level >= level) ?? bosses.at(-1);
}

function next() {
  if (!hasSave()) return `<section class="window"><h2>Your next fight</h2>${loadPrompt('Load your save to get a party built for your next fight and equip it in one click.')}</section>`;
  optimizerController.setEnemy(ui.enemyId);
  const general = optimizerController.against() === 'general', enemy = index.enemies.get(ui.enemyId), suggested = suggestedBoss();
  const bosses = catalog.enemies.filter(e => e.isBoss).sort((a, b) => a.level - b.level);
  return `<div class="stack next">
    <section class="window">
      <h2>Your next fight</h2>
      <p class="dim small">Your party is level ${partyLevel()}. Pick the fight, build a party for it, then equip it straight into your save.</p>
      <ol class="steps"><li>Pick the fight</li><li>Find the best party</li><li>Equip in my save</li></ol>
      <label class="against">Fight <select id="next-enemy">${opt('general', 'Any fight (a typical boss at your level)', general)}${bosses.map(e => opt(e.id, `${e.name} (Lv ${e.level})${e.id === suggested?.id ? ', suggested' : ''}`, !general && e.id === ui.enemyId)).join('')}</select></label>
    </section>
    ${!general && enemy ? `<section class="window">${bossCard(enemy)}</section>` : ''}
    <section class="window"><h3>Best party</h3>${optimizerController.render({ fixedAgainst: true })}</section>
  </div>`;
}

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
        <div><button type="button" class="ghost" data-plan="${r.vision.id}">Build ${h(name('characters', ui.perspective))} around ${h(r.vision.name)}</button></div>
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

// Everything the character can use with the planned Resonance: their own abilities, level and sync
// unlocks, and the Resonance's grants (same source the party optimizer uses).
function usableSkills(visionId) {
  try {
    const l = globalThis.CompanionStats.learned(catalog, snapshot, ui.charId, visionId);
    return [...new Set([...l.freeActiveIds, ...l.learnedActiveIds])].map(id => index.skills.get(id)).filter(Boolean);
  } catch { return []; }
}

// Same rule as validPlan: one Resonance per character, counting others' plans and (if reserving) their saved gear.
function takenVisions() {
  return new Set(snapshot.characters.filter(c => c.id !== ui.charId && C.joined(c))
    .map(c => (plans[c.id] || (ui.reserve ? c.equipment : null))?.visionId).filter(id => id > 0));
}

// Full search: the party engine for one character against one enemy (Resonance, gear, attack,
// abilities and passives), scored on predicted damage or stagger. Runs in the search worker.
let deepWorker = null, deepRun = 0;
function cancelDeep() { deepRun++; deepWorker?.terminate(); deepWorker = null; }
function deepSearch() {
  cancelDeep();
  const id = deepRun, charId = ui.charId, enemyId = ui.deepGeneral ? 'general' : ui.enemyId, goals = [...ui.deepGoals];
  ui.deep = { busy: true, progress: 'Starting…' };
  const worker = deepWorker = new Worker(new URL('./optimizer-worker.js?v=34', import.meta.url));
  worker.onmessage = e => {
    if (e.data.id !== id || ui.charId !== charId) return;
    if (e.data.type === 'progress') ui.deep.progress = e.data.message;
    else if (e.data.type === 'error') { ui.deep = { error: e.data.message }; cancelDeep(); }
    else { ui.deep = { results: e.data.result.results, current: e.data.result.current, pick: 0, enemyId, goals }; cancelDeep(); if (ui.deep.results.length) applyDeep(0); }
    render();
  };
  worker.onerror = e => { if (id === deepRun) { ui.deep = { error: e.message || 'The search couldn’t start.' }; cancelDeep(); render(); } };
  worker.postMessage({ id, mode: 'single', catalog, snapshot, characterId: charId, enemyId, taken: [...takenVisions()],
    available: [...C.stock(snapshot, charId, plans, ui.reserve)],
    options: { goals, difficulty: 'save', mpPercent: 100, broken: false, critical: false, minHealers: 0, minProtectors: 0,
      perLoadoutBudget: 250, candidatesPerVision: 4, maxEvaluations: 5000, timeMs: 12000, visionSlices: true,
      visionIds: ui.pickVision || !(Number(draft.visionId) > 0) ? null : [Number(draft.visionId)] } });
  render();
}
function applyDeep(i) {
  const r = ui.deep.results[i]; ui.deep.pick = i;
  draft = { ...r.equipment, accessoryIds: [...r.equipment.accessoryIds], visionId: r.visionId,
    equippedSkillIds: r.evaluation.equippedSkillIds || [], recommendedActionId: r.evaluation.skillId };
}

function gearPriorities() {
  const kitVision = index.visions.get(Number(draft?.visionId));
  const profile = C.kitProfile(usableSkills(kitVision?.id ?? -1), index.characters.get(ui.charId));
  return { kitVision, profile, keys: profile.keys };
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
    <ul class="pick" role="listbox" aria-label="Characters">${people.map(c => `<li role="option" tabindex="0" data-char="${c.id}" data-key="c${c.id}" aria-selected="${c.id === ui.charId}">${charFace(c.id, 'sm')}<span>${h(name('characters', c.id))}${snapshot.party.includes(c.id) ? '<small>Party</small>' : ''}</span>
      ${plans[c.id] ? '<i class="plan-dot" title="Has a gear plan"></i>' : ''}</li>`).join('')}</ul>
    ${Object.keys(plans).length ? '<p class="dim small"><i class="plan-dot"></i> has a gear plan</p>' : ''}
    <label class="check"><input type="checkbox" id="reserve" ${ui.reserve ? 'checked' : ''}> Don’t take others’ gear</label>
    ${Object.keys(plans).length ? `${saveFile ? '<button type="button" class="primary" id="apply-plans">Equip plans in my save</button>' : ''}
      <button type="button" class="ghost" id="export">Export plans</button>` : ''}
  </section>`;
  if (!saved || !native || !draft) return `<div class="chars">${roster}<section class="window"><p class="dim">Nobody in this save can equip gear yet.</p></section></div>`;

  // What to gear for: suggested from the character's usable skills and role, until the player picks.
  const { keys } = gearPriorities(), goal = C.priorityGoal(catalog, keys);

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
    ${deepPanel(native)}
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
    ${deepResult()}
    <div class="vision-slot">${v ? visionFace(v.id, 'md') : '<span class="face md empty"></span>'}
      <div><label for="vision" class="dim small">Resonance</label>
        <select id="vision" data-key="vision" class="${Number(draft.visionId) !== Number(saved.equipment.visionId) ? 'changed' : ''}">${opt(-1, 'None', Number(draft.visionId) <= 0)}${snapshot.resonances.map(r => opt(r.id, name('visions', r.id), r.id === Number(draft.visionId))).join('')}</select></div></div>
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

// The one build tool: Resonance (or the one you locked), gear, attack, abilities and passives, searched together.
function deepPanel(native) {
  const d = ui.deep || {}, busy = !!d.busy, locked = !ui.pickVision && Number(draft.visionId) > 0;
  const enemies = catalog.enemies.filter(e => e.isBoss || e.id === ui.enemyId).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return `<div class="deep">
    <h4>Build ${h(native.name)}</h4>
    <p class="dim small">Searches your owned Resonances, gear and learned abilities together. Results show their estimated effect and AP cost, compared with your saved setup.</p>
    <div class="chips" role="group" aria-label="Build for">${[['damage', 'Damage'], ['stagger', 'Stagger'], ['limit', 'Limit Burst'], ['durability', 'Durability']].map(([id, label]) =>
      `<label class="chip-check"><input type="checkbox" name="deep-goal" value="${id}" ${ui.deepGoals.includes(id) ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>${label}</span></label>`).join('')}</div>
    <p class="dim small">Combine goals: each counts how much of a bar it fills per round (enemy HP, enemy stagger bar, your LB gauge).</p>
    <label class="against"><span class="dim small">Against</span>
      <select id="deep-enemy" ${busy ? 'disabled' : ''}>${opt('general', 'Any fight (a typical boss at your level)', ui.deepGeneral)}${enemies.map(e => opt(e.id, `${e.name} (Lv ${e.level})`, !ui.deepGeneral && e.id === ui.enemyId)).join('')}</select></label>
    <label class="check small"><input type="checkbox" id="pick-vision" ${ui.pickVision ? 'checked' : ''} ${busy ? 'disabled' : ''}> Let it pick the Resonance</label>
    ${locked ? `<p class="dim small">Builds around ${h(name('visions', draft.visionId))}. Pick another in the Resonance box, or tick the box above.</p>` : ''}
    <div class="toolbar">${busy ? `<span class="dim small" role="status">${h(d.progress)}</span><button type="button" id="deep-cancel">Cancel</button>`
      : `<button type="button" class="primary" id="deep">Build</button><button type="button" id="saved-gear">Reset</button><span class="dim small">About 15 seconds</span>`}</div>
    ${d.error ? `<p class="bad small" role="alert">${h(d.error)}</p>` : ''}
  </div>`;
}

// Result of "Build for a fight", shown above the slots it filled in.
function deepResult() {
  const d = ui.deep;
  if (!d?.results) return '';
  const against = d.enemyId === 'general' ? 'any fight' : name('enemies', d.enemyId);
  if (!d.results.length) return `<div class="deep-result"><p>No legal attack was found for this character against ${h(against)}.</p></div>`;
  const r = d.results[d.pick], ev = r.evaluation, skill = index.skills.get(Number(ev.skillId));
  const goals = d.goals || ['damage'];
  const n = v => Math.round(Number(v) || 0).toLocaleString();
  return `<div class="deep-result" aria-busy="false">
    ${d.results.length > 1 ? `<div class="tabs" role="tablist">${d.results.map((x, i) => `<button type="button" role="tab" aria-selected="${i === d.pick}" data-deep-pick="${i}">${i ? `Option ${i + 1}` : 'Top result'}</button>`).join('')}</div>` : ''}
    ${estimateNotice()}
    <div class="deep-head">${enemyFace(d.enemyId, 'sm')}<span>vs ${h(against)}</span>
      <span class="deep-num"><b>${n(ev.fightDamage ?? ev.damage)}</b> estimated damage per round</span>
      <span class="dim small">${n(ev.fightBreakDamage ?? ev.breakDamage)} stagger per round${ev.firstStagger ? ` · staggers in round ${ev.firstStagger}` : ''}${ev.gaugePerRound ? ` · LB gauge +${n(ev.gaugePerRound)} per round` : ''}</span></div>
    ${comparison(d.current && { damage: d.current.fightDamage ?? d.current.damage, firstStagger: d.current.firstStagger }, { damage: ev.fightDamage ?? ev.damage, firstStagger: ev.firstStagger })}
    <p class="dim small">Built for ${goals.map(g => ({ damage: 'damage', stagger: 'stagger', limit: 'Limit Burst', durability: 'durability' })[g]).join(' + ')}, over five rounds using this character’s hits only. Stagger ends at the next turn boundary; later hits in the current turn deal ×1.5.</p>
    <p class="small">Use <b>${h(ev.recipeLabel || skill?.name || '—')}</b>${skill ? ` <span class="dim">(${n(ev.turnMp ?? skill.cost)} MP${C.clean(skill.element) !== 'None' ? `, ${h(C.clean(skill.element))}` : ''})</span>` : ''}. Resonance and gear below are filled in.</p>
    ${(ev.limitUses || []).length ? `<p class="small">Limit Burst: ${ev.limitUses.map(u => `<b>${h(index.skills.get(Number(u.skillId))?.name)}</b> in round ${u.round}`).join(', ')} of a five-round fight, based on this character’s own stagger rewards. Averages ${n(ev.fightDamage)} damage per round.</p>` : ''}
    ${gearExplanation(r, index)}
    ${buildExplanation(r, index)}
  </div>`;
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

// Effect filters: chip groups over the tagged facts each Resonance offers (see core.resonanceFacts).
const STAT_CHIPS = [['ATK', 'ATK'], ['MAG', 'MAG'], ['DEF', 'DEF'], ['SPR', 'SPR'], ['SPD', 'Speed']];
const TAG_LABELS = Object.fromEntries([
  ...STAT_CHIPS.flatMap(([k, l]) => [[`down:${k}`, `${l} down`], [`up:${k}`, `${l} up`]]),
  ...['Poison', 'Blind', 'Sleep', 'Silence', 'Paralysis', 'Confusion', 'Berserk'].map(s => [`status:${s}`, s]),
  ['damage', 'Damage'], ['heal', 'Heal'], ['regen', 'Regen'], ['revive', 'Revive'], ['cure', 'Cure status'], ['dispel', 'Dispel'], ['cover', 'Cover'], ['taunt', 'Provoke'],
  ['reflect', 'Reflect'], ['reraise', 'Reraise'], ['counter', 'Counter'], ['steal', 'Steal'], ['stagger-up', 'Stagger up'], ['crit-up', 'Crit up'], ['imbue', 'Element imbue']]);
const FILTER_GROUPS = [
  ['Lowers enemy', 'tags', STAT_CHIPS.map(([k, l]) => [`down:${k}`, l])],
  ['Raises', 'tags', STAT_CHIPS.map(([k, l]) => [`up:${k}`, l])],
  ['Inflicts', 'tags', ['Poison', 'Blind', 'Sleep', 'Silence', 'Paralysis', 'Confusion', 'Berserk'].map(s => [`status:${s}`, s])],
  ['Support', 'tags', ['heal', 'regen', 'revive', 'cure', 'dispel', 'cover', 'taunt', 'reflect', 'reraise', 'counter', 'steal'].map(t => [t, TAG_LABELS[t]])],
  ['Boosts', 'tags', ['stagger-up', 'crit-up', 'imbue'].map(t => [t, TAG_LABELS[t]])],
  ['Hits', 'targets', [['enemy', 'One enemy'], ['enemies', 'All enemies'], ['self', 'Self'], ['ally', 'One ally'], ['allies', 'All allies']]],
  ['Damage', 'calcs', [['Physic', 'Physical'], ['Magic', 'Magic']]],
  ['Element', 'elements', ELEMENTS.map(e => [e, e])]];
const TARGET_LABELS = { enemy: 'one enemy', enemies: 'all enemies', random: 'random enemies', self: 'self', ally: 'one ally', allies: 'all allies' };
const filterCount = () => Object.values(ui.rf).reduce((n, a) => n + a.length, 0);

// The facts a Resonance offers, limited to what's unlocked for the chosen character when asked.
function visibleFacts(v) {
  const facts = C.resonanceFacts(catalog, v);
  if (!(hasSave() && ui.rfUnlocked)) return facts;
  const o = owned(v.id);
  if (!o) return [];
  const reached = new Set(C.mastery(v, o, ui.perspective).rows.filter(r => r.reached).map(r => r.id));
  return facts.filter(f => f.finisher || reached.has(f.id));
}

function filterPanel(active) {
  return `<details class="filters" data-keep="res-filters" ${active ? 'open' : ''}><summary>Filter by effect${active ? ` <b>(${active})</b>` : ''}</summary>
    ${FILTER_GROUPS.map(([label, key, chips]) => `<div class="fgroup"><span class="dim small">${label}</span><div class="chips">${chips.map(([value, text]) =>
      `<button type="button" class="chip" data-rf="${key}:${value}" aria-pressed="${ui.rf[key].includes(value)}">${h(text)}</button>`).join('')}</div></div>`).join('')}
    ${hasSave() ? `<div class="unlocked-for"><label class="check"><input type="checkbox" id="rf-unlocked" ${ui.rfUnlocked ? 'checked' : ''}> Only unlocked for</label>
      <select id="rf-perspective" aria-label="Character">${recruited().map(c => opt(c.id, name('characters', c.id), c.id === ui.perspective)).join('')}</select></div>` : ''}
    ${active ? '<button type="button" class="ghost" data-rf-clear>Clear filters</button>' : ''}
  </details>`;
}

function resonances() {
  const q = ui.kitQ.trim().toLowerCase(), mine = hasSave() && ui.ownedOnly, active = filterCount() + (hasSave() && ui.rfUnlocked ? 1 : 0);
  const text = v => `${v.name} ${v.roles.join(' ')} ${v.skillIds.map(id => { const s = index.skills.get(id); return `${s?.name} ${s?.desc} ${s?.element}`; }).join(' ')} ${v.passiveIds.map(id => name('passives', id)).join(' ')}`.toLowerCase();
  const list = catalog.visions.filter(v => (!mine || owned(v.id)) && (!q || text(v).includes(q)) && (!active || C.matchFacts(visibleFacts(v), ui.rf)))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!list.some(v => v.id === ui.kitId)) ui.kitId = list[0]?.id ?? 0;
  const tierOf = id => catalog.legacyTiers.find(t => t.id === id)?.impact;
  return `<div class="split">
    <section class="window" aria-label="Choose a Resonance">
      <input type="search" id="kit-q" data-key="kit-q" placeholder="Search names, roles, skills or effects" value="${h(ui.kitQ)}" aria-label="Search Resonances">
      ${hasSave() ? `<label class="check"><input type="checkbox" id="owned-only" ${ui.ownedOnly ? 'checked' : ''}> Only mine</label>` : ''}
      ${filterPanel(active)}
      ${active ? `<p class="dim small">${list.length} match${list.length === 1 ? '' : 'es'}</p>` : ''}
      <ul class="gallery" role="listbox" aria-label="Resonances">${list.map(v => `<li role="option" tabindex="0" data-kit="${v.id}" data-key="k${v.id}" aria-selected="${v.id === ui.kitId}" class="${hasSave() && !owned(v.id) ? 'notmine' : ''}">
        ${tierOf(v.id) ? `<span class="tier ${h(tierOf(v.id))}">${h(tierOf(v.id))}</span>` : ''}${visionFace(v.id)}${h(v.name)}</li>`).join('')
        || `<li class="dim">Nothing matches.${mine ? ' Turn off “Only mine” to see all.' : ''}${ui.rfUnlocked && hasSave() ? ` None of your Resonances have it unlocked for ${h(name('characters', ui.perspective))}; untick “Only unlocked” to see who offers it.` : active ? ' Try fewer filters.' : ''}</li>`}</ul>
    </section>
    <section class="window">${index.visions.get(ui.kitId) ? kit(index.visions.get(ui.kitId)) : '<p class="dim">Pick a Resonance.</p>'}</section>
  </div>`;
}

// Which skills give this Resonance the filtered effects, and where each one unlocks.
function matchesBox(v) {
  if (!filterCount()) return '';
  const hits = C.matchFacts(visibleFacts(v), ui.rf);
  if (!hits) return '';
  const o = owned(v.id), reached = o ? new Set(C.mastery(v, o, ui.perspective).rows.filter(r => r.reached).map(r => r.id)) : new Set();
  const rows = new Map();
  // Same-named entries (e.g. Cure at Awakening 0 and 1) are one row, keeping the earliest unlock.
  for (const f of [...hits].sort((a, b) => (a.unlock?.required ?? -1) - (b.unlock?.required ?? -1))) {
    const key = (index.skills.get(f.id) || index.passives.get(f.id))?.name ?? f.id, row = rows.get(key) || { f, labels: new Set() };
    row.labels.add(`${TAG_LABELS[f.tag] || f.tag}${f.passive ? '' : `, ${TARGET_LABELS[f.target] || f.target}`}`);
    rows.set(key, row);
  }
  return `<div class="matches"><h3>Matches your filters</h3><ul class="skills">${[...rows.values()].map(({ f, labels }) => {
    const item = index.skills.get(f.id) || index.passives.get(f.id);
    const where = f.finisher ? 'Finisher' : f.unlock ? `${f.unlock.kind} ${f.unlock.required}` : 'In kit';
    return `<li class="${reached.has(f.id) || (o && f.finisher) ? 'got' : ''}"><b>${h(item?.name)}</b> <span class="meta">${f.passive ? 'Passive' : 'Skill'}, ${h(where)}${reached.has(f.id) ? ', unlocked' : ''}</span>
      <p>${[...labels].map(h).join(' · ')}</p></li>`;
  }).join('')}</ul></div>`;
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
    ${matchesBox(v)}
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
      <li><b>Best party</b> (Fight) uses the damage formula recovered from the game, your progression and modelled passive effects, and predicts one turn each: one action, or the same attack twice with Arms Akimbo or Dualcast. Magic Boost is scored with a single magic attack; combined boosted multiple-action recipes remain excluded. Hits are capped at 9,999 unless Break the Limit (or gear with it) is on. Over a five-round fight, staggers fill the LB gauge and a Limit Burst is used when it beats a normal turn, so LB gauge abilities are picked when they pay off. It’s a bounded search: the strongest parties it found, not proof of the best. <a href="https://github.com/DylanElo/ffr-battle-companion/blob/main/docs/model-notes.md" target="_blank" rel="noopener">Model notes</a>.</li>
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
},canEquip:()=>!!saveFile,equipPlans:()=>applyPlans()});
const RENDER = { next, fight, characters, resonances };

function render() {
  const key = document.activeElement?.dataset?.key, sel = document.activeElement?.selectionStart;
  // Panels marked data-keep stay open across re-renders (e.g. the party search's "More" settings).
  const keepOpen = new Set([...document.querySelectorAll('details[data-keep][open]')].map(d => d.dataset.keep));
  $('#save').innerHTML = hasSave()
    ? `<span class="party" title="Your party">${snapshot.party.filter(id => id > 0).map(id => charFace(id, 'sm')).join('')}</span>
       <b>${h(snapshot.source.fileName)}</b><span class="dim">${recruited().length} characters, ${snapshot.resonances.length} Resonances</span>
       <label class="load"><input type="file" accept=".sav" data-pick><span>Load another</span></label>`
    : `<label class="load"><input type="file" accept=".sav" data-pick><span>Load your save</span></label>${whereHelp}`;
  if (view === 'next' && !hasSave()) view = 'fight';
  $('#app').innerHTML = `<nav class="window commands" aria-label="Sections"><ul>${VIEWS.filter(([id]) => id !== 'next' || hasSave()).map(([id, label]) =>
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

const download = (bytes, fileName) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// Writes every plan's gear, Resonance and abilities into a copy of the loaded save.
// Only fixed-size ints change, so the file layout stays exactly the game's own.
export async function savedWithPlans(bytes, snap, plans) {
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
  const use = (item, who) => {
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
    const wanted = (plan.equippedSkillIds || []).map(Number);
    if (!plan.equippedSkillIds?.length && Number(plan.visionId) === Number(saved.equipment.visionId)) continue;
    // The plan's abilities first, then the ones already on, while they're learned and fit the slots and EquipCost budget.
    const cost = id => Number((index.skills.get(id) || index.passives.get(id) || index.masterSkills.get(id))?.equipCost || 0);
    const learn = CompanionStats.learned(catalog, snap, saved.id, plan.visionId), known = new Set([...learn.learnedPassiveIds, ...learn.learnedActiveIds, ...learn.masterSkillIds]);
    const budget = Number(CompanionStats.characterStats(catalog, snap, saved.id, plan).skillBudget), slots = saved.equippedSkillIds.length;
    const skills = [];
    let spent = 0;
    for (const id of [...wanted, ...saved.equippedSkillIds].map(Number)) {
      if (!(id > 0) || skills.includes(id) || skills.length >= slots || spent + cost(id) > budget) continue;
      if (!wanted.includes(id) && !known.has(id)) continue;
      skills.push(id); spent += cost(id);
    }
    if (wanted.some(id => !skills.includes(id))) throw new Error(`${name('characters', id)}'s planned abilities don't fit its slots.`);
    for (let i = 0; i < slots; i++) set(`${p}equipSkillList[${i}]`, skills[i] ?? -1);
  }
  return { bytes: await S.encodeSave(save, data), removed };
}

async function applyPlans() {
  try {
    const original = new Uint8Array(await saveFile.arrayBuffer());
    const { bytes: out, removed } = await savedWithPlans(original, snapshot, plans);
    const base = saveFile.name.replace(/\.sav$/i, '');
    download(original, `${base} (backup).sav`);
    download(out, saveFile.name);
    $('#about-body').innerHTML = `<h2>Plans equipped</h2>
      <p>Two files were downloaded: <b>${h(saveFile.name)}</b> with your plans equipped, and <b>${h(base)} (backup).sav</b>, your save as it was.</p>
      <ol><li>Close the game.</li><li>Open your save folder: <code>${h(SAVE_DIR)}</code>, then the numbered folder inside.</li>
      <li>Replace <b>${h(saveFile.name)}</b> with the downloaded one.</li><li>Start the game and load that save.</li></ol>
      ${(swapIn => swapIn.length ? `<p>Then put <b>${swapIn.map(id => h(name('characters', id))).join(', ')}</b> in your party in the game.</p>` : '')(Object.keys(plans).map(Number).filter(id => !snapshot.party.includes(id)))}
      ${removed.length ? `<p>Taken off characters without a plan, because a plan uses them:</p><ul>${removed.map(r => `<li>${h(r)}</li>`).join('')}</ul>` : ''}
      <p class="dim">Something wrong? Put the backup back under the name ${h(saveFile.name)}.</p>`;
    $('#about').showModal();
  } catch (e) { error(e.message); }
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
  if (t.id === 'how') { $('#about-body').innerHTML = about(); $('#about').showModal(); return; }
  if (t.dataset.kit) {
    go(() => {
      ui.kitId = +t.dataset.kit;
      if (view !== 'resonances') { view = 'resonances'; ui.kitQ = ''; ui.ownedOnly = false; scrollTo({ top: 0 }); }
    }, t); return;
  }
  if (t.dataset.char) { if (+t.dataset.char !== ui.charId) go(() => { cancelDeep(); ui.deep = null; ui.charId = +t.dataset.char; ui.pickVision = true; setDraft(); }, t); return; }
  if (t.id === 'deep') { deepSearch(); return; }
  if (t.id === 'deep-cancel') { cancelDeep(); ui.deep = null; render(); return; }
  if (t.dataset.deepPick) { applyDeep(+t.dataset.deepPick); render(); return; }
  if (t.dataset.plan) {
    const v = index.visions.get(+t.dataset.plan);
    go(() => {
      ui.charId = ui.perspective;
      setDraft(); draft.visionId = v.id; ui.pickVision = false; ui.deepGeneral = false; view = 'characters'; scrollTo({ top: 0 }); deepSearch();
    }); return;
  }
  if (t.dataset.release) { delete plans[t.dataset.release]; storePlans(); setDraft(); render(); return; }
  if (t.dataset.rf) {
    const cut = t.dataset.rf.indexOf(':'), key = t.dataset.rf.slice(0, cut), value = t.dataset.rf.slice(cut + 1); // values like "down:ATK" contain ':'
    ui.rf[key] = ui.rf[key].includes(value) ? ui.rf[key].filter(x => x !== value) : [...ui.rf[key], value];
    render(); return;
  }
  if ('rfClear' in t.dataset) { ui.rf = { tags: [], targets: [], calcs: [], elements: [] }; ui.rfUnlocked = false; render(); return; }
  if (t.id === 'saved-gear') { draft = structuredClone(snapshot.characters.find(c => c.id === ui.charId).equipment); ui.deep = null; render(); return; }
  if (t.id === 'keep') { plans[ui.charId] = structuredClone(draft); storePlans(); render(); toast(`Kept plan for ${name('characters', ui.charId)}`); return; }
  if (t.id === 'export') exportPlans();
  if (t.id === 'apply-plans') applyPlans();
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
  else if (t.id === 'rf-unlocked') ui.rfUnlocked = t.checked;
  else if (t.id === 'perspective' || t.id === 'kit-perspective' || t.id === 'rf-perspective') ui.perspective = +t.value;
  else if (t.id === 'reserve') ui.reserve = t.checked;
  else if (t.name === 'deep-goal') { ui.deepGoals = t.checked ? [...new Set([...ui.deepGoals, t.value])] : ui.deepGoals.filter(g => g !== t.value); if (!ui.deepGoals.length) { ui.deepGoals = [t.value]; t.checked = true; } }
  else if (t.id === 'next-enemy') { if (t.value !== 'general') ui.enemyId = +t.value; optimizerController.setAgainst(t.value === 'general' ? 'general' : 'enemy'); }
  else if (t.id === 'deep-enemy') { ui.deepGeneral = t.value === 'general'; if (!ui.deepGeneral) ui.enemyId = +t.value; }
  else if (t.id === 'vision') { draft.visionId = +t.value; ui.pickVision = false; ui.deep = null; }
  else if (t.id === 'pick-vision') ui.pickVision = t.checked;
  else if (t.dataset.slot) { ui.deep = null; const id = +t.value; if (t.dataset.slot === 'accessory') draft.accessoryIds[+t.dataset.index] = id; else draft[t.dataset.slot + 'Id'] = id; }
  else return;
  render();
});

const ready = (async () => {
  try {
    const r = await fetch('data/catalog.json');
    if (!r.ok) throw new Error(`Couldn’t load game data (${r.status}). Reload to try again.`);
    catalog = await r.json();
    faces = await fetch('data/faces.json').then(x => x.ok ? x.json() : {}, () => ({}));
    for (const k of ['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills', 'effects', 'enemies']) index[k] = new Map(catalog[k].map(x => [x.id, x]));
    document.body.classList.add('entering');
    render();
    setTimeout(() => document.body.classList.remove('entering'), 900);
  } catch (e) { error(e.message); $('#app').innerHTML = ''; throw e; }
})();

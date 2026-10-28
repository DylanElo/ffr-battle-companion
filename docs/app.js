import { readSave, savedWithPlans, SAVE_CHANGED } from './save-io.js?v=2';
import {createOptimizerController} from './optimizer-controller.js?v=42';
import {comparison} from './optimizer-ui.js?v=41';
import {abilityList, alwaysOnList, moveDetails} from './build-details.js?v=11';
import {shareCard, partyImage} from './share-image.js?v=3';

const C = globalThis.Companion;
const $ = s => document.querySelector(s);
const h = v => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ELEMENTS = ['Fire', 'Ice', 'Wind', 'Earth', 'Thunder', 'Water', 'Light', 'Dark'];
const EMPTY = { inventory: [], characters: [], resonances: [], party: [] };
const VIEWS = [['party', 'Party'], ['bosses', 'Bosses'], ['characters', 'Characters'], ['resonances', 'Resonances']];
const REPORT_URL = 'https://github.com/DylanElo/ffr-battle-companion/issues/new';

let saveFile = null, catalog, index = {}, snapshot = EMPTY, plans = {}, draft = null, view = 'party', pending = null;
// enemyId is the Party page's boss, bossId the one browsed on Bosses, deepEnemyId the Characters build target.
const ui = { kitId: 0, enemyQ: '', bossOnly: true, enemyId: 0, bossId: 0, deepEnemyId: 0, perspective: 0, charId: 0, pickVision: true,
  reserve: true, kitQ: '', ownedOnly: true, gearQ: '', fightTab: 'resonances', charTab: 'effects', deepGoals: ['damage'], deepGeneral: true, deep: null, deepIncomingDamage: 0, deepIncomingType: 'Physic',
  rf: { tags: [], targets: [], calcs: [], elements: [] }, rfUnlocked: false };

const NOUNS = { characters: 'character', visions: 'Resonance', equipment: 'item', skills: 'ability', passives: 'ability', masterSkills: 'ability', enemies: 'enemy' };
// An id missing from the bundled game data comes from a newer game version.
const name = (kind, id) => index[kind]?.get(Number(id))?.name ?? (Number(id) > 0 ? `New ${NOUNS[kind] || 'entry'} #${id}` : 'Empty');
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
function error(text = '', report = '') {
  const box = $('#error');
  box.innerHTML = text ? `${h(text)}${report ? ` <a href="${h(`${REPORT_URL}?title=${encodeURIComponent(report)}`)}" target="_blank" rel="noopener">Report it</a>` : ''}` : '';
  box.hidden = !text;
}
// Messages written for players pass through; anything else is a save layout this version can't read yet.
const PLAYER_ERRORS = /not a FINAL FANTASY RESONANCE game save|integrity check|settings file/;
const loadError = e => PLAYER_ERRORS.test(e.message) ? [e.message]
  : ['This save couldn’t be read. It may be from a newer version of the game.', `Save couldn't be read: ${e.message}`];

async function loadSave(file) {
  error();
  await ready;
  let parsed;
  try { parsed = await readSave(file); }
  catch (e) { return error(...loadError(e)); }
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
  ui.enemyId = ui.bossId = ui.deepEnemyId = suggestedBoss()?.id ?? ui.enemyId; ui.bossOnly = true; view = 'party';
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

function welcome() {
  return `<section class="window welcome">
    <h2>The best party for your next boss</h2>
    <p class="sub">Load your save, pick a boss, then equip the party in one click.</p>
    <div class="toolbar"><label class="load"><input type="file" accept=".sav" data-pick><span>Load your save</span></label>${whereHelp}</div>
    <p class="dim small">Your save stays on your computer. Nothing is uploaded.</p>
    <p class="dim small">No save handy? Look up <button type="button" class="ghost" data-view="bosses">bosses</button> or <button type="button" class="ghost" data-view="resonances">Resonances</button>.</p>
  </section>`;
}

function party() {
  if (!hasSave()) return welcome();
  optimizerController.setEnemy(ui.enemyId);
  const general = optimizerController.against() === 'general', enemy = index.enemies.get(ui.enemyId), suggested = suggestedBoss();
  const bosses = catalog.enemies.filter(e => e.isBoss).sort((a, b) => a.level - b.level);
  return `<div class="stack">
    <section class="window">
      <label class="against"><span class="dim small">Boss · your party is level ${partyLevel()}</span>
        <select id="next-enemy">${opt('general', 'Any fight (a typical boss at your level)', general)}${bosses.map(e => opt(e.id, `${e.name} (Lv ${e.level})${e.id === suggested?.id ? ', next' : ''}`, !general && e.id === ui.enemyId)).join('')}</select></label>
      ${!general && enemy ? `<div class="boss-summary">${bossCard(enemy)}</div>` : ''}
    </section>
    <section class="window"><h3>Best party</h3>${optimizerController.render({ fixedAgainst: true })}</section>
  </div>`;
}

// ---------- bosses: weaknesses and what you own that hits them ----------

function bosses() {
  const q = ui.enemyQ.trim().toLowerCase();
  const list = catalog.enemies.filter(e => (!ui.bossOnly || e.isBoss) && `${e.name} ${e.id}`.toLowerCase().includes(q))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!list.some(e => e.id === ui.bossId)) ui.bossId = list[0]?.id ?? 0;
  const enemy = index.enemies.get(ui.bossId);
  return `<div class="split">
    <section class="window" aria-label="Choose an enemy">
      <input type="search" id="enemy-q" data-key="enemy-q" placeholder="Search enemies" value="${h(ui.enemyQ)}" aria-label="Search enemies">
      <label class="check"><input type="checkbox" id="boss-only" ${ui.bossOnly ? 'checked' : ''}> Bosses only</label>
      <ul class="pick" role="listbox" aria-label="Enemies">${list.map(e => `<li role="option" tabindex="0" data-enemy="${e.id}" data-key="e${e.id}" aria-selected="${e.id === ui.bossId}">${enemyFace(e.id, 'sm')}<span>${h(e.name)}</span><small>Lv ${e.level}</small></li>`).join('') || '<li class="dim">No enemies match.</li>'}</ul>
    </section>
    ${enemy ? `<div class="stack">
      <section class="window">${bossCard(enemy)}
        ${hasSave() ? `<div class="toolbar"><button type="button" class="primary" data-party-for="${enemy.id}">Build a party for ${h(enemy.name)}</button></div>` : ''}</section>
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
  const id = deepRun, charId = ui.charId, enemyId = ui.deepGeneral ? 'general' : ui.deepEnemyId, goals = [...ui.deepGoals];
  ui.deep = { busy: true, progress: 'Starting…' };
  const worker = deepWorker = new Worker(new URL('./optimizer-worker.js?v=41', import.meta.url));
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
    options: { goals, difficulty: 'save', mpPercent: 100, incomingDamage: ui.deepIncomingDamage, incomingType: ui.deepIncomingType, broken: false, critical: false, minHealers: 0, minProtectors: 0,
      perLoadoutBudget: 250, candidatesPerVision: 4, maxEvaluations: 5000, timeMs: 8000, visionSlices: true,
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
  const enemies = catalog.enemies.filter(e => e.isBoss || e.id === ui.deepEnemyId).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return `<div class="deep">
    <h4>Build ${h(native.name)}</h4>
    <p class="dim small">Finds the best Resonance, gear and abilities you own for this character.</p>
    <div class="chips" role="group" aria-label="Build for">${[['damage', 'Damage'], ['stagger', 'Stagger'], ['limit', 'Limit Burst'], ['durability', 'Durability']].map(([id, label]) =>
      `<label class="chip-check"><input type="checkbox" name="deep-goal" value="${id}" ${ui.deepGoals.includes(id) ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>${label}</span></label>`).join('')}</div>
    <label class="against"><span class="dim small">Against</span>
      <select id="deep-enemy" ${busy ? 'disabled' : ''}>${opt('general', 'Any fight (a typical boss at your level)', ui.deepGeneral)}${enemies.map(e => opt(e.id, `${e.name} (Lv ${e.level})`, !ui.deepGeneral && e.id === ui.deepEnemyId)).join('')}</select></label>
    <details data-keep="deep-advanced"><summary>Expert scenario</summary>
      <p class="dim small">One fixed hit per character after acting, each round. Damage is after defense, before Mirror reduction. Set 0 for no incoming hits.</p>
      <label class="small">Hit damage <input type="number" id="deep-incoming-damage" min="0" max="99999999" step="1" value="${h(ui.deepIncomingDamage)}" ${busy ? 'disabled' : ''}></label>
      <label class="small">Hit type <select id="deep-incoming-type" ${busy ? 'disabled' : ''}>${[['Physic','Physical'],['Magic','Magic']].map(([value,label])=>opt(value,label,ui.deepIncomingType===value)).join('')}</select></label>
    </details>
    <label class="check small"><input type="checkbox" id="pick-vision" ${ui.pickVision ? 'checked' : ''} ${busy ? 'disabled' : ''}> Let it pick the Resonance</label>
    ${locked ? `<p class="dim small">Builds around ${h(name('visions', draft.visionId))}.</p>` : ''}
    <div class="toolbar">${busy ? `<span class="dim small" role="status">${h(d.progress)}</span><button type="button" id="deep-cancel">Cancel</button>`
      : `<button type="button" class="primary" id="deep">Build</button><button type="button" id="saved-gear">Reset</button>`}</div>
    ${d.error ? `<p class="bad small" role="alert">${h(d.error)}</p>` : ''}
  </div>`;
}

// Result of Build, shown above the slots it filled in: the number, the move, the abilities; each opens to what it does.
function deepResult() {
  const d = ui.deep;
  if (!d?.results) return '';
  const against = d.enemyId === 'general' ? 'any fight' : name('enemies', d.enemyId);
  if (!d.results.length) return `<div class="deep-result"><p>No usable attack was found against ${h(against)}.</p></div>`;
  const r = d.results[d.pick], ev = r.evaluation, limits = ev.limitUses || [], outOfMp = ev.mpExhaustedRounds || [];
  const n = v => Math.round(Number(v) || 0).toLocaleString();
  const facts = [ev.firstStagger ? `Staggers in round ${ev.firstStagger}` : '', limits.length ? `Limit Burst in round ${limits.map(u => u.round).join(', ')}` : '',
    outOfMp.length ? `Out of MP from round ${Math.min(...outOfMp)}` : ''].filter(Boolean);
  const alwaysOn = alwaysOnList(r, index);
  return `<div class="deep-result" aria-busy="false">
    ${d.results.length > 1 ? `<div class="tabs" role="tablist">${d.results.map((x, i) => `<button type="button" role="tab" aria-selected="${i === d.pick}" data-deep-pick="${i}">${i ? `Option ${i + 1}` : 'Top result'}</button>`).join('')}</div>` : ''}
    <div class="deep-head">${enemyFace(d.enemyId, 'sm')}<span>vs ${h(against)}</span>
      <span class="deep-num"><b>${n(ev.fightDamage ?? ev.damage)}</b> damage per round</span></div>
    ${d.current ? comparison({ damage: d.current.fightDamage ?? d.current.damage, firstStagger: d.current.firstStagger }, { damage: ev.fightDamage ?? ev.damage, firstStagger: ev.firstStagger }) : ''}
    <div class="member-hit">${moveDetails(ev, index)}</div>
    ${facts.length ? `<p class="dim small">${h(facts.join(' · '))}</p>` : ''}
    <h5>Abilities <span class="dim">${n(ev.skillCost)} / ${n(ev.skillBudget)} AP</span></h5>${abilityList(r, index)}
    ${alwaysOn ? `<h5>Always on</h5>${alwaysOn}` : ''}
    <p class="dim small">The Resonance and gear below are filled in. Keep them as a plan to equip them.</p>
    <div class="toolbar"><button type="button" class="ghost" id="share-build" title="A picture of this build to paste into Discord">Copy image</button></div>
  </div>`;
}

// One character's Build result in the shape the party picture takes: one member, its fight damage as the total.
function shareBuild() {
  const d = ui.deep, r = d?.results?.[d.pick];
  if (!r) return;
  const damage = r.evaluation.fightDamage ?? r.evaluation.damage;
  shareParty({ members: [{ ...r, evaluation: { ...r.evaluation, damage } }], evaluation: { damage } },
    { enemyId: d.enemyId, against: d.enemyId === 'general' ? 'general' : 'enemy', heading: 'Best build',
      current: d.current && { damage: d.current.fightDamage ?? d.current.damage } });
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
`;
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
  const doc = file => `https://github.com/DylanElo/ffr-battle-companion/blob/main/docs/${file}`;
  return `<section>
    <h2>How it works</h2>
    <ul class="plain">
      <li>Your save is read in this browser tab and never uploaded. It only changes when you press Equip, as a new file you download.</li>
      <li><b>Best party</b> tries the parties of four you can field, with your Resonances, gear and abilities, and estimates their damage over a five-round boss fight.</li>
      <li>Numbers come from the game’s own damage formulas and data: ${catalog.visions.length} Resonances, ${catalog.equipment.length} items, ${catalog.enemies.filter(e => e.isBoss).length} bosses. They are estimates; a real fight can differ.</li>
      <li>The search is fast, not exhaustive: it shows the strongest parties it found.</li>
      <li>Boss entries are base data. Some fights change stats or actions, and boss data can spoil later content.</li>
    </ul>
    <details><summary>For the curious</summary>
      <p class="small"><a href="${doc('model-notes.md')}" target="_blank" rel="noopener">Model notes</a> · <a href="${doc('combat-verification.md')}" target="_blank" rel="noopener">What was verified against the game</a></p>
      <h3>Impact tiers</h3>
      <p class="dim small">${h(catalog.meta.legacyTierMethod)} Calculated on 28 September 2026.</p>
      <table><tbody>${tiers.map(([t, l]) => `<tr><td><span class="tier ${t}">${t}</span></td><td>${l.map(v => h(v.name)).join(', ') || '<span class="dim">None</span>'}</td></tr>`).join('')}</tbody></table>
      <h3>Source tables</h3>
      <table><thead><tr><th>Table</th><th>Rows</th><th>SHA-256</th></tr></thead><tbody>
      ${catalog.provenance.map(p => `<tr><td>${h(p.table)}</td><td>${p.rows}</td><td><code>${h(p.sha256)}</code></td></tr>`).join('')}</tbody></table>
    </details>
  </section>`;
}

// ---------- frame ----------

// A party result as plans: each member's gear, Resonance and abilities. Throws if any of them can't be equipped.
function partyPlans(members) {
  const next = Object.fromEntries(members.map(member => [member.characterId, { ...member.equipment, visionId: member.visionId,
    equippedSkillIds: member.evaluation.equippedSkillIds || [], recommendedActionId: member.evaluation.skillId }]));
  for (const member of members) {
    const invalid = C.validPlan(catalog, snapshot, member.characterId, next[member.characterId], next, false);
    if (invalid) throw new Error(invalid);
  }
  return next;
}
const optimizerController = createOptimizerController({ getCatalog: () => catalog, getSnapshot: () => snapshot, getFaces: () => faces, rerender: () => render(),
  stageParty: members => {
    const next = partyPlans(members);
    // Other characters keep their plans while those still fit next to this party.
    for (const [id, plan] of Object.entries(plans)) if (!next[id] && !C.validPlan(catalog, snapshot, id, plan, next, false)) next[id] = plan;
    plans = next; ui.reserve = false; ui.charId = members[0].characterId; storePlans(); setDraft(); view = 'characters'; scrollTo({ top: 0 });
    toast('Party planned. Adjust their gear here; your save is unchanged.');
  },
  canEquip: () => !!saveFile, equipParty: members => applyPlans(partyPlans(members)), shareParty });

// Copies a picture of the party for Discord. Browsers without image clipboard support get it as a download instead.
async function shareParty(party, { enemyId, against, current, heading = 'Best party' }) {
  const boss = against === 'general' ? null : index.enemies.get(Number(enemyId));
  const weak = boss ? enemyRes(boss).filter(([, r]) => r === 'Weakness').map(([e]) => e) : [];
  const image = partyImage(shareCard(party, index, { heading, title: boss ? `${boss.name} (Lv ${boss.level})` : 'Any fight', current, weak }), { faces, bossId: boss?.id });
  const prefix = party.members.length === 1 ? `build-${name('characters', party.members[0].characterId)}` : 'party';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
    toast('Image copied. Paste it into Discord.');
  } catch {
    try { download(await image, `${prefix}-${boss?.name || 'any-fight'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png'); toast('Image saved to your downloads.'); }
    catch (e) { error(e.message); }
  }
}
const RENDER = { party, bosses, characters, resonances };

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

const download = (bytes, fileName) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// Writes plans into a copy of the loaded save, then walks the player through swapping it in. Each download is its
// own click: browsers ask before letting a page start a second download, and players miss that prompt.
async function applyPlans(toWrite = plans) {
  try {
    // Chrome refuses to read a picked file that changed on disk since it was picked.
    const original = new Uint8Array(await saveFile.arrayBuffer().catch(() => { throw new Error(SAVE_CHANGED); }));
    const { bytes, removed } = await savedWithPlans(original, snapshot, toWrite, { catalog, core: C, stats: globalThis.CompanionStats });
    const file = saveFile.name, base = file.replace(/\.sav$/i, '');
    pending = { backup: [original, `${base} (backup).sav`], save: [bytes, file] };
    const swapIn = new Intl.ListFormat('en').format(Object.keys(toWrite).map(Number).filter(id => !snapshot.party.includes(id)).map(id => name('characters', id)));
    $('#about-body').innerHTML = `<h2>Equip in your save</h2>
      <ol class="checklist">
        <li>Close the game.</li>
        <li><button type="button" data-download="backup">Download a backup</button></li>
        <li><button type="button" class="primary" data-download="save">Download the new save</button></li>
        <li>Open <code>${h(SAVE_DIR)}</code> <button type="button" class="ghost" data-copy-path>Copy</button>, then the numbered folder.
          Replace <b>${h(file)}</b> with the new one. <span class="dim small">If your browser added a number to its name, remove it.</span></li>
        <li>Start the game${swapIn ? ` and put ${h(swapIn)} in your party` : ''}.</li>
      </ol>
      ${removed.length ? `<details><summary>Taken off other characters (${removed.length})</summary><ul class="notes">${removed.map(r => `<li>${h(r)}</li>`).join('')}</ul></details>` : ''}
      <p class="dim small">Something wrong? Put the backup back under the name ${h(file)}.</p>`;
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
  if (t.dataset.download) {
    const [bytes, fileName] = pending?.[t.dataset.download] || [];
    if (bytes) { download(bytes, fileName); t.textContent = t.dataset.download === 'backup' ? 'Backup downloaded ✓' : 'New save downloaded ✓'; }
    return;
  }
  if (t.dataset.partyFor) { go(() => { ui.enemyId = +t.dataset.partyFor; optimizerController.setAgainst('enemy'); view = 'party'; scrollTo({ top: 0 }); }); return; }
  if (t.dataset.view) { if (t.dataset.view !== view) go(() => { view = t.dataset.view; }); return; }
  if (t.dataset.enemy) { if (+t.dataset.enemy !== ui.bossId) go(() => { ui.bossId = +t.dataset.enemy; }, t); return; }
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
  if (t.id === 'share-build') { shareBuild(); return; }
  if (t.id === 'deep-cancel') { cancelDeep(); ui.deep = null; render(); return; }
  if (t.dataset.deepPick) { applyDeep(+t.dataset.deepPick); render(); return; }
  if (t.dataset.plan) {
    const v = index.visions.get(+t.dataset.plan);
    go(() => {
      ui.charId = ui.perspective;
      setDraft(); draft.visionId = v.id; ui.pickVision = false; ui.deepGeneral = false; ui.deepEnemyId = ui.bossId; view = 'characters'; scrollTo({ top: 0 }); deepSearch();
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
  else if (t.id === 'deep-incoming-damage') { ui.deepIncomingDamage = Math.max(0, Math.min(99999999, Math.trunc(Number(t.value) || 0))); cancelDeep(); ui.deep = null; }
  else if (t.id === 'deep-incoming-type') { ui.deepIncomingType = t.value === 'Magic' ? 'Magic' : 'Physic'; cancelDeep(); ui.deep = null; }
  else if (t.id === 'deep-enemy') { ui.deepGeneral = t.value === 'general'; if (!ui.deepGeneral) ui.deepEnemyId = +t.value; }
  else if (t.id === 'vision') { draft.visionId = +t.value; ui.pickVision = false; ui.deep = null; }
  else if (t.id === 'pick-vision') ui.pickVision = t.checked;
  else if (t.dataset.slot) { ui.deep = null; const id = +t.value; if (t.dataset.slot === 'accessory') draft.accessoryIds[+t.dataset.index] = id; else draft[t.dataset.slot + 'Id'] = id; }
  else return;
  render();
});

const ready = (async () => {
  try {
    const r = await fetch('data/catalog.json?v=1');
    if (!r.ok) throw new Error(`Couldn’t load game data (${r.status}). Reload to try again.`);
    catalog = await r.json();
    faces = await fetch('data/faces.json?v=1').then(x => x.ok ? x.json() : {}, () => ({}));
    for (const k of ['characters', 'visions', 'equipment', 'skills', 'passives', 'masterSkills', 'effects', 'enemies']) index[k] = new Map(catalog[k].map(x => [x.id, x]));
    document.body.classList.add('entering');
    render();
    setTimeout(() => document.body.classList.remove('entering'), 900);
  } catch (e) { error(e.message); $('#app').innerHTML = ''; throw e; }
})();

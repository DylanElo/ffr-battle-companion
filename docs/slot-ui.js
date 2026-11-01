// One equipment or Resonance slot: the current piece with what it does, and (when open) every choice with its change.
import { h } from './build-details.js?v=13';

const para = (cls, text) => text ? `<p class="${cls}">${h(text)}</p>` : '';
const effects = list => (list || []).map(e => `<p class="dim small"><b>${h(e.name)}</b>${e.text ? ` — ${h(e.text)}` : ''}</p>`).join('');

export function renderSlot({ key, label, current, locked, open, changed = false }) {
  const k = h(key), canLock = Number(current.id) > 0;
  locked = canLock && locked;
  return `<section class="slot${changed ? ' changed' : ''}">
    <div class="slot-head"><span class="dim small">${h(label)}</span>
      <button type="button" class="ghost" data-lock="${k}" aria-label="${locked ? 'Unlock' : 'Lock'} ${h(label)}" aria-pressed="${locked ? 'true' : 'false'}" title="${canLock ? 'Keep this when building' : 'Choose a piece before locking this slot'}"${canLock ? '' : ' disabled'}>${locked ? 'Locked' : 'Lock'}</button>
      <button type="button" class="ghost" data-open-slot="${k}" data-key="slot-${k}" aria-label="Change ${h(label)}" aria-haspopup="dialog" aria-expanded="${open ? 'true' : 'false'}">Change</button></div>
    <div class="slot-current"><strong>${h(current.name)}</strong>${para('dim small', current.statsText)}
      ${current.text || current.effects?.length ? `<details data-keep="piece-${k}"><summary>Details</summary>${para('dim small', current.text)}${effects(current.effects)}</details>` : ''}</div>
  </section>`;
}

export function renderPicker({ key, label, current, choices }) {
  return `<dialog class="window slot-picker" id="slot-picker" aria-labelledby="picker-title">
    <div class="picker-head"><div><p class="dim small">Choose a piece</p><h2 id="picker-title">${h(label)}</h2></div><button type="button" data-close-picker data-key="picker-close">Close</button></div>
    <p class="dim small">Select to equip. Stat changes compare with your current draft.</p>
    <label class="picker-search">Search names, stats or effects<input type="search" id="slot-q" data-key="slot-q" placeholder="Search ${h(label.toLowerCase())}" autocomplete="off" autofocus></label>
    <p class="small" id="picker-count" role="status">${choices.length} choices</p>
    <div class="choices">${choices.map(c => `<button type="button" class="choice" data-key="choice-${h(c.id)}" data-pick-slot="${h(key)}" data-id="${h(c.id)}" aria-pressed="${c.id === current.id}">
      <span class="choice-name"><strong>${h(c.name)}</strong>${c.id === current.id ? '<span class="planned">Equipped</span>' : ''}</span>${para('dim small', c.statsText)}${para('delta small', c.delta)}${para('dim small', c.text)}${effects(c.effects)}</button>`).join('')}</div>
    <p id="picker-empty" class="dim" hidden>No matching pieces. Try another name, stat or effect.</p>
  </dialog>`;
}

export function filterAvailableAbilities(abilities, equippedIds, reasons = {}, filters = {}) {
  const on = new Set(equippedIds), q = String(filters.q || '').trim().toLowerCase();
  return abilities.filter(a => !on.has(a.id)
    && (!q || `${a.name} ${a.text || ''}`.toLowerCase().includes(q))
    && (!filters.kind || filters.kind === 'all' || a.kind === filters.kind)
    && (!filters.affordable || !reasons[a.id]));
}

/** Learned abilities with an equip/remove toggle; equipped ones stay visible while filtering available choices. */
export function renderAbilityList({ abilities, equippedIds, load, lockedIds = [], reasons = {}, filters = {} }) {
  const on = new Set(equippedIds), pinned = new Set(lockedIds);
  const available = filterAvailableAbilities(abilities, equippedIds, reasons, filters);
  const totalAvailable = abilities.filter(a => !on.has(a.id)).length;
  const row = a => {
    const equipped = on.has(a.id), why = !equipped && reasons[a.id], id = h(a.id), name = h(a.name);
    return `<li class="ability${equipped ? ' is-equipped' : ''}"><div class="ability-head"><strong>${name}</strong> <span class="dim small">${h(a.cost)} AP</span>
      ${equipped ? `<button type="button" class="ghost" data-lock="skill:${id}" aria-pressed="${pinned.has(a.id)}" title="Keep this when building">${pinned.has(a.id) ? 'Locked' : 'Lock'}</button>` : ''}
      <button type="button" class="ghost" data-ability-toggle="${id}" data-key="ability-${id}" aria-label="${equipped ? 'Remove' : 'Equip'} ${name}"${why ? ' disabled' : ''}>${equipped ? 'Remove' : 'Equip'}</button></div>
      ${why ? para('note small', why) : ''}${para('dim small', a.text)}</li>`;
  };
  return `<p class="ability-load">${h(load.used)} / ${h(load.budget)} AP · ${h(load.slots)} / ${h(load.maxSlots)} slots</p>
    <h3 class="ability-section">Equipped</h3><ul class="abilities">${abilities.filter(a => on.has(a.id)).map(row).join('') || '<li class="dim small">No abilities equipped. Choose from the available abilities below.</li>'}</ul>
    <h3 class="ability-section">Available</h3>
    <div class="ability-filters">
      <label>Search abilities<input type="search" id="ability-q" data-key="ability-q" data-ability-filter="q" value="${h(filters.q || '')}" placeholder="Search names or descriptions"></label>
      <label>Ability type<select id="ability-kind" data-key="ability-kind" data-ability-filter="kind">${[['all', 'All types'], ['active', 'Active'], ['passive', 'Passive'], ['master', 'Mastery']].map(([value, label]) => `<option value="${value}"${(filters.kind || 'all') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="ability-affordable" data-key="ability-affordable" data-ability-filter="affordable"${filters.affordable ? ' checked' : ''}> Can equip now</label>
    </div>
    <p class="dim small" role="status">${available.length} of ${totalAvailable} available abilities</p>
    <ul class="abilities">${available.map(row).join('') || `<li class="dim small">${totalAvailable ? 'No abilities match these filters. Try another search or change the filters.' : 'No other learned abilities.'}</li>`}</ul>`;
}
